/**
 * PostgreSQL Database Adapter
 * Implements IDatabase interface for PostgreSQL
 * Enables easy switching from SQLite to PostgreSQL for production
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const IDatabase = require('../../core/interfaces/IDatabase');
const logger = require('../../utils/logger');

class PostgreSQLAdapter extends IDatabase {
    constructor(config = {}) {
        super();
        this.config = {
            host: config.host || process.env.PG_HOST || 'localhost',
            port: config.port || process.env.PG_PORT || 5432,
            database: config.database || process.env.PG_DATABASE || 'whatsapp_bot',
            user: config.user || process.env.PG_USER || 'postgres',
            password: config.password || process.env.PG_PASSWORD || '',
            max: config.max || 20, // Maximum pool connections
            idleTimeoutMillis: config.idleTimeoutMillis || 30000,
            connectionTimeoutMillis: config.connectionTimeoutMillis || 2000,
            ssl: config.ssl || process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
            ...config
        };
        this.pool = null;
        this.isConnected = false;
    }

    async connect() {
        try {
            this.pool = new Pool(this.config);
            
            // Test connection
            const client = await this.pool.connect();
            client.release();
            
            this.isConnected = true;
            logger.info(`✅ PostgreSQL connected: ${this.config.host}:${this.config.port}/${this.config.database}`);
        } catch (error) {
            logger.error('❌ Failed to connect to PostgreSQL:', error);
            throw error;
        }
    }

    async disconnect() {
        if (this.pool) {
            await this.pool.end();
            this.isConnected = false;
            logger.info('✅ PostgreSQL disconnected');
        }
    }

    async isConnected() {
        return this.isConnected && this.pool;
    }

    async initializeSchema() {
        // Load and convert SQLite schema to PostgreSQL
        const schemaPath = path.join(__dirname, '../schemas/postgresql_schema.sql');
        
        if (!fs.existsSync(schemaPath)) {
            // Convert SQLite schema to PostgreSQL compatible
            await this.convertAndCreateSchema();
        } else {
            const schema = fs.readFileSync(schemaPath, 'utf8');
            await this.executeScript(schema);
        }
        
        logger.info('✅ PostgreSQL schema initialized');
    }

    async convertAndCreateSchema() {
        // PostgreSQL compatible schema
        const schema = `
            -- Users Table
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                contact_id VARCHAR(255) UNIQUE NOT NULL,
                name VARCHAR(255),
                phone_number VARCHAR(50),
                profile_pic_url TEXT,
                tags JSONB,
                notes TEXT,
                metadata JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_interaction TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Conversations Table
            CREATE TABLE IF NOT EXISTS conversations (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                contact_id VARCHAR(255) NOT NULL,
                role VARCHAR(50) NOT NULL,
                message TEXT NOT NULL,
                agent_name VARCHAR(100),
                tokens_used INTEGER DEFAULT 0,
                message_type VARCHAR(50) DEFAULT 'text',
                media_url TEXT,
                metadata JSONB,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Blacklist Table
            CREATE TABLE IF NOT EXISTS blacklist (
                id SERIAL PRIMARY KEY,
                contact_id VARCHAR(255) UNIQUE NOT NULL,
                reason TEXT,
                admin_id VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Whitelist Table
            CREATE TABLE IF NOT EXISTS whitelist (
                id SERIAL PRIMARY KEY,
                contact_id VARCHAR(255) UNIQUE NOT NULL,
                reason TEXT,
                admin_id VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Usage Statistics Table
            CREATE TABLE IF NOT EXISTS usage_stats (
                id SERIAL PRIMARY KEY,
                contact_id VARCHAR(255) NOT NULL,
                date DATE NOT NULL,
                total_messages INTEGER DEFAULT 0,
                total_tokens INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(contact_id, date)
            );

            -- Rate Limits Table
            CREATE TABLE IF NOT EXISTS rate_limits (
                id SERIAL PRIMARY KEY,
                contact_id VARCHAR(255) NOT NULL,
                window_start TIMESTAMP NOT NULL,
                message_count INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Agent Performance Table
            CREATE TABLE IF NOT EXISTS agent_performance (
                id SERIAL PRIMARY KEY,
                agent_name VARCHAR(100) NOT NULL,
                date DATE NOT NULL,
                total_calls INTEGER DEFAULT 0,
                successful_calls INTEGER DEFAULT 0,
                total_response_time INTEGER DEFAULT 0,
                total_tokens INTEGER DEFAULT 0,
                average_confidence DECIMAL(3,2) DEFAULT 0.50,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(agent_name, date)
            );

            -- Configuration Table
            CREATE TABLE IF NOT EXISTS config (
                key VARCHAR(255) PRIMARY KEY,
                value TEXT NOT NULL,
                type VARCHAR(50) NOT NULL DEFAULT 'string',
                description TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Admin Users Table
            CREATE TABLE IF NOT EXISTS admin_users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                two_factor_enabled BOOLEAN DEFAULT FALSE,
                two_factor_secret VARCHAR(255),
                role VARCHAR(100) DEFAULT 'admin',
                is_active BOOLEAN DEFAULT TRUE,
                last_login TIMESTAMP,
                failed_login_attempts INTEGER DEFAULT 0,
                locked_until TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- System Logs Table
            CREATE TABLE IF NOT EXISTS system_logs (
                id SERIAL PRIMARY KEY,
                level VARCHAR(20) NOT NULL,
                component VARCHAR(100) NOT NULL,
                message TEXT NOT NULL,
                metadata JSONB,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Create Indexes for Performance
            CREATE INDEX IF NOT EXISTS idx_conversations_contact_id ON conversations(contact_id);
            CREATE INDEX IF NOT EXISTS idx_conversations_timestamp ON conversations(timestamp);
            CREATE INDEX IF NOT EXISTS idx_conversations_agent_name ON conversations(agent_name);
            CREATE INDEX IF NOT EXISTS idx_rate_limits_contact_window ON rate_limits(contact_id, window_start);
            CREATE INDEX IF NOT EXISTS idx_usage_stats_contact_date ON usage_stats(contact_id, date);
            CREATE INDEX IF NOT EXISTS idx_system_logs_component ON system_logs(component);
            CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level);
        `;

        await this.executeScript(schema);
    }

    async executeScript(script) {
        const client = await this.pool.connect();
        try {
            const statements = script.split(';').filter(stmt => stmt.trim().length > 0);
            
            for (const statement of statements) {
                try {
                    await client.query(statement.trim());
                } catch (error) {
                    if (!error.message.includes('already exists')) {
                        logger.debug(`PostgreSQL statement execution: ${error.message}`);
                    }
                }
            }
            
            logger.info('✅ PostgreSQL script executed successfully');
        } finally {
            client.release();
        }
    }

    async executeQuery(sql, params = []) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(sql, params);
            return result.rows;
        } finally {
            client.release();
        }
    }

    async executeQuerySingle(sql, params = []) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(sql, params);
            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    async executeRun(sql, params = []) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(sql, params);
            return {
                lastID: result.rows[0]?.id || null,
                changes: result.rowCount || 0
            };
        } finally {
            client.release();
        }
    }

    async getOrCreateUser(contactId, name = null, phoneNumber = null) {
        try {
            let user = await this.executeQuerySingle(
                'SELECT * FROM users WHERE contact_id = $1',
                [contactId]
            );

            if (user) {
                await this.executeRun(
                    'UPDATE users SET last_interaction = CURRENT_TIMESTAMP WHERE id = $1',
                    [user.id]
                );
                return user;
            }

            const result = await this.executeQuerySingle(
                `INSERT INTO users (contact_id, name, phone_number, created_at, last_interaction)
                 VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                 RETURNING *`,
                [contactId, name, phoneNumber]
            );

            logger.info(`👤 New user created: ${contactId} (${name || 'Unknown'})`);
            return result;

        } catch (error) {
            logger.error('❌ Error in getOrCreateUser:', error);
            throw error;
        }
    }

    async updateUserProfile(contactId, updates) {
        const allowedFields = ['name', 'phone_number', 'profile_pic_url', 'tags', 'notes', 'metadata'];
        const fields = [];
        const values = [];
        let paramIndex = 1;

        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                fields.push(`${key} = $${paramIndex}`);
                if (key === 'tags' || key === 'metadata') {
                    values.push(JSON.stringify(value));
                } else {
                    values.push(value);
                }
                paramIndex++;
            }
        }

        if (fields.length === 0) return;

        values.push(contactId);
        const sql = `UPDATE users SET ${fields.join(', ')} WHERE contact_id = $${paramIndex}`;

        await this.executeRun(sql, values);
        logger.debug(`👤 User profile updated: ${contactId}`);
    }

    async getUserById(id) {
        return await this.executeQuerySingle('SELECT * FROM users WHERE id = $1', [id]);
    }

    async saveMessage(contactId, role, message, agentName = null, tokensUsed = 0, messageType = 'text', mediaUrl = null, metadata = null) {
        try {
            const user = await this.getOrCreateUser(contactId);

            const result = await this.executeQuerySingle(
                `INSERT INTO conversations 
                 (user_id, contact_id, role, message, agent_name, tokens_used, message_type, media_url, metadata)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING id`,
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
            return result.id;

        } catch (error) {
            logger.error('❌ Error saving message:', error);
            throw error;
        }
    }

    async getConversationHistory(contactId, limit = 10) {
        return await this.executeQuery(
            `SELECT * FROM conversations 
             WHERE contact_id = $1 
             ORDER BY timestamp DESC 
             LIMIT $2`,
            [contactId, limit]
        );
    }

    async deleteConversationHistory(contactId) {
        const result = await this.executeRun(
            'DELETE FROM conversations WHERE contact_id = $1',
            [contactId]
        );
        return result.changes;
    }

    async isBlacklisted(contactId) {
        const result = await this.executeQuerySingle(
            'SELECT COUNT(*) as count FROM blacklist WHERE contact_id = $1',
            [contactId]
        );
        return parseInt(result.count) > 0;
    }

    async isWhitelisted(contactId) {
        const result = await this.executeQuerySingle(
            'SELECT COUNT(*) as count FROM whitelist WHERE contact_id = $1',
            [contactId]
        );
        return parseInt(result.count) > 0;
    }

    async addToBlacklist(contactId, reason, adminId) {
        return await this.executeRun(
            'INSERT INTO blacklist (contact_id, reason, admin_id) VALUES ($1, $2, $3) ON CONFLICT (contact_id) DO NOTHING',
            [contactId, reason, adminId]
        );
    }

    async removeFromBlacklist(contactId, adminId) {
        return await this.executeRun(
            'DELETE FROM blacklist WHERE contact_id = $1',
            [contactId]
        );
    }

    async addToWhitelist(contactId, reason, adminId) {
        return await this.executeRun(
            'INSERT INTO whitelist (contact_id, reason, admin_id) VALUES ($1, $2, $3) ON CONFLICT (contact_id) DO NOTHING',
            [contactId, reason, adminId]
        );
    }

    async removeFromWhitelist(contactId, adminId) {
        return await this.executeRun(
            'DELETE FROM whitelist WHERE contact_id = $1',
            [contactId]
        );
    }

    async getRateLimitData(contactId, windowMinutes) {
        const windowStart = new Date(Date.now() - (windowMinutes * 60 * 1000));
        return await this.executeQuery(
            `SELECT * FROM rate_limits 
             WHERE contact_id = $1 AND window_start >= $2`,
            [contactId, windowStart.toISOString()]
        );
    }

    async updateRateLimit(contactId, windowStart, messageCount) {
        return await this.executeRun(
            `INSERT INTO rate_limits (contact_id, window_start, message_count) 
             VALUES ($1, $2, $3)
             ON CONFLICT (contact_id, window_start) DO UPDATE SET
             message_count = $3`,
            [contactId, windowStart, messageCount]
        );
    }

    async cleanupOldRateLimits() {
        const cutoff = new Date(Date.now() - (24 * 60 * 60 * 1000)); // 24 hours ago
        return await this.executeRun(
            'DELETE FROM rate_limits WHERE window_start < $1',
            [cutoff.toISOString()]
        );
    }

    async updateUsageStats(contactId, tokensUsed, messageCount) {
        const today = new Date().toISOString().split('T')[0];
        return await this.executeRun(
            `INSERT INTO usage_stats (contact_id, date, total_messages, total_tokens) 
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (contact_id, date) DO UPDATE SET
             total_messages = usage_stats.total_messages + $3,
             total_tokens = usage_stats.total_tokens + $4`,
            [contactId, today, messageCount, tokensUsed]
        );
    }

    async getUsageStats(contactId, days = 7) {
        const startDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
        return await this.executeQuery(
            `SELECT * FROM usage_stats 
             WHERE contact_id = $1 AND date >= $2 
             ORDER BY date DESC`,
            [contactId, startDate]
        );
    }

    async logAgentPerformance(agentName, responseTime, success, tokensUsed, confidence) {
        const today = new Date().toISOString().split('T')[0];
        return await this.executeRun(
            `INSERT INTO agent_performance 
             (agent_name, date, total_calls, successful_calls, total_response_time, total_tokens, average_confidence)
             VALUES ($1, $2, 1, $3, $4, $5, $6)
             ON CONFLICT (agent_name, date) DO UPDATE SET
             total_calls = agent_performance.total_calls + 1,
             successful_calls = agent_performance.successful_calls + $3,
             total_response_time = agent_performance.total_response_time + $4,
             total_tokens = agent_performance.total_tokens + $5,
             average_confidence = (agent_performance.average_confidence * agent_performance.total_calls + $6) / (agent_performance.total_calls + 1)`,
            [agentName, today, success ? 1 : 0, responseTime, tokensUsed, confidence || 0.5]
        );
    }

    async getAgentPerformanceStats(agentName, days = 7) {
        const startDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
        return await this.executeQuery(
            `SELECT * FROM agent_performance 
             WHERE agent_name = $1 AND date >= $2 
             ORDER BY date DESC`,
            [agentName, startDate]
        );
    }

    async getConfig(key) {
        const result = await this.executeQuerySingle(
            'SELECT value, type FROM config WHERE key = $1',
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
            `INSERT INTO config (key, value, type) VALUES ($1, $2, $3)
             ON CONFLICT (key) DO UPDATE SET
             value = $2, type = $3, updated_at = CURRENT_TIMESTAMP`,
            [key, storedValue, type]
        );
    }

    async getAdminUser(username) {
        return await this.executeQuerySingle(
            'SELECT * FROM admin_users WHERE username = $1',
            [username]
        );
    }

    async createAdminUser(userData) {
        const result = await this.executeQuerySingle(
            `INSERT INTO admin_users 
             (username, email, password_hash, two_factor_enabled, two_factor_secret, role, is_active) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
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
        return result.id;
    }

    async logAdminAction(adminId, actionType, details, target) {
        return await this.executeRun(
            'INSERT INTO admin_actions (admin_id, action_type, details, target) VALUES ($1, $2, $3, $4)',
            [adminId, actionType, details, target]
        );
    }

    async logSystem(level, component, message, metadata = null) {
        return await this.executeRun(
            'INSERT INTO system_logs (level, component, message, metadata) VALUES ($1, $2, $3, $4)',
            [level, component, message, metadata ? JSON.stringify(metadata) : null]
        );
    }

    async getSystemLogs(component = null, level = null, limit = 100) {
        let sql = 'SELECT * FROM system_logs';
        const params = [];
        const conditions = [];
        let paramIndex = 1;

        if (component) {
            conditions.push(`component = $${paramIndex}`);
            params.push(component);
            paramIndex++;
        }

        if (level) {
            conditions.push(`level = $${paramIndex}`);
            params.push(level);
            paramIndex++;
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        sql += ` ORDER BY timestamp DESC LIMIT $${paramIndex}`;
        params.push(limit);

        return await this.executeQuery(sql, params);
    }
}

module.exports = PostgreSQLAdapter;
