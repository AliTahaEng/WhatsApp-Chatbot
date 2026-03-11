/**
 * Message Handler
 * Handles WhatsApp message processing and routing to AI agents
 * 
 * This is the core message processing component that:
 * - Validates incoming messages
 * - Applies limitation checks
 * - Routes messages to Python AI agents
 * - Handles responses and logging
 */

const logger = require('../utils/logger');

class MessageHandler {
    constructor(client, database, pythonBridge, limitationService, metricsService) {
        this.client = client;
        this.db = database;
        this.pythonBridge = pythonBridge;
        this.limitationService = limitationService;
        this.metricsService = metricsService;
    }

    async processMessage(message) {
        const startTime = Date.now();
        let agentName = null;
        let tokensUsed = 0;
        let success = false;

        try {
            // Extract message metadata
            const messageData = await this.extractMessageData(message);
            
            // Log incoming message
            await this.db.saveMessage(
                messageData.contactId,
                'user',
                messageData.body,
                null,
                0,
                messageData.type,
                messageData.mediaUrl
            );

            // Apply limitation checks
            const limitationResult = await this.limitationService.checkLimitations(messageData);
            if (!limitationResult.allowed) {
                await this.handleLimitationViolation(message, limitationResult);
                return;
            }

            // Show typing indicator
            await this.showTypingIndicator(message.from);

            // Prepare context for AI agents
            const context = await this.prepareMessageContext(messageData);

            // Send to Python bridge for AI processing
            const aiResponse = await this.pythonBridge.sendMessage(messageData.body, context);

            if (aiResponse && aiResponse.response) {
                // Send response back to user
                await message.reply(aiResponse.response);

                // Log AI response
                await this.db.saveMessage(
                    messageData.contactId,
                    'assistant',
                    aiResponse.response,
                    aiResponse.agentName || 'unknown',
                    aiResponse.tokensUsed || 0,
                    'text'
                );

                agentName = aiResponse.agentName;
                tokensUsed = aiResponse.tokensUsed || 0;
                success = true;

                // Update rate limiting counters
                await this.limitationService.incrementRateLimit(messageData.contactId, tokensUsed);

                // Log usage statistics
                await this.db.logUsage(
                    messageData.contactId,
                    tokensUsed,
                    this.calculateCost(tokensUsed),
                    agentName
                );

                logger.info(`✅ Message processed successfully for ${messageData.contactId} by ${agentName}`);

            } else {
                throw new Error('Invalid response from AI agents');
            }

        } catch (error) {
            logger.error('❌ Error processing message:', error);
            
            // Send error response to user
            await this.sendErrorResponse(message, error);
            
            // Log error
            await this.db.logSystemEvent(
                'error',
                'message_handler',
                `Failed to process message: ${error.message}`,
                {
                    contactId: message.from,
                    messageBody: message.body.substring(0, 200),
                    error: error.stack
                }
            );

        } finally {
            // Record metrics
            const responseTime = Date.now() - startTime;
            this.metricsService.recordMessage(
                message.from,
                agentName || 'error',
                responseTime,
                success
            );

            // Remove typing indicator
            await this.clearTypingIndicator(message.from);
        }
    }

    async extractMessageData(message) {
        try {
            const contact = await message.getContact();
            const chat = await message.getChat();

            const messageData = {
                contactId: message.from,
                phoneNumber: contact.number,
                name: contact.name || contact.pushname || 'Unknown',
                body: message.body || '',
                type: message.type,
                timestamp: new Date(message.timestamp * 1000),
                isGroup: chat.isGroup,
                groupName: chat.isGroup ? chat.name : null,
                hasMedia: message.hasMedia,
                mediaUrl: null,
                quotedMessage: null
            };

            // Handle media messages
            if (message.hasMedia) {
                try {
                    const media = await message.downloadMedia();
                    if (media) {
                        messageData.mediaUrl = `data:${media.mimetype};base64,${media.data}`;
                        messageData.body = message.body || `[${message.type.toUpperCase()} MESSAGE]`;
                    }
                } catch (mediaError) {
                    logger.warn('⚠️ Failed to download media:', mediaError);
                    messageData.body = `[${message.type.toUpperCase()} MESSAGE - Download failed]`;
                }
            }

            // Handle quoted messages
            if (message.hasQuotedMsg) {
                try {
                    const quotedMsg = await message.getQuotedMessage();
                    messageData.quotedMessage = {
                        body: quotedMsg.body,
                        from: quotedMsg.from,
                        type: quotedMsg.type
                    };
                } catch (quotedError) {
                    logger.warn('⚠️ Failed to get quoted message:', quotedError);
                }
            }

            return messageData;

        } catch (error) {
            logger.error('❌ Error extracting message data:', error);
            throw error;
        }
    }

