/**
 * Azure OpenAI Adapter
 * Implements ILLMProvider interface for Azure OpenAI GPT models
 * Supports GPT-4, GPT-4-turbo, vision, function calling, and embeddings
 */

const { OpenAI } = require('openai');
const ILLMProvider = require('../../core/interfaces/ILLMProvider');
const logger = require('../../utils/logger');

class AzureOpenAIAdapter extends ILLMProvider {
    constructor(config = {}) {
        super();
        this.config = {
            endpoint: config.endpoint || process.env.AZURE_OPENAI_ENDPOINT,
            apiKey: config.apiKey || process.env.AZURE_OPENAI_API_KEY,
            deployment: config.deployment || process.env.AZURE_OPENAI_DEPLOYMENT,
            apiVersion: config.apiVersion || process.env.AZURE_OPENAI_API_VERSION || '2024-02-01',
            maxTokens: config.maxTokens || parseInt(process.env.AZURE_OPENAI_MAX_TOKENS) || 4096,
            temperature: config.temperature || parseFloat(process.env.AZURE_OPENAI_TEMPERATURE) || 0.7,
            topP: config.topP || parseFloat(process.env.AZURE_OPENAI_TOP_P) || 0.95,
            ...config
        };

        this.client = null;
        this.isReady = false;
        this.healthStats = {
            provider: 'Azure OpenAI',
            model: this.config.deployment,
            status: 'initializing',
            lastCheck: null,
            uptime: 0,
            errorCount: 0,
            totalRequests: 0,
            startTime: Date.now()
        };

        // Token pricing (approximate rates per 1M tokens)
        this.pricing = {
            'gpt-4': { input: 30, output: 60 },
            'gpt-4-turbo': { input: 10, output: 30 },
            'gpt-4-32k': { input: 60, output: 120 },
            'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
            'gpt-3.5-turbo-16k': { input: 3, output: 4 }
        };
    }

    async initialize() {
        try {
            if (!this.config.endpoint || !this.config.apiKey || !this.config.deployment) {
                throw new Error('Missing required Azure OpenAI configuration');
            }

            this.client = new OpenAI({
                apiKey: this.config.apiKey,
                baseURL: `${this.config.endpoint}/openai/deployments/${this.config.deployment}`,
                defaultQuery: { 'api-version': this.config.apiVersion },
                defaultHeaders: {
                    'api-key': this.config.apiKey,
                }
            });

            await this.testConnection();
            this.isReady = true;
            this.healthStats.status = 'ready';
            
            logger.info(`✅ Azure OpenAI initialized: ${this.config.deployment}`);
        } catch (error) {
            this.healthStats.status = 'error';
            this.healthStats.errorCount++;
            logger.error('❌ Failed to initialize Azure OpenAI:', error);
            throw error;
        }
    }

