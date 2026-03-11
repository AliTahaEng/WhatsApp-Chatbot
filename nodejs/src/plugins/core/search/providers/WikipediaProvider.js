/**
 * WikipediaProvider
 * 
 * Uses Wikipedia API for factual queries
 * Follows Adapter Pattern from DEVELOPMENT_PRINCIPLES.md
 */

const https = require('https');
const ISearchProvider = require('../../../../core/interfaces/ISearchProvider');
const logger = require('../../../../utils/logger');

class WikipediaProvider extends ISearchProvider {
    constructor(config = {}) {
        super();
        this.timeout = config.timeout || 10000;
        this.maxResults = config.maxResults || 5;
        this.language = config.language || 'en';
    }

    getName() {
        return 'Wikipedia';
    }

    isRelevantFor(query) {
        // Wikipedia is good for factual/encyclopedic queries
        const factualKeywords = [
            'what is', 'who is', 'where is', 'when was', 'define',
            'history of', 'capital of', 'population of', 'meaning of',
            'ما هو', 'من هو', 'اين', 'متى', 'تعريف', 'معنى'
        ];

        const lowerQuery = query.toLowerCase();
        return factualKeywords.some(keyword => lowerQuery.includes(keyword));
    }

    async search(query, options = {}) {
        const maxResults = options.maxResults || this.maxResults;
        const language = options.language || this.language;

        try {
            logger.debug(`📚 [Wikipedia] Searching: ${query}`);

            // First, search for matching pages
            const searchResults = await this._searchPages(query, language, maxResults);

            if (searchResults.length === 0) {
                return {
                    query,
                    results: [],
                    count: 0,
                    provider: this.getName()
                };
            }

            // Get extracts for top results
            const results = await this._getExtracts(searchResults, language);

            logger.debug(`📚 [Wikipedia] Found ${results.length} results`);

            return {
                query,
                results,
                count: results.length,
                provider: this.getName(),
                answer: results.length > 0 ? results[0].snippet : null,
                metadata: {
                    language
                }
            };

        } catch (error) {
            logger.error(`❌ [Wikipedia] Search failed: ${error.message}`);
            throw error;
        }
    }

    async _searchPages(query, language, limit) {
        return new Promise((resolve, reject) => {
            const encodedQuery = encodeURIComponent(query);
            const url = `https://${language}.wikipedia.org/w/api.php?action=opensearch&search=${encodedQuery}&limit=${limit}&format=json`;

            const timeout = setTimeout(() => {
                reject(new Error('Request timeout'));
            }, this.timeout);

            https.get(url, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    clearTimeout(timeout);

                    try {
                        const parsed = JSON.parse(data);
                        // OpenSearch format: [query, [titles], [descriptions], [urls]]
                        const titles = parsed[1] || [];
                        const descriptions = parsed[2] || [];
                        const urls = parsed[3] || [];

                        const results = titles.map((title, i) => ({
                            title,
                            description: descriptions[i] || '',
                            url: urls[i] || ''
                        }));

                        resolve(results);
                    } catch (error) {
                        reject(error);
                    }
                });

            }).on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }

    async _getExtracts(searchResults, language) {
        if (searchResults.length === 0) {
            return [];
        }

        return new Promise((resolve, reject) => {
            const titles = searchResults.map(r => r.title).join('|');
            const encodedTitles = encodeURIComponent(titles);
            const url = `https://${language}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&titles=${encodedTitles}&format=json`;

            const timeout = setTimeout(() => {
                reject(new Error('Request timeout'));
            }, this.timeout);

            https.get(url, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    clearTimeout(timeout);

                    try {
                        const parsed = JSON.parse(data);
                        const pages = parsed.query?.pages || {};
                        const results = [];

                        for (const pageId in pages) {
                            const page = pages[pageId];
                            if (page.extract) {
                                const searchResult = searchResults.find(r => r.title === page.title);
                                results.push({
                                    title: page.title,
                                    snippet: page.extract.substring(0, 500),
                                    url: searchResult?.url || `https://${language}.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
                                    displayUrl: `${language}.wikipedia.org`,
                                    source: 'Wikipedia',
                                    publishedDate: null
                                });
                            }
                        }

                        resolve(results);
                    } catch (error) {
                        reject(error);
                    }
                });

            }).on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }
}

module.exports = WikipediaProvider;
