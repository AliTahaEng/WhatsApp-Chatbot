"""
Modern Agent Orchestrator
Refactored to follow all 6 architectural principles with DI.

Improvements over original:
- LLM-based intent classification (replaces fragile keyword matching)
- sourceType awareness (admin/user/group) — agents adapt their prompts
- Tool-calling support — agents can request Node.js tools via tool_calls
- toolResults handling — incorporates tool results into final response
"""

import asyncio
import json
import logging
import random
from datetime import datetime
from typing import Dict, List, Optional, Any

from core.interfaces.ILLMProvider import ILLMProvider, LLMMessage

class ModernAgentOrchestrator:
    """
    Modern agent orchestrator following architectural principles:
    1. Separation of Concerns - Only handles agent coordination
    2. Single Responsibility - Only orchestrates agents
    3. Build for Change - Uses DI for flexibility
    4. Loose Coupling - Depends on abstractions
    5. Clean Code - Clear structure and naming
    6. Versioned - Supports API versioning
    """
    
    def __init__(self, container):
        self.container = container
        self.config = container.resolve('ConfigurationManager')
        self.llm_provider = container.resolve('ILLMProvider')
        
        self.logger = logging.getLogger(__name__)
        
        # Agent registry (loaded via configuration)
        self.agents = {}
        
        # Metrics tracking (single responsibility)
        self.metrics = {
            'total_requests': 0,
            'successful_responses': 0,
            'failed_responses': 0,
            'average_response_time': 0,
            'agent_usage': {}
        }
        
        self.is_initialized = False

    async def initialize(self):
        """Initialize the orchestrator and agents"""
        try:
            self.logger.info("🤖 Initializing Modern Agent Orchestrator...")
            
            # Load agent configuration
            agent_config = self.config.get_section('agents')
            enabled_agents = agent_config.get('enabledAgents', ['all'])
            
            # Initialize agents based on configuration (Build for Change)
            await self._initialize_agents(enabled_agents)
            
            self.is_initialized = True
            self.logger.info(f"✅ Agent Orchestrator initialized with {len(self.agents)} agents")
            
        except Exception as e:
            self.logger.error(f"❌ Failed to initialize orchestrator: {e}")
            raise

    async def _initialize_agents(self, enabled_agents: List[str]):
        """Initialize agents via factory pattern (Loose Coupling)"""
        from agents.ModernAgentFactory import ModernAgentFactory
        
        agent_factory = ModernAgentFactory(self.container)
        
        # Define available agent types
        available_agents = [
            'customer_support',
            'tech_support', 
            'research',
            'scheduler',
            'coordinator'
        ]
        
        # Determine which agents to load
        agents_to_load = available_agents if 'all' in enabled_agents else enabled_agents
        
        # Create agents via factory (Single Responsibility)
        for agent_type in agents_to_load:
            try:
                agent = await agent_factory.create_agent(agent_type)
                self.agents[agent_type] = agent
                self.logger.debug(f"✅ Created {agent_type} agent")
                
            except Exception as e:
                self.logger.warning(f"⚠️ Failed to create {agent_type} agent: {e}")

    # ==========================================================
    # MESSAGE PROCESSING
    # ==========================================================

    async def process_message(self, message: str, context: Dict = None) -> Dict:
        """
        Process incoming message.
        
        Context may include:
            - sourceType: 'admin' | 'user' | 'group'
            - availableTools: list of tool descriptions from Node.js
            - toolResults: results from previously requested tool calls
            - history: recent conversation history
            - user / contactId: user info
        """
        if not self.is_initialized:
            raise RuntimeError("Orchestrator not initialized")
            
        context = context or {}
        start_time = asyncio.get_event_loop().time()
        self.metrics['total_requests'] += 1
        
        try:
            source_type = context.get('sourceType', 'user') if context else 'user'
            self.logger.debug(f"📥 Processing message ({source_type}): {message[:100]}...")

            # If tool results are provided, this is a follow-up — generate final answer
            if context.get('toolResults'):
                try:
                    tr = context.get('toolResults') or []
                    self.logger.debug(
                        f"🧰 toolResults received: {len(tr)} item(s) | names={','.join([x.get('name','') for x in tr])}"
                    )
                except Exception:
                    pass
                response = await self._process_with_tool_results(message, context)
                processing_time = (asyncio.get_event_loop().time() - start_time) * 1000
                await self._update_metrics(response.get('agent_name', 'coordinator'), processing_time, True)
                self.metrics['successful_responses'] += 1
                return response
            
            # Route message to appropriate agent using LLM-based classification
            selected_agent = await self._route_message(message, context)
            
            # Process with selected agent (passing sourceType and tools)
            response = await self._process_with_agent(selected_agent, message, context)
            
            # Update metrics
            processing_time = (asyncio.get_event_loop().time() - start_time) * 1000
            await self._update_metrics(selected_agent, processing_time, True)
            self.metrics['successful_responses'] += 1
            
            result = {
                'response': response['content'],
                'agent_name': selected_agent,
                'tokens_used': response.get('tokens_used', 0),
                'processing_time': processing_time,
                'confidence': response.get('confidence', 0.8),
                'metadata': {
                    'timestamp': datetime.utcnow().isoformat(),
                    'source_type': source_type,
                    'message_length': len(message),
                    'response_length': len(response['content'])
                }
            }

            # If the agent requested tool calls, include them in the response
            if response.get('tool_calls'):
                result['tool_calls'] = response['tool_calls']

            return result
            
        except Exception as e:
            processing_time = (asyncio.get_event_loop().time() - start_time) * 1000
            await self._update_metrics('error', processing_time, False)
            self.metrics['failed_responses'] += 1
            self.logger.error(f"❌ Error processing message: {e}")
            
            return {
                'response': self._get_error_response(),
                'agent_name': 'error_handler',
                'tokens_used': 0,
                'processing_time': processing_time,
                'confidence': 0.0,
                'metadata': {
                    'error': str(e),
                    'timestamp': datetime.utcnow().isoformat()
                }
            }

    # ==========================================================
    # LLM-BASED INTENT CLASSIFICATION (replaces keyword matching)
    # ==========================================================

    async def _route_message(self, message: str, context: Dict = None) -> str:
        """
        Route message to the most appropriate agent using LLM-based
        intent classification. Falls back to keyword matching if the
        LLM classification fails (Graceful Degradation).
        """
        available_agent_names = list(self.agents.keys())
        if not available_agent_names:
            return 'coordinator'

        # Build a compact classification prompt
        agent_descriptions = []
        for name in available_agent_names:
            agent = self.agents[name]
            if hasattr(agent, 'is_relevant'):
                # Use agent's own relevance check as a hint
                is_rel, conf = agent.is_relevant(message, context)
                if is_rel and conf > 0.7:
                    return name  # High-confidence shortcut

            desc = {
                'customer_support': 'complaints, refunds, billing, orders, delivery issues',
                'tech_support': 'technical problems, errors, bugs, installation, setup',
                'research': 'questions, explanations, definitions, comparisons, information',
                'scheduler': 'scheduling, appointments, meetings, reminders, calendar',
                'coordinator': 'general conversation, greetings, anything else'
            }
            agent_descriptions.append(f"- {name}: {desc.get(name, 'general')}")

        classification_prompt = f"""Classify the following user message into exactly ONE agent category.
Reply with ONLY the agent name, nothing else.

Available agents:
{chr(10).join(agent_descriptions)}

User message: "{message[:500]}"

Agent:"""

        try:
            response = await self.llm_provider.generate_response(
                [LLMMessage(role='user', content=classification_prompt)],
                max_tokens=20,
                temperature=0.0
            )
            
            classified = response.content.strip().lower().replace(' ', '_')
            # Clean up common LLM formatting artifacts
            for agent_name in available_agent_names:
                if agent_name in classified:
                    self.logger.debug(f"🎯 LLM classified message as: {agent_name}")
                    return agent_name

        except Exception as e:
            self.logger.warning(f"⚠️ LLM classification failed, using fallback: {e}")

        # Fallback: simple keyword matching (Graceful Degradation)
        return self._route_message_fallback(message)

    def _route_message_fallback(self, message: str) -> str:
        """Keyword-based fallback routing when LLM classification fails"""
        message_lower = message.lower()
        
        if any(w in message_lower for w in ['complaint', 'refund', 'billing', 'order', 'delivery']):
            return 'customer_support'
        if any(w in message_lower for w in ['error', 'bug', 'not working', 'broken', 'install', 'setup']):
            return 'tech_support'
        if any(w in message_lower for w in ['schedule', 'appointment', 'meeting', 'remind', 'calendar']):
            return 'scheduler'
        if any(w in message_lower for w in ['what', 'how', 'why', 'explain', 'define']):
            return 'research'
            
        return 'coordinator'

    # ==========================================================
    # AGENT PROCESSING
    # ==========================================================

    async def _process_with_agent(self, agent_name: str, message: str, context: Dict) -> Dict:
        """Process message with specific agent (Separation of Concerns)"""
        
        if agent_name not in self.agents:
            agent_name = 'coordinator'
            
        if agent_name not in self.agents:
            # No agents loaded at all — use direct LLM
            return await self._process_with_llm(message, 'coordinator', context)

        agent = self.agents[agent_name]
        return await agent.process_message(message, context)

    async def _process_with_llm(self, message: str, agent_type: str, context: Dict) -> Dict:
        """Process message directly with LLM provider (Loose Coupling)"""
        
        source_type = context.get('sourceType', 'user') if context else 'user'
        system_prompt = self._get_system_prompt(agent_type, source_type)
        
        # Build tool instructions if tools are available
        available_tools = context.get('availableTools', []) if context else []
        if available_tools:
            system_prompt += self._build_tool_instructions(available_tools)
        
        messages = [
            LLMMessage(role='system', content=system_prompt),
            LLMMessage(role='user', content=message)
        ]
        
        # Add conversation history
        if context and context.get('history'):
            for hist_msg in context['history'][-3:]:
                if hist_msg.get('role') and hist_msg.get('message'):
                    messages.insert(-1, LLMMessage(
                        role=hist_msg['role'],
                        content=hist_msg['message']
                    ))
        
        response = await self.llm_provider.generate_response(
            messages,
            max_tokens=self.config.get('llm.maxTokens', 4096),
            temperature=self.config.get('llm.temperature', 0.7)
        )
        
        content = response.content
        tool_calls = self._parse_tool_calls(content) if available_tools else []

        # If tool calls found, strip them from the visible response
        if tool_calls:
            content = self._strip_tool_call_json(content)

        return {
            'content': content,
            'tokens_used': response.usage.get('total_tokens', 0),
            'confidence': 0.8,
            'tool_calls': tool_calls,
            'model': response.model,
            'provider': response.provider
        }

    # ==========================================================
    # TOOL-CALLING SUPPORT
    # ==========================================================

    def _build_tool_instructions(self, available_tools: list) -> str:
        """Build tool-calling instructions to append to the system prompt"""
        tool_list = []
        for tool in available_tools:
            params = tool.get('parameters', {})
            param_desc = ', '.join(f"{k}: {v.get('description', v.get('type', 'any'))}" 
                                   for k, v in params.items()) if isinstance(params, dict) else str(params)
            tool_list.append(f"  - {tool['name']}: {tool.get('description', '')} (params: {param_desc})")

        return f"""

You have access to the following tools. To use a tool, include EXACTLY this JSON on its own line in your response:
{{"tool_call": {{"name": "<tool_name>", "arguments": {{<params>}}}}}}

Available tools:
{chr(10).join(tool_list)}

Only use a tool when the user's request clearly requires it. Otherwise respond normally.
If you use a tool, you may also include a brief message before the JSON."""

    def _parse_tool_calls(self, text: str) -> list:
        """Parse tool_call JSON blocks from LLM response text.
        Uses balanced-brace extraction to handle nested objects in arguments."""
        import json
        tool_calls = []
        for block in self._extract_json_blocks(text):
            try:
                parsed = json.loads(block)
                if isinstance(parsed, dict) and parsed.get('tool_call', {}).get('name'):
                    tool_calls.append(parsed['tool_call'])
            except (json.JSONDecodeError, ValueError):
                continue
        return tool_calls

    def _strip_tool_call_json(self, text: str) -> str:
        """Remove tool_call JSON blocks from visible response text"""
        import json
        result = text
        for block in self._extract_json_blocks(text):
            try:
                parsed = json.loads(block)
                if isinstance(parsed, dict) and parsed.get('tool_call'):
                    result = result.replace(block, '')
            except (json.JSONDecodeError, ValueError):
                continue
        return result.strip() or "Processing your request..."

    @staticmethod
    def _extract_json_blocks(text: str) -> list:
        """Extract top-level JSON object blocks from text using balanced-brace matching."""
        blocks = []
        i = 0
        while i < len(text):
            if text[i] == '{':
                depth = 0
                start = i
                while i < len(text):
                    if text[i] == '{':
                        depth += 1
                    elif text[i] == '}':
                        depth -= 1
                        if depth == 0:
                            blocks.append(text[start:i+1])
                            break
                    i += 1
            i += 1
        return blocks

    async def _process_with_tool_results(self, message: str, context: Dict) -> Dict:
        """
        Generate a final answer after tool results have been provided.
        Called when context contains 'toolResults'.
        """
        import re
        source_type = context.get('sourceType', 'user')
        system_prompt = self._get_system_prompt('coordinator', source_type)

        # Format tool results
        tool_results = context.get('toolResults', [])
        results_text = "\n".join(
            f"Tool '{tr['name']}' returned:\n{tr['result']}" for tr in tool_results
        )

        # Detect if original message is Arabic
        is_arabic = bool(re.search(r'[\u0600-\u06FF]', message))

        # Build the final-answer instruction
        if is_arabic:
            final_instruction = (
                f"Here are the tool results:\n{results_text}\n\n"
                "Now provide your final answer to the user based on these results.\n"
                "IMPORTANT: The user wrote in Arabic, so you MUST reply in Egyptian Arabic dialect (العامية المصرية).\n"
                "Translate ALL the information you found into Egyptian Arabic.\n"
                "But keep ALL URLs/links EXACTLY as they are — do NOT translate or modify URLs.\n"
                "Include the source URLs at the end of your answer so the user can verify."
            )
        else:
            final_instruction = (
                f"Here are the tool results:\n{results_text}\n\n"
                "Now provide your final answer to the user based on these results.\n"
                "Include the source URLs at the end of your answer."
            )

        messages = [
            LLMMessage(role='system', content=system_prompt),
            LLMMessage(role='user', content=message),
            LLMMessage(role='assistant', content="I used some tools to help answer your question."),
            LLMMessage(role='user', content=final_instruction)
        ]

        # Add conversation history
        if context.get('history'):
            for hist_msg in context['history'][-2:]:
                if hist_msg.get('role') and hist_msg.get('message'):
                    messages.insert(1, LLMMessage(
                        role=hist_msg['role'],
                        content=hist_msg['message']
                    ))

        response = await self.llm_provider.generate_response(
            messages,
            max_tokens=self.config.get('llm.maxTokens', 4096),
            temperature=self.config.get('llm.temperature', 0.7)
        )

        return {
            'response': response.content,
            'agent_name': 'coordinator',
            'tokens_used': response.usage.get('total_tokens', 0),
            'processing_time': 0,
            'confidence': 0.9,
            'metadata': {
                'timestamp': datetime.utcnow().isoformat(),
                'source_type': source_type,
                'tool_results_count': len(tool_results)
            }
        }

    # ==========================================================
    # SYSTEM PROMPTS (source-type aware)
    # ==========================================================

    def _get_system_prompt(self, agent_type: str, source_type: str = 'user') -> str:
        """
        Get system prompt for agent type, adapted for the message source.
        source_type: 'admin' | 'user' | 'group'
        """
        language_rules = """

Language Rules (VERY IMPORTANT):
- If the user writes in Arabic, you MUST reply in Egyptian Arabic dialect (العامية المصرية), NOT Modern Standard Arabic (فصحى).
  Use natural Egyptian expressions like: ازيك، ايوه، كده، عايز، ممكن، طيب، تمام، ان شاء الله، الحمد لله
- If the user writes in English, reply in English.
- Always match the user's language.
Keep responses under 300 words."""

        # Source-type context prefix
        source_context = {
            'admin': "You are talking to the system administrator. Be direct, technical when needed, and proactive. The admin has full access to all capabilities.",
            'user': "You are talking to a regular user in a private WhatsApp chat. Be friendly, professional, and helpful.",
            'group': "You are in a WhatsApp group chat. Keep responses concise since many people can see them. Do not share private information. Be respectful of the group context."
        }

        source_prefix = source_context.get(source_type, source_context['user'])

        prompts = {
            'coordinator': f"""{source_prefix}
You are a helpful AI assistant for WhatsApp. Provide clear, concise, and helpful responses. Use a friendly, professional tone.""" + language_rules,
            
            'customer_support': f"""{source_prefix}
You are a Customer Support specialist. Handle complaints, refunds, billing issues, and order inquiries with empathy and professionalism. Focus on resolution and customer satisfaction.""" + language_rules,
            
            'tech_support': f"""{source_prefix}
You are a Technical Support specialist. Help users troubleshoot technical problems, provide step-by-step solutions, and assist with software/hardware issues. Use clear, non-technical language.""" + language_rules,
            
            'research': f"""{source_prefix}
You are a Research specialist. Provide accurate, well-researched information on various topics. Give clear explanations, cite sources when appropriate, and break down complex topics.""" + language_rules,
            
            'scheduler': f"""{source_prefix}
You are a Scheduling specialist. Help users schedule appointments, manage calendars, set reminders, and coordinate meetings. Always confirm details and provide clear booking information.""" + language_rules
        }
        
        return prompts.get(agent_type, prompts['coordinator'])

    def _get_error_response(self) -> str:
        """Get standardized error response (Clean Code)"""
        error_responses = [
            "I apologize, but I encountered an error processing your message. Please try again.",
            "Sorry, something went wrong. Could you please rephrase your message?",
            "I'm having trouble understanding. Could you try asking in a different way?"
        ]
        return random.choice(error_responses)

    # ==========================================================
    # METRICS
    # ==========================================================

    async def _update_metrics(self, agent_name: str, processing_time: float, success: bool):
        """Update performance metrics (Single Responsibility)"""
        
        if agent_name not in self.metrics['agent_usage']:
            self.metrics['agent_usage'][agent_name] = {
                'total_calls': 0,
                'successful_calls': 0,
                'total_time': 0
            }
        
        agent_metrics = self.metrics['agent_usage'][agent_name]
        agent_metrics['total_calls'] += 1
        agent_metrics['total_time'] += processing_time
        
        if success:
            agent_metrics['successful_calls'] += 1
        
        # Update overall average
        total_time = sum(m['total_time'] for m in self.metrics['agent_usage'].values())
        total_calls = sum(m['total_calls'] for m in self.metrics['agent_usage'].values())
        
        if total_calls > 0:
            self.metrics['average_response_time'] = total_time / total_calls

    async def get_metrics(self) -> Dict:
        """Get orchestrator performance metrics"""
        return {
            'total_requests': self.metrics['total_requests'],
            'successful_responses': self.metrics['successful_responses'],
            'failed_responses': self.metrics['failed_responses'],
            'success_rate': (
                self.metrics['successful_responses'] / 
                max(self.metrics['total_requests'], 1) * 100
            ),
            'average_response_time': self.metrics['average_response_time'],
            'agent_usage': self.metrics['agent_usage'],
            'available_agents': list(self.agents.keys()),
            'llm_provider': self.llm_provider.get_provider_name(),
            'llm_model': self.llm_provider.get_model_name()
        }

    async def health_check(self) -> Dict:
        """Perform health check on orchestrator"""
        try:
            llm_status = await self.llm_provider.get_health_status()
            
            return {
                'status': 'healthy' if self.is_initialized else 'not_ready',
                'initialized': self.is_initialized,
                'agents_loaded': len(self.agents),
                'llm_provider': llm_status,
                'metrics': await self.get_metrics()
            }
            
        except Exception as e:
            return {
                'status': 'unhealthy',
                'error': str(e),
                'initialized': self.is_initialized
            }

    def get_available_agents(self) -> List[str]:
        """Get list of available agent types"""
        return list(self.agents.keys())

    async def reload_agents(self):
        """Reload agents (for hot-reloading)"""
        self.agents.clear()
        agent_config = self.config.get_section('agents')
        await self._initialize_agents(agent_config.get('enabledAgents', ['all']))
        self.logger.info("🔄 Agents reloaded")