    async testConnection() {
        try {
            const response = await this.client.chat.completions.create({
                messages: [{ role: 'user', content: 'Test connection' }],
                max_tokens: 10,
                temperature: 0
            });

            if (response.choices && response.choices.length > 0) {
                this.healthStats.lastCheck = new Date();
                return 'Connection successful';
            } else {
                throw new Error('Invalid response from Azure OpenAI');
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
        return this.config.deployment;
    }

    getProviderName() {
        return 'Azure OpenAI';
    }

    getMaxTokens() {
        return this.config.maxTokens;
    }

    getContextWindow() {
        const model = this.config.deployment.toLowerCase();
        if (model.includes('gpt-4-32k')) return 32768;
        if (model.includes('gpt-4')) return 8192;
        if (model.includes('16k')) return 16384;
        return 4096;
    }

    async estimateTokens(text) {
        // Rough estimation: 1 token ≈ 0.75 words
        const words = text.split(/\s+/).length;
        return Math.ceil(words / 0.75);
    }

    async calculateCost(inputTokens, outputTokens) {
        const modelKey = this.config.deployment.toLowerCase();
        let rates = this.pricing['gpt-4']; // Default
        
        for (const [key, value] of Object.entries(this.pricing)) {
            if (modelKey.includes(key)) {
                rates = value;
                break;
            }
        }

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
            
            const requestOptions = {
                messages: this.formatMessages(messages),
                max_tokens: options.maxTokens || this.config.maxTokens,
                temperature: options.temperature ?? this.config.temperature,
                top_p: options.topP ?? this.config.topP,
                frequency_penalty: options.frequencyPenalty || 0,
                presence_penalty: options.presencePenalty || 0,
                stop: options.stop || null,
                ...options.extra
            };

            const response = await this.client.chat.completions.create(requestOptions);
            
            const result = {
                content: response.choices[0]?.message?.content || '',
                finishReason: response.choices[0]?.finish_reason || 'unknown',
                usage: {
                    promptTokens: response.usage?.prompt_tokens || 0,
                    completionTokens: response.usage?.completion_tokens || 0,
                    totalTokens: response.usage?.total_tokens || 0
                },
                model: response.model || this.config.deployment,
                provider: 'Azure OpenAI',
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
            
            const requestOptions = {
                messages: this.formatMessages(messages),
                max_tokens: options.maxTokens || this.config.maxTokens,
                temperature: options.temperature ?? this.config.temperature,
                top_p: options.topP ?? this.config.topP,
                stream: true,
                ...options.extra
            };

            const stream = await this.client.chat.completions.create(requestOptions);
            
            let fullContent = '';
            let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta?.content || '';
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

                if (chunk.usage) {
                    usage = {
                        promptTokens: chunk.usage.prompt_tokens || 0,
                        completionTokens: chunk.usage.completion_tokens || 0,
                        totalTokens: chunk.usage.total_tokens || 0
                    };
                }
            }

            const result = {
                content: fullContent,
                finishReason: 'stop',
                usage,
                model: this.config.deployment,
                provider: 'Azure OpenAI',
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
        try {
            // Note: You need a separate embedding deployment
            const response = await this.client.embeddings.create({
                input: text,
                model: 'text-embedding-ada-002' // Or your embedding deployment name
            });

            return {
                embedding: response.data[0].embedding,
                usage: response.usage,
                model: response.model,
                provider: 'Azure OpenAI'
            };

        } catch (error) {
            logger.warn('Azure OpenAI embedding not available:', error.message);
            return null;
        }
    }

    async classifyIntent(message, classes) {
        const prompt = `Classify the following message into one of these categories: ${classes.join(', ')}.
        
Message: "${message}"

Respond with only the category name.`;

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
        const prompt = `Summarize this conversation in ${maxLength} characters or less:

${conversation}

Summary:`;

        const response = await this.generateResponse([
            { role: 'user', content: prompt }
        ], { maxTokens: 100, temperature: 0.3 });

        return response.content.trim();
    }

    async generateWithTools(messages, tools = [], options = {}) {
        try {
            const requestOptions = {
                messages: this.formatMessages(messages),
                max_tokens: options.maxTokens || this.config.maxTokens,
                temperature: options.temperature ?? this.config.temperature,
                tools: tools.map(tool => ({
                    type: 'function',
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.parameters
                    }
                })),
                tool_choice: options.toolChoice || 'auto',
                ...options.extra
            };

            const response = await this.client.chat.completions.create(requestOptions);
            
            const result = {
                content: response.choices[0]?.message?.content || '',
                toolCalls: response.choices[0]?.message?.tool_calls || [],
                finishReason: response.choices[0]?.finish_reason || 'unknown',
                usage: {
                    promptTokens: response.usage?.prompt_tokens || 0,
                    completionTokens: response.usage?.completion_tokens || 0,
                    totalTokens: response.usage?.total_tokens || 0
                },
                model: response.model || this.config.deployment,
                provider: 'Azure OpenAI'
            };

            return result;

        } catch (error) {
            this.healthStats.errorCount++;
            return this.handleAPIError(error);
        }
    }

    supportsTools() {
        return true;
    }

    async analyzeImage(imageData, prompt = "Describe this image") {
        try {
            // Check if model supports vision
            if (!this.config.deployment.includes('vision') && !this.config.deployment.includes('gpt-4')) {
                throw new Error('Vision not supported by this model');
            }

            const messages = [{
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    { 
                        type: 'image_url', 
                        image_url: { 
                            url: `data:image/jpeg;base64,${imageData}`,
                            detail: 'auto'
                        } 
                    }
                ]
            }];

            const response = await this.generateResponse(messages);
            return response;

        } catch (error) {
            logger.warn('Azure OpenAI vision not available:', error.message);
            throw error;
        }
    }

    supportsVision() {
        return this.config.deployment.includes('vision') || this.config.deployment.includes('gpt-4');
    }

    async speechToText(audioData) {
        try {
            const response = await this.client.audio.transcriptions.create({
                file: audioData,
                model: 'whisper-1',
                response_format: 'text'
            });

            return {
                text: response,
                provider: 'Azure OpenAI',
                model: 'whisper-1'
            };

        } catch (error) {
            logger.warn('Azure OpenAI speech-to-text not available:', error.message);
            throw error;
        }
    }

    async textToSpeech(text, voice = 'alloy') {
        try {
            const response = await this.client.audio.speech.create({
                model: 'tts-1',
                voice: voice,
                input: text,
                response_format: 'mp3'
            });

            return response;

        } catch (error) {
            logger.warn('Azure OpenAI text-to-speech not available:', error.message);
            throw error;
        }
    }

    supportsSpeech() {
        return true; // Azure OpenAI supports both speech-to-text and text-to-speech
    }

    getAutoGenConfig() {
        return {
            config_list: [{
                model: this.config.deployment,
                api_type: 'azure',
                api_base: this.config.endpoint,
                api_key: this.config.apiKey,
                api_version: this.config.apiVersion
            }],
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens,
            top_p: this.config.topP
        };
    }

    async handleAPIError(error, retryCount = 0) {
        const maxRetries = 3;
        const baseDelay = 1000;

        // Specific error handling
        if (error.status === 429 && retryCount < maxRetries) {
            // Rate limit - exponential backoff
            const delay = baseDelay * Math.pow(2, retryCount);
            logger.warn(`Rate limited, retrying in ${delay}ms...`);
            
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.handleAPIError(error, retryCount + 1);
        }

        if (error.status === 503 && retryCount < maxRetries) {
            // Service unavailable - retry
            const delay = baseDelay * (retryCount + 1);
            logger.warn(`Service unavailable, retrying in ${delay}ms...`);
            
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.handleAPIError(error, retryCount + 1);
        }

        // Log error details
        logger.error('Azure OpenAI API Error:', {
            status: error.status,
            message: error.message,
            type: error.type,
            retryCount
        });

        throw new Error(`Azure OpenAI Error: ${error.message}`);
    }

    async checkRateLimit() {
        // Implement custom rate limiting if needed
        return true;
    }

    async switchModel(modelName) {
        this.config.deployment = modelName;
        this.healthStats.model = modelName;
        
        // Update client with new deployment
        this.client = new OpenAI({
            apiKey: this.config.apiKey,
            baseURL: `${this.config.endpoint}/openai/deployments/${modelName}`,
            defaultQuery: { 'api-version': this.config.apiVersion },
            defaultHeaders: {
                'api-key': this.config.apiKey,
            }
        });

        logger.info(`✅ Switched to model: ${modelName}`);
    }

    getAvailableModels() {
        // Return commonly available Azure OpenAI models
        return [
            'gpt-4',
            'gpt-4-turbo',
            'gpt-4-32k',
            'gpt-35-turbo',
            'gpt-35-turbo-16k'
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

    formatMessages(messages) {
        return messages.map(msg => ({
            role: msg.role,
            content: msg.content,
            name: msg.name || undefined
        }));
    }
}

module.exports = AzureOpenAIAdapter;
