/**
 * Groq Media Adapter
 * Uses Groq's free API for Whisper transcription
 * Free tier: 14,400 requests/day
 */

const IMediaProcessor = require('../../core/interfaces/IMediaProcessor');
const DocumentExtractor = require('../utils/DocumentExtractor');
const https = require('https');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const FormData = require('form-data');

class GroqMediaAdapter extends IMediaProcessor {
    constructor(config = {}) {
        super();
        this.config = {
            apiKey: config.apiKey || process.env.GROQ_API_KEY,
            model: config.model || 'whisper-large-v3',
            baseUrl: 'https://api.groq.com/openai/v1',
            timeout: config.timeout || 60000,
            ...config
        };
        
        this.documentExtractor = new DocumentExtractor();
        this.isInitialized = false;
    }

    async initialize() {
        try {
            await this.documentExtractor.initialize();
            
            if (!this.config.apiKey) {
                console.warn('⚠️ Groq API key not configured. Set GROQ_API_KEY in .env');
                console.warn('   Get free API key at: https://console.groq.com');
            } else {
                console.log('✅ Groq Media Adapter initialized (model: whisper-large-v3)');
            }
            
            this.isInitialized = true;
        } catch (error) {
            console.error('❌ Failed to initialize Groq adapter:', error.message);
            this.isInitialized = true;
        }
    }

    async isReady() {
        return this.isInitialized && !!this.config.apiKey;
    }

    async transcribeAudio(audioBuffer, options = {}) {
        if (!this.config.apiKey) {
            throw new Error('Groq API key not configured. Set GROQ_API_KEY in .env');
        }

        let tempAudioPath = null;
        
        try {
            // Save audio buffer to temp file (Groq requires file upload)
            tempAudioPath = path.join(os.tmpdir(), `groq_audio_${Date.now()}.ogg`);
            await fs.writeFile(tempAudioPath, audioBuffer);

            // Create form data for multipart upload
            const formData = new FormData();
            formData.append('file', await fs.readFile(tempAudioPath), {
                filename: 'audio.ogg',
                contentType: 'audio/ogg'
            });
            formData.append('model', this.config.model);
            formData.append('response_format', 'json');
            
            if (options.language) {
                formData.append('language', options.language);
            }

            // Make API request
            const result = await this.makeGroqRequest(formData);

            return {
                text: result.text,
                language: options.language || 'en',
                duration: result.duration,
                provider: 'Groq',
                model: this.config.model
            };

        } catch (error) {
            console.error('❌ Groq transcription error:', error.message);
            throw new Error(`Groq transcription failed: ${error.message}`);
        } finally {
            // Cleanup temp file
            if (tempAudioPath) {
                try {
                    await fs.unlink(tempAudioPath);
                } catch (err) {
                    // Ignore cleanup errors
                }
            }
        }
    }

    async makeGroqRequest(formData) {
        return new Promise((resolve, reject) => {
            const options = {
                method: 'POST',
                hostname: 'api.groq.com',
                path: '/openai/v1/audio/transcriptions',
                headers: {
                    'Authorization': `Bearer ${this.config.apiKey}`,
                    ...formData.getHeaders()
                }
            };

            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            const error = JSON.parse(data);
                            reject(new Error(error.error?.message || `HTTP ${res.statusCode}`));
                            return;
                        }

                        const result = JSON.parse(data);
                        resolve(result);
                    } catch (error) {
                        reject(new Error(`Failed to parse Groq response: ${error.message}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Groq API request failed: ${error.message}`));
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Groq API request timeout'));
            });

            req.setTimeout(this.config.timeout);

            formData.pipe(req);
        });
    }

    supportsAudio() {
        return !!this.config.apiKey;
    }

    async analyzeImage(imageBuffer, options = {}) {
        throw new Error('Groq Whisper does not support image analysis. Use Groq Vision or another provider.');
    }

    supportsImage() {
        return false;
    }

    async extractDocumentText(documentBuffer, mimeType, options = {}) {
        return await this.documentExtractor.extract(documentBuffer, mimeType, options);
    }

    supportsDocument() {
        return this.documentExtractor.isAvailable();
    }

    getSupportedAudioFormats() {
        return [
            'audio/ogg',
            'audio/mpeg',
            'audio/mp3',
            'audio/wav',
            'audio/m4a',
            'audio/webm',
            'audio/flac'
        ];
    }

    getSupportedImageFormats() {
        return [];
    }

    getSupportedDocumentFormats() {
        return this.documentExtractor.getSupportedFormats();
    }

    getHealthStatus() {
        return {
            processor: 'Groq',
            status: this.config.apiKey ? 'healthy' : 'not_configured',
            supportsAudio: this.supportsAudio(),
            supportsImage: this.supportsImage(),
            supportsDocument: this.supportsDocument(),
            model: this.config.model,
            apiKeyConfigured: !!this.config.apiKey
        };
    }
}

module.exports = GroqMediaAdapter;
