"""
Modern Customer Support Agent
Refactored to follow all architectural principles
"""

from agents.ModernAgentFactory import BaseModernAgent

class ModernCustomerSupportAgent(BaseModernAgent):
    """Modern Customer Support Agent with DI and clean architecture"""
    
    def __init__(self, container):
        super().__init__(container, 'customer_support')
        
        # Customer support specific keywords
        self.support_keywords = [
            'complaint', 'problem', 'issue', 'refund', 'return', 'billing',
            'order', 'delivery', 'frustrated', 'angry', 'help', 'support'
        ]

    def get_system_prompt(self) -> str:
        """Customer support specific system prompt"""
        return """You are a Customer Support specialist for a WhatsApp AI assistant.

Your Role:
- Handle customer service inquiries with empathy and professionalism
- Resolve complaints and issues effectively
- Process refund and return requests
- Assist with billing and payment questions
- Provide order status and tracking information

Communication Style:
- Empathetic and understanding
- Professional yet warm
- Solution-focused
- Clear and concise
- Patient with frustrated customers

Response Guidelines:
1. Acknowledge the customer's concern immediately
2. Express empathy for their situation
3. Provide clear, actionable solutions
4. Set realistic expectations
5. Always offer additional assistance

Language Rules (VERY IMPORTANT):
- If the user writes in Arabic, you MUST reply in Egyptian Arabic dialect (العامية المصرية), NOT Modern Standard Arabic (فصحى).
  Use natural Egyptian expressions like: ازيك، ايوه، كده، عايز، ممكن، طيب، تمام، ان شاء الله، الحمد لله
- If the user writes in English, reply in English.
- Always match the user's language.

Keep responses under 300 words for WhatsApp. Use a helpful, professional tone."""

    def get_temperature(self) -> float:
        """Lower temperature for consistent, professional responses"""
        return 0.5

    def is_relevant(self, message: str, context: dict = None) -> tuple:
        """Check if message is relevant to customer support"""
        message_lower = message.lower()
        
        # Count keyword matches
        matches = sum(1 for keyword in self.support_keywords if keyword in message_lower)
        
        # Check for complaint patterns
        complaint_patterns = [
            'i have a problem', 'this is wrong', 'i want a refund',
            'terrible service', 'not working', 'frustrated'
        ]
        
        pattern_matches = sum(1 for pattern in complaint_patterns if pattern in message_lower)
        
        # Calculate relevance score
        total_score = matches + (pattern_matches * 2)  # Weight patterns higher
        max_possible = len(self.support_keywords) + (len(complaint_patterns) * 2)
        
        confidence = min(total_score / max(max_possible * 0.3, 1), 1.0)  # 30% threshold
        
        is_relevant = confidence > 0.3
        
        return is_relevant, confidence
