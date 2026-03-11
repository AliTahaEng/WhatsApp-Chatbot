/**
 * File Manager Plugin
 * Provides file system operations for agents
 * Handles reading, writing, and managing files safely
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');

class FileManagerPlugin {
    constructor() {
        this.name = 'file-manager';
        this.version = '1.0.0';
        this.description = 'Manage files and directories safely';
        this.author = 'WhatsApp AutoGen Bot';
        this.type = 'tool';

        this.defaultConfig = {
            baseDirectory: './data/files',
            allowedExtensions: ['.txt', '.json', '.csv', '.md', '.log'],
            maxFileSize: 10 * 1024 * 1024, // 10MB
            allowDelete: true,
            allowWrite: true
        };

        this.tools = {
            'read_file': {
                description: 'Read contents of a file',
                category: 'file-management',
                parameters: {
                    filename: {
                        type: 'string',
                        description: 'Name of the file to read',
                        required: true
                    },
                    encoding: {
                        type: 'string',
                        description: 'File encoding (default: utf8)',
                        required: false,
                        default: 'utf8'
                    }
                },
                examples: [
                    { filename: 'notes.txt' },
                    { filename: 'data.json', encoding: 'utf8' }
                ],
                execute: this.readFile.bind(this)
            },
            'write_file': {
                description: 'Write content to a file',
                category: 'file-management',
                parameters: {
                    filename: {
                        type: 'string',
                        description: 'Name of the file to write',
                        required: true
                    },
                    content: {
                        type: 'string',
                        description: 'Content to write',
                        required: true
                    },
                    append: {
                        type: 'boolean',
                        description: 'Append to file instead of overwriting',
                        required: false,
                        default: false
                    }
                },
                examples: [
                    { filename: 'notes.txt', content: 'Hello World' },
                    { filename: 'log.txt', content: 'Log entry', append: true }
                ],
                execute: this.writeFile.bind(this)
            },
            'list_files': {
                description: 'List files in a directory',
                category: 'file-management',
                parameters: {
                    directory: {
                        type: 'string',
                        description: 'Directory to list (relative to base)',
                        required: false,
                        default: '.'
                    }
                },
                examples: [
                    { directory: '.' },
                    { directory: 'uploads' }
                ],
                execute: this.listFiles.bind(this)
            },
            'delete_file': {
                description: 'Delete a file',
                category: 'file-management',
                parameters: {
                    filename: {
                        type: 'string',
                        description: 'Name of the file to delete',
                        required: true
                    }
                },
                examples: [
                    { filename: 'temp.txt' }
                ],
                execute: this.deleteFile.bind(this)
            },
            'file_info': {
                description: 'Get information about a file',
                category: 'file-management',
                parameters: {
                    filename: {
                        type: 'string',
                        description: 'Name of the file',
                        required: true
                    }
                },
                examples: [
                    { filename: 'data.json' }
                ],
                execute: this.getFileInfo.bind(this)
            }
        };
    }

    async initialize(config) {
        this.config = { ...this.defaultConfig, ...config };

        // Ensure base directory exists
        if (!fs.existsSync(this.config.baseDirectory)) {
            fs.mkdirSync(this.config.baseDirectory, { recursive: true });
            logger.info(`📁 Created file manager base directory: ${this.config.baseDirectory}`);
        }

        logger.info('📁 File Manager Plugin initialized');
    }

    // Validate and sanitize file path
    validatePath(filename) {
        // Remove path traversal attempts
        const sanitized = path.normalize(filename).replace(/^(\.\.[\/\\])+/, '');
        const fullPath = path.join(this.config.baseDirectory, sanitized);

        // Ensure path is within base directory
        if (!fullPath.startsWith(path.resolve(this.config.baseDirectory))) {
            throw new Error('Access denied: Path outside allowed directory');
        }

        // Check file extension
        const ext = path.extname(sanitized).toLowerCase();
        if (ext && !this.config.allowedExtensions.includes(ext)) {
            throw new Error(`File type not allowed: ${ext}`);
        }

        return fullPath;
    }

    async readFile(parameters) {
        const { filename, encoding = 'utf8' } = parameters;

        if (!filename) {
            throw new Error('Filename is required');
        }

        const fullPath = this.validatePath(filename);

        if (!fs.existsSync(fullPath)) {
            throw new Error(`File not found: ${filename}`);
        }

        const stats = fs.statSync(fullPath);
        if (stats.size > this.config.maxFileSize) {
            throw new Error(`File too large: ${(stats.size / 1024 / 1024).toFixed(2)}MB (max: ${this.config.maxFileSize / 1024 / 1024}MB)`);
        }

        try {
            const content = fs.readFileSync(fullPath, encoding);
            logger.debug(`📄 Read file: ${filename} (${stats.size} bytes)`);

            return {
                filename,
                content,
                size: stats.size,
                encoding,
                success: true
            };

        } catch (error) {
            throw new Error(`Failed to read file: ${error.message}`);
        }
    }

    async writeFile(parameters) {
        const { filename, content, append = false } = parameters;

        if (!this.config.allowWrite) {
            throw new Error('Write operations are disabled');
        }

        if (!filename || !content) {
            throw new Error('Filename and content are required');
        }

        const fullPath = this.validatePath(filename);

        // Check content size
        const contentSize = Buffer.byteLength(content, 'utf8');
        if (contentSize > this.config.maxFileSize) {
            throw new Error(`Content too large: ${(contentSize / 1024 / 1024).toFixed(2)}MB`);
        }

        try {
            // Ensure directory exists
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            if (append) {
                fs.appendFileSync(fullPath, content, 'utf8');
            } else {
                fs.writeFileSync(fullPath, content, 'utf8');
            }

            const stats = fs.statSync(fullPath);
            logger.debug(`💾 ${append ? 'Appended to' : 'Wrote'} file: ${filename} (${stats.size} bytes)`);

            return {
                filename,
                size: stats.size,
                mode: append ? 'append' : 'write',
                success: true
            };

        } catch (error) {
            throw new Error(`Failed to write file: ${error.message}`);
        }
    }

    async listFiles(parameters) {
        const { directory = '.' } = parameters;

        const fullPath = this.validatePath(directory);

        if (!fs.existsSync(fullPath)) {
            throw new Error(`Directory not found: ${directory}`);
        }

        const stats = fs.statSync(fullPath);
        if (!stats.isDirectory()) {
            throw new Error(`Not a directory: ${directory}`);
        }

        try {
            const files = fs.readdirSync(fullPath);
            const fileList = [];

            for (const file of files) {
                try {
                    const filePath = path.join(fullPath, file);
                    const fileStats = fs.statSync(filePath);

                    fileList.push({
                        name: file,
                        type: fileStats.isDirectory() ? 'directory' : 'file',
                        size: fileStats.size,
                        modified: fileStats.mtime,
                        extension: path.extname(file)
                    });
                } catch (error) {
                    logger.debug(`Error reading file info for ${file}:`, error.message);
                }
            }

            logger.debug(`📂 Listed directory: ${directory} (${fileList.length} items)`);

            return {
                directory,
                files: fileList,
                count: fileList.length,
                success: true
            };

        } catch (error) {
            throw new Error(`Failed to list files: ${error.message}`);
        }
    }

    async deleteFile(parameters) {
        const { filename } = parameters;

        if (!this.config.allowDelete) {
            throw new Error('Delete operations are disabled');
        }

        if (!filename) {
            throw new Error('Filename is required');
        }

        const fullPath = this.validatePath(filename);

        if (!fs.existsSync(fullPath)) {
            throw new Error(`File not found: ${filename}`);
        }

        try {
            const stats = fs.statSync(fullPath);
            fs.unlinkSync(fullPath);

            logger.info(`🗑️ Deleted file: ${filename} (${stats.size} bytes)`);

            return {
                filename,
                size: stats.size,
                deleted: true,
                success: true
            };

        } catch (error) {
            throw new Error(`Failed to delete file: ${error.message}`);
        }
    }

    async getFileInfo(parameters) {
        const { filename } = parameters;

        if (!filename) {
            throw new Error('Filename is required');
        }

        const fullPath = this.validatePath(filename);

        if (!fs.existsSync(fullPath)) {
            throw new Error(`File not found: ${filename}`);
        }

        try {
            const stats = fs.statSync(fullPath);

            return {
                filename,
                type: stats.isDirectory() ? 'directory' : 'file',
                size: stats.size,
                sizeFormatted: this.formatFileSize(stats.size),
                created: stats.birthtime,
                modified: stats.mtime,
                accessed: stats.atime,
                extension: path.extname(filename),
                permissions: stats.mode,
                success: true
            };

        } catch (error) {
            throw new Error(`Failed to get file info: ${error.message}`);
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    async cleanup() {
        logger.info('📁 File Manager Plugin cleaned up');
    }
}

module.exports = FileManagerPlugin;