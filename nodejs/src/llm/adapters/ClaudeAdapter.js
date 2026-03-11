/**
 * Claude (Anthropic) Adapter
 * Implements ILLMProvider interface for Anthropic Claude models
 * Supports Claude-3 family, function calling, and vision
 */

const Anthropic = require('@anthropic-ai/sdk');
const ILLMProvider = require('../../core/interfaces/ILLMProvider');
const logger = require('../../utils/logger');

class ClaudeAdapter extends ILLMProvider {
    constructor(config = {}) {
        super();
        this.config = {
            apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
            model: config.model || process.env.CLAUDE_MODEL || 'claude-3-sonnet-20240229',
            maxTokens: config.maxTokens || parseInt(process.env.CLAUDE_MAX_TOKENS) || 4096,
            temperature: config.temperature || parseFloat(process.env.CLAUDE_TEMPERATURE) || 0.7,
            topP: config.topP || parseFloat(process.env.CLAUDE_TOP_P) || 0.95,
            topK: config.topK || parseInt(process.env.CLAUDE_TOP_K) || 40,
            ...config
        };

        this.client = null;
        this.isReady = false;
        this.healthStats = {
            provider: 'Claude (Anthropic)',
            model: this.config.model,
            status: 'initializing',
            lastCheck: null,
            uptime: 0,
            errorCount: 0,
            totalRequests: 0,
            startTime: Date.now()
        };

        // Token pricing (approximate rates per 1M tokens)
        this.pricing = {
            'claude-3-opus-20240229': { input: 15, output: 75 },
            'claude-3-sonnet-20240229': { input: 3, output: 15 },
            'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
            'claude-2.1': { input: 8, output: 24 },
            'claude-2.0': { input: 8, output: 24 }
        };
    }

    async initialize() {
        try {
            if (!this.config.apiKey) {
                throw new Error('Missing Anthropic API key');
            }

            this.client = new Anthropic({
                apiKey: this.config.apiKey
            });

            await this.testConnection();
            this.isReady = true;
            this.healthStats.status = 'ready';
            
            logger.info(`✅ Claude initialized: ${this.config.model}`);
        } catch (error) {
            this.healthStats.status = 'error';
            this.healthStats.errorCount++;
            logger.error('❌ Failed to initialize Claude:', error);
            throw error;
        }
    }

    async testConnection() {
        try {
            const response = await this.client.messages.create({
                model: this.config.model,
                max_tokens: 10,
                messages: [{ role: 'user', content: 'Test' }]
            });

            if (response.content && response.content.length > 0) {
                this.healthStats.lastCheck = new Date();
                return 'Connection successful';
            } else {
                throw new Error('Invalid response from Claude');
            }
        } catch (error) {
            this.healthStats.errorCount++;
            throw error;
        }
    }

    async isReady() {
        return this.isReady && this.client !== null;
    }

    getModelName() {
        return this.config.model;
    }

    getProviderName() {
        return 'Claude (Anthropic)';
    }

    getMaxTokens() {
        return this.config.maxTokens;
    }

    getContextWindow() {
        const model = this.config.model.toLowerCase();
        if (model.includes('claude-3')) return 200000; // Claude-3 supports 200k context
        if (model.includes('claude-2')) return 100000; // Claude-2 supports 100k context
        return 100000; // Default
    }

    async estimateTokens(text) {
        // Anthropic's estimation: roughly 1 token per 4 characters
        return Math.ceil(text.length / 4);
    }

    async calculateCost(inputTokens, outputTokens) {
        const rates = this.pricing[this.config.model] || this.pricing['claude-3-sonnet-20240229'];
        
        const inputCost = (inputTokens / 1000000) * rates.input;
        const outputCost = (outputTokens / 1000000) * rates.output;
        
        return {
            inputCost,
            outputCost,
            totalCost: inputCost + outputCost,
            currency: 'USD'
        };
    }

