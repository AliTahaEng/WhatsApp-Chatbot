/**
 * Limitation Service
 * Comprehensive limitation and access control system
 * 
 * Handles:
 * - Rate limiting (per contact, per time window)
 * - Blacklist/Whitelist management
 * - Business hours enforcement
 * - Content filtering
 * - Spam detection
 * - Token usage limits
 */

const logger = require('../utils/logger');

class LimitationService {
    constructor(database) {
        this.db = database;
        
        // Load configuration from environment
        this.config = {
            rateLimit: {
                enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
                messagesPerMinute: parseInt(process.env.MAX_MESSAGES_PER_MINUTE) || 5,
                messagesPerHour: parseInt(process.env.MAX_MESSAGES_PER_HOUR) || 50,
                messagesPerDay: parseInt(process.env.MAX_MESSAGES_PER_DAY) || 200,
                tokensPerContact: parseInt(process.env.MAX_TOKENS_PER_CONTACT) || 10000,
                tokensPerDay: parseInt(process.env.MAX_TOKENS_PER_DAY) || 50000,
                minSecondsBetweenMessages: 3
            },
            
            businessHours: {
                enabled: process.env.BUSINESS_HOURS_ENABLED === 'true',
                timezone: process.env.BUSINESS_TIMEZONE || 'UTC',
                schedule: {
                    monday: { start: '09:00', end: '17:00', enabled: true },
                    tuesday: { start: '09:00', end: '17:00', enabled: true },
                    wednesday: { start: '09:00', end: '17:00', enabled: true },
                    thursday: { start: '09:00', end: '17:00', enabled: true },
                    friday: { start: '09:00', end: '17:00', enabled: true },
                    saturday: { start: '10:00', end: '14:00', enabled: false },
                    sunday: { start: '00:00', end: '00:00', enabled: false }
                },
                outsideHoursMessage: "Thanks for your message! Our business hours are Monday-Friday 9AM-5PM. We'll respond when we're back online."
            },
            
            contentFilter: {
                enabled: true,
                blockKeywords: ['spam', 'promotion', 'advertisement', 'sale', 'discount'],
                ignorePatterns: [
                    /^https?:\/\/bit\.ly/i,  // Short URLs
                    /\b(viagra|casino|lottery|winner)\b/i,  // Common spam
                    /\b\d{4}\s*\d{4}\s*\d{4}\s*\d{4}\b/,  // Credit card numbers
                ],
                minMessageLength: 1,
                maxMessageLength: 4000,
                requireTriggerWords: false,
                triggerWords: ['help', 'support', 'question', 'issue', 'problem']
            },
            
            spamDetection: {
                enabled: true,
                threshold: 10,  // messages in 1 minute
                similarMessageThreshold: 5,  // similar messages in 10 minutes
                autoBlock: true,
                blockDurationHours: 24
            }
        };

        // Cache for recent messages (for spam detection)
        this.recentMessages = new Map(); // contactId -> array of recent messages
        this.lastMessageTimes = new Map(); // contactId -> timestamp
        
        // Start cleanup timer
        this.startCleanupTimer();
    }

    async checkLimitations(messageData) {
        try {
            const { contactId, body, timestamp, type } = messageData;

            // 1. Check blacklist
            if (await this.isBlacklisted(contactId)) {
                return { allowed: false, reason: 'blacklisted' };
            }

            // 2. Check whitelist (if whitelist-only mode is enabled)
            if (await this.isWhitelistOnly()) {
                const whitelistResult = await this.db.isWhitelisted(contactId);
                if (!whitelistResult.whitelisted) {
                    return { allowed: false, reason: 'not_whitelisted' };
                }
            }

            // 3. Check business hours
            if (this.config.businessHours.enabled) {
                const businessHoursCheck = this.isWithinBusinessHours();
                if (!businessHoursCheck.withinHours) {
                    return {
                        allowed: false,
                        reason: 'outside_business_hours',
                        data: {
                            businessHours: this.getBusinessHoursString(),
                            nextOpenTime: businessHoursCheck.nextOpenTime
                        }
                    };
                }
            }

            // 4. Check content filters
            const contentCheck = this.checkContent(body, type);
            if (!contentCheck.allowed) {
                return {
                    allowed: false,
                    reason: 'content_filtered',
                    data: contentCheck
                };
            }

            // 5. Check spam detection
            const spamCheck = await this.checkSpam(contactId, body, timestamp);
            if (!spamCheck.allowed) {
                // Auto-block if enabled
                if (this.config.spamDetection.autoBlock) {
                    await this.db.addToBlacklist(
                        contactId,
                        'Automatic spam detection',
                        'system',
                        this.config.spamDetection.blockDurationHours
                    );
                }
                return {
                    allowed: false,
                    reason: 'spam_detected',
                    data: spamCheck
                };
            }

            // 6. Check rate limits
            if (this.config.rateLimit.enabled) {
                const rateLimitCheck = await this.checkRateLimits(contactId);
                if (!rateLimitCheck.allowed) {
                    return {
                        allowed: false,
                        reason: 'rate_limit_exceeded',
                        data: rateLimitCheck
                    };
                }
            }

            // 7. Check minimum time between messages
            const timeBetweenCheck = this.checkTimeBetweenMessages(contactId, timestamp);
            if (!timeBetweenCheck.allowed) {
                return {
                    allowed: false,
                    reason: 'too_frequent',
                    data: timeBetweenCheck
                };
            }

            // All checks passed
            return { allowed: true };

        } catch (error) {
            logger.error('❌ Error checking limitations:', error);
            // On error, default to allowing the message to avoid blocking legitimate users
            return { allowed: true };
        }
    }

