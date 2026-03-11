/**
 * Plugin Manager
 * Extensible plugin system for adding tools, skills, and features to agents
 * Supports MCP (Model Context Protocol), custom tools, and external integrations
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class PluginManager {
    constructor(container = null) {
        this.container = container;
        this.plugins = new Map();
        this.tools = new Map();
        this.skills = new Map();
        this.mcps = new Map(); // Model Context Protocol providers
        this.hooks = new Map();
        this.pluginDirectory = path.join(__dirname, '../../plugins');
        this.config = {
            autoLoad: true,
            enableMCP: true,
            enableTools: true,
            enableSkills: true,
            maxPlugins: 50,
            pluginTimeout: 90000
        };

        this.eventEmitter = new (require('events'))();
        this.initializeHooks();
    }

    async initialize() {
        try {
            // Ensure plugin directory exists
            if (!fs.existsSync(this.pluginDirectory)) {
                fs.mkdirSync(this.pluginDirectory, { recursive: true });
                logger.info(`📁 Created plugin directory: ${this.pluginDirectory}`);
            }

            // Load core plugins
            await this.loadCorePlugins();

            // Auto-load user plugins if enabled
            if (this.config.autoLoad) {
                await this.autoLoadPlugins();
            }

            logger.info(`✅ Plugin manager initialized with ${this.plugins.size} plugins`);
        } catch (error) {
            logger.error('❌ Failed to initialize plugin manager:', error);
            throw error;
        }
    }

    // Register a plugin
    async registerPlugin(pluginName, pluginModule, options = {}) {
        try {
            if (this.plugins.has(pluginName)) {
                throw new Error(`Plugin ${pluginName} already registered`);
            }

            if (this.plugins.size >= this.config.maxPlugins) {
                throw new Error('Maximum number of plugins reached');
            }

            // Validate plugin structure
            this.validatePlugin(pluginModule);

            const plugin = {
                name: pluginName,
                module: pluginModule,
                version: pluginModule.version || '1.0.0',
                description: pluginModule.description || '',
                author: pluginModule.author || 'Unknown',
                dependencies: pluginModule.dependencies || [],
                type: pluginModule.type || 'tool', // tool, skill, mcp, integration
                enabled: options.enabled !== false,
                config: { ...pluginModule.defaultConfig, ...options.config },
                registeredAt: new Date(),
                hooks: new Set(),
                tools: new Map(),
                skills: new Map()
            };

            // Initialize plugin (pass container for DI access)
            if (pluginModule.initialize) {
                await pluginModule.initialize(plugin.config, this.container);
            }

            // Register tools from plugin
            if (pluginModule.tools) {
                for (const [toolName, toolHandler] of Object.entries(pluginModule.tools)) {
                    await this.registerTool(toolName, toolHandler, pluginName);
                    plugin.tools.set(toolName, toolHandler);
                }
            }

            // Register skills from plugin
            if (pluginModule.skills) {
                for (const [skillName, skillHandler] of Object.entries(pluginModule.skills)) {
                    await this.registerSkill(skillName, skillHandler, pluginName);
                    plugin.skills.set(skillName, skillHandler);
                }
            }

            // Register MCP provider
            if (pluginModule.type === 'mcp' && pluginModule.mcpProvider) {
                await this.registerMCP(pluginName, pluginModule.mcpProvider);
            }

            // Register hooks
            if (pluginModule.hooks) {
                for (const [hookName, hookHandler] of Object.entries(pluginModule.hooks)) {
                    this.registerHook(hookName, hookHandler, pluginName);
                    plugin.hooks.add(hookName);
                }
            }

            this.plugins.set(pluginName, plugin);
            this.eventEmitter.emit('plugin:registered', plugin);

            logger.info(`🔌 Plugin registered: ${pluginName} v${plugin.version}`);
            return plugin;

        } catch (error) {
            logger.error(`❌ Failed to register plugin ${pluginName}:`, error);
            throw error;
        }
    }

    // Unregister a plugin
    async unregisterPlugin(pluginName) {
        if (!this.plugins.has(pluginName)) {
            throw new Error(`Plugin ${pluginName} not found`);
        }

        const plugin = this.plugins.get(pluginName);

        try {
            // Cleanup plugin
            if (plugin.module.cleanup) {
                await plugin.module.cleanup();
            }

            // Remove tools
            for (const toolName of plugin.tools.keys()) {
                this.tools.delete(toolName);
            }

            // Remove skills
            for (const skillName of plugin.skills.keys()) {
                this.skills.delete(skillName);
            }

            // Remove MCP
            if (this.mcps.has(pluginName)) {
                this.mcps.delete(pluginName);
            }

            // Remove hooks
            for (const hookName of plugin.hooks) {
                this.removeHook(hookName, pluginName);
            }

            this.plugins.delete(pluginName);
            this.eventEmitter.emit('plugin:unregistered', plugin);

            logger.info(`🔌 Plugin unregistered: ${pluginName}`);

        } catch (error) {
            logger.error(`❌ Failed to unregister plugin ${pluginName}:`, error);
            throw error;
        }
    }

    // Register a tool
    async registerTool(toolName, toolHandler, pluginName = 'core') {
        if (this.tools.has(toolName)) {
            throw new Error(`Tool ${toolName} already registered`);
        }

        const tool = {
            name: toolName,
            handler: toolHandler,
            plugin: pluginName,
            description: toolHandler.description || '',
            parameters: toolHandler.parameters || {},
            examples: toolHandler.examples || [],
            category: toolHandler.category || 'general',
            registeredAt: new Date()
        };

        this.tools.set(toolName, tool);
        this.eventEmitter.emit('tool:registered', tool);

        logger.debug(`🔧 Tool registered: ${toolName} (${pluginName})`);
        return tool;
    }

    // Register a skill
    async registerSkill(skillName, skillHandler, pluginName = 'core') {
        if (this.skills.has(skillName)) {
            throw new Error(`Skill ${skillName} already registered`);
        }

        const skill = {
            name: skillName,
            handler: skillHandler,
            plugin: pluginName,
            description: skillHandler.description || '',
            triggers: skillHandler.triggers || [],
            category: skillHandler.category || 'general',
            priority: skillHandler.priority || 5,
            registeredAt: new Date()
        };

        this.skills.set(skillName, skill);
        this.eventEmitter.emit('skill:registered', skill);

        logger.debug(`🎯 Skill registered: ${skillName} (${pluginName})`);
        return skill;
    }

    // Register MCP provider
    async registerMCP(providerName, mcpProvider) {
        if (this.mcps.has(providerName)) {
            throw new Error(`MCP provider ${providerName} already registered`);
        }

        const mcp = {
            name: providerName,
            provider: mcpProvider,
            capabilities: mcpProvider.capabilities || [],
            endpoints: mcpProvider.endpoints || {},
            registeredAt: new Date()
        };

        this.mcps.set(providerName, mcp);
        this.eventEmitter.emit('mcp:registered', mcp);

        logger.debug(`🌐 MCP provider registered: ${providerName}`);
        return mcp;
    }

    // Execute a tool
    async executeTool(toolName, parameters = {}, context = {}) {
        if (!this.tools.has(toolName)) {
            throw new Error(`Tool ${toolName} not found`);
        }

        const tool = this.tools.get(toolName);
        const plugin = this.plugins.get(tool.plugin);

        if (!plugin || !plugin.enabled) {
            throw new Error(`Tool ${toolName} is not available (plugin disabled)`);
        }

        try {
            // Execute pre-tool hooks
            await this.executeHooks('before:tool', { toolName, parameters, context });

            const startTime = Date.now();
            let result;

            // Execute tool with timeout
            result = await Promise.race([
                tool.handler.execute(parameters, context),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Tool execution timeout')), this.config.pluginTimeout)
                )
            ]);

            const executionTime = Date.now() - startTime;

            // Execute post-tool hooks
            await this.executeHooks('after:tool', { toolName, parameters, context, result, executionTime });

            this.eventEmitter.emit('tool:executed', { toolName, result, executionTime });

            return {
                success: true,
                result,
                tool: toolName,
                plugin: tool.plugin,
                executionTime
            };

        } catch (error) {
            logger.error(`❌ Tool execution failed: ${toolName}:`, error);

            await this.executeHooks('error:tool', { toolName, parameters, context, error });

            return {
                success: false,
                error: error.message,
                tool: toolName,
                plugin: tool.plugin
            };
        }
    }

    // Execute a skill
    async executeSkill(skillName, input = {}, context = {}) {
        if (!this.skills.has(skillName)) {
            throw new Error(`Skill ${skillName} not found`);
        }

        const skill = this.skills.get(skillName);
        const plugin = this.plugins.get(skill.plugin);

        if (!plugin || !plugin.enabled) {
            throw new Error(`Skill ${skillName} is not available (plugin disabled)`);
        }

        try {
            // Execute pre-skill hooks
            await this.executeHooks('before:skill', { skillName, input, context });

            const startTime = Date.now();
            const result = await skill.handler.execute(input, context);
            const executionTime = Date.now() - startTime;

            // Execute post-skill hooks
            await this.executeHooks('after:skill', { skillName, input, context, result, executionTime });

            this.eventEmitter.emit('skill:executed', { skillName, result, executionTime });

            return {
                success: true,
                result,
                skill: skillName,
                plugin: skill.plugin,
                executionTime
            };

        } catch (error) {
            logger.error(`❌ Skill execution failed: ${skillName}:`, error);
            return {
                success: false,
                error: error.message,
                skill: skillName,
                plugin: skill.plugin
            };
        }
    }

    // Find relevant skills for input
    findRelevantSkills(input, threshold = 0.5) {
        const relevantSkills = [];

        for (const [skillName, skill] of this.skills.entries()) {
            const plugin = this.plugins.get(skill.plugin);
            if (!plugin || !plugin.enabled) continue;

            let relevance = 0;

            // Check trigger keywords
            if (skill.triggers.length > 0) {
                const inputLower = input.toLowerCase();
                const triggerMatches = skill.triggers.filter(trigger =>
                    inputLower.includes(trigger.toLowerCase())
                ).length;

                relevance = triggerMatches / skill.triggers.length;
            }

            // Check if skill has custom relevance detection
            if (skill.handler.isRelevant) {
                try {
                    const customRelevance = skill.handler.isRelevant(input);
                    relevance = Math.max(relevance, customRelevance);
                } catch (error) {
                    logger.debug(`Error in skill relevance detection: ${skillName}:`, error);
                }
            }

            if (relevance >= threshold) {
                relevantSkills.push({
                    ...skill,
                    relevance,
                    priority: skill.priority || 5
                });
            }
        }

        // Sort by relevance and priority
        return relevantSkills.sort((a, b) => {
            if (a.relevance !== b.relevance) {
                return b.relevance - a.relevance;
            }
            return b.priority - a.priority;
        });
    }

    // Get available tools for agent
    getAvailableTools(category = null) {
        const availableTools = [];

        for (const [toolName, tool] of this.tools.entries()) {
            const plugin = this.plugins.get(tool.plugin);
            if (!plugin || !plugin.enabled) continue;

            if (!category || tool.category === category) {
                availableTools.push({
                    name: toolName,
                    description: tool.description,
                    parameters: tool.parameters,
                    category: tool.category,
                    plugin: tool.plugin,
                    examples: tool.examples
                });
            }
        }

        return availableTools;
    }

    // Get MCP providers
    getMCPProviders() {
        const providers = [];

        for (const [providerName, mcp] of this.mcps.entries()) {
            providers.push({
                name: providerName,
                capabilities: mcp.capabilities,
                endpoints: mcp.endpoints
            });
        }

        return providers;
    }

    // Hook system
    registerHook(hookName, handler, pluginName) {
        if (!this.hooks.has(hookName)) {
            this.hooks.set(hookName, []);
        }

        this.hooks.get(hookName).push({
            handler,
            plugin: pluginName,
            registeredAt: new Date()
        });

        logger.debug(`🪝 Hook registered: ${hookName} (${pluginName})`);
    }

    removeHook(hookName, pluginName) {
        if (this.hooks.has(hookName)) {
            const handlers = this.hooks.get(hookName);
            const filtered = handlers.filter(h => h.plugin !== pluginName);
            this.hooks.set(hookName, filtered);
        }
    }

    async executeHooks(hookName, data) {
        if (!this.hooks.has(hookName)) return;

        const handlers = this.hooks.get(hookName);

        for (const hook of handlers) {
            try {
                await hook.handler(data);
            } catch (error) {
                logger.error(`❌ Hook execution failed: ${hookName} (${hook.plugin}):`, error);
            }
        }
    }

    // Plugin management
    async enablePlugin(pluginName) {
        if (!this.plugins.has(pluginName)) {
            throw new Error(`Plugin ${pluginName} not found`);
        }

        const plugin = this.plugins.get(pluginName);
        plugin.enabled = true;

        logger.info(`✅ Plugin enabled: ${pluginName}`);
        this.eventEmitter.emit('plugin:enabled', plugin);
    }

    async disablePlugin(pluginName) {
        if (!this.plugins.has(pluginName)) {
            throw new Error(`Plugin ${pluginName} not found`);
        }

        const plugin = this.plugins.get(pluginName);
        plugin.enabled = false;

        logger.info(`⏸️ Plugin disabled: ${pluginName}`);
        this.eventEmitter.emit('plugin:disabled', plugin);
    }

    // Load plugins from directory
    async autoLoadPlugins() {
        try {
            const pluginDirs = fs.readdirSync(this.pluginDirectory, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            for (const pluginDir of pluginDirs) {
                try {
                    await this.loadPluginFromDirectory(path.join(this.pluginDirectory, pluginDir));
                } catch (error) {
                    logger.warn(`⚠️ Failed to load plugin from ${pluginDir}:`, error.message);
                }
            }

        } catch (error) {
            logger.error('❌ Failed to auto-load plugins:', error);
        }
    }

    async loadPluginFromDirectory(pluginPath) {
        const packagePath = path.join(pluginPath, 'package.json');
        const mainPath = path.join(pluginPath, 'index.js');

        if (!fs.existsSync(packagePath) || !fs.existsSync(mainPath)) {
            throw new Error('Invalid plugin structure');
        }

        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        const pluginModule = require(mainPath);

        await this.registerPlugin(packageJson.name, pluginModule, {
            config: packageJson.pluginConfig || {}
        });
    }

    async loadCorePlugins() {
        // Load essential core plugins
        const corePlugins = [
            require('./core/WebSearchPlugin'),
            require('./core/FileManagerPlugin'),
            require('./core/CalculatorPlugin'),
            require('./core/WeatherPlugin')
        ];

        for (const PluginClass of corePlugins) {
            try {
                const plugin = new PluginClass();
                await this.registerPlugin(plugin.name, plugin);
            } catch (error) {
                logger.warn(`⚠️ Failed to load core plugin:`, error.message);
            }
        }
    }

    validatePlugin(pluginModule) {
        if (!pluginModule || typeof pluginModule !== 'object') {
            throw new Error('Plugin must be an object');
        }

        if (!pluginModule.name || typeof pluginModule.name !== 'string') {
            throw new Error('Plugin must have a name property');
        }

        if (!pluginModule.version) {
            pluginModule.version = '1.0.0';
        }

        // Validate tools structure
        if (pluginModule.tools) {
            for (const [toolName, tool] of Object.entries(pluginModule.tools)) {
                if (!tool.execute || typeof tool.execute !== 'function') {
                    throw new Error(`Tool ${toolName} must have an execute function`);
                }
            }
        }

        // Validate skills structure
        if (pluginModule.skills) {
            for (const [skillName, skill] of Object.entries(pluginModule.skills)) {
                if (!skill.execute || typeof skill.execute !== 'function') {
                    throw new Error(`Skill ${skillName} must have an execute function`);
                }
            }
        }
    }

    initializeHooks() {
        // Initialize common hook points
        const commonHooks = [
            'before:message',
            'after:message',
            'before:tool',
            'after:tool',
            'before:skill',
            'after:skill',
            'error:tool',
            'error:skill',
            'agent:start',
            'agent:end'
        ];

        for (const hookName of commonHooks) {
            this.hooks.set(hookName, []);
        }
    }

    // Get plugin statistics
    getStatistics() {
        const stats = {
            totalPlugins: this.plugins.size,
            enabledPlugins: 0,
            disabledPlugins: 0,
            totalTools: this.tools.size,
            totalSkills: this.skills.size,
            totalMCPs: this.mcps.size,
            pluginsByType: {},
            toolsByCategory: {},
            skillsByCategory: {}
        };

        for (const plugin of this.plugins.values()) {
            if (plugin.enabled) {
                stats.enabledPlugins++;
            } else {
                stats.disabledPlugins++;
            }

            const type = plugin.type || 'unknown';
            stats.pluginsByType[type] = (stats.pluginsByType[type] || 0) + 1;
        }

        for (const tool of this.tools.values()) {
            const category = tool.category || 'unknown';
            stats.toolsByCategory[category] = (stats.toolsByCategory[category] || 0) + 1;
        }

        for (const skill of this.skills.values()) {
            const category = skill.category || 'unknown';
            stats.skillsByCategory[category] = (stats.skillsByCategory[category] || 0) + 1;
        }

        return stats;
    }

    // Get all plugins info
    getPluginsInfo() {
        return Array.from(this.plugins.values()).map(plugin => ({
            name: plugin.name,
            version: plugin.version,
            description: plugin.description,
            author: plugin.author,
            type: plugin.type,
            enabled: plugin.enabled,
            tools: Array.from(plugin.tools.keys()),
            skills: Array.from(plugin.skills.keys()),
            registeredAt: plugin.registeredAt
        }));
    }
}

module.exports = PluginManager;
