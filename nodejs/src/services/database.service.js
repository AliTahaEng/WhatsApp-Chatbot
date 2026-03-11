/**
 * Database Service
 * Centralized database operations for WhatsApp AutoGen Bot
 * 
 * Handles all database operations including:
 * - User management
 * - Conversation logging
 * - Blacklist/Whitelist operations
 * - Rate limiting
 * - Usage statistics
 * - Admin actions
 * - Manual overrides
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

class DatabaseService {
    constructor(dbPath = null) {
        this.dbPath = dbPath || process.env.DATABASE_PATH || './data/database.db';
        this.db = null;
        this.isConnected = false;
    }

    async initialize() {
        try {
            // Ensure data directory exists
            const dataDir = path.dirname(this.dbPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
                logger.info(`📁 Created data directory: ${dataDir}`);
            }

            // Connect to database
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    logger.error('❌ Database connection error:', err);
                    throw err;
                }
            });

            // Enable foreign keys and WAL mode for better performance
            await this.executeQuery('PRAGMA foreign_keys = ON');
            await this.executeQuery('PRAGMA journal_mode = WAL');
            await this.executeQuery('PRAGMA synchronous = NORMAL');
            await this.executeQuery('PRAGMA cache_size = 10000');
            await this.executeQuery('PRAGMA busy_timeout = 5000');

            // Initialize schema
            await this.initializeSchema();

            this.isConnected = true;
            logger.info(`✅ Database initialized: ${this.dbPath}`);

        } catch (error) {
            logger.error('❌ Failed to initialize database:', error);
            throw error;
        }
    }

    async initializeSchema() {
        const schemaPath = path.join(__dirname, '../database/schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');

        // // Split and execute each statement
        // const statements = schema.split(';').filter(stmt => stmt.trim().length > 0);

        // for (const statement of statements) {
        //     await this.executeQuery(statement);
        // }
        await this.executeScript(schema);
        logger.info('✅ Database schema initialized');
    }

    // Helper method to execute queries with Promise wrapper
    executeQuery(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Helper method for single row queries
    executeQuerySingle(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    // Helper method for insert/update/delete operations
    executeRun(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        lastID: this.lastID,
                        changes: this.changes
                    });
                }
            });
        });
    }

    // Helper method to execute SQL script (multiple statements)
    // async executeScript(script) {
    //     const statements = script.split(';').filter(stmt => stmt.trim().length > 0);

    //     for (const statement of statements) {
    //         try {
    //             await this.executeRun(statement.trim());
    //         } catch (error) {
    //             // Ignore errors for CREATE TABLE IF NOT EXISTS and similar
    //             if (!error.message.includes('already exists')) {
    //                 logger.debug(`SQL statement execution: ${error.message}`);
    //             }
    //         }
    //     }

    //     logger.info('✅ SQL script executed successfully');
    // }
    // Helper method to execute SQL script (multiple statements)
    async executeScript(script) {
        // Remove comments
        script = script.replace(/--.*$/gm, ''); // Remove single-line comments

        // Split statements intelligently - handles triggers
        const statements = [];
        let currentStatement = '';
        let inTrigger = false;

        const lines = script.split('\n');

        for (const line of lines) {
            const trimmedLine = line.trim();

            // Check if we're entering a trigger or other multi-statement block
            if (trimmedLine.match(/CREATE\s+TRIGGER/i)) {
                inTrigger = true;
            }

            currentStatement += line + '\n';

            // Check if statement is complete
            if (trimmedLine.endsWith(';')) {
                if (inTrigger) {
                    // For triggers, look for END;
                    if (trimmedLine.match(/END;/i)) {
                        inTrigger = false;
                        statements.push(currentStatement.trim());
                        currentStatement = '';
                    }
                } else {
                    // Regular statement - add it
                    statements.push(currentStatement.trim());
                    currentStatement = '';
                }
            }
        }

        // Add any remaining statement
        if (currentStatement.trim()) {
            statements.push(currentStatement.trim());
        }

        // Execute each statement
        for (const statement of statements) {
            if (statement.length === 0) continue;

            try {
                await this.executeRun(statement);
            } catch (error) {
                // Ignore errors for CREATE TABLE IF NOT EXISTS and similar
                if (!error.message.includes('already exists')) {
                    logger.debug(`SQL statement execution: ${error.message}`);
                    // Don't throw - continue with other statements
                }
            }
        }

        logger.info('✅ SQL script executed successfully');
    }
    // ==================== USER OPERATIONS ====================

    async getOrCreateUser(contactId, name = null, phoneNumber = null) {
        try {
            // Try to get existing user
            let user = await this.executeQuerySingle(
                'SELECT * FROM users WHERE contact_id = ?',
                [contactId]
            );

            if (user) {
                // Update last interaction
                await this.executeRun(
                    'UPDATE users SET last_interaction = CURRENT_TIMESTAMP WHERE id = ?',
                    [user.id]
                );
                return user;
            }

            // Create new user
            const result = await this.executeRun(
                `INSERT INTO users (contact_id, name, phone_number, created_at, last_interaction)
                 VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [contactId, name, phoneNumber]
            );

            // Return the created user
            user = await this.executeQuerySingle(
                'SELECT * FROM users WHERE id = ?',
                [result.lastID]
            );

            logger.info(`👤 New user created: ${contactId} (${name || 'Unknown'})`);
            return user;

        } catch (error) {
            logger.error('❌ Error in getOrCreateUser:', error);
            throw error;
        }
    }

    async updateUserProfile(contactId, updates) {
        const allowedFields = ['name', 'phone_number', 'profile_pic_url', 'tags', 'notes', 'metadata'];
        const fields = [];
        const values = [];

        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                fields.push(`${key} = ?`);
                if (key === 'tags' || key === 'metadata') {
                    values.push(JSON.stringify(value));
                } else {
                    values.push(value);
                }
            }
        }

        if (fields.length === 0) {
            return;
        }

        values.push(contactId);
        const sql = `UPDATE users SET ${fields.join(', ')} WHERE contact_id = ?`;

        await this.executeRun(sql, values);
        logger.debug(`👤 User profile updated: ${contactId}`);
    }

    // ==================== CONVERSATION OPERATIONS ====================

    async saveMessage(contactId, role, message, agentName = null, tokensUsed = 0, messageType = 'text', mediaUrl = null, metadata = null) {
        try {
            // Get or create user
            const user = await this.getOrCreateUser(contactId);

            // Save conversation
            const result = await this.executeRun(
                `INSERT INTO conversations 
                 (user_id, contact_id, role, message, agent_name, tokens_used, message_type, media_url, metadata)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    user.id,
                    contactId,
                    role,
                    message,
                    agentName,
                    tokensUsed,
                    messageType,
                    mediaUrl,
                    metadata ? JSON.stringify(metadata) : null
                ]
            );

            logger.debug(`💬 Message saved: ${role} from ${contactId}`);
            return result.lastID;

        } catch (error) {
            logger.error('❌ Error saving message:', error);
            throw error;
        }
    }

    async getConversationHistory(contactId, limit = 10, includeSystem = false) {
        try {
            let sql = `
                SELECT role, message, agent_name, timestamp, message_type, tokens_used
                FROM conversations
                WHERE contact_id = ?
            `;

            if (!includeSystem) {
                sql += ` AND role IN ('user', 'assistant')`;
            }

            sql += ` ORDER BY timestamp DESC LIMIT ?`;

            const rows = await this.executeQuery(sql, [contactId, limit]);

            // Convert to chronological order and parse metadata
            return rows.reverse().map(row => ({
                ...row,
                timestamp: new Date(row.timestamp)
            }));

        } catch (error) {
            logger.error('❌ Error getting conversation history:', error);
            throw error;
        }
    }

    async clearConversationHistory(contactId) {
        const result = await this.executeRun(
            'DELETE FROM conversations WHERE contact_id = ?',
            [contactId]
        );
        logger.info(`🗑️ Cleared conversation history for ${contactId}: ${result.changes} messages`);
        return result.changes;
    }

    async searchConversations(query, contactId = null, limit = 50) {
        try {
            let sql = `
                SELECT c.*, u.name as user_name
                FROM conversations c
                LEFT JOIN users u ON c.user_id = u.id
                WHERE c.message LIKE ?
            `;
            let params = [`%${query}%`];

            if (contactId) {
                sql += ` AND c.contact_id = ?`;
                params.push(contactId);
            }

            sql += ` ORDER BY c.timestamp DESC LIMIT ?`;
            params.push(limit);

            const rows = await this.executeQuery(sql, params);
            return rows.map(row => ({
                ...row,
                timestamp: new Date(row.timestamp)
            }));

        } catch (error) {
            logger.error('❌ Error searching conversations:', error);
            throw error;
        }
    }

    // ==================== BLACKLIST/WHITELIST OPERATIONS ====================

    async isBlacklisted(contactId) {
        const result = await this.executeQuerySingle(
            `SELECT 1 FROM blacklist
             WHERE contact_id = ? AND is_active = 1
             AND (expires_at IS NULL OR expires_at > datetime('now'))`,
            [contactId]
        );
        return !!result;
    }

    async addToBlacklist(contactId, reason = null, addedBy = 'system', durationHours = null) {
        try {
            let expiresAt = null;
            if (durationHours) {
                const expiry = new Date();
                expiry.setHours(expiry.getHours() + durationHours);
                expiresAt = expiry.toISOString();
            }

            await this.executeRun(
                `INSERT OR REPLACE INTO blacklist
                 (contact_id, reason, added_by, expires_at)
                 VALUES (?, ?, ?, ?)`,
                [contactId, reason, addedBy, expiresAt]
            );

            // Update user table
            await this.executeRun(
                'UPDATE users SET is_blacklisted = 1 WHERE contact_id = ?',
                [contactId]
            );

            logger.info(`🚫 Contact blacklisted: ${contactId} by ${addedBy}`);
            return true;

        } catch (error) {
            logger.error('❌ Error adding to blacklist:', error);
            throw error;
        }
    }

    async removeFromBlacklist(contactId) {
        try {
            const result = await this.executeRun(
                'UPDATE blacklist SET is_active = 0 WHERE contact_id = ?',
                [contactId]
            );

            await this.executeRun(
                'UPDATE users SET is_blacklisted = 0 WHERE contact_id = ?',
                [contactId]
            );

            logger.info(`✅ Contact removed from blacklist: ${contactId}`);
            return result.changes > 0;

        } catch (error) {
            logger.error('❌ Error removing from blacklist:', error);
            throw error;
        }
    }

    async isWhitelisted(contactId) {
        const result = await this.executeQuerySingle(
            'SELECT priority FROM whitelist WHERE contact_id = ?',
            [contactId]
        );
        return result ? { whitelisted: true, priority: result.priority } : { whitelisted: false };
    }

    async addToWhitelist(contactId, reason = null, addedBy = 'admin', priority = 0) {
        try {
            await this.executeRun(
                `INSERT OR REPLACE INTO whitelist (contact_id, reason, added_by, priority)
                 VALUES (?, ?, ?, ?)`,
                [contactId, reason, addedBy, priority]
            );

            await this.executeRun(
                'UPDATE users SET is_whitelisted = 1 WHERE contact_id = ?',
                [contactId]
            );

            logger.info(`✅ Contact whitelisted: ${contactId} by ${addedBy}`);
            return true;

        } catch (error) {
            logger.error('❌ Error adding to whitelist:', error);
            throw error;
        }
    }

    // ==================== RATE LIMITING OPERATIONS ====================

    async checkRateLimit(contactId, windowType, maxMessages) {
        try {
            let windowStart;
            const now = new Date();

            switch (windowType) {
                case 'minute':
                    windowStart = new Date(now.getTime() - 60 * 1000);
                    break;
                case 'hour':
                    windowStart = new Date(now.getTime() - 60 * 60 * 1000);
                    break;
                case 'day':
                    windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                    break;
                default:
                    throw new Error(`Invalid window type: ${windowType}`);
            }

            const result = await this.executeQuerySingle(
                `SELECT SUM(message_count) as total
                 FROM rate_limits
                 WHERE contact_id = ? AND window_type = ? AND window_start >= ?`,
                [contactId, windowType, windowStart.toISOString()]
            );

            const currentCount = result.total || 0;
            return {
                allowed: currentCount < maxMessages,
                currentCount: currentCount,
                maxMessages: maxMessages,
                windowType: windowType
            };

        } catch (error) {
            logger.error('❌ Error checking rate limit:', error);
            throw error;
        }
    }

    async incrementRateLimit(contactId, windowType, tokensUsed = 0) {
        try {
            const now = new Date();
            let windowStart;

            switch (windowType) {
                case 'minute':
                    windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0);
                    break;
                case 'hour':
                    windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
                    break;
                case 'day':
                    windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
                    break;
                default:
                    throw new Error(`Invalid window type: ${windowType}`);
            }

            await this.executeRun(
                `INSERT INTO rate_limits (contact_id, window_start, window_type, message_count, tokens_used)
                 VALUES (?, ?, ?, 1, ?)
                 ON CONFLICT(contact_id, window_start, window_type)
                 DO UPDATE SET 
                     message_count = message_count + 1,
                     tokens_used = tokens_used + ?`,
                [contactId, windowStart.toISOString(), windowType, tokensUsed, tokensUsed]
            );

        } catch (error) {
            logger.error('❌ Error incrementing rate limit:', error);
            throw error;
        }
    }

    // ==================== USAGE STATISTICS ====================

    async logUsage(contactId, tokensUsed, costUsd, agentName) {
        try {
            const today = new Date().toISOString().split('T')[0];

            await this.executeRun(
                `INSERT INTO usage_stats (contact_id, date, message_count, tokens_used, cost_usd, agent_calls)
                 VALUES (?, ?, 1, ?, ?, ?)
                 ON CONFLICT(contact_id, date)
                 DO UPDATE SET
                     message_count = message_count + 1,
                     tokens_used = tokens_used + ?,
                     cost_usd = cost_usd + ?`,
                [
                    contactId,
                    today,
                    tokensUsed,
                    costUsd,
                    JSON.stringify({ [agentName]: 1 }),
                    tokensUsed,
                    costUsd
                ]
            );

        } catch (error) {
            logger.error('❌ Error logging usage:', error);
            throw error;
        }
    }

    async getUsageStats(contactId = null, startDate = null, endDate = null) {
        try {
            let sql = 'SELECT * FROM usage_stats WHERE 1=1';
            const params = [];

            if (contactId) {
                sql += ' AND contact_id = ?';
                params.push(contactId);
            }

            if (startDate) {
                sql += ' AND date >= ?';
                params.push(startDate);
            }

            if (endDate) {
                sql += ' AND date <= ?';
                params.push(endDate);
            }

            sql += ' ORDER BY date DESC';

            return await this.executeQuery(sql, params);

        } catch (error) {
            logger.error('❌ Error getting usage stats:', error);
            throw error;
        }
    }

    // ==================== ADMIN OPERATIONS ====================

    async logManualMessage(adminId, targetContact, message) {
        return await this.executeRun(
            'INSERT INTO manual_messages (admin_id, target_contact, message) VALUES (?, ?, ?)',
            [adminId, targetContact, message]
        );
    }

    async logAdminAction(adminId, actionType, targetContact, details) {
        return await this.executeRun(
            'INSERT INTO admin_actions (admin_id, action_type, target_contact, details) VALUES (?, ?, ?, ?)',
            [adminId, actionType, targetContact, JSON.stringify(details)]
        );
    }

    async addManualOverride(contactId, overrideType, reason, adminId, expiresAt = null) {
        return await this.executeRun(
            'INSERT INTO manual_overrides (contact_id, override_type, reason, admin_id, expires_at) VALUES (?, ?, ?, ?, ?)',
            [contactId, overrideType, reason, adminId, expiresAt ? expiresAt.toISOString() : null]
        );
    }

    async removeManualOverride(contactId) {
        return await this.executeRun(
            'UPDATE manual_overrides SET status = "removed" WHERE contact_id = ? AND status = "active"',
            [contactId]
        );
    }

    async getActiveOverrides() {
        return await this.executeQuery(
            `SELECT * FROM manual_overrides 
             WHERE status = "active" 
             AND (expires_at IS NULL OR expires_at > datetime('now'))`
        );
    }

    // ==================== SYSTEM OPERATIONS ====================

    async logSystemEvent(level, component, message, details = null) {
        await this.executeRun(
            'INSERT INTO system_logs (level, component, message, details) VALUES (?, ?, ?, ?)',
            [level, component, message, details ? JSON.stringify(details) : null]
        );
    }

    async getRecentLogs(limit = 50, level = null) {
        let sql = 'SELECT * FROM system_logs';
        const params = [];

        if (level) {
            sql += ' WHERE level = ?';
            params.push(level);
        }

        sql += ' ORDER BY timestamp DESC LIMIT ?';
        params.push(limit);

        return await this.executeQuery(sql, params);
    }

    async getSystemStats() {
        try {
            const stats = {};

            // Messages today
            const today = new Date().toISOString().split('T')[0];
            const messagesResult = await this.executeQuerySingle(
                `SELECT COUNT(*) as count FROM conversations WHERE DATE(timestamp) = ?`,
                [today]
            );
            stats.messages_today = messagesResult.count;

            // Messages this week
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            const weekResult = await this.executeQuerySingle(
                `SELECT COUNT(*) as count FROM conversations WHERE timestamp >= ?`,
                [weekAgo.toISOString()]
            );
            stats.messages_week = weekResult.count;

            // Total messages
            const totalResult = await this.executeQuerySingle(
                `SELECT COUNT(*) as count FROM conversations`
            );
            stats.messages_total = totalResult.count;

            // Active users today
            const activeUsersResult = await this.executeQuerySingle(
                `SELECT COUNT(DISTINCT contact_id) as count FROM conversations WHERE DATE(timestamp) = ?`,
                [today]
            );
            stats.active_users_today = activeUsersResult.count;

            // Total users
            const totalUsersResult = await this.executeQuerySingle(
                `SELECT COUNT(*) as count FROM users`
            );
            stats.total_users = totalUsersResult.count;

            // Error rate (last 24 hours)
            const errorResult = await this.executeQuerySingle(
                `SELECT 
                    COUNT(CASE WHEN level = 'error' THEN 1 END) as errors,
                    COUNT(*) as total
                 FROM system_logs 
                 WHERE timestamp >= datetime('now', '-1 day')`
            );
            stats.error_rate = errorResult.total > 0 ?
                ((errorResult.errors / errorResult.total) * 100).toFixed(2) : 0;

            // Average response time (estimate from recent conversations)
            const responseTimeResult = await this.executeQuerySingle(
                `SELECT AVG(tokens_used * 0.1) as avg_time FROM conversations 
                 WHERE role = 'assistant' AND timestamp >= datetime('now', '-1 day')`
            );
            stats.avg_response_time = Math.round(responseTimeResult.avg_time || 1000);

            return stats;

        } catch (error) {
            logger.error('❌ Error getting system stats:', error);
            throw error;
        }
    }

    async getConfig(key, defaultValue = null) {
        try {
            const result = await this.executeQuerySingle(
                'SELECT value, type FROM config WHERE key = ?',
                [key]
            );

            if (!result) {
                return defaultValue;
            }

            const { value, type } = result;

            switch (type) {
                case 'number':
                    return parseFloat(value);
                case 'boolean':
                    return value.toLowerCase() === 'true';
                case 'json':
                    return JSON.parse(value);
                default:
                    return value;
            }

        } catch (error) {
            logger.error('❌ Error getting config:', error);
            return defaultValue;
        }
    }

    async setConfig(key, value, description = null) {
        try {
            let valueType, valueStr;

            if (typeof value === 'boolean') {
                valueType = 'boolean';
                valueStr = value.toString();
            } else if (typeof value === 'number') {
                valueType = 'number';
                valueStr = value.toString();
            } else if (typeof value === 'object') {
                valueType = 'json';
                valueStr = JSON.stringify(value);
            } else {
                valueType = 'string';
                valueStr = value.toString();
            }

            await this.executeRun(
                `INSERT OR REPLACE INTO config (key, value, type, description, updated_at)
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [key, valueStr, valueType, description]
            );

        } catch (error) {
            logger.error('❌ Error setting config:', error);
            throw error;
        }
    }

    async cleanupOldData(days = 90) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - days);
            const cutoffStr = cutoffDate.toISOString();

            // Delete old conversations (keep recent ones)
            const conversationResult = await this.executeRun(
                'DELETE FROM conversations WHERE timestamp < ? AND role != "user"',
                [cutoffStr]
            );

            // Delete old rate limits
            const rateLimitResult = await this.executeRun(
                'DELETE FROM rate_limits WHERE window_start < ?',
                [cutoffStr]
            );

            // Delete old system logs (keep errors)
            const logsResult = await this.executeRun(
                'DELETE FROM system_logs WHERE timestamp < ? AND level != "error"',
                [cutoffStr]
            );

            logger.info(`🧹 Cleanup completed: ${conversationResult.changes} conversations, ${rateLimitResult.changes} rate limits, ${logsResult.changes} logs deleted`);

            // Vacuum database to reclaim space
            await this.executeQuery('VACUUM');

            return {
                conversations: conversationResult.changes,
                rateLimits: rateLimitResult.changes,
                logs: logsResult.changes
            };

        } catch (error) {
            logger.error('❌ Error during cleanup:', error);
            throw error;
        }
    }

    isConnected() {
        return this.isConnected && this.db !== null;
    }

    async close() {
        if (this.db) {
            return new Promise((resolve, reject) => {
                this.db.close((err) => {
                    if (err) {
                        logger.error('❌ Error closing database:', err);
                        reject(err);
                    } else {
                        this.isConnected = false;
                        logger.info('✅ Database connection closed');
                        resolve();
                    }
                });
            });
        }
    }
}

module.exports = DatabaseService;
