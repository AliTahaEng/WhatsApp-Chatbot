/**
 * Admin Notification Service
 * Proactive WhatsApp notifications to keep admin informed of system events
 * 
 * Features:
 * - Real-time event notifications
 * - Daily and weekly automated reports
 * - Smart rate limiting to prevent spam
 * - Customizable notification types and priorities
 */

const logger = require('../utils/logger');

class AdminNotificationService {
    constructor(whatsappClient, database) {
        this.client = whatsappClient;
        this.db = database;
        this.adminId = process.env.OWNER_WHATSAPP_ID || process.env.ADMIN_WHATSAPP_ID;
        
        // Rate limiting configuration
        this.notificationLimits = {
            error: parseInt(process.env.ERROR_NOTIFICATION_LIMIT) || 5,
            spam: parseInt(process.env.SPAM_NOTIFICATION_LIMIT) || 3,
            high_volume: 1,
            rate_limit: 3,
            connection: 10,
            security: 5
        };
        
        this.notificationCounts = new Map(); // type -> hourly count
        this.lastNotificationTimes = new Map(); // type -> last sent timestamp
        
        // Notification settings
        this.enabled = process.env.ADMIN_NOTIFICATIONS_ENABLED !== 'false';
        this.dailyReportTime = process.env.DAILY_REPORT_TIME || '20:00';
        this.weeklyReportDay = process.env.WEEKLY_REPORT_DAY || 'sunday';
        this.highVolumeThreshold = parseInt(process.env.HIGH_VOLUME_THRESHOLD) || 100;
        
        this.setupPeriodicTasks();
        logger.info('📢 Admin Notification Service initialized');
    }

    async notifyOwner(eventType, data = {}, priority = 'normal') {
        if (!this.enabled) {
            logger.debug(`Notification disabled: ${eventType}`);
            return;
        }

        if (!this.adminId) {
            logger.warn('⚠️ No admin WhatsApp ID configured for notifications');
            return;
        }

        try {
            // Check rate limits
            if (!this.shouldSendNotification(eventType, priority)) {
                logger.debug(`Notification rate limited: ${eventType}`);
                await this.logNotification(eventType, data, 'rate_limited');
                return;
            }

            // Format notification message
            const message = this.formatNotificationMessage(eventType, data);
            
            if (!message) {
                logger.warn(`No template found for notification type: ${eventType}`);
                return;
            }

            // Send via WhatsApp
            await this.client.sendMessage(this.adminId, message);
            
            // Log successful notification
            await this.logNotification(eventType, data, 'sent');
            
            // Update rate limiting counters
            this.updateNotificationCounts(eventType);
            
            logger.info(`📬 Admin notification sent: ${eventType}`);

        } catch (error) {
            logger.error('❌ Failed to send admin notification:', error);
            await this.logNotification(eventType, data, 'failed', error.message);
        }
    }

    formatNotificationMessage(eventType, data) {
        const timestamp = new Date().toLocaleString();
        const templates = this.getMessageTemplates();
        
        if (!templates[eventType]) {
            return `🔔 **System Event: ${eventType}**\n⏰ Time: ${timestamp}\n\n${JSON.stringify(data)}`;
        }

        let message = templates[eventType];
        
        // Replace template variables
        message = message.replace('{timestamp}', timestamp);
        
        // Replace data placeholders
        Object.keys(data).forEach(key => {
            const placeholder = `{${key}}`;
            const value = data[key];
            
            if (typeof value === 'string' || typeof value === 'number') {
                message = message.replace(new RegExp(placeholder, 'g'), value);
            }
        });
        
        return message;
    }

