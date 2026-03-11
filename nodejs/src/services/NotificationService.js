/**
 * Notification Service - Modern Architecture
 * Handles system notifications and alerts using DI
 */

class NotificationService {
    constructor(container) {
        this.container = container;
        this.config = container.resolve('ConfigurationManager');
        this.database = container.resolve('IDatabase');
        this.messageProvider = container.resolve('IMessageProvider');
        
        this.adminWhatsAppId = this.config.get('admin.whatsappId');
        this.isEnabled = this.config.get('notifications.enabled', true);
        
        this.notificationQueue = [];
        this.rateLimits = new Map();
        
        console.log(`🔔 Notification Service initialized (enabled: ${this.isEnabled})`);
    }

    async start() {
        if (!this.isEnabled || !this.adminWhatsAppId) {
            console.log('⏭️ Notification Service disabled or no admin WhatsApp ID');
            return;
        }

        // Start notification processing
        this.startNotificationProcessor();
        
        console.log('✅ Notification Service started');
    }

    async stop() {
        if (this.notificationInterval) {
            clearInterval(this.notificationInterval);
        }
        console.log('✅ Notification Service stopped');
    }

    startNotificationProcessor() {
        // Process notifications every 30 seconds
        this.notificationInterval = setInterval(async () => {
            await this.processNotificationQueue();
        }, 30000);
    }

    async processNotificationQueue() {
        if (this.notificationQueue.length === 0) return;

        const notifications = [...this.notificationQueue];
        this.notificationQueue = [];

        for (const notification of notifications) {
            try {
                await this.sendNotification(notification);
            } catch (error) {
                console.error('❌ Error sending notification:', error);
            }
        }
    }

    async sendNotification(notification) {
        if (!this.adminWhatsAppId) return;

        // Check rate limits
        if (this.isRateLimited(notification.type)) {
            return;
        }

        const message = this.formatNotification(notification);
        
        try {
            await this.messageProvider.sendMessage(this.adminWhatsAppId, message);
            
            // Update rate limit
            this.updateRateLimit(notification.type);
            
            // Log notification
            await this.logNotification(notification);
            
            console.log(`🔔 Sent ${notification.type} notification to admin`);
            
        } catch (error) {
            console.error('❌ Failed to send notification:', error);
            throw error;
        }
    }

    formatNotification(notification) {
        const timestamp = new Date().toLocaleTimeString();
        
        let icon = '🔔';
        switch (notification.type) {
            case 'error': icon = '❌'; break;
            case 'warning': icon = '⚠️'; break;
            case 'info': icon = 'ℹ️'; break;
            case 'success': icon = '✅'; break;
            case 'security': icon = '🔐'; break;
            case 'system': icon = '⚙️'; break;
        }

        let message = `${icon} *${notification.title}*\n\n`;
        message += `${notification.message}\n\n`;
        
        if (notification.details) {
            message += `*Details:*\n${notification.details}\n\n`;
        }
        
        message += `🕒 ${timestamp}`;
        
        return message;
    }

    isRateLimited(type) {
        const now = Date.now();
        const limits = {
            error: 5 * 60 * 1000,    // 5 minutes
            warning: 10 * 60 * 1000, // 10 minutes
            info: 30 * 60 * 1000,    // 30 minutes
            system: 60 * 60 * 1000   // 1 hour
        };

        const limit = limits[type] || limits.info;
        const lastSent = this.rateLimits.get(type) || 0;
        
        return (now - lastSent) < limit;
    }

    updateRateLimit(type) {
        this.rateLimits.set(type, Date.now());
    }

    async logNotification(notification) {
        try {
            await this.database.executeRun(`
                INSERT INTO admin_notifications (
                    type,
                    title,
                    message,
                    details,
                    sent_at,
                    recipient
                ) VALUES (?, ?, ?, ?, ?, ?)
            `, [
                notification.type,
                notification.title,
                notification.message,
                notification.details || null,
                new Date().toISOString(),
                this.adminWhatsAppId
            ]);
        } catch (error) {
            // Ignore if table doesn't exist
            console.debug('Admin notifications table may not exist yet');
        }
    }

    // Public methods for sending different types of notifications

    async notifyError(title, message, details = null) {
        this.queueNotification({
            type: 'error',
            title,
            message,
            details,
            priority: 'high'
        });
    }

    async notifyWarning(title, message, details = null) {
        this.queueNotification({
            type: 'warning',
            title,
            message,
            details,
            priority: 'medium'
        });
    }

    async notifyInfo(title, message, details = null) {
        this.queueNotification({
            type: 'info',
            title,
            message,
            details,
            priority: 'low'
        });
    }

    async notifySuccess(title, message, details = null) {
        this.queueNotification({
            type: 'success',
            title,
            message,
            details,
            priority: 'low'
        });
    }

    async notifySecurity(title, message, details = null) {
        this.queueNotification({
            type: 'security',
            title,
            message,
            details,
            priority: 'high'
        });
    }

    async notifySystem(title, message, details = null) {
        this.queueNotification({
            type: 'system',
            title,
            message,
            details,
            priority: 'medium'
        });
    }

    queueNotification(notification) {
        if (!this.isEnabled) return;
        
        notification.timestamp = Date.now();
        this.notificationQueue.push(notification);
        
        console.log(`📥 Queued ${notification.type} notification: ${notification.title}`);
    }

    // Specific system event handlers

