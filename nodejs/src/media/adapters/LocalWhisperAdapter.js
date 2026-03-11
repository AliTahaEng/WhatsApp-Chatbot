/**
 * Local Whisper Media Adapter with Audio Preprocessing
 * Uses open-source Whisper model running locally via Python
 * Includes noise reduction and audio normalization for better transcription quality
 */

const IMediaProcessor = require('../../core/interfaces/IMediaProcessor');
const DocumentExtractor = require('../utils/DocumentExtractor');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class LocalWhisperAdapter extends IMediaProcessor {
    constructor(config = {}) {
        super();
        this.config = {
            modelSize: config.modelSize || process.env.LOCAL_WHISPER_MODEL || 'medium',
            language: config.language || 'ar',
            pythonPath: config.pythonPath || 'python',
            enablePreprocessing: config.enablePreprocessing !== false,
            noiseReduction: config.noiseReduction !== false,
            normalize: config.normalize !== false,
            ...config
        };
        
        this.preprocessingAvailable = false;
        this.documentExtractor = new DocumentExtractor();
        this.isInitialized = false;
        this.whisperAvailable = false;
    }

    async initialize() {
        try {
            await this.documentExtractor.initialize();
            
            this.whisperAvailable = await this.checkWhisperInstalled();
            
            if (this.config.enablePreprocessing) {
                this.preprocessingAvailable = await this.checkPreprocessingLibraries();
            }
            
            if (this.whisperAvailable) {
                const preprocessMsg = this.preprocessingAvailable ? ' with audio enhancement' : '';
                console.log(`✅ Local Whisper initialized (model: ${this.config.modelSize})${preprocessMsg}`);
                if (!this.preprocessingAvailable && this.config.enablePreprocessing) {
                    console.warn('⚠️ Audio preprocessing not available. Install: pip install noisereduce soundfile');
                }
            } else {
                console.warn('⚠️ Local Whisper not installed. Run: pip install openai-whisper');
            }
            
            this.isInitialized = true;
        } catch (error) {
            console.error('❌ Failed to initialize Local Whisper:', error.message);
            this.isInitialized = true;
        }
    }

    async checkWhisperInstalled() {
        return new Promise((resolve) => {
            const proc = spawn(this.config.pythonPath, ['-c', 'import whisper; print("OK")']);
            
            let output = '';
            proc.stdout.on('data', (data) => {
                output += data.toString();
            });
            
            proc.on('close', (code) => {
                resolve(code === 0 && output.includes('OK'));
            });
            
            proc.on('error', () => resolve(false));
            
            setTimeout(() => {
                proc.kill();
                resolve(false);
            }, 5000);
        });
    }

    async checkPreprocessingLibraries() {
        return new Promise((resolve) => {
            const checkScript = 'import noisereduce; import soundfile; print("OK")';
            const proc = spawn(this.config.pythonPath, ['-c', checkScript]);
            
            let output = '';
            proc.stdout.on('data', (data) => {
                output += data.toString();
            });
            
            proc.on('close', (code) => {
                resolve(code === 0 && output.includes('OK'));
            });
            
            proc.on('error', () => resolve(false));
            
            setTimeout(() => {
                proc.kill();
                resolve(false);
            }, 5000);
        });
    }

    async isReady() {
        return this.isInitialized;
    }

    async transcribeAudio(audioBuffer, options = {}) {
        if (!this.whisperAvailable) {
            throw new Error('Local Whisper not installed. Install with: pip install openai-whisper');
        }

        let tempAudioPath = null;
        let processedAudioPath = null;
        
        try {
            tempAudioPath = path.join(os.tmpdir(), `whisper_${Date.now()}.ogg`);
            await fs.writeFile(tempAudioPath, audioBuffer);

            if (this.config.enablePreprocessing && this.preprocessingAvailable) {
                processedAudioPath = await this.preprocessAudio(tempAudioPath);
            }

            const audioToTranscribe = processedAudioPath || tempAudioPath;
            const transcription = await this.runWhisperTranscription(audioToTranscribe, options);

            return {
                text: transcription.text,
                language: transcription.language || this.config.language,
                duration: transcription.duration,
                provider: 'LocalWhisper',
                model: this.config.modelSize
            };

        } catch (error) {
            console.error('❌ Local Whisper transcription error:', error.message);
            throw new Error(`Transcription failed: ${error.message}`);
        } finally {
            if (tempAudioPath) {
                try {
                    await fs.unlink(tempAudioPath);
                } catch (err) {
                    // Ignore cleanup errors
                }
            }
            if (processedAudioPath) {
                try {
                    await fs.unlink(processedAudioPath);
                } catch (err) {
                    // Ignore cleanup errors
                }
            }
        }
    }

    async preprocessAudio(audioPath) {
        return new Promise((resolve) => {
            const outputPath = path.join(os.tmpdir(), `processed_${Date.now()}.wav`);
            
            const inputPathPython = audioPath.replace(/\\/g, '/');
            const outputPathPython = outputPath.replace(/\\/g, '/');
            
            let pythonScript = 'import noisereduce as nr\n';
            pythonScript += 'import soundfile as sf\n';
            pythonScript += 'import numpy as np\n';
            pythonScript += 'import sys\n';
            pythonScript += 'import json\n\n';
            pythonScript += 'try:\n';
            pythonScript += `    audio_data, sample_rate = sf.read("${inputPathPython}")\n`;
            pythonScript += '    if len(audio_data.shape) > 1:\n';
            pythonScript += '        audio_data = np.mean(audio_data, axis=1)\n';
            
            if (this.config.noiseReduction) {
                pythonScript += '    reduced_noise = nr.reduce_noise(y=audio_data, sr=sample_rate, stationary=True, prop_decrease=0.8)\n';
            } else {
                pythonScript += '    reduced_noise = audio_data\n';
            }
            
            if (this.config.normalize) {
                pythonScript += '    max_val = np.abs(reduced_noise).max()\n';
                pythonScript += '    if max_val > 0:\n';
                pythonScript += '        normalized = reduced_noise / max_val * 0.95\n';
                pythonScript += '    else:\n';
                pythonScript += '        normalized = reduced_noise\n';
            } else {
                pythonScript += '    normalized = reduced_noise\n';
            }
            
            pythonScript += `    sf.write("${outputPathPython}", normalized, sample_rate)\n`;
            pythonScript += `    print("${outputPathPython}")\n`;
            pythonScript += 'except Exception as e:\n';
            pythonScript += '    print(json.dumps({"error": str(e)}), file=sys.stderr)\n';
            pythonScript += '    sys.exit(1)\n';

            const proc = spawn(this.config.pythonPath, ['-c', pythonScript]);
            
            let stdout = '';
            let stderr = '';
            
            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            proc.on('close', (code) => {
                if (code !== 0) {
                    console.warn('⚠️ Audio preprocessing failed, using original audio:', stderr);
                    resolve(null);
                    return;
                }
                
                const processedPath = stdout.trim();
                console.log('🎵 Audio preprocessed: noise reduced & normalized');
                resolve(processedPath);
            });
            
            proc.on('error', (error) => {
                console.warn('⚠️ Audio preprocessing error, using original audio:', error.message);
                resolve(null);
            });
            
            setTimeout(() => {
                proc.kill();
                console.warn('⚠️ Audio preprocessing timeout, using original audio');
                resolve(null);
            }, 30000);
        });
    }

    async runWhisperTranscription(audioPath, options = {}) {
        return new Promise((resolve, reject) => {
            const audioPathPython = audioPath.replace(/\\/g, '/');
            const lang = options.language || this.config.language;
            
            let pythonScript = 'import whisper\n';
            pythonScript += 'import json\n';
            pythonScript += 'import sys\n\n';
            pythonScript += 'try:\n';
            pythonScript += `    model = whisper.load_model("${this.config.modelSize}")\n`;
            pythonScript += `    result = model.transcribe("${audioPathPython}", language="${lang}")\n`;
            pythonScript += '    output = {\n';
            pythonScript += '        "text": result["text"].strip(),\n';
            pythonScript += `        "language": result.get("language", "${this.config.language}"),\n`;
            pythonScript += '        "duration": result.get("duration", 0)\n';
            pythonScript += '    }\n';
            pythonScript += '    print(json.dumps(output))\n';
            pythonScript += 'except Exception as e:\n';
            pythonScript += '    print(json.dumps({"error": str(e)}), file=sys.stderr)\n';
            pythonScript += '    sys.exit(1)\n';

            const proc = spawn(this.config.pythonPath, ['-c', pythonScript]);
            
            let stdout = '';
            let stderr = '';
            
            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            proc.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(stderr || 'Whisper transcription failed'));
                    return;
                }
                
                try {
                    const result = JSON.parse(stdout.trim());
                    if (result.error) {
                        reject(new Error(result.error));
                    } else {
                        resolve(result);
                    }
                } catch (error) {
                    reject(new Error(`Failed to parse Whisper output: ${error.message}`));
                }
            });
            
            proc.on('error', (error) => {
                reject(new Error(`Failed to run Python: ${error.message}`));
            });
            
            setTimeout(() => {
                proc.kill();
                reject(new Error('Whisper transcription timeout'));
            }, 120000);
        });
    }

    supportsAudio() {
        return this.whisperAvailable;
    }

    async analyzeImage(imageBuffer, options = {}) {
        throw new Error('Local Whisper does not support image analysis. Use a vision model.');
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
        return ['audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/m4a', 'audio/webm'];
    }

    getSupportedImageFormats() {
        return [];
    }

    getSupportedDocumentFormats() {
        return this.documentExtractor.getSupportedFormats();
    }

    getHealthStatus() {
        return {
            processor: 'LocalWhisper',
            status: this.whisperAvailable ? 'healthy' : 'unavailable',
            supportsAudio: this.supportsAudio(),
            supportsImage: this.supportsImage(),
            supportsDocument: this.supportsDocument(),
            modelSize: this.config.modelSize,
            whisperInstalled: this.whisperAvailable,
            audioPreprocessing: this.preprocessingAvailable,
            features: {
                noiseReduction: this.config.noiseReduction && this.preprocessingAvailable,
                normalization: this.config.normalize && this.preprocessingAvailable
            }
        };
    }
}

module.exports = LocalWhisperAdapter;
