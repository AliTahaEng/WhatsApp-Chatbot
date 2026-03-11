/**
 * ISearchProvider Interface
 * 
 * Contract for search provider implementations (DuckDuckGo, Wikipedia, etc.)
 * Follows Interface Abstraction principle from DEVELOPMENT_PRINCIPLES.md
 */

class ISearchProvider {
    /**
     * Get provider name for logging/debugging
     * @returns {string}
     */
    getName() {
        throw new Error('getName() must be implemented');
    }

    /**
     * Search for information
     * @param {string} query - Search query
     * @param {object} options - Search options (maxResults, language, etc.)
     * @returns {Promise<SearchResult>}
     */
    async search(query, options = {}) {
        throw new Error('search() must be implemented');
    }

    /**
     * Check if this provider is suitable for the given query
     * @param {string} query - Search query
     * @returns {boolean}
     */
    isRelevantFor(query) {
        throw new Error('isRelevantFor() must be implemented');
    }
}

/**
 * @typedef {Object} SearchResult
 * @property {string} query - Original query
 * @property {Array<SearchResultItem>} results - Array of search results
 * @property {string} provider - Provider name
 * @property {number} count - Number of results
 * @property {string} [answer] - Quick answer if available
 * @property {object} [metadata] - Additional metadata
 */

/**
 * @typedef {Object} SearchResultItem
 * @property {string} title - Result title
 * @property {string} snippet - Result snippet/description
 * @property {string} url - Result URL
 * @property {string} [displayUrl] - Display URL (shorter)
 * @property {string} [source] - Source name
 * @property {string} [publishedDate] - Published date if available
 */

module.exports = ISearchProvider;
