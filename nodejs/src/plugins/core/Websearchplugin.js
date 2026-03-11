/**
 * Web Search Plugin (v3 — Python Research Agent)
 * 
 * When the primary agent calls web_search, this plugin delegates to a
 * Python ResearchService that performs iterative research:
 *   1. Searches DuckDuckGo (python duckduckgo-search lib)
 *   2. Fetches full content from top URLs (BeautifulSoup)
 *   3. Translates Arabic queries to English automatically
 *   4. Returns comprehensive information + source URLs
 *
 * Falls back to Node.js providers if Python bridge is unavailable.
 *
 * Follows DEVELOPMENT_PRINCIPLES.md:
 * - Dependency Injection (receives container)
 * - Graceful Degradation (Python → Node.js fallback)
 * - Performance Best Practices (caching)
 */

const logger = require('../../utils/logger');
const SearchCache = require('./search/SearchCache');

class WebSearchPlugin {
    constructor() {
        this.name = 'web-search';
        this.version = '3.0.0';
        this.description = 'Deep web research with iterative search, content extraction, and source citations';
        this.author = 'WhatsApp AutoGen Bot';
        this.type = 'tool';

        this.defaultConfig = {
            maxResults: 3,
            timeout: 60000,       // 60s — research takes longer than a simple search
            cacheEnabled: true,
            cacheTTL: 30 * 60 * 1000 // 30 minutes
        };

        this.tools = {
            'web_search': {
                description: 'Research a topic on the web. Searches DuckDuckGo, fetches full content from top sources, and returns comprehensive information with source URLs. Supports Arabic and English queries.',
                category: 'information',
                parameters: {
                    query: {
                        type: 'string',
                        description: 'Search query (Arabic or English)',
                        required: true
                    },
                    maxResults: {
                        type: 'number',
                        description: 'Maximum number of sources to collect (1-5)',
                        required: false,
                        default: 3
                    }
                },
                examples: [
                    { query: 'Jeffrey Epstein', maxResults: 3 },
                    { query: 'ما هو الذكاء الاصطناعي', maxResults: 3 },
                    { query: 'latest quantum computing breakthroughs', maxResults: 3 }
                ],
                execute: this.search.bind(this)
            }
        };

        this.pythonBridge = null;
        this.cache = null;
    }

    async initialize(config, container = null) {
        this.config = { ...this.defaultConfig, ...config };
        this.container = container;

        // Initialize cache
        if (this.config.cacheEnabled) {
            this.cache = new SearchCache(this.config.cacheTTL);
        }

        // Try to get Python bridge for research delegation
        if (container) {
            try {
                this.pythonBridge = container.resolve('PythonBridge');
                if (this.pythonBridge && this.pythonBridge.isReady()) {
                    logger.info('� Web Search Plugin v3 initialized (Python ResearchService)');
                } else {
                    this.pythonBridge = null;
                    logger.warn('� Web Search Plugin v3 initialized (Python bridge not ready — will retry at search time)');
                }
            } catch (error) {
                this.pythonBridge = null;
                logger.warn('🔬 Web Search Plugin v3 initialized (no Python bridge — will retry at search time)');
            }
        } else {
            logger.info('🔬 Web Search Plugin v3 initialized (no container)');
        }
    }

    async search(parameters, context) {
        const { query, maxResults = this.config.maxResults } = parameters;

        if (!query || typeof query !== 'string' || query.trim().length === 0) {
            throw new Error('Search query is required');
        }

        try {
            // Check cache first
            if (this.cache) {
                const cached = this.cache.get('research', query, { maxResults });
                if (cached) {
                    logger.debug(`� Cache hit for: ${query}`);
                    return cached;
                }
            }

            logger.info(`� Starting research for: "${query}"`);

            // Primary: delegate to Python ResearchService
            let result = await this._researchViaPython(query, maxResults);

            // Cache successful results
            if (this.cache && result && result.source_count > 0) {
                this.cache.set('research', query, result, { maxResults });
            }

            return result;

        } catch (error) {
            logger.error('❌ Web search error:', error);
            throw new Error(`Web search failed: ${error.message}`);
        }
    }

    async _researchViaPython(query, maxSources) {
        // Resolve bridge lazily (it may not be ready at init time)
        let bridge = this.pythonBridge;
        if (!bridge && this.container) {
            try {
                bridge = this.container.resolve('PythonBridge');
                if (bridge && bridge.isReady()) {
                    this.pythonBridge = bridge;
                }
            } catch (e) { /* ignore */ }
        }

        if (!bridge || !bridge.isReady()) {
            logger.warn('� Python bridge unavailable for research');
            return {
                query,
                summary: 'Research service unavailable. Python bridge is not connected.',
                sources: [],
                source_count: 0,
                provider: 'none'
            };
        }

        logger.debug(`� Sending research request to Python: "${query}"`);

        const result = await bridge.sendRequest('web_research', {
            query,
            options: {
                max_sources: maxSources,
                max_iterations: 2
            }
        }, this.config.timeout);

        logger.info(`� Research complete: ${result.source_count || 0} sources collected`);

        return result;
    }

    async cleanup() {
        if (this.cache) {
            const cleaned = this.cache.cleanup();
            logger.debug(`� Cleaned ${cleaned} expired cache entries`);
        }
        logger.info('� Web Search Plugin cleaned up');
    }
}

module.exports = WebSearchPlugin;