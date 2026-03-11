/**
 * Modern Application Bootstrap
 * Refactored main application using new flexible architecture
 * Implements all 6 architectural principles with dependency injection
 */

const ServiceContainer = require('../container/ServiceContainer');
const ConfigurationManager = require('../config/ConfigurationManager');
const PluginManager = require('../../plugins/PluginManager');
const APIVersionManager = require('../../api/versioning/APIVersionManager');

// Database Adapters
const SQLiteAdapter = require('../../database/adapters/SQLiteAdapter');
const PostgreSQLAdapter = require('../../database/adapters/PostgreSQLAdapter');

// LLM Adapters
const AzureOpenAIAdapter = require('../../llm/adapters/AzureOpenAIAdapter');
const ClaudeAdapter = require('../../llm/adapters/ClaudeAdapter');

// Message Provider Adapters
const WhatsAppAdapter = require('../../messaging/adapters/WhatsAppAdapter');

// Services (refactored to use DI)
const MessageHandlerService = require('../../services/MessageHandlerService');
const MediaHandlerService = require('../../services/MediaHandlerService');
const AdminService = require('../../services/AdminService');
const MetricsService = require('../../services/MetricsService');
const NotificationService = require('../../services/NotificationService');

// Media Processing Adapters
const AzureMediaAdapter = require('../../media/adapters/AzureMediaAdapter');
const LocalWhisperAdapter = require('../../media/adapters/LocalWhisperAdapter');
const GroqMediaAdapter = require('../../media/adapters/GroqMediaAdapter');

// TTS Adapters
const GeminiTTSAdapter = require('../../tts/adapters/GeminiTTSAdapter');

// Bridge Services
const ModernPythonBridge = require('../../bridge/ModernPythonBridge');

// Dashboard & Auth
const DashboardServer = require('../../dashboard/server');
const AdminAuthService = require('../../services/admin_auth.service');

const logger = require('../../utils/logger');

class Application {
    constructor() {
        this.container = new ServiceContainer();
        this.config = null;
        this.pluginManager = null;
        this.apiVersionManager = null;
        this.isInitialized = false;
        this.isRunning = false;
        this.startTime = null;
        this.gracefulShutdown = this.gracefulShutdown.bind(this);
    }

    async initialize() {
        try {
            logger.info('🚀 Initializing modern WhatsApp AutoGen Bot...');
            this.startTime = Date.now();

            // Phase 1: Configuration Management
            await this.initializeConfiguration();

            // Phase 2: Register Core Services
            await this.registerServices();

            // Phase 3: Plugin System
            await this.initializePlugins();

            // Phase 4: API Versioning
            await this.initializeAPIVersioning();

            // Phase 5: Setup Graceful Shutdown
            this.setupGracefulShutdown();

            this.isInitialized = true;

            const initTime = Date.now() - this.startTime;
            logger.info(`✅ Application initialized in ${initTime}ms`);

        } catch (error) {
            logger.error('❌ Failed to initialize application:', error);
            throw error;
        }
    }

    async start() {
        if (!this.isInitialized) {
            throw new Error('Application must be initialized before starting');
        }

        try {
            logger.info('🎬 Starting WhatsApp AutoGen Bot...');

            // Initialize database connection
            // const database = this.container.resolve('IDatabase');
            // await database.connect();
            // await database.initializeSchema();

            // // Initialize LLM provider
            // const llmProvider = this.container.resolve('ILLMProvider');
            // await llmProvider.initialize();
            // await llmProvider.testConnection();

            // // Initialize message provider
            // const messageProvider = this.container.resolve('IMessageProvider');
            // await messageProvider.initialize();
            // await messageProvider.connect();
            await this.initializeProviders();
            // Start core services
            await this.startServices();

            // Start web dashboard (after providers + services are up)
            await this.startDashboard();

            this.isRunning = true;

            const totalTime = Date.now() - this.startTime;
            logger.info(`🚀 WhatsApp AutoGen Bot started successfully in ${totalTime}ms`);

            // Emit ready event
            this.container.resolve('EventEmitter').emit('application:ready');

        } catch (error) {
            logger.error('❌ Failed to start application:', error);
            throw error;
        }
    }