    async isBlacklisted(contactId) {
        return await this.db.isBlacklisted(contactId);
    }

    async isWhitelistOnly() {
        // Check if whitelist-only mode is enabled via config
        const whitelistOnlyConfig = await this.db.getConfig('whitelist_only_mode', false);
        return whitelistOnlyConfig;
    }

    isWithinBusinessHours() {
        if (!this.config.businessHours.enabled) {
            return { withinHours: true };
        }

        try {
            const now = new Date();
            const timezone = this.config.businessHours.timezone;
            
            // Convert to business timezone
            const businessTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
            const dayName = businessTime.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
            
            const daySchedule = this.config.businessHours.schedule[dayName];
            
            if (!daySchedule || !daySchedule.enabled) {
                return { 
                    withinHours: false,
                    nextOpenTime: this.getNextOpenTime(businessTime)
                };
            }

            const currentTime = businessTime.getHours() * 100 + businessTime.getMinutes();
            const startTime = this.timeStringToMinutes(daySchedule.start);
            const endTime = this.timeStringToMinutes(daySchedule.end);

            const withinHours = currentTime >= startTime && currentTime <= endTime;
            
            return {
                withinHours,
                nextOpenTime: withinHours ? null : this.getNextOpenTime(businessTime)
            };

        } catch (error) {
            logger.error('❌ Error checking business hours:', error);
            return { withinHours: true }; // Default to allowing if error
        }
    }

    timeStringToMinutes(timeStr) {
        const [hours, minutes] = timeStr.split(':').map(Number);
        return hours * 100 + minutes;
    }

    getNextOpenTime(currentTime) {
        // Find next business day/time
        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const currentDay = currentTime.getDay();
        
        for (let i = 0; i < 7; i++) {
            const dayIndex = (currentDay + i) % 7;
            const dayName = days[dayIndex];
            const daySchedule = this.config.businessHours.schedule[dayName];
            
            if (daySchedule && daySchedule.enabled) {
                const nextOpen = new Date(currentTime);
                nextOpen.setDate(nextOpen.getDate() + i);
                const [hours, minutes] = daySchedule.start.split(':').map(Number);
                nextOpen.setHours(hours, minutes, 0, 0);
                
                if (nextOpen > currentTime) {
                    return nextOpen;
                }
            }
        }
        
        return null; // No business hours found (should not happen)
    }

    getBusinessHoursString() {
        const schedule = this.config.businessHours.schedule;
        const enabledDays = Object.entries(schedule)
            .filter(([day, config]) => config.enabled)
            .map(([day, config]) => `${day.charAt(0).toUpperCase() + day.slice(1)}: ${config.start}-${config.end}`)
            .join(', ');
        
        return enabledDays || 'Business hours not configured';
    }

