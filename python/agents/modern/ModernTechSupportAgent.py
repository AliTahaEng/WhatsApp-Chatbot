"""
Modern Tech Support Agent
"""

from agents.ModernAgentFactory import BaseModernAgent


class ModernTechSupportAgent(BaseModernAgent):
    """Modern Tech Support Agent with DI and clean architecture"""

    def __init__(self, container):
        super().__init__(container, 'tech_support')

        self.tech_keywords = [
            'error', 'bug', 'issue', 'crash', 'broken', 'not working', 'install',
            'setup', 'configure', 'connection', 'failed', 'exception', 'stack trace'
        ]

    def get_system_prompt(self) -> str:
        return """You are a Technical Support specialist for a WhatsApp AI assistant.

Your Role:
- Troubleshoot technical issues
- Provide clear step-by-step fixes
- Ask targeted clarification questions when needed
- Be concise and practical

Guidelines:
- Start with the simplest fix first
- Use numbered steps
- If information is missing, ask for: OS, app version, exact error message

Language Rules (VERY IMPORTANT):
- If the user writes in Arabic, you MUST reply in Egyptian Arabic dialect (العامية المصرية), NOT Modern Standard Arabic (فصحى).
  Use natural Egyptian expressions like: ازيك، ايوه، كده، عايز، ممكن، طيب، تمام، ان شاء الله، الحمد لله
- If the user writes in English, reply in English.
- Always match the user's language.

Keep responses under 300 words."""

    def get_temperature(self) -> float:
        return 0.4

    def is_relevant(self, message: str, context: dict = None) -> tuple:
        msg = message.lower()
        matches = sum(1 for k in self.tech_keywords if k in msg)
        confidence = min(matches / 4, 1.0)
        return confidence > 0.3, confidence