    async stop() {
        if (!this.isRunning) return;

        try {
            logger.info('🛑 Stopping WhatsApp AutoGen Bot...');

            this.isRunning = false;

            // Stop services in reverse order
            await this.stopServices();

            // Disconnect providers
            const messageProvider = this.container.resolve('IMessageProvider');
            await messageProvider.disconnect();

            const database = this.container.resolve('IDatabase');
            await database.disconnect();

            // Cleanup plugin manager
            if (this.pluginManager) {
                // Plugin manager cleanup would go here
            }

            // Cleanup configuration
            if (this.config) {
                await this.config.cleanup();
            }

            logger.info('✅ Application stopped gracefully');

        } catch (error) {
            logger.error('❌ Error during application shutdown:', error);
            throw error;
        }
    }

    async initializeConfiguration() {
        logger.info('⚙️ Initializing configuration management...');

        this.config = new ConfigurationManager({
            environment: process.env.NODE_ENV || 'development'
        });

        await this.config.initialize();

        // Register config in container
        this.container.instance('ConfigurationManager', this.config);

        logger.info('✅ Configuration management initialized');
    }

    async registerServices() {
        logger.info('🔧 Registering services...');

        // Register EventEmitter
        const EventEmitter = require('events');
        this.container.instance('EventEmitter', new EventEmitter());

        // Database Service Factory
        this.container.singleton('IDatabase', (container) => {
            const config = container.resolve('ConfigurationManager');
            const dbConfig = config.getSection('database');

            switch (dbConfig.type) {
                case 'postgresql':
                    return new PostgreSQLAdapter(dbConfig.postgresql);
                case 'sqlite':
                default:
                    return new SQLiteAdapter(dbConfig.sqlite);
            }
        });

        // LLM Provider Factory
        this.container.singleton('ILLMProvider', (container) => {
            const config = container.resolve('ConfigurationManager');
            const llmConfig = config.getSection('llm');

            switch (llmConfig.provider) {
                case 'claude':
                    return new ClaudeAdapter(llmConfig.claude);
                case 'azure-openai':
                default:
                    return new AzureOpenAIAdapter(llmConfig.azureOpenAI);
            }
        });

        // Message Provider Factory
        this.container.singleton('IMessageProvider', (container) => {
            const config = container.resolve('ConfigurationManager');
            const messagingConfig = config.getSection('messaging');

            switch (messagingConfig.provider) {
                case 'whatsapp':
                default:
                    return new WhatsAppAdapter(messagingConfig.whatsapp);
            }
        });

        // Python Bridge
        this.container.singleton('PythonBridge', ModernPythonBridge);

        // Media Processor Factory
        this.container.singleton('IMediaProcessor', (container) => {
            const config = container.resolve('ConfigurationManager');
            const mediaConfig = config.getSection('media') || {};
            const provider = mediaConfig.provider || process.env.MEDIA_PROVIDER || 'azure';

            switch (provider.toLowerCase()) {
                case 'local':
                case 'whisper':
                    return new LocalWhisperAdapter(mediaConfig.local || {});
                case 'groq':
                    return new GroqMediaAdapter(mediaConfig.groq || {});
                case 'azure':
                default:
                    return new AzureMediaAdapter(mediaConfig.azure || {});
            }
        });

        // TTS Provider
        this.container.singleton('ITTSProvider', (container) => {
            const config = container.resolve('ConfigurationManager');
            const ttsConfig = config.getSection('tts') || {};
            return new GeminiTTSAdapter(ttsConfig.gemini || {});
        });

        // Core Services
        this.container.singleton('MessageHandlerService', MessageHandlerService);
        this.container.singleton('MediaHandlerService', MediaHandlerService);
        this.container.singleton('AdminService', AdminService);
        this.container.singleton('MetricsService', MetricsService);
        this.container.singleton('NotificationService', NotificationService);

        logger.info('✅ Services registered');
    }
    async initializeProviders() {
        logger.info('🔌 Initializing providers...');

        try {
            // Initialize database connection FIRST
            logger.info('📊 Connecting to database...');
            const database = this.container.resolve('IDatabase');
            await database.connect();
            logger.info('✅ Database connected');

            await database.initializeSchema();
            logger.info('✅ Database schema initialized');

            // Initialize LLM provider
            logger.info('🤖 Initializing LLM provider...');
            const llmProvider = this.container.resolve('ILLMProvider');
            await llmProvider.initialize();
            await llmProvider.testConnection();
            logger.info('✅ LLM provider initialized');

            // Initialize message provider
            logger.info('📱 Initializing message provider...');
            const messageProvider = this.container.resolve('IMessageProvider');
            await messageProvider.initialize();
            await messageProvider.connect();
            logger.info('✅ Message provider initialized');

            // Initialize TTS provider
            logger.info('🎤 Initializing TTS provider...');
            const ttsProvider = this.container.resolve('ITTSProvider');
            await ttsProvider.initialize();
            logger.info('✅ TTS provider initialized');

            logger.info('✅ All providers initialized and connected');

        } catch (error) {
            logger.error('❌ Failed to initialize providers:', error);
            throw error;
        }
    }
    async initializePlugins() {
        const pluginConfig = this.config.getSection('plugins');

        if (!pluginConfig.enabled) {
            logger.info('🔌 Plugin system disabled');
            return;
        }

        logger.info('🔌 Initializing plugin system...');

        this.pluginManager = new PluginManager(this.container);
        await this.pluginManager.initialize();

        // Register in container
        this.container.instance('PluginManager', this.pluginManager);

        logger.info(`✅ Plugin system initialized with ${this.pluginManager.getStatistics().totalPlugins} plugins`);
    }

