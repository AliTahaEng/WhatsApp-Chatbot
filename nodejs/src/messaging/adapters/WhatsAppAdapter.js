/**
 * WhatsApp Adapter
 * Implements IMessageProvider interface for WhatsApp Web
 * Uses whatsapp-web.js library
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const IMessageProvider = require('../../core/interfaces/IMessageProvider');
const logger = require('../../utils/logger');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class WhatsAppAdapter extends IMessageProvider {
    constructor(config = {}) {
        super();
        this.config = {
            sessionPath: config.sessionPath || process.env.WHATSAPP_SESSION_PATH || './data/session',
            puppeteerArgs: config.puppeteerArgs || [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ],
            qrCodeInTerminal: config.qrCodeInTerminal !== false,
            ...config
        };

        this.client = null;
        this.isReady = false;
        this.isAuthenticated = false;
        this.connectionStatus = {
            provider: 'WhatsApp',
            connected: false,
            authenticated: false,
            ready: false,
            lastActivity: null,
            connectionUptime: 0,
            startTime: null
        };

        this.eventHandlers = {
            message: [],
            messageCreate: [],
            authenticated: [],
            ready: [],
            disconnected: [],
            qrCode: []
        };
    }

    async initialize() {
        try {
            this.client = new Client({
                authStrategy: new LocalAuth({
                    dataPath: this.config.sessionPath
                }),
                puppeteer: {
                    headless: true,
                    args: this.config.puppeteerArgs
                }
            });

            this.setupInternalEventHandlers();
            this.connectionStatus.startTime = Date.now();

            logger.info('📱 WhatsApp adapter initialized');
        } catch (error) {
            logger.error('❌ Failed to initialize WhatsApp adapter:', error);
            throw error;
        }
    }

    async connect() {
        try {
            if (!this.client) {
                await this.initialize();
            }

            await this.client.initialize();
            logger.info('📱 WhatsApp connection initiated');
        } catch (error) {
            logger.error('❌ Failed to connect WhatsApp:', error);
            throw error;
        }
    }

    async disconnect() {
        try {
            if (this.client) {
                await this.client.destroy();
                this.isReady = false;
                this.isAuthenticated = false;
                this.connectionStatus.connected = false;
                this.connectionStatus.authenticated = false;
                this.connectionStatus.ready = false;
                logger.info('📱 WhatsApp disconnected');
            }
        } catch (error) {
            logger.error('❌ Error disconnecting WhatsApp:', error);
            throw error;
        }
    }

    async isReady() {
        return this.isReady;
    }

    getProviderName() {
        return 'WhatsApp';
    }

    getSupportedMessageTypes() {
        return ['text', 'image', 'audio', 'video', 'document', 'location', 'contact', 'sticker'];
    }

    getMaxMessageLength() {
        return 65536; // WhatsApp message limit
    }

    async sendMessage(contactId, message, options = {}) {
        try {
            if (!this.isReady) {
                throw new Error('WhatsApp not ready');
            }

            const formattedMessage = this.formatMessage(message, options);
            const result = await this.client.sendMessage(contactId, formattedMessage);

            this.connectionStatus.lastActivity = Date.now();

            return {
                id: result.id.id,
                timestamp: result.timestamp,
                status: 'sent',
                provider: 'WhatsApp'
            };
        } catch (error) {
            logger.error('❌ Error sending WhatsApp message:', error);
            throw error;
        }
    }

    async sendMediaMessage(contactId, mediaData, caption = '', options = {}) {
        try {
            if (!this.isReady) {
                throw new Error('WhatsApp not ready');
            }

            const mediaMessage = {
                media: mediaData,
                caption: caption || '',
                ...options
            };

            const result = await this.client.sendMessage(contactId, mediaMessage);
            this.connectionStatus.lastActivity = Date.now();

            return {
                id: result.id.id,
                timestamp: result.timestamp,
                status: 'sent',
                provider: 'WhatsApp',
                type: 'media'
            };
        } catch (error) {
            logger.error('❌ Error sending WhatsApp media:', error);
            throw error;
        }
    }

    async sendAudioMessage(contactId, audioData, options = {}) {
        let tempFilePath = null;

        try {
            if (!this.isReady) {
                throw new Error('WhatsApp not ready');
            }

            // Save OGG audio to temporary file
            tempFilePath = path.join(os.tmpdir(), `whatsapp_audio_${Date.now()}.ogg`);
            await fs.writeFile(tempFilePath, audioData);

            // Create MessageMedia with correct OGG Opus mime type
            const base64Data = audioData.toString('base64');
            const media = new MessageMedia('audio/ogg; codecs=opus', base64Data, 'voice.ogg');

            // Send as voice note (PTT) — requires OGG Opus format
            const result = await this.client.sendMessage(contactId, media, {
                sendAudioAsVoice: true
            });

            this.connectionStatus.lastActivity = Date.now();

            return {
                id: result.id.id,
                timestamp: result.timestamp,
                status: 'sent',
                provider: 'WhatsApp',
                type: 'audio'
            };
        } catch (error) {
            logger.error('❌ Error sending WhatsApp audio:', error);
            throw error;
        } finally {
            // Cleanup temp file
            if (tempFilePath) {
                try {
                    await fs.unlink(tempFilePath);
                } catch (err) {
                    // Ignore cleanup errors
                }
            }
        }
    }

    async sendLocationMessage(contactId, latitude, longitude, options = {}) {
        try {
            if (!this.isReady) {
                throw new Error('WhatsApp not ready');
            }

            const location = {
                latitude: latitude,
                longitude: longitude,
                description: options.description || ''
            };

            const result = await this.client.sendMessage(contactId, location);
            this.connectionStatus.lastActivity = Date.now();

            return {
                id: result.id.id,
                timestamp: result.timestamp,
                status: 'sent',
                provider: 'WhatsApp',
                type: 'location'
            };
        } catch (error) {
            logger.error('❌ Error sending WhatsApp location:', error);
            throw error;
        }
    }

    async sendContactMessage(contactId, contactData, options = {}) {
        try {
            if (!this.isReady) {
                throw new Error('WhatsApp not ready');
            }

            const contact = {
                displayName: contactData.name,
                vcard: contactData.vcard || this.generateVCard(contactData)
            };

            const result = await this.client.sendMessage(contactId, contact);
            this.connectionStatus.lastActivity = Date.now();

            return {
                id: result.id.id,
                timestamp: result.timestamp,
                status: 'sent',
                provider: 'WhatsApp',
                type: 'contact'
            };
        } catch (error) {
            logger.error('❌ Error sending WhatsApp contact:', error);
            throw error;
        }
    }

    async markAsRead(messageId) {
        try {
            // WhatsApp Web.js doesn't have direct markAsRead by message ID
            // This would need to be implemented based on chat
            logger.debug('Mark as read not directly supported by WhatsApp Web.js');
            return true;
        } catch (error) {
            logger.error('❌ Error marking message as read:', error);
            return false;
        }
    }

    async getMessageStatus(messageId) {
        try {
            // WhatsApp Web.js doesn't provide easy message status lookup
            // This would need custom implementation
            return {
                id: messageId,
                status: 'unknown',
                timestamp: Date.now()
            };
        } catch (error) {
            logger.error('❌ Error getting message status:', error);
            return null;
        }
    }

    async getContact(contactId) {
        try {
            if (!this.isReady) {
                throw new Error('WhatsApp not ready');
            }

            const contact = await this.client.getContactById(contactId);
            return {
                id: contact.id.user,
                name: contact.name || contact.pushname || 'Unknown',
                pushname: contact.pushname,
                number: contact.number,
                isBlocked: contact.isBlocked,
                isGroup: contact.isGroup,
                profilePicUrl: await contact.getProfilePicUrl().catch(() => null)
            };
        } catch (error) {
            logger.error('❌ Error getting WhatsApp contact:', error);
            return null;
        }
    }

    async getContactInfo(contactId) {
        return await this.getContact(contactId);
    }

    async blockContact(contactId) {
        try {
            const contact = await this.client.getContactById(contactId);
            await contact.block();
            logger.info(`🚫 Blocked contact: ${contactId}`);
            return true;
        } catch (error) {
            logger.error('❌ Error blocking contact:', error);
            return false;
        }
    }

    async unblockContact(contactId) {
        try {
            const contact = await this.client.getContactById(contactId);
            await contact.unblock();
            logger.info(`✅ Unblocked contact: ${contactId}`);
            return true;
        } catch (error) {
            logger.error('❌ Error unblocking contact:', error);
            return false;
        }
    }

    async createGroup(name, participants) {
        try {
            if (!this.supportsGroups()) {
                throw new Error('Groups not supported in this WhatsApp adapter configuration');
            }

            const group = await this.client.createGroup(name, participants);
            return {
                id: group.gid,
                name: name,
                participants: participants,
                createdAt: Date.now()
            };
        } catch (error) {
            logger.error('❌ Error creating WhatsApp group:', error);
            throw error;
        }
    }

    async addToGroup(groupId, contactId) {
        try {
            const chat = await this.client.getChatById(groupId);
            await chat.addParticipants([contactId]);
            return true;
        } catch (error) {
            logger.error('❌ Error adding to WhatsApp group:', error);
            return false;
        }
    }

    async removeFromGroup(groupId, contactId) {
        try {
            const chat = await this.client.getChatById(groupId);
            await chat.removeParticipants([contactId]);
            return true;
        } catch (error) {
            logger.error('❌ Error removing from WhatsApp group:', error);
            return false;
        }
    }

    supportsGroups() {
        return true;
    }

    onMessage(handler) {
        this.eventHandlers.message.push(handler);
        return this;
    }

    onMessageCreate(handler) {
        this.eventHandlers.messageCreate.push(handler);
        return this;
    }

    onAuthenticated(handler) {
        this.eventHandlers.authenticated.push(handler);
        return this;
    }

    onReady(handler) {
        this.eventHandlers.ready.push(handler);
        return this;
    }

    onDisconnected(handler) {
        this.eventHandlers.disconnected.push(handler);
        return this;
    }

    onQrCode(handler) {
        this.eventHandlers.qrCode.push(handler);
        return this;
    }

    async downloadMedia(message) {
        try {
            if (!message.hasMedia) {
                return null;
            }

            const media = await message.downloadMedia();
            return {
                data: media.data,
                mimetype: media.mimetype,
                filename: media.filename || null
            };
        } catch (error) {
            logger.error('❌ Error downloading WhatsApp media:', error);
            return null;
        }
    }

    supportsMedia() {
        return true;
    }

    getSupportedMediaTypes() {
        return ['image/jpeg', 'image/png', 'image/gif', 'audio/ogg', 'audio/mp3', 'video/mp4', 'application/pdf'];
    }

    async sendTyping(contactId) {
        try {
            const chat = await this.client.getChatById(contactId);
            await chat.sendStateTyping();
            return true;
        } catch (error) {
            logger.error('❌ Error sending typing indicator:', error);
            return false;
        }
    }

    async stopTyping(contactId) {
        try {
            const chat = await this.client.getChatById(contactId);
            await chat.clearState();
            return true;
        } catch (error) {
            logger.error('❌ Error stopping typing indicator:', error);
            return false;
        }
    }

    supportsTypingIndicators() {
        return true;
    }

    formatMessage(text, options = {}) {
        let formattedText = text;

        // WhatsApp formatting
        if (options.bold) {
            formattedText = `*${formattedText}*`;
        }
        if (options.italic) {
            formattedText = `_${formattedText}_`;
        }
        if (options.monospace) {
            formattedText = `\`\`\`${formattedText}\`\`\``;
        }
        if (options.strikethrough) {
            formattedText = `~${formattedText}~`;
        }

        return formattedText;
    }

    formatMentions(text, mentions = []) {
        // WhatsApp mentions use @ format
        let formattedText = text;

        mentions.forEach(mention => {
            const regex = new RegExp(`@${mention.name}`, 'gi');
            formattedText = formattedText.replace(regex, `@${mention.id}`);
        });

        return formattedText;
    }

    getPlatformFeatures() {
        return {
            supportsGroups: true,
            supportsMedia: true,
            supportsTyping: true,
            supportedMediaTypes: this.getSupportedMediaTypes(),
            maxMessageLength: this.getMaxMessageLength(),
            supportsMarkdown: true, // Basic WhatsApp formatting
            supportsEmojis: true,
            supportsStickers: true,
            supportsVoiceNotes: true,
            supportsLocation: true,
            supportsContacts: true,
            supportsPolls: false, // Not supported in whatsapp-web.js
            supportsReactions: false // Limited support
        };
    }

    getConnectionStatus() {
        this.connectionStatus.connectionUptime = this.connectionStatus.startTime ?
            Date.now() - this.connectionStatus.startTime : 0;

        return { ...this.connectionStatus };
    }

    async performHealthCheck() {
        try {
            if (!this.client) {
                throw new Error('Client not initialized');
            }

            const info = await this.client.getWWebVersion();

            return {
                status: 'healthy',
                version: info,
                timestamp: Date.now(),
                isReady: this.isReady,
                isAuthenticated: this.isAuthenticated
            };
        } catch (error) {
            throw new Error(`WhatsApp health check failed: ${error.message}`);
        }
    }

    setupInternalEventHandlers() {
        this.client.on('qr', (qr) => {
            if (this.config.qrCodeInTerminal) {
                logger.info('📱 QR Code received:');
                qrcode.generate(qr, { small: true });
            }

            this.eventHandlers.qrCode.forEach(handler => {
                try {
                    handler(qr);
                } catch (error) {
                    logger.error('Error in QR code handler:', error);
                }
            });
        });

        this.client.on('authenticated', () => {
            this.isAuthenticated = true;
            this.connectionStatus.authenticated = true;
            logger.info('📱 WhatsApp authenticated');

            this.eventHandlers.authenticated.forEach(handler => {
                try {
                    handler();
                } catch (error) {
                    logger.error('Error in authenticated handler:', error);
                }
            });
        });

        this.client.on('ready', () => {
            this.isReady = true;
            this.connectionStatus.connected = true;
            this.connectionStatus.ready = true;
            logger.info('📱 WhatsApp ready');

            this.eventHandlers.ready.forEach(handler => {
                try {
                    handler();
                } catch (error) {
                    logger.error('Error in ready handler:', error);
                }
            });
        });

        this.client.on('message', (message) => {
            this.connectionStatus.lastActivity = Date.now();

            this.eventHandlers.message.forEach(handler => {
                try {
                    handler(message);
                } catch (error) {
                    logger.error('Error in message handler:', error);
                }
            });
        });

        this.client.on('message_create', (message) => {
            this.connectionStatus.lastActivity = Date.now();

            this.eventHandlers.messageCreate.forEach(handler => {
                try {
                    handler(message);
                } catch (error) {
                    logger.error('Error in message_create handler:', error);
                }
            });
        });

        this.client.on('disconnected', (reason) => {
            this.isReady = false;
            this.isAuthenticated = false;
            this.connectionStatus.connected = false;
            this.connectionStatus.authenticated = false;
            this.connectionStatus.ready = false;

            logger.warn(`📱 WhatsApp disconnected: ${reason}`);

            this.eventHandlers.disconnected.forEach(handler => {
                try {
                    handler(reason);
                } catch (error) {
                    logger.error('Error in disconnected handler:', error);
                }
            });
        });

        this.client.on('auth_failure', (message) => {
            logger.error('📱 WhatsApp authentication failure:', message);
        });
    }

    generateVCard(contactData) {
        return `BEGIN:VCARD
VERSION:3.0
FN:${contactData.name}
TEL:${contactData.phone}
EMAIL:${contactData.email || ''}
END:VCARD`;
    }
}

module.exports = WhatsAppAdapter;
