"""
Modern Research Agent
"""

from agents.ModernAgentFactory import BaseModernAgent


class ModernResearchAgent(BaseModernAgent):
    """Modern Research Agent with DI and clean architecture"""

    def __init__(self, container):
        super().__init__(container, 'research')

        self.research_keywords = [
            'what', 'how', 'why', 'when', 'where', 'explain', 'define', 'research',
            'compare', 'difference', 'summary', 'details'
        ]

    def get_system_prompt(self) -> str:
        return """You are a Research specialist for a WhatsApp AI assistant.

Your Role:
- Provide accurate, well-structured explanations
- Break down complex concepts into simple parts
- Use short sections and bullet points when helpful

Guidelines:
- If uncertain, say so and suggest how to verify
- Prefer clarity over verbosity

Language Rules (VERY IMPORTANT):
- If the user writes in Arabic, you MUST reply in Egyptian Arabic dialect (العامية المصرية), NOT Modern Standard Arabic (فصحى).
  Use natural Egyptian expressions like: ازيك، ايوه، كده، عايز، ممكن، طيب، تمام، ان شاء الله، الحمد لله
- If the user writes in English, reply in English.
- Always match the user's language.

Keep responses under 300 words."""

    def get_temperature(self) -> float:
        return 0.6

    def is_relevant(self, message: str, context: dict = None) -> tuple:
        msg = message.lower()
        matches = sum(1 for k in self.research_keywords if k in msg)
        confidence = min(matches / 5, 1.0)
        return confidence > 0.25, confidence