    async onNewUser(user) {
        await this.notifyInfo(
            'New User Registered',
            `A new user has joined the system: ${user.name || 'Unknown'}`,
            `WhatsApp ID: ${user.whatsapp_id}\nJoined: ${new Date().toLocaleString()}`
        );
    }

    async onSystemError(error, context = {}) {
        await this.notifyError(
            'System Error',
            `An error occurred in the system: ${error.message}`,
            `Context: ${JSON.stringify(context)}\nStack: ${error.stack?.substring(0, 200)}...`
        );
    }

    async onHighVolume(messageCount, timeWindow) {
        await this.notifyWarning(
            'High Message Volume',
            `Received ${messageCount} messages in ${timeWindow} minutes`,
            'Consider checking for spam or unusual activity'
        );
    }

    async onSpamDetected(contactId, reason) {
        await this.notifySecurity(
            'Potential Spam Detected',
            `Suspicious activity from user: ${contactId}`,
            `Reason: ${reason}\nTime: ${new Date().toLocaleString()}`
        );
    }

    async onSystemStartup() {
        await this.notifySystem(
            'System Started',
            'WhatsApp Bot system has started successfully',
            `Startup time: ${new Date().toLocaleString()}`
        );
    }

    async onSystemShutdown() {
        await this.notifySystem(
            'System Shutdown',
            'WhatsApp Bot system is shutting down',
            `Shutdown time: ${new Date().toLocaleString()}`
        );
    }

    async onRateLimitExceeded(contactId, limit) {
        await this.notifyWarning(
            'Rate Limit Exceeded',
            `User exceeded rate limit: ${contactId}`,
            `Limit: ${limit} messages per hour\nTime: ${new Date().toLocaleString()}`
        );
    }

    async onDatabaseError(error) {
        await this.notifyError(
            'Database Error',
            `Database operation failed: ${error.message}`,
            `Time: ${new Date().toLocaleString()}\nError: ${error.toString()}`
        );
    }

    async onPythonBridgeError(error) {
        await this.notifyError(
            'Python Bridge Error',
            `Communication with Python agent failed: ${error.message}`,
            `Time: ${new Date().toLocaleString()}\nError: ${error.toString()}`
        );
    }

    // Daily summary report
    async sendDailySummary() {
        try {
            const stats = await this.getDailyStats();
            
            const message = `📊 *Daily Summary Report*

📅 *Date:* ${new Date().toLocaleDateString()}

👥 *Users:*
• Total: ${stats.totalUsers}
• New: ${stats.newUsers}
• Active: ${stats.activeUsers}

💬 *Messages:*
• Total: ${stats.totalMessages}
• Successful: ${stats.successfulMessages}
• Failed: ${stats.failedMessages}

⚡ *Performance:*
• Avg Response Time: ${stats.avgResponseTime}ms
• Success Rate: ${stats.successRate}%
• Uptime: ${stats.uptime}

🤖 *AI Usage:*
• Total Tokens: ${stats.totalTokens}
• Est. Cost: $${stats.estimatedCost}

${stats.alerts.length > 0 ? `⚠️ *Alerts:*\n${stats.alerts.join('\n')}` : '✅ No alerts today'}`;

            await this.sendNotification({
                type: 'info',
                title: 'Daily Summary',
                message: message
            });

        } catch (error) {
            console.error('❌ Error sending daily summary:', error);
        }
    }

    async getDailyStats() {
        const today = new Date().toISOString().split('T')[0];
        
        try {
            // Get message stats
            const messageStats = await this.database.executeQuery(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN success = 1 THEN 1 END) as successful,
                    COUNT(CASE WHEN success = 0 THEN 1 END) as failed,
                    AVG(response_time) as avg_response_time,
                    SUM(tokens_used) as total_tokens,
                    SUM(cost_estimate) as total_cost
                FROM usage_statistics 
                WHERE date = ?
            `, [today]);

            const userStats = await this.database.executeQuery(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN date(created_at) = ? THEN 1 END) as new_today,
                    COUNT(CASE WHEN date(last_interaction) = ? THEN 1 END) as active_today
                FROM users
            `, [today, today]);

            const stats = messageStats[0] || {};
            const users = userStats[0] || {};

            return {
                totalMessages: stats.total || 0,
                successfulMessages: stats.successful || 0,
                failedMessages: stats.failed || 0,
                avgResponseTime: Math.round(stats.avg_response_time || 0),
                successRate: stats.total ? Math.round((stats.successful / stats.total) * 100) : 100,
                totalTokens: stats.total_tokens || 0,
                estimatedCost: (stats.total_cost || 0).toFixed(4),
                totalUsers: users.total || 0,
                newUsers: users.new_today || 0,
                activeUsers: users.active_today || 0,
                uptime: this.formatUptime(Date.now() - this.startTime),
                alerts: []
            };

        } catch (error) {
            console.error('Error getting daily stats:', error);
            return {
                totalMessages: 0,
                successfulMessages: 0,
                failedMessages: 0,
                avgResponseTime: 0,
                successRate: 100,
                totalTokens: 0,
                estimatedCost: '0.0000',
                totalUsers: 0,
                newUsers: 0,
                activeUsers: 0,
                uptime: '0m',
                alerts: []
            };
        }
    }

    formatUptime(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        return `${minutes}m`;
    }

    getQueueStatus() {
        return {
            queued: this.notificationQueue.length,
            rateLimits: Object.fromEntries(this.rateLimits),
            enabled: this.isEnabled,
            adminId: this.adminWhatsAppId
        };
    }
}

module.exports = NotificationService;
