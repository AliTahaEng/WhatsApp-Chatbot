"""
Modern Agent Factory
Creates agents using dependency injection and abstractions
"""

import logging
from typing import Dict, Any

class ModernAgentFactory:
    """Factory for creating agents with dependency injection"""
    
    def __init__(self, container):
        self.container = container
        self.config = container.resolve('ConfigurationManager')
        self.llm_provider = container.resolve('ILLMProvider')
        self.logger = logging.getLogger(__name__)

    async def create_agent(self, agent_type: str) -> 'BaseModernAgent':
        """Create agent by type using abstractions"""
        
        agent_classes = {
            'customer_support': 'ModernCustomerSupportAgent',
            'tech_support': 'ModernTechSupportAgent', 
            'research': 'ModernResearchAgent',
            'scheduler': 'ModernSchedulerAgent',
            'coordinator': 'ModernCoordinatorAgent'
        }
        
        if agent_type not in agent_classes:
            raise ValueError(f"Unknown agent type: {agent_type}")
        
        agent_class_name = agent_classes[agent_type]
        
        # Dynamic import to avoid circular dependencies
        if agent_type == 'customer_support':
            from agents.modern.ModernCustomerSupportAgent import ModernCustomerSupportAgent
            return ModernCustomerSupportAgent(self.container)
        elif agent_type == 'tech_support':
            from agents.modern.ModernTechSupportAgent import ModernTechSupportAgent
            return ModernTechSupportAgent(self.container)
        elif agent_type == 'research':
            from agents.modern.ModernResearchAgent import ModernResearchAgent
            return ModernResearchAgent(self.container)
        elif agent_type == 'scheduler':
            from agents.modern.ModernSchedulerAgent import ModernSchedulerAgent
            return ModernSchedulerAgent(self.container)
        elif agent_type == 'coordinator':
            from agents.modern.ModernCoordinatorAgent import ModernCoordinatorAgent
            return ModernCoordinatorAgent(self.container)
        else:
            raise ValueError(f"Agent implementation not found: {agent_type}")