    async prepareMessageContext(messageData) {
        try {
            const context = {
                contactId: messageData.contactId,
                contactName: messageData.name,
                phoneNumber: messageData.phoneNumber,
                messageType: messageData.type,
                timestamp: messageData.timestamp.toISOString(),
                isGroup: messageData.isGroup,
                groupName: messageData.groupName,
                hasMedia: messageData.hasMedia,
                quotedMessage: messageData.quotedMessage,
                
                // Add conversation history
                history: await this.db.getConversationHistory(
                    messageData.contactId,
                    parseInt(process.env.MAX_CONVERSATION_HISTORY) || 10
                ),

                // Add user profile data
                userProfile: await this.getUserProfile(messageData.contactId),

                // Add enabled agents
                enabledAgents: this.getEnabledAgents(),

                // Add current time and timezone info
                currentTime: new Date().toISOString(),
                timezone: process.env.BUSINESS_TIMEZONE || 'UTC'
            };

            return context;

        } catch (error) {
            logger.error('❌ Error preparing message context:', error);
            throw error;
        }
    }

    async getUserProfile(contactId) {
        try {
            const user = await this.db.getOrCreateUser(contactId);
            const usageStats = await this.db.getUsageStats(contactId, null, null);
            
            return {
                id: user.id,
                name: user.name,
                phoneNumber: user.phone_number,
                totalMessages: user.total_messages,
                lastInteraction: user.last_interaction,
                isBlacklisted: !!user.is_blacklisted,
                isWhitelisted: !!user.is_whitelisted,
                tags: user.tags ? JSON.parse(user.tags) : [],
                notes: user.notes,
                usageToday: this.getTodayUsage(usageStats)
            };

        } catch (error) {
            logger.error('❌ Error getting user profile:', error);
            return {
                name: 'Unknown',
                totalMessages: 0,
                isBlacklisted: false,
                isWhitelisted: false,
                tags: [],
                usageToday: { messages: 0, tokens: 0 }
            };
        }
    }

    getTodayUsage(usageStats) {
        const today = new Date().toISOString().split('T')[0];
        const todayStats = usageStats.find(stat => stat.date === today);
        
        return {
            messages: todayStats?.message_count || 0,
            tokens: todayStats?.tokens_used || 0,
            cost: todayStats?.cost_usd || 0
        };
    }

    getEnabledAgents() {
        const enabledAgents = [];
        
        if (global.agentStates) {
            Object.entries(global.agentStates).forEach(([agentName, enabled]) => {
                if (enabled) {
                    enabledAgents.push(agentName);
                }
            });
        }
        
        return enabledAgents.length > 0 ? enabledAgents : [
            'CustomerSupport', 'TechSupport', 'Research', 'Scheduler'
        ];
    }

