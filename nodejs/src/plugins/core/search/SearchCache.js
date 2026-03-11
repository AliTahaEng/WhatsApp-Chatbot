/**
 * SearchCache
 * 
 * In-memory cache for search results with TTL
 * Follows Performance Best Practices from DEVELOPMENT_PRINCIPLES.md
 */

class SearchCache {
    constructor(ttlMs = 30 * 60 * 1000) { // Default 30 minutes
        this.cache = new Map();
        this.ttlMs = ttlMs;
    }

    /**
     * Generate cache key from query and options
     */
    _generateKey(provider, query, options = {}) {
        const normalizedQuery = query.toLowerCase().trim();
        const optionsKey = JSON.stringify(options);
        return `${provider}:${normalizedQuery}:${optionsKey}`;
    }

    /**
     * Get cached result if not expired
     */
    get(provider, query, options = {}) {
        const key = this._generateKey(provider, query, options);
        const cached = this.cache.get(key);

        if (!cached) {
            return null;
        }

        const now = Date.now();
        if (now - cached.timestamp > this.ttlMs) {
            // Expired
            this.cache.delete(key);
            return null;
        }

        return cached.result;
    }

    /**
     * Store result in cache
     */
    set(provider, query, result, options = {}) {
        const key = this._generateKey(provider, query, options);
        this.cache.set(key, {
            result,
            timestamp: Date.now()
        });
    }

    /**
     * Clear all cached entries
     */
    clear() {
        this.cache.clear();
    }

    /**
     * Get cache statistics
     */
    getStats() {
        return {
            size: this.cache.size,
            ttlMs: this.ttlMs
        };
    }

    /**
     * Clean up expired entries (run periodically)
     */
    cleanup() {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > this.ttlMs) {
                this.cache.delete(key);
                cleaned++;
            }
        }

        return cleaned;
    }
}

module.exports = SearchCache;
