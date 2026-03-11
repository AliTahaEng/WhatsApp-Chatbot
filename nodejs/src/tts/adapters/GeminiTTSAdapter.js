/**
 * Gemini TTS Adapter
 * Uses Google Gemini 2.5 Flash TTS for text-to-speech
 * Supports Egyptian Arabic and English voices
 */

const ITTSProvider = require('../../core/interfaces/ITTSProvider');
const https = require('https');
const { execFile } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class GeminiTTSAdapter extends ITTSProvider {
    constructor(config = {}) {
        super();
        this.config = {
            apiKey: config.apiKey || process.env.GOOGLE_GENAI_API_KEY,
            model: 'gemini-2.5-flash-preview-tts',
            egyptianVoice: config.egyptianVoice || process.env.TTS_EGYPTIAN_VOICE || 'Puck',
            englishVoice: config.englishVoice || process.env.TTS_ENGLISH_VOICE || 'Puck',
            sampleRate: 24000,
            ...config
        };

        this.isInitialized = false;
    }

    async initialize() {
        try {
            if (!this.config.apiKey) {
                console.warn('⚠️ Google GenAI API key not configured. Set GOOGLE_GENAI_API_KEY in .env');
                console.warn('   Get free API key at: https://aistudio.google.com/app/apikey');
            } else {
                console.log('✅ Gemini TTS initialized (Egyptian Arabic + English)');
            }

            this.isInitialized = true;
        } catch (error) {
            console.error('❌ Failed to initialize Gemini TTS:', error.message);
            this.isInitialized = true;
        }
    }

    async isReady() {
        return this.isInitialized && !!this.config.apiKey;
    }

    detectLanguage(text) {
        // Simple Arabic detection: check for Arabic characters
        const arabicPattern = /[\u0600-\u06FF]/;
        return arabicPattern.test(text) ? 'ar' : 'en';
    }

    async textToSpeech(text, options = {}) {
        if (!this.config.apiKey) {
            throw new Error('Google GenAI API key not configured. Set GOOGLE_GENAI_API_KEY in .env');
        }

        const language = options.language || this.detectLanguage(text);
        const voiceName = language === 'ar' ? this.config.egyptianVoice : this.config.englishVoice;

        // Build prompt based on language
        let prompt;
        if (language === 'ar') {
            prompt = `Say the following in a natural, authentic Egyptian dialect (Ammiya) with a warm tone: "${text}"`;
        } else {
            prompt = `Say the following in a natural, clear English voice: "${text}"`;
        }

        try {
            const audioData = await this.callGeminiTTS(prompt, voiceName);

            // Convert base64 PCM to OGG for WhatsApp
            const oggBuffer = await this.convertPCMToOgg(audioData);

            return oggBuffer;

        } catch (error) {
            console.error('❌ Gemini TTS error:', error.message);
            throw new Error(`TTS failed: ${error.message}`);
        }
    }

    async callGeminiTTS(prompt, voiceName) {
        return new Promise((resolve, reject) => {
            const requestBody = JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: voiceName
                            }
                        }
                    }
                }
            });

            const options = {
                method: 'POST',
                hostname: 'generativelanguage.googleapis.com',
                path: `/v1beta/models/${this.config.model}:generateContent?key=${this.config.apiKey}`,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestBody)
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
                        const base64Audio = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

                        if (!base64Audio) {
                            console.error('Gemini Response:', result);
                            reject(new Error('No audio data returned from Gemini API'));
                            return;
                        }

                        resolve(base64Audio);
                    } catch (error) {
                        reject(new Error(`Failed to parse Gemini response: ${error.message}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Gemini API request failed: ${error.message}`));
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Gemini API request timeout'));
            });

            req.setTimeout(30000);
            req.write(requestBody);
            req.end();
        });
    }

    async convertPCMToOgg(base64Audio) {
        const pcmBuffer = Buffer.from(base64Audio, 'base64');
        const timestamp = Date.now();
        const rawPath = path.join(os.tmpdir(), `tts_raw_${timestamp}.pcm`);
        const oggPath = path.join(os.tmpdir(), `tts_out_${timestamp}.ogg`);

        try {
            // Write raw PCM to temp file
            await fs.writeFile(rawPath, pcmBuffer);

            // Convert PCM → OGG Opus using ffmpeg
            await new Promise((resolve, reject) => {
                execFile('ffmpeg', [
                    '-y',
                    '-f', 's16le',           // raw PCM signed 16-bit little-endian
                    '-ar', String(this.config.sampleRate), // sample rate from Gemini (24000)
                    '-ac', '1',              // mono
                    '-i', rawPath,           // input raw PCM file
                    '-c:a', 'libopus',       // encode to Opus
                    '-b:a', '64k',           // bitrate
                    '-vbr', 'on',
                    oggPath                  // output OGG file
                ], { timeout: 15000 }, (error, stdout, stderr) => {
                    if (error) {
                        reject(new Error(`ffmpeg conversion failed: ${error.message}`));
                    } else {
                        resolve();
                    }
                });
            });

            // Read the OGG file
            const oggBuffer = await fs.readFile(oggPath);
            return oggBuffer;

        } finally {
            // Cleanup temp files
            try { await fs.unlink(rawPath); } catch (e) { /* ignore */ }
            try { await fs.unlink(oggPath); } catch (e) { /* ignore */ }
        }
    }

    getSupportedLanguages() {
        return ['ar', 'en'];
    }

    getHealthStatus() {
        return {
            provider: 'GeminiTTS',
            status: this.config.apiKey ? 'healthy' : 'not_configured',
            apiKeyConfigured: !!this.config.apiKey,
            supportedLanguages: this.getSupportedLanguages(),
            voices: {
                arabic: this.config.egyptianVoice,
                english: this.config.englishVoice
            }
        };
    }
}

module.exports = GeminiTTSAdapter;