    checkContent(message, messageType) {
        const config = this.config.contentFilter;
        
        if (!config.enabled) {
            return { allowed: true };
        }

        // Skip content checks for media messages (unless we implement media analysis)
        if (messageType !== 'chat' && messageType !== 'text') {
            return { allowed: true };
        }

        const messageLower = message.toLowerCase();

        // Check message length
        if (message.length < config.minMessageLength) {
            return {
                allowed: false,
                reason: 'message_too_short',
                details: `Message must be at least ${config.minMessageLength} characters`
            };
        }

        if (message.length > config.maxMessageLength) {
            return {
                allowed: false,
                reason: 'message_too_long',
                details: `Message must be less than ${config.maxMessageLength} characters`
            };
        }

        // Check blocked keywords
        for (const keyword of config.blockKeywords) {
            if (messageLower.includes(keyword.toLowerCase())) {
                return {
                    allowed: false,
                    reason: 'blocked_keyword',
                    details: `Message contains blocked keyword: ${keyword}`
                };
            }
        }

        // Check ignore patterns
        for (const pattern of config.ignorePatterns) {
            if (pattern.test(message)) {
                return {
                    allowed: false,
                    reason: 'blocked_pattern',
                    details: 'Message matches blocked pattern'
                };
            }
        }

        // Check trigger words (if required)
        if (config.requireTriggerWords) {
            const hasTrigger = config.triggerWords.some(word => 
                messageLower.includes(word.toLowerCase())
            );
            
            if (!hasTrigger) {
                return {
                    allowed: false,
                    reason: 'missing_trigger_word',
                    details: `Message must contain one of: ${config.triggerWords.join(', ')}`
                };
            }
        }

        return { allowed: true };
    }

    async checkSpam(contactId, message, timestamp) {
        const config = this.config.spamDetection;
        
        if (!config.enabled) {
            return { allowed: true };
        }

        const now = new Date(timestamp);

        // Initialize recent messages array if not exists
        if (!this.recentMessages.has(contactId)) {
            this.recentMessages.set(contactId, []);
        }

        const recentMessages = this.recentMessages.get(contactId);

        // Clean old messages (older than 10 minutes)
        const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
        const cleanedMessages = recentMessages.filter(msg => msg.timestamp > tenMinutesAgo);
        this.recentMessages.set(contactId, cleanedMessages);

        // Check message frequency (messages per minute)
        const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
        const recentCount = cleanedMessages.filter(msg => msg.timestamp > oneMinuteAgo).length;

        if (recentCount >= config.threshold) {
            return {
                allowed: false,
                reason: 'high_frequency',
                score: recentCount,
                threshold: config.threshold
            };
        }

        // Check for similar messages
        const similarCount = cleanedMessages.filter(msg => 
            this.calculateSimilarity(message, msg.content) > 0.8
        ).length;

        if (similarCount >= config.similarMessageThreshold) {
            return {
                allowed: false,
                reason: 'similar_messages',
                score: similarCount,
                threshold: config.similarMessageThreshold
            };
        }

        // Add current message to recent messages
        cleanedMessages.push({
            content: message,
            timestamp: now
        });

        return { allowed: true };
    }

    calculateSimilarity(str1, str2) {
        // Simple similarity calculation using Levenshtein distance
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;

        if (longer.length === 0) {
            return 1.0;
        }

        const distance = this.levenshteinDistance(longer, shorter);
        return (longer.length - distance) / longer.length;
    }

