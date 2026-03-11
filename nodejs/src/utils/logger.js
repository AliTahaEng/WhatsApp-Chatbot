/**
 * Structured Logger
 * Advanced logging system for WhatsApp AutoGen Bot
 * 
 * Features:
 * - Multiple log levels
 * - File rotation
 * - Structured JSON logging
 * - Performance logging
 * - Error tracking
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

class Logger {
    constructor() {
        this.logDir = process.env.LOG_DIR || './data/logs';
        this.logLevel = process.env.LOG_LEVEL || 'info';
        this.maxSize = parseInt(process.env.LOG_MAX_SIZE) || 10485760; // 10MB
        this.maxFiles = parseInt(process.env.LOG_MAX_FILES) || 5;
        
        this.ensureLogDirectory();
        this.logger = this.createLogger();
    }

    ensureLogDirectory() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    createLogger() {
        const formats = winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.errors({ stack: true }),
            winston.format.splat(),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
                let logMessage = `${timestamp} [${level.toUpperCase()}] ${message}`;
                
                if (Object.keys(meta).length > 0) {
                    logMessage += ` ${JSON.stringify(meta)}`;
                }
                
                return logMessage;
            })
        );

        const logger = winston.createLogger({
            level: this.logLevel,
            format: formats,
            transports: [
                // Console transport
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.colorize(),
                        winston.format.simple()
                    )
                }),
                
                // File transport for all logs
                new winston.transports.File({
                    filename: path.join(this.logDir, 'app.log'),
                    maxsize: this.maxSize,
                    maxFiles: this.maxFiles,
                    tailable: true
                }),
                
                // Separate file for errors
                new winston.transports.File({
                    filename: path.join(this.logDir, 'error.log'),
                    level: 'error',
                    maxsize: this.maxSize,
                    maxFiles: this.maxFiles,
                    tailable: true
                }),
                
                // Separate file for performance logs
                new winston.transports.File({
                    filename: path.join(this.logDir, 'performance.log'),
                    level: 'debug',
                    maxsize: this.maxSize,
                    maxFiles: this.maxFiles,
                    tailable: true,
                    format: winston.format.combine(
                        winston.format.timestamp(),
                        winston.format.json()
                    )
                })
            ],
            
            // Handle uncaught exceptions
            exceptionHandlers: [
                new winston.transports.File({
                    filename: path.join(this.logDir, 'exceptions.log')
                })
            ],
            
            // Handle unhandled promise rejections
            rejectionHandlers: [
                new winston.transports.File({
                    filename: path.join(this.logDir, 'rejections.log')
                })
            ]
        });

        return logger;
    }

    // Standard logging methods
    debug(message, meta = {}) {
        this.logger.debug(message, meta);
    }

    info(message, meta = {}) {
        this.logger.info(message, meta);
    }

    warn(message, meta = {}) {
        this.logger.warn(message, meta);
    }

    error(message, meta = {}) {
        if (message instanceof Error) {
            this.logger.error(message.message, {
                stack: message.stack,
                name: message.name,
                ...meta
            });
        } else {
            this.logger.error(message, meta);
        }
    }

    // Structured event logging
    logEvent(eventType, data = {}) {
        this.info(`EVENT: ${eventType}`, {
            eventType,
            timestamp: new Date().toISOString(),
            ...data
        });
    }

    // Performance logging
    logPerformance(operation, duration, success = true, meta = {}) {
        this.debug(`PERFORMANCE: ${operation}`, {
            operation,
            duration,
            success,
            timestamp: new Date().toISOString(),
            ...meta
        });
    }

    // Message logging (specific to WhatsApp bot)
    logMessage(direction, contactId, content, agentName = null) {
        this.info(`MESSAGE: ${direction}`, {
            direction, // 'incoming' or 'outgoing'
            contactId,
            contentLength: content?.length || 0,
            agentName,
            timestamp: new Date().toISOString()
        });
    }

    // Admin action logging
    logAdminAction(adminId, action, target, details = {}) {
        this.info(`ADMIN: ${action}`, {
            adminId,
            action,
            target,
            details,
            timestamp: new Date().toISOString()
        });
    }

    // Error with context
    logErrorWithContext(error, context = {}) {
        this.error('ERROR_WITH_CONTEXT', {
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name
            },
            context,
            timestamp: new Date().toISOString()
        });
    }

    // Rate limit violations
    logRateLimitViolation(contactId, limitType, current, max) {
        this.warn('RATE_LIMIT_VIOLATION', {
            contactId,
            limitType,
            current,
            max,
            timestamp: new Date().toISOString()
        });
    }

    // System health
    logSystemHealth(component, status, metrics = {}) {
        this.info(`HEALTH: ${component}`, {
            component,
            status, // 'healthy', 'degraded', 'unhealthy'
            metrics,
            timestamp: new Date().toISOString()
        });
    }

    // API calls
    logAPICall(service, endpoint, duration, success, statusCode = null) {
        this.debug(`API: ${service}`, {
            service,
            endpoint,
            duration,
            success,
            statusCode,
            timestamp: new Date().toISOString()
        });
    }

    // Security events
    logSecurityEvent(eventType, details = {}) {
        this.warn(`SECURITY: ${eventType}`, {
            eventType,
            details,
            timestamp: new Date().toISOString()
        });
    }

    // Performance timer utility
    startTimer() {
        return Date.now();
    }

    endTimer(startTime, operation, meta = {}) {
        const duration = Date.now() - startTime;
        this.logPerformance(operation, duration, true, meta);
        return duration;
    }

    // Get recent logs
    async getRecentLogs(lines = 100, level = null) {
        return new Promise((resolve, reject) => {
            const options = {
                from: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
                until: new Date(),
                limit: lines,
                start: 0,
                order: 'desc'
            };

            if (level) {
                options.level = level;
            }

            this.logger.query(options, (err, results) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(results.file || []);
                }
            });
        });
    }

    // Change log level dynamically
    setLogLevel(level) {
        this.logger.level = level;
        this.logLevel = level;
        this.info(`Log level changed to: ${level}`);
    }

    // Get current configuration
    getConfig() {
        return {
            level: this.logLevel,
            logDir: this.logDir,
            maxSize: this.maxSize,
            maxFiles: this.maxFiles,
            transports: this.logger.transports.length
        };
    }

    // Cleanup old log files
    async cleanup(daysOld = 30) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOld);

            const files = fs.readdirSync(this.logDir);
            let deletedCount = 0;

            for (const file of files) {
                const filePath = path.join(this.logDir, file);
                const stats = fs.statSync(filePath);
                
                if (stats.mtime < cutoffDate && file.endsWith('.log')) {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                }
            }

            this.info(`Log cleanup completed: ${deletedCount} files deleted`);
            return deletedCount;

        } catch (error) {
            this.error('Log cleanup failed:', error);
            return 0;
        }
    }

    // Create child logger with additional context
    createChildLogger(defaultMeta = {}) {
        return {
            debug: (message, meta = {}) => this.debug(message, { ...defaultMeta, ...meta }),
            info: (message, meta = {}) => this.info(message, { ...defaultMeta, ...meta }),
            warn: (message, meta = {}) => this.warn(message, { ...defaultMeta, ...meta }),
            error: (message, meta = {}) => this.error(message, { ...defaultMeta, ...meta }),
            logEvent: (eventType, data = {}) => this.logEvent(eventType, { ...defaultMeta, ...data })
        };
    }

    // Format error for logging
    formatError(error) {
        if (error instanceof Error) {
            return {
                name: error.name,
                message: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            };
        }
        return { message: String(error), timestamp: new Date().toISOString() };
    }

    // Log with correlation ID (for tracing requests)
    withCorrelationId(correlationId) {
        return this.createChildLogger({ correlationId });
    }

    // Batch logging for performance
    batch() {
        const logs = [];
        
        return {
            add: (level, message, meta = {}) => {
                logs.push({ level, message, meta, timestamp: Date.now() });
            },
            flush: () => {
                logs.forEach(({ level, message, meta }) => {
                    this[level](message, meta);
                });
                logs.length = 0;
            },
            size: () => logs.length
        };
    }
}

// Create singleton instance
const logger = new Logger();

// Export both the instance and the class
module.exports = logger;
module.exports.Logger = Logger;
