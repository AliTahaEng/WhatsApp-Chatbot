/**
 * Metrics Service
 * Performance monitoring and analytics for WhatsApp AutoGen Bot
 * 
 * Tracks:
 * - Message volume and response times
 * - Agent usage statistics
 * - Error rates and system health
 * - User engagement metrics
 */

const logger = require('../utils/logger');

class MetricsService {
    constructor() {
        this.metrics = {
            // Message metrics
            messagesReceived: 0,
            messagesSent: 0,
            messagesProcessed: 0,
            messagesErrored: 0,

            // Response time tracking
            responseTimes: [],
            totalResponseTime: 0,
            avgResponseTime: 0,
            maxResponseTime: 0,
            minResponseTime: Infinity,

            // Agent usage
            agentCalls: new Map(), // agentName -> count
            agentResponseTimes: new Map(), // agentName -> [times]
            agentSuccessRates: new Map(), // agentName -> {success, total}

            // User engagement
            activeContacts: new Set(),
            dailyActiveContacts: new Set(),
            contactInteractions: new Map(), // contactId -> count

            // Error tracking
            errorsByType: new Map(), // errorType -> count
            errorsByComponent: new Map(), // component -> count

            // System metrics
            uptime: Date.now(),
            memoryUsage: process.memoryUsage(),
            cpuUsage: null,

            // Business metrics
            costTracking: {
                totalTokens: 0,
                totalCost: 0,
                dailyCost: 0,
                monthlyCost: 0
            }
        };

        // Performance tracking
        this.startTime = Date.now();
        this.lastResetTime = Date.now();

        // Circular buffer for response times (last 1000)
        this.maxResponseTimesSample = 1000;

        // Setup periodic tasks
        this.setupPeriodicTasks();
    }

    // Record a processed message
    recordMessage(contactId, agentName, responseTime, success = true) {
        try {
            // Basic counts
            this.metrics.messagesReceived++;
            if (success) {
                this.metrics.messagesProcessed++;
                this.metrics.messagesSent++;
            } else {
                this.metrics.messagesErrored++;
            }

            // Contact tracking
            this.metrics.activeContacts.add(contactId);
            this.metrics.dailyActiveContacts.add(contactId);

            // Update contact interaction count
            const currentCount = this.metrics.contactInteractions.get(contactId) || 0;
            this.metrics.contactInteractions.set(contactId, currentCount + 1);

            // Response time tracking
            if (success && responseTime > 0) {
                this.updateResponseTimes(responseTime);
            }

            // Agent tracking
            if (agentName && success) {
                this.updateAgentMetrics(agentName, responseTime, true);
            } else if (agentName) {
                this.updateAgentMetrics(agentName, 0, false);
            }

            // Log performance data
            logger.logPerformance('message_processing', responseTime, success, {
                contactId: contactId.substring(0, 10) + '***', // Anonymize
                agentName
            });

        } catch (error) {
            logger.error('Error recording message metrics:', error);
        }
    }

    updateResponseTimes(responseTime) {
        // Update response times
        this.metrics.responseTimes.push(responseTime);
        this.metrics.totalResponseTime += responseTime;

        // Keep only last N samples
        if (this.metrics.responseTimes.length > this.maxResponseTimesSample) {
            const removed = this.metrics.responseTimes.shift();
            this.metrics.totalResponseTime -= removed;
        }

        // Update statistics
        this.metrics.avgResponseTime = this.metrics.totalResponseTime / this.metrics.responseTimes.length;
        this.metrics.maxResponseTime = Math.max(this.metrics.maxResponseTime, responseTime);
        this.metrics.minResponseTime = Math.min(this.metrics.minResponseTime, responseTime);
    }

    updateAgentMetrics(agentName, responseTime, success) {
        // Agent call count
        const currentCalls = this.metrics.agentCalls.get(agentName) || 0;
        this.metrics.agentCalls.set(agentName, currentCalls + 1);

        // Agent response times
        if (success && responseTime > 0) {
            const responseTimes = this.metrics.agentResponseTimes.get(agentName) || [];
            responseTimes.push(responseTime);

            // Keep only last 100 per agent
            if (responseTimes.length > 100) {
                responseTimes.shift();
            }

            this.metrics.agentResponseTimes.set(agentName, responseTimes);
        }

        // Agent success rates
        const successRate = this.metrics.agentSuccessRates.get(agentName) || { success: 0, total: 0 };
        successRate.total++;
        if (success) {
            successRate.success++;
        }
        this.metrics.agentSuccessRates.set(agentName, successRate);
    }

    // Record an error
    recordError(errorType, component, details = {}) {
        try {
            // Error counts by type
            const currentTypeCount = this.metrics.errorsByType.get(errorType) || 0;
            this.metrics.errorsByType.set(errorType, currentTypeCount + 1);

            // Error counts by component
            const currentComponentCount = this.metrics.errorsByComponent.get(component) || 0;
            this.metrics.errorsByComponent.set(component, currentComponentCount + 1);

            // Log structured error
            logger.logEvent('error_recorded', {
                errorType,
                component,
                details,
                totalErrors: this.getTotalErrors()
            });

        } catch (error) {
            logger.error('Error recording error metrics:', error);
        }
    }

