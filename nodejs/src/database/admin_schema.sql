-- Admin System Database Extensions
-- Additional tables for authentication, notifications, and session management

-- Admin users table
CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    two_factor_enabled BOOLEAN DEFAULT FALSE,
    two_factor_secret TEXT, -- encrypted 2FA secret
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    status TEXT DEFAULT 'active', -- active, disabled, locked
    login_attempts INTEGER DEFAULT 0,
    locked_until DATETIME
);

-- Admin sessions table
CREATE TABLE IF NOT EXISTS admin_sessions (
    session_id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT,
    user_agent TEXT,
    status TEXT DEFAULT 'active', -- active, expired, revoked
    FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

-- Admin login attempts table
CREATE TABLE IF NOT EXISTS admin_login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id TEXT,
    ip_address TEXT,
    success BOOLEAN NOT NULL,
    reason TEXT,
    session_id TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_agent TEXT
);

-- Admin notifications table
CREATE TABLE IF NOT EXISTS admin_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    data TEXT NOT NULL, -- JSON data
    status TEXT DEFAULT 'pending', -- pending, sent, failed, rate_limited
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME,
    retry_count INTEGER DEFAULT 0
);

-- Admin actions audit log (enhanced)
CREATE TABLE IF NOT EXISTS admin_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id TEXT NOT NULL,
    session_id TEXT,
    action_type TEXT NOT NULL, -- login, logout, send_message, bot_control, etc.
    target TEXT, -- what was affected (contact_id, system, agent_name, etc.)
    details TEXT, -- JSON details of the action
    ip_address TEXT,
    user_agent TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT,
    FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

-- Manual messages table (enhanced)
CREATE TABLE IF NOT EXISTS manual_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id TEXT NOT NULL,
    session_id TEXT,
    contact_id TEXT NOT NULL,
    message_content TEXT NOT NULL,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    source TEXT DEFAULT 'dashboard', -- dashboard, whatsapp_command, api
    status TEXT DEFAULT 'sent', -- sent, failed, pending
    error_message TEXT,
    message_type TEXT DEFAULT 'text', -- text, image, document, etc.
    FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

-- Manual overrides table (enhanced)
CREATE TABLE IF NOT EXISTS manual_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT,
    override_type TEXT NOT NULL DEFAULT 'manual', -- manual, global, vip, maintenance
    reason TEXT,
    admin_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    status TEXT DEFAULT 'active', -- active, expired, removed
    priority INTEGER DEFAULT 1, -- 1=normal, 2=high, 3=critical
    FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

-- System configuration table (enhanced)
CREATE TABLE IF NOT EXISTS system_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL, -- admin, notifications, security, etc.
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    admin_id TEXT, -- who last modified
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(category, key),
    FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
);

-- Dashboard activity log
CREATE TABLE IF NOT EXISTS dashboard_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id TEXT NOT NULL,
    session_id TEXT,
    activity_type TEXT NOT NULL, -- page_view, api_call, action
    details TEXT, -- JSON details
    ip_address TEXT,
    user_agent TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

-- API keys and tokens table
CREATE TABLE IF NOT EXISTS api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id TEXT NOT NULL,
    token_name TEXT NOT NULL,
    token_hash TEXT NOT NULL, -- hashed API token
    permissions TEXT NOT NULL, -- JSON array of permissions
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    last_used DATETIME,
    status TEXT DEFAULT 'active', -- active, disabled, expired
    ip_whitelist TEXT, -- JSON array of allowed IPs
    FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

-- Performance metrics table
CREATE TABLE IF NOT EXISTS performance_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_name TEXT NOT NULL,
    metric_value REAL NOT NULL,
    metric_unit TEXT, -- ms, mb, count, percentage
    category TEXT, -- system, database, api, agents
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    details TEXT -- JSON additional data
);

-- Security events table
CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL, -- login_failure, session_hijack, rate_limit, etc.
    severity TEXT NOT NULL, -- low, medium, high, critical
    source_ip TEXT,
    user_agent TEXT,
    admin_id TEXT,
    description TEXT NOT NULL,
    details TEXT, -- JSON additional data
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_by TEXT,
    resolved_at DATETIME,
    FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE SET NULL,
    FOREIGN KEY (resolved_by) REFERENCES admin_users(id) ON DELETE SET NULL
);

-- Indexes for performance optimization
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_status ON admin_sessions(status);

CREATE INDEX IF NOT EXISTS idx_login_attempts_admin ON admin_login_attempts(admin_id);
CREATE INDEX IF NOT EXISTS idx_login_attempts_timestamp ON admin_login_attempts(timestamp);
CREATE INDEX IF NOT EXISTS idx_login_attempts_success ON admin_login_attempts(success);

CREATE INDEX IF NOT EXISTS idx_notifications_type ON admin_notifications(event_type);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON admin_notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON admin_notifications(created_at);

CREATE INDEX IF NOT EXISTS idx_admin_actions_admin ON admin_actions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_type ON admin_actions(action_type);
CREATE INDEX IF NOT EXISTS idx_admin_actions_timestamp ON admin_actions(timestamp);

