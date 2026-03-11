/**
 * Message Provider Interface
 * Abstract interface for messaging platforms
 * Enables switching between WhatsApp, Telegram, Discord, Slack, etc.
 */

class IMessageProvider {
    // Connection and Authentication
    async initialize() {
        throw new Error('initialize() must be implemented');
    }

    async connect() {
        throw new Error('connect() must be implemented');
    }

    async disconnect() {
        throw new Error('disconnect() must be implemented');
    }

    async isReady() {
        throw new Error('isReady() must be implemented');
    }

    // Provider Information
    getProviderName() {
        throw new Error('getProviderName() must be implemented');
    }

    getSupportedMessageTypes() {
        throw new Error('getSupportedMessageTypes() must be implemented');
    }

    getMaxMessageLength() {
        throw new Error('getMaxMessageLength() must be implemented');
    }

    // Message Operations
    async sendMessage(contactId, message, options = {}) {
        throw new Error('sendMessage() must be implemented');
    }

    async sendMediaMessage(contactId, mediaData, caption = '', options = {}) {
        throw new Error('sendMediaMessage() must be implemented');
    }

    async sendAudioMessage(contactId, audioData, options = {}) {
        throw new Error('sendAudioMessage() must be implemented');
    }

    async sendLocationMessage(contactId, latitude, longitude, options = {}) {
        throw new Error('sendLocationMessage() must be implemented');
    }

    async sendContactMessage(contactId, contactData, options = {}) {
        throw new Error('sendContactMessage() must be implemented');
    }

    // Message Status
    async markAsRead(messageId) {
        throw new Error('markAsRead() must be implemented');
    }

    async getMessageStatus(messageId) {
        throw new Error('getMessageStatus() must be implemented');
    }

    // Contact Management
    async getContact(contactId) {
        throw new Error('getContact() must be implemented');
    }

    async getContactInfo(contactId) {
        throw new Error('getContactInfo() must be implemented');
    }

    async blockContact(contactId) {
        throw new Error('blockContact() must be implemented');
    }

    async unblockContact(contactId) {
        throw new Error('unblockContact() must be implemented');
    }

    // Group Management (if supported)
    async createGroup(name, participants) {
        throw new Error('createGroup() must be implemented');
    }

    async addToGroup(groupId, contactId) {
        throw new Error('addToGroup() must be implemented');
    }

    async removeFromGroup(groupId, contactId) {
        throw new Error('removeFromGroup() must be implemented');
    }

    supportsGroups() {
        return false; // Override in implementations that support groups
    }

    // Event Handlers
    onMessage(handler) {
        throw new Error('onMessage() must be implemented');
    }

    onMessageCreate(handler) {
        throw new Error('onMessageCreate() must be implemented');
    }

    onAuthenticated(handler) {
        throw new Error('onAuthenticated() must be implemented');
    }

    onReady(handler) {
        throw new Error('onReady() must be implemented');
    }

    onDisconnected(handler) {
        throw new Error('onDisconnected() must be implemented');
    }

    onQrCode(handler) {
        throw new Error('onQrCode() must be implemented');
    }

    // Media Handling
    async downloadMedia(message) {
        throw new Error('downloadMedia() must be implemented');
    }

    supportsMedia() {
        return false; // Override in implementations that support media
    }

    getSupportedMediaTypes() {
        return []; // Override in implementations that support media
    }

    // Typing Indicators
    async sendTyping(contactId) {
        throw new Error('sendTyping() must be implemented');
    }

    async stopTyping(contactId) {
        throw new Error('stopTyping() must be implemented');
    }

    supportsTypingIndicators() {
        return false; // Override in implementations that support typing
    }

    // Message Formatting
    formatMessage(text, options = {}) {
        return text; // Default implementation, override for platform-specific formatting
    }

    formatMentions(text, mentions = []) {
        return text; // Override for platform-specific mention formatting
    }

    // Platform-specific Features
    getPlatformFeatures() {
        return {
            supportsGroups: this.supportsGroups(),
            supportsMedia: this.supportsMedia(),
            supportsTyping: this.supportsTypingIndicators(),
            supportedMediaTypes: this.getSupportedMediaTypes(),
            maxMessageLength: this.getMaxMessageLength(),
            supportsMarkdown: false,
            supportsEmojis: true,
            supportsStickers: false,
            supportsVoiceNotes: false
        };
    }

    // Health and Status
    getConnectionStatus() {
        return {
            provider: this.getProviderName(),
            connected: false,
            authenticated: false,
            ready: false,
            lastActivity: null,
            connectionUptime: 0
        };
    }

    async performHealthCheck() {
        throw new Error('performHealthCheck() must be implemented');
    }
}

module.exports = IMessageProvider;
