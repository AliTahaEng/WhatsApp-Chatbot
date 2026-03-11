/**
 * Document Extractor Utility
 * Extracts text content from various document formats
 * Supports: PDF, DOCX, TXT, CSV, JSON, HTML
 * 
 * Uses optional dependencies (pdf-parse, mammoth) — gracefully degrades if not installed
 */

const logger = require('../../utils/logger');

class DocumentExtractor {
    constructor() {
        this.pdfParser = null;
        this.mammoth = null;
        this._initialized = false;
    }

    async initialize() {
        // Try to load optional dependencies
        try {
            this.pdfParser = require('pdf-parse');
        } catch (e) {
            logger.warn('⚠️ pdf-parse not installed — PDF extraction disabled. Run: npm install pdf-parse');
        }

        try {
            this.mammoth = require('mammoth');
        } catch (e) {
            logger.warn('⚠️ mammoth not installed — DOCX extraction disabled. Run: npm install mammoth');
        }

        this._initialized = true;
        logger.info(`📄 DocumentExtractor initialized (PDF: ${!!this.pdfParser}, DOCX: ${!!this.mammoth})`);
    }

    isAvailable() {
        return this._initialized;
    }

    getSupportedFormats() {
        const formats = ['txt', 'csv', 'json', 'html'];
        if (this.pdfParser) formats.push('pdf');
        if (this.mammoth) formats.push('docx');
        return formats;
    }

    async extract(buffer, mimeType, options = {}) {
        const type = this._normalizeMimeType(mimeType);

        switch (type) {
            case 'pdf':
                return await this._extractPDF(buffer, options);
            case 'docx':
                return await this._extractDOCX(buffer, options);
            case 'txt':
            case 'csv':
            case 'json':
            case 'html':
                return this._extractText(buffer, type, options);
            default:
                return {
                    text: '',
                    error: `Unsupported document type: ${mimeType}`,
                    provider: 'DocumentExtractor'
                };
        }
    }

    async _extractPDF(buffer, options = {}) {
        if (!this.pdfParser) {
            return {
                text: '[PDF received but pdf-parse is not installed. Install with: npm install pdf-parse]',
                provider: 'DocumentExtractor',
                error: 'pdf-parse not installed'
            };
        }

        try {
            const data = await this.pdfParser(buffer, {
                max: options.maxPages || 0 // 0 = all pages
            });

            const text = data.text || '';
            const truncated = options.maxChars ? text.substring(0, options.maxChars) : text;

            logger.info(`📄 PDF extracted: ${data.numpages} pages, ${text.length} chars`);

            return {
                text: truncated.trim(),
                pages: data.numpages,
                totalChars: text.length,
                truncated: truncated.length < text.length,
                provider: 'DocumentExtractor (pdf-parse)'
            };
        } catch (error) {
            logger.error('❌ PDF extraction error:', error.message);
            return {
                text: '[Failed to extract text from PDF]',
                error: error.message,
                provider: 'DocumentExtractor'
            };
        }
    }

    async _extractDOCX(buffer, options = {}) {
        if (!this.mammoth) {
            return {
                text: '[DOCX received but mammoth is not installed. Install with: npm install mammoth]',
                provider: 'DocumentExtractor',
                error: 'mammoth not installed'
            };
        }

        try {
            const result = await this.mammoth.extractRawText({ buffer });
            const text = result.value || '';
            const truncated = options.maxChars ? text.substring(0, options.maxChars) : text;

            logger.info(`📄 DOCX extracted: ${text.length} chars`);

            return {
                text: truncated.trim(),
                totalChars: text.length,
                truncated: truncated.length < text.length,
                warnings: result.messages || [],
                provider: 'DocumentExtractor (mammoth)'
            };
        } catch (error) {
            logger.error('❌ DOCX extraction error:', error.message);
            return {
                text: '[Failed to extract text from DOCX]',
                error: error.message,
                provider: 'DocumentExtractor'
            };
        }
    }

    _extractText(buffer, type, options = {}) {
        try {
            const text = buffer.toString('utf-8');
            const truncated = options.maxChars ? text.substring(0, options.maxChars) : text;

            logger.info(`📄 ${type.toUpperCase()} extracted: ${text.length} chars`);

            return {
                text: truncated.trim(),
                totalChars: text.length,
                truncated: truncated.length < text.length,
                provider: `DocumentExtractor (${type})`
            };
        } catch (error) {
            return {
                text: `[Failed to read ${type} file]`,
                error: error.message,
                provider: 'DocumentExtractor'
            };
        }
    }

    _normalizeMimeType(mimeType) {
        if (!mimeType) return 'txt';

        const map = {
            'application/pdf': 'pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
            'application/msword': 'docx',
            'text/plain': 'txt',
            'text/csv': 'csv',
            'application/json': 'json',
            'text/html': 'html',
            'text/xml': 'html',
            'application/xml': 'html'
        };

        return map[mimeType] || mimeType.split('/').pop() || 'txt';
    }
}

module.exports = DocumentExtractor;