    async initializeAPIVersioning() {
        const apiConfig = this.config.getSection('api');

        if (!apiConfig.versioning.enabled) {
            logger.info('📝 API versioning disabled');
            return;
        }

        logger.info('📝 Initializing API versioning...');

        this.apiVersionManager = new APIVersionManager();

        // Register supported versions
        for (const version of apiConfig.versioning.supportedVersions) {
            this.apiVersionManager.registerVersion(version, {
                released: new Date(),
                changes: [`Initial ${version} release`]
            });
        }

        // Register in container
        this.container.instance('APIVersionManager', this.apiVersionManager);

        logger.info('✅ API versioning initialized');
    }

    async startDashboard() {
        const dashboardEnabled = process.env.DASHBOARD_ENABLED !== 'false';
        if (!dashboardEnabled) {
            logger.info('🌐 Web dashboard disabled');
            return;
        }

        try {
            logger.info('🌐 Starting web dashboard...');

            const database = this.container.resolve('IDatabase');
            const messageProvider = this.container.resolve('IMessageProvider');

            // Create auth service with the database
            const authService = new AdminAuthService(database);
            this.container.instance('AdminAuthService', authService);

            // Create dashboard with WhatsApp client, database, and auth
            const whatsappClient = messageProvider.client;
            this.dashboard = new DashboardServer(whatsappClient, database, authService);
            this.dashboard.container = this.container;

            const dashboardPort = parseInt(process.env.DASHBOARD_PORT) || 3000;
            await this.dashboard.start(dashboardPort);

            this.container.instance('DashboardServer', this.dashboard);
            logger.info(`✅ Web dashboard running on http://localhost:${dashboardPort}`);

        } catch (error) {
            logger.warn('⚠️ Failed to start web dashboard (non-fatal):', error.message);
        }
    }

    async startServices() {
        logger.info('🎯 Starting core services...');

        const services = [
            'MetricsService',
            'NotificationService',
            'AdminService',
            'PythonBridge',  // Start Python bridge first
            'MediaHandlerService',
            'MessageHandlerService'
        ];

        // Non-critical services that should not crash the app if they fail
        const optionalServices = ['PythonBridge', 'MediaHandlerService'];

        for (const serviceName of services) {
            try {
                const service = this.container.resolve(serviceName);

                if (service.start && typeof service.start === 'function') {
                    await service.start();
                }

                logger.debug(`✅ ${serviceName} started`);
            } catch (error) {
                if (optionalServices.includes(serviceName)) {
                    logger.warn(`⚠️ Optional service ${serviceName} failed to start (will use fallback):`, error.message);
                } else {
                    logger.error(`❌ Failed to start ${serviceName}:`, error);
                    throw error;
                }
            }
        }

        logger.info('✅ Core services started');
    }