    async handleLimitationViolation(message, limitationResult) {
        try {
            let responseMessage;

            switch (limitationResult.reason) {
                case 'blacklisted':
                    responseMessage = "I'm unable to assist you at this time.";
                    break;
                
                case 'not_whitelisted':
                    responseMessage = "This service is currently available to authorized users only.";
                    break;
                
                case 'rate_limit_exceeded':
                    const { windowType, resetTime } = limitationResult.data;
                    responseMessage = `You're sending messages too quickly. Please wait ${this.getResetTimeMessage(windowType, resetTime)} before sending another message.`;
                    break;
                
                case 'outside_business_hours':
                    const { businessHours, nextOpenTime } = limitationResult.data;
                    responseMessage = `Thanks for your message! Our business hours are ${businessHours}. We'll respond when we're back online.`;
                    break;
                
                case 'content_filtered':
                    responseMessage = "Your message contains content that cannot be processed. Please rephrase and try again.";
                    break;
                
                case 'spam_detected':
                    responseMessage = "Spam detected. Your account has been temporarily restricted.";
                    break;
                
                case 'token_limit_exceeded':
                    responseMessage = "You've reached your daily usage limit. Please try again tomorrow.";
                    break;
                
                default:
                    responseMessage = "I'm unable to process your message right now. Please try again later.";
            }

            // Send limitation response
            await message.reply(responseMessage);

            // Log the limitation event
            await this.db.logSystemEvent(
                'info',
                'limitation',
                `Message blocked: ${limitationResult.reason}`,
                {
                    contactId: message.from,
                    reason: limitationResult.reason,
                    details: limitationResult.data
                }
            );

            logger.info(`🚫 Message blocked from ${message.from}: ${limitationResult.reason}`);

        } catch (error) {
            logger.error('❌ Error handling limitation violation:', error);
        }
    }

    async sendErrorResponse(message, error) {
        try {
            let errorMessage;

            // Determine error type and provide appropriate response
            if (error.message.includes('timeout')) {
                errorMessage = "I'm taking a bit longer to respond. Please give me a moment and try again.";
            } else if (error.message.includes('rate limit')) {
                errorMessage = "I'm experiencing high demand right now. Please try again in a few minutes.";
            } else if (error.message.includes('network')) {
                errorMessage = "I'm having connectivity issues. Please try again shortly.";
            } else {
                errorMessage = "I apologize, but I encountered an error processing your message. Please try again in a moment.";
            }

            await message.reply(errorMessage);

        } catch (replyError) {
            logger.error('❌ Failed to send error response:', replyError);
        }
    }

    async showTypingIndicator(contactId) {
        try {
            const chat = await this.client.getChatById(contactId);
            await chat.sendStateTyping();
        } catch (error) {
            logger.debug('⚠️ Failed to show typing indicator:', error);
        }
    }

    async clearTypingIndicator(contactId) {
        try {
            const chat = await this.client.getChatById(contactId);
            await chat.clearState();
        } catch (error) {
            logger.debug('⚠️ Failed to clear typing indicator:', error);
        }
    }

    getResetTimeMessage(windowType, resetTime) {
        switch (windowType) {
            case 'minute':
                return 'a minute';
            case 'hour':
                return 'an hour';
            case 'day':
                return 'until tomorrow';
            default:
                return 'a moment';
        }
    }

    calculateCost(tokensUsed) {
        // Claude Sonnet 4 pricing: $3/M input + $15/M output
        // Rough estimate: 70% input, 30% output
        const inputTokens = Math.floor(tokensUsed * 0.7);
        const outputTokens = Math.floor(tokensUsed * 0.3);
        
        const inputCost = (inputTokens / 1000000) * 3.00;
        const outputCost = (outputTokens / 1000000) * 15.00;
        
        return inputCost + outputCost;
    }

    // Utility method for sending messages with retry logic
    async sendMessageWithRetry(contactId, message, retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                await this.client.sendMessage(contactId, message);
                return true;
            } catch (error) {
                logger.warn(`⚠️ Send attempt ${attempt} failed:`, error);
                
                if (attempt === retries) {
                    throw error;
                }
                
                // Wait before retry (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
        return false;
    }

    // Utility method for checking if message should be processed
    shouldProcessMessage(message, messageData) {
        // Skip empty messages
        if (!messageData.body.trim() && !messageData.hasMedia) {
            return false;
        }

        // Skip group messages if disabled
        if (messageData.isGroup && process.env.ENABLE_GROUP_CHATS !== 'true') {
            return false;
        }

        // Skip certain message types if not supported
        const unsupportedTypes = ['location', 'contact_card', 'poll'];
        if (unsupportedTypes.includes(messageData.type) && process.env.ENABLE_ALL_MESSAGE_TYPES !== 'true') {
            return false;
        }

        return true;
    }

    // Get handler statistics
    getHandlerStats() {
        return this.metricsService.getStats();
    }
}

module.exports = MessageHandler;