    async generateResponse(messages, options = {}) {
        try {
            this.healthStats.totalRequests++;
            
            const claudeMessages = this.formatMessagesForClaude(messages);
            const systemMessage = this.extractSystemMessage(messages);

            const requestOptions = {
                model: this.config.model,
                max_tokens: options.maxTokens || this.config.maxTokens,
                temperature: options.temperature ?? this.config.temperature,
                top_p: options.topP ?? this.config.topP,
                top_k: options.topK ?? this.config.topK,
                messages: claudeMessages,
                stop_sequences: options.stop || undefined,
                ...options.extra
            };

            if (systemMessage) {
                requestOptions.system = systemMessage;
            }

            const response = await this.client.messages.create(requestOptions);
            
            const result = {
                content: response.content[0]?.text || '',
                finishReason: response.stop_reason || 'unknown',
                usage: {
                    promptTokens: response.usage?.input_tokens || 0,
                    completionTokens: response.usage?.output_tokens || 0,
                    totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
                },
                model: response.model || this.config.model,
                provider: 'Claude (Anthropic)',
                timestamp: new Date().toISOString()
            };

            // Calculate costs
            if (result.usage.totalTokens > 0) {
                result.cost = await this.calculateCost(
                    result.usage.promptTokens, 
                    result.usage.completionTokens
                );
            }

            this.healthStats.uptime = Date.now() - this.healthStats.startTime;
            return result;

        } catch (error) {
            this.healthStats.errorCount++;
            return this.handleAPIError(error);
        }
    }

    async generateStreamResponse(messages, options = {}, onChunk) {
        try {
            this.healthStats.totalRequests++;
            
            const claudeMessages = this.formatMessagesForClaude(messages);
            const systemMessage = this.extractSystemMessage(messages);

            const requestOptions = {
                model: this.config.model,
                max_tokens: options.maxTokens || this.config.maxTokens,
                temperature: options.temperature ?? this.config.temperature,
                top_p: options.topP ?? this.config.topP,
                messages: claudeMessages,
                stream: true,
                ...options.extra
            };

            if (systemMessage) {
                requestOptions.system = systemMessage;
            }

            const stream = await this.client.messages.create(requestOptions);
            
            let fullContent = '';
            let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

            for await (const chunk of stream) {
                if (chunk.type === 'content_block_delta') {
                    const delta = chunk.delta.text || '';
                    if (delta) {
                        fullContent += delta;
                        if (onChunk) {
                            await onChunk({
                                content: delta,
                                fullContent,
                                isComplete: false
                            });
                        }
                    }
                } else if (chunk.type === 'message_start') {
                    usage = {
                        promptTokens: chunk.message.usage?.input_tokens || 0,
                        completionTokens: 0,
                        totalTokens: chunk.message.usage?.input_tokens || 0
                    };
                } else if (chunk.type === 'message_delta') {
                    usage.completionTokens = chunk.usage?.output_tokens || 0;
                    usage.totalTokens = usage.promptTokens + usage.completionTokens;
                }
            }

            const result = {
                content: fullContent,
                finishReason: 'stop',
                usage,
                model: this.config.model,
                provider: 'Claude (Anthropic)',
                timestamp: new Date().toISOString()
            };

            if (onChunk) {
                await onChunk({
                    content: '',
                    fullContent,
                    isComplete: true,
                    usage: result.usage
                });
            }

            return result;

        } catch (error) {
            this.healthStats.errorCount++;
            throw this.handleAPIError(error);
        }
    }

    async generateEmbedding(text) {
        // Claude doesn't support embeddings directly
        logger.warn('Claude does not support embeddings');
        return null;
    }

    async classifyIntent(message, classes) {
        const prompt = `Classify the following message into one of these categories: ${classes.join(', ')}.

Message: "${message}"

Respond with only the category name that best fits.`;

        const response = await this.generateResponse([
            { role: 'user', content: prompt }
        ], { maxTokens: 50, temperature: 0 });

        const classification = response.content.trim();
        return {
            intent: classification,
            confidence: classes.includes(classification) ? 0.9 : 0.1
        };
    }

    async summarizeConversation(messages, maxLength = 200) {
        const conversation = messages.map(m => `${m.role}: ${m.content}`).join('\n');
        const prompt = `Please summarize this conversation in ${maxLength} characters or less:

${conversation}

Summary:`;

        const response = await this.generateResponse([
            { role: 'user', content: prompt }
        ], { maxTokens: 100, temperature: 0.3 });

        return response.content.trim();
    }

