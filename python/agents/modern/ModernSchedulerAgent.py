"""
Modern Scheduler Agent
"""

from agents.ModernAgentFactory import BaseModernAgent


class ModernSchedulerAgent(BaseModernAgent):
    """Modern Scheduler Agent with DI and clean architecture"""

    def __init__(self, container):
        super().__init__(container, 'scheduler')

        self.scheduler_keywords = [
            'schedule', 'appointment', 'meeting', 'calendar', 'remind', 'reminder',
            'book', 'reschedule', 'cancel', 'availability', 'time'
        ]

    def get_system_prompt(self) -> str:
        return """You are a Scheduling specialist for a WhatsApp AI assistant.

Your Role:
- Help schedule, reschedule, or cancel appointments
- Collect missing details: date, time, timezone, duration, location/format

Guidelines:
- Confirm details back to the user
- Propose 2-3 time options if user is flexible

Language Rules (VERY IMPORTANT):
- If the user writes in Arabic, you MUST reply in Egyptian Arabic dialect (العامية المصرية), NOT Modern Standard Arabic (فصحى).
  Use natural Egyptian expressions like: ازيك، ايوه، كده، عايز، ممكن، طيب، تمام، ان شاء الله، الحمد لله
- If the user writes in English, reply in English.
- Always match the user's language.

Keep responses under 300 words."""

    def get_temperature(self) -> float:
        return 0.5

    def is_relevant(self, message: str, context: dict = None) -> tuple:
        msg = message.lower()
        matches = sum(1 for k in self.scheduler_keywords if k in msg)
        confidence = min(matches / 3, 1.0)
        return confidence > 0.3, confidence
