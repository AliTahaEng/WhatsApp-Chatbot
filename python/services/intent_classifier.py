"""
Intent Classifier
Classifies user messages to determine routing to appropriate agents

Uses rule-based classification with keyword matching and pattern recognition
to determine user intent and route messages to the most suitable agent.
"""

import re
from typing import Dict, List, Tuple
import logging

class IntentClassifier:
    """Classifies user intents for message routing"""
    
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        
        # Define intent categories and their indicators
        self.intent_patterns = {
            'customer_service': {
                'keywords': [
                    'complaint', 'problem', 'issue', 'refund', 'return', 'exchange',
                    'billing', 'charge', 'payment', 'order', 'delivery', 'shipping',
                    'cancel', 'help', 'support', 'frustrated', 'angry', 'disappointed',
                    'terrible', 'awful', 'manager', 'escalate', 'wrong', 'mistake'
                ],
                'patterns': [
                    r'i want.*refund',
                    r'this is.*(?:terrible|awful|wrong)',
                    r'speak.*(?:manager|supervisor)',
                    r'cancel.*(?:order|subscription)',
                    r'charged.*wrong',
                    r'never.*received',
                    r'where.*(?:order|package)',
                    r'having.*(?:problem|issue|trouble)'
                ],
                'negative_emotions': [
                    'frustrated', 'angry', 'upset', 'disappointed', 'annoyed',
                    'furious', 'disgusted', 'terrible', 'awful', 'horrible'
                ]
            },
            
            'technical_support': {
                'keywords': [
                    'not working', 'broken', 'error', 'bug', 'crash', 'freeze',
                    'slow', 'install', 'setup', 'configure', 'login', 'password',
                    'access', 'connection', 'internet', 'browser', 'app', 'software',
                    'hardware', 'computer', 'phone', 'device', 'technical', 'tech'
                ],
                'patterns': [
                    r'(?:cant|cannot|wont|will not).*(?:log|login|access)',
                    r'(?:not working|doesnt work|broken)',
                    r'error.*(?:message|code)',
                    r'how.*(?:install|setup|configure)',
                    r'keeps.*(?:crashing|freezing)',
                    r'(?:slow|lag|performance).*(?:issue|problem)',
                    r'internet.*(?:not working|down|slow)',
                    r'forgot.*password'
                ],
                'technical_terms': [
                    'api', 'database', 'server', 'ssl', 'vpn', 'firewall',
                    'router', 'modem', 'driver', 'plugin', 'extension'
                ]
            },
            
            'information_request': {
                'keywords': [
                    'what', 'who', 'where', 'when', 'why', 'how', 'explain',
                    'definition', 'meaning', 'information', 'details', 'about',
                    'tell me', 'describe', 'facts', 'research', 'study', 'learn'
                ],
                'patterns': [
                    r'^what (?:is|are|does|do)',
                    r'^who (?:is|are|was|were)',
                    r'^where (?:is|are|can|do)',
                    r'^when (?:is|was|did|will)',
                    r'^why (?:is|are|does|do)',
                    r'^how (?:is|are|does|do|can|to)',
                    r'tell me about',
                    r'explain.*(?:to me|how|what|why)',
                    r'what.*(?:mean|means)',
                    r'information.*about'
                ],
                'question_indicators': ['?', 'what', 'how', 'why', 'when', 'where', 'who']
            },
            
            'scheduling': {
                'keywords': [
                    'schedule', 'appointment', 'meeting', 'book', 'calendar',
                    'time', 'date', 'when', 'available', 'free', 'busy',
                    'remind', 'reminder', 'event', 'plan', 'arrange'
                ],
                'patterns': [
                    r'schedule.*(?:appointment|meeting)',
                    r'book.*(?:appointment|session)',
                    r'when.*(?:available|free)',
                    r'are you.*(?:available|free)',
                    r'set.*(?:reminder|appointment)',
                    r'remind me.*(?:to|about)',
                    r'(?:tomorrow|next week|next month).*(?:at|@)',
                    r'meet.*(?:tomorrow|next|this)'
                ],
                'time_indicators': [
                    'today', 'tomorrow', 'next week', 'next month', 'monday',
                    'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
                    'sunday', 'morning', 'afternoon', 'evening'
                ]
            },
            
            'general': {
                'keywords': [
                    'hello', 'hi', 'hey', 'thanks', 'thank you', 'goodbye',
                    'bye', 'please', 'okay', 'yes', 'no', 'maybe', 'sure'
                ],
                'patterns': [
                    r'^(?:hello|hi|hey)',
                    r'^(?:thanks|thank you)',
                    r'^(?:goodbye|bye|see you)',
                    r'^(?:yes|no|maybe|sure|okay)',
                    r'how are you',
                    r'nice to meet'
                ],
                'greetings': ['hello', 'hi', 'hey', 'good morning', 'good afternoon']
            }
        }
        
        # Priority weights for different indicators
        self.weights = {
            'keyword_match': 1.0,
            'pattern_match': 1.5,
            'emotion_match': 1.2,
            'question_indicator': 1.1,
            'technical_term': 1.3,
            'time_indicator': 1.2
        }
    
    async def classify(self, message: str, context: Dict = None) -> Dict:
        """
        Classify user message intent
        
        Args:
            message: User's message text
            context: Additional context (history, user profile, etc.)
        
        Returns:
            Dict with intent, confidence, and reasoning
        """
        try:
            message_lower = message.lower().strip()
            
            if not message_lower:
                return self._create_result('general', 0.0, 'Empty message')
            
            # Calculate scores for each intent
            intent_scores = {}
            
            for intent_name, intent_data in self.intent_patterns.items():
                score = self._calculate_intent_score(message_lower, intent_data)
                intent_scores[intent_name] = score
            
            # Apply context boosting
            if context:
                intent_scores = self._apply_context_boost(intent_scores, context)
            
            # Find the best intent
            best_intent = max(intent_scores.items(), key=lambda x: x[1])
            intent_name, confidence = best_intent
            
            # Apply minimum confidence threshold
            min_confidence = 0.1
            if confidence < min_confidence:
                intent_name = 'general'
                confidence = 0.5
            
            # Generate reasoning
            reasoning = self._generate_reasoning(message_lower, intent_name, confidence)
            
            result = self._create_result(intent_name, confidence, reasoning)
            
            self.logger.debug(f"Intent classified: {intent_name} (confidence: {confidence:.2f})")
            
            return result
            
        except Exception as e:
            self.logger.error(f"Error classifying intent: {e}")
            return self._create_result('general', 0.5, f'Classification error: {str(e)}')
    
    def _calculate_intent_score(self, message: str, intent_data: Dict) -> float:
        """Calculate relevance score for a specific intent"""
        score = 0.0
        
        # Keyword matching
        keywords = intent_data.get('keywords', [])
        keyword_matches = sum(1 for keyword in keywords if keyword in message)
        keyword_score = (keyword_matches / max(len(keywords), 1)) * self.weights['keyword_match']
        score += keyword_score
        
        # Pattern matching
        patterns = intent_data.get('patterns', [])
        pattern_matches = sum(1 for pattern in patterns if re.search(pattern, message))
        pattern_score = (pattern_matches / max(len(patterns), 1)) * self.weights['pattern_match']
        score += pattern_score
        
        # Special indicators
        if 'negative_emotions' in intent_data:
            emotion_matches = sum(1 for emotion in intent_data['negative_emotions'] if emotion in message)
            if emotion_matches > 0:
                score += self.weights['emotion_match']
        
        if 'question_indicators' in intent_data:
            question_matches = sum(1 for indicator in intent_data['question_indicators'] if indicator in message)
            if question_matches > 0:
                score += self.weights['question_indicator']
        
        if 'technical_terms' in intent_data:
            tech_matches = sum(1 for term in intent_data['technical_terms'] if term in message)
            if tech_matches > 0:
                score += self.weights['technical_term']
        
        if 'time_indicators' in intent_data:
            time_matches = sum(1 for indicator in intent_data['time_indicators'] if indicator in message)
            if time_matches > 0:
                score += self.weights['time_indicator']
        
        # Normalize score (rough normalization)
        max_possible_score = len(intent_data.get('keywords', [])) + len(intent_data.get('patterns', [])) + 3
        normalized_score = min(score / max(max_possible_score, 1), 1.0)
        
        return normalized_score
    
    def _apply_context_boost(self, intent_scores: Dict, context: Dict) -> Dict:
        """Apply context-based boosting to intent scores"""
        boosted_scores = intent_scores.copy()
        
        # Check conversation history for context
        if context.get('history'):
            recent_messages = context['history'][-3:]  # Last 3 messages
            
            for msg in recent_messages:
                if msg.get('role') == 'user':
                    prev_message = msg.get('message', '').lower()
                    
                    # Boost scheduling if previous messages mentioned time/dates
                    if any(word in prev_message for word in ['time', 'when', 'schedule', 'meeting']):
                        boosted_scores['scheduling'] = min(boosted_scores['scheduling'] + 0.2, 1.0)
                    
                    # Boost technical support for follow-up questions
                    if any(word in prev_message for word in ['still', 'not working', 'tried', 'error']):
                        boosted_scores['technical_support'] = min(boosted_scores['technical_support'] + 0.2, 1.0)
                    
                    # Boost customer service for complaints
                    if any(word in prev_message for word in ['problem', 'issue', 'complaint', 'frustrated']):
                        boosted_scores['customer_service'] = min(boosted_scores['customer_service'] + 0.2, 1.0)
        
        # Check user profile for preferences
        user_profile = context.get('userProfile', {})
        if user_profile.get('tags'):
            tags = user_profile['tags']
            
            if 'technical_user' in tags:
                boosted_scores['technical_support'] = min(boosted_scores['technical_support'] + 0.1, 1.0)
            
            if 'frequent_scheduler' in tags:
                boosted_scores['scheduling'] = min(boosted_scores['scheduling'] + 0.1, 1.0)
        
        # Time-based context
        current_time = context.get('currentTime', '')
        if 'business_hours' in current_time:  # Simplified check
            boosted_scores['customer_service'] = min(boosted_scores['customer_service'] + 0.1, 1.0)
            boosted_scores['scheduling'] = min(boosted_scores['scheduling'] + 0.1, 1.0)
        
        return boosted_scores
    
    def _generate_reasoning(self, message: str, intent: str, confidence: float) -> str:
        """Generate human-readable reasoning for the classification"""
        reasoning_parts = []
        
        intent_data = self.intent_patterns.get(intent, {})
        
        # Check what triggered the classification
        matched_keywords = [kw for kw in intent_data.get('keywords', []) if kw in message]
        if matched_keywords:
            reasoning_parts.append(f"Keywords found: {', '.join(matched_keywords[:3])}")
        
        matched_patterns = []
        for pattern in intent_data.get('patterns', []):
            if re.search(pattern, message):
                matched_patterns.append(pattern)
        
        if matched_patterns:
            reasoning_parts.append(f"Patterns matched: {len(matched_patterns)} pattern(s)")
        
        if confidence > 0.8:
            reasoning_parts.append("High confidence match")
        elif confidence > 0.5:
            reasoning_parts.append("Medium confidence match")
        else:
            reasoning_parts.append("Low confidence match")
        
        return "; ".join(reasoning_parts) if reasoning_parts else "Default classification"
    
    def _create_result(self, intent: str, confidence: float, reasoning: str) -> Dict:
        """Create standardized result dictionary"""
        return {
            'intent': intent,
            'confidence': round(confidence, 3),
            'reasoning': reasoning,
            'timestamp': self._get_timestamp(),
            'alternative_intents': self._get_alternative_suggestions(intent)
        }
    
    def _get_alternative_suggestions(self, primary_intent: str) -> List[str]:
        """Get alternative intent suggestions"""
        alternatives = {
            'customer_service': ['general'],
            'technical_support': ['information_request'],
            'information_request': ['general'],
            'scheduling': ['general'],
            'general': ['information_request']
        }
        
        return alternatives.get(primary_intent, [])
    
    def _get_timestamp(self) -> str:
        """Get current timestamp"""
        from datetime import datetime
        return datetime.utcnow().isoformat()
    
    def get_intent_examples(self, intent: str) -> List[str]:
        """Get example messages for a specific intent"""
        examples = {
            'customer_service': [
                "I have a problem with my order",
                "I want a refund for this product",
                "I'm frustrated with your service",
                "Can you help me with billing issue?"
            ],
            'technical_support': [
                "The app is not working",
                "I can't log into my account",
                "How do I install this software?",
                "I'm getting an error message"
            ],
            'information_request': [
                "What is artificial intelligence?",
                "How does photosynthesis work?",
                "Tell me about the history of computers",
                "Explain quantum physics"
            ],
            'scheduling': [
                "Can we schedule a meeting?",
                "When are you available?",
                "Book an appointment for next week",
                "Remind me to call John tomorrow"
            ],
            'general': [
                "Hello, how are you?",
                "Thank you for your help",
                "Yes, that sounds good",
                "Have a great day!"
            ]
        }
        
        return examples.get(intent, [])
    
    def update_intent_patterns(self, intent: str, new_keywords: List[str] = None, new_patterns: List[str] = None):
        """Dynamically update intent patterns (for learning/adaptation)"""
        if intent not in self.intent_patterns:
            self.logger.warning(f"Unknown intent: {intent}")
            return
        
        if new_keywords:
            self.intent_patterns[intent]['keywords'].extend(new_keywords)
            self.logger.info(f"Added {len(new_keywords)} keywords to {intent}")
        
        if new_patterns:
            self.intent_patterns[intent]['patterns'].extend(new_patterns)
            self.logger.info(f"Added {len(new_patterns)} patterns to {intent}")
    
    def get_classification_stats(self) -> Dict:
        """Get statistics about the classifier configuration"""
        stats = {}
        
        for intent, data in self.intent_patterns.items():
            stats[intent] = {
                'keywords': len(data.get('keywords', [])),
                'patterns': len(data.get('patterns', [])),
                'special_indicators': len([k for k in data.keys() if k not in ['keywords', 'patterns']])
            }
        
        return {
            'total_intents': len(self.intent_patterns),
            'intent_details': stats,
            'weights': self.weights
        }
