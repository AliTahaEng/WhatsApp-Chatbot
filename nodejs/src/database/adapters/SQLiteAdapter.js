/**
 * SQLite Database Adapter
 * Implements IDatabase interface for SQLite
 * Can be easily swapped with PostgreSQLAdapter, MongoDBAdapter, etc.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const IDatabase = require('../../core/interfaces/IDatabase');
const logger = require('../../utils/logger');

class SQLiteAdapter extends IDatabase {
    constructor(config = {}) {
        super();
        this.dbPath = config.dbPath || process.env.DATABASE_PATH || './data/database.db';
        this.db = null;
        this.isConnected = false;
        this.config = {
            journalMode: config.journalMode || 'WAL',
            synchronous: config.synchronous || 'NORMAL',
            cacheSize: config.cacheSize || 10000,
            busyTimeout: config.busyTimeout || 5000,
            ...config
        };
    }

    async connect() {
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
                    logger.error('❌ SQLite connection error:', err);
                    throw err;
                }
            });

            // Configure SQLite
            await this.executeQuery('PRAGMA foreign_keys = ON');
            await this.executeQuery(`PRAGMA journal_mode = ${this.config.journalMode}`);
            await this.executeQuery(`PRAGMA synchronous = ${this.config.synchronous}`);
            await this.executeQuery(`PRAGMA cache_size = ${this.config.cacheSize}`);
            await this.executeQuery(`PRAGMA busy_timeout = ${this.config.busyTimeout}`);

            this.isConnected = true;
            logger.info(`✅ SQLite connected: ${this.dbPath}`);
        } catch (error) {
            logger.error('❌ Failed to connect to SQLite:', error);
            throw error;
        }
    }

    async disconnect() {
        if (this.db) {
            return new Promise((resolve, reject) => {
                this.db.close((err) => {
                    if (err) {
                        logger.error('❌ Error closing SQLite:', err);
                        reject(err);
                    } else {
                        this.isConnected = false;
                        logger.info('✅ SQLite disconnected');
                        resolve();
                    }
                });
            });
        }
    }

    async isConnected() {
        return this.isConnected;
    }

    async initializeSchema() {
        const schemaPath = path.join(__dirname, '../schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        await this.executeScript(schema);

        const adminSchemaPath = path.join(__dirname, '../admin_schema.sql');
        if (fs.existsSync(adminSchemaPath)) {
            const adminSchema = fs.readFileSync(adminSchemaPath, 'utf8');
            await this.executeScript(adminSchema);
        }

        logger.info('✅ SQLite schema initialized');
    }

    async executeScript(script) {
        const statements = script.split(';').filter(stmt => stmt.trim().length > 0);

        for (const statement of statements) {
            try {
                await this.executeRun(statement.trim());
            } catch (error) {
                if (!error.message.includes('already exists')) {
                    logger.debug(`SQLite statement execution: ${error.message}`);
                }
            }
        }

        logger.info('✅ SQLite script executed successfully');
    }

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

    async getOrCreateUser(contactId, name = null, phoneNumber = null) {
        try {
            let user = await this.executeQuerySingle(
                'SELECT * FROM users WHERE contact_id = ?',
                [contactId]
            );

            if (user) {
                await this.executeRun(
                    'UPDATE users SET last_interaction = CURRENT_TIMESTAMP WHERE id = ?',
                    [user.id]
                );
                return user;
            }

            const result = await this.executeRun(
                `INSERT INTO users (contact_id, name, phone_number, created_at, last_interaction)
                 VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [contactId, name, phoneNumber]
            );

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

        if (fields.length === 0) return;

        values.push(contactId);
        const sql = `UPDATE users SET ${fields.join(', ')} WHERE contact_id = ?`;

        await this.executeRun(sql, values);
        logger.debug(`👤 User profile updated: ${contactId}`);
    }

    async getUserById(id) {
        return await this.executeQuerySingle('SELECT * FROM users WHERE id = ?', [id]);
    }

    async saveMessage(contactId, role, message, agentName = null, tokensUsed = 0, messageType = 'text', mediaUrl = null, metadata = null) {
        try {
            const user = await this.getOrCreateUser(contactId);

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

    async getConversationHistory(contactId, limit = 10) {
        return await this.executeQuery(
            `SELECT * FROM conversations 
             WHERE contact_id = ? 
             ORDER BY timestamp DESC 
             LIMIT ?`,
            [contactId, limit]
        );
    }

    async deleteConversationHistory(contactId) {
        const result = await this.executeRun(
            'DELETE FROM conversations WHERE contact_id = ?',
            [contactId]
        );
        return result.changes;
    }

    async isBlacklisted(contactId) {
        const result = await this.executeQuerySingle(
            'SELECT COUNT(*) as count FROM blacklist WHERE contact_id = ?',
            [contactId]
        );
        return result.count > 0;
    }

    async isWhitelisted(contactId) {
        const result = await this.executeQuerySingle(
            'SELECT COUNT(*) as count FROM whitelist WHERE contact_id = ?',
            [contactId]
        );
        return result.count > 0;
    }

    async addToBlacklist(contactId, reason, adminId) {
        return await this.executeRun(
            'INSERT OR IGNORE INTO blacklist (contact_id, reason, admin_id) VALUES (?, ?, ?)',
            [contactId, reason, adminId]
        );
    }

    async removeFromBlacklist(contactId, adminId) {
        return await this.executeRun(
            'DELETE FROM blacklist WHERE contact_id = ?',
            [contactId]
        );
    }

    async addToWhitelist(contactId, reason, adminId) {
        return await this.executeRun(
            'INSERT OR IGNORE INTO whitelist (contact_id, reason, admin_id) VALUES (?, ?, ?)',
            [contactId, reason, adminId]
        );
    }

    async removeFromWhitelist(contactId, adminId) {
        return await this.executeRun(
            'DELETE FROM whitelist WHERE contact_id = ?',
            [contactId]
        );
    }

    async getRateLimitData(contactId, windowMinutes) {
        const windowStart = new Date(Date.now() - (windowMinutes * 60 * 1000));
        return await this.executeQuery(
            `SELECT * FROM rate_limits 
             WHERE contact_id = ? AND window_start >= ?`,
            [contactId, windowStart.toISOString()]
        );
    }

    async updateRateLimit(contactId, windowStart, messageCount, windowType = 'hour') {
        return await this.executeRun(
            `INSERT OR REPLACE INTO rate_limits 
             (contact_id, window_start, window_type, message_count) 
             VALUES (?, ?, ?, ?)`,
            [contactId, windowStart, windowType, messageCount]
        );
    }

    async cleanupOldRateLimits() {
        const cutoff = new Date(Date.now() - (24 * 60 * 60 * 1000)); // 24 hours ago
        return await this.executeRun(
            'DELETE FROM rate_limits WHERE window_start < ?',
            [cutoff.toISOString()]
        );
    }

    async updateUsageStats(contactId, tokensUsed, messageCount) {
        const today = new Date().toISOString().split('T')[0];
        return await this.executeRun(
            `INSERT OR REPLACE INTO usage_stats 
             (contact_id, date, total_messages, total_tokens) 
             VALUES (?, ?, 
                COALESCE((SELECT total_messages FROM usage_stats WHERE contact_id = ? AND date = ?), 0) + ?,
                COALESCE((SELECT total_tokens FROM usage_stats WHERE contact_id = ? AND date = ?), 0) + ?
             )`,
            [contactId, today, contactId, today, messageCount, contactId, today, tokensUsed]
        );
    }

    async getUsageStats(contactId, days = 7) {
        const startDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
        return await this.executeQuery(
            `SELECT * FROM usage_stats 
             WHERE contact_id = ? AND date >= ? 
             ORDER BY date DESC`,
            [contactId, startDate]
        );
    }
    async logAgentPerformance(agentName, responseTime, success, tokensUsed, confidence) {
        const today = new Date().toISOString().split('T')[0];
        return await this.executeRun(
            `INSERT INTO agent_performance 
             (agent_name, date, total_calls, successful_calls, total_response_time, total_tokens, average_confidence)
             VALUES (?, ?, 1, ?, ?, ?, ?)
             ON CONFLICT(agent_name, date) DO UPDATE SET
             total_calls = total_calls + 1,
             successful_calls = successful_calls + ?,
             total_response_time = total_response_time + ?,
             total_tokens = total_tokens + ?,
             average_confidence = (average_confidence * (total_calls - 1) + ?) / total_calls`,
            [agentName, today, success ? 1 : 0, responseTime, tokensUsed, confidence || 0.5,
                success ? 1 : 0, responseTime, tokensUsed, confidence || 0.5]
        );
    }

    async getAgentPerformanceStats(agentName, days = 7) {
        const startDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
        return await this.executeQuery(
            `SELECT * FROM agent_performance 
             WHERE agent_name = ? AND date >= ? 
             ORDER BY date DESC`,
            [agentName, startDate]
        );
    }

    async getConfig(key) {
        const result = await this.executeQuerySingle(
            'SELECT value, type FROM config WHERE key = ?',
            [key]
        );

        if (!result) return null;

        switch (result.type) {
            case 'number': return parseFloat(result.value);
            case 'boolean': return result.value === 'true';
            case 'json': return JSON.parse(result.value);
            default: return result.value;
        }
    }

    async setConfig(key, value, type = 'string') {
        let storedValue = value;

        switch (type) {
            case 'number': storedValue = value.toString(); break;
            case 'boolean': storedValue = value.toString(); break;
            case 'json': storedValue = JSON.stringify(value); break;
        }

        return await this.executeRun(
            'INSERT OR REPLACE INTO config (key, value, type) VALUES (?, ?, ?)',
            [key, storedValue, type]
        );
    }

    normalizeContactId(contactId) {
        if (!contactId) return contactId;
        let id = String(contactId).trim().toLowerCase();

        // If it already looks like a WhatsApp JID, keep it (but normalize casing)
        if (id.includes('@')) {
            return id;
        }

        // Otherwise treat it as a phone number; strip non-digits and append @c.us
        id = id.replace(/[^0-9]/g, '');
        return `${id}@c.us`;
    }

    // =====================================================
    // ALLOWED CONTACTS METHODS
    // =====================================================

    async getAllowedContacts() {
        return await this.executeQuery(
            'SELECT * FROM allowed_contacts WHERE is_active = 1 ORDER BY added_at DESC'
        );
    }

    async isAllowedContact(contactId) {
        const normalized = this.normalizeContactId(contactId);
        const result = await this.executeQuerySingle(
            'SELECT COUNT(*) as count FROM allowed_contacts WHERE contact_id = ? AND is_active = 1',
            [normalized]
        );
        return result.count > 0;
    }

    async addAllowedContact(contactId, name, addedBy = 'admin') {
        const normalized = this.normalizeContactId(contactId);
        return await this.executeRun(
            'INSERT OR IGNORE INTO allowed_contacts (contact_id, name, added_by) VALUES (?, ?, ?)',
            [normalized, name, addedBy]
        );
    }

    async removeAllowedContact(contactId) {
        const normalized = this.normalizeContactId(contactId);
        return await this.executeRun(
            'DELETE FROM allowed_contacts WHERE contact_id = ?',
            [normalized]
        );
    }

    // =====================================================
    // PENDING MESSAGES METHODS
    // =====================================================

    async addPendingMessage(contactId, contactName, messageText, aiResponse = null) {
        return await this.executeRun(
            'INSERT INTO pending_messages (contact_id, contact_name, message_text, ai_response) VALUES (?, ?, ?, ?)',
            [contactId, contactName, messageText, aiResponse]
        );
    }

    async getPendingMessages() {
        return await this.executeQuery(
            "SELECT * FROM pending_messages WHERE status = 'pending' ORDER BY created_at DESC"
        );
    }

    async getPendingMessageById(id) {
        return await this.executeQuerySingle(
            'SELECT * FROM pending_messages WHERE id = ?',
            [id]
        );
    }

    async resolvePendingMessage(id, status, resolvedBy) {
        return await this.executeRun(
            'UPDATE pending_messages SET status = ?, resolved_at = CURRENT_TIMESTAMP, resolved_by = ? WHERE id = ?',
            [status, resolvedBy, id]
        );
    }

    async getPendingCount() {
        const result = await this.executeQuerySingle(
            "SELECT COUNT(*) as count FROM pending_messages WHERE status = 'pending'"
        );
        return result.count;
    }

    // =====================================================
    // BOT SETTINGS HELPERS
    // =====================================================

    async isAutoReplyEnabled() {
        return await this.getConfig('auto_reply_mode') ?? true;
    }

    async setAutoReplyMode(enabled) {
        return await this.setConfig('auto_reply_mode', enabled, 'boolean');
    }

    async isAllowedContactsOnly() {
        return await this.getConfig('allowed_contacts_only') ?? false;
    }

    async setAllowedContactsOnly(enabled) {
        return await this.setConfig('allowed_contacts_only', enabled, 'boolean');
    }

    async isVoiceRepliesEnabled() {
        return await this.getConfig('voice_replies_enabled') ?? false;
    }

    async setVoiceRepliesMode(enabled) {
        return await this.setConfig('voice_replies_enabled', enabled, 'boolean');
    }

    async getAdminUser(username) {
        return await this.executeQuerySingle(
            'SELECT * FROM admin_users WHERE username = ?',
            [username]
        );
    }

    async createAdminUser(userData) {
        const result = await this.executeRun(
            `INSERT INTO admin_users 
             (username, email, password_hash, two_factor_enabled, two_factor_secret, role, is_active) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                userData.username,
                userData.email,
                userData.passwordHash,
                userData.twoFactorEnabled || false,
                userData.twoFactorSecret || null,
                userData.role || 'admin',
                userData.isActive !== false
            ]
        );
        return result.lastID;
    }

    async logAdminAction(adminId, actionType, details, target) {
        return await this.executeRun(
            'INSERT INTO admin_actions (admin_id, action_type, details, target) VALUES (?, ?, ?, ?)',
            [adminId, actionType, details, target]
        );
    }

    async logSystem(level, component, message, metadata = null) {
        return await this.executeRun(
            'INSERT INTO system_logs (level, component, message, metadata) VALUES (?, ?, ?, ?)',
            [level, component, message, metadata ? JSON.stringify(metadata) : null]
        );
    }

    async getSystemLogs(component = null, level = null, limit = 100) {
        let sql = 'SELECT * FROM system_logs';
        const params = [];
        const conditions = [];

        if (component) {
            conditions.push('component = ?');
            params.push(component);
        }

        if (level) {
            conditions.push('level = ?');
            params.push(level);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        sql += ' ORDER BY timestamp DESC LIMIT ?';
        params.push(limit);

        return await this.executeQuery(sql, params);
    }
}

module.exports = SQLiteAdapter;
