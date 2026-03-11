"""
Agent Orchestrator
Central orchestrator for AutoGen multi-agent system

This orchestrator manages:
- Message routing and intent detection
- Agent collaboration and coordination
- Response generation and formatting
- Performance monitoring
"""

import asyncio
import json
import time
from typing import Dict, List, Optional, Any
import logging
from datetime import datetime

import autogen
from autogen import AssistantAgent, UserProxyAgent, GroupChat, GroupChatManager

from agents.customer_support_agent import CustomerSupportAgent
from agents.tech_support_agent import TechSupportAgent
from agents.research_agent import ResearchAgent
from agents.scheduler_agent import SchedulerAgent
from services.intent_classifier import IntentClassifier
from utils.response_formatter import ResponseFormatter

class AgentOrchestrator:
    """
    Central orchestrator for the multi-agent system
    """
    
    def __init__(self, azure_openai_config, logger=None):
        self.azure_openai_config = azure_openai_config
        self.logger = logger or logging.getLogger(__name__)
        
        # Agent configuration
        self.llm_config = azure_openai_config.get_autogen_config()
        self.agents = {}
        self.group_chat = None
        self.manager = None
        
        # Intent classification
        self.intent_classifier = IntentClassifier()
        
        # Response formatting
        self.response_formatter = ResponseFormatter()
        
        # Performance tracking
        self.metrics = {
            'total_requests': 0,
            'successful_responses': 0,
            'failed_responses': 0,
            'average_response_time': 0,
            'total_response_time': 0,
            'agent_usage': {},
            'intent_accuracy': {}
        }
        
        self.logger.info("🤖 Agent Orchestrator initializing...")
    
    async def initialize(self):
        """Initialize all agents and group chat"""
        try:
            # Initialize agents
            self._initialize_agents()
            
            # Setup group chat
            self._setup_group_chat()
            
            self.logger.info("✅ Agent Orchestrator initialized with agents:")
            for agent_name in self.agents.keys():
                self.logger.info(f"   • {agent_name}")
            
        except Exception as e:
            self.logger.error(f"❌ Failed to initialize orchestrator: {e}")
            raise
    
    def _initialize_agents(self):
        """Initialize all agents in the system"""
        
        # 1. User Proxy (represents WhatsApp user)
        self.agents['user_proxy'] = UserProxyAgent(
            name="WhatsAppUser",
            system_message="You represent the WhatsApp user sending messages to the AI assistant.",
            human_input_mode="NEVER",
            max_consecutive_auto_reply=0,
            code_execution_config=False,
        )
        
        # 2. Main Coordinator
        self.agents['coordinator'] = AssistantAgent(
            name="Coordinator",
            system_message=self._get_coordinator_prompt(),
            llm_config=self.llm_config,
        )
        
        # 3. Specialized agents
        self.agents['customer_support'] = CustomerSupportAgent(self.llm_config)
        self.agents['tech_support'] = TechSupportAgent(self.llm_config)
        self.agents['research'] = ResearchAgent(self.llm_config)
        self.agents['scheduler'] = SchedulerAgent(self.llm_config)
        
        self.logger.info(f"🤖 Initialized {len(self.agents)} agents")
    
    def _get_coordinator_prompt(self):
        """Get the system prompt for the main coordinator"""
        return """You are the Main Coordinator for a WhatsApp AI assistant system.

Your Role:
- Analyze incoming messages from WhatsApp users
- Understand user intent and emotional context
- Delegate to appropriate specialized agents when needed
- Synthesize responses from multiple agents
- Provide final, coherent responses to users
- Maintain conversation flow and context

Available Specialized Agents:
1. CustomerSupport - Handle complaints, refunds, general inquiries, billing issues
2. TechSupport - Technical problems, troubleshooting, setup assistance
3. Research - Information lookup, questions, explanations, definitions
4. Scheduler - Appointments, reminders, calendar management

Guidelines:
- For simple greetings or basic questions, respond directly without delegation
- For complex or specialized queries, delegate to appropriate agent(s)
- Always maintain a warm, professional, and helpful tone
- Keep responses concise and WhatsApp-friendly (avoid long paragraphs)
- Use emojis naturally but sparingly
- Consider conversation context and user history
- If unsure about intent, ask clarifying questions
- End conversations naturally when the user's need is fulfilled

Response Format:
- Keep messages under 300 words for WhatsApp
- Use clear, conversational language
- Structure information with bullet points when helpful
- Include relevant emojis to enhance readability

Remember: You're representing the user's personal AI assistant via their WhatsApp. Be authentic, helpful, and trustworthy."""
    
    def _setup_group_chat(self):
        """Setup AutoGen group chat for agent collaboration"""
        
        agent_list = [
            self.agents['user_proxy'],
            self.agents['coordinator'],
            self.agents['customer_support'],
            self.agents['tech_support'],
            self.agents['research'],
            self.agents['scheduler'],
        ]
        
        self.group_chat = GroupChat(
            agents=agent_list,
            messages=[],
            max_round=int(os.getenv('MAX_ROUNDS', '10')),
            speaker_selection_method="auto",
            allow_repeat_speaker=False,
        )
        
        self.manager = GroupChatManager(
            groupchat=self.group_chat,
            llm_config=self.llm_config,
        )
        
        self.logger.info("🗣️ Group chat configured")
    
    async def process_message(self, message: str, context: Dict = None) -> Dict:
        """
        Main entry point for processing messages
        
        Args:
            message: User's message text
            context: Additional context (history, contact info, etc.)
            
        Returns:
            Dict with response and metadata
        """
        start_time = time.time()
        self.metrics['total_requests'] += 1
        
        try:
            # Prepare enriched message with context
            enriched_message = self._prepare_message(message, context or {})
            
            # Classify intent and determine routing strategy
            intent_result = await self.intent_classifier.classify(message, context)
            routing_strategy = self._determine_routing_strategy(intent_result, message)
            
            # Clear previous chat history for fresh conversation
            self.group_chat.messages = []
            
            # Process message based on routing strategy
            if routing_strategy['direct_response']:
                # Handle directly with coordinator
                raw_response = await self._direct_response(enriched_message)
                agent_name = 'coordinator'
            else:
                # Use group chat for complex queries
                raw_response = await self._group_chat_response(enriched_message, routing_strategy)
                agent_name = routing_strategy.get('primary_agent', 'multi_agent')
            
            # Format response for WhatsApp
            formatted_response = self.response_formatter.format_for_whatsapp(raw_response)
            
            # Calculate processing time
            processing_time = (time.time() - start_time) * 1000  # Convert to milliseconds
            
            # Update metrics
            self._update_metrics(agent_name, processing_time, True, intent_result)
            
            # Prepare result
            result = {
                'response': formatted_response,
                'agent_name': agent_name,
                'tokens_used': self._estimate_tokens_used(message, formatted_response),
                'processing_time': processing_time,
                'confidence': intent_result.get('confidence', 0.0),
                'intent': intent_result.get('intent', 'unknown'),
                'routing_strategy': routing_strategy['strategy'],
                'metadata': {
                    'message_length': len(message),
                    'response_length': len(formatted_response),
                    'context_provided': bool(context),
                    'timestamp': datetime.utcnow().isoformat()
                }
            }
            
            self.logger.info(f"✅ Message processed successfully in {processing_time:.0f}ms by {agent_name}")
            self.metrics['successful_responses'] += 1
            
            return result
            
        except Exception as e:
            processing_time = (time.time() - start_time) * 1000
            self._update_metrics('error', processing_time, False)
            
            self.logger.error(f"❌ Error processing message: {e}")
            self.metrics['failed_responses'] += 1
            
            # Return error response
            return {
                'response': self._get_error_response(),
                'agent_name': 'error_handler',
                'tokens_used': 0,
                'processing_time': processing_time,
                'confidence': 0.0,
                'intent': 'error',
                'routing_strategy': 'error',
                'metadata': {
                    'error': str(e),
                    'timestamp': datetime.utcnow().isoformat()
                }
            }
    
    def _prepare_message(self, message: str, context: Dict) -> str:
        """Prepare message with context for agents"""
        if not context:
            return message
        
        # Extract relevant context
        contact_name = context.get('contactName', 'User')
        message_type = context.get('messageType', 'text')
        is_group = context.get('isGroup', False)
        history = context.get('history', [])
        user_profile = context.get('userProfile', {})
        current_time = context.get('currentTime', datetime.utcnow().isoformat())
        
        # Build context string
        context_parts = [f"User Message: {message}"]
        
        # Add user context
        if contact_name and contact_name != 'Unknown':
            context_parts.append(f"User: {contact_name}")
        
        # Add message type if not text
        if message_type != 'text':
            context_parts.append(f"Message Type: {message_type}")
        
        # Add group context
        if is_group:
            group_name = context.get('groupName', 'Unknown Group')
            context_parts.append(f"Group Chat: {group_name}")
        
        # Add conversation history (last few messages)
        if history:
            recent_history = history[-3:]  # Last 3 messages
            history_str = []
            for msg in recent_history:
                role = msg.get('role', 'unknown')
                content = msg.get('message', '')[:100]  # Truncate for brevity
                history_str.append(f"{role.title()}: {content}")
            
            if history_str:
                context_parts.append("Recent conversation:")
                context_parts.extend(history_str)
        
        # Add user profile info
        if user_profile:
            profile_info = []
            if user_profile.get('totalMessages', 0) > 1:
                profile_info.append(f"Total messages: {user_profile['totalMessages']}")
            if user_profile.get('tags'):
                profile_info.append(f"Tags: {', '.join(user_profile['tags'])}")
            
            if profile_info:
                context_parts.append("User info: " + ", ".join(profile_info))
        
        # Add timestamp
        context_parts.append(f"Time: {current_time}")
        
        return "\n".join(context_parts)
    
    def _determine_routing_strategy(self, intent_result: Dict, message: str) -> Dict:
        """Determine how to route the message"""
        
        intent = intent_result.get('intent', 'general')
        confidence = intent_result.get('confidence', 0.0)
        
        # Simple routing rules
        if confidence < 0.3 or intent == 'general' or len(message.split()) < 3:
            return {
                'strategy': 'direct',
                'direct_response': True,
                'reason': 'Low confidence or simple query'
            }
        
        # Map intents to agents
        agent_mapping = {
            'customer_service': 'customer_support',
            'technical_support': 'tech_support',
            'information_request': 'research',
            'scheduling': 'scheduler'
        }
        
        primary_agent = agent_mapping.get(intent)
        
        if primary_agent and confidence > 0.7:
            return {
                'strategy': 'specialized',
                'direct_response': False,
                'primary_agent': primary_agent,
                'confidence': confidence,
                'reason': f'High confidence for {intent}'
            }
        
        # Default to coordinator for medium confidence
        return {
            'strategy': 'coordinator',
            'direct_response': True,
            'confidence': confidence,
            'reason': 'Medium confidence, coordinator handling'
        }
    
    async def _direct_response(self, message: str) -> str:
        """Generate direct response from coordinator"""
        try:
            # Use the coordinator agent directly
            chat_result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.agents['user_proxy'].initiate_chat(
                    self.agents['coordinator'],
                    message=message,
                    max_turns=1,
                    clear_history=True
                )
            )
            
            return self._extract_response(chat_result)
            
        except Exception as e:
            self.logger.error(f"❌ Error in direct response: {e}")
            return self._get_error_response()
    
    async def _group_chat_response(self, message: str, routing_strategy: Dict) -> str:
        """Generate response via group chat collaboration"""
        try:
            # Use group chat manager
            chat_result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.agents['user_proxy'].initiate_chat(
                    self.manager,
                    message=message,
                    clear_history=True,
                )
            )
            
            return self._extract_response(chat_result)
            
        except Exception as e:
            self.logger.error(f"❌ Error in group chat response: {e}")
            return self._get_error_response()
    
    def _extract_response(self, chat_result) -> str:
        """Extract final response from chat result"""
        try:
            # Try to get the last assistant message
            if hasattr(chat_result, 'chat_history') and chat_result.chat_history:
                for msg in reversed(chat_result.chat_history):
                    if isinstance(msg, dict) and msg.get('role') == 'assistant':
                        content = msg.get('content', '')
                        if content.strip():
                            return content.strip()
            
            # Fallback: get from group chat messages
            if self.group_chat.messages:
                last_msg = self.group_chat.messages[-1]
                if isinstance(last_msg, dict):
                    content = last_msg.get('content', '')
                    if content.strip():
                        return content.strip()
                elif hasattr(last_msg, 'content'):
                    return last_msg.content.strip()
                else:
                    return str(last_msg).strip()
            
            return "I apologize, but I couldn't generate a proper response. Could you please try rephrasing your question?"
            
        except Exception as e:
            self.logger.error(f"❌ Error extracting response: {e}")
            return self._get_error_response()
    
    def _get_error_response(self) -> str:
        """Generate user-friendly error message"""
        error_responses = [
            "I apologize, but I'm having trouble processing your message right now. Please try again in a moment.",
            "I'm experiencing some technical difficulties. Could you please rephrase your question?",
            "Sorry, I encountered an error while processing your request. Please try again shortly.",
        ]
        
        import random
        return random.choice(error_responses)
    
    def _estimate_tokens_used(self, input_message: str, output_message: str) -> int:
        """Rough estimation of tokens used"""
        # Rough approximation: 1 token ≈ 4 characters
        input_tokens = len(input_message) // 4
        output_tokens = len(output_message) // 4
        return input_tokens + output_tokens
    
    def _update_metrics(self, agent_name: str, processing_time: float, success: bool, intent_result: Dict = None):
        """Update performance metrics"""
        # Update agent usage
        if agent_name not in self.metrics['agent_usage']:
            self.metrics['agent_usage'][agent_name] = {
                'calls': 0,
                'success': 0,
                'total_time': 0,
                'avg_time': 0
            }
        
        agent_metrics = self.metrics['agent_usage'][agent_name]
        agent_metrics['calls'] += 1
        agent_metrics['total_time'] += processing_time
        agent_metrics['avg_time'] = agent_metrics['total_time'] / agent_metrics['calls']
        
        if success:
            agent_metrics['success'] += 1
        
        # Update overall response time
        self.metrics['total_response_time'] += processing_time
        self.metrics['average_response_time'] = self.metrics['total_response_time'] / self.metrics['total_requests']
    
    async def get_stats(self) -> Dict:
        """Get orchestrator statistics"""
        return {
            'total_requests': self.metrics['total_requests'],
            'successful_responses': self.metrics['successful_responses'],
            'failed_responses': self.metrics['failed_responses'],
            'success_rate': (self.metrics['successful_responses'] / max(self.metrics['total_requests'], 1)) * 100,
            'average_response_time': self.metrics['average_response_time'],
            'agent_usage': self.metrics['agent_usage'],
            'agents_available': list(self.agents.keys()),
            'group_chat_ready': self.group_chat is not None,
            'manager_ready': self.manager is not None
        }
    
    async def get_agent_health(self) -> Dict:
        """Get health status of all agents"""
        health = {}
        
        for name, agent in self.agents.items():
            try:
                health[name] = {
                    'status': 'healthy',
                    'type': type(agent).__name__,
                    'ready': True
                }
            except Exception as e:
                health[name] = {
                    'status': 'unhealthy',
                    'error': str(e),
                    'ready': False
                }
        
        return health
    
    async def reset_agents(self):
        """Reset all agents and metrics"""
        try:
            # Clear group chat history
            if self.group_chat:
                self.group_chat.messages = []
            
            # Reset metrics
            self.metrics = {
                'total_requests': 0,
                'successful_responses': 0,
                'failed_responses': 0,
                'average_response_time': 0,
                'total_response_time': 0,
                'agent_usage': {},
                'intent_accuracy': {}
            }
            
            self.logger.info("🔄 Agents and metrics reset")
            
        except Exception as e:
            self.logger.error(f"❌ Error resetting agents: {e}")
            raise
    
    async def cleanup(self):
        """Cleanup resources"""
        try:
            # Clear group chat
            if self.group_chat:
                self.group_chat.messages = []
            
            # Close any open connections
            if hasattr(self.claude_config, 'cleanup'):
                await self.claude_config.cleanup()
            
            self.logger.info("🧹 Orchestrator cleaned up")
            
        except Exception as e:
            self.logger.error(f"❌ Error during cleanup: {e}")

import os
