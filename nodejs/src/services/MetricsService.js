/**
 * Metrics Service - Modern Architecture  
 * Handles performance monitoring and analytics using DI
 */

class MetricsService {
    constructor(container) {
        this.container = container;
        this.config = container.resolve('ConfigurationManager');
        this.database = container.resolve('IDatabase');

        this.metrics = {
            messages: {
                total: 0,
                today: 0,
                thisHour: 0,
                successful: 0,
                failed: 0
            },
            performance: {
                averageResponseTime: 0,
                totalResponseTime: 0,
                requestCount: 0
            },
            users: {
                total: 0,
                active: 0,
                new: 0
            },
            system: {
                uptime: 0,
                startTime: Date.now(),
                memoryUsage: 0,
                cpuUsage: 0
            }
        };

        this.isEnabled = this.config.get('metrics.enabled', true);
        console.log(`📊 Metrics Service initialized (enabled: ${this.isEnabled})`);
    }

    async start() {
        if (!this.isEnabled) {
            console.log('⏭️ Metrics Service disabled');
            return;
        }

        // Load initial metrics from database
        await this.loadMetrics();

        // Start periodic metrics collection
        this.startMetricsCollection();

        console.log('✅ Metrics Service started');
    }

    async stop() {
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
        }
        console.log('✅ Metrics Service stopped');
    }

    async loadMetrics() {
        try {
            // Load message metrics
            const messageStats = await this.database.executeQuery(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN date(timestamp) = date('now') THEN 1 END) as today,
                    COUNT(CASE WHEN datetime(timestamp) >= datetime('now', '-1 hour') THEN 1 END) as thisHour
                FROM conversations
            `);

            if (messageStats.length > 0) {
                this.metrics.messages.total = messageStats[0].total || 0;
                this.metrics.messages.today = messageStats[0].today || 0;
                this.metrics.messages.thisHour = messageStats[0].thisHour || 0;
            }

            // Load user metrics
            const userStats = await this.database.executeQuery(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN date(created_at) = date('now') THEN 1 END) as new,
                    COUNT(CASE WHEN date(last_interaction) >= date('now', '-7 days') THEN 1 END) as active
                FROM users
            `);

            if (userStats.length > 0) {
                this.metrics.users.total = userStats[0].total || 0;
                this.metrics.users.new = userStats[0].new || 0;
                this.metrics.users.active = userStats[0].active || 0;
            }

            console.log('📊 Initial metrics loaded');

        } catch (error) {
            console.error('❌ Error loading metrics:', error);
        }
    }

    startMetricsCollection() {
        // Update metrics every minute
        this.metricsInterval = setInterval(async () => {
            await this.updateSystemMetrics();
        }, 60000); // 1 minute
    }

    async updateSystemMetrics() {
        try {
            // Update uptime
            this.metrics.system.uptime = Date.now() - this.metrics.system.startTime;

            // Update memory usage
            const memUsage = process.memoryUsage();
            this.metrics.system.memoryUsage = Math.round(memUsage.heapUsed / 1024 / 1024); // MB

            // Save metrics to database
            await this.saveMetricsSnapshot();

        } catch (error) {
            console.error('❌ Error updating system metrics:', error);
        }
    }

    async saveMetricsSnapshot() {
        try {
            await this.database.executeRun(`
                INSERT INTO system_metrics (
                    timestamp, 
                    metric_type, 
                    metric_value, 
                    metadata
                ) VALUES (?, ?, ?, ?)
            `, [
                new Date().toISOString(),
                'system_snapshot',
                JSON.stringify(this.metrics),
                JSON.stringify({ source: 'MetricsService' })
            ]);

        } catch (error) {
            // Ignore if table doesn't exist (will be created by database adapter)
            console.debug('Metrics table may not exist yet');
        }
    }

    // Record message processing metrics
    async recordMessage(contactId, messageType, success = true, responseTime = 0, agentName = null, tokensUsed = 0) {
        if (!this.isEnabled) return;

        try {
            this.metrics.messages.total++;

            if (success) {
                this.metrics.messages.successful++;
            } else {
                this.metrics.messages.failed++;
            }

            // Update response time metrics
            this.metrics.performance.requestCount++;
            this.metrics.performance.totalResponseTime += responseTime;
            this.metrics.performance.averageResponseTime =
                this.metrics.performance.totalResponseTime / this.metrics.performance.requestCount;

            // Save to database
            await this.database.executeRun(`
                INSERT INTO usage_statistics (
                    whatsapp_id,
                    message_count,
                    tokens_used,
                    cost_estimate,
                    date,
                    agent_name,
                    response_time,
                    success
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                contactId,
                1,
                tokensUsed,
                this.calculateCost(tokensUsed),
                new Date().toISOString().split('T')[0],
                agentName,
                responseTime,
                success ? 1 : 0
            ]);

        } catch (error) {
            console.error('❌ Error recording message metrics:', error);
        }
    }

    // Record user activity
    async recordUserActivity(contactId, activityType = 'message') {
        if (!this.isEnabled) return;

        try {
            // Update user interaction timestamp
            await this.database.executeRun(`
                UPDATE users 
                SET last_interaction = ?, message_count = message_count + 1
                WHERE whatsapp_id = ?
            `, [new Date().toISOString(), contactId]);

        } catch (error) {
            console.error('❌ Error recording user activity:', error);
        }
    }

    // Get current metrics summary
    getMetrics() {
        return {
            ...this.metrics,
            system: {
                ...this.metrics.system,
                uptimeFormatted: this.formatUptime(this.metrics.system.uptime)
            },
            performance: {
                ...this.metrics.performance,
                successRate: this.getSuccessRate(),
                averageResponseTimeFormatted: `${Math.round(this.metrics.performance.averageResponseTime)}ms`
            }
        };
    }

    getSuccessRate() {
        const total = this.metrics.messages.successful + this.metrics.messages.failed;
        return total > 0 ? Math.round((this.metrics.messages.successful / total) * 100) : 100;
    }

    formatUptime(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        return `${minutes}m ${seconds % 60}s`;
    }

    calculateCost(tokensUsed) {
        // Rough cost estimation (adjust based on your LLM provider)
        const costPerToken = 0.00002; // Example: $0.02 per 1K tokens
        return tokensUsed * costPerToken;
    }

    // Get performance statistics
    async getPerformanceStats(days = 7) {
        try {
            const stats = await this.database.executeQuery(`
                SELECT 
                    date,
                    COUNT(*) as message_count,
                    AVG(response_time) as avg_response_time,
                    SUM(tokens_used) as total_tokens,
                    SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_messages,
                    COUNT(DISTINCT whatsapp_id) as unique_users
                FROM usage_statistics 
                WHERE date >= date('now', '-${days} days')
                GROUP BY date
                ORDER BY date DESC
            `);

            return stats;

        } catch (error) {
            console.error('❌ Error getting performance stats:', error);
            return [];
        }
    }

    // Get user analytics
    async getUserAnalytics() {
        try {
            const analytics = await this.database.executeQuery(`
                SELECT 
                    u.whatsapp_id,
                    u.name,
                    u.message_count,
                    u.created_at,
                    u.last_interaction,
                    us.total_tokens,
                    us.cost_estimate
                FROM users u
                LEFT JOIN (
                    SELECT 
                        whatsapp_id,
                        SUM(tokens_used) as total_tokens,
                        SUM(cost_estimate) as cost_estimate
                    FROM usage_statistics 
                    GROUP BY whatsapp_id
                ) us ON u.whatsapp_id = us.whatsapp_id
                ORDER BY u.message_count DESC
                LIMIT 50
            `);

            return analytics;

        } catch (error) {
            console.error('❌ Error getting user analytics:', error);
            return [];
        }
    }

    // Health check endpoint data
    async getHealthMetrics() {
        return {
            status: 'healthy',
            uptime: this.formatUptime(this.metrics.system.uptime),
            memoryUsage: `${this.metrics.system.memoryUsage}MB`,
            messageCount: this.metrics.messages.total,
            successRate: `${this.getSuccessRate()}%`,
            averageResponseTime: `${Math.round(this.metrics.performance.averageResponseTime)}ms`,
            activeUsers: this.metrics.users.active,
            lastUpdate: new Date().toISOString()
        };
    }

    // Dashboard data
    async getDashboardData() {
        const performanceStats = await this.getPerformanceStats(7);
        const userAnalytics = await this.getUserAnalytics();

        return {
            summary: this.getMetrics(),
            performance: performanceStats,
            users: userAnalytics,
            health: await this.getHealthMetrics()
        };
    }
}

module.exports = MetricsService;
