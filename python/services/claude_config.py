"""
Claude Configuration
Anthropic Claude API configuration for AutoGen integration
"""

import os
import asyncio
from anthropic import Anthropic
from typing import Dict, Any, Optional
import logging

class ClaudeConfig:
    """Configuration and testing for Claude API integration"""
    
    def __init__(self):
        self.api_key = os.getenv('ANTHROPIC_API_KEY')
        self.model = os.getenv('CLAUDE_MODEL', 'claude-3-5-sonnet-20241022')
        self.max_tokens = int(os.getenv('MAX_TOKENS', '2000'))
        self.temperature = float(os.getenv('TEMPERATURE', '0.7'))
        
        # Initialize Anthropic client
        if self.api_key:
            self.client = Anthropic(api_key=self.api_key)
        else:
            self.client = None
            logging.warning("⚠️ No Anthropic API key provided")
    
    def validate_api_key(self) -> bool:
        """Validate that API key is present and properly formatted"""
        if not self.api_key:
            return False
        
        # Basic format validation for Anthropic API keys
        if not self.api_key.startswith('sk-ant-'):
            return False
        
        return len(self.api_key) > 20
    
    async def test_connection(self) -> bool:
        """Test connection to Claude API"""
        if not self.client:
            return False
        
        try:
            # Simple test message
            response = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.client.messages.create(
                    model=self.model,
                    max_tokens=50,
                    messages=[{"role": "user", "content": "Hello, respond with just 'OK'"}]
                )
            )
            
            return bool(response.content)
            
        except Exception as e:
            logging.error(f"❌ Claude API test failed: {e}")
            return False
    
    def get_autogen_config(self) -> Dict[str, Any]:
        """Get configuration dict for AutoGen"""
        return {
            "config_list": [{
                "model": self.model,
                "api_key": self.api_key,
                "api_type": "anthropic",
                "temperature": self.temperature,
                "max_tokens": self.max_tokens,
            }],
            "timeout": int(os.getenv('API_TIMEOUT', '30')),
            "cache_seed": int(os.getenv('CACHE_SEED', '42')) if os.getenv('ENABLE_CACHING', 'true').lower() == 'true' else None,
        }
    
    def get_model_info(self) -> Dict[str, Any]:
        """Get information about the configured model"""
        return {
            'model': self.model,
            'max_tokens': self.max_tokens,
            'temperature': self.temperature,
            'api_key_configured': bool(self.api_key),
            'api_key_valid': self.validate_api_key()
        }