    levenshteinDistance(str1, str2) {
        const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

        for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
        for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

        for (let j = 1; j <= str2.length; j++) {
            for (let i = 1; i <= str1.length; i++) {
                const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j][i - 1] + 1,
                    matrix[j - 1][i] + 1,
                    matrix[j - 1][i - 1] + indicator
                );
            }
        }

        return matrix[str2.length][str1.length];
    }

    async checkRateLimits(contactId) {
        const config = this.config.rateLimit;

        // Check per-minute limit
        const minuteCheck = await this.db.checkRateLimit(contactId, 'minute', config.messagesPerMinute);
        if (!minuteCheck.allowed) {
            return {
                allowed: false,
                windowType: 'minute',
                current: minuteCheck.currentCount,
                max: config.messagesPerMinute,
                resetTime: this.getResetTime('minute')
            };
        }

        // Check per-hour limit
        const hourCheck = await this.db.checkRateLimit(contactId, 'hour', config.messagesPerHour);
        if (!hourCheck.allowed) {
            return {
                allowed: false,
                windowType: 'hour',
                current: hourCheck.currentCount,
                max: config.messagesPerHour,
                resetTime: this.getResetTime('hour')
            };
        }

        // Check per-day limit
        const dayCheck = await this.db.checkRateLimit(contactId, 'day', config.messagesPerDay);
        if (!dayCheck.allowed) {
            return {
                allowed: false,
                windowType: 'day',
                current: dayCheck.currentCount,
                max: config.messagesPerDay,
                resetTime: this.getResetTime('day')
            };
        }

        // Check token limits (if we have usage data)
        const today = new Date().toISOString().split('T')[0];
        const usageStats = await this.db.getUsageStats(contactId, today, today);
        
        if (usageStats.length > 0) {
            const todayUsage = usageStats[0];
            
            if (todayUsage.tokens_used >= config.tokensPerContact) {
                return {
                    allowed: false,
                    windowType: 'tokens',
                    current: todayUsage.tokens_used,
                    max: config.tokensPerContact,
                    resetTime: this.getResetTime('day')
                };
            }
        }

        return { allowed: true };
    }

    checkTimeBetweenMessages(contactId, timestamp) {
        const config = this.config.rateLimit;
        
        if (!this.lastMessageTimes.has(contactId)) {
            this.lastMessageTimes.set(contactId, timestamp);
            return { allowed: true };
        }

        const lastMessageTime = this.lastMessageTimes.get(contactId);
        const timeDiff = (timestamp - lastMessageTime) / 1000; // Convert to seconds

        if (timeDiff < config.minSecondsBetweenMessages) {
            return {
                allowed: false,
                reason: 'too_frequent',
                secondsSinceLastMessage: timeDiff,
                minSeconds: config.minSecondsBetweenMessages,
                waitTime: config.minSecondsBetweenMessages - timeDiff
            };
        }

        this.lastMessageTimes.set(contactId, timestamp);
        return { allowed: true };
    }

    async incrementRateLimit(contactId, tokensUsed = 0) {
        if (!this.config.rateLimit.enabled) {
            return;
        }

        try {
            await Promise.all([
                this.db.incrementRateLimit(contactId, 'minute', tokensUsed),
                this.db.incrementRateLimit(contactId, 'hour', tokensUsed),
                this.db.incrementRateLimit(contactId, 'day', tokensUsed)
            ]);
        } catch (error) {
            logger.error('❌ Error incrementing rate limit:', error);
        }
    }

    getResetTime(windowType) {
        const now = new Date();
        
        switch (windowType) {
            case 'minute':
                return new Date(now.getTime() + (60 - now.getSeconds()) * 1000);
            case 'hour':
                return new Date(now.getTime() + (60 - now.getMinutes()) * 60 * 1000);
            case 'day':
                const tomorrow = new Date(now);
                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(0, 0, 0, 0);
                return tomorrow;
            default:
                return new Date(now.getTime() + 60 * 1000); // Default to 1 minute
        }
    }

    startCleanupTimer() {
        // Clean up old data every 5 minutes
        setInterval(() => {
            this.cleanupOldData();
        }, 5 * 60 * 1000);
    }

    cleanupOldData() {
        const now = new Date();
        const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
        
        // Clean recent messages cache
        for (const [contactId, messages] of this.recentMessages.entries()) {
            const cleanedMessages = messages.filter(msg => msg.timestamp > tenMinutesAgo);
            if (cleanedMessages.length === 0) {
                this.recentMessages.delete(contactId);
            } else {
                this.recentMessages.set(contactId, cleanedMessages);
            }
        }

        // Clean last message times (older than 1 hour)
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        for (const [contactId, timestamp] of this.lastMessageTimes.entries()) {
            if (timestamp < oneHourAgo) {
                this.lastMessageTimes.delete(contactId);
            }
        }

        logger.debug('🧹 Limitation service cleanup completed');
    }

    // Update configuration dynamically
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        logger.info('⚙️ Limitation service configuration updated');
    }

    // Get current limitation statistics
    async getLimitationStats() {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        try {
            // Get blacklist count
            const blacklistCount = await this.db.executeQuerySingle(
                'SELECT COUNT(*) as count FROM blacklist WHERE is_active = 1'
            );

            // Get whitelist count
            const whitelistCount = await this.db.executeQuerySingle(
                'SELECT COUNT(*) as count FROM whitelist'
            );

            // Get today's rate limit violations
            const rateLimitViolations = await this.db.executeQuerySingle(
                `SELECT COUNT(*) as count FROM system_logs 
                 WHERE component = 'limitation' 
                 AND message LIKE '%rate_limit%' 
                 AND timestamp >= ?`,
                [todayStart.toISOString()]
            );

            // Get spam detections
            const spamDetections = await this.db.executeQuerySingle(
                `SELECT COUNT(*) as count FROM system_logs 
                 WHERE component = 'limitation' 
                 AND message LIKE '%spam%' 
                 AND timestamp >= ?`,
                [todayStart.toISOString()]
            );

            return {
                blacklistedContacts: blacklistCount.count,
                whitelistedContacts: whitelistCount.count,
                rateLimitViolationsToday: rateLimitViolations.count,
                spamDetectionsToday: spamDetections.count,
                cacheSize: {
                    recentMessages: this.recentMessages.size,
                    lastMessageTimes: this.lastMessageTimes.size
                },
                config: this.config
            };

        } catch (error) {
            logger.error('❌ Error getting limitation stats:', error);
            return null;
        }
    }
}

module.exports = LimitationService;