    getMessageTemplates() {
        return {
            'bot_started': `🟢 **Bot Started Successfully**

✅ WhatsApp AutoGen Bot is now online and ready!

📱 Phone: {phone}
🤖 Agents: {agentCount} active
💾 Database: Connected
🐍 Python Bridge: Ready
⏰ Time: {timestamp}

Everything looks good! 🎉`,

            'bot_stopped': `🔴 **Bot Shutdown**

🛑 WhatsApp AutoGen Bot has stopped.

📊 **Session Summary:**
• Messages processed: {messagesProcessed}
• Active conversations: {activeConversations}
• Uptime: {uptime}
• Reason: {reason}

⏰ Time: {timestamp}`,

            'new_contact': `🆕 **New Contact Alert**

👤 **Contact Details:**
• Name: {name}
• Phone: {phone}
• First message: "{message}"

⏰ Time: {timestamp}

Reply via WhatsApp or use: \`/admin send {phone} Your message\``,

            'error': `⚠️ **System Error Alert**

❌ **Error Details:**
• Component: {component}
• Error: {message}
• Severity: {severity}

🔍 **Context:**
{context}

⏰ Time: {timestamp}

Check logs for more details.`,

            'high_volume': `📈 **High Message Volume Alert**

📊 **Activity Spike:**
• Messages in last hour: {count}
• Current rate: {rate}/hour
• Active users: {activeUsers}
• System load: {load}%

⚡ **Performance:**
• Avg response time: {avgResponseTime}ms
• Error rate: {errorRate}%

⏰ Time: {timestamp}

System is handling the load well! 💪`,

            'spam_detected': `🚨 **Spam Detection Alert**

🛡️ **Spam Report:**
• Contact: {contact}
• Pattern: {pattern}
• Messages: {messageCount} in {timeframe}
• Action taken: {action}

📝 **Sample message:**
"{sampleMessage}"

⏰ Time: {timestamp}

Contact has been {action}.`,

            'rate_limit_hit': `⏱️ **Rate Limit Triggered**

🚫 **Limit Details:**
• Contact: {contact}
• Limit: {limit} messages/{timeframe}
• Current: {current} messages
• Action: Temporary cooldown

⏰ Time: {timestamp}

This helps prevent abuse and API overuse.`,

            'agent_error': `🤖 **Agent Error**

⚙️ **Agent Issue:**
• Agent: {agentName}
• Error: {error}
• User: {contactId}
• Impact: {impact}

🔄 **Status:** {status}

⏰ Time: {timestamp}

Agent may need attention if errors persist.`,

            'api_quota_warning': `💰 **API Quota Warning**

💸 **Usage Alert:**
• Daily usage: {dailyUsage}%
• Current cost: ${dailyCost}
• Projected monthly: ${projectedMonthlyCost}
• Tokens used: {tokensUsed}

📊 **Top consumers:**
{topConsumers}

⏰ Time: {timestamp}

Consider reviewing usage patterns.`,

            'connection_lost': `📡 **Connection Lost**

🔌 **Disconnection Alert:**
• Reason: {reason}
• Duration: {duration}
• Auto-reconnect: {autoReconnect}

🔄 **Status:** Attempting to reconnect...

⏰ Time: {timestamp}

I'll notify you when connection is restored.`,

            'connection_restored': `✅ **Connection Restored**

📡 **Reconnection Success:**
• Downtime: {downtime}
• Messages queued: {queuedMessages}
• Status: Fully operational

🎉 **We're back online!**

⏰ Time: {timestamp}

All systems functioning normally.`,

            'blacklist_added': `🚫 **Contact Blacklisted**

👤 **Blacklist Update:**
• Contact: {contact}
• Reason: {reason}
• Added by: {admin}
• Automatic: {automatic}

⏰ Time: {timestamp}

Contact will no longer receive auto-responses.`,

            'security_alert': `🛡️ **Security Alert**

🚨 **Security Event:**
• Type: {alertType}
• Details: {details}
• Source: {source}
• Risk level: {riskLevel}

🔍 **Action required:** {actionRequired}

⏰ Time: {timestamp}

Please review this security event.`,

            'system_health': `🏥 **System Health Report**

📊 **Health Status:** {status}

⚡ **Performance:**
• CPU usage: {cpuUsage}%
• Memory usage: {memoryUsage}%
• Active sessions: {activeSessions}
• Response time: {avgResponseTime}ms

🤖 **Agents:**
• Active: {activeAgents}
• Error rate: {agentErrorRate}%

⏰ Time: {timestamp}

System is {status}.`,

            'maintenance_reminder': `🔧 **Maintenance Reminder**

⏰ **Scheduled Maintenance:**
• Type: {maintenanceType}
• Due: {dueDate}
• Priority: {priority}
• Estimated duration: {estimatedDuration}

📋 **Tasks:**
{maintenanceTasks}

⏰ Time: {timestamp}

Don't forget to schedule system maintenance!`,

            'cost_alert': `💰 **Daily Cost Alert**

💸 **Cost Summary:**
• Today's cost: ${dailyCost}
• This month: ${monthlyCost}
• Last month: ${lastMonthCost}
• Change: {costChange}%

📊 **Usage breakdown:**
• Claude API: {claudeCost} ({claudePercentage}%)
• Other services: {otherCost}

⏰ Time: {timestamp}

{costTrend} spending trend.`,

            'backup_completed': `💾 **Backup Completed**

✅ **Backup Summary:**
• Type: {backupType}
• Size: {backupSize}
• Duration: {backupDuration}
• Status: {backupStatus}

📁 **Location:** {backupLocation}

⏰ Time: {timestamp}

Your data is safely backed up!`
        };
    }

