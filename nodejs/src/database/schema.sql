-- WhatsApp AutoGen Bot Database Schema
-- SQLite Database Schema for complete bot functionality

-- =====================================================
-- USERS/CONTACTS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT UNIQUE NOT NULL,           -- WhatsApp ID (e.g., 1234567890@c.us)
    phone_number TEXT,
    name TEXT,
    profile_pic_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_interaction TIMESTAMP,
    total_messages INTEGER DEFAULT 0,
    is_blacklisted BOOLEAN DEFAULT 0,
    is_whitelisted BOOLEAN DEFAULT 0,
    tags TEXT,                                  -- JSON array of tags
    notes TEXT,
    metadata TEXT                               -- JSON for additional data
);

-- =====================================================
-- CONVERSATIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    contact_id TEXT NOT NULL,
    role TEXT NOT NULL,                         -- 'user' or 'assistant'
    message TEXT NOT NULL,
    agent_name TEXT,                            -- Which agent responded
    tokens_used INTEGER DEFAULT 0,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    message_type TEXT DEFAULT 'text',           -- text, image, audio, etc.
    media_url TEXT,
    metadata TEXT,                              -- JSON for additional data
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- =====================================================
-- BLACKLIST TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT UNIQUE NOT NULL,
    reason TEXT,
    added_by TEXT DEFAULT 'system',
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,                       -- For temporary blocks
    is_active BOOLEAN DEFAULT 1
);

-- =====================================================
-- WHITELIST TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS whitelist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT UNIQUE NOT NULL,
    reason TEXT,
    added_by TEXT DEFAULT 'admin',
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    priority INTEGER DEFAULT 0                  -- Higher priority = faster response
);

-- =====================================================
-- USAGE STATISTICS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS usage_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT NOT NULL,
    date DATE NOT NULL,
    message_count INTEGER DEFAULT 0,
    tokens_used INTEGER DEFAULT 0,
    cost_usd DECIMAL(10, 4) DEFAULT 0,
    agent_calls TEXT,                           -- JSON: {agent_name: count}
    avg_response_time DECIMAL(10, 2),
    UNIQUE(contact_id, date)
);

-- =====================================================
-- RATE LIMITING TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS rate_limits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT NOT NULL,
    window_start TIMESTAMP NOT NULL,
    window_type TEXT NOT NULL,                  -- 'minute', 'hour', 'day'
    message_count INTEGER DEFAULT 0,
    tokens_used INTEGER DEFAULT 0,
    UNIQUE(contact_id, window_start, window_type)
);

-- =====================================================
-- AGENT PERFORMANCE TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS agent_performance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_name TEXT NOT NULL,
    date DATE NOT NULL,
    total_calls INTEGER DEFAULT 0,
    successful_calls INTEGER DEFAULT 0,
    failed_calls INTEGER DEFAULT 0,
    avg_response_time DECIMAL(10, 2),
    total_tokens INTEGER DEFAULT 0,
    cost_usd DECIMAL(10, 4) DEFAULT 0,
    UNIQUE(agent_name, date)
);

-- =====================================================
-- SESSIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT UNIQUE NOT NULL,
    context TEXT,                               -- JSON: conversation state
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    is_active BOOLEAN DEFAULT 1
);

-- =====================================================
-- SYSTEM LOGS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS system_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL,                        -- 'info', 'warning', 'error'
    component TEXT NOT NULL,                    -- 'whatsapp', 'agent', 'bridge', etc.
    message TEXT NOT NULL,
    details TEXT,                               -- JSON
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- CONFIGURATION TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    type TEXT NOT NULL,                         -- 'string', 'number', 'boolean', 'json'
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- MANUAL MESSAGES TABLE (Admin)
-- =====================================================
CREATE TABLE IF NOT EXISTS manual_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id TEXT NOT NULL,
    target_contact TEXT NOT NULL,
    message TEXT NOT NULL,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'sent'
);

-- =====================================================
-- ADMIN ACTIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS admin_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    target_contact TEXT,
    details TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- MANUAL OVERRIDES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS manual_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT NOT NULL,
    override_type TEXT NOT NULL,                -- 'manual', 'pause', 'priority'
    reason TEXT,
    admin_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    status TEXT DEFAULT 'active'                -- 'active', 'expired', 'removed'
);

-- =====================================================
-- NOTIFICATIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    notification_type TEXT NOT NULL,            -- 'startup', 'error', 'high_volume', etc.
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    severity TEXT DEFAULT 'info',               -- 'info', 'warning', 'error', 'critical'
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sent_to TEXT,                               -- Admin contact who received it
    metadata TEXT                               -- JSON for additional data
);

-- =====================================================
-- ALLOWED CONTACTS TABLE (Bot only interacts with these)
-- =====================================================
CREATE TABLE IF NOT EXISTS allowed_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT UNIQUE NOT NULL,          -- WhatsApp ID (e.g., 201080929617@c.us)
    name TEXT,                                 -- Friendly name
    added_by TEXT DEFAULT 'admin',
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_allowed_contacts_contact ON allowed_contacts(contact_id);
CREATE INDEX IF NOT EXISTS idx_allowed_contacts_active ON allowed_contacts(is_active);

-- =====================================================
-- PENDING MESSAGES TABLE (Messages awaiting admin approval)
-- =====================================================
CREATE TABLE IF NOT EXISTS pending_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT NOT NULL,
    contact_name TEXT,
    message_text TEXT NOT NULL,
    ai_response TEXT,                          -- Pre-generated AI response (ready to send on approval)
    status TEXT DEFAULT 'pending',             -- 'pending', 'approved', 'rejected', 'expired'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    resolved_by TEXT                            -- Admin who approved/rejected
);

