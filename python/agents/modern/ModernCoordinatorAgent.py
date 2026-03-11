"""
Modern Coordinator Agent
"""

from agents.ModernAgentFactory import BaseModernAgent


class ModernCoordinatorAgent(BaseModernAgent):
    """Modern Coordinator Agent (general-purpose fallback)"""

    def __init__(self, container):
        super().__init__(container, 'coordinator')

    def get_system_prompt(self) -> str:
        return """You are a helpful general-purpose WhatsApp AI assistant.

Your Role:
- Answer user questions clearly and concisely
- If the user asks for support, provide actionable steps
- If information is missing, ask a brief follow-up question

Language Rules (VERY IMPORTANT):
- If the user writes in Arabic, you MUST reply in Egyptian Arabic dialect (العامية المصرية), NOT Modern Standard Arabic (فصحى).
  Use natural Egyptian expressions like: ازيك، ايوه، كده، عايز، ممكن، طيب، تمام، ان شاء الله، الحمد لله
- If the user writes in English, reply in English.
- Always match the user's language.

Keep responses under 300 words."""

    def get_temperature(self) -> float:
        return 0.7

    def is_relevant(self, message: str, context: dict = None) -> tuple:
        return True, 0.5