    shouldSendNotification(eventType, priority = 'normal') {
        // Always send critical notifications
        const criticalEvents = ['bot_stopped', 'connection_lost', 'connection_restored', 'security_alert'];
        if (criticalEvents.includes(eventType) || priority === 'critical') {
            return true;
        }

        // Check rate limits for other events
        const limit = this.notificationLimits[eventType];
        if (!limit) {
            return true; // No limit set, allow notification
        }

        const currentHour = Math.floor(Date.now() / (60 * 60 * 1000));
        const countKey = `${eventType}_${currentHour}`;
        const currentCount = this.notificationCounts.get(countKey) || 0;
        
        return currentCount < limit;
    }

    updateNotificationCounts(eventType) {
        const currentHour = Math.floor(Date.now() / (60 * 60 * 1000));
        const countKey = `${eventType}_${currentHour}`;
        const currentCount = this.notificationCounts.get(countKey) || 0;
        
        this.notificationCounts.set(countKey, currentCount + 1);
        this.lastNotificationTimes.set(eventType, Date.now());
    }

    // Daily summary notification
    async sendDailySummary() {
        try {
            const stats = await this.getDailyStats();
            const summary = this.formatDailySummary(stats);
            
            await this.notifyOwner('daily_summary', { summary }, 'low');
            logger.info('📊 Daily summary sent');

        } catch (error) {
            logger.error('❌ Failed to send daily summary:', error);
        }
    }

    formatDailySummary(stats) {
        return `📊 **Daily Summary - ${new Date().toDateString()}**

📨 **Messages:**
• Received: ${stats.messagesReceived || 0}
• Sent: ${stats.messagesSent || 0}
• Auto-responses: ${stats.autoResponses || 0}
• Error rate: ${stats.errorRate || 0}%

👥 **Users:**
• Active contacts: ${stats.activeContacts || 0}
• New contacts: ${stats.newContacts || 0}
• Blacklisted: ${stats.blacklistedToday || 0}

🤖 **Agent Performance:**
• Customer Support: ${stats.customerSupportCalls || 0} calls
• Tech Support: ${stats.techSupportCalls || 0} calls
• Research: ${stats.researchCalls || 0} calls
• Scheduler: ${stats.schedulerCalls || 0} calls

⚡ **Performance:**
• Avg response time: ${stats.avgResponseTime || 0}ms
• Uptime: ${stats.uptimePercentage || 100}%
• System health: ${stats.systemHealth || 'Good'}

💰 **Costs:**
• API calls: ${stats.apiCalls || 0}
• Estimated cost: $${stats.estimatedCost || '0.00'}

Have a great day! 🎉`;
    }

    // Weekly summary notification
    async sendWeeklySummary() {
        try {
            const stats = await this.getWeeklyStats();
            const summary = this.formatWeeklySummary(stats);
            
            await this.notifyOwner('weekly_summary', { summary }, 'low');
            logger.info('📈 Weekly summary sent');

        } catch (error) {
            logger.error('❌ Failed to send weekly summary:', error);
        }
    }

