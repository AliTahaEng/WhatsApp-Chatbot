/**
 * LLM Provider Interface
 * Abstract interface for Language Model providers
 * Enables switching between Azure OpenAI, Claude, Google Gemini, local models, etc.
 */

class ILLMProvider {
    // Configuration and Connection
    async initialize() {
        throw new Error('initialize() must be implemented');
    }

    async testConnection() {
        throw new Error('testConnection() must be implemented');
    }

    async isReady() {
        throw new Error('isReady() must be implemented');
    }

    // Model Information
    getModelName() {
        throw new Error('getModelName() must be implemented');
    }

    getProviderName() {
        throw new Error('getProviderName() must be implemented');
    }

    getMaxTokens() {
        throw new Error('getMaxTokens() must be implemented');
    }

    getContextWindow() {
        throw new Error('getContextWindow() must be implemented');
    }

    // Token Management
    async estimateTokens(text) {
        throw new Error('estimateTokens() must be implemented');
    }

    async calculateCost(inputTokens, outputTokens) {
        throw new Error('calculateCost() must be implemented');
    }

    // Core LLM Operations
    async generateResponse(messages, options = {}) {
        throw new Error('generateResponse() must be implemented');
    }

    async generateStreamResponse(messages, options = {}, onChunk) {
        throw new Error('generateStreamResponse() must be implemented');
    }

    // Specialized Operations
    async generateEmbedding(text) {
        throw new Error('generateEmbedding() must be implemented');
    }

    async classifyIntent(message, classes) {
        throw new Error('classifyIntent() must be implemented');
    }

    async summarizeConversation(messages, maxLength = 200) {
        throw new Error('summarizeConversation() must be implemented');
    }

    // Function/Tool Calling (for advanced models)
    async generateWithTools(messages, tools = [], options = {}) {
        throw new Error('generateWithTools() must be implemented');
    }

    supportsTools() {
        return false; // Override in implementations that support tools
    }

    // Vision Capabilities (for multimodal models)
    async analyzeImage(imageData, prompt = "Describe this image") {
        throw new Error('analyzeImage() must be implemented');
    }

    supportsVision() {
        return false; // Override in implementations that support vision
    }

    // Audio/Speech Capabilities
    async speechToText(audioData) {
        throw new Error('speechToText() must be implemented');
    }

    async textToSpeech(text, voice = 'alloy') {
        throw new Error('textToSpeech() must be implemented');
    }

    supportsSpeech() {
        return false; // Override in implementations that support speech
    }

    // AutoGen Configuration
    getAutoGenConfig() {
        throw new Error('getAutoGenConfig() must be implemented');
    }

    // Error Handling and Retry Logic
    async handleAPIError(error, retryCount = 0) {
        throw new Error('handleAPIError() must be implemented');
    }

    // Rate Limiting
    async checkRateLimit() {
        return true; // Override if rate limiting is needed
    }

    // Model Switching (for providers with multiple models)
    async switchModel(modelName) {
        throw new Error('switchModel() must be implemented');
    }

    getAvailableModels() {
        throw new Error('getAvailableModels() must be implemented');
    }

    // Health Monitoring
    getHealthStatus() {
        return {
            provider: this.getProviderName(),
            model: this.getModelName(),
            status: 'unknown',
            lastCheck: null,
            uptime: 0,
            errorCount: 0,
            totalRequests: 0
        };
    }

    async performHealthCheck() {
        throw new Error('performHealthCheck() must be implemented');
    }
}

module.exports = ILLMProvider;