    async generateWithTools(messages, tools = [], options = {}) {
        try {
            // Claude uses a different format for function calling
            const claudeMessages = this.formatMessagesForClaude(messages);
            const claudeTools = tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters
            }));

            const requestOptions = {
                model: this.config.model,
                max_tokens: options.maxTokens || this.config.maxTokens,
                temperature: options.temperature ?? this.config.temperature,
                messages: claudeMessages,
                tools: claudeTools,
                ...options.extra
            };

            const response = await this.client.messages.create(requestOptions);
            
            const result = {
                content: response.content[0]?.text || '',
                toolCalls: response.content.filter(c => c.type === 'tool_use').map(c => ({
                    id: c.id,
                    type: 'function',
                    function: {
                        name: c.name,
                        arguments: JSON.stringify(c.input)
                    }
                })),
                finishReason: response.stop_reason || 'unknown',
                usage: {
                    promptTokens: response.usage?.input_tokens || 0,
                    completionTokens: response.usage?.output_tokens || 0,
                    totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
                },
                model: response.model || this.config.model,
                provider: 'Claude (Anthropic)'
            };

            return result;

        } catch (error) {
            this.healthStats.errorCount++;
            return this.handleAPIError(error);
        }
    }

    supportsTools() {
        return this.config.model.includes('claude-3'); // Only Claude-3 supports tools
    }

    async analyzeImage(imageData, prompt = "Describe this image") {
        try {
            // Check if model supports vision
            if (!this.config.model.includes('claude-3')) {
                throw new Error('Vision not supported by this Claude model');
            }

            const messages = [{
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    { 
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: 'image/jpeg',
                            data: imageData
                        }
                    }
                ]
            }];

            const response = await this.generateResponse(messages);
            return response;

        } catch (error) {
            logger.warn('Claude vision not available:', error.message);
            throw error;
        }
    }

    supportsVision() {
        return this.config.model.includes('claude-3');
    }

    async speechToText(audioData) {
        // Claude doesn't support speech-to-text
        throw new Error('Claude does not support speech-to-text');
    }

    async textToSpeech(text, voice = 'alloy') {
        // Claude doesn't support text-to-speech
        throw new Error('Claude does not support text-to-speech');
    }

    supportsSpeech() {
        return false;
    }

    getAutoGenConfig() {
        return {
            config_list: [{
                model: this.config.model,
                api_type: 'anthropic',
                api_key: this.config.apiKey,
                base_url: 'https://api.anthropic.com'
            }],
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens,
            top_p: this.config.topP
        };
    }

    async handleAPIError(error, retryCount = 0) {
        const maxRetries = 3;
        const baseDelay = 1000;

        // Rate limiting
        if (error.status === 429 && retryCount < maxRetries) {
            const delay = baseDelay * Math.pow(2, retryCount);
            logger.warn(`Claude rate limited, retrying in ${delay}ms...`);
            
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.handleAPIError(error, retryCount + 1);
        }

        // Service issues
        if ((error.status === 500 || error.status === 503) && retryCount < maxRetries) {
            const delay = baseDelay * (retryCount + 1);
            logger.warn(`Claude service issue, retrying in ${delay}ms...`);
            
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.handleAPIError(error, retryCount + 1);
        }

        logger.error('Claude API Error:', {
            status: error.status,
            message: error.message,
            type: error.type,
            retryCount
        });

        throw new Error(`Claude Error: ${error.message}`);
    }

    async switchModel(modelName) {
        this.config.model = modelName;
        this.healthStats.model = modelName;
        logger.info(`✅ Switched to Claude model: ${modelName}`);
    }

    getAvailableModels() {
        return [
            'claude-3-opus-20240229',
            'claude-3-sonnet-20240229',
            'claude-3-haiku-20240307',
            'claude-2.1',
            'claude-2.0'
        ];
    }

    getHealthStatus() {
        this.healthStats.uptime = Date.now() - this.healthStats.startTime;
        return { ...this.healthStats };
    }

    async performHealthCheck() {
        try {
            await this.testConnection();
            this.healthStats.status = 'healthy';
            this.healthStats.lastCheck = new Date();
        } catch (error) {
            this.healthStats.status = 'unhealthy';
            this.healthStats.errorCount++;
            throw error;
        }
    }

    formatMessagesForClaude(messages) {
        // Claude expects alternating user/assistant messages
        const claudeMessages = [];
        
        for (const msg of messages) {
            if (msg.role === 'system') continue; // System messages handled separately
            
            claudeMessages.push({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: msg.content
            });
        }

        return claudeMessages;
    }

    extractSystemMessage(messages) {
        const systemMsg = messages.find(m => m.role === 'system');
        return systemMsg?.content || null;
    }
}

module.exports = ClaudeAdapter;