    formatWeeklySummary(stats) {
        return `📈 **Weekly Report - Week ending ${new Date().toDateString()}**

🏆 **Highlights:**
• Total messages: ${stats.totalMessages || 0}
• Most active day: ${stats.mostActiveDay || 'N/A'} (${stats.peakMessages || 0} messages)
• Success rate: ${stats.successRate || 100}%
• User satisfaction: ${stats.satisfactionRate || 'N/A'}%

👥 **User Growth:**
• New users: ${stats.newUsers || 0}
• Returning users: ${stats.returningUsers || 0}
• Total unique contacts: ${stats.totalUniqueContacts || 0}

💡 **Popular Queries:**
${this.formatTopQueries(stats.topQueries)}

🤖 **Agent Performance:**
• Most used: ${stats.mostUsedAgent || 'N/A'}
• Best performing: ${stats.bestPerformingAgent || 'N/A'}
• Avg resolution time: ${stats.avgResolutionTime || 'N/A'}

💰 **Weekly Cost:** $${stats.totalCost || '0.00'}

Keep up the great work! 🚀`;
    }

    formatTopQueries(topQueries = []) {
        if (!topQueries || topQueries.length === 0) {
            return '• No data available';
        }
        
        return topQueries.slice(0, 5).map(q => 
            `• ${q.query || 'Unknown'} (${q.count || 0} times)`
        ).join('\n');
    }

    // Setup automated reports and cleanup
    setupPeriodicTasks() {
        // Daily summary scheduling
        this.scheduleDailyReport();
        
        // Weekly summary scheduling  
        this.scheduleWeeklyReport();
        
        // Cleanup old notification counts every hour
        setInterval(() => {
            this.cleanupNotificationCounts();
        }, 60 * 60 * 1000);

        logger.info('⏰ Automated notification reports scheduled');
    }

    scheduleDailyReport() {
        const [hours, minutes] = this.dailyReportTime.split(':').map(num => parseInt(num));
        
        const now = new Date();
        const scheduledTime = new Date();
        scheduledTime.setHours(hours, minutes, 0, 0);
        
        // If scheduled time has passed today, schedule for tomorrow
        if (scheduledTime <= now) {
            scheduledTime.setDate(scheduledTime.getDate() + 1);
        }
        
        const msUntilReport = scheduledTime.getTime() - now.getTime();
        
        setTimeout(() => {
            this.sendDailySummary();
            
            // Set up daily recurring interval
            setInterval(() => {
                this.sendDailySummary();
            }, 24 * 60 * 60 * 1000);
            
        }, msUntilReport);
        
        logger.info(`📅 Daily reports scheduled for ${this.dailyReportTime}`);
    }

    scheduleWeeklyReport() {
        const dayMapping = {
            'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
            'thursday': 4, 'friday': 5, 'saturday': 6
        };
        
        const targetDay = dayMapping[this.weeklyReportDay.toLowerCase()] || 0;
        const [hours, minutes] = this.dailyReportTime.split(':').map(num => parseInt(num));
        
        const now = new Date();
        const scheduledDate = new Date();
        
        // Calculate days until target day
        const daysUntilTarget = (7 + targetDay - now.getDay()) % 7;
        scheduledDate.setDate(now.getDate() + (daysUntilTarget || 7)); // If 0, schedule for next week
        scheduledDate.setHours(hours, minutes, 0, 0);
        
        const msUntilReport = scheduledDate.getTime() - now.getTime();
        
        setTimeout(() => {
            this.sendWeeklySummary();
            
            // Set up weekly recurring interval
            setInterval(() => {
                this.sendWeeklySummary();
            }, 7 * 24 * 60 * 60 * 1000);
            
        }, msUntilReport);
        
        logger.info(`📅 Weekly reports scheduled for ${this.weeklyReportDay}s at ${this.dailyReportTime}`);
    }

