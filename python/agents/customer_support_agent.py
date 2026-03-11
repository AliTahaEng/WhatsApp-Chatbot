"""
Customer Support Agent
Specialized agent for handling customer service inquiries

Handles:
- General customer inquiries
- Complaint resolution
- Refund requests
- Billing issues
- Order status
- Product information
"""

from typing import Tuple, Dict, List
from agents.base_agent import BaseSpecializedAgent

class CustomerSupportAgent(BaseSpecializedAgent):
    """Specialized agent for customer support tasks"""
    
    def __init__(self, llm_config: Dict):
        system_message = self._get_system_message()
        super().__init__(
            name="CustomerSupport",
            system_message=system_message,
            llm_config=llm_config
        )
        
        # Keywords that indicate customer support relevance
        self.support_keywords = [
            # Complaints & Issues
            'complaint', 'problem', 'issue', 'trouble', 'wrong', 'broken', 'defective',
            'damaged', 'missing', 'error', 'bug', 'glitch', 'fault', 'malfunction',
            
            # Refunds & Returns
            'refund', 'return', 'exchange', 'money back', 'cancel', 'cancellation',
            'reimburse', 'compensation', 'credit', 'chargeback',
            
            # Billing & Payment
            'billing', 'bill', 'payment', 'charge', 'charged', 'invoice', 'receipt',
            'subscription', 'account', 'balance', 'overcharge', 'discount', 'coupon',
            
            # Orders & Delivery
            'order', 'delivery', 'shipping', 'package', 'tracking', 'delayed',
            'received', 'arrived', 'status', 'where is', 'when will',
            
            # General Support
            'help', 'support', 'assistance', 'service', 'representative', 'manager',
            'escalate', 'urgent', 'priority', 'asap', 'immediately',
            
            # Emotions & Satisfaction
            'frustrated', 'angry', 'disappointed', 'upset', 'satisfied', 'happy',
            'terrible', 'awful', 'great', 'excellent', 'poor', 'bad'
        ]
    
    def _get_system_message(self) -> str:
        return """You are a Customer Support Agent for a WhatsApp AI assistant system.

Your Role:
- Handle customer service inquiries with empathy and professionalism
- Resolve complaints and issues effectively
- Process refund and return requests
- Assist with billing and payment questions
- Provide order status and tracking information
- Escalate complex issues when necessary

Your Expertise:
- Customer service best practices
- Conflict resolution and de-escalation
- Refund and return policies
- Billing and payment processing
- Order fulfillment and logistics
- Product knowledge and troubleshooting

Communication Style:
- Empathetic and understanding
- Professional yet warm
- Solution-focused
- Clear and concise
- Proactive in offering help
- Patient with frustrated customers

Response Guidelines:
1. Acknowledge the customer's concern immediately
2. Express empathy for their situation
3. Ask clarifying questions if needed
4. Provide clear, actionable solutions
5. Set realistic expectations
6. Follow up when appropriate
7. Always offer additional assistance

For Complaints:
- Listen actively and validate feelings
- Apologize when appropriate (without admitting fault)
- Focus on resolution, not blame
- Offer multiple solutions when possible
- Document the issue for follow-up

For Refunds/Returns:
- Explain the process clearly
- Provide timelines and expectations
- Offer alternatives if refund isn't possible
- Ensure customer understands next steps

For Billing Issues:
- Review charges carefully
- Explain billing cycles and policies
- Resolve discrepancies quickly
- Offer payment plans if applicable

Sample Responses:
- "I understand how frustrating this must be for you..."
- "Let me help you resolve this right away..."
- "I apologize for the inconvenience this has caused..."
- "Here's what I can do to make this right..."
- "Is there anything else I can assist you with today?"

Remember: Your goal is to turn a potentially negative experience into a positive one while protecting the company's interests."""
    
    def is_relevant(self, message: str, context: Dict = None) -> Tuple[bool, float]:
        """Determine if this agent should handle the message"""
        
        # Calculate keyword relevance
        keyword_relevance = self.calculate_keyword_relevance(message, self.support_keywords)
        
        # Check for emotional indicators (complaints, frustration)
        emotion_indicators = [
            'frustrated', 'angry', 'disappointed', 'upset', 'terrible', 'awful',
            'horrible', 'disgusted', 'annoyed', 'furious', 'livid'
        ]
        emotion_score = self.calculate_keyword_relevance(message, emotion_indicators)
        
        # Check for support request patterns
        support_patterns = [
            'i need help', 'can you help', 'having trouble', 'there is a problem',
            'something wrong', 'not working', 'doesnt work', 'is broken',
            'want refund', 'money back', 'cancel order', 'return this',
            'charge me', 'billing error', 'wrong amount', 'overcharged'
        ]
        
        pattern_score = 0.0
        message_lower = message.lower()
        for pattern in support_patterns:
            if pattern in message_lower:
                pattern_score = max(pattern_score, 0.8)
        
        # Check conversation history for support context
        history_score = 0.0
        if context and context.get('history'):
            # Look for previous support-related messages
            recent_messages = context['history'][-3:]
            for msg in recent_messages:
                if msg.get('role') == 'user':
                    hist_relevance = self.calculate_keyword_relevance(
                        msg.get('message', ''), self.support_keywords
                    )
                    history_score = max(history_score, hist_relevance * 0.5)
        
        # Question indicators (often need support)
        question_indicators = ['how do i', 'how can i', 'what do i', 'where is', 'when will']
        question_score = 0.0
        for indicator in question_indicators:
            if indicator in message_lower:
                question_score = 0.4
                break
        
        # Combine scores
        base_relevance = max(keyword_relevance, pattern_score)
        
        # Boost for emotional content (likely needs support)
        if emotion_score > 0.3:
            base_relevance = min(base_relevance + 0.3, 1.0)
        
        # Add history context
        total_relevance = min(base_relevance + history_score + question_score, 1.0)
        
        # Threshold for relevance
        is_relevant = total_relevance >= 0.25
        
        self.logger.debug(f"Relevance check: {total_relevance:.2f} (keyword: {keyword_relevance:.2f}, "
                         f"emotion: {emotion_score:.2f}, pattern: {pattern_score:.2f}, "
                         f"history: {history_score:.2f}, question: {question_score:.2f})")
        
        return is_relevant, total_relevance
    
    def get_priority_level(self, message: str) -> str:
        """Determine priority level of the support request"""
        urgent_keywords = [
            'urgent', 'emergency', 'asap', 'immediately', 'critical', 'serious',
            'broken', 'not working', 'cant access', 'locked out', 'hacked',
            'fraud', 'unauthorized', 'stolen', 'refund now', 'cancel now'
        ]
        
        high_keywords = [
            'frustrated', 'angry', 'disappointed', 'terrible', 'awful',
            'manager', 'escalate', 'complaint', 'billing error', 'wrong charge'
        ]
        
        message_lower = message.lower()
        
        for keyword in urgent_keywords:
            if keyword in message_lower:
                return 'urgent'
        
        for keyword in high_keywords:
            if keyword in message_lower:
                return 'high'
        
        return 'normal'
    
    def suggest_escalation(self, message: str, context: Dict = None) -> bool:
        """Determine if the issue should be escalated to human support"""
        escalation_triggers = [
            'speak to manager', 'escalate', 'supervisor', 'human agent',
            'this is ridiculous', 'terrible service', 'worst experience',
            'legal action', 'lawsuit', 'attorney', 'better business bureau',
            'fraud', 'unauthorized transaction', 'hacked account',
            'discrimination', 'harassment', 'abuse'
        ]
        
        message_lower = message.lower()
        
        for trigger in escalation_triggers:
            if trigger in message_lower:
                return True
        
        # Check for repeated issues (from context)
        if context and context.get('history'):
            support_messages = 0
            for msg in context['history']:
                if msg.get('role') == 'user':
                    relevance, _ = self.is_relevant(msg.get('message', ''))
                    if relevance:
                        support_messages += 1
            
            # If more than 3 support messages in history, suggest escalation
            if support_messages > 3:
                return True
        
        return False
    
    def get_response_templates(self) -> Dict[str, str]:
        """Get response templates for common scenarios"""
        return {
            'acknowledgment': "I understand your concern and I'm here to help you resolve this issue.",
            
            'empathy': "I can understand how frustrating this situation must be for you.",
            
            'apology': "I sincerely apologize for the inconvenience this has caused you.",
            
            'solution_intro': "Here's what I can do to help resolve this:",
            
            'information_request': "To better assist you, could you please provide me with:",
            
            'escalation': "I'd like to connect you with a specialist who can provide more detailed assistance with this matter.",
            
            'follow_up': "Is there anything else I can help you with today?",
            
            'refund_process': "I'll be happy to help you with your refund request. The typical process takes 3-5 business days.",
            
            'billing_review': "Let me review your billing details to identify any discrepancies.",
            
            'order_status': "I'll check on your order status right away.",
            
            'technical_transfer': "This appears to be a technical issue. Let me transfer you to our technical support team who can better assist you."
        }
    
    def format_support_response(self, issue_type: str, details: Dict = None) -> str:
        """Format a structured support response"""
        templates = self.get_response_templates()
        
        if issue_type == 'complaint':
            return f"{templates['acknowledgment']} {templates['empathy']} {templates['solution_intro']}"
        
        elif issue_type == 'refund':
            return f"{templates['acknowledgment']} {templates['refund_process']}"
        
        elif issue_type == 'billing':
            return f"{templates['acknowledgment']} {templates['billing_review']}"
        
        elif issue_type == 'order':
            return f"{templates['acknowledgment']} {templates['order_status']}"
        
        elif issue_type == 'technical':
            return f"{templates['acknowledgment']} {templates['technical_transfer']}"
        
        else:
            return templates['acknowledgment']