    // Record cost/token usage
    recordCost(tokens, cost, agentName = null) {
        try {
            this.metrics.costTracking.totalTokens += tokens;
            this.metrics.costTracking.totalCost += cost;
            this.metrics.costTracking.dailyCost += cost;

            // Log cost event
            logger.logEvent('cost_recorded', {
                tokens,
                cost,
                agentName,
                totalCost: this.metrics.costTracking.totalCost,
                totalTokens: this.metrics.costTracking.totalTokens
            });

        } catch (error) {
            logger.error('Error recording cost metrics:', error);
        }
    }

    // Get comprehensive stats
    getStats() {
        try {
            const uptime = Date.now() - this.startTime;
            const totalErrors = this.getTotalErrors();

            return {
                // Basic metrics
                uptime: this.formatUptime(uptime),
                uptimeMs: uptime,

                // Message metrics
                messages: {
                    received: this.metrics.messagesReceived,
                    processed: this.metrics.messagesProcessed,
                    sent: this.metrics.messagesSent,
                    errored: this.metrics.messagesErrored,
                    successRate: this.calculateSuccessRate()
                },

                // Performance metrics
                performance: {
                    avgResponseTime: Math.round(this.metrics.avgResponseTime),
                    maxResponseTime: this.metrics.maxResponseTime,
                    minResponseTime: this.metrics.minResponseTime === Infinity ? 0 : this.metrics.minResponseTime,
                    responseSamples: this.metrics.responseTimes.length
                },

                // User engagement
                engagement: {
                    activeContacts: this.metrics.activeContacts.size,
                    dailyActiveContacts: this.metrics.dailyActiveContacts.size,
                    totalUniqueContacts: this.metrics.contactInteractions.size,
                    avgInteractionsPerContact: this.calculateAvgInteractions()
                },

                // Agent performance
                agents: this.getAgentStats(),

                // Error tracking
                errors: {
                    total: totalErrors,
                    rate: this.calculateErrorRate(),
                    byType: Object.fromEntries(this.metrics.errorsByType),
                    byComponent: Object.fromEntries(this.metrics.errorsByComponent)
                },

                // System health
                system: this.getSystemStats(),

                // Cost tracking
                cost: {
                    ...this.metrics.costTracking,
                    avgCostPerMessage: this.calculateAvgCostPerMessage(),
                    dailyCostFormatted: `$${this.metrics.costTracking.dailyCost.toFixed(4)}`,
                    totalCostFormatted: `$${this.metrics.costTracking.totalCost.toFixed(4)}`
                }
            };

        } catch (error) {
            logger.error('Error getting stats:', error);
            return { error: 'Failed to generate stats' };
        }
    }

    getAgentStats() {
        const agentStats = {};

        for (const [agentName, calls] of this.metrics.agentCalls.entries()) {
            const responseTimes = this.metrics.agentResponseTimes.get(agentName) || [];
            const successRate = this.metrics.agentSuccessRates.get(agentName) || { success: 0, total: 0 };

            const avgResponseTime = responseTimes.length > 0 ?
                responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length : 0;

            agentStats[agentName] = {
                totalCalls: calls,
                successfulCalls: successRate.success,
                failedCalls: successRate.total - successRate.success,
                successRate: successRate.total > 0 ?
                    ((successRate.success / successRate.total) * 100).toFixed(1) + '%' : '0%',
                avgResponseTime: Math.round(avgResponseTime),
                samples: responseTimes.length
            };
        }

        return agentStats;
    }

    getSystemStats() {
        try {
            const memUsage = process.memoryUsage();

            return {
                memory: {
                    used: this.formatBytes(memUsage.used),
                    total: this.formatBytes(memUsage.rss),
                    heap: this.formatBytes(memUsage.heapUsed),
                    external: this.formatBytes(memUsage.external)
                },
                process: {
                    pid: process.pid,
                    version: process.version,
                    platform: process.platform,
                    arch: process.arch
                },
                nodejs: {
                    version: process.version,
                    uptime: this.formatUptime(process.uptime() * 1000)
                }
            };
        } catch (error) {
            logger.error('Error getting system stats:', error);
            return { error: 'Failed to get system stats' };
        }
    }

    // Calculate derived metrics
    calculateSuccessRate() {
        const total = this.metrics.messagesReceived;
        if (total === 0) return 0;
        return ((this.metrics.messagesProcessed / total) * 100).toFixed(1) + '%';
    }

    calculateErrorRate() {
        const total = this.metrics.messagesReceived;
        if (total === 0) return 0;
        return ((this.metrics.messagesErrored / total) * 100).toFixed(1) + '%';
    }

    calculateAvgInteractions() {
        const totalContacts = this.metrics.contactInteractions.size;
        if (totalContacts === 0) return 0;

        const totalInteractions = Array.from(this.metrics.contactInteractions.values())
            .reduce((sum, count) => sum + count, 0);

        return (totalInteractions / totalContacts).toFixed(1);
    }

