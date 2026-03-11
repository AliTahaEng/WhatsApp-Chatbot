/**
 * Media Handler Service
 * Orchestrates media processing for incoming WhatsApp messages
 * 
 * Flow:
 * 1. Receives a WhatsApp message with media (audio/image/document)
 * 2. Downloads the media via whatsapp-web.js
 * 3. Routes to the correct IMediaProcessor method
 * 4. Returns extracted text/description for the LLM pipeline
 * 
 * Follows DI pattern — resolved from the service container
 */

const logger = require('../utils/logger');

class MediaHandlerService {
    constructor(container) {
        this.container = container;
        this.config = container.resolve('ConfigurationManager');
        this.mediaProcessor = null;

        // Media type mapping: whatsapp-web.js message.type → handler method
        this.mediaTypeMap = {
            'ptt': 'audio',       // push-to-talk voice note
            'audio': 'audio',     // audio file
            'image': 'image',     // photo
            'sticker': 'image',   // sticker (treated as image)
            'document': 'document' // PDF, DOCX, etc.
        };

        this._isStarted = false;
    }

    async start() {
        if (this._isStarted) return;

        try {
            this.mediaProcessor = this.container.resolve('IMediaProcessor');
            await this.mediaProcessor.initialize();
            this._isStarted = true;
            logger.info('✅ MediaHandlerService started');
        } catch (error) {
            logger.warn('⚠️ MediaHandlerService failed to start (media processing disabled):', error.message);
        }
    }

    async stop() {
        this._isStarted = false;
        logger.info('✅ MediaHandlerService stopped');
    }

    /**
     * Check if a message type is a media type we can process
     */
    isMediaMessage(messageType) {
        return messageType in this.mediaTypeMap;
    }

    /**
     * Check if the service is ready to process media
     */
    isReady() {
        return this._isStarted && this.mediaProcessor !== null;
    }

    /**
     * Process a media message and return extracted text for the LLM
     * 
     * @param {object} message - whatsapp-web.js Message object
     * @returns {object} { text, mediaType, provider, caption }
     */
    async processMediaMessage(message) {
        const messageType = message.type;
        const category = this.mediaTypeMap[messageType];

        if (!category) {
            return {
                text: '[Unsupported media type]',
                mediaType: messageType,
                provider: 'none'
            };
        }

        if (!this.isReady()) {
            return {
                text: '[Media processing is not available. The admin has not configured media support yet.]',
                mediaType: messageType,
                provider: 'none'
            };
        }

        // Download media from WhatsApp
        let media;
        try {
            media = await message.downloadMedia();
        } catch (error) {
            logger.error(`❌ Failed to download ${category} media:`, error.message);
            return {
                text: `[Failed to download ${category}. Please try sending again.]`,
                mediaType: messageType,
                provider: 'none'
            };
        }

        if (!media || !media.data) {
            return {
                text: `[Could not retrieve ${category} content.]`,
                mediaType: messageType,
                provider: 'none'
            };
        }

        const buffer = Buffer.from(media.data, 'base64');
        const caption = message.body || '';

        logger.info(`📎 Processing ${category} (${media.mimetype}, ${buffer.length} bytes)`);

        switch (category) {
            case 'audio':
                return await this._handleAudio(buffer, media.mimetype, caption);
            case 'image':
                return await this._handleImage(buffer, media.mimetype, caption);
            case 'document':
                return await this._handleDocument(buffer, media.mimetype, media.filename, caption);
            default:
                return { text: '[Unknown media category]', mediaType: messageType, provider: 'none' };
        }
    }

    async _handleAudio(buffer, mimeType, caption) {
        if (!this.mediaProcessor.supportsAudio()) {
            return {
                text: '[Voice message received but audio transcription is not configured.]',
                mediaType: 'audio',
                provider: 'none'
            };
        }

        try {
            // Determine audio format from mime type
            const format = this._audioFormatFromMime(mimeType);

            const result = await this.mediaProcessor.transcribeAudio(buffer, { format });

            // Build context string for the LLM
            const prefix = '[Voice message transcription]';
            const text = caption
                ? `${prefix}\nTranscription: ${result.text}\nCaption: ${caption}`
                : `${prefix}\nTranscription: ${result.text}`;

            return {
                text,
                mediaType: 'audio',
                transcription: result.text,
                provider: result.provider
            };
        } catch (error) {
            logger.error('❌ Audio transcription failed:', error.message);
            return {
                text: '[Voice message received but transcription failed. Please try again or send as text.]',
                mediaType: 'audio',
                provider: 'error'
            };
        }
    }

    async _handleImage(buffer, mimeType, caption) {
        if (!this.mediaProcessor.supportsImage()) {
            return {
                text: '[Image received but image analysis is not configured.]',
                mediaType: 'image',
                provider: 'none'
            };
        }

        try {
            const prompt = caption
                ? `The user sent this image with the caption: "${caption}". Describe the image and respond to their caption.`
                : 'Describe this image in detail. If there is text in the image, extract it.';

            const result = await this.mediaProcessor.analyzeImage(buffer, {
                mimeType,
                prompt
            });

            const prefix = '[Image message analysis]';
            const text = caption
                ? `${prefix}\nImage description: ${result.text}\nUser caption: ${caption}`
                : `${prefix}\nImage description: ${result.text}`;

            return {
                text,
                mediaType: 'image',
                description: result.text,
                provider: result.provider
            };
        } catch (error) {
            logger.error('❌ Image analysis failed:', error.message);
            return {
                text: '[Image received but analysis failed. Please try again.]',
                mediaType: 'image',
                provider: 'error'
            };
        }
    }

    async _handleDocument(buffer, mimeType, filename, caption) {
        if (!this.mediaProcessor.supportsDocument()) {
            return {
                text: '[Document received but document processing is not configured.]',
                mediaType: 'document',
                provider: 'none'
            };
        }

        try {
            const result = await this.mediaProcessor.extractDocumentText(buffer, mimeType, {
                maxChars: 10000 // Limit to avoid token overflow
            });

            if (result.error && !result.text) {
                return {
                    text: `[Document "${filename || 'unknown'}" received but could not be processed: ${result.error}]`,
                    mediaType: 'document',
                    provider: 'error'
                };
            }

            const prefix = `[Document received: ${filename || 'unknown'}]`;
            const truncNote = result.truncated ? '\n(Document was truncated due to length)' : '';
            const text = caption
                ? `${prefix}${truncNote}\nDocument content:\n${result.text}\n\nUser message: ${caption}`
                : `${prefix}${truncNote}\nDocument content:\n${result.text}`;

            return {
                text,
                mediaType: 'document',
                filename,
                extractedText: result.text,
                provider: result.provider
            };
        } catch (error) {
            logger.error('❌ Document extraction failed:', error.message);
            return {
                text: `[Document "${filename || 'unknown'}" received but extraction failed.]`,
                mediaType: 'document',
                provider: 'error'
            };
        }
    }

    _audioFormatFromMime(mimeType) {
        const map = {
            'audio/ogg': 'ogg',
            'audio/ogg; codecs=opus': 'ogg',
            'audio/mpeg': 'mp3',
            'audio/mp4': 'm4a',
            'audio/wav': 'wav',
            'audio/webm': 'webm',
            'audio/x-m4a': 'm4a'
        };
        return map[mimeType] || 'ogg';
    }
}

module.exports = MediaHandlerService;