    async stopServices() {
        logger.info('🛑 Stopping core services...');

        const services = [
            'MessageHandlerService',
            'PythonBridge',
            'AdminService',
            'NotificationService',
            'MetricsService'
        ];

        for (const serviceName of services) {
            try {
                const service = this.container.resolve(serviceName);

                if (service.stop && typeof service.stop === 'function') {
                    await service.stop();
                }

                logger.debug(`✅ ${serviceName} stopped`);
            } catch (error) {
                logger.warn(`⚠️ Error stopping ${serviceName}:`, error);
            }
        }

        logger.info('✅ Core services stopped');
    }

    setupGracefulShutdown() {
        // Handle process signals
        process.on('SIGTERM', this.gracefulShutdown);
        process.on('SIGINT', this.gracefulShutdown);
        process.on('SIGUSR1', this.gracefulShutdown);
        process.on('SIGUSR2', this.gracefulShutdown);

        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            logger.error('💥 Uncaught Exception:', error);
            this.gracefulShutdown(1);
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
            this.gracefulShutdown(1);
        });

        logger.debug('🛡️ Graceful shutdown handlers registered');
    }

    async gracefulShutdown(exitCode = 0) {
        logger.info('🛑 Graceful shutdown initiated...');

        try {
            await this.stop();
            process.exit(exitCode);
        } catch (error) {
            logger.error('❌ Error during graceful shutdown:', error);
            process.exit(1);
        }
    }

    // Utility methods
    getContainer() {
        return this.container;
    }

    getConfig() {
        return this.config;
    }

    getPluginManager() {
        return this.pluginManager;
    }

    getAPIVersionManager() {
        return this.apiVersionManager;
    }

    isHealthy() {
        return this.isInitialized && this.isRunning;
    }

    getStatus() {
        return {
            initialized: this.isInitialized,
            running: this.isRunning,
            uptime: this.startTime ? Date.now() - this.startTime : 0,
            services: this.container.getRegisteredServices(),
            plugins: this.pluginManager ? this.pluginManager.getStatistics() : null,
            config: this.config ? this.config.getSummary() : null
        };
    }

    // Health check endpoint
    async healthCheck() {
        const status = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: Date.now() - this.startTime,
            services: {},
            providers: {}
        };

        try {
            // Check database
            const database = this.container.resolve('IDatabase');
            status.providers.database = await database.isConnected() ? 'healthy' : 'unhealthy';

            // Check LLM provider
            const llmProvider = this.container.resolve('ILLMProvider');
            status.providers.llm = await llmProvider.isReady() ? 'healthy' : 'unhealthy';

            // Check message provider
            const messageProvider = this.container.resolve('IMessageProvider');
            status.providers.messaging = await messageProvider.isReady() ? 'healthy' : 'unhealthy';

            // Overall health
            const allHealthy = Object.values(status.providers).every(s => s === 'healthy');
            status.status = allHealthy ? 'ok' : 'degraded';

        } catch (error) {
            status.status = 'error';
            status.error = error.message;
        }

        return status;
    }

    // Configuration hot-reload
    async reloadConfiguration() {
        logger.info('🔄 Reloading configuration...');

        try {
            await this.config.reload();

            // Notify services of config change
            const eventEmitter = this.container.resolve('EventEmitter');
            eventEmitter.emit('config:reloaded');

            logger.info('✅ Configuration reloaded');
        } catch (error) {
            logger.error('❌ Failed to reload configuration:', error);
            throw error;
        }
    }

    // Plugin hot-reload
    async reloadPlugins() {
        if (!this.pluginManager) {
            throw new Error('Plugin system not initialized');
        }

        logger.info('🔌 Reloading plugins...');

        try {
            await this.pluginManager.autoLoadPlugins();

            const eventEmitter = this.container.resolve('EventEmitter');
            eventEmitter.emit('plugins:reloaded');

            logger.info('✅ Plugins reloaded');
        } catch (error) {
            logger.error('❌ Failed to reload plugins:', error);
            throw error;
        }
    }
}

module.exports = Application;
