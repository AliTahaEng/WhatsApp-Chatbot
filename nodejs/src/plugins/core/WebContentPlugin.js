/**
 * Web Content Plugin
 * 
 * Provides tools to fetch and extract content from web pages
 * Follows DEVELOPMENT_PRINCIPLES.md (SRP, Interface Abstraction)
 */

const https = require('https');
const http = require('http');
const logger = require('../../utils/logger');

class WebContentPlugin {
    constructor() {
        this.name = 'web-content';
        this.version = '1.0.0';
        this.description = 'Fetch and extract content from web pages';
        this.author = 'WhatsApp AutoGen Bot';
        this.type = 'tool';

        this.defaultConfig = {
            timeout: 15000,
            maxContentLength: 5 * 1024 * 1024, // 5MB
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        };

        this.tools = {
            'web_get': {
                description: 'Fetch the raw HTML content of a web page',
                category: 'information',
                parameters: {
                    url: {
                        type: 'string',
                        description: 'URL to fetch',
                        required: true
                    }
                },
                examples: [
                    { url: 'https://example.com/article' }
                ],
                execute: this.fetchPage.bind(this)
            },
            'web_extract': {
                description: 'Extract readable text content from a web page (removes ads, navigation, etc.)',
                category: 'information',
                parameters: {
                    url: {
                        type: 'string',
                        description: 'URL to extract content from',
                        required: true
                    }
                },
                examples: [
                    { url: 'https://example.com/article' }
                ],
                execute: this.extractContent.bind(this)
            }
        };
    }

    async initialize(config) {
        this.config = { ...this.defaultConfig, ...config };

        // Check if readability dependencies are available
        try {
            this.Readability = require('@mozilla/readability');
            this.JSDOM = require('jsdom').JSDOM;
            this.hasReadability = true;
            logger.info('🌐 Web Content Plugin initialized (with readability)');
        } catch (error) {
            this.hasReadability = false;
            logger.warn('🌐 Web Content Plugin initialized (readability not available - install @mozilla/readability and jsdom)');
        }
    }

    async fetchPage(parameters, context) {
        const { url } = parameters;

        if (!url || typeof url !== 'string') {
            throw new Error('URL is required');
        }

        try {
            logger.debug(`🌐 Fetching: ${url}`);

            const html = await this._fetch(url);

            return {
                url,
                content: html,
                length: html.length,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            logger.error(`❌ Failed to fetch ${url}: ${error.message}`);
            throw new Error(`Failed to fetch page: ${error.message}`);
        }
    }

    async extractContent(parameters, context) {
        const { url } = parameters;

        if (!url || typeof url !== 'string') {
            throw new Error('URL is required');
        }

        if (!this.hasReadability) {
            throw new Error('Readability not available. Install: npm install @mozilla/readability jsdom');
        }

        try {
            logger.debug(`🌐 Extracting content from: ${url}`);

            // Fetch HTML
            const html = await this._fetch(url);

            // Parse and extract readable content
            const extracted = this._extractReadableContent(html, url);

            logger.debug(`🌐 Extracted ${extracted.textContent.length} chars from ${url}`);

            return {
                url,
                title: extracted.title,
                content: extracted.textContent,
                excerpt: extracted.excerpt,
                length: extracted.length,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            logger.error(`❌ Failed to extract content from ${url}: ${error.message}`);
            throw new Error(`Failed to extract content: ${error.message}`);
        }
    }

    async _fetch(url) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const protocol = urlObj.protocol === 'https:' ? https : http;

            const timeout = setTimeout(() => {
                reject(new Error('Request timeout'));
            }, this.config.timeout);

            const options = {
                headers: {
                    'User-Agent': this.config.userAgent,
                    'Accept': 'text/html,application/xhtml+xml',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            };

            protocol.get(url, options, (res) => {
                // Handle redirects
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    clearTimeout(timeout);
                    return this._fetch(res.headers.location).then(resolve).catch(reject);
                }

                if (res.statusCode !== 200) {
                    clearTimeout(timeout);
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }

                let data = '';
                let length = 0;

                res.on('data', (chunk) => {
                    length += chunk.length;
                    if (length > this.config.maxContentLength) {
                        res.destroy();
                        clearTimeout(timeout);
                        reject(new Error('Content too large'));
                        return;
                    }
                    data += chunk;
                });

                res.on('end', () => {
                    clearTimeout(timeout);
                    resolve(data);
                });

            }).on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }

    _extractReadableContent(html, url) {
        try {
            const dom = new this.JSDOM(html, { url });
            const reader = new this.Readability(dom.window.document);
            const article = reader.parse();

            if (!article) {
                throw new Error('Failed to extract readable content');
            }

            return {
                title: article.title || 'Untitled',
                textContent: article.textContent.substring(0, 10000), // Limit to 10k chars
                excerpt: article.excerpt || article.textContent.substring(0, 300),
                length: article.textContent.length
            };

        } catch (error) {
            throw new Error(`Readability extraction failed: ${error.message}`);
        }
    }

    async cleanup() {
        logger.info('🌐 Web Content Plugin cleaned up');
    }
}

module.exports = WebContentPlugin;
