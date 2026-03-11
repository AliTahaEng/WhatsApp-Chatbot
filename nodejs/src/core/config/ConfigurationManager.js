/**
 * Configuration Manager
 * Centralized configuration management with environment-specific overrides
 * Supports hot-reloading, validation, and secure configuration handling
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');

class ConfigurationManager {
    constructor(options = {}) {
        this.configPath = options.configPath || process.cwd();
        this.environment = options.environment || process.env.NODE_ENV || 'development';
        this.config = {};
        this.watchers = new Map();
        this.validators = new Map();
        this.subscribers = new Map();
        this.schema = null;
        this.encrypted = new Set(); // Track encrypted config keys
        
        this.defaultConfig = {
            // Database configuration
            database: {
                type: 'sqlite',
                sqlite: {
                    path: './data/database.db',
                    journalMode: 'WAL',
                    synchronous: 'NORMAL',
                    cacheSize: 10000,
                    busyTimeout: 5000
                },
                postgresql: {
                    host: 'localhost',
                    port: 5432,
                    database: 'whatsapp_bot',
                    user: 'postgres',
                    password: '',
                    max: 20,
                    ssl: false
                }
            },
            
            // LLM configuration
            llm: {
                provider: 'azure-openai',
                azureOpenAI: {
                    endpoint: null,
                    apiKey: null,
                    deployment: 'gpt-4',
                    apiVersion: '2024-02-01',
                    maxTokens: 4096,
                    temperature: 0.7,
                    topP: 0.95
                },
                claude: {
                    apiKey: null,
                    model: 'claude-3-sonnet-20240229',
                    maxTokens: 4096,
                    temperature: 0.7,
                    topP: 0.95
                }
            },
            
            // Message provider configuration
            messaging: {
                provider: 'whatsapp',
                whatsapp: {
                    sessionPath: './data/session',
                    mediaPath: './data/media',
                    qrCodeInTerminal: true,
                    puppeteerArgs: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage'
                    ]
                }
            },
            
            // API configuration
            api: {
                versioning: {
                    enabled: true,
                    defaultVersion: 'v1',
                    supportedVersions: ['v1', 'v2']
                },
                cors: {
                    origin: '*',
                    methods: ['GET', 'POST', 'PUT', 'DELETE'],
                    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Version']
                }
            },
            
            // Plugin system configuration
            plugins: {
                enabled: true,
                autoLoad: true,
                maxPlugins: 50,
                timeout: 30000,
                directory: './plugins'
            },
            
            // Security configuration
            security: {
                sessionSecret: null,
                encryptionKey: null,
                jwtSecret: null,
                rateLimiting: {
                    windowMs: 15 * 60 * 1000,
                    max: 100
                }
            },
            
            // Logging configuration
            logging: {
                level: 'info',
                file: './data/logs/app.log',
                maxSize: 10485760,
                maxFiles: 5,
                colorize: true
            },
            
            // Performance configuration
            performance: {
                maxConcurrentRequests: 10,
                requestTimeout: 30000,
                enableCaching: true,
                cacheTTL: 300000
            }
        };
    }

    async initialize() {
        try {
            // Load configurations in order of priority
            await this.loadDefaultConfig();
            await this.loadEnvironmentConfig();
            await this.loadFileConfig();
            await this.loadEnvironmentVariables();
            
            // Validate configuration
            await this.validate();
            
            // Setup file watching for hot-reload
            await this.setupFileWatching();
            
            logger.info(`✅ Configuration manager initialized (${this.environment})`);
        } catch (error) {
            logger.error('❌ Failed to initialize configuration manager:', error);
            throw error;
        }
    }

    // Load default configuration
    async loadDefaultConfig() {
        this.config = JSON.parse(JSON.stringify(this.defaultConfig));
    }

    // Load environment-specific configuration
    async loadEnvironmentConfig() {
        const envConfigPath = path.join(this.configPath, `config.${this.environment}.json`);
        
        if (fs.existsSync(envConfigPath)) {
            try {
                const envConfig = JSON.parse(fs.readFileSync(envConfigPath, 'utf8'));
                this.config = this.mergeDeep(this.config, envConfig);
                logger.debug(`📄 Loaded environment config: ${envConfigPath}`);
            } catch (error) {
                logger.warn(`⚠️ Failed to load environment config: ${error.message}`);
            }
        }
    }

    // Load configuration from files
    async loadFileConfig() {
        const configFiles = [
            'config.json',
            'config.local.json'
        ];

        for (const configFile of configFiles) {
            const configPath = path.join(this.configPath, configFile);
            
            if (fs.existsSync(configPath)) {
                try {
                    const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                    this.config = this.mergeDeep(this.config, fileConfig);
                    logger.debug(`📄 Loaded config file: ${configPath}`);
                } catch (error) {
                    logger.warn(`⚠️ Failed to load config file ${configFile}: ${error.message}`);
                }
            }
        }
    }

    // Load configuration from environment variables
    async loadEnvironmentVariables() {
        const envMappings = {
            // Database
            'DATABASE_TYPE': 'database.type',
            'DATABASE_PATH': 'database.sqlite.path',
            'PG_HOST': 'database.postgresql.host',
            'PG_PORT': 'database.postgresql.port',
            'PG_DATABASE': 'database.postgresql.database',
            'PG_USER': 'database.postgresql.user',
            'PG_PASSWORD': 'database.postgresql.password',
            
            // LLM
            'LLM_PROVIDER': 'llm.provider',
            'AZURE_OPENAI_ENDPOINT': 'llm.azureOpenAI.endpoint',
            'AZURE_OPENAI_API_KEY': 'llm.azureOpenAI.apiKey',
            'AZURE_OPENAI_DEPLOYMENT': 'llm.azureOpenAI.deployment',
            'AZURE_OPENAI_API_VERSION': 'llm.azureOpenAI.apiVersion',
            'AZURE_OPENAI_MAX_TOKENS': 'llm.azureOpenAI.maxTokens',
            'AZURE_OPENAI_TEMPERATURE': 'llm.azureOpenAI.temperature',
            'ANTHROPIC_API_KEY': 'llm.claude.apiKey',
            'CLAUDE_MODEL': 'llm.claude.model',
            
            // Messaging
            'MESSAGING_PROVIDER': 'messaging.provider',
            'WHATSAPP_SESSION_PATH': 'messaging.whatsapp.sessionPath',
            'WHATSAPP_MEDIA_PATH': 'messaging.whatsapp.mediaPath',
            
            // Security
            'SESSION_SECRET': 'security.sessionSecret',
            'ENCRYPTION_KEY': 'security.encryptionKey',
            'JWT_SECRET': 'security.jwtSecret',
            
            // Logging
            'LOG_LEVEL': 'logging.level',
            'LOG_FILE': 'logging.file',
            
            // Plugins
            'PLUGINS_ENABLED': 'plugins.enabled',
            'PLUGINS_DIRECTORY': 'plugins.directory'
        };

        for (const [envVar, configPath] of Object.entries(envMappings)) {
            const value = process.env[envVar];
            if (value !== undefined) {
                this.setNestedValue(this.config, configPath, this.parseValue(value));
                
                // Mark sensitive keys as encrypted
                if (envVar.includes('KEY') || envVar.includes('SECRET') || envVar.includes('PASSWORD')) {
                    this.encrypted.add(configPath);
                }
            }
        }
    }

    // Get configuration value
    get(path, defaultValue = undefined) {
        return this.getNestedValue(this.config, path, defaultValue);
    }

    // Set configuration value
    set(path, value) {
        this.setNestedValue(this.config, path, value);
        this.notifySubscribers(path, value);
    }

    // Check if configuration key exists
    has(path) {
        return this.getNestedValue(this.config, path) !== undefined;
    }

    // Get entire configuration object
    getAll() {
        return JSON.parse(JSON.stringify(this.config));
    }

    // Get configuration for specific section
    getSection(section) {
        return this.get(section, {});
    }

    // Validate configuration against schema
    async validate() {
        if (!this.schema) return;

        try {
            const Ajv = require('ajv');
            const ajv = new Ajv();
            const validate = ajv.compile(this.schema);
            const valid = validate(this.config);

            if (!valid) {
                const errors = validate.errors.map(err => 
                    `${err.instancePath}: ${err.message}`
                ).join(', ');
                throw new Error(`Configuration validation failed: ${errors}`);
            }

            logger.debug('✅ Configuration validation passed');
        } catch (error) {
            logger.error('❌ Configuration validation failed:', error);
            throw error;
        }
    }

    // Set validation schema
    setSchema(schema) {
        this.schema = schema;
    }

    // Register configuration validator
    addValidator(path, validator) {
        this.validators.set(path, validator);
    }

    // Subscribe to configuration changes
    subscribe(path, callback) {
        if (!this.subscribers.has(path)) {
            this.subscribers.set(path, new Set());
        }
        this.subscribers.get(path).add(callback);

        // Return unsubscribe function
        return () => {
            this.subscribers.get(path).delete(callback);
            if (this.subscribers.get(path).size === 0) {
                this.subscribers.delete(path);
            }
        };
    }

    // Setup file watching for hot-reload
    async setupFileWatching() {
        if (this.environment === 'production') return; // Disable in production

        const configFiles = [
            'config.json',
            'config.local.json',
            `config.${this.environment}.json`
        ];

        for (const configFile of configFiles) {
            const configPath = path.join(this.configPath, configFile);
            
            if (fs.existsSync(configPath)) {
                try {
                    const watcher = fs.watch(configPath, async (eventType) => {
                        if (eventType === 'change') {
                            logger.info(`📄 Configuration file changed: ${configFile}`);
                            await this.reload();
                        }
                    });
                    
                    this.watchers.set(configFile, watcher);
                    logger.debug(`👁️ Watching config file: ${configFile}`);
                } catch (error) {
                    logger.warn(`⚠️ Failed to watch config file ${configFile}: ${error.message}`);
                }
            }
        }
    }

    // Reload configuration
    async reload() {
        try {
            const oldConfig = JSON.parse(JSON.stringify(this.config));
            
            await this.loadDefaultConfig();
            await this.loadEnvironmentConfig();
            await this.loadFileConfig();
            await this.loadEnvironmentVariables();
            await this.validate();
            
            // Notify subscribers of changes
            this.detectAndNotifyChanges(oldConfig, this.config);
            
            logger.info('🔄 Configuration reloaded');
        } catch (error) {
            logger.error('❌ Failed to reload configuration:', error);
            throw error;
        }
    }

    // Export configuration to file
    async export(filePath, options = {}) {
        try {
            let exportConfig = JSON.parse(JSON.stringify(this.config));
            
            // Mask sensitive values if requested
            if (options.maskSensitive !== false) {
                exportConfig = this.maskSensitiveValues(exportConfig);
            }
            
            const content = JSON.stringify(exportConfig, null, 2);
            fs.writeFileSync(filePath, content, 'utf8');
            
            logger.info(`💾 Configuration exported to: ${filePath}`);
        } catch (error) {
            logger.error(`❌ Failed to export configuration: ${error.message}`);
            throw error;
        }
    }

    // Get configuration summary for debugging
    getSummary() {
        const summary = {
            environment: this.environment,
            loadedFiles: [],
            validationEnabled: !!this.schema,
            watchingEnabled: this.watchers.size > 0,
            subscribers: this.subscribers.size,
            validators: this.validators.size,
            encryptedKeys: Array.from(this.encrypted)
        };

        // Check which config files exist
        const configFiles = [
            'config.json',
            'config.local.json',
            `config.${this.environment}.json`
        ];

        for (const configFile of configFiles) {
            if (fs.existsSync(path.join(this.configPath, configFile))) {
                summary.loadedFiles.push(configFile);
            }
        }

        return summary;
    }

    // Cleanup resources
    async cleanup() {
        // Stop file watchers
        for (const watcher of this.watchers.values()) {
            watcher.close();
        }
        this.watchers.clear();

        // Clear subscribers
        this.subscribers.clear();

        logger.debug('🧹 Configuration manager cleaned up');
    }

    // Helper methods
    getNestedValue(obj, path, defaultValue = undefined) {
        const keys = path.split('.');
        let current = obj;

        for (const key of keys) {
            if (current === null || current === undefined || typeof current !== 'object') {
                return defaultValue;
            }
            current = current[key];
        }

        return current !== undefined ? current : defaultValue;
    }

    setNestedValue(obj, path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        let current = obj;

        for (const key of keys) {
            if (current[key] === undefined || current[key] === null) {
                current[key] = {};
            }
            current = current[key];
        }

        current[lastKey] = value;
    }

    parseValue(value) {
        // Try to parse as JSON first
        try {
            return JSON.parse(value);
        } catch {
            // If not JSON, parse as appropriate type
            if (value === 'true') return true;
            if (value === 'false') return false;
            if (/^\d+$/.test(value)) return parseInt(value);
            if (/^\d*\.\d+$/.test(value)) return parseFloat(value);
            return value;
        }
    }

    mergeDeep(target, source) {
        const result = { ...target };

        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = this.mergeDeep(result[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }

        return result;
    }

    maskSensitiveValues(obj, path = '') {
        const result = { ...obj };

        for (const key in result) {
            const currentPath = path ? `${path}.${key}` : key;
            
            if (this.encrypted.has(currentPath)) {
                result[key] = '***MASKED***';
            } else if (typeof result[key] === 'object' && result[key] !== null) {
                result[key] = this.maskSensitiveValues(result[key], currentPath);
            }
        }

        return result;
    }

    notifySubscribers(path, value) {
        // Notify exact path subscribers
        if (this.subscribers.has(path)) {
            for (const callback of this.subscribers.get(path)) {
                try {
                    callback(value, path);
                } catch (error) {
                    logger.error(`❌ Subscriber notification failed for ${path}:`, error);
                }
            }
        }

        // Notify parent path subscribers
        const pathParts = path.split('.');
        for (let i = pathParts.length - 1; i > 0; i--) {
            const parentPath = pathParts.slice(0, i).join('.');
            if (this.subscribers.has(parentPath)) {
                const parentValue = this.get(parentPath);
                for (const callback of this.subscribers.get(parentPath)) {
                    try {
                        callback(parentValue, parentPath);
                    } catch (error) {
                        logger.error(`❌ Parent subscriber notification failed for ${parentPath}:`, error);
                    }
                }
            }
        }
    }

    detectAndNotifyChanges(oldConfig, newConfig, path = '') {
        const allKeys = new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)]);

        for (const key of allKeys) {
            const currentPath = path ? `${path}.${key}` : key;
            const oldValue = oldConfig[key];
            const newValue = newConfig[key];

            if (oldValue !== newValue) {
                if (typeof oldValue === 'object' && typeof newValue === 'object' && 
                    oldValue !== null && newValue !== null) {
                    // Recursively check nested objects
                    this.detectAndNotifyChanges(oldValue, newValue, currentPath);
                } else {
                    // Value changed, notify subscribers
                    this.notifySubscribers(currentPath, newValue);
                }
            }
        }
    }
}

module.exports = ConfigurationManager;