    calculateAvgCostPerMessage() {
        const totalMessages = this.metrics.messagesProcessed;
        if (totalMessages === 0) return 0;
        return (this.metrics.costTracking.totalCost / totalMessages).toFixed(6);
    }

    getTotalErrors() {
        return Array.from(this.metrics.errorsByType.values())
            .reduce((sum, count) => sum + count, 0);
    }

    // Utility functions
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

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Reset daily metrics
    resetDailyMetrics() {
        this.metrics.dailyActiveContacts.clear();
        this.metrics.costTracking.dailyCost = 0;
        this.lastResetTime = Date.now();

        logger.logEvent('daily_metrics_reset', {
            timestamp: new Date().toISOString()
        });
    }

    // Reset all metrics
    resetAllMetrics() {
        this.metrics = {
            messagesReceived: 0,
            messagesSent: 0,
            messagesProcessed: 0,
            messagesErrored: 0,
            responseTimes: [],
            totalResponseTime: 0,
            avgResponseTime: 0,
            maxResponseTime: 0,
            minResponseTime: Infinity,
            agentCalls: new Map(),
            agentResponseTimes: new Map(),
            agentSuccessRates: new Map(),
            activeContacts: new Set(),
            dailyActiveContacts: new Set(),
            contactInteractions: new Map(),
            errorsByType: new Map(),
            errorsByComponent: new Map(),
            uptime: Date.now(),
            memoryUsage: process.memoryUsage(),
            cpuUsage: null,
            costTracking: {
                totalTokens: 0,
                totalCost: 0,
                dailyCost: 0,
                monthlyCost: 0
            }
        };

        this.startTime = Date.now();
        this.lastResetTime = Date.now();

        logger.logEvent('metrics_reset', {
            timestamp: new Date().toISOString()
        });
    }

    // Get metrics for specific time period
    getMetricsSnapshot() {
        const snapshot = {
            timestamp: new Date().toISOString(),
            uptime: Date.now() - this.startTime,
            stats: this.getStats()
        };

        return snapshot;
    }

    // Get top performing agents
    getTopAgents(limit = 5) {
        const agentStats = this.getAgentStats();
        const agents = Object.entries(agentStats)
            .sort((a, b) => {
                // Sort by total calls, then success rate
                if (b[1].totalCalls !== a[1].totalCalls) {
                    return b[1].totalCalls - a[1].totalCalls;
                }
                return parseFloat(b[1].successRate) - parseFloat(a[1].successRate);
            })
            .slice(0, limit);

        return agents;
    }

    // Get most active contacts (anonymized)
    getTopContacts(limit = 10) {
        const contacts = Array.from(this.metrics.contactInteractions.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([contactId, count]) => ({
                id: contactId.substring(0, 6) + '***', // Anonymize
                interactions: count
            }));

        return contacts;
    }

    // Setup periodic tasks
    setupPeriodicTasks() {
        // Reset daily metrics at midnight
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        const timeUntilMidnight = tomorrow.getTime() - now.getTime();

        setTimeout(() => {
            this.resetDailyMetrics();

            // Set up daily recurring reset
            setInterval(() => {
                this.resetDailyMetrics();
            }, 24 * 60 * 60 * 1000); // 24 hours

        }, timeUntilMidnight);

        // Update system metrics every 5 minutes
        setInterval(() => {
            this.updateSystemMetrics();
        }, 5 * 60 * 1000);

        logger.info('📊 Metrics service periodic tasks scheduled');
    }

    updateSystemMetrics() {
        try {
            this.metrics.memoryUsage = process.memoryUsage();

            // Log current metrics snapshot
            logger.logEvent('metrics_snapshot', {
                memory: this.formatBytes(this.metrics.memoryUsage.heapUsed),
                activeContacts: this.metrics.activeContacts.size,
                totalMessages: this.metrics.messagesReceived,
                avgResponseTime: Math.round(this.metrics.avgResponseTime)
            });

        } catch (error) {
            logger.error('Error updating system metrics:', error);
        }
    }

    // Export metrics for external monitoring
    exportMetrics(format = 'json') {
        const data = {
            timestamp: new Date().toISOString(),
            service: 'whatsapp-autogen-bot',
            version: '1.0.0',
            metrics: this.getStats()
        };

        if (format === 'prometheus') {
            return this.convertToPrometheusFormat(data);
        }

        return data;
    }

    convertToPrometheusFormat(data) {
        // Convert metrics to Prometheus format
        // This is a simplified version - full implementation would need more detail
        const lines = [];
        const metrics = data.metrics;

        lines.push(`# HELP messages_total Total number of messages processed`);
        lines.push(`# TYPE messages_total counter`);
        lines.push(`messages_total{type="received"} ${metrics.messages.received}`);
        lines.push(`messages_total{type="processed"} ${metrics.messages.processed}`);

        lines.push(`# HELP response_time_ms Average response time in milliseconds`);
        lines.push(`# TYPE response_time_ms gauge`);
        lines.push(`response_time_ms ${metrics.performance.avgResponseTime}`);

        return lines.join('\n');
    }
}

module.exports = MetricsService;
