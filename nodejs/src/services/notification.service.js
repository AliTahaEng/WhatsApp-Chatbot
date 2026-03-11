/**
 * Notification Service
 * Proactive monitoring and alert system for WhatsApp AutoGen Bot
 * 
 * Sends notifications to admin about:
 * - System events (startup, shutdown, errors)
 * - High volume activity
 * - Performance issues
 * - Manual mode messages
 * - Cost alerts
 */

const logger = require('../utils/logger');

class NotificationService {
    constructor(database) {
        this.db = database;
        this.adminNumbers = (process.env.ADMIN_WHATSAPP_ID || '').split(',').filter(id => id.trim());
        this.notificationsEnabled = process.env.ENABLE_NOTIFICATIONS !== 'false';
        
        // Rate limiting to prevent notification spam
        this.notificationCounts = new Map(); // type -> count
        this.lastNotificationTimes = new Map(); // type -> timestamp
        this.rateLimits = {
            error: { maxPerHour: 10, cooldownMinutes: 5 },
            warning: { maxPerHour: 20, cooldownMinutes: 2 },
            info: { maxPerHour: 50, cooldownMinutes: 1 },
            critical: { maxPerHour: 100, cooldownMinutes: 0 }
        };
        
        // Message templates
        this.templates = {
            startup: '🟢 *Bot Started*\n\nThe WhatsApp AutoGen Bot is now online and ready to assist!\n\n📱 Phone: {phone}\n🕐 Time: {time}\n⚡ Platform: {platform}',
            
            shutdown: '🔴 *Bot Shutdown*\n\nThe WhatsApp AutoGen Bot is shutting down.\n\n🕐 Time: {time}\n📊 Session Stats:\n• Messages: {messages}\n• Uptime: {uptime}',
            
            error: '⚠️ *Error Alert*\n\n❌ Component: {component}\n📝 Error: {error}\n🕐 Time: {time}\n\n{details}',
            
            highVolume: '📈 *High Volume Alert*\n\n📊 Current activity:\n• Messages/hour: {messagesPerHour}\n• Active users: {activeUsers}\n• Response time: {avgResponseTime}ms\n\n🕐 Time: {time}',
            
            costAlert: '💰 *Cost Alert*\n\n💸 Daily cost: ${dailyCost}\n📊 Total cost: ${totalCost}\n🎯 Tokens used: {tokens}\n\n🕐 Time: {time}',
            
            manualMode: '👤 *Manual Mode Message*\n\n📱 Contact: {contactName}\n💬 Message: {message}\n🔧 Override: {overrideType}\n\n🕐 Time: {time}',
            
            qrCode: '📱 *QR Code Ready*\n\nPlease scan the QR code displayed in the terminal to authenticate WhatsApp.\n\n🕐 Time: {time}',
            
            disconnection: '🔌 *WhatsApp Disconnected*\n\n⚠️ Reason: {reason}\n🔄 Auto-reconnect: Enabled\n🕐 Time: {time}',
            
            rateLimit: '⏱️ *Rate Limit Warning*\n\n🚫 Contact: {contact}\n📊 Limit: {limit}\n📈 Current: {current}\n🕐 Time: {time}'
        };
        
        this.setupCleanupTimer();
    }

    async notifyStartup(details = {}) {
        await this.sendNotification('info', 'startup', {
            phone: details.phone || 'Unknown',
            platform: details.platform || 'Unknown',
            time: new Date().toLocaleString()
        });
    }

    async notifyShutdown(signal = 'SIGTERM') {
        const uptime = this.formatUptime(process.uptime() * 1000);
        
        await this.sendNotification('info', 'shutdown', {
            signal,
            time: new Date().toLocaleString(),
            uptime,
            messages: 'N/A' // Could be enhanced with actual stats
        });
    }

    async notifyError(error, context = {}) {
        const errorDetails = {
            component: context.component || 'unknown',
            error: error.message || String(error),
            time: new Date().toLocaleString(),
            details: this.formatErrorDetails(context)
        };

        await this.sendNotification('error', 'error', errorDetails);
        
        // Log to database
        await this.logNotification('error', 'Error Alert', error.message, errorDetails);
    }

    async notifyHighVolume(stats) {
        const details = {
            messagesPerHour: stats.messagesPerHour || 0,
            activeUsers: stats.activeUsers || 0,
            avgResponseTime: stats.avgResponseTime || 0,
            time: new Date().toLocaleString()
        };

        await this.sendNotification('warning', 'highVolume', details);
        
        await this.logNotification('warning', 'High Volume Alert', 
            `${details.messagesPerHour} messages/hour`, details);
    }

    async notifyCostAlert(costData) {
        const details = {
            dailyCost: costData.dailyCost?.toFixed(4) || '0.0000',
            totalCost: costData.totalCost?.toFixed(4) || '0.0000',
            tokens: costData.tokens || 0,
            time: new Date().toLocaleString()
        };

        await this.sendNotification('warning', 'costAlert', details);
        
        await this.logNotification('warning', 'Cost Alert', 
            `Daily: $${details.dailyCost}`, details);
    }

