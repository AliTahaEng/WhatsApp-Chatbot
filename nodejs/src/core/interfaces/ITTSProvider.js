/**
 * Text-to-Speech Provider Interface
 * Defines contract for TTS implementations
 */

class ITTSProvider {
    /**
     * Initialize the TTS provider
     */
    async initialize() {
        throw new Error('initialize() must be implemented');
    }

    /**
     * Check if provider is ready
     */
    async isReady() {
        throw new Error('isReady() must be implemented');
    }

    /**
     * Convert text to speech audio
     * @param {string} text - Text to convert to speech
     * @param {object} options - TTS options (language, voice, etc.)
     * @returns {Promise<Buffer>} Audio buffer (OGG format for WhatsApp)
     */
    async textToSpeech(text, options = {}) {
        throw new Error('textToSpeech() must be implemented');
    }

    /**
     * Detect language of text
     * @param {string} text - Text to analyze
     * @returns {string} Language code ('ar' or 'en')
     */
    detectLanguage(text) {
        throw new Error('detectLanguage() must be implemented');
    }

    /**
     * Get supported languages
     * @returns {Array<string>} Array of language codes
     */
    getSupportedLanguages() {
        throw new Error('getSupportedLanguages() must be implemented');
    }

    /**
     * Get health status
     * @returns {object} Health status information
     */
    getHealthStatus() {
        throw new Error('getHealthStatus() must be implemented');
    }
}

module.exports = ITTSProvider;
