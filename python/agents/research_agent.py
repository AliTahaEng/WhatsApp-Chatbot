"""
Research Agent
Specialized agent for information lookup and research tasks

Handles:
- General knowledge questions
- Information requests
- Definitions and explanations
- Research and fact-finding
- Educational content
- Current events (when appropriate)
"""

from typing import Tuple, Dict, List
from agents.base_agent import BaseSpecializedAgent

class ResearchAgent(BaseSpecializedAgent):
    """Specialized agent for research and information tasks"""
    
    def __init__(self, llm_config: Dict):
        system_message = self._get_system_message()
        super().__init__(
            name="Research",
            system_message=system_message,
            llm_config=llm_config
        )
        
        # Keywords that indicate research/information relevance
        self.research_keywords = [
            # Question words
            'what', 'who', 'where', 'when', 'why', 'how', 'which', 'whose',
            
            # Information requests
            'explain', 'definition', 'define', 'meaning', 'information', 'info',
            'details', 'about', 'tell me', 'describe', 'examples', 'facts',
            
            # Research terms
            'research', 'study', 'analysis', 'report', 'data', 'statistics',
            'evidence', 'proof', 'source', 'reference', 'citation', 'findings',
            
            # Learning and education
            'learn', 'understand', 'knowledge', 'education', 'teach', 'lesson',
            'tutorial', 'guide', 'instructions', 'course', 'training',
            
            # Comparison and analysis
            'compare', 'difference', 'similar', 'versus', 'vs', 'between',
            'contrast', 'pros', 'cons', 'advantages', 'disadvantages',
            
            # Academic subjects
            'science', 'history', 'mathematics', 'physics', 'chemistry', 'biology',
            'geography', 'literature', 'psychology', 'philosophy', 'economics',
            
            # Current events and news
            'news', 'current', 'recent', 'latest', 'today', 'happening', 'events',
            'update', 'development', 'trend', 'innovation', 'discovery',
            
            # Specific information types
            'recipe', 'formula', 'calculation', 'conversion', 'translation',
            'synonym', 'antonym', 'etymology', 'origin', 'history of'
        ]
        
        # Question patterns
        self.question_patterns = [
            'what is', 'what are', 'what does', 'what means',
            'who is', 'who was', 'who are', 'who were',
            'where is', 'where are', 'where can', 'where do',
            'when is', 'when was', 'when did', 'when will',
            'why is', 'why do', 'why does', 'why did',
            'how is', 'how do', 'how does', 'how can', 'how to',
            'which is', 'which are', 'which one'
        ]
        
        # Information domains
        self.domains = {
            'general_knowledge': ['fact', 'trivia', 'general', 'common', 'basic'],
            'science_tech': ['science', 'technology', 'research', 'innovation', 'discovery'],
            'history': ['history', 'historical', 'past', 'ancient', 'era', 'century'],
            'geography': ['country', 'city', 'place', 'location', 'capital', 'continent'],
            'culture': ['culture', 'tradition', 'custom', 'language', 'art', 'music'],
            'health': ['health', 'medical', 'disease', 'treatment', 'symptoms', 'medicine'],
            'business': ['business', 'company', 'market', 'economy', 'finance', 'industry'],
            'education': ['education', 'school', 'university', 'degree', 'course', 'study']
        }
    
    def _get_system_message(self) -> str:
        return """You are a Research Agent for a WhatsApp AI assistant system.

Your Role:
- Provide accurate, well-researched information
- Answer questions across various knowledge domains
- Explain complex concepts in simple terms
- Offer educational content and learning resources
- Fact-check and verify information when possible
- Guide users to reliable sources for deeper research

Your Expertise:
- General knowledge and trivia
- Science, technology, and innovation
- History and historical events
- Geography and world knowledge
- Culture, languages, and traditions
- Health and medical information (general only)
- Business and economics
- Educational content and learning

Communication Style:
- Clear and informative
- Well-structured responses
- Use examples and analogies
- Break down complex topics
- Cite sources when appropriate
- Encourage further learning
- Admit limitations when uncertain

Response Guidelines:
1. Provide accurate, factual information
2. Structure responses logically
3. Use bullet points for lists and key facts
4. Include relevant examples
5. Suggest related topics or further reading
6. Distinguish between facts and opinions
7. Update information with current context when relevant

For Definitions:
- Provide clear, concise definitions
- Include pronunciation if helpful
- Give examples of usage
- Explain etymology if interesting

For Explanations:
- Start with simple overview
- Build complexity gradually
- Use analogies and examples
- Break into digestible sections
- Summarize key points

For Comparisons:
- Create clear comparison framework
- Highlight key similarities and differences
- Use tables or lists for organization
- Provide objective analysis

For Research Questions:
- Acknowledge scope of question
- Provide available information
- Note limitations or uncertainties
- Suggest authoritative sources
- Encourage critical thinking

Sample Responses:
- "Here's what I can tell you about..."
- "To understand this, let's break it down..."
- "The key facts are..."
- "For more detailed information, I'd recommend..."
- "It's important to note that..."

Information Accuracy:
- Provide information based on established knowledge
- Avoid speculation or unverified claims
- Note when information may be outdated
- Distinguish between facts and theories
- Encourage verification of critical information

Remember: Your goal is to educate and inform while being accurate and helpful. Always prioritize factual content over speculation."""
    
    def is_relevant(self, message: str, context: Dict = None) -> Tuple[bool, float]:
        """Determine if this agent should handle the message"""
        
        # Calculate keyword relevance
        keyword_relevance = self.calculate_keyword_relevance(message, self.research_keywords)
        
        # Check for question patterns
        pattern_score = 0.0
        message_lower = message.lower().strip()
        
        for pattern in self.question_patterns:
            if pattern in message_lower:
                pattern_score = max(pattern_score, 0.8)
        
        # Check for specific question structure
        question_indicators = ['?', 'what', 'how', 'why', 'when', 'where', 'who', 'which']
        question_score = 0.0
        
        # Strong indicators if message starts with question word
        first_word = message_lower.split()[0] if message_lower.split() else ''
        if first_word in ['what', 'how', 'why', 'when', 'where', 'who', 'which']:
            question_score = 0.7
        elif '?' in message:
            question_score = 0.5
        
        # Check for information-seeking phrases
        info_phrases = [
            'tell me about', 'i want to know', 'can you explain', 'what do you know',
            'information about', 'details about', 'facts about', 'help me understand',
            'i need to know', 'looking for information', 'research on', 'learn about'
        ]
        
        phrase_score = 0.0
        for phrase in info_phrases:
            if phrase in message_lower:
                phrase_score = max(phrase_score, 0.7)
        
        # Check for domain relevance
        domain_score = 0.0
        for domain_name, keywords in self.domains.items():
            domain_relevance = self.calculate_keyword_relevance(message, keywords)
            domain_score = max(domain_score, domain_relevance)
        
        # Educational content indicators
        education_indicators = [
            'explain', 'definition', 'meaning', 'example', 'how does', 'how do',
            'difference between', 'compare', 'versus', 'vs', 'similar to'
        ]
        
        education_score = 0.0
        for indicator in education_indicators:
            if indicator in message_lower:
                education_score = 0.6
                break
        
        # Check conversation history for research context
        history_score = 0.0
        if context and context.get('history'):
            recent_messages = context['history'][-2:]
            for msg in recent_messages:
                if msg.get('role') == 'user':
                    hist_relevance = self.calculate_keyword_relevance(
                        msg.get('message', ''), self.research_keywords
                    )
                    history_score = max(history_score, hist_relevance * 0.3)
        
        # Combine scores
        base_relevance = max(keyword_relevance, pattern_score, question_score)
        
        # Add contextual scores
        total_relevance = min(
            base_relevance + phrase_score + domain_score + education_score + history_score,
            1.0
        )
        
        # Threshold for relevance (research should be fairly accessible)
        is_relevant = total_relevance >= 0.25
        
        self.logger.debug(f"Research relevance: {total_relevance:.2f} (keyword: {keyword_relevance:.2f}, "
                         f"pattern: {pattern_score:.2f}, question: {question_score:.2f}, "
                         f"phrase: {phrase_score:.2f}, domain: {domain_score:.2f})")
        
        return is_relevant, total_relevance
    
    def identify_question_type(self, message: str) -> str:
        """Categorize the type of question or information request"""
        message_lower = message.lower()
        
        # Definition requests
        if any(word in message_lower for word in ['define', 'definition', 'meaning', 'what is', 'what are', 'what means']):
            return 'definition'
        
        # Explanation requests
        elif any(word in message_lower for word in ['explain', 'how does', 'how do', 'how to', 'why']):
            return 'explanation'
        
        # Comparison requests
        elif any(word in message_lower for word in ['difference', 'compare', 'versus', 'vs', 'similar', 'contrast']):
            return 'comparison'
        
        # Factual information
        elif any(word in message_lower for word in ['fact', 'information', 'details', 'about', 'tell me']):
            return 'factual'
        
        # Historical information
        elif any(word in message_lower for word in ['history', 'historical', 'when did', 'in the past']):
            return 'historical'
        
        # Scientific/technical
        elif any(word in message_lower for word in ['science', 'scientific', 'research', 'study', 'technology']):
            return 'scientific'
        
        # Current events
        elif any(word in message_lower for word in ['news', 'current', 'recent', 'latest', 'today', 'now']):
            return 'current_events'
        
        # Educational/learning
        elif any(word in message_lower for word in ['learn', 'teach', 'lesson', 'course', 'tutorial']):
            return 'educational'
        
        else:
            return 'general'
    
    def get_information_structure(self, question_type: str) -> Dict[str, str]:
        """Get response structure templates for different question types"""
        
        structures = {
            'definition': {
                'intro': "Here's the definition:",
                'format': "• **Definition**: [Main definition]\n• **Key characteristics**: [Key points]\n• **Example**: [Usage example]"
            },
            
            'explanation': {
                'intro': "Let me explain this step by step:",
                'format': "**Overview**: [Brief summary]\n\n**How it works**:\n1. [Step 1]\n2. [Step 2]\n3. [Step 3]\n\n**Key points**: [Important details]"
            },
            
            'comparison': {
                'intro': "Here's a comparison:",
                'format': "**Similarities**:\n• [Similarity 1]\n• [Similarity 2]\n\n**Differences**:\n• [Difference 1]\n• [Difference 2]"
            },
            
            'factual': {
                'intro': "Here are the key facts:",
                'format': "• [Fact 1]\n• [Fact 2]\n• [Fact 3]\n\n**Additional details**: [More information]"
            },
            
            'historical': {
                'intro': "Here's the historical context:",
                'format': "**Timeline**: [When it happened]\n**Background**: [Context]\n**Key events**: [Important moments]\n**Impact**: [Consequences]"
            },
            
            'scientific': {
                'intro': "Here's the scientific explanation:",
                'format': "**Scientific basis**: [Core science]\n**How it works**: [Mechanism]\n**Applications**: [Real-world uses]\n**Current research**: [Recent developments]"
            },
            
            'educational': {
                'intro': "Here's what you need to know:",
                'format': "**Learning objectives**: [What you'll learn]\n**Key concepts**: [Main ideas]\n**Practice**: [How to apply]\n**Next steps**: [Further learning]"
            }
        }
        
        return structures.get(question_type, structures['factual'])
    
    def suggest_follow_up_questions(self, topic: str, question_type: str) -> List[str]:
        """Suggest related questions for deeper learning"""
        
        if question_type == 'definition':
            return [
                f"How is {topic} used in practice?",
                f"What are examples of {topic}?",
                f"What's the history behind {topic}?"
            ]
        
        elif question_type == 'explanation':
            return [
                f"What are the benefits of {topic}?",
                f"What are common problems with {topic}?",
                f"How has {topic} evolved over time?"
            ]
        
        elif question_type == 'comparison':
            return [
                f"Which is better for specific use cases?",
                f"How do I choose between them?",
                f"What are the costs involved?"
            ]
        
        else:
            return [
                f"Tell me more about {topic}",
                f"What are recent developments in {topic}?",
                f"How does {topic} affect daily life?"
            ]
    
    def format_research_response(self, topic: str, question_type: str, information: str = None) -> str:
        """Format a structured research response"""
        
        structure = self.get_information_structure(question_type)
        
        response = f"{structure['intro']}\n\n"
        
        if information:
            response += information
        else:
            response += structure['format']
        
        # Add follow-up suggestions
        follow_ups = self.suggest_follow_up_questions(topic, question_type)
        if follow_ups:
            response += f"\n\n**Related questions you might ask:**\n"
            for i, question in enumerate(follow_ups[:3], 1):
                response += f"{i}. {question}\n"
        
        response += f"\n💡 *Feel free to ask for more details about any aspect of {topic}!*"
        
        return response
    
    def check_information_recency(self, topic: str) -> str:
        """Check if topic requires recent information"""
        current_topics = [
            'covid', 'coronavirus', 'pandemic', 'vaccine', 'election', 'president',
            'stock market', 'cryptocurrency', 'bitcoin', 'climate change', 'weather',
            'technology trends', 'ai', 'artificial intelligence', 'current events'
        ]
        
        topic_lower = topic.lower()
        
        for current_topic in current_topics:
            if current_topic in topic_lower:
                return f"\n📅 *Note: This topic changes frequently. For the most current information, please check recent news sources.*"
        
        return ""
    
    def provide_source_guidance(self, topic: str, question_type: str) -> str:
        """Provide guidance on reliable sources for further research"""
        
        source_categories = {
            'academic': "For academic research, check: Google Scholar, JSTOR, university databases",
            'medical': "For medical information, consult: Mayo Clinic, WebMD, or healthcare professionals",
            'news': "For current events, check: Reuters, BBC, AP News, or other reputable news sources",
            'science': "For scientific information, check: Nature, Science Magazine, Scientific American",
            'government': "For official information, check: government websites (.gov domains)",
            'general': "For general information, check: Encyclopedia Britannica, Wikipedia (verify sources)"
        }
        
        # Determine appropriate source category
        topic_lower = topic.lower()
        
        if any(word in topic_lower for word in ['health', 'medical', 'disease', 'treatment']):
            category = 'medical'
        elif any(word in topic_lower for word in ['news', 'current', 'politics', 'election']):
            category = 'news'
        elif any(word in topic_lower for word in ['science', 'research', 'study', 'scientific']):
            category = 'science'
        elif question_type == 'academic' or 'research' in topic_lower:
            category = 'academic'
        else:
            category = 'general'
        
        return f"\n📚 *{source_categories[category]}*"