    async notifyManualModeMessage(messageData) {
        const details = {
            contactName: messageData.contactName || 'Unknown',
            message: this.truncateMessage(messageData.message || '', 100),
            overrideType: messageData.overrideType || 'unknown',
            time: new Date().toLocaleString()
        };

        await this.sendNotification('info', 'manualMode', details);
        
        await this.logNotification('info', 'Manual Mode Message', 
            `From: ${details.contactName}`, details);
    }

    async notifyQRCode() {
        await this.sendNotification('info', 'qrCode', {
            time: new Date().toLocaleString()
        });
    }

    async notifyDisconnection(reason) {
        await this.sendNotification('warning', 'disconnection', {
            reason: reason || 'Unknown',
            time: new Date().toLocaleString()
        });
        
        await this.logNotification('warning', 'WhatsApp Disconnected', reason);
    }

    async notifyRateLimit(details) {
        const notificationData = {
            contact: this.anonymizeContact(details.contactId),
            limit: details.limit || 'Unknown',
            current: details.current || 0,
            time: new Date().toLocaleString()
        };

        await this.sendNotification('warning', 'rateLimit', notificationData);
    }

    async sendNotification(severity, type, data) {
        if (!this.notificationsEnabled || this.adminNumbers.length === 0) {
            logger.debug(`Notification skipped (${type}): notifications disabled or no admin numbers`);
            return;
        }

        try {
            // Check rate limits
            if (!this.checkRateLimit(severity, type)) {
                logger.debug(`Notification rate limited: ${type}`);
                return;
            }

            // Get message template
            const template = this.templates[type];
            if (!template) {
                logger.warn(`No template found for notification type: ${type}`);
                return;
            }

            // Format message
            const message = this.formatTemplate(template, data);

            // Send to all admin numbers
            for (const adminNumber of this.adminNumbers) {
                try {
                    // In a real implementation, this would use the WhatsApp client
                    // For now, we'll log the notification
                    logger.info(`📬 NOTIFICATION to ${adminNumber}: ${message}`);
                    
                    // Store notification in database
                    await this.logNotification(severity, type, message, data, adminNumber);
                    
                } catch (error) {
                    logger.error(`Failed to send notification to ${adminNumber}:`, error);
                }
            }

            // Update rate limiting counters
            this.updateRateLimitCounters(severity, type);

        } catch (error) {
            logger.error('Error sending notification:', error);
        }
    }

    checkRateLimit(severity, type) {
        const now = Date.now();
        const limits = this.rateLimits[severity];
        
        if (!limits) {
            return true; // No limits defined
        }

        // Check cooldown period
        const lastTime = this.lastNotificationTimes.get(type);
        if (lastTime) {
            const timeSinceLastNotification = now - lastTime;
            const cooldownMs = limits.cooldownMinutes * 60 * 1000;
            
            if (timeSinceLastNotification < cooldownMs) {
                return false; // Still in cooldown
            }
        }

        // Check hourly limit
        const currentHour = Math.floor(now / (60 * 60 * 1000));
        const countKey = `${type}_${currentHour}`;
        const currentCount = this.notificationCounts.get(countKey) || 0;
        
        if (currentCount >= limits.maxPerHour) {
            return false; // Hourly limit exceeded
        }

        return true;
    }

    updateRateLimitCounters(severity, type) {
        const now = Date.now();
        const currentHour = Math.floor(now / (60 * 60 * 1000));
        const countKey = `${type}_${currentHour}`;
        
        // Update count
        const currentCount = this.notificationCounts.get(countKey) || 0;
        this.notificationCounts.set(countKey, currentCount + 1);
        
        // Update last notification time
        this.lastNotificationTimes.set(type, now);
    }

    formatTemplate(template, data) {
        let formatted = template;
        
        for (const [key, value] of Object.entries(data)) {
            const placeholder = `{${key}}`;
            formatted = formatted.replace(new RegExp(placeholder, 'g'), value);
        }
        
        return formatted;
    }

    formatErrorDetails(context) {
        const details = [];
        
        if (context.file) details.push(`📄 File: ${context.file}`);
        if (context.function) details.push(`⚙️ Function: ${context.function}`);
        if (context.contactId) details.push(`👤 Contact: ${this.anonymizeContact(context.contactId)}`);
        if (context.messageBody) details.push(`💬 Message: ${this.truncateMessage(context.messageBody, 50)}`);
        
        return details.length > 0 ? details.join('\n') : 'No additional details';
    }

    truncateMessage(message, maxLength) {
        if (!message) return '';
        if (message.length <= maxLength) return message;
        return message.substring(0, maxLength) + '...';
    }

