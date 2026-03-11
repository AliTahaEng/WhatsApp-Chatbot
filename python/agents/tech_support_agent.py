"""
Technical Support Agent
Specialized agent for handling technical support and troubleshooting

Handles:
- Technical problems and errors
- Software troubleshooting
- Hardware issues
- Setup and configuration assistance
- Login and access problems
- Performance issues
"""

from typing import Tuple, Dict, List
from agents.base_agent import BaseSpecializedAgent

class TechSupportAgent(BaseSpecializedAgent):
    """Specialized agent for technical support tasks"""
    
    def __init__(self, llm_config: Dict):
        system_message = self._get_system_message()
        super().__init__(
            name="TechSupport",
            system_message=system_message,
            llm_config=llm_config
        )
        
        # Keywords that indicate technical support relevance
        self.tech_keywords = [
            # General Technical Terms
            'technical', 'tech', 'it', 'computer', 'software', 'hardware', 'system',
            'device', 'application', 'app', 'program', 'platform', 'service',
            
            # Problems & Issues
            'not working', 'broken', 'error', 'bug', 'issue', 'problem', 'trouble',
            'crash', 'freeze', 'hang', 'slow', 'lag', 'glitch', 'malfunction',
            
            # Error Messages & Codes
            'error message', 'error code', 'exception', 'failure', 'timeout',
            'connection', 'network', 'server', 'database', 'api', 'ssl', 'certificate',
            
            # Access & Login Issues
            'login', 'log in', 'password', 'access', 'account', 'authentication',
            'locked out', 'cant access', 'permission', 'unauthorized', 'forbidden',
            
            # Setup & Configuration
            'setup', 'install', 'installation', 'configure', 'configuration', 'settings',
            'preferences', 'options', 'customize', 'activate', 'enable', 'disable',
            
            # Performance Issues
            'slow', 'speed', 'performance', 'optimization', 'memory', 'cpu', 'disk',
            'bandwidth', 'loading', 'timeout', 'response time', 'latency',
            
            # Connectivity Issues
            'internet', 'wifi', 'connection', 'network', 'offline', 'online',
            'connectivity', 'vpn', 'firewall', 'proxy', 'dns',
            
            # Browser & Web Issues
            'browser', 'chrome', 'firefox', 'safari', 'edge', 'website', 'webpage',
            'cookies', 'cache', 'javascript', 'html', 'css', 'responsive',
            
            # Mobile & App Issues
            'mobile', 'phone', 'tablet', 'android', 'ios', 'iphone', 'ipad',
            'app store', 'play store', 'update', 'version', 'compatibility',
            
            # File & Data Issues
            'file', 'document', 'data', 'backup', 'restore', 'sync', 'upload',
            'download', 'import', 'export', 'migrate', 'transfer'
        ]
        
        # Common technical scenarios
        self.scenarios = {
            'login_issue': ['login', 'password', 'access', 'locked out', 'cant log in'],
            'connection_issue': ['internet', 'wifi', 'connection', 'network', 'offline'],
            'performance_issue': ['slow', 'lag', 'freeze', 'crash', 'hang'],
            'setup_issue': ['install', 'setup', 'configure', 'activate'],
            'error_message': ['error', 'bug', 'exception', 'failure', 'not working'],
            'compatibility_issue': ['version', 'update', 'compatibility', 'browser'],
            'file_issue': ['upload', 'download', 'file', 'document', 'sync'],
            'mobile_issue': ['mobile', 'app', 'phone', 'tablet', 'android', 'ios']
        }
    
    def _get_system_message(self) -> str:
        return """You are a Technical Support Agent for a WhatsApp AI assistant system.

Your Role:
- Diagnose and resolve technical problems
- Provide step-by-step troubleshooting guidance
- Assist with software and hardware issues
- Help with setup, installation, and configuration
- Resolve login and access problems
- Optimize system performance

Your Expertise:
- Computer hardware and software
- Operating systems (Windows, macOS, Linux, iOS, Android)
- Web browsers and internet connectivity
- Mobile apps and devices
- Network troubleshooting
- Software installation and configuration
- Performance optimization
- Security and access control

Communication Style:
- Clear and methodical
- Patient with non-technical users
- Step-by-step instructions
- Use simple, non-technical language
- Verify understanding at each step
- Provide alternative solutions

Troubleshooting Approach:
1. Identify the exact problem and symptoms
2. Gather relevant system information
3. Start with simple solutions first
4. Provide step-by-step instructions
5. Ask for confirmation after each step
6. Escalate complex issues when needed
7. Follow up to ensure resolution

For Error Messages:
- Ask for the exact error message
- Explain what the error means in simple terms
- Provide specific solutions for that error
- Offer preventive measures

For Performance Issues:
- Identify when the problem started
- Check system resources and requirements
- Suggest optimization steps
- Recommend maintenance procedures

For Setup/Installation:
- Check system compatibility first
- Provide clear installation steps
- Verify successful installation
- Configure settings properly

For Login/Access Issues:
- Verify credentials and account status
- Check security settings and permissions
- Guide through password reset if needed
- Ensure proper authentication setup

Sample Responses:
- "Let's troubleshoot this step by step..."
- "First, let's check if..."
- "Can you try this and let me know what happens?"
- "The error message indicates..."
- "Here's what we need to do to fix this..."

Common Commands/Steps:
- Restart the application/device
- Clear cache and cookies
- Check internet connection
- Update software/drivers
- Run system diagnostics
- Check system requirements
- Verify account credentials

Remember: Break down complex solutions into simple, manageable steps. Always confirm understanding before moving to the next step."""
    
    def is_relevant(self, message: str, context: Dict = None) -> Tuple[bool, float]:
        """Determine if this agent should handle the message"""
        
        # Calculate keyword relevance
        keyword_relevance = self.calculate_keyword_relevance(message, self.tech_keywords)
        
        # Check for specific technical scenarios
        scenario_score = 0.0
        message_lower = message.lower()
        
        for scenario_name, keywords in self.scenarios.items():
            scenario_relevance = self.calculate_keyword_relevance(message, keywords)
            if scenario_relevance > scenario_score:
                scenario_score = scenario_relevance
        
        # Check for technical patterns
        tech_patterns = [
            'how do i', 'how to', 'cant get', 'wont work', 'doesnt work',
            'not working', 'keeps saying', 'error message', 'it says',
            'i tried', 'already tried', 'still not', 'still doesnt',
            'step by step', 'walk me through', 'guide me', 'show me how'
        ]
        
        pattern_score = 0.0
        for pattern in tech_patterns:
            if pattern in message_lower:
                pattern_score = max(pattern_score, 0.6)
        
        # Check for error indicators
        error_indicators = [
            'error', 'bug', 'problem', 'issue', 'trouble', 'wont', 'cant',
            'doesnt', 'not working', 'broken', 'crash', 'freeze'
        ]
        
        error_score = 0.0
        for indicator in error_indicators:
            if indicator in message_lower:
                error_score = 0.4
                break
        
        # Check for specific technical terms
        specific_tech_terms = [
            'javascript', 'html', 'css', 'api', 'database', 'server', 'ssl',
            'vpn', 'firewall', 'router', 'modem', 'driver', 'plugin', 'extension',
            'malware', 'virus', 'antivirus', 'backup', 'restore', 'sync'
        ]
        
        specific_score = 0.0
        for term in specific_tech_terms:
            if term in message_lower:
                specific_score = 0.7
                break
        
        # Check conversation history for technical context
        history_score = 0.0
        if context and context.get('history'):
            recent_messages = context['history'][-3:]
            for msg in recent_messages:
                if msg.get('role') == 'user':
                    hist_relevance = self.calculate_keyword_relevance(
                        msg.get('message', ''), self.tech_keywords
                    )
                    history_score = max(history_score, hist_relevance * 0.3)
        
        # Combine scores
        base_relevance = max(keyword_relevance, scenario_score, specific_score)
        
        # Boost for error content and technical patterns
        total_relevance = min(
            base_relevance + pattern_score + error_score + history_score, 
            1.0
        )
        
        # Threshold for relevance
        is_relevant = total_relevance >= 0.3
        
        self.logger.debug(f"Tech relevance: {total_relevance:.2f} (keyword: {keyword_relevance:.2f}, "
                         f"scenario: {scenario_score:.2f}, pattern: {pattern_score:.2f}, "
                         f"error: {error_score:.2f}, specific: {specific_score:.2f})")
        
        return is_relevant, total_relevance
    
    def identify_issue_category(self, message: str) -> str:
        """Categorize the technical issue"""
        message_lower = message.lower()
        
        # Check each scenario
        for scenario_name, keywords in self.scenarios.items():
            for keyword in keywords:
                if keyword in message_lower:
                    return scenario_name
        
        # Default categories based on keywords
        if any(word in message_lower for word in ['password', 'login', 'access']):
            return 'login_issue'
        elif any(word in message_lower for word in ['slow', 'lag', 'performance']):
            return 'performance_issue'
        elif any(word in message_lower for word in ['internet', 'wifi', 'connection']):
            return 'connection_issue'
        elif any(word in message_lower for word in ['install', 'setup', 'configure']):
            return 'setup_issue'
        elif any(word in message_lower for word in ['error', 'bug', 'not working']):
            return 'error_message'
        else:
            return 'general_technical'
    
    def get_troubleshooting_steps(self, issue_category: str) -> List[str]:
        """Get basic troubleshooting steps for common issues"""
        
        troubleshooting_guides = {
            'login_issue': [
                "1. Verify your username and password are correct",
                "2. Check if Caps Lock is on",
                "3. Try copying and pasting your credentials",
                "4. Clear your browser cookies and cache",
                "5. Try using an incognito/private browser window",
                "6. Reset your password if still unable to login"
            ],
            
            'connection_issue': [
                "1. Check if other devices can connect to internet",
                "2. Restart your router/modem (unplug for 30 seconds)",
                "3. Restart your device",
                "4. Check WiFi password is correct",
                "5. Move closer to your router",
                "6. Contact your internet service provider if issue persists"
            ],
            
            'performance_issue': [
                "1. Close unnecessary programs and browser tabs",
                "2. Restart the application",
                "3. Restart your device",
                "4. Check available storage space (need at least 10% free)",
                "5. Update the application to latest version",
                "6. Run disk cleanup and defragmentation"
            ],
            
            'setup_issue': [
                "1. Check system requirements are met",
                "2. Download from official source",
                "3. Run as administrator (Windows) or with sudo (Mac/Linux)",
                "4. Temporarily disable antivirus during installation",
                "5. Clear any previous installation files",
                "6. Follow installation wizard step by step"
            ],
            
            'error_message': [
                "1. Note down the exact error message",
                "2. Restart the application",
                "3. Check for software updates",
                "4. Clear application cache/data",
                "5. Restart your device",
                "6. Reinstall the application if error persists"
            ],
            
            'file_issue': [
                "1. Check file format is supported",
                "2. Verify file size limits",
                "3. Check available storage space",
                "4. Try a different browser or device",
                "5. Clear browser cache",
                "6. Check internet connection stability"
            ],
            
            'mobile_issue': [
                "1. Force close and restart the app",
                "2. Check for app updates in app store",
                "3. Restart your device",
                "4. Check available storage space",
                "5. Update your device's operating system",
                "6. Reinstall the app if problem continues"
            ]
        }
        
        return troubleshooting_guides.get(issue_category, [
            "1. Describe the exact problem you're experiencing",
            "2. Note any error messages word-for-word",
            "3. Try restarting the application",
            "4. Restart your device",
            "5. Check for software updates",
            "6. Contact technical support with specific details"
        ])
    
    def format_tech_response(self, issue_category: str, user_message: str = None) -> str:
        """Format a structured technical support response"""
        
        steps = self.get_troubleshooting_steps(issue_category)
        
        intro_messages = {
            'login_issue': "I'll help you resolve this login problem. Let's try these steps:",
            'connection_issue': "Let's troubleshoot your connection issue step by step:",
            'performance_issue': "I'll help you improve the performance. Here's what to try:",
            'setup_issue': "Let's get this installed properly. Follow these steps:",
            'error_message': "I'll help you resolve this error. Let's start with these steps:",
            'file_issue': "Let's solve this file-related issue:",
            'mobile_issue': "Let's fix this mobile app issue:"
        }
        
        intro = intro_messages.get(issue_category, "Let's troubleshoot this technical issue:")
        
        response = f"{intro}\n\n" + "\n".join(steps)
        response += "\n\nTry these steps in order and let me know what happens after each one. If you get stuck on any step, I'm here to help! 🔧"
        
        return response
    
    def get_system_requirements_check(self, software: str = None) -> str:
        """Provide system requirements checklist"""
        return """Before we proceed, let's check your system meets the requirements:

**Windows:**
- Windows 10 or later
- 4GB RAM minimum (8GB recommended)
- 1GB free disk space
- Internet connection

**Mac:**
- macOS 10.15 or later
- 4GB RAM minimum
- 1GB free disk space
- Internet connection

**Mobile:**
- Android 8.0+ or iOS 12.0+
- 100MB free storage
- Stable internet connection

Can you confirm your system meets these requirements?"""
    
    def suggest_advanced_troubleshooting(self, issue_category: str) -> bool:
        """Determine if advanced troubleshooting is needed"""
        advanced_categories = [
            'network_configuration',
            'server_issues',
            'database_problems',
            'api_integration',
            'security_configuration'
        ]
        return issue_category in advanced_categories
