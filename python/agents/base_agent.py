"""
Base Agent
Base class for all specialized agents in the AutoGen system
"""

import time
from typing import Tuple, Dict, Any, List
from autogen import AssistantAgent
import logging

class BaseSpecializedAgent(AssistantAgent):
    """Base class for all specialized agents"""
    
    def __init__(self, name: str, system_message: str, llm_config: Dict, tools: Dict = None):
        super().__init__(
            name=name,
            system_message=system_message,
            llm_config=llm_config,
            function_map=tools or {}
        )
        
        self.agent_type = name
        self.conversation_history = []
        self.performance_metrics = {
            'total_calls': 0,
            'successful_responses': 0,
            'failed_responses': 0,
            'average_response_time': 0,
            'total_response_time': 0,
            'confidence_scores': []
        }
        
        self.logger = logging.getLogger(f"agent.{name}")
    
    def is_relevant(self, message: str, context: Dict = None) -> Tuple[bool, float]:
        """
        Determine if this agent should handle the message
        
        Returns:
            (is_relevant: bool, confidence: float)
        """
        raise NotImplementedError("Subclasses must implement is_relevant method")
    
    def log_interaction(self, message: str, response: str, success: bool, response_time: float = 0):
        """Log agent interaction for analytics"""
        self.performance_metrics['total_calls'] += 1
        self.performance_metrics['total_response_time'] += response_time
        
        if success:
            self.performance_metrics['successful_responses'] += 1
        else:
            self.performance_metrics['failed_responses'] += 1
        
        # Update average response time
        if self.performance_metrics['total_calls'] > 0:
            self.performance_metrics['average_response_time'] = (
                self.performance_metrics['total_response_time'] / 
                self.performance_metrics['total_calls']
            )
        
        # Log the interaction
        self.logger.debug(f"Interaction logged: success={success}, time={response_time:.2f}ms")
    
    def add_confidence_score(self, score: float):
        """Add confidence score for tracking accuracy"""
        self.performance_metrics['confidence_scores'].append(score)
        
        # Keep only last 100 scores
        if len(self.performance_metrics['confidence_scores']) > 100:
            self.performance_metrics['confidence_scores'].pop(0)
    
    def get_performance_metrics(self) -> Dict[str, Any]:
        """Get agent performance metrics"""
        confidence_scores = self.performance_metrics['confidence_scores']
        avg_confidence = sum(confidence_scores) / len(confidence_scores) if confidence_scores else 0
        
        return {
            'agent_name': self.agent_type,
            'total_calls': self.performance_metrics['total_calls'],
            'successful_responses': self.performance_metrics['successful_responses'],
            'failed_responses': self.performance_metrics['failed_responses'],
            'success_rate': (
                self.performance_metrics['successful_responses'] / 
                max(self.performance_metrics['total_calls'], 1) * 100
            ),
            'average_response_time': self.performance_metrics['average_response_time'],
            'average_confidence': avg_confidence,
            'confidence_samples': len(confidence_scores)
        }
    
    def reset_metrics(self):
        """Reset performance metrics"""
        self.performance_metrics = {
            'total_calls': 0,
            'successful_responses': 0,
            'failed_responses': 0,
            'average_response_time': 0,
            'total_response_time': 0,
            'confidence_scores': []
        }
        self.logger.info(f"Metrics reset for {self.agent_type}")
    
    def get_system_message_with_context(self, context: Dict = None) -> str:
        """Get system message enhanced with context"""
        base_message = self.system_message
        
        if not context:
            return base_message
        
        # Add contextual information
        context_additions = []
        
        # Add user information
        user_profile = context.get('userProfile', {})
        if user_profile.get('name'):
            context_additions.append(f"User's name: {user_profile['name']}")
        
        # Add conversation history context
        history = context.get('history', [])
        if history:
            context_additions.append(f"This conversation has {len(history)} previous messages")
        
        # Add time context
        current_time = context.get('currentTime')
        if current_time:
            context_additions.append(f"Current time: {current_time}")
        
        # Combine with base message
        if context_additions:
            enhanced_message = base_message + "\n\nAdditional Context:\n" + "\n".join(context_additions)
            return enhanced_message
        
        return base_message
    
    def extract_keywords(self, message: str) -> List[str]:
        """Extract keywords from message for relevance checking"""
        # Simple keyword extraction
        import re
        
        # Remove punctuation and convert to lowercase
        cleaned = re.sub(r'[^\w\s]', '', message.lower())
        
        # Split into words and filter out common stop words
        stop_words = {
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 
            'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
            'before', 'after', 'above', 'below', 'between', 'among', 'i', 'you', 
            'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
            'my', 'your', 'his', 'her', 'its', 'our', 'their', 'this', 'that',
            'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been',
            'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
            'could', 'should', 'may', 'might', 'must', 'can'
        }
        
        words = [word for word in cleaned.split() if word not in stop_words and len(word) > 2]
        return words
    
    def calculate_keyword_relevance(self, message: str, relevant_keywords: List[str]) -> float:
        """Calculate relevance score based on keyword matching"""
        message_keywords = self.extract_keywords(message)
        
        if not message_keywords or not relevant_keywords:
            return 0.0
        
        # Count matches
        matches = sum(1 for keyword in message_keywords if keyword in relevant_keywords)
        
        # Calculate relevance score
        relevance = matches / len(message_keywords)
        return min(relevance, 1.0)
    
    def format_response(self, response: str) -> str:
        """Format response for WhatsApp compatibility"""
        # Remove excessive whitespace
        response = ' '.join(response.split())
        
        # Ensure reasonable length for WhatsApp
        max_length = 1500  # WhatsApp practical limit
        if len(response) > max_length:
            # Try to truncate at sentence boundary
            sentences = response.split('. ')
            truncated = ""
            for sentence in sentences:
                if len(truncated + sentence) < max_length - 20:
                    truncated += sentence + ". "
                else:
                    break
            
            if truncated:
                response = truncated.strip()
            else:
                response = response[:max_length-20] + "..."
        
        return response.strip()
