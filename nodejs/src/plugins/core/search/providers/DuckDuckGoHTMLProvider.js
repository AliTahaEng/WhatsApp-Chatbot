/**
 * DuckDuckGoHTMLProvider
 * 
 * Scrapes DuckDuckGo HTML results for better coverage than Instant Answer API
 * Follows Adapter Pattern from DEVELOPMENT_PRINCIPLES.md
 */

const https = require('https');
const ISearchProvider = require('../../../../core/interfaces/ISearchProvider');
const logger = require('../../../../utils/logger');

class DuckDuckGoHTMLProvider extends ISearchProvider {
    constructor(config = {}) {
        super();
        this.timeout = config.timeout || 10000;
        this.maxResults = config.maxResults || 5;
        this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    }

    getName() {
        return 'DuckDuckGo HTML';
    }

    isRelevantFor(query) {
        // DuckDuckGo is good for general queries
        return true;
    }

    async search(query, options = {}) {
        const maxResults = options.maxResults || this.maxResults;

        try {
            logger.debug(`🔍 [DDG HTML] Searching: ${query}`);

            const html = await this._fetchHTML(query);
            const results = this._parseResults(html, maxResults);

            logger.debug(`🔍 [DDG HTML] Found ${results.length} results`);

            return {
                query,
                results,
                count: results.length,
                provider: this.getName(),
                metadata: {
                    source: 'html_scraping'
                }
            };

        } catch (error) {
            logger.error(`❌ [DDG HTML] Search failed: ${error.message}`);
            throw error;
        }
    }

    async _fetchHTML(query) {
        return new Promise((resolve, reject) => {
            const encodedQuery = encodeURIComponent(query);
            const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

            const timeout = setTimeout(() => {
                reject(new Error('Request timeout'));
            }, this.timeout);

            const options = {
                headers: {
                    'User-Agent': this.userAgent,
                    'Accept': 'text/html',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            };

            https.get(url, options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
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

    _parseResults(html, maxResults) {
        const results = [];

        try {
            // DuckDuckGo HTML uses specific class names for results
            // Pattern: <div class="result__body">
            const resultPattern = /<div class="result__body">[\s\S]*?<\/div>\s*<\/div>/g;
            const matches = html.match(resultPattern) || [];

            for (let i = 0; i < Math.min(matches.length, maxResults); i++) {
                const match = matches[i];

                // Extract title
                const titleMatch = match.match(/<a class="result__a"[^>]*>(.*?)<\/a>/);
                const title = titleMatch ? this._cleanHTML(titleMatch[1]) : '';

                // Extract URL
                const urlMatch = match.match(/<a class="result__a" href="([^"]+)"/);
                const url = urlMatch ? this._decodeURL(urlMatch[1]) : '';

                // Extract snippet
                const snippetMatch = match.match(/<a class="result__snippet"[^>]*>(.*?)<\/a>/);
                const snippet = snippetMatch ? this._cleanHTML(snippetMatch[1]) : '';

                if (title && url) {
                    results.push({
                        title: title.substring(0, 200),
                        snippet: snippet.substring(0, 300),
                        url,
                        displayUrl: this._getDisplayUrl(url),
                        source: this.getName()
                    });
                }
            }

        } catch (error) {
            logger.warn(`⚠️ [DDG HTML] Parse error: ${error.message}`);
        }

        return results;
    }

    _cleanHTML(text) {
        return text
            .replace(/<[^>]*>/g, '') // Remove HTML tags
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&nbsp;/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    _decodeURL(url) {
        // DuckDuckGo wraps URLs in a redirect
        // Format: //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com
        try {
            if (url.includes('uddg=')) {
                const uddgMatch = url.match(/uddg=([^&]+)/);
                if (uddgMatch) {
                    return decodeURIComponent(uddgMatch[1]);
                }
            }
            return url;
        } catch (error) {
            return url;
        }
    }

    _getDisplayUrl(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname + urlObj.pathname.substring(0, 30);
        } catch (error) {
            return url.substring(0, 50);
        }
    }
}

module.exports = DuckDuckGoHTMLProvider;
