/**
 * Base Message Handler
 * Shared utilities and common logic for all message handler types.
 * Admin, User, and Group handlers extend this class.
 */

class BaseMessageHandler {
    constructor(container) {
        this.container = container;
        this.messageProvider = container.resolve('IMessageProvider');
        this.database = container.resolve('IDatabase');
        this.llmProvider = container.resolve('ILLMProvider');
        this.config = container.resolve('ConfigurationManager');
        this.pluginManager = container.resolve('PluginManager');
        this.ttsProvider = container.resolve('ITTSProvider');

        // Track message IDs sent by the bot to avoid re-processing them in message_create
        this._botSentMessageIds = new Set();

        /**
         * Source type identifier — overridden by subclasses.
         * Values: 'admin', 'user', 'group'
         */
        this.sourceType = 'user';
    }

    // =====================================================
    // PER-HANDLER TOOL ACCESS CONTROL
    // =====================================================

    /**
     * Return the tool categories this handler type is allowed to use.
     * Subclasses override this to restrict or expand tool access.
     * Returns null to allow ALL tools (admin default).
     */
    _getAllowedToolCategories() {
        // Default: all categories for user handler
        return ['information', 'math'];
    }

    /**
     * Build a list of tool descriptions that the LLM can use to decide
     * when to call a tool. Filtered by the handler's allowed categories.
     */
    _getToolDescriptionsForLLM() {
        const allowedCategories = this._getAllowedToolCategories();
        const allTools = this.pluginManager.getAvailableTools();

        const filtered = allowedCategories === null
            ? allTools
            : allTools.filter(t => allowedCategories.includes(t.category));

        return filtered.map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
        }));
    }

    /**
     * Execute a tool call requested by the LLM.
     * Returns the tool result as a string.
     */
    async _executeToolCall(toolName, toolArgs, context) {
        try {
            console.log(`[TOOL] 🔧 Executing tool: ${toolName}`, JSON.stringify(toolArgs));
            const result = await this.pluginManager.executeTool(toolName, toolArgs, context);
            if (result.success) {
                const resultStr = typeof result.result === 'string'
                    ? result.result
                    : JSON.stringify(result.result);
                console.log(`[TOOL] ✅ Tool ${toolName} succeeded (${resultStr.length} chars)`);
                console.log(`[TOOL] 📦 Output (${toolName}):\n${resultStr}`);
                return resultStr;
            }
            console.log(`[TOOL] ⚠️ Tool ${toolName} returned error: ${result.error}`);
            return `Tool error: ${result.error}`;
        } catch (error) {
            console.error(`[TOOL] ❌ Tool execution failed (${toolName}):`, error.message);
            return `Tool error: ${error.message}`;
        }
    }

    // =====================================================
    // CONTACT ID HELPERS
    // =====================================================

    _normalizeContactId(contactId) {
        if (!contactId) return contactId;
        return String(contactId).trim().toLowerCase();
    }

    _isGroupContact(contactId) {
        return contactId && contactId.endsWith('@g.us');
    }

    // =====================================================
    // DASHBOARD NOTIFICATION HELPERS
    // =====================================================

    _emitDashboardEvent(event, data) {
        try {
            const dashboard = this.container.resolve('DashboardServer');
            if (dashboard && dashboard.io && typeof dashboard.io.emit === 'function') {
                dashboard.io.emit(event, { ...data, timestamp: new Date() });
            }
        } catch (e) {
            // Dashboard is optional / may not be started
        }
    }

    _emitDashboardSettingsUpdated(payload) {
        this._emitDashboardEvent('settings-updated', payload);
    }

    _emitDashboardAllowedContactsUpdated() {
        this._emitDashboardEvent('allowed-contacts-updated', {});
    }

    _emitDashboardSystemStatus() {
        this._emitDashboardEvent('system-status', {
            botPaused: global.botPaused || false,
            agentStates: global.agentStates || {},
        });
    }

    _notifyDashboard(event, data) {
        try {
            if (this.container.has('DashboardServer')) {
                const dashboard = this.container.resolve('DashboardServer');
                if (dashboard && dashboard.io) {
                    dashboard.io.emit(event, { ...data, timestamp: new Date() });
                }
            }
        } catch (error) {
            // Dashboard may not be available - non-fatal
        }
    }

    // =====================================================
    // MEDIA HELPERS
    // =====================================================

    _isMediaType(messageType) {
        const mediaTypes = ['ptt', 'audio', 'image', 'sticker', 'document'];
        return mediaTypes.includes(messageType);
    }

    async _processMedia(message) {
        try {
            if (!this.container.has('MediaHandlerService')) {
                return null;
            }
            const mediaHandler = this.container.resolve('MediaHandlerService');
            if (!mediaHandler || !mediaHandler.isReady()) {
                return null;
            }
            return await mediaHandler.processMediaMessage(message);
        } catch (error) {
            console.error('❌ Media processing error:', error.message);
            return null;
        }
    }

    // =====================================================
    // PER-HANDLER SYSTEM PROMPTS (Node.js fallback)
    // =====================================================

    /**
     * Get the system prompt tailored to this handler's sourceType.
     * Used only in the Node.js fallback path (when Python bridge is down).
     * Subclasses can override for further customization.
     */
    _getSystemPromptForSource() {
        const languageRules = `\n\nLanguage Rules (VERY IMPORTANT):\n- If the user writes in Arabic, you MUST reply in Egyptian Arabic dialect (العامية المصرية), NOT Modern Standard Arabic (فصحى).\n  Use natural Egyptian expressions like: ازيك، ايوه، كده، عايز، ممكن، طيب، تمام، ان شاء الله، الحمد لله\n- If the user writes in English, reply in English.\n- Always match the user's language.\nKeep responses under 300 words.`;

        const prompts = {
            admin: `You are a powerful AI assistant for the system administrator on WhatsApp. You have full access to all tools and capabilities. Be direct, technical when needed, and proactive. You can help with system management, debugging, and any task the admin requests.` + languageRules,

            user: `You are a helpful WhatsApp AI assistant. Provide clear, concise, and helpful responses. Use a friendly, professional tone. Focus on being helpful and accurate.` + languageRules,

            group: `You are a helpful AI assistant in a WhatsApp group chat. Keep responses concise and relevant since many people can see them. Be respectful of the group context. Do not share private information. Answer the question directly without unnecessary elaboration.` + languageRules
        };

        return prompts[this.sourceType] || prompts.user;
    }

    // =====================================================
    // LLM / AI PROCESSING
    // =====================================================

    async processWithLLM(messageText, context) {
        // Use Python bridge for AI processing (integrating architectures)
        const pythonBridge = this.container.resolve('PythonBridge');

        // Build tool descriptions for the LLM
        const availableTools = this._getToolDescriptionsForLLM();
        console.log(`[FLOW] 🧠 processWithLLM | sourceType=${this.sourceType} | tools=${availableTools.length} | contact=${context.contactId}`);

        if (pythonBridge && pythonBridge.isReady()) {
            console.log(`[FLOW] 🐍 Using Python bridge`);
            // Use modern Python architecture — pass sourceType and tools
            const response = await pythonBridge.processMessage(messageText, {
                user: context.user,
                contactId: context.contactId,
                sourceType: this.sourceType,
                availableTools: availableTools,
                history: await this.getRecentHistory(context.contactId)
            });

            console.log(`[FLOW] 🐍 Python response | agent=${response.agent_name} | tokens=${response.tokens_used || 0} | tool_calls=${(response.tool_calls || []).length}`);

            // Handle tool calls requested by the Python agent
            let finalResponse = response.response;
            if (response.tool_calls && Array.isArray(response.tool_calls) && response.tool_calls.length > 0) {
                console.log(`[FLOW] 🔧 Agent requested ${response.tool_calls.length} tool call(s): ${response.tool_calls.map(tc => tc.name).join(', ')}`);
                finalResponse = await this._handleToolCallLoop(messageText, response, context, availableTools);
            } else {
                console.log(`[FLOW] 💬 No tool calls — direct response`);
            }

            // Save assistant response
            await this.database.saveMessage(
                context.contactId,
                'assistant',
                finalResponse,
                response.agent_name,
                response.tokens_used || 0
            );

            console.log(`[FLOW] ✅ Final response ready (${finalResponse.length} chars)`);
            return finalResponse;
        } else {
            // Fallback to direct LLM (Node.js) with per-handler prompt and tool info
            console.log(`[FLOW] ⚡ Python bridge unavailable — using Node.js LLM fallback`);
            return await this._processWithNodeLLM(messageText, context, availableTools);
        }
    }

    /**
     * Node.js fallback LLM processing with per-handler system prompt
     * and tool descriptions injected into the prompt.
     */
    async _processWithNodeLLM(messageText, context, availableTools) {
        console.log(`[FLOW] ⚡ Node.js LLM | sourceType=${this.sourceType} | tools=${availableTools.length}`);
        let systemPrompt = this._getSystemPromptForSource();

        // Inject tool descriptions into the system prompt so the LLM knows what's available
        if (availableTools.length > 0) {
            const toolList = availableTools.map(t =>
                `- ${t.name}: ${t.description} (params: ${JSON.stringify(t.parameters)})`
            ).join('\n');

            systemPrompt += `\n\nYou have access to the following tools. To use a tool, respond with EXACTLY this JSON format on its own line:\n{"tool_call": {"name": "<tool_name>", "arguments": {<params>}}}\n\nAvailable tools:\n${toolList}\n\nOnly use a tool when the user's request clearly requires it. Otherwise respond normally.`;
        }

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: messageText }
        ];

        // Add conversation history
        const history = await this.getRecentHistory(context.contactId);
        for (const hist of history.slice(-3)) {
            if (hist.role && hist.message) {
                messages.splice(-1, 0, { role: hist.role, content: hist.message });
            }
        }

        const maxRounds = 3;
        let totalTokens = 0;

        for (let round = 0; round < maxRounds; round++) {
            console.log(`[FLOW] ⚡ Node LLM round ${round + 1}/${maxRounds}`);
            const response = await this.llmProvider.generateResponse(messages, {
                maxTokens: this.config.get('llm.maxTokens', 4096),
                temperature: this.config.get('llm.temperature', 0.7)
            });

            totalTokens += response.usage?.totalTokens || 0;
            const content = response.content || '';

            // Check if the LLM wants to call a tool
            const toolCall = this._parseToolCallFromText(content);
            if (toolCall && availableTools.some(t => t.name === toolCall.name)) {
                console.log(`[FLOW] 🔧 Node LLM requested tool: ${toolCall.name}`);
                const toolResult = await this._executeToolCall(toolCall.name, toolCall.arguments, context);

                // Feed tool result back to the LLM
                messages.push({ role: 'assistant', content: content });
                messages.push({ role: 'user', content: `Tool result for ${toolCall.name}:\n${toolResult}\n\nNow provide your final answer to the user based on this result.` });
                continue;
            }

            // No tool call — this is the final response
            console.log(`[FLOW] ⚡ Node LLM final response (${content.length} chars, ${totalTokens} tokens)`);
            await this.database.saveMessage(
                context.contactId,
                'assistant',
                content,
                this.llmProvider.getProviderName(),
                totalTokens
            );

            return content;
        }

        // If we exhausted rounds, return the last response
        console.log(`[FLOW] ⚠️ Node LLM exhausted ${maxRounds} tool-call rounds`);
        const lastMsg = messages[messages.length - 1];
        return lastMsg.content || 'I was unable to complete the request. Please try again.';
    }

    /**
     * Handle tool calls returned by the Python agent.
     * Executes the tools and sends results back for a final answer.
     */
    async _handleToolCallLoop(messageText, initialResponse, context, availableTools) {
        const pythonBridge = this.container.resolve('PythonBridge');
        let currentResponse = initialResponse;
        const maxRounds = 3;

        for (let round = 0; round < maxRounds; round++) {
            if (!currentResponse.tool_calls || currentResponse.tool_calls.length === 0) {
                console.log(`[FLOW] 🔧 Tool-call loop ended at round ${round + 1} — no more tool calls`);
                return currentResponse.response;
            }

            console.log(`[FLOW] 🔧 Tool-call loop round ${round + 1}/${maxRounds} — executing ${currentResponse.tool_calls.length} tool(s)`);

            // Execute all requested tool calls
            const toolResults = [];
            for (const tc of currentResponse.tool_calls) {
                const result = await this._executeToolCall(tc.name, tc.arguments || {}, context);
                toolResults.push({ name: tc.name, result });
            }

            console.log(`[FLOW] 🔧 Sending ${toolResults.length} tool result(s) back to Python for final answer`);
            console.log(`[FLOW] 📦 toolResults payload: ${JSON.stringify(toolResults)}`);

            // Send tool results back to Python for final answer
            currentResponse = await pythonBridge.processMessage(messageText, {
                user: context.user,
                contactId: context.contactId,
                sourceType: this.sourceType,
                availableTools: availableTools,
                history: await this.getRecentHistory(context.contactId),
                toolResults: toolResults
            });
        }

        console.log(`[FLOW] ⚠️ Tool-call loop exhausted ${maxRounds} rounds`);
        return currentResponse.response;
    }

    /**
     * Parse a tool call from LLM text output (Node.js fallback path).
     * Looks for JSON like: {"tool_call": {"name": "...", "arguments": {...}}}
     */
    _parseToolCallFromText(text) {
        // Use balanced-brace extraction to handle nested objects in arguments
        for (const block of this._extractJsonBlocks(text)) {
            try {
                const parsed = JSON.parse(block);
                if (parsed && parsed.tool_call && parsed.tool_call.name) {
                    return parsed.tool_call;
                }
            } catch (e) {
                // Not valid JSON, skip
            }
        }
        return null;
    }

    /**
     * Extract top-level JSON object blocks from text using balanced-brace matching.
     */
    _extractJsonBlocks(text) {
        const blocks = [];
        let i = 0;
        while (i < text.length) {
            if (text[i] === '{') {
                let depth = 0;
                const start = i;
                while (i < text.length) {
                    if (text[i] === '{') depth++;
                    else if (text[i] === '}') {
                        depth--;
                        if (depth === 0) {
                            blocks.push(text.substring(start, i + 1));
                            break;
                        }
                    }
                    i++;
                }
            }
            i++;
        }
        return blocks;
    }

    async getRecentHistory(contactId, limit = 5) {
        try {
            const history = await this.database.getConversationHistory(contactId, limit);
            return history.map(msg => ({
                role: msg.role,
                message: msg.message,
                timestamp: msg.timestamp
            }));
        } catch (error) {
            console.error('Error getting history:', error);
            return [];
        }
    }

    async processWithSkills(messageText, skills, context) {
        let bestSkill = skills[0]; // Highest relevance

        const skillResult = await this.pluginManager.executeSkill(
            bestSkill.name,
            { message: messageText },
            context
        );

        if (skillResult.success) {
            return typeof skillResult.result === 'string'
                ? skillResult.result
                : JSON.stringify(skillResult.result);
        } else {
            // Fallback to LLM
            return await this.processWithLLM(messageText, context);
        }
    }

    // =====================================================
    // RATE LIMITING / PERMISSIONS
    // =====================================================

    async checkMessageAllowed(contactId, messageText) {
        // Check blacklist
        if (await this.database.isBlacklisted(contactId)) {
            console.log(`🚫 Message from blacklisted user: ${contactId}`);
            return false;
        }

        // Check rate limits
        const rateLimitData = await this.database.getRateLimitData(contactId, 60); // 1 hour
        const messageCount = rateLimitData.length;
        const maxMessages = this.config.get('rateLimiting.maxMessagesPerHour', 10);

        if (messageCount >= maxMessages) {
            await this.sendResponse(contactId, '⏳ Rate limit reached. Please wait before sending more messages.');
            return false;
        }

        // Update rate limit
        await this.database.updateRateLimit(contactId, new Date(), messageCount + 1);

        return true;
    }

    // =====================================================
    // RESPONSE SENDING
    // =====================================================

    async sendResponse(contactId, responseText) {
        try {
            console.log(`[SEND] 📤 sendResponse (plain) to ${contactId} (${responseText.length} chars)`);
            // Check if voice replies are enabled
            const voiceRepliesEnabled = await this.database.isVoiceRepliesEnabled();

            if (voiceRepliesEnabled && this.ttsProvider) {
                // Send as voice message
                try {
                    const isReady = await this.ttsProvider.isReady();
                    if (isReady) {
                        console.log('[SEND] 🎤 Converting text to speech...');
                        const audioBuffer = await this.ttsProvider.textToSpeech(responseText);

                        // Send audio message as voice note (PTT)
                        const result = await this.messageProvider.sendAudioMessage(contactId, audioBuffer, { asVoiceNote: true });

                        if (result && result.id) {
                            this._botSentMessageIds.add(result.id);
                            setTimeout(() => this._botSentMessageIds.delete(result.id), 60000);
                        }

                        console.log('[SEND] 🔊 Voice message sent');
                        return;
                    }
                } catch (ttsError) {
                    console.warn('[SEND] ⚠️ TTS failed, falling back to text:', ttsError.message);
                    // Fall through to text message
                }
            }

            // Send as text message (default or fallback)
            const result = await this.messageProvider.sendMessage(contactId, responseText);
            if (result && result.id) {
                this._botSentMessageIds.add(result.id);
                setTimeout(() => this._botSentMessageIds.delete(result.id), 60000);
            }
            console.log('[SEND] ✅ Plain message sent');
        } catch (error) {
            console.error('[SEND] ❌ Failed to send response:', error);
        }
    }

    /**
     * Reply to a specific message (quote-reply).
     * Uses WhatsApp's native message.reply() so the response appears
     * as a quoted reply to the original message in the chat.
     * Falls back to sendResponse() if reply fails.
     */
    async replyToMessage(originalMessage, responseText) {
        try {
            console.log(`[SEND] 💬 replyToMessage (quote-reply) to ${originalMessage.from} (${responseText.length} chars)`);
            // Check if voice replies are enabled
            const voiceRepliesEnabled = await this.database.isVoiceRepliesEnabled();

            if (voiceRepliesEnabled && this.ttsProvider) {
                try {
                    const isReady = await this.ttsProvider.isReady();
                    if (isReady) {
                        console.log('[SEND] 🎤 Converting text to speech (reply)...');
                        const audioBuffer = await this.ttsProvider.textToSpeech(responseText);
                        const contactId = this._normalizeContactId(originalMessage.from);
                        const result = await this.messageProvider.sendAudioMessage(contactId, audioBuffer, { asVoiceNote: true });
                        if (result && result.id) {
                            this._botSentMessageIds.add(result.id);
                            setTimeout(() => this._botSentMessageIds.delete(result.id), 60000);
                        }
                        console.log('[SEND] 🔊 Voice quote-reply sent');
                        return;
                    }
                } catch (ttsError) {
                    console.warn('[SEND] ⚠️ TTS failed, falling back to text reply:', ttsError.message);
                }
            }

            // Use WhatsApp's native quote-reply
            const result = await originalMessage.reply(responseText);
            if (result && result.id) {
                const msgId = result.id.id || result.id;
                this._botSentMessageIds.add(msgId);
                setTimeout(() => this._botSentMessageIds.delete(msgId), 60000);
            }
            console.log('[SEND] ✅ Quote-reply sent');
        } catch (error) {
            console.error('[SEND] ❌ Failed to reply to message, falling back to sendResponse:', error.message);
            // Fallback to normal send
            const contactId = this._normalizeContactId(originalMessage.from);
            await this.sendResponse(contactId, responseText);
        }
    }

    async sendErrorResponse(contactId) {
        const errorMessage = this.config.get('messages.errorResponse',
            'Sorry, I encountered an error processing your message. Please try again.');
        await this.sendResponse(contactId, errorMessage);
    }

    // =====================================================
    // COMMON MESSAGE PROCESSING PIPELINE
    // =====================================================

    /**
     * Shared pipeline: media extraction → save → rate limit → skills/LLM → auto/manual reply.
     * Each handler calls this after its own pre-checks.
     *
     * @param {string} contactId
     * @param {object} message - WhatsApp message object (needed for quote-reply)
     * @param {string} messageText
     * @param {string} messageType
     * @param {object} [options]
     * @param {boolean} [options.forceAutoReply=false] - If true, always quote-reply (skip manual-mode queue).
     *        Used by admin and group handlers so their responses are never queued.
     */
    async processMessagePipeline(contactId, message, messageText, messageType, options = {}) {
        const { forceAutoReply = false } = options;

        console.log(`[PIPELINE] ▶ START | sourceType=${this.sourceType} | contact=${contactId} | type=${messageType} | forceAutoReply=${forceAutoReply}`);
        console.log(`[PIPELINE] 📝 Message: ${(messageText || '').substring(0, 120)}`);

        // Process media messages (audio/image/document) if applicable
        let effectiveText = messageText;
        let effectiveType = messageType;

        if (this._isMediaType(messageType)) {
            const mediaResult = await this._processMedia(message);
            if (mediaResult) {
                effectiveText = mediaResult.text;
                effectiveType = `${messageType}:${mediaResult.mediaType}`;
                console.log(`[PIPELINE] 📎 Media processed (${mediaResult.mediaType}): ${effectiveText.substring(0, 80)}...`);
            }
        }

        // Get or create user
        const user = await this.database.getOrCreateUser(contactId, message.notifyName);

        // Save incoming message
        await this.database.saveMessage(contactId, 'user', effectiveText, null, 0, effectiveType);

        // Check rate limits and permissions
        if (!await this.checkMessageAllowed(contactId, effectiveText)) {
            console.log(`[PIPELINE] 🚫 Rate limit / permission check failed for ${contactId}`);
            return;
        }

        // Find relevant skills from plugins
        const relevantSkills = this.pluginManager.findRelevantSkills(effectiveText);

        let response;
        if (relevantSkills.length > 0) {
            console.log(`[PIPELINE] 🎯 Using plugin skill: ${relevantSkills[0].name}`);
            response = await this.processWithSkills(effectiveText, relevantSkills, { user, contactId });
        } else {
            console.log(`[PIPELINE] 🧠 No matching skills — routing to LLM`);
            response = await this.processWithLLM(effectiveText, { user, contactId });
        }

        // Determine reply mode:
        // - forceAutoReply=true → always quote-reply (admin, group, admin self-chat)
        // - Otherwise respect the auto/manual setting
        const autoReply = forceAutoReply || await this.database.isAutoReplyEnabled();

        if (autoReply) {
            console.log(`[PIPELINE] 💬 Sending quote-reply (forceAutoReply=${forceAutoReply})`);
            await this.replyToMessage(message, response);
        } else {
            // Manual mode: queue for admin approval (only for regular user messages)
            await this.database.addPendingMessage(
                contactId,
                message.notifyName || contactId,
                messageText,
                response
            );
            console.log(`[PIPELINE] ⏳ Message queued for approval from ${contactId}`);

            // Notify dashboard via WebSocket
            this._notifyDashboard('pending-message', {
                contactId,
                contactName: message.notifyName || contactId,
                messageText,
                aiResponse: response,
            });
        }

        console.log(`[PIPELINE] ✅ DONE | sourceType=${this.sourceType} | contact=${contactId}`);
    }
}

module.exports = BaseMessageHandler;
