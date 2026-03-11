/**
 * Admin Message Handler
 * Handles admin slash commands and admin self-chat (admin talking to themselves).
 * Extends BaseMessageHandler for shared utilities.
 */

const BaseMessageHandler = require('./BaseMessageHandler');

class AdminMessageHandler extends BaseMessageHandler {
    constructor(container) {
        super(container);

        this.sourceType = 'admin';

        this.adminIds = (process.env.OWNER_WHATSAPP_ID || process.env.ADMIN_WHATSAPP_ID || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .map(id => id.toLowerCase());

        // Lock to prevent infinite loop when admin chats with AI from their phone
        this._processingLock = false;
    }

    /**
     * Admin has access to ALL tool categories (no restrictions).
     */
    _getAllowedToolCategories() {
        return null;
    }

    // =====================================================
    // ADMIN IDENTIFICATION
    // =====================================================

    isAdminContact(contactId) {
        const normalized = this._normalizeContactId(contactId);
        return this.adminIds.includes(normalized);
    }

    // =====================================================
    // INCOMING MESSAGE (admin sends a normal message or command)
    // =====================================================

    /**
     * Handle an incoming message from the admin.
     * Returns true if handled (command or chat), false if not an admin message.
     */
    async handleMessage(message) {
        const contactId = this._normalizeContactId(message.from);

        if (!this.isAdminContact(contactId)) {
            return false;
        }

        const messageText = message.body;

        // If message starts with '/', treat as command
        if (await this._handleCommand(contactId, messageText, message)) {
            return true;
        }

        // Otherwise, process as normal chat (admin talking to the bot)
        const startTime = Date.now();
        try {
            const messageType = message.type || 'text';
            console.log(`[HANDLER] 📨 Admin incoming message from ${contactId}: ${messageText}`);

            // forceAutoReply=true: admin messages always get quote-reply, never queued
            await this.processMessagePipeline(contactId, message, messageText, messageType, { forceAutoReply: true });

            const processingTime = Date.now() - startTime;
            console.log(`[HANDLER] ✅ Admin message processed in ${processingTime}ms`);
        } catch (error) {
            console.error('[HANDLER] ❌ Error processing admin message:', error);
            await this.sendErrorResponse(contactId);
        }

        return true;
    }

    // =====================================================
    // SELF-CHAT (admin messaging themselves via message_create)
    // =====================================================

    /**
     * Handle outgoing message_create event for admin self-chat.
     * Returns true if handled, false otherwise.
     */
    async handleSelfChat(message) {
        // message_create fires for ALL messages including ones sent by this device.
        if (!message.fromMe) {
            return false;
        }

        // Skip if bot is currently processing/replying (prevents infinite loop)
        if (this._processingLock) {
            return false;
        }

        // Skip status broadcasts
        if (message.to === 'status@broadcast') {
            return false;
        }

        // Skip if no content (neither text nor media)
        const messageType = message.type || 'text';
        const hasContent = message.body || this._isMediaType(messageType);
        if (!hasContent) {
            return false;
        }

        // Only process messages from the admin's own phone
        const fromId = this._normalizeContactId(message.from);
        if (!this.isAdminContact(fromId)) {
            return false;
        }

        // Only process self-chat (admin messaging themselves)
        // If admin is messaging someone else, do NOT interfere
        const toId = this._normalizeContactId(message.to);
        if (fromId !== toId) {
            return false;
        }

        // Admin is chatting with themselves — process it with the AI
        const displayText = message.body || `[${messageType} message]`;
        console.log(`[HANDLER] 📨 Admin self-chat: ${displayText}`);

        // Set lock to prevent the bot's reply from being re-processed
        this._processingLock = true;
        try {
            // Route through handleMessage which handles commands + normal chat
            // We need to simulate an incoming message context
            const contactId = fromId;
            const messageText = message.body;

            // Check for commands first
            if (await this._handleCommand(contactId, messageText, message)) {
                return true;
            }

            // Process as normal chat
            const startTime = Date.now();
            try {
                // forceAutoReply=true: admin self-chat always gets quote-reply, never queued
                await this.processMessagePipeline(contactId, message, messageText, messageType, { forceAutoReply: true });
                const processingTime = Date.now() - startTime;
                console.log(`[HANDLER] ✅ Admin self-chat processed in ${processingTime}ms`);
            } catch (error) {
                console.error('[HANDLER] ❌ Error processing admin self-chat:', error);
                await this.sendErrorResponse(contactId);
            }

            return true;
        } finally {
            // Release lock after a short delay to ensure the reply's
            // message_create event has already fired and been ignored
            setTimeout(() => { this._processingLock = false; }, 2000);
        }
    }

    // =====================================================
    // SLASH COMMANDS
    // =====================================================

    async _handleCommand(contactId, messageText, originalMessage) {
        const text = (messageText || '').trim();
        if (!text.startsWith('/')) return false;

        const parts = text.slice(1).split(' ').filter(Boolean);
        const cmd = (parts[0] || '').toLowerCase();
        const args = parts.slice(1);

        const reply = async (msg) => {
            if (originalMessage) {
                await this.replyToMessage(originalMessage, msg);
            } else {
                await this.sendResponse(contactId, msg);
            }
        };

        switch (cmd) {
            case 'pause':
                global.botPaused = true;
                this._emitDashboardSystemStatus();
                await reply('⏸️ Bot paused');
                return true;

            case 'resume':
                global.botPaused = false;
                this._emitDashboardSystemStatus();
                await reply('▶️ Bot resumed');
                return true;

            case 'mode': {
                const mode = (args[0] || '').toLowerCase();
                if (mode !== 'auto' && mode !== 'manual') {
                    await reply('Usage: /mode auto | /mode manual');
                    return true;
                }
                const enabled = mode === 'auto';
                await this.database.setAutoReplyMode(enabled);
                this._emitDashboardSettingsUpdated({ autoReply: enabled });
                await reply(`✅ Auto-reply mode: ${mode}`);
                return true;
            }

            case 'allowedonly': {
                const v = (args[0] || '').toLowerCase();
                if (v !== 'on' && v !== 'off') {
                    await reply('Usage: /allowedonly on | /allowedonly off');
                    return true;
                }
                const enabled = v === 'on';
                await this.database.setAllowedContactsOnly(enabled);
                this._emitDashboardSettingsUpdated({ allowedContactsOnly: enabled });
                await reply(`✅ Allowed-contacts-only: ${v}`);
                return true;
            }

            case 'allow': {
                const number = args[0];
                if (!number) {
                    await reply('Usage: /allow <phone_number>');
                    return true;
                }
                await this.database.addAllowedContact(number, '', contactId);
                this._emitDashboardAllowedContactsUpdated();
                await reply(`✅ Added to allowed contacts: ${number}`);
                return true;
            }

            case 'disallow': {
                const number = args[0];
                if (!number) {
                    await reply('Usage: /disallow <phone_number>');
                    return true;
                }
                await this.database.removeAllowedContact(number);
                this._emitDashboardAllowedContactsUpdated();
                await reply(`✅ Removed from allowed contacts: ${number}`);
                return true;
            }

            case 'help':
                await reply(
                    'Admin commands:\n' +
                    '/pause\n' +
                    '/resume\n' +
                    '/mode auto|manual\n' +
                    '/allowedonly on|off\n' +
                    '/allow <phone_number>\n' +
                    '/disallow <phone_number>'
                );
                return true;

            default:
                await reply('Unknown command. Send /help');
                return true;
        }
    }
}

module.exports = AdminMessageHandler;
