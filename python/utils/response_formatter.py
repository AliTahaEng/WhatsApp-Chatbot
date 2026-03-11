"""
Response Formatter
Formats AI agent responses for WhatsApp compatibility

Handles:
- WhatsApp message length limits
- Text formatting and structure
- Emoji integration
- Link formatting
- Message splitting for long responses
"""

import re
from typing import List, Dict, Any
import logging

class ResponseFormatter:
    """Formats AI responses for optimal WhatsApp delivery"""
    
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        
        # WhatsApp constraints
        self.max_message_length = 4096  # WhatsApp's actual limit
        self.practical_limit = 1500     # Practical limit for readability
        self.max_lines = 30             # Reasonable line limit
        
        # Formatting rules
        self.formatting_rules = {
            'remove_markdown_headers': True,
            'convert_bold': True,
            'convert_italic': True,
            'preserve_lists': True,
            'preserve_code_blocks': False,  # WhatsApp doesn't support code blocks well
            'add_emojis': True,
            'format_links': True
        }
        
        # Emoji mappings for different contexts
        self.context_emojis = {
            'greeting': ['👋', '😊', '🙋‍♀️'],
            'help': ['💡', '🔧', '🆘'],
            'success': ['✅', '🎉', '✨'],
            'warning': ['⚠️', '🚨', '⏰'],
            'error': ['❌', '😕', '🔴'],
            'information': ['📝', '📋', 'ℹ️'],
            'question': ['❓', '🤔', '💭'],
            'schedule': ['📅', '⏰', '🗓️'],
            'technical': ['🔧', '💻', '⚙️'],
            'customer_service': ['🤝', '💼', '📞']
        }
        
        # Common text patterns to clean up
        self.cleanup_patterns = [
            (r'\*\*(.*?)\*\*', r'*\1*'),           # Convert **bold** to *bold*
            (r'#{1,6}\s*(.*?)\n', r'*\1*\n'),      # Convert headers to bold
            (r'```[\s\S]*?```', self._format_code_block),  # Handle code blocks
            (r'`([^`]+)`', r'"\1"'),               # Convert `code` to "code"
            (r'\[(.*?)\]\((.*?)\)', r'\1: \2'),    # Convert [text](url) to text: url
            (r'\n{3,}', '\n\n'),                  # Reduce multiple line breaks
            (r'^\s+', ''),                         # Remove leading whitespace
            (r'\s+$', ''),                         # Remove trailing whitespace
        ]
    
    def format_for_whatsapp(self, text: str, context: str = 'general', user_preferences: Dict = None) -> str:
        """
        Format text for WhatsApp delivery
        
        Args:
            text: Raw text from AI agent
            context: Context type (greeting, help, error, etc.)
            user_preferences: User formatting preferences
        
        Returns:
            Formatted text ready for WhatsApp
        """
        try:
            if not text or not text.strip():
                return "I apologize, but I couldn't generate a proper response. Could you please try again?"
            
            # Apply user preferences if provided
            if user_preferences:
                self._apply_user_preferences(user_preferences)
            
            # Initial cleanup
            formatted_text = text.strip()
            
            # Apply cleanup patterns
            formatted_text = self._apply_cleanup_patterns(formatted_text)
            
            # Handle length constraints
            if len(formatted_text) > self.practical_limit:
                formatted_text = self._handle_long_text(formatted_text)
            
            # Apply WhatsApp-specific formatting
            formatted_text = self._apply_whatsapp_formatting(formatted_text, context)
            
            # Final validation and cleanup
            formatted_text = self._final_cleanup(formatted_text)
            
            self.logger.debug(f"Formatted response: {len(formatted_text)} chars, context: {context}")
            
            return formatted_text
            
        except Exception as e:
            self.logger.error(f"Error formatting response: {e}")
            return self._get_fallback_response(text)
    
    def _apply_cleanup_patterns(self, text: str) -> str:
        """Apply regex cleanup patterns"""
        for pattern, replacement in self.cleanup_patterns:
            if callable(replacement):
                text = re.sub(pattern, replacement, text)
            else:
                text = re.sub(pattern, replacement, text)
        
        return text
    
    def _format_code_block(self, match) -> str:
        """Format code blocks for WhatsApp"""
        code_content = match.group(0)
        # Remove the triple backticks and format as quoted text
        code_lines = code_content.strip('`').strip().split('\n')
        formatted_lines = [f'> {line}' if line.strip() else '>' for line in code_lines]
        return '\n'.join(formatted_lines)
    
    def _handle_long_text(self, text: str) -> str:
        """Handle text that exceeds practical limits"""
        if len(text) <= self.practical_limit:
            return text
        
        # Try to split at natural break points
        break_points = ['. ', '\n\n', '\n', '; ', ', ']
        
        for break_point in break_points:
            if break_point in text[:self.practical_limit]:
                # Find the last occurrence before the limit
                split_pos = text[:self.practical_limit].rfind(break_point)
                if split_pos > self.practical_limit * 0.7:  # Don't split too early
                    truncated = text[:split_pos + len(break_point)].strip()
                    remaining_chars = len(text) - len(truncated)
                    
                    if remaining_chars > 50:  # Significant content remaining
                        truncated += f"\n\n📝 *({remaining_chars} more characters. Please ask if you'd like me to continue.)*"
                    
                    return truncated
        
        # Fallback: hard truncation with warning
        truncated = text[:self.practical_limit - 50]
        truncated += "...\n\n📝 *Response truncated. Please ask for more details if needed.*"
        
        return truncated
    
    def _apply_whatsapp_formatting(self, text: str, context: str) -> str:
        """Apply WhatsApp-specific formatting improvements"""
        
        # Add context-appropriate emoji if enabled
        if self.formatting_rules['add_emojis']:
            text = self._add_contextual_emoji(text, context)
        
        # Format lists for better readability
        if self.formatting_rules['preserve_lists']:
            text = self._format_lists(text)
        
        # Format structure for mobile reading
        text = self._improve_mobile_readability(text)
        
        return text
    
    def _add_contextual_emoji(self, text: str, context: str) -> str:
        """Add appropriate emojis based on context"""
        emojis = self.context_emojis.get(context, ['💬'])
        
        # Don't add emoji if text already starts with one
        if text and text[0] in '🎉✅❌⚠️📝🔧💡🤔📅':
            return text
        
        # Add emoji at the beginning for certain contexts
        if context in ['success', 'error', 'warning']:
            emoji = emojis[0] if emojis else '💬'
            text = f"{emoji} {text}"
        
        return text
    
    def _format_lists(self, text: str) -> str:
        """Format lists for better WhatsApp display"""
        lines = text.split('\n')
        formatted_lines = []
        in_list = False
        
        for line in lines:
            stripped = line.strip()
            
            # Detect list items
            if re.match(r'^[-•*]\s+', stripped) or re.match(r'^\d+\.\s+', stripped):
                if not in_list:
                    in_list = True
                
                # Convert markdown list to WhatsApp-friendly format
                if stripped.startswith('-') or stripped.startswith('•'):
                    formatted_line = f"• {stripped[2:].strip()}"
                elif stripped.startswith('*'):
                    formatted_line = f"• {stripped[2:].strip()}"
                else:  # Numbered list
                    formatted_line = stripped
                
                formatted_lines.append(formatted_line)
            else:
                if in_list and stripped:
                    in_list = False
                    formatted_lines.append('')  # Add spacing after list
                
                formatted_lines.append(line)
        
        return '\n'.join(formatted_lines)
    
    def _improve_mobile_readability(self, text: str) -> str:
        """Improve text readability on mobile devices"""
        
        # Break up very long paragraphs
        paragraphs = text.split('\n\n')
        improved_paragraphs = []
        
        for paragraph in paragraphs:
            if len(paragraph) > 300:  # Long paragraph
                # Try to break at sentence boundaries
                sentences = paragraph.split('. ')
                if len(sentences) > 2:
                    mid_point = len(sentences) // 2
                    first_half = '. '.join(sentences[:mid_point]) + '.'
                    second_half = '. '.join(sentences[mid_point:])
                    improved_paragraphs.append(first_half)
                    improved_paragraphs.append(second_half)
                else:
                    improved_paragraphs.append(paragraph)
            else:
                improved_paragraphs.append(paragraph)
        
        # Add proper spacing between sections
        result = '\n\n'.join(improved_paragraphs)
        
        # Ensure proper line breaks for sections
        result = re.sub(r'\*\*(.*?)\*\*', r'*\1*', result)  # Bold formatting
        
        return result
    
    def _final_cleanup(self, text: str) -> str:
        """Final cleanup and validation"""
        
        # Remove excessive whitespace
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = re.sub(r' {2,}', ' ', text)
        
        # Ensure text doesn't exceed absolute limits
        if len(text) > self.max_message_length:
            text = text[:self.max_message_length - 20] + "\n\n*[Truncated]*"
        
        # Count lines and truncate if necessary
        lines = text.split('\n')
        if len(lines) > self.max_lines:
            truncated_lines = lines[:self.max_lines - 2]
            truncated_lines.append('')
            truncated_lines.append('*[Response continues... please ask for more]*')
            text = '\n'.join(truncated_lines)
        
        return text.strip()
    
    def _get_fallback_response(self, original_text: str) -> str:
        """Generate fallback response when formatting fails"""
        if original_text and len(original_text) < 200:
            return original_text.strip()
        
        return "I apologize, but there was an issue formatting my response. Could you please rephrase your question?"
    
    def _apply_user_preferences(self, preferences: Dict):
        """Apply user-specific formatting preferences"""
        if 'disable_emojis' in preferences:
            self.formatting_rules['add_emojis'] = not preferences['disable_emojis']
        
        if 'max_length' in preferences:
            self.practical_limit = min(preferences['max_length'], self.max_message_length)
        
        if 'simple_formatting' in preferences:
            if preferences['simple_formatting']:
                self.formatting_rules.update({
                    'convert_bold': False,
                    'convert_italic': False,
                    'preserve_lists': False
                })
    
    def split_long_response(self, text: str, max_parts: int = 3) -> List[str]:
        """Split very long responses into multiple messages"""
        if len(text) <= self.practical_limit:
            return [text]
        
        parts = []
        remaining_text = text
        part_number = 1
        
        while remaining_text and part_number <= max_parts:
            if len(remaining_text) <= self.practical_limit:
                # Last part
                if part_number > 1:
                    parts.append(f"*Part {part_number}/{part_number}:*\n\n{remaining_text}")
                else:
                    parts.append(remaining_text)
                break
            
            # Find split point
            split_pos = self._find_split_point(remaining_text[:self.practical_limit])
            
            current_part = remaining_text[:split_pos].strip()
            if part_number == 1:
                current_part = f"*Part {part_number}/{max_parts}:*\n\n{current_part}"
            else:
                current_part = f"*Part {part_number}/{max_parts}:*\n\n{current_part}"
            
            parts.append(current_part)
            remaining_text = remaining_text[split_pos:].strip()
            part_number += 1
        
        # If there's still content remaining after max parts
        if remaining_text and part_number > max_parts:
            parts.append(f"*Additional content available. Please ask to continue.*")
        
        return parts
    
    def _find_split_point(self, text: str) -> int:
        """Find optimal point to split text"""
        # Try different split strategies
        split_chars = ['\n\n', '. ', '\n', '; ', ', ']
        
        for split_char in split_chars:
            pos = text.rfind(split_char)
            if pos > len(text) * 0.6:  # Don't split too early
                return pos + len(split_char)
        
        # Fallback: split at word boundary
        words = text.split()
        if len(words) > 1:
            # Take first 80% of words
            split_point = int(len(words) * 0.8)
            return len(' '.join(words[:split_point])) + 1
        
        return len(text) // 2
    
    def format_structured_response(self, data: Dict[str, Any], title: str = None) -> str:
        """Format structured data into readable WhatsApp message"""
        
        response_parts = []
        
        if title:
            response_parts.append(f"*{title}*\n")
        
        for key, value in data.items():
            if isinstance(value, list):
                response_parts.append(f"*{key.replace('_', ' ').title()}:*")
                for item in value[:5]:  # Limit list items
                    response_parts.append(f"• {item}")
                if len(value) > 5:
                    response_parts.append(f"• ... and {len(value) - 5} more")
                response_parts.append("")
            
            elif isinstance(value, dict):
                response_parts.append(f"*{key.replace('_', ' ').title()}:*")
                for subkey, subvalue in list(value.items())[:3]:  # Limit nested items
                    response_parts.append(f"  {subkey}: {subvalue}")
                response_parts.append("")
            
            else:
                response_parts.append(f"*{key.replace('_', ' ').title()}:* {value}")
        
        formatted = '\n'.join(response_parts).strip()
        return self.format_for_whatsapp(formatted, 'information')
    
    def add_quick_actions(self, text: str, actions: List[str]) -> str:
        """Add quick action suggestions to response"""
        if not actions:
            return text
        
        action_text = "\n\n*Quick actions:*\n"
        for i, action in enumerate(actions[:3], 1):  # Limit to 3 actions
            action_text += f"{i}. {action}\n"
        
        return text + action_text
    
    def format_error_message(self, error_type: str, user_message: str = None) -> str:
        """Format error messages for user consumption"""
        
        error_templates = {
            'processing_error': "I apologize, but I encountered an issue processing your request. Please try again in a moment.",
            'timeout_error': "I'm taking longer than usual to respond. Please try rephrasing your question.",
            'service_unavailable': "I'm temporarily unable to access some services. Please try again shortly.",
            'rate_limit': "You're sending messages a bit too quickly. Please wait a moment before trying again.",
            'invalid_input': "I'm having trouble understanding your request. Could you please rephrase it?",
            'permission_denied': "I don't have permission to access that information right now."
        }
        
        base_message = error_templates.get(error_type, error_templates['processing_error'])
        
        if user_message:
            return f"{base_message}\n\n*Your message:* {user_message[:100]}{'...' if len(user_message) > 100 else ''}"
        
        return base_message
    
    def get_formatting_stats(self) -> Dict[str, Any]:
        """Get statistics about formatting rules and usage"""
        return {
            'max_message_length': self.max_message_length,
            'practical_limit': self.practical_limit,
            'max_lines': self.max_lines,
            'formatting_rules': self.formatting_rules.copy(),
            'available_contexts': list(self.context_emojis.keys()),
            'cleanup_patterns_count': len(self.cleanup_patterns)
        }
