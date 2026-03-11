/**
 * Media Processor Interface
 * Abstract interface for processing different media types (audio, image, document)
 * Enables switching between Azure Whisper, Google Speech, local Whisper, etc.
 */

class IMediaProcessor {
    // Initialization
    async initialize() {
        throw new Error('initialize() must be implemented');
    }

    async isReady() {
        throw new Error('isReady() must be implemented');
    }

    // Audio Processing (voice notes, audio files)
    async transcribeAudio(audioBuffer, options = {}) {
        throw new Error('transcribeAudio() must be implemented');
    }

    supportsAudio() {
        return false;
    }

    // Image Processing (photos, stickers)
    async analyzeImage(imageBuffer, options = {}) {
        throw new Error('analyzeImage() must be implemented');
    }

    supportsImage() {
        return false;
    }

    // Document Processing (PDF, DOCX, TXT, etc.)
    async extractDocumentText(documentBuffer, mimeType, options = {}) {
        throw new Error('extractDocumentText() must be implemented');
    }

    supportsDocument() {
        return false;
    }

    // Supported formats
    getSupportedAudioFormats() {
        return [];
    }

    getSupportedImageFormats() {
        return [];
    }

    getSupportedDocumentFormats() {
        return [];
    }

    // Health
    getHealthStatus() {
        return {
            processor: 'unknown',
            status: 'unknown',
            supportsAudio: this.supportsAudio(),
            supportsImage: this.supportsImage(),
            supportsDocument: this.supportsDocument()
        };
    }
}

module.exports = IMediaProcessor;
