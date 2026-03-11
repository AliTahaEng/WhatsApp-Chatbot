#!/usr/bin/env node

/**
 * WhatsApp AutoGen Multi-Agent Bot
 * Main Application Entry Point
 * 
 * This is the main entry point for the WhatsApp bot system.
 * It initializes all components and handles the message flow.
 */

require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const logger = require('./src/utils/logger');
const DatabaseService = require('./src/services/database.service');
const LimitationService = require('./src/services/limitation.service');
const AdminCommandHandler = require('./src/services/admin_commands.service');
const ManualOverrideManager = require('./src/services/manual_override.service');
const PythonBridge = require('./src/bridge/python_bridge');
const MessageHandler = require('./src/whatsapp/message_handler');
const SessionManager = require('./src/whatsapp/session_manager');
const MetricsService = require('./src/services/metrics.service');
const NotificationService = require('./src/services/notification.service');

// New Admin System Components
const AdminAuthService = require('./src/services/admin_auth.service');
const AdminNotificationService = require('./src/services/admin_notification.service');
const DashboardServer = require('./src/dashboard/server');
const fs = require('fs');
const path = require('path');

class WhatsAppBot {
    constructor() {
        this.client = null;
        this.db = null;
        this.pythonBridge = null;
        this.messageHandler = null;
        this.adminHandler = null;
        this.overrideManager = null;
        this.limitationService = null;
        this.metricsService = null;
        this.notificationService = null;

        // New Admin System Components
        this.adminAuth = null;
        this.adminNotifications = null;
        this.dashboard = null;

        this.isReady = false;
        this.startTime = Date.now();

        // Global state
        global.botPaused = false;
        global.agentStates = {
            CustomerSupport: process.env.CUSTOMER_SUPPORT_ENABLED !== 'false',
            TechSupport: process.env.TECH_SUPPORT_ENABLED !== 'false',
            Research: process.env.RESEARCH_AGENT_ENABLED !== 'false',
            Scheduler: process.env.SCHEDULER_AGENT_ENABLED !== 'false'
        };

        this.initialize();
    }

    async initialize() {
        try {
            logger.info('🚀 Starting WhatsApp AutoGen Bot...');

            // Initialize services
            await this.initializeServices();

            // Initialize WhatsApp client
            await this.initializeWhatsAppClient();

            // Setup event handlers
            this.setupEventHandlers();

            // Setup graceful shutdown
            this.setupGracefulShutdown();

            logger.info('✅ Bot initialization complete. Waiting for QR code scan...');

        } catch (error) {
            logger.error('❌ Failed to initialize bot:', error);
            process.exit(1);
        }
    }

    async initializeServices() {
        logger.info('📦 Initializing services...');

        // Database Service
        this.db = new DatabaseService();
        await this.db.initialize();

        // Initialize admin database schema
        await this.initializeAdminDatabase();
        logger.info('✅ Database service initialized with admin extensions');

        // Admin Authentication Service
        this.adminAuth = new AdminAuthService(this.db);
        logger.info('✅ Admin authentication service initialized');

        // Python Bridge
        this.pythonBridge = new PythonBridge();
        await this.pythonBridge.initialize();
        logger.info('✅ Python bridge initialized');

        // Limitation Service
        this.limitationService = new LimitationService(this.db);
        logger.info('✅ Limitation service initialized');

        // Manual Override Manager
        this.overrideManager = new ManualOverrideManager(this.db);
        await this.overrideManager.loadActiveOverrides();
        this.overrideManager.startCleanupTimer();
        logger.info('✅ Manual override manager initialized');

        // Metrics Service
        this.metricsService = new MetricsService();
        logger.info('✅ Metrics service initialized');

        // Notification Service (legacy)
        this.notificationService = new NotificationService(this.db);
        logger.info('✅ Legacy notification service initialized');
    }

    async initializeAdminDatabase() {
        try {
            // Load and execute admin schema
            const adminSchemaPath = path.join(__dirname, 'src/database/admin_schema.sql');
            if (fs.existsSync(adminSchemaPath)) {
                const adminSchema = fs.readFileSync(adminSchemaPath, 'utf8');
                await this.db.executeScript(adminSchema);
                logger.info('🔐 Admin database schema applied');
            }
        } catch (error) {
            logger.error('❌ Failed to initialize admin database:', error);
            throw error;
        }
    }

