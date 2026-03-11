/**
 * Azure Media Adapter
 * Implements IMediaProcessor for Azure OpenAI services
 * - Audio: Whisper transcription via Azure OpenAI
 * - Image: GPT-4 Vision analysis via Azure OpenAI
 * - Document: delegates to DocumentExtractor utility
 */

const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');
const IMediaProcessor = require('../../core/interfaces/IMediaProcessor');
const DocumentExtractor = require('../utils/DocumentExtractor');
const logger = require('../../utils/logger');

class AzureMediaAdapter extends IMediaProcessor {
    constructor(config = {}) {
        super();
        this.config = {
            endpoint: config.endpoint || process.env.AZURE_OPENAI_ENDPOINT,
            apiKey: config.apiKey || process.env.AZURE_OPENAI_API_KEY,
            apiVersion: config.apiVersion || process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview',
            whisperDeployment: config.whisperDeployment || process.env.AZURE_WHISPER_DEPLOYMENT || 'whisper',
            visionDeployment: config.visionDeployment || process.env.AZURE_VISION_DEPLOYMENT || process.env.AZURE_OPENAI_DEPLOYMENT,
            mediaPath: config.mediaPath || process.env.WHATSAPP_MEDIA_PATH || './data/media',
            ...config
        };

        this.whisperClient = null;
        this.visionClient = null;
        this.documentExtractor = new DocumentExtractor();
        this._isReady = false;
    }

    async initialize() {
        try {
            if (!this.config.endpoint || !this.config.apiKey) {
                throw new Error('Missing Azure OpenAI endpoint or API key for media processing');
            }

            // Ensure media directory exists
            if (!fs.existsSync(this.config.mediaPath)) {
                fs.mkdirSync(this.config.mediaPath, { recursive: true });
            }

            // Initialize Whisper client (separate deployment)
            if (this.config.whisperDeployment) {
                this.whisperClient = new OpenAI({
                    apiKey: this.config.apiKey,
                    baseURL: `${this.config.endpoint}/openai/deployments/${this.config.whisperDeployment}`,
                    defaultQuery: { 'api-version': this.config.apiVersion },
                    defaultHeaders: { 'api-key': this.config.apiKey }
                });
            }

            // Initialize Vision client (can be same as main GPT-4 deployment)
            if (this.config.visionDeployment) {
                this.visionClient = new OpenAI({
                    apiKey: this.config.apiKey,
                    baseURL: `${this.config.endpoint}/openai/deployments/${this.config.visionDeployment}`,
                    defaultQuery: { 'api-version': this.config.apiVersion },
                    defaultHeaders: { 'api-key': this.config.apiKey }
                });
            }

            // Initialize document extractor
            await this.documentExtractor.initialize();

            this._isReady = true;
            logger.info('✅ AzureMediaAdapter initialized');
        } catch (error) {
            logger.error('❌ Failed to initialize AzureMediaAdapter:', error.message);
            throw error;
        }
    }

    async isReady() {
        return this._isReady;
    }

    // =====================================================
    // AUDIO TRANSCRIPTION
    // =====================================================

    async transcribeAudio(audioBuffer, options = {}) {
        if (!this.whisperClient) {
            throw new Error('Whisper client not configured. Set AZURE_WHISPER_DEPLOYMENT in .env');
        }

        let tempFilePath = null;
        try {
            // Write buffer to a temp file (OpenAI SDK requires a file-like object)
            const ext = options.format || 'ogg';
            tempFilePath = path.join(os.tmpdir(), `wa_audio_${Date.now()}.${ext}`);
            fs.writeFileSync(tempFilePath, audioBuffer);

            const response = await this.whisperClient.audio.transcriptions.create({
                file: fs.createReadStream(tempFilePath),
                model: 'whisper-1',
                language: options.language || undefined,
                response_format: 'text'
            });

            const transcription = typeof response === 'string' ? response : response.text || '';

            logger.info(`🎤 Audio transcribed: ${transcription.substring(0, 80)}...`);

            return {
                text: transcription.trim(),
                language: options.language || 'auto',
                provider: 'Azure OpenAI Whisper'
            };
        } finally {
            // Clean up temp file
            if (tempFilePath && fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
        }
    }

    supportsAudio() {
        return !!this.whisperClient;
    }

    getSupportedAudioFormats() {
        return ['ogg', 'mp3', 'wav', 'webm', 'm4a', 'mp4', 'mpeg', 'mpga'];
    }

    // =====================================================
    // IMAGE ANALYSIS
    // =====================================================

    async analyzeImage(imageBuffer, options = {}) {
        if (!this.visionClient) {
            throw new Error('Vision client not configured. Set AZURE_VISION_DEPLOYMENT in .env');
        }

        const base64Image = imageBuffer.toString('base64');
        const mimeType = options.mimeType || 'image/jpeg';
        const prompt = options.prompt || 'Describe this image in detail. If there is text in the image, extract it.';

        const response = await this.visionClient.chat.completions.create({
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${mimeType};base64,${base64Image}`,
                            detail: options.detail || 'auto'
                        }
                    }
                ]
            }],
            max_tokens: options.maxTokens || 1000,
            temperature: options.temperature || 0.3
        });

        const description = response.choices[0]?.message?.content || '';

        logger.info(`🖼️ Image analyzed: ${description.substring(0, 80)}...`);

        return {
            text: description.trim(),
            usage: {
                promptTokens: response.usage?.prompt_tokens || 0,
                completionTokens: response.usage?.completion_tokens || 0,
                totalTokens: response.usage?.total_tokens || 0
            },
            provider: 'Azure OpenAI Vision'
        };
    }

    supportsImage() {
        return !!this.visionClient;
    }

    getSupportedImageFormats() {
        return ['jpeg', 'jpg', 'png', 'gif', 'webp'];
    }

    // =====================================================
    // DOCUMENT EXTRACTION
    // =====================================================

    async extractDocumentText(documentBuffer, mimeType, options = {}) {
        return await this.documentExtractor.extract(documentBuffer, mimeType, options);
    }

    supportsDocument() {
        return this.documentExtractor.isAvailable();
    }

    getSupportedDocumentFormats() {
        return this.documentExtractor.getSupportedFormats();
    }

    // =====================================================
    // HEALTH
    // =====================================================

    getHealthStatus() {
        return {
            processor: 'AzureMediaAdapter',
            status: this._isReady ? 'ready' : 'not_ready',
            supportsAudio: this.supportsAudio(),
            supportsImage: this.supportsImage(),
            supportsDocument: this.supportsDocument(),
            whisperDeployment: this.config.whisperDeployment,
            visionDeployment: this.config.visionDeployment
        };
    }
}

module.exports = AzureMediaAdapter;