class BaseModernAgent:
    """
    Base class for modern agents following architectural principles.
    
    Supports:
    - sourceType awareness (admin/user/group) — adapts system prompt
    - Tool-calling — injects tool descriptions, parses tool_call JSON from response
    - Conversation history
    """
    
    def __init__(self, container, agent_name: str):
        self.container = container
        self.agent_name = agent_name
        self.config = container.resolve('ConfigurationManager')
        self.llm_provider = container.resolve('ILLMProvider')
        self.logger = logging.getLogger(f"agent.{agent_name}")
        
        # Performance metrics (single responsibility)
        self.metrics = {
            'total_calls': 0,
            'successful_calls': 0,
            'total_response_time': 0,
            'confidence_scores': []
        }

    async def process_message(self, message: str, context: Dict = None) -> Dict:
        """Process message using LLM provider abstraction with sourceType and tool support"""
        import asyncio
        import json
        import re
        from core.interfaces.ILLMProvider import LLMMessage
        
        context = context or {}
        start_time = asyncio.get_event_loop().time()
        self.metrics['total_calls'] += 1
        
        try:
            # Get agent-specific system prompt, adapted for source type
            source_type = context.get('sourceType', 'user')
            system_prompt = self._build_full_prompt(source_type)

            # Inject tool descriptions if available
            available_tools = context.get('availableTools', [])
            if available_tools:
                system_prompt += self._build_tool_instructions(available_tools)
            
            # Prepare messages
            messages = [
                LLMMessage(role='system', content=system_prompt),
                LLMMessage(role='user', content=message)
            ]
            
            # Add context if available
            if context.get('history'):
                for hist_msg in context['history'][-2:]:
                    if hist_msg.get('role') and hist_msg.get('message'):
                        messages.insert(-1, LLMMessage(
                            role=hist_msg['role'],
                            content=hist_msg['message']
                        ))
            
            # Generate response
            response = await self.llm_provider.generate_response(
                messages,
                max_tokens=self.config.get('llm.maxTokens', 4096),
                temperature=self.get_temperature()
            )
            
            content = response.content
            tool_calls = []

            # Parse tool calls if tools were available
            if available_tools:
                tool_calls = self._parse_tool_calls(content)
                if tool_calls:
                    content = self._strip_tool_call_json(content)

            # Update metrics
            processing_time = (asyncio.get_event_loop().time() - start_time) * 1000
            self.metrics['successful_calls'] += 1
            self.metrics['total_response_time'] += processing_time
            self.metrics['confidence_scores'].append(0.8)
            
            if len(self.metrics['confidence_scores']) > 100:
                self.metrics['confidence_scores'] = self.metrics['confidence_scores'][-100:]
            
            result = {
                'content': content,
                'tokens_used': response.usage.get('total_tokens', 0),
                'confidence': 0.8,
                'processing_time': processing_time,
                'model': response.model,
                'provider': response.provider
            }

            if tool_calls:
                result['tool_calls'] = tool_calls

            return result
            
        except Exception as e:
            processing_time = (asyncio.get_event_loop().time() - start_time) * 1000
            self.metrics['total_response_time'] += processing_time
            self.logger.error(f"❌ Error processing message in {self.agent_name}: {e}")
            raise

    # ==========================================================
    # PROMPT BUILDING
    # ==========================================================

    def _build_full_prompt(self, source_type: str = 'user') -> str:
        """Build the full system prompt with source-type context prefix"""
        source_context = {
            'admin': "You are talking to the system administrator. Be direct, technical when needed, and proactive. The admin has full access to all capabilities.",
            'user': "You are talking to a regular user in a private WhatsApp chat. Be friendly, professional, and helpful.",
            'group': "You are in a WhatsApp group chat. Keep responses concise since many people can see them. Do not share private information."
        }
        prefix = source_context.get(source_type, source_context['user'])
        base_prompt = self.get_system_prompt()
        return f"{prefix}\n{base_prompt}"

    def _build_tool_instructions(self, available_tools: list) -> str:
        """Build tool-calling instructions to append to the system prompt"""
        tool_list = []
        for tool in available_tools:
            params = tool.get('parameters', {})
            if isinstance(params, dict):
                param_desc = ', '.join(
                    f"{k}: {v.get('description', v.get('type', 'any'))}"
                    for k, v in params.items()
                )
            else:
                param_desc = str(params)
            tool_list.append(f"  - {tool['name']}: {tool.get('description', '')} (params: {param_desc})")

        return f"""

You have access to the following tools. To use a tool, include EXACTLY this JSON on its own line in your response:
{{"tool_call": {{"name": "<tool_name>", "arguments": {{<params>}}}}}}

Available tools:
{chr(10).join(tool_list)}

Only use a tool when the user's request clearly requires it. Otherwise respond normally."""

    # ==========================================================
    # TOOL-CALL PARSING
    # ==========================================================

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
        result = text
        for block in self._extract_json_blocks(text):
            try:
                import json
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

    # ==========================================================
    # OVERRIDABLE METHODS
    # ==========================================================

    def get_system_prompt(self) -> str:
        """Get agent-specific system prompt - override in subclasses"""
        return "You are a helpful AI assistant."
    
    def get_temperature(self) -> float:
        """Get agent-specific temperature - override in subclasses"""
        return self.config.get('llm.temperature', 0.7)
    
    def is_relevant(self, message: str, context: Dict = None) -> tuple:
        """Determine if agent is relevant for message - override in subclasses"""
        return True, 0.5
    
    def get_performance_metrics(self) -> Dict:
        """Get agent performance metrics"""
        avg_response_time = (
            self.metrics['total_response_time'] / max(self.metrics['total_calls'], 1)
        )
        avg_confidence = (
            sum(self.metrics['confidence_scores']) / 
            max(len(self.metrics['confidence_scores']), 1)
        )
        
        return {
            'agent_name': self.agent_name,
            'total_calls': self.metrics['total_calls'],
            'successful_calls': self.metrics['successful_calls'],
            'success_rate': (
                self.metrics['successful_calls'] / max(self.metrics['total_calls'], 1) * 100
            ),
            'average_response_time': avg_response_time,
            'average_confidence': avg_confidence,
            'llm_provider': self.llm_provider.get_provider_name(),
            'llm_model': self.llm_provider.get_model_name()
        }