    cleanupNotificationCounts() {
        const currentHour = Math.floor(Date.now() / (60 * 60 * 1000));
        const cutoffHour = currentHour - 25; // Keep last 25 hours
        
        for (const [key] of this.notificationCounts.entries()) {
            const keyHour = parseInt(key.split('_').pop());
            if (keyHour < cutoffHour) {
                this.notificationCounts.delete(key);
            }
        }
        
        logger.debug('🧹 Notification counts cleaned up');
    }

    // Specific notification methods for easy integration
    async notifyNewContact(contactData) {
        await this.notifyOwner('new_contact', {
            name: contactData.name || 'Unknown',
            phone: contactData.phone,
            message: (contactData.message || '').substring(0, 100)
        });
    }

    async notifyError(error, context = {}) {
        await this.notifyOwner('error', {
            component: context.component || 'Unknown',
            message: error.message || String(error),
            severity: context.severity || 'medium',
            context: JSON.stringify(context, null, 2)
        }, 'high');
    }

    async notifyHighVolume(stats) {
        await this.notifyOwner('high_volume', {
            count: stats.count || 0,
            rate: stats.rate || 0,
            activeUsers: stats.activeUsers || 0,
            load: stats.load || 0,
            avgResponseTime: stats.avgResponseTime || 0,
            errorRate: stats.errorRate || 0
        }, 'medium');
    }

    async notifySpamDetected(spamData) {
        await this.notifyOwner('spam_detected', {
            contact: spamData.contact,
            pattern: spamData.pattern || 'Unknown',
            messageCount: spamData.messageCount || 1,
            timeframe: spamData.timeframe || '1 hour',
            action: spamData.action || 'blocked',
            sampleMessage: (spamData.sampleMessage || '').substring(0, 100)
        }, 'high');
    }

    async notifyRateLimitHit(limitData) {
        await this.notifyOwner('rate_limit_hit', {
            contact: limitData.contact,
            limit: limitData.limit || 'Unknown',
            timeframe: limitData.timeframe || 'hour',
            current: limitData.current || 0
        }, 'low');
    }

    async notifyAgentError(agentData) {
        await this.notifyOwner('agent_error', {
            agentName: agentData.agentName,
            error: agentData.error,
            contactId: agentData.contactId,
            impact: agentData.impact || 'Single request failed',
            status: agentData.status || 'Recovering'
        }, 'medium');
    }

    async notifyApiQuotaWarning(quotaData) {
        await this.notifyOwner('api_quota_warning', {
            dailyUsage: Math.round(quotaData.dailyUsage || 0),
            dailyCost: (quotaData.dailyCost || 0).toFixed(2),
            projectedMonthlyCost: (quotaData.projectedMonthlyCost || 0).toFixed(2),
            tokensUsed: quotaData.tokensUsed || 0,
            topConsumers: quotaData.topConsumers || 'N/A'
        }, 'high');
    }

    async notifyConnectionLost(reason = 'Unknown') {
        await this.notifyOwner('connection_lost', {
            reason,
            duration: 'Unknown',
            autoReconnect: 'Enabled'
        }, 'critical');
    }

    async notifyConnectionRestored(downtime = 'Unknown') {
        await this.notifyOwner('connection_restored', {
            downtime,
            queuedMessages: 0
        }, 'critical');
    }

    async notifyBotStarted(startupData) {
        await this.notifyOwner('bot_started', {
            phone: startupData.phone || 'Unknown',
            agentCount: startupData.agentCount || 4
        }, 'normal');
    }

    async notifyBotStopped(shutdownData) {
        await this.notifyOwner('bot_stopped', {
            messagesProcessed: shutdownData.messagesProcessed || 0,
            activeConversations: shutdownData.activeConversations || 0,
            uptime: shutdownData.uptime || 'Unknown',
            reason: shutdownData.reason || 'Manual shutdown'
        }, 'normal');
    }