    async initializeWhatsAppClient() {
        logger.info('📱 Initializing WhatsApp client...');

        // Create WhatsApp client with session persistence
        this.client = new Client({
            authStrategy: new LocalAuth({
                dataPath: process.env.WHATSAPP_SESSION_PATH || './data/session'
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ]
            }
        });

        // Message Handler
        this.messageHandler = new MessageHandler(
            this.client,
            this.db,
            this.pythonBridge,
            this.limitationService,
            this.metricsService
        );

        // Admin Command Handler
        this.adminHandler = new AdminCommandHandler(
            this.client,
            this.db,
            this.overrideManager,
            this.metricsService,
            this.notificationService
        );

        // Initialize admin notification service (after WhatsApp client is ready)
        this.adminNotifications = new AdminNotificationService(this.client, this.db);
        logger.info('✅ Admin notification service initialized');

        // Initialize Web Dashboard (if enabled)
        if (process.env.DASHBOARD_ENABLED !== 'false') {
            this.dashboard = new DashboardServer(this.client, this.db, this.adminAuth);
            const dashboardPort = parseInt(process.env.DASHBOARD_PORT) || 3000;
            await this.dashboard.start(dashboardPort);
            logger.info(`✅ Web dashboard started on port ${dashboardPort}`);
        }

        logger.info('✅ WhatsApp client and admin systems configured');
    }

    setupEventHandlers() {
        // QR Code for authentication
        this.client.on('qr', (qr) => {
            logger.info('📱 QR Code received. Please scan with WhatsApp:');
            qrcode.generate(qr, { small: true });

            // Notify admin about QR code (if admin notifications are available)
            if (this.adminNotifications) {
                this.adminNotifications.notifyOwner('system_health', {
                    status: 'Waiting for QR scan',
                    cpuUsage: 0,
                    memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                    activeSessions: 0,
                    avgResponseTime: 0,
                    activeAgents: Object.keys(global.agentStates).length,
                    agentErrorRate: 0
                });
            }
        });

        // Authentication success
        this.client.on('authenticated', () => {
            logger.info('✅ WhatsApp authentication successful');
        });

        // Client ready
        this.client.on('ready', () => {
            this.isReady = true;
            const clientInfo = this.client.info;

            logger.info('🎉 WhatsApp client is ready!');
            logger.info(`📱 Connected as: ${clientInfo.wid.user}`);
            logger.info(`📱 Phone: ${clientInfo.wid._serialized}`);
            logger.info(`📱 Platform: ${clientInfo.platform}`);

            // Send startup notification to admin
            if (this.adminNotifications) {
                this.adminNotifications.notifyBotStarted({
                    phone: clientInfo.wid.user,
                    agentCount: Object.keys(global.agentStates).length
                });
            }
        });

        // Message received
        this.client.on('message', async (message) => {
            await this.handleMessage(message);
        });

        // Message creation (sent)
        this.client.on('message_create', async (message) => {
            if (message.fromMe) {
                // Log outgoing messages
                await this.db.saveMessage(
                    message.to,
                    'assistant',
                    message.body,
                    'manual',
                    0,
                    message.type,
                    message.hasMedia ? 'media' : null
                );
            }
        });

        // Disconnection handling
        this.client.on('disconnected', (reason) => {
            logger.warn(`📱 WhatsApp client disconnected: ${reason}`);
            this.isReady = false;

            // Notify admin about disconnection
            if (this.adminNotifications) {
                this.adminNotifications.notifyConnectionLost(reason);
            }

            // Attempt reconnection after delay
            setTimeout(() => {
                logger.info('🔄 Attempting to reconnect...');
                this.client.initialize();
            }, 5000);
        });

        // Error handling
        this.client.on('auth_failure', (message) => {
            logger.error('❌ WhatsApp authentication failed:', message);

            if (this.adminNotifications) {
                this.adminNotifications.notifyError(
                    new Error(`Authentication failed: ${message}`),
                    { component: 'whatsapp_auth', severity: 'high' }
                );
            }
        });
    }

