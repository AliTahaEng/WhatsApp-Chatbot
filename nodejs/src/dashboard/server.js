/**
 * Web Dashboard Server
 * Express.js server with Socket.io for real-time admin interface
 * 
 * Features:
 * - Real-time statistics and monitoring
 * - Message composition and sending
 * - User management (blacklist/whitelist)
 * - System logs viewing
 * - Agent control and status
 */

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const session = require('express-session');
const logger = require('../utils/logger');

class DashboardServer {
    constructor(whatsappClient, database, authService) {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server, {
            cors: {
                origin: process.env.DASHBOARD_CORS_ORIGIN || "*",
                methods: ["GET", "POST"]
            }
        });

        this.client = whatsappClient;
        this.db = database;
        this.auth = authService;
        this.container = null; // Set externally by Application.js for DI access

        // Connected dashboard clients
        this.connectedClients = new Set();

        this.setupMiddleware();
        this.setupRoutes();
        this.setupWebSocket();
        this.setupRealTimeUpdates();

        logger.info('🌐 Dashboard server initialized');
    }

    setupMiddleware() {
        // Basic middleware
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
        this.app.use(express.static(path.join(__dirname, 'public')));

        // Session middleware
        this.app.use(session({
            secret: process.env.ADMIN_SESSION_SECRET || 'change-this-secret-key',
            resave: false,
            saveUninitialized: false,
            cookie: {
                maxAge: 24 * 60 * 60 * 1000, // 24 hours
                secure: process.env.NODE_ENV === 'production'
            }
        }));

        // Request logging
        this.app.use((req, res, next) => {
            logger.debug(`Dashboard ${req.method} ${req.path} from ${req.ip}`);
            next();
        });
    }

    // Authentication middleware
    requireAuth(req, res, next) {
        const sessionId = req.session.sessionId || req.headers['x-session-id'];

        if (!sessionId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                redirectTo: '/login'
            });
        }

        // Validate session with auth service
        this.auth.validateSession(sessionId, req.ip).then(session => {
            if (!session) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid or expired session',
                    redirectTo: '/login'
                });
            }

            req.session.adminSession = session;
            req.adminId = session.adminId;
            next();
        }).catch(error => {
            logger.error('Dashboard auth error:', error);
            res.status(500).json({
                success: false,
                error: 'Authentication system error'
            });
        });
    }

    setupRoutes() {
        // Root redirect
        this.app.get('/', (req, res) => {
            res.redirect('/dashboard');
        });

        // Login routes
        this.app.get('/login', (req, res) => {
            res.sendFile(path.join(__dirname, 'public/login.html'));
        });

        this.app.post('/api/auth/login', async (req, res) => {
            try {
                const { username, password, twoFactorCode } = req.body;
                const ipAddress = req.ip || req.connection.remoteAddress;

                const loginResult = await this.auth.login(username, password, twoFactorCode, ipAddress);

                if (loginResult.success) {
                    req.session.sessionId = loginResult.sessionId;
                    res.json({
                        success: true,
                        sessionId: loginResult.sessionId,
                        adminId: loginResult.adminId,
                        username: loginResult.username
                    });
                } else if (loginResult.require2FA) {
                    res.json({
                        success: false,
                        require2FA: true,
                        message: '2FA token required'
                    });
                } else {
                    res.json({ success: false, error: 'Login failed' });
                }

            } catch (error) {
                logger.error('Dashboard login error:', error);
                res.json({ success: false, error: error.message });
            }
        });

        // 2FA setup routes
        this.app.post('/api/auth/setup-2fa', this.requireAuth.bind(this), async (req, res) => {
            try {
                const setup = await this.auth.setup2FA(req.adminId);
                res.json({ success: true, setup });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        this.app.post('/api/auth/confirm-2fa', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { code } = req.body;
                const result = await this.auth.enable2FA(req.adminId, code);
                res.json({ success: result });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        // Dashboard page
        this.app.get('/dashboard', this.requireAuth.bind(this), (req, res) => {
            res.sendFile(path.join(__dirname, 'public/dashboard.html'));
        });

        // API endpoints
        this.setupAPIRoutes();
        this.setupAllowedContactsRoutes();
        this.setupPendingMessagesRoutes();
        this.setupBotSettingsRoutes();

        // Logout
        this.app.post('/api/auth/logout', async (req, res) => {
            try {
                if (req.session.sessionId) {
                    await this.auth.destroySession(req.session.sessionId);
                }
                req.session.destroy();
                res.json({ success: true });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        // Health check
        this.app.get('/api/health', (req, res) => {
            res.json({
                success: true,
                status: 'healthy',
                timestamp: new Date().toISOString(),
                version: '1.0.0'
            });
        });
    }

    setupAPIRoutes() {
        // Statistics
        this.app.get('/api/stats', this.requireAuth.bind(this), async (req, res) => {
            try {
                const stats = await this.getSystemStats();
                res.json({ success: true, data: stats });
            } catch (error) {
                logger.error('Stats API error:', error);
                res.json({ success: false, error: error.message });
            }
        });

        // Conversations
        this.app.get('/api/conversations', this.requireAuth.bind(this), async (req, res) => {
            try {
                const limit = parseInt(req.query.limit) || 20;
                const conversations = await this.getActiveConversations(limit);
                res.json({ success: true, data: conversations });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        this.app.get('/api/conversations/:contactId', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { contactId } = req.params;
                const limit = parseInt(req.query.limit) || 50;
                const history = await this.getConversationHistory(contactId, limit);
                res.json({ success: true, data: history });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        // Generate message via AI agent (admin gives instruction, agent writes the message)
        this.app.post('/api/generate-message', this.requireAuth.bind(this), async (req, res) => {
            try {
                let { contactId, instruction } = req.body;

                if (!contactId || !instruction) {
                    return res.json({ success: false, error: 'Phone number and instruction are required' });
                }

                // Auto-format contact ID
                contactId = contactId.trim();
                if (!contactId.includes('@')) {
                    contactId = contactId.replace(/[^0-9]/g, '');
                    contactId = `${contactId}@c.us`;
                }

                // Get the LLM provider from the DI container
                if (!this.container) {
                    return res.json({ success: false, error: 'AI agent is not available yet. Please wait for system to fully start.' });
                }
                const llmProvider = this.container.resolve('ILLMProvider');

                // Build prompt: the admin's instruction becomes a system-level directive
                const messages = [
                    {
                        role: 'system',
                        content: `You are a WhatsApp messaging assistant. The admin wants you to compose a message to send to a contact. Write ONLY the message text that will be sent directly to the contact. Do NOT include any meta-commentary, explanations, or quotation marks around the message. Just write the message itself as if you are speaking directly to the recipient.`
                    },
                    {
                        role: 'user',
                        content: `Compose a WhatsApp message based on this instruction: "${instruction}"`
                    }
                ];

                const response = await llmProvider.generateResponse(messages, {
                    maxTokens: 1000,
                    temperature: 0.7
                });

                const generatedMessage = response.content || response.text || '';

                if (!generatedMessage) {
                    return res.json({ success: false, error: 'Agent failed to generate a message' });
                }

                logger.info(`🤖 Agent generated message for ${contactId}: ${generatedMessage.substring(0, 100)}...`);
                res.json({ success: true, contactId, generatedMessage });

            } catch (error) {
                logger.error('Generate message error:', error);
                res.json({ success: false, error: error.message || 'Failed to generate message' });
            }
        });

        // Send message
        this.app.post('/api/send-message', this.requireAuth.bind(this), async (req, res) => {
            try {
                let { contactId, message } = req.body;

                if (!contactId || !message) {
                    return res.json({ success: false, error: 'Contact ID and message are required' });
                }

                // Auto-format contact ID: strip non-numeric chars and append @c.us if needed
                contactId = contactId.trim();
                if (!contactId.includes('@')) {
                    // Strip +, spaces, dashes from phone number
                    contactId = contactId.replace(/[^0-9]/g, '');
                    contactId = `${contactId}@c.us`;
                }

                // Verify the number is registered on WhatsApp (skip for group IDs)
                if (!contactId.endsWith('@g.us')) {
                    const isRegistered = await this.client.isRegisteredUser(contactId);
                    if (!isRegistered) {
                        return res.json({ success: false, error: `Number ${contactId} is not registered on WhatsApp` });
                    }
                }

                // Check WhatsApp client is ready
                if (!this.client || !this.client.info) {
                    return res.json({ success: false, error: 'WhatsApp client is not ready. Please wait for connection.' });
                }

                // Send via WhatsApp client
                await this.client.sendMessage(contactId, message);

                // Log as manual message (ignore errors from missing table)
                try {
                    await this.db.executeRun(
                        'INSERT INTO manual_messages (admin_id, contact_id, message_content, sent_at, source) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)',
                        [req.adminId, contactId, message, 'dashboard']
                    );
                } catch (logError) {
                    logger.warn('Could not log manual message:', logError.message);
                }

                // Notify connected dashboards
                this.io.emit('message-sent', {
                    contactId,
                    message,
                    sentBy: req.adminId,
                    timestamp: new Date()
                });

                logger.info(`📤 Manual message sent via dashboard: ${contactId}`);
                res.json({ success: true });

            } catch (error) {
                logger.error('Send message error:', error);
                const friendlyMessage = error.message && error.message.length > 2
                    ? error.message
                    : `Failed to send message to ${req.body.contactId}. Make sure the number is correct and includes the country code (e.g. 201080929617).`;
                res.json({ success: false, error: friendlyMessage });
            }
        });

        // User management
        this.app.post('/api/blacklist', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { contactId, reason } = req.body;
                await this.db.executeRun(
                    'INSERT INTO blacklist (contact_id, reason, admin_id, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
                    [contactId, reason || 'Added via dashboard', req.adminId]
                );

                this.io.emit('user-blacklisted', { contactId, reason, admin: req.adminId });
                res.json({ success: true });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        this.app.post('/api/whitelist', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { contactId } = req.body;
                await this.db.executeRun(
                    'INSERT INTO whitelist (contact_id, admin_id, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
                    [contactId, req.adminId]
                );

                // Remove from blacklist if present
                await this.db.executeRun(
                    'DELETE FROM blacklist WHERE contact_id = ?',
                    [contactId]
                );

                this.io.emit('user-whitelisted', { contactId, admin: req.adminId });
                res.json({ success: true });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        // System logs
        this.app.get('/api/system-logs', this.requireAuth.bind(this), async (req, res) => {
            try {
                const limit = Math.min(parseInt(req.query.limit) || 50, 200);
                const level = req.query.level;

                let sql = 'SELECT * FROM system_logs';
                const params = [];

                if (level) {
                    sql += ' WHERE level = ?';
                    params.push(level);
                }

                sql += ' ORDER BY timestamp DESC LIMIT ?';
                params.push(limit);

                const logs = await this.db.executeQuery(sql, params);
                res.json({ success: true, data: logs });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        // Agent management
        this.app.get('/api/agents/status', this.requireAuth.bind(this), async (req, res) => {
            try {
                const agentStates = global.agentStates || {
                    customer_support: true,
                    tech_support: true,
                    research: true,
                    scheduler: true
                };

                res.json({ success: true, data: agentStates });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        this.app.post('/api/agents/:agentName/:action', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { agentName, action } = req.params;

                if (!global.agentStates) {
                    global.agentStates = {};
                }

                if (action === 'enable') {
                    global.agentStates[agentName] = true;
                } else if (action === 'disable') {
                    global.agentStates[agentName] = false;
                } else {
                    return res.json({ success: false, error: 'Invalid action' });
                }

                // Log admin action
                await this.db.executeRun(
                    'INSERT INTO admin_actions (admin_id, action_type, target, details, timestamp) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
                    [req.adminId, 'agent_control', agentName, JSON.stringify({ action })]
                );

                this.io.emit('agent-status-changed', { agentName, enabled: global.agentStates[agentName] });
                res.json({ success: true });

            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        // Bot control
        this.app.post('/api/bot/:action', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { action } = req.params;

                if (action === 'pause') {
                    global.botPaused = true;
                } else if (action === 'resume') {
                    global.botPaused = false;
                } else {
                    return res.json({ success: false, error: 'Invalid action' });
                }

                // Log admin action
                await this.db.executeRun(
                    'INSERT INTO admin_actions (admin_id, action_type, target, details, timestamp) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
                    [req.adminId, 'bot_control', 'system', JSON.stringify({ action })]
                );

                this.io.emit('bot-status-changed', { paused: global.botPaused });
                res.json({ success: true, paused: global.botPaused });

            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        // Manual override management
        this.app.get('/api/overrides', this.requireAuth.bind(this), async (req, res) => {
            try {
                const overrides = await this.db.executeQuery(
                    'SELECT * FROM manual_overrides WHERE status = "active" ORDER BY created_at DESC'
                );
                res.json({ success: true, data: overrides });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        this.app.post('/api/overrides', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { contactId, type, reason, expirationHours } = req.body;

                const expiresAt = expirationHours ?
                    new Date(Date.now() + expirationHours * 60 * 60 * 1000) : null;

                await this.db.executeRun(
                    `INSERT INTO manual_overrides (contact_id, override_type, reason, admin_id, expires_at, status, created_at) 
                     VALUES (?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)`,
                    [contactId, type || 'manual', reason, req.adminId, expiresAt?.toISOString()]
                );

                this.io.emit('override-added', { contactId, type, reason, admin: req.adminId });
                res.json({ success: true });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        this.app.delete('/api/overrides/:contactId', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { contactId } = req.params;

                await this.db.executeRun(
                    'UPDATE manual_overrides SET status = "removed" WHERE contact_id = ? AND status = "active"',
                    [contactId]
                );

                this.io.emit('override-removed', { contactId, admin: req.adminId });
                res.json({ success: true });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });
    }

    setupAllowedContactsRoutes() {
        // Get all allowed contacts
        this.app.get('/api/allowed-contacts', this.requireAuth.bind(this), async (req, res) => {
            try {
                const contacts = await this.db.getAllowedContacts();
                res.json({ success: true, data: contacts });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        // Add allowed contact
        this.app.post('/api/allowed-contacts', this.requireAuth.bind(this), async (req, res) => {
            try {
                let { contactId, name } = req.body;
                if (!contactId) {
                    return res.json({ success: false, error: 'Contact ID is required' });
                }
                contactId = contactId.trim().replace(/[^0-9]/g, '');
                if (!contactId.includes('@')) {
                    contactId = `${contactId}@c.us`;
                }
                await this.db.addAllowedContact(contactId, name || '', req.adminId);
                this.io.emit('allowed-contacts-updated');
                res.json({ success: true });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        // Remove allowed contact
        this.app.delete('/api/allowed-contacts/:contactId', this.requireAuth.bind(this), async (req, res) => {
            try {
                const contactId = decodeURIComponent(req.params.contactId);
                await this.db.removeAllowedContact(contactId);
                this.io.emit('allowed-contacts-updated');
                res.json({ success: true });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });
    }

    setupPendingMessagesRoutes() {
        // Get pending messages
        this.app.get('/api/pending-messages', this.requireAuth.bind(this), async (req, res) => {
            try {
                const messages = await this.db.getPendingMessages();
                res.json({ success: true, data: messages });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        // Get pending count
        this.app.get('/api/pending-messages/count', this.requireAuth.bind(this), async (req, res) => {
            try {
                const count = await this.db.getPendingCount();
                res.json({ success: true, count });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        // Approve pending message (send the AI response)
        this.app.post('/api/pending-messages/:id/approve', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { id } = req.params;
                const pending = await this.db.getPendingMessageById(id);
                if (!pending || pending.status !== 'pending') {
                    return res.json({ success: false, error: 'Message not found or already resolved' });
                }

                // Send the AI response to the contact
                const responseText = req.body.customResponse || pending.ai_response;
                await this.client.sendMessage(pending.contact_id, responseText);

                // Mark as approved
                await this.db.resolvePendingMessage(id, 'approved', req.adminId);

                this.io.emit('pending-message-resolved', { id, status: 'approved' });
                logger.info(`✅ Pending message #${id} approved and sent to ${pending.contact_id}`);
                res.json({ success: true });
            } catch (error) {
                logger.error('Error approving pending message:', error);
                res.json({ success: false, error: error.message });
            }
        });

        // Reject pending message (don't send)
        this.app.post('/api/pending-messages/:id/reject', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { id } = req.params;
                await this.db.resolvePendingMessage(id, 'rejected', req.adminId);
                this.io.emit('pending-message-resolved', { id, status: 'rejected' });
                res.json({ success: true });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });
    }

    setupBotSettingsRoutes() {
        // Get bot settings
        this.app.get('/api/bot-settings', this.requireAuth.bind(this), async (req, res) => {
            try {
                const autoReply = await this.db.isAutoReplyEnabled();
                const allowedContactsOnly = await this.db.isAllowedContactsOnly();
                const voiceReplies = await this.db.isVoiceRepliesEnabled();
                const pendingCount = await this.db.getPendingCount();
                res.json({
                    success: true,
                    data: { autoReply, allowedContactsOnly, voiceReplies, pendingCount }
                });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        // Toggle auto-reply mode
        this.app.post('/api/bot-settings/auto-reply', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { enabled } = req.body;
                await this.db.setAutoReplyMode(enabled);
                this.io.emit('settings-updated', { autoReply: enabled });
                logger.info(`🔄 Auto-reply mode set to: ${enabled}`);
                res.json({ success: true });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        // Toggle allowed contacts only mode
        this.app.post('/api/bot-settings/allowed-contacts-only', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { enabled } = req.body;
                await this.db.setAllowedContactsOnly(enabled);
                this.io.emit('settings-updated', { allowedContactsOnly: enabled });
                logger.info(`🔄 Allowed contacts only mode set to: ${enabled}`);
                res.json({ success: true });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        // Toggle voice replies mode
        this.app.post('/api/bot-settings/voice-replies', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { enabled } = req.body;
                await this.db.setVoiceRepliesMode(enabled);
                this.io.emit('settings-updated', { voiceReplies: enabled });
                logger.info(`🔄 Voice replies mode set to: ${enabled}`);
                res.json({ success: true });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });
    }

    setupWebSocket() {
        this.io.on('connection', (socket) => {
            this.connectedClients.add(socket);
            logger.info(`📡 Dashboard client connected (${this.connectedClients.size} total)`);

            // Send current system status
            socket.emit('system-status', {
                botPaused: global.botPaused || false,
                agentStates: global.agentStates || {},
                connectedClients: this.connectedClients.size,
                timestamp: new Date()
            });

            socket.on('subscribe-stats', () => {
                this.sendStatsUpdates(socket);
            });

            socket.on('subscribe-logs', () => {
                this.sendLogUpdates(socket);
            });

            socket.on('disconnect', () => {
                this.connectedClients.delete(socket);
                logger.info(`📡 Dashboard client disconnected (${this.connectedClients.size} remaining)`);
            });
        });
    }

    setupRealTimeUpdates() {
        // Update all connected clients with stats every 10 seconds
        setInterval(async () => {
            if (this.connectedClients.size > 0) {
                try {
                    const stats = await this.getSystemStats();
                    this.io.emit('stats-update', stats);
                } catch (error) {
                    logger.error('Stats update error:', error);
                }
            }
        }, 10000);

        logger.info('📊 Real-time updates configured');
    }

    async sendStatsUpdates(socket) {
        const updateInterval = setInterval(async () => {
            try {
                const stats = await this.getSystemStats();
                socket.emit('stats-update', stats);
            } catch (error) {
                logger.error('Stats update error:', error);
            }
        }, 10000);

        socket.on('disconnect', () => {
            clearInterval(updateInterval);
        });
    }

    async sendLogUpdates(socket) {
        // Send recent logs immediately
        try {
            const logs = await this.db.executeQuery(
                'SELECT * FROM system_logs ORDER BY timestamp DESC LIMIT 10'
            );
            socket.emit('logs-update', logs);
        } catch (error) {
            logger.error('Log update error:', error);
        }
    }

    async getSystemStats() {
        try {
            // Get various system statistics
            const [
                messageStats,
                userStats,
                errorStats,
                sessionStats
            ] = await Promise.all([
                this.getMessageStats(),
                this.getUserStats(),
                this.getErrorStats(),
                this.getSessionStats()
            ]);

            return {
                uptime: process.uptime(),
                botStatus: global.botPaused ? 'paused' : 'active',
                agentStates: global.agentStates || {},
                connectedClients: this.connectedClients.size,
                timestamp: new Date(),
                ...messageStats,
                ...userStats,
                ...errorStats,
                ...sessionStats,
                memory: {
                    used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                    total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
                }
            };
        } catch (error) {
            logger.error('Error getting system stats:', error);
            return { error: 'Failed to get system stats' };
        }
    }

    async getMessageStats() {
        try {
            const today = new Date().toISOString().split('T')[0];
            const stats = await this.db.executeQuerySingle(`
                SELECT 
                    COUNT(CASE WHEN DATE(timestamp) = ? THEN 1 END) as messages_today,
                    COUNT(CASE WHEN DATE(timestamp) = ? AND role = 'assistant' THEN 1 END) as sent_today,
                    COUNT(*) as total_messages
                FROM conversations 
                WHERE timestamp >= datetime('now', '-7 days')
            `, [today, today]);

            return {
                messages_today: stats?.messages_today || 0,
                messages_sent_today: stats?.sent_today || 0,
                total_messages: stats?.total_messages || 0
            };
        } catch (error) {
            return { messages_today: 0, messages_sent_today: 0, total_messages: 0 };
        }
    }

    async getUserStats() {
        try {
            const today = new Date().toISOString().split('T')[0];
            const stats = await this.db.executeQuerySingle(`
                SELECT 
                    COUNT(DISTINCT CASE WHEN DATE(last_interaction) = ? THEN contact_id END) as active_users_today,
                    COUNT(DISTINCT CASE WHEN DATE(created_at) = ? THEN contact_id END) as new_users_today,
                    COUNT(*) as total_users
                FROM users 
                WHERE created_at >= datetime('now', '-30 days')
            `, [today, today]);

            return {
                active_users_today: stats?.active_users_today || 0,
                new_users_today: stats?.new_users_today || 0,
                total_users: stats?.total_users || 0
            };
        } catch (error) {
            return { active_users_today: 0, new_users_today: 0, total_users: 0 };
        }
    }

    async getErrorStats() {
        try {
            const today = new Date().toISOString().split('T')[0];
            const errorCount = await this.db.executeQuerySingle(`
                SELECT COUNT(*) as error_count 
                FROM system_logs 
                WHERE level = 'error' AND DATE(timestamp) = ?
            `, [today]);

            const totalLogs = await this.db.executeQuerySingle(`
                SELECT COUNT(*) as total_count 
                FROM system_logs 
                WHERE DATE(timestamp) = ?
            `, [today]);

            const errorRate = totalLogs.total_count > 0 ?
                ((errorCount.error_count / totalLogs.total_count) * 100).toFixed(1) : 0;

            return {
                errors_today: errorCount?.error_count || 0,
                error_rate: parseFloat(errorRate)
            };
        } catch (error) {
            return { errors_today: 0, error_rate: 0 };
        }
    }

    async getSessionStats() {
        try {
            const activeSessions = await this.db.executeQuerySingle(`
                SELECT COUNT(*) as active_sessions 
                FROM admin_sessions 
                WHERE status = 'active' AND expires_at > datetime('now')
            `);

            return {
                active_admin_sessions: activeSessions?.active_sessions || 0
            };
        } catch (error) {
            return { active_admin_sessions: 0 };
        }
    }

    async getActiveConversations(limit = 20) {
        try {
            return await this.db.executeQuery(`
                SELECT 
                    c.contact_id,
                    u.name as contact_name,
                    c.message as last_message,
                    c.timestamp as last_activity,
                    c.role,
                    COUNT(*) as message_count
                FROM conversations c
                LEFT JOIN users u ON c.contact_id = u.contact_id
                WHERE c.timestamp >= datetime('now', '-7 days')
                GROUP BY c.contact_id
                ORDER BY c.timestamp DESC
                LIMIT ?
            `, [limit]);
        } catch (error) {
            logger.error('Error getting active conversations:', error);
            return [];
        }
    }

    async getConversationHistory(contactId, limit = 50) {
        try {
            return await this.db.executeQuery(`
                SELECT 
                    message,
                    role,
                    timestamp,
                    agent_name,
                    tokens_used
                FROM conversations 
                WHERE contact_id = ? 
                ORDER BY timestamp DESC 
                LIMIT ?
            `, [contactId, limit]);
        } catch (error) {
            logger.error('Error getting conversation history:', error);
            return [];
        }
    }

    // Emit events to all connected clients
    broadcastEvent(eventName, data) {
        this.io.emit(eventName, {
            ...data,
            timestamp: new Date()
        });
    }

    start(port = 3000) {
        return new Promise((resolve) => {
            this.server.listen(port, () => {
                logger.info(`🌐 Dashboard server running on http://localhost:${port}`);
                resolve();
            });
        });
    }

    stop() {
        return new Promise((resolve) => {
            this.server.close(() => {
                logger.info('🌐 Dashboard server stopped');
                resolve();
            });
        });
    }

    getStatus() {
        return {
            running: this.server.listening,
            connectedClients: this.connectedClients.size,
            port: this.server.address()?.port || null
        };
    }
}

module.exports = DashboardServer;
