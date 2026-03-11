/**
 * QueryRewriter
 * 
 * Rewrites search queries for better results
 * - Translates Arabic to English
 * - Extracts keywords from verbose queries
 * - Handles common query patterns
 */

const logger = require('../../../utils/logger');

class QueryRewriter {
    constructor(llmProvider = null) {
        this.llmProvider = llmProvider;
    }

    /**
     * Detect if query contains Arabic characters
     */
    _isArabic(text) {
        const arabicRegex = /[\u0600-\u06FF]/;
        return arabicRegex.test(text);
    }

    /**
     * Rewrite query for better search results
     * Returns array of query variants to try
     */
    async rewrite(query) {
        const variants = [query]; // Always include original

        try {
            // If Arabic and LLM available, translate
            if (this._isArabic(query) && this.llmProvider) {
                const translated = await this._translateToEnglish(query);
                if (translated && translated !== query) {
                    variants.push(translated);
                    logger.debug(`🔍 Query rewritten: "${query}" → "${translated}"`);
                }
            }

            // Extract keywords (remove filler words)
            const keywords = this._extractKeywords(query);
            if (keywords && keywords !== query && !variants.includes(keywords)) {
                variants.push(keywords);
            }

        } catch (error) {
            logger.warn(`⚠️ Query rewriting failed: ${error.message}`);
            // Return original query on error (graceful degradation)
        }

        return variants;
    }

    /**
     * Translate Arabic query to English using LLM
     */
    async _translateToEnglish(arabicQuery) {
        if (!this.llmProvider) {
            return null;
        }

        try {
            const prompt = `Convert this Arabic search query to the proper English search term. If it's a person's name, place, or well-known term, provide the correct English spelling. Return ONLY the English search term, nothing else.

Examples:
- "جيفري ابستين" → "Jeffrey Epstein"
- "ابستين" → "Epstein"
- "دونالد ترامب" → "Donald Trump"
- "قطر" → "Qatar"
- "الذكاء الاصطناعي" → "artificial intelligence"

Arabic query: ${arabicQuery}

English search term:`;

            const response = await this.llmProvider.generateResponse([
                { role: 'user', content: prompt }
            ], {
                maxTokens: 50,
                temperature: 0.1  // Lower temperature for more consistent translations
            });

            const translation = response.content.trim()
                .replace(/^["']|["']$/g, '')  // Remove quotes if LLM added them
                .trim();

            // Validate translation (should be different and not too long)
            if (translation && translation !== arabicQuery && translation.length < 200 && translation.length > 0) {
                return translation;
            }

            return null;

        } catch (error) {
            logger.warn(`⚠️ Translation failed: ${error.message}`);
            return null;
        }
    }

    /**
     * Extract keywords by removing common filler words
     */
    _extractKeywords(query) {
        // Arabic filler words
        const arabicFillers = [
            'ممكن', 'تقدر', 'عايز', 'محتاج', 'ابحث', 'تبحث', 'عن',
            'وتقولي', 'قولي', 'عرفت', 'ايه', 'عنو', 'عنه'
        ];

        // English filler words
        const englishFillers = [
            'can you', 'please', 'search for', 'find', 'tell me', 'about',
            'what is', 'who is', 'where is'
        ];

        let cleaned = query.toLowerCase();

        // Remove Arabic fillers
        for (const filler of arabicFillers) {
            cleaned = cleaned.replace(new RegExp(`\\b${filler}\\b`, 'gi'), ' ');
        }

        // Remove English fillers
        for (const filler of englishFillers) {
            cleaned = cleaned.replace(new RegExp(`\\b${filler}\\b`, 'gi'), ' ');
        }

        // Clean up whitespace
        cleaned = cleaned.replace(/\s+/g, ' ').trim();

        return cleaned || query;
    }
}

module.exports = QueryRewriter;
