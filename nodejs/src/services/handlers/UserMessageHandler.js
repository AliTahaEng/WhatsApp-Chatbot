/**
 * User Message Handler
 * Handles normal 1:1 messages from regular users (non-admin, non-group).
 * Extends BaseMessageHandler for shared utilities.
 */

const BaseMessageHandler = require('./BaseMessageHandler');

class UserMessageHandler extends BaseMessageHandler {
    constructor(container) {
        super(container);
    }

    /**
     * Handle an incoming message from a normal user (1:1 chat).
     * @param {object} message - WhatsApp message object
     * @returns {Promise<void>}
     */
    async handleMessage(message) {
        const startTime = Date.now();
        const contactId = this._normalizeContactId(message.from);
        const messageText = message.body;
        const messageType = message.type || 'text';

        try {
            console.log(`[HANDLER] 📨 User 1:1 message from ${contactId}: ${messageText}`);

            // Check if allowed contacts mode is enabled
            const allowedContactsOnly = await this.database.isAllowedContactsOnly();
            if (allowedContactsOnly) {
                const isAllowed = await this.database.isAllowedContact(contactId);
                if (!isAllowed) {
                    console.log(`🚫 Message from non-allowed contact: ${contactId} (ignored)`);
                    return;
                }
            }

            // Run the shared processing pipeline
            await this.processMessagePipeline(contactId, message, messageText, messageType);

            const processingTime = Date.now() - startTime;
            console.log(`[HANDLER] ✅ User message processed in ${processingTime}ms`);

        } catch (error) {
            console.error('[HANDLER] ❌ Error processing user message:', error);
            await this.sendErrorResponse(contactId);
        }
    }
}

module.exports = UserMessageHandler;