    anonymizeContact(contactId) {
        if (!contactId) return 'Unknown';
        return contactId.substring(0, 6) + '***';
    }

    formatUptime(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) {
            return `${days}d ${hours % 24}h ${minutes % 60}m`;
        } else if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    async logNotification(severity, type, message, data = {}, sentTo = null) {
        try {
            await this.db.executeRun(
                `INSERT INTO notifications (notification_type, title, message, severity, sent_to, metadata)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    type,
                    `${severity.toUpperCase()}: ${type}`,
                    message,
                    severity,
                    sentTo,
                    JSON.stringify(data)
                ]
            );
        } catch (error) {
            logger.error('Failed to log notification to database:', error);
        }
    }

    async getNotificationHistory(limit = 50, severity = null) {
        try {
            let sql = 'SELECT * FROM notifications';
            const params = [];

            if (severity) {
                sql += ' WHERE severity = ?';
                params.push(severity);
            }

            sql += ' ORDER BY sent_at DESC LIMIT ?';
            params.push(limit);

            return await this.db.executeQuery(sql, params);
        } catch (error) {
            logger.error('Failed to get notification history:', error);
            return [];
        }
    }

    async getNotificationStats(days = 7) {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const stats = await this.db.executeQuery(
                `SELECT 
                    notification_type,
                    severity,
                    COUNT(*) as count,
                    DATE(sent_at) as date
                 FROM notifications 
                 WHERE sent_at >= ?
                 GROUP BY notification_type, severity, DATE(sent_at)
                 ORDER BY sent_at DESC`,
                [startDate.toISOString()]
            );

            // Aggregate stats
            const summary = {
                totalNotifications: 0,
                bySeverity: {},
                byType: {},
                dailyBreakdown: {}
            };

            for (const stat of stats) {
                summary.totalNotifications += stat.count;
                summary.bySeverity[stat.severity] = (summary.bySeverity[stat.severity] || 0) + stat.count;
                summary.byType[stat.notification_type] = (summary.byType[stat.notification_type] || 0) + stat.count;
                summary.dailyBreakdown[stat.date] = (summary.dailyBreakdown[stat.date] || 0) + stat.count;
            }

            return summary;
        } catch (error) {
            logger.error('Failed to get notification stats:', error);
            return null;
        }
    }

    setupCleanupTimer() {
        // Clean up old rate limiting data every hour
        setInterval(() => {
            this.cleanupRateLimitData();
        }, 60 * 60 * 1000);

        // Clean up old notifications from database daily
        setInterval(() => {
            this.cleanupOldNotifications();
        }, 24 * 60 * 60 * 1000);

        logger.info('📬 Notification service cleanup timers started');
    }

    cleanupRateLimitData() {
        const now = Date.now();
        const currentHour = Math.floor(now / (60 * 60 * 1000));
        
        // Remove old hourly counters
        for (const [key] of this.notificationCounts.entries()) {
            const keyParts = key.split('_');
            const hour = parseInt(keyParts[keyParts.length - 1]);
            
            if (hour < currentHour - 24) { // Keep last 24 hours
                this.notificationCounts.delete(key);
            }
        }

        // Remove old last notification times (older than 1 day)
        const oneDayAgo = now - (24 * 60 * 60 * 1000);
        for (const [type, timestamp] of this.lastNotificationTimes.entries()) {
            if (timestamp < oneDayAgo) {
                this.lastNotificationTimes.delete(type);
            }
        }

        logger.debug('🧹 Notification rate limit data cleaned up');
    }

    async cleanupOldNotifications(daysToKeep = 30) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

            const result = await this.db.executeRun(
                'DELETE FROM notifications WHERE sent_at < ?',
                [cutoffDate.toISOString()]
            );

            if (result.changes > 0) {
                logger.info(`🗑️ Cleaned up ${result.changes} old notifications`);
            }
        } catch (error) {
            logger.error('Failed to cleanup old notifications:', error);
        }
    }

    // Update configuration
    updateConfig(config) {
        if (config.enabled !== undefined) {
            this.notificationsEnabled = config.enabled;
        }
        
        if (config.adminNumbers) {
            this.adminNumbers = config.adminNumbers.filter(num => num.trim());
        }
        
        if (config.rateLimits) {
            this.rateLimits = { ...this.rateLimits, ...config.rateLimits };
        }

        logger.info('📬 Notification service configuration updated');
    }

    // Get current configuration
    getConfig() {
        return {
            enabled: this.notificationsEnabled,
            adminNumbers: this.adminNumbers.length,
            rateLimits: this.rateLimits,
            activeCounters: this.notificationCounts.size,
            lastNotifications: Object.fromEntries(this.lastNotificationTimes)
        };
    }

    // Test notification system
    async testNotification() {
        await this.sendNotification('info', 'startup', {
            phone: 'TEST',
            platform: 'Test Platform',
            time: new Date().toLocaleString()
        });
        
        return true;
    }
}

module.exports = NotificationService;
