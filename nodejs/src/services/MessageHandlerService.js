/**
 * Message Handler Service - Modern Architecture (Router/Dispatcher)
 * 
 * Thin dispatcher that routes incoming messages to the appropriate handler:
 *   - AdminMessageHandler  → admin commands + admin self-chat
 *   - GroupMessageHandler   → group chat messages (@g.us)
 *   - UserMessageHandler    → normal 1:1 user messages
 * 
 * Each handler lives in its own file under ./handlers/ and can be
 * customized independently without affecting the others.
 */

const AdminMessageHandler = require('./handlers/AdminMessageHandler');
const GroupMessageHandler = require('./handlers/GroupMessageHandler');
const UserMessageHandler = require('./handlers/UserMessageHandler');

class MessageHandlerService {
    constructor(container) {
        this.container = container;
        this.messageProvider = container.resolve('IMessageProvider');
        this.isStarted = false;

        // Create the three specialized handlers
        this.adminHandler = new AdminMessageHandler(container);
        this.groupHandler = new GroupMessageHandler(container);
        this.userHandler = new UserMessageHandler(container);
    }

    async start() {
        if (this.isStarted) return;

        // Register WhatsApp event listeners
        this.messageProvider.onMessage(this.handleIncomingMessage.bind(this));
        this.messageProvider.onMessageCreate(this.handleOutgoingMessage.bind(this));

        this.isStarted = true;
        console.log('✅ MessageHandlerService started');
    }

    async stop() {
        this.isStarted = false;
        console.log('✅ MessageHandlerService stopped');
    }

    // =====================================================
    // INCOMING MESSAGE ROUTER
    // =====================================================

    async handleIncomingMessage(message) {
        const contactId = (message.from || '').trim().toLowerCase();

        // Ignore WhatsApp status broadcasts
        if (contactId === 'status@broadcast') {
            return;
        }

        // Global pause: allow admin commands through, block everything else
        if (global.botPaused && !this.adminHandler.isAdminContact(contactId)) {
            console.log(`[ROUTER] ⏸ Bot paused — ignoring message from ${contactId}`);
            return;
        }

        // 1) Admin — commands + normal admin chat
        if (this.adminHandler.isAdminContact(contactId)) {
            console.log(`[ROUTER] ➡ Routing to AdminHandler (from=${contactId})`);
            const handled = await this.adminHandler.handleMessage(message);
            if (handled) return;
        }

        // 2) Group chat
        if (contactId.endsWith('@g.us')) {
            console.log(`[ROUTER] ➡ Routing to GroupHandler (from=${contactId})`);
            await this.groupHandler.handleMessage(message);
            return;
        }

        // 3) Normal 1:1 user
        console.log(`[ROUTER] ➡ Routing to UserHandler (from=${contactId})`);
        await this.userHandler.handleMessage(message);
    }

    // =====================================================
    // OUTGOING MESSAGE ROUTER (admin self-chat)
    // =====================================================

    async handleOutgoingMessage(message) {
        // Delegate entirely to AdminMessageHandler (it has all the guards)
        if (message.fromMe && message.to !== 'status@broadcast') {
            console.log(`[ROUTER] ➡ Outgoing message_create — checking admin self-chat (to=${message.to})`);
        }
        await this.adminHandler.handleSelfChat(message);
    }
}

module.exports = MessageHandlerService;