    // Database operations
    async logNotification(eventType, data, status, error = null) {
        try {
            await this.db.executeRun(
                `INSERT INTO admin_notifications (event_type, data, status, error_message, created_at)
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [eventType, JSON.stringify(data), status, error]
            );
        } catch (err) {
            logger.error('❌ Error logging notification:', err);
        }
    }

    async getDailyStats() {
        try {
            // This would typically query your database for actual statistics
            // For now, return mock data that matches the expected format
            const today = new Date().toISOString().split('T')[0];
            
            const stats = await this.db.executeQuery(
                `SELECT 
                    COUNT(CASE WHEN DATE(timestamp) = ? THEN 1 END) as messagesReceived,
                    COUNT(CASE WHEN DATE(timestamp) = ? AND direction = 'outgoing' THEN 1 END) as messagesSent,
                    COUNT(DISTINCT CASE WHEN DATE(timestamp) = ? THEN contact_id END) as activeContacts,
                    COUNT(DISTINCT CASE WHEN DATE(created_at) = ? THEN contact_id END) as newContacts
                 FROM conversations 
                 WHERE DATE(timestamp) >= DATE('now', '-1 day')`,
                [today, today, today, today]
            );
            
            return {
                messagesReceived: stats[0]?.messagesReceived || 0,
                messagesSent: stats[0]?.messagesSent || 0,
                autoResponses: stats[0]?.messagesSent || 0,
                activeContacts: stats[0]?.activeContacts || 0,
                newContacts: stats[0]?.newContacts || 0,
                errorRate: 0,
                customerSupportCalls: 0,
                techSupportCalls: 0,
                researchCalls: 0,
                schedulerCalls: 0,
                avgResponseTime: 1200,
                uptimePercentage: 99.9,
                systemHealth: 'Excellent',
                apiCalls: 0,
                estimatedCost: '0.00'
            };
        } catch (error) {
            logger.error('❌ Error getting daily stats:', error);
            return {}; // Return empty stats if query fails
        }
    }

    async getWeeklyStats() {
        try {
            // Mock weekly statistics - in production this would query actual data
            return {
                totalMessages: 450,
                mostActiveDay: 'Tuesday',
                peakMessages: 85,
                successRate: 98.5,
                newUsers: 12,
                returningUsers: 38,
                totalUniqueContacts: 127,
                topQueries: [
                    { query: 'What is AI?', count: 15 },
                    { query: 'How to install?', count: 12 },
                    { query: 'Schedule meeting', count: 8 }
                ],
                mostUsedAgent: 'Research',
                bestPerformingAgent: 'Customer Support',
                avgResolutionTime: '2.3 minutes',
                totalCost: '12.45'
            };
        } catch (error) {
            logger.error('❌ Error getting weekly stats:', error);
            return {};
        }
    }

    // Configuration and status methods
    updateConfig(config) {
        if (config.enabled !== undefined) {
            this.enabled = config.enabled;
        }
        
        if (config.adminId) {
            this.adminId = config.adminId;
        }
        
        if (config.notificationLimits) {
            this.notificationLimits = { ...this.notificationLimits, ...config.notificationLimits };
        }

        logger.info('📢 Notification service configuration updated');
    }

    getStatus() {
        return {
            enabled: this.enabled,
            adminId: this.adminId ? this.adminId.substring(0, 6) + '***' : null,
            notificationLimits: this.notificationLimits,
            activeCounters: this.notificationCounts.size,
            lastDailyReport: this.lastDailyReport || null,
            lastWeeklyReport: this.lastWeeklyReport || null
        };
    }

    async getNotificationHistory(limit = 50, eventType = null) {
        try {
            let sql = 'SELECT * FROM admin_notifications';
            const params = [];

            if (eventType) {
                sql += ' WHERE event_type = ?';
                params.push(eventType);
            }

            sql += ' ORDER BY created_at DESC LIMIT ?';
            params.push(limit);

            return await this.db.executeQuery(sql, params);
        } catch (error) {
            logger.error('❌ Error getting notification history:', error);
            return [];
        }
    }

    // Test notification for setup verification
    async testNotification() {
        await this.notifyOwner('system_health', {
            status: 'Excellent',
            cpuUsage: 25,
            memoryUsage: 45,
            activeSessions: 1,
            avgResponseTime: 850,
            activeAgents: 4,
            agentErrorRate: 0.1
        }, 'normal');
        
        logger.info('🧪 Test notification sent');
        return true;
    }
}

module.exports = AdminNotificationService;