    async handleMessage(message) {
        const startTime = Date.now();
        let processed = false;
        let error = null;

        try {
            // Skip if message is from ourselves
            if (message.fromMe) {
                return;
            }

            // Log incoming message
            logger.info(`📨 Message from ${message.from}: ${message.body.substring(0, 100)}...`);

            // PRIORITY 1: Check admin commands first
            const isAdminCommand = await this.adminHandler.handleMessage(message);
            if (isAdminCommand) {
                logger.info(`🔧 Admin command processed from ${message.from}`);
                processed = true;
                return;
            }

            // PRIORITY 2: Check if bot is globally paused
            if (global.botPaused) {
                logger.info(`⏸️ Bot is paused, skipping message from ${message.from}`);
                return;
            }

            // PRIORITY 3: Check manual override
            const override = this.overrideManager.isOverridden(message.from);
            if (override) {
                await this.handleManualOverride(message, override);
                logger.info(`🔧 Manual override active for ${message.from}: ${override.type}`);
                return;
            }

            // PRIORITY 4: Process with AI agents
            await this.messageHandler.processMessage(message);
            processed = true;

        } catch (err) {
            error = err;
            logger.error('❌ Error handling message:', err);

            try {
                await message.reply('I apologize, but I encountered an error processing your message. Please try again in a moment.');
            } catch (replyError) {
                logger.error('❌ Failed to send error reply:', replyError);
            }

            // Notify admin about error
            this.notificationService.notifyError(err, {
                contactId: message.from,
                messageBody: message.body.substring(0, 200)
            });
        } finally {
            // Record metrics
            const responseTime = Date.now() - startTime;
            this.metricsService.recordMessage(
                message.from,
                'system',
                responseTime,
                processed && !error
            );
        }
    }

    async handleManualOverride(message, override) {
        // Log message but don't auto-respond
        await this.db.saveMessage(
            message.from,
            'user',
            message.body,
            null,
            0,
            message.type,
            message.hasMedia ? 'media' : null,
            {
                override_active: true,
                override_type: override.type,
                override_reason: override.reason
            }
        );

        // Send one-time notification about manual mode (if not already notified)
        if (!override.notified) {
            const notificationMessage = override.type === 'global'
                ? "👋 I'm currently in manual support mode. A human will respond to you shortly."
                : "👋 You're currently connected to personal support. A human will respond to you shortly.";

            await message.reply(notificationMessage);
            override.notified = true;

            // Notify admin about new manual mode message
            const contact = await message.getContact();
            this.notificationService.notifyManualModeMessage({
                contactId: message.from,
                contactName: contact.name || contact.pushname || 'Unknown',
                message: message.body,
                overrideType: override.type,
                overrideReason: override.reason
            });
        }
    }

    setupGracefulShutdown() {
        const shutdown = async (signal) => {
            logger.info(`📴 Received ${signal}. Gracefully shutting down...`);

            try {
                // Notify admin about shutdown
                if (this.notificationService && this.isReady) {
                    await this.notificationService.notifyShutdown(signal);
                }

                // Close WhatsApp client
                if (this.client) {
                    await this.client.destroy();
                    logger.info('✅ WhatsApp client disconnected');
                }

                // Close Python bridge
                if (this.pythonBridge) {
                    await this.pythonBridge.cleanup();
                    logger.info('✅ Python bridge closed');
                }

                // Close database
                if (this.db) {
                    await this.db.close();
                    logger.info('✅ Database connection closed');
                }

                logger.info('👋 Shutdown complete');
                process.exit(0);

            } catch (error) {
                logger.error('❌ Error during shutdown:', error);
                process.exit(1);
            }
        };

        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));

        process.on('uncaughtException', (error) => {
            logger.error('💥 Uncaught exception:', error);
            if (this.notificationService) {
                this.notificationService.notifyError(error, { type: 'uncaught_exception' });
            }
            setTimeout(() => process.exit(1), 1000);
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error('💥 Unhandled rejection at:', promise, 'reason:', reason);
            if (this.notificationService) {
                this.notificationService.notifyError(new Error(reason), { type: 'unhandled_rejection' });
            }
        });
    }

    // Health check endpoint
    getHealthStatus() {
        return {
            status: this.isReady ? 'ready' : 'initializing',
            uptime: Date.now() - this.startTime,
            components: {
                whatsapp: this.isReady,
                database: this.db ? this.db.isConnected() : false,
                pythonBridge: this.pythonBridge ? this.pythonBridge.isReady() : false,
                botPaused: global.botPaused,
                agentStates: global.agentStates
            },
            metrics: this.metricsService ? this.metricsService.getStats() : null
        };
    }
}

// Start the bot
const bot = new WhatsAppBot();

// Export for health checks and testing
module.exports = bot;
