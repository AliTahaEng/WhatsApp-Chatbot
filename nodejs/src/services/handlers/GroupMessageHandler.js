/**
 * Group Message Handler
 * Handles messages from WhatsApp group chats (@g.us).
 * Extends BaseMessageHandler for shared utilities.
 * 
 * The bot responds in groups when:
 *   1. The admin (bot owner) is @mentioned in the message, OR
 *   2. Someone replies to a previous message sent by the admin/bot.
 * 
 * All responses are sent as quote-replies to the triggering message.
 */

const BaseMessageHandler = require('./BaseMessageHandler');

class GroupMessageHandler extends BaseMessageHandler {
    constructor(container) {
        super(container);

        this.sourceType = 'group';

        // Admin IDs used to detect @mentions and reply-to-admin messages
        this.adminIds = (process.env.OWNER_WHATSAPP_ID || process.env.ADMIN_WHATSAPP_ID || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .map(id => id.toLowerCase());
    }

    /**
     * Groups only get information and math tools (no file management).
     */
    _getAllowedToolCategories() {
        return ['information', 'math'];
    }

    /**
     * Check if the admin (bot owner) was @mentioned in the message.
     * WhatsApp Web.js provides mentionedIds as an array of contact ID strings.
     * Fallback: also check message body for @number pattern.
     */
    _isAdminMentioned(message) {
        // Extract admin numbers for comparison (e.g., "201080929617" from "201080929617@c.us")
        const adminNumbers = this.adminIds.map(id => id.replace(/@.*$/, ''));

        // Method 1: Check mentionedIds array
        // WhatsApp uses different formats: @c.us for contacts, @lid for group mentions
        const mentionedIds = message.mentionedIds || [];
        for (const mention of mentionedIds) {
            const mentionId = (typeof mention === 'string' ? mention : (mention._serialized || '')).toLowerCase();

            // Direct match (e.g., "201080929617@c.us")
            if (this.adminIds.includes(mentionId)) {
                return true;
            }

            // Extract number from mention (handles @lid, @c.us, etc.)
            const mentionNumber = mentionId.replace(/@.*$/, '');
            if (adminNumbers.includes(mentionNumber)) {
                return true;
            }
        }

        // Method 2: Fallback - check message body for @number pattern
        const messageBody = (message.body || '').toLowerCase();
        for (const adminNumber of adminNumbers) {
            // Check if message contains @number
            if (messageBody.includes(`@${adminNumber}`)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if the message is a reply to a previous message sent by the admin/bot.
     * WhatsApp Web.js: message.hasQuotedMsg → message.getQuotedMessage() → quotedMsg.fromMe or quotedMsg.from
     */
    async _isReplyToAdminOrBot(message) {
        try {
            if (!message.hasQuotedMsg) {
                return false;
            }
            const quotedMsg = await message.getQuotedMessage();
            if (!quotedMsg) return false;

            // Method 1: If the quoted message was sent by this device (the bot), it's a reply to the bot
            if (quotedMsg.fromMe) {
                return true;
            }

            // Method 2: Check if quoted message ID is in bot's sent message tracking
            const quotedMsgId = quotedMsg.id?.id || quotedMsg.id;
            if (quotedMsgId && this._botSentMessageIds.has(quotedMsgId)) {
                return true;
            }

            // Method 3: If the quoted message was sent by the admin's number
            const quotedFrom = this._normalizeContactId(quotedMsg.author || quotedMsg.from);
            if (this.adminIds.includes(quotedFrom)) {
                return true;
            }

            return false;
        } catch (error) {
            console.warn('⚠️ Could not check quoted message:', error.message);
            return false;
        }
    }

    /**
     * Strip the @mention text from the message body so the AI gets a clean prompt.
     * WhatsApp mentions look like "@201080929617" in the body text.
     */
    _stripAdminMention(messageText) {
        let cleaned = messageText || '';
        for (const adminId of this.adminIds) {
            const numberPart = adminId.replace(/@.*$/, '');
            const mentionRegex = new RegExp(`@${numberPart}\\b`, 'gi');
            cleaned = cleaned.replace(mentionRegex, '');
        }
        return cleaned.trim();
    }

    /**
     * Handle an incoming message from a group chat.
     * Only processes the message if:
     *   - The admin/bot owner is @mentioned, OR
     *   - The message is a reply to a previous admin/bot message.
     * Responds with a quote-reply to the original message.
     * @param {object} message - WhatsApp message object
     * @returns {Promise<void>}
     */
    async handleMessage(message) {
        const startTime = Date.now();
        const contactId = this._normalizeContactId(message.from);
        const messageText = message.body;
        const messageType = message.type || 'text';

        try {
            // Check both trigger conditions
            const mentioned = this._isAdminMentioned(message);
            const repliedToBot = await this._isReplyToAdminOrBot(message);

            // Debug logging
            const adminNumbers = this.adminIds.map(id => id.replace(/@.*$/, ''));
            const mentionNumbers = (message.mentionedIds || []).map(m => {
                const id = (typeof m === 'string' ? m : (m._serialized || '')).toLowerCase();
                return id.replace(/@.*$/, '');
            });
            console.log(`[GROUP] 📊 Trigger check | mentioned=${mentioned} | repliedToBot=${repliedToBot}`);
            console.log(`[GROUP] 📊 mentionedIds=${JSON.stringify(message.mentionedIds || [])} → numbers=${JSON.stringify(mentionNumbers)}`);
            console.log(`[GROUP] 📊 adminIds=${JSON.stringify(this.adminIds)} → numbers=${JSON.stringify(adminNumbers)}`);
            console.log(`[GROUP] 📊 messageBody="${(message.body || '').substring(0, 100)}..."`);

            // Only respond if admin was @mentioned OR someone replied to a bot/admin message
            if (!mentioned && !repliedToBot) {
                console.log(`[GROUP] ⏭️ Skipping group message (no mention/reply trigger)`);
                return;
            }

            const trigger = mentioned ? 'admin mentioned' : 'reply to bot';
            console.log(`[HANDLER] 📨 Group message (${trigger}) from ${contactId}: ${messageText}`);

            // Check if allowed contacts mode is enabled
            const allowedContactsOnly = await this.database.isAllowedContactsOnly();
            if (allowedContactsOnly) {
                const isAllowed = await this.database.isAllowedContact(contactId);
                if (!isAllowed) {
                    console.log(`🚫 Message from non-allowed group: ${contactId} (ignored)`);
                    return;
                }
            }

            // Strip the @mention from the text so the AI gets a clean prompt
            const cleanedText = mentioned ? this._stripAdminMention(messageText) : messageText;
            if (!cleanedText && !this._isMediaType(messageType)) {
                await this.replyToMessage(message, 'You mentioned me! How can I help? Please add your question after the @mention.');
                return;
            }

            // Run the shared processing pipeline (group replies respect global auto/manual mode)
            await this.processMessagePipeline(contactId, message, cleanedText, messageType);

            const processingTime = Date.now() - startTime;
            console.log(`[HANDLER] ✅ Group message processed in ${processingTime}ms`);

        } catch (error) {
            console.error('[HANDLER] ❌ Error processing group message:', error);
            try {
                await this.replyToMessage(message, 'Sorry, I encountered an error processing your message. Please try again.');
            } catch (replyError) {
                await this.sendErrorResponse(contactId);
            }
        }
    }
}

module.exports = GroupMessageHandler;