CREATE INDEX IF NOT EXISTS idx_manual_messages_admin ON manual_messages(admin_id);
CREATE INDEX IF NOT EXISTS idx_manual_messages_contact ON manual_messages(contact_id);
CREATE INDEX IF NOT EXISTS idx_manual_messages_sent_at ON manual_messages(sent_at);

CREATE INDEX IF NOT EXISTS idx_manual_overrides_contact ON manual_overrides(contact_id);
CREATE INDEX IF NOT EXISTS idx_manual_overrides_status ON manual_overrides(status);
CREATE INDEX IF NOT EXISTS idx_manual_overrides_expires ON manual_overrides(expires_at);

CREATE INDEX IF NOT EXISTS idx_dashboard_activity_admin ON dashboard_activity(admin_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_activity_timestamp ON dashboard_activity(timestamp);

CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity);
CREATE INDEX IF NOT EXISTS idx_security_events_timestamp ON security_events(timestamp);

CREATE INDEX IF NOT EXISTS idx_performance_metrics_name ON performance_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_performance_metrics_timestamp ON performance_metrics(timestamp);

-- Views for common queries
CREATE VIEW IF NOT EXISTS admin_session_summary AS
SELECT 
    au.username,
    au.email,
    au.last_login,
    COUNT(CASE WHEN as_table.status = 'active' THEN 1 END) as active_sessions,
    COUNT(as_table.session_id) as total_sessions,
    MAX(as_table.last_activity) as last_activity
FROM admin_users au
LEFT JOIN admin_sessions as_table ON au.id = as_table.admin_id
WHERE au.status = 'active'
GROUP BY au.id, au.username, au.email, au.last_login;

CREATE VIEW IF NOT EXISTS security_summary AS
SELECT 
    DATE(timestamp) as date,
    event_type,
    severity,
    COUNT(*) as event_count,
    COUNT(CASE WHEN resolved = 1 THEN 1 END) as resolved_count
FROM security_events
WHERE timestamp >= datetime('now', '-30 days')
GROUP BY DATE(timestamp), event_type, severity
ORDER BY date DESC, severity DESC;

-- Triggers for automatic cleanup and maintenance
CREATE TRIGGER IF NOT EXISTS cleanup_expired_sessions
    AFTER INSERT ON admin_sessions
BEGIN
    UPDATE admin_sessions 
    SET status = 'expired' 
    WHERE expires_at < datetime('now') AND status = 'active';
END;

CREATE TRIGGER IF NOT EXISTS cleanup_old_login_attempts
    AFTER INSERT ON admin_login_attempts
BEGIN
    DELETE FROM admin_login_attempts 
    WHERE timestamp < datetime('now', '-90 days');
END;

CREATE TRIGGER IF NOT EXISTS cleanup_old_notifications
    AFTER INSERT ON admin_notifications
BEGIN
    DELETE FROM admin_notifications 
    WHERE created_at < datetime('now', '-30 days') AND status IN ('sent', 'failed');
END;

-- Initial system configuration data
INSERT OR IGNORE INTO system_config (category, key, value, description) VALUES
    ('admin', 'max_sessions_per_user', '5', 'Maximum concurrent sessions per admin user'),
    ('admin', 'session_timeout_hours', '24', 'Session timeout in hours'),
    ('admin', 'require_2fa', 'false', 'Require 2FA for all admin users'),
    ('security', 'max_login_attempts', '5', 'Maximum login attempts before account lockout'),
    ('security', 'lockout_duration_minutes', '15', 'Account lockout duration in minutes'),
    ('security', 'password_min_length', '8', 'Minimum password length'),
    ('notifications', 'enabled', 'true', 'Enable admin notifications'),
    ('notifications', 'rate_limit_per_hour', '10', 'Maximum notifications per hour'),
    ('notifications', 'daily_report_time', '20:00', 'Time to send daily reports'),
    ('dashboard', 'auto_refresh_seconds', '30', 'Dashboard auto-refresh interval'),
    ('dashboard', 'max_log_entries', '1000', 'Maximum log entries to display'),
    ('performance', 'cleanup_interval_hours', '24', 'Cleanup interval for old data');

-- Create default admin user (password: admin123 - CHANGE IN PRODUCTION)
-- Password hash for 'admin123' with bcrypt rounds=12
INSERT OR IGNORE INTO admin_users (id, username, email, password_hash, status) VALUES
    ('default-admin-id', 'admin', 'admin@localhost', '$2b$12$rH8P5qY9P7E3xM4Z1bN9.uK3Y7w8fX6V5S2qR1dH9J8L0bK3M7eN2', 'active');

-- Insert sample performance metrics for testing
INSERT OR IGNORE INTO performance_metrics (metric_name, metric_value, metric_unit, category) VALUES
    ('response_time', 1200, 'ms', 'api'),
    ('memory_usage', 256, 'mb', 'system'),
    ('active_sessions', 3, 'count', 'dashboard'),
    ('error_rate', 2.5, 'percentage', 'system');

-- Insert sample security event for testing
INSERT OR IGNORE INTO security_events (event_type, severity, source_ip, description) VALUES
    ('system_start', 'low', '127.0.0.1', 'Admin system initialized successfully');

PRAGMA foreign_keys = ON;