CREATE INDEX IF NOT EXISTS idx_pending_messages_status ON pending_messages(status);
CREATE INDEX IF NOT EXISTS idx_pending_messages_contact ON pending_messages(contact_id);

-- =====================================================
-- BOT SETTINGS TABLE (Runtime settings)
-- =====================================================
INSERT OR IGNORE INTO config (key, value, type, description) VALUES
('auto_reply_mode', 'true', 'boolean', 'When true, bot replies automatically. When false, messages go to pending queue for admin approval.'),
('allowed_contacts_only', 'false', 'boolean', 'When true, bot only processes messages from allowed_contacts list.');

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_conversations_contact ON conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_conversations_timestamp ON conversations(timestamp);
CREATE INDEX IF NOT EXISTS idx_conversations_role ON conversations(role);

CREATE INDEX IF NOT EXISTS idx_blacklist_contact ON blacklist(contact_id);
CREATE INDEX IF NOT EXISTS idx_blacklist_active ON blacklist(is_active);

CREATE INDEX IF NOT EXISTS idx_whitelist_contact ON whitelist(contact_id);

CREATE INDEX IF NOT EXISTS idx_usage_contact_date ON usage_stats(contact_id, date);
CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_stats(date);

CREATE INDEX IF NOT EXISTS idx_rate_limits_contact ON rate_limits(contact_id);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start, window_type);

CREATE INDEX IF NOT EXISTS idx_agent_perf_name_date ON agent_performance(agent_name, date);

CREATE INDEX IF NOT EXISTS idx_sessions_contact ON sessions(contact_id);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(is_active);

CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON system_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_level ON system_logs(level);
CREATE INDEX IF NOT EXISTS idx_logs_component ON system_logs(component);

CREATE INDEX IF NOT EXISTS idx_overrides_contact ON manual_overrides(contact_id);
CREATE INDEX IF NOT EXISTS idx_overrides_status ON manual_overrides(status);

CREATE INDEX IF NOT EXISTS idx_admin_actions_type ON admin_actions(action_type);
CREATE INDEX IF NOT EXISTS idx_admin_actions_timestamp ON admin_actions(timestamp);

CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(notification_type);
CREATE INDEX IF NOT EXISTS idx_notifications_severity ON notifications(severity);

-- =====================================================
-- INITIAL CONFIGURATION DATA
-- =====================================================
INSERT OR IGNORE INTO config (key, value, type, description) VALUES 
('bot_version', '1.0.0', 'string', 'Current bot version'),
('database_version', '1.0.0', 'string', 'Database schema version'),
('rate_limit_enabled', 'true', 'boolean', 'Enable rate limiting'),
('business_hours_enabled', 'false', 'boolean', 'Enable business hours restrictions'),
('max_conversation_history', '10', 'number', 'Maximum conversation messages to keep in context'),
('default_response_timeout', '30000', 'number', 'Default response timeout in milliseconds'),
('enable_notifications', 'true', 'boolean', 'Enable admin notifications'),
('notification_rate_limit', '5', 'number', 'Max notifications per hour to prevent spam');

-- =====================================================
-- VIEWS FOR COMMON QUERIES
-- =====================================================
CREATE VIEW IF NOT EXISTS active_conversations AS
SELECT 
    u.contact_id,
    u.name,
    u.phone_number,
    COUNT(c.id) as message_count,
    MAX(c.timestamp) as last_message,
    u.is_blacklisted,
    u.is_whitelisted
FROM users u
LEFT JOIN conversations c ON u.id = c.user_id
WHERE u.last_interaction >= datetime('now', '-7 days')
GROUP BY u.contact_id, u.name, u.phone_number, u.is_blacklisted, u.is_whitelisted;

CREATE VIEW IF NOT EXISTS daily_stats AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_messages,
    COUNT(DISTINCT contact_id) as unique_contacts,
    AVG(CASE WHEN role = 'assistant' THEN tokens_used END) as avg_tokens,
    COUNT(CASE WHEN role = 'user' THEN 1 END) as incoming_messages,
    COUNT(CASE WHEN role = 'assistant' THEN 1 END) as outgoing_messages
FROM conversations
WHERE timestamp >= datetime('now', '-30 days')
GROUP BY DATE(timestamp)
ORDER BY date DESC;

-- =====================================================
-- TRIGGERS FOR DATA INTEGRITY
-- =====================================================
-- Update user last_interaction when new conversation
CREATE TRIGGER IF NOT EXISTS update_user_last_interaction 
AFTER INSERT ON conversations
BEGIN
    UPDATE users 
    SET last_interaction = NEW.timestamp,
        total_messages = total_messages + 1
    WHERE id = NEW.user_id;
END;

-- Clean up expired rate limits
CREATE TRIGGER IF NOT EXISTS cleanup_expired_rate_limits
AFTER INSERT ON rate_limits
BEGIN
    DELETE FROM rate_limits 
    WHERE window_start < datetime('now', '-1 day') AND window_type = 'day';
    
    DELETE FROM rate_limits 
    WHERE window_start < datetime('now', '-1 hour') AND window_type = 'hour';
    
    DELETE FROM rate_limits 
    WHERE window_start < datetime('now', '-1 minute') AND window_type = 'minute';
END;

-- Clean up old system logs (keep last 10000 entries)
CREATE TRIGGER IF NOT EXISTS cleanup_old_logs
AFTER INSERT ON system_logs
WHEN (SELECT COUNT(*) FROM system_logs) > 10000
BEGIN
    DELETE FROM system_logs 
    WHERE id NOT IN (
        SELECT id FROM system_logs 
        ORDER BY timestamp DESC 
        LIMIT 10000
    );
END;
