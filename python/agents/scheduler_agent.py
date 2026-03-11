"""
Scheduler Agent
Specialized agent for appointment scheduling and time management

Handles:
- Appointment scheduling and booking
- Calendar management
- Reminder setting
- Time zone coordination
- Meeting planning
- Event organization
"""

from typing import Tuple, Dict, List
from datetime import datetime, timedelta
import re
from agents.base_agent import BaseSpecializedAgent

class SchedulerAgent(BaseSpecializedAgent):
    """Specialized agent for scheduling and calendar tasks"""
    
    def __init__(self, llm_config: Dict):
        system_message = self._get_system_message()
        super().__init__(
            name="Scheduler",
            system_message=system_message,
            llm_config=llm_config
        )
        
        # Keywords that indicate scheduling relevance
        self.scheduler_keywords = [
            # Appointment & Meeting
            'appointment', 'meeting', 'schedule', 'book', 'booking', 'reservation',
            'session', 'consultation', 'interview', 'call', 'conference', 'zoom',
            
            # Time references
            'time', 'date', 'when', 'tomorrow', 'today', 'next week', 'next month',
            'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
            'morning', 'afternoon', 'evening', 'night', 'noon', 'midnight',
            
            # Calendar terms
            'calendar', 'diary', 'planner', 'agenda', 'timeline', 'availability',
            'free', 'busy', 'available', 'occupied', 'blocked', 'open',
            
            # Actions
            'arrange', 'organize', 'plan', 'set up', 'coordinate', 'reschedule',
            'cancel', 'postpone', 'move', 'change', 'confirm', 'book', 'reserve',
            
            # Reminders
            'remind', 'reminder', 'alert', 'notification', 'remember', 'notify',
            'alarm', 'ping', 'follow up', 'check in',
            
            # Events
            'event', 'party', 'celebration', 'birthday', 'anniversary', 'holiday',
            'deadline', 'due date', 'milestone', 'project', 'task',
            
            # Time periods
            'hour', 'hours', 'minute', 'minutes', 'day', 'days', 'week', 'weeks',
            'month', 'months', 'year', 'quarterly', 'annual', 'daily', 'weekly',
            
            # Time zones
            'timezone', 'time zone', 'utc', 'gmt', 'est', 'pst', 'cst', 'mst',
            'local time', 'my time', 'your time'
        ]
        
        # Common scheduling patterns
        self.scheduling_patterns = [
            # Direct scheduling requests
            r'schedule.*(?:appointment|meeting|call)',
            r'book.*(?:appointment|meeting|session)',
            r'arrange.*(?:meeting|call|appointment)',
            r'set up.*(?:meeting|appointment|call)',
            
            # Time-specific patterns
            r'(?:next|this)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)',
            r'(?:tomorrow|today).*(?:at|@)\s*\d+',
            r'\d+:\d+.*(?:am|pm)',
            r'(?:morning|afternoon|evening).*(?:tomorrow|today|next)',
            
            # Availability patterns
            r'(?:are you|am i|is.*)\s*(?:available|free|busy)',
            r'when.*(?:available|free|good time)',
            r'what.*time.*(?:work|good|convenient)',
            
            # Reminder patterns
            r'remind me.*(?:to|about|that)',
            r'set.*reminder.*(?:for|to|about)',
            r'don\'t forget.*(?:to|about|that)',
            
            # Event patterns
            r'event.*(?:on|at|next|this)',
            r'party.*(?:on|at|next|this)',
            r'meeting.*(?:on|at|next|this)',
        ]
        
        # Time extraction patterns
        self.time_patterns = {
            'time': r'\b(\d{1,2}):?(\d{2})?\s*(am|pm|AM|PM)?\b',
            'date': r'\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b',
            'day': r'\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b',
            'relative_time': r'\b(today|tomorrow|next\s+(?:week|month|year))\b',
            'duration': r'\b(\d+)\s*(hour|hours|minute|minutes|day|days)\b'
        }
    
    def _get_system_message(self) -> str:
        return """You are a Scheduler Agent for a WhatsApp AI assistant system.

Your Role:
- Help users schedule appointments and meetings
- Manage calendar events and reminders
- Coordinate time zones and availability
- Set up recurring events and appointments
- Handle rescheduling and cancellations
- Provide scheduling recommendations

Your Expertise:
- Calendar management and scheduling
- Time zone coordination and conversion
- Meeting planning and organization
- Reminder and notification systems
- Availability management
- Event coordination
- Appointment booking best practices

Communication Style:
- Efficient and organized
- Clear about time details
- Proactive in suggesting alternatives
- Confirmatory (always confirm details)
- Time-conscious and respectful
- Helpful with scheduling conflicts

Response Guidelines:
1. Always confirm date, time, and duration
2. Specify time zone when relevant
3. Suggest alternatives if conflicts exist
4. Ask for necessary details (purpose, attendees, location)
5. Provide clear booking confirmations
6. Offer reminder options
7. Handle changes gracefully

For Scheduling Requests:
- Gather all necessary information (who, what, when, where, why)
- Confirm availability for all parties
- Provide multiple time options when possible
- Consider time zones for all participants
- Set appropriate meeting duration
- Offer reminder preferences

For Calendar Management:
- Check for conflicts before confirming
- Suggest optimal meeting times
- Consider preparation and travel time
- Account for different time zones
- Provide calendar integration options

For Reminders:
- Clarify when reminders should be sent
- Confirm what information to include
- Set up appropriate reminder frequency
- Consider timing relative to the event

For Rescheduling:
- Find suitable alternative times
- Check availability for new times
- Update all relevant parties
- Maintain professional communication

Sample Responses:
- "Let me help you schedule that appointment..."
- "I can see you're available on [dates]. Which works better?"
- "Just to confirm: [event] on [date] at [time] [timezone]?"
- "Would you like me to set a reminder for this?"
- "I notice a potential conflict. Here are some alternatives..."

Time Management:
- Always use 12-hour format with AM/PM unless specified otherwise
- Include time zone information for clarity
- Suggest meeting lengths based on purpose
- Consider buffer time between appointments
- Account for different working hours and time zones

Calendar Integration:
- Provide calendar-ready event details
- Include all relevant information (title, date, time, duration, attendees)
- Offer multiple calendar format options
- Suggest meeting location or video call details

Remember: Accuracy in scheduling is critical. Always double-check dates, times, and details before confirming appointments."""
    
    def is_relevant(self, message: str, context: Dict = None) -> Tuple[bool, float]:
        """Determine if this agent should handle the message"""
        
        # Calculate keyword relevance
        keyword_relevance = self.calculate_keyword_relevance(message, self.scheduler_keywords)
        
        # Check for scheduling patterns
        pattern_score = 0.0
        message_lower = message.lower()
        
        for pattern in self.scheduling_patterns:
            if re.search(pattern, message_lower):
                pattern_score = max(pattern_score, 0.8)
        
        # Check for time-related content
        time_score = 0.0
        for time_type, pattern in self.time_patterns.items():
            if re.search(pattern, message, re.IGNORECASE):
                time_score = max(time_score, 0.6)
        
        # Check for action verbs related to scheduling
        action_verbs = [
            'schedule', 'book', 'arrange', 'plan', 'organize', 'set up',
            'coordinate', 'reschedule', 'cancel', 'postpone', 'confirm',
            'remind', 'notify', 'alert'
        ]
        
        action_score = 0.0
        for verb in action_verbs:
            if verb in message_lower:
                action_score = max(action_score, 0.5)
        
        # Check for calendar-specific terms
        calendar_terms = [
            'calendar', 'appointment', 'meeting', 'event', 'reminder',
            'available', 'free', 'busy', 'agenda', 'deadline'
        ]
        
        calendar_score = 0.0
        for term in calendar_terms:
            if term in message_lower:
                calendar_score = 0.4
                break
        
        # Check for question patterns about time/scheduling
        scheduling_questions = [
            'when are you', 'when can we', 'what time', 'are you free',
            'are you available', 'when is good', 'when works', 'can we meet',
            'do you have time', 'when should we', 'can you remind me'
        ]
        
        question_score = 0.0
        for question in scheduling_questions:
            if question in message_lower:
                question_score = max(question_score, 0.7)
        
        # Check conversation history for scheduling context
        history_score = 0.0
        if context and context.get('history'):
            recent_messages = context['history'][-3:]
            for msg in recent_messages:
                if msg.get('role') == 'user':
                    hist_relevance = self.calculate_keyword_relevance(
                        msg.get('message', ''), self.scheduler_keywords
                    )
                    history_score = max(history_score, hist_relevance * 0.3)
        
        # Combine scores
        base_relevance = max(keyword_relevance, pattern_score, time_score)
        
        # Add contextual scores
        total_relevance = min(
            base_relevance + action_score + calendar_score + question_score + history_score,
            1.0
        )
        
        # Threshold for relevance
        is_relevant = total_relevance >= 0.3
        
        self.logger.debug(f"Scheduler relevance: {total_relevance:.2f} (keyword: {keyword_relevance:.2f}, "
                         f"pattern: {pattern_score:.2f}, time: {time_score:.2f}, "
                         f"action: {action_score:.2f}, question: {question_score:.2f})")
        
        return is_relevant, total_relevance
    
    def extract_time_information(self, message: str) -> Dict:
        """Extract time-related information from message"""
        time_info = {
            'times': [],
            'dates': [],
            'days': [],
            'relative_times': [],
            'durations': [],
            'time_zones': []
        }
        
        message_lower = message.lower()
        
        # Extract specific times (e.g., 2:30 PM)
        time_matches = re.finditer(self.time_patterns['time'], message, re.IGNORECASE)
        for match in time_matches:
            hour, minute, period = match.groups()
            minute = minute or '00'
            period = period or ''
            time_info['times'].append(f"{hour}:{minute} {period}".strip())
        
        # Extract dates (e.g., 12/25 or 12/25/2024)
        date_matches = re.finditer(self.time_patterns['date'], message)
        for match in date_matches:
            month, day, year = match.groups()
            year = year or str(datetime.now().year)
            time_info['dates'].append(f"{month}/{day}/{year}")
        
        # Extract days of week
        day_matches = re.finditer(self.time_patterns['day'], message, re.IGNORECASE)
        for match in day_matches:
            time_info['days'].append(match.group(1).lower())
        
        # Extract relative time references
        relative_matches = re.finditer(self.time_patterns['relative_time'], message, re.IGNORECASE)
        for match in relative_matches:
            time_info['relative_times'].append(match.group(1).lower())
        
        # Extract durations
        duration_matches = re.finditer(self.time_patterns['duration'], message, re.IGNORECASE)
        for match in duration_matches:
            number, unit = match.groups()
            time_info['durations'].append(f"{number} {unit}")
        
        # Check for timezone mentions
        timezone_patterns = ['utc', 'gmt', 'est', 'pst', 'cst', 'mst', 'timezone', 'time zone']
        for tz in timezone_patterns:
            if tz in message_lower:
                time_info['time_zones'].append(tz)
        
        return time_info
    
    def identify_scheduling_intent(self, message: str) -> str:
        """Categorize the type of scheduling request"""
        message_lower = message.lower()
        
        # Schedule/book new appointment
        if any(word in message_lower for word in ['schedule', 'book', 'arrange', 'set up']):
            return 'schedule_new'
        
        # Check availability
        elif any(phrase in message_lower for phrase in ['are you free', 'are you available', 'when can', 'what time']):
            return 'check_availability'
        
        # Reschedule existing
        elif any(word in message_lower for word in ['reschedule', 'change', 'move', 'postpone']):
            return 'reschedule'
        
        # Cancel appointment
        elif any(word in message_lower for word in ['cancel', 'delete', 'remove']):
            return 'cancel'
        
        # Set reminder
        elif any(phrase in message_lower for phrase in ['remind me', 'set reminder', 'don\'t forget']):
            return 'set_reminder'
        
        # Confirm appointment
        elif any(word in message_lower for word in ['confirm', 'verify', 'check']):
            return 'confirm'
        
        # Event planning
        elif any(word in message_lower for word in ['event', 'party', 'celebration', 'organize']):
            return 'plan_event'
        
        # General time inquiry
        elif any(word in message_lower for word in ['time', 'when', 'date']):
            return 'time_inquiry'
        
        else:
            return 'general_scheduling'
    
    def suggest_meeting_times(self, preferred_times: List[str] = None, duration: str = "1 hour") -> List[str]:
        """Suggest optimal meeting times based on common business practices"""
        
        suggestions = []
        current_time = datetime.now()
        
        # Business hours suggestions
        business_hours = [
            ("9:00 AM", "Morning slot"),
            ("10:00 AM", "Late morning"),
            ("11:00 AM", "Pre-lunch"),
            ("2:00 PM", "Early afternoon"),
            ("3:00 PM", "Mid afternoon"),
            ("4:00 PM", "Late afternoon")
        ]
        
        # Next 5 business days
        for i in range(1, 6):
            next_day = current_time + timedelta(days=i)
            if next_day.weekday() < 5:  # Monday = 0, Friday = 4
                day_name = next_day.strftime("%A")
                day_date = next_day.strftime("%B %d")
                
                for time_slot, description in business_hours[:3]:  # Suggest top 3 times per day
                    suggestions.append(f"{day_name}, {day_date} at {time_slot} ({description})")
        
        return suggestions[:6]  # Return top 6 suggestions
    
    def format_appointment_confirmation(self, details: Dict) -> str:
        """Format appointment confirmation with all details"""
        
        confirmation = "📅 **Appointment Confirmation**\n\n"
        
        if details.get('title'):
            confirmation += f"**Event**: {details['title']}\n"
        
        if details.get('date'):
            confirmation += f"**Date**: {details['date']}\n"
        
        if details.get('time'):
            confirmation += f"**Time**: {details['time']}"
            if details.get('timezone'):
                confirmation += f" ({details['timezone']})"
            confirmation += "\n"
        
        if details.get('duration'):
            confirmation += f"**Duration**: {details['duration']}\n"
        
        if details.get('location'):
            confirmation += f"**Location**: {details['location']}\n"
        
        if details.get('attendees'):
            confirmation += f"**Attendees**: {details['attendees']}\n"
        
        if details.get('notes'):
            confirmation += f"**Notes**: {details['notes']}\n"
        
        confirmation += "\n✅ Please confirm these details are correct."
        
        if details.get('reminder'):
            confirmation += f"\n🔔 Reminder set for: {details['reminder']}"
        
        return confirmation
    
    def get_scheduling_templates(self) -> Dict[str, str]:
        """Get response templates for common scheduling scenarios"""
        
        return {
            'schedule_request': "I'd be happy to help you schedule that. To find the best time, I need a few details:\n\n• What type of appointment/meeting is this?\n• How long should it be?\n• Any preferred dates or times?\n• Who else will be attending?\n• Any specific requirements?",
            
            'availability_check': "Let me check some good time options for you. Here are some available slots:\n\n{time_options}\n\nWhich of these works best for you?",
            
            'confirmation_request': "Perfect! Let me confirm the details:\n\n{appointment_details}\n\nIs everything correct? Should I set up any reminders?",
            
            'reschedule_help': "I'll help you reschedule that appointment. What new date and time would work better for you?\n\nHere are some alternative options:\n{alternative_times}",
            
            'reminder_setup': "I'll set up that reminder for you. When would you like to be reminded?\n\n• 15 minutes before\n• 1 hour before\n• 1 day before\n• Custom timing",
            
            'time_conflict': "I notice there might be a scheduling conflict. Here are some alternative times that should work better:\n\n{alternative_options}",
            
            'cancellation': "I'll help you cancel that appointment. To make sure I cancel the right one, can you confirm:\n\n• Date and time\n• What type of appointment\n• Who it's with (if applicable)"
        }
    
    def calculate_time_until_event(self, event_time: str) -> str:
        """Calculate time remaining until an event"""
        try:
            # This is a simplified version - in production, you'd parse the full datetime
            current_time = datetime.now()
            
            # For demo purposes, return a generic response
            return "I'll calculate the exact time remaining once we confirm all the details."
            
        except Exception as e:
            self.logger.error(f"Error calculating time until event: {e}")
            return "Unable to calculate time remaining."
    
    def suggest_reminder_timing(self, event_type: str) -> List[str]:
        """Suggest appropriate reminder timing based on event type"""
        
        reminder_suggestions = {
            'meeting': ["15 minutes before", "1 hour before"],
            'appointment': ["1 hour before", "1 day before"],
            'deadline': ["3 days before", "1 day before", "2 hours before"],
            'event': ["1 day before", "4 hours before"],
            'call': ["15 minutes before", "5 minutes before"],
            'interview': ["1 day before", "2 hours before", "30 minutes before"]
        }
        
        return reminder_suggestions.get(event_type.lower(), ["1 hour before", "15 minutes before"])
    
    def format_calendar_entry(self, appointment_details: Dict) -> str:
        """Format appointment details for calendar import"""
        
        # Simplified calendar format
        calendar_text = f"📋 **Calendar Entry Format:**\n\n"
        calendar_text += f"Title: {appointment_details.get('title', 'Appointment')}\n"
        calendar_text += f"Date: {appointment_details.get('date', 'TBD')}\n"
        calendar_text += f"Time: {appointment_details.get('time', 'TBD')}\n"
        calendar_text += f"Duration: {appointment_details.get('duration', '1 hour')}\n"
        
        if appointment_details.get('location'):
            calendar_text += f"Location: {appointment_details['location']}\n"
        
        if appointment_details.get('notes'):
            calendar_text += f"Notes: {appointment_details['notes']}\n"
        
        calendar_text += "\n📱 You can copy this information to add to your calendar app."
        
        return calendar_text
