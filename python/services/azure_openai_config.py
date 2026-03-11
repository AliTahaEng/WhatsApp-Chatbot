"""
Azure OpenAI Configuration
Manages Azure OpenAI GPT-4 API configuration and integration with AutoGen

This replaces the Claude configuration with Azure OpenAI for the multi-agent system.
"""

import os
import logging
from typing import Dict, Any, Optional
from openai import AzureOpenAI

logger = logging.getLogger(__name__)

class AzureOpenAIConfig:
    """Azure OpenAI API configuration and validation"""
    
    def __init__(self):
        self.endpoint = os.getenv('AZURE_OPENAI_ENDPOINT')
        self.deployment = os.getenv('AZURE_OPENAI_DEPLOYMENT', 'gpt-4.1')
        self.api_key = os.getenv('AZURE_OPENAI_API_KEY')
        self.api_version = os.getenv('AZURE_OPENAI_API_VERSION', '2024-12-01-preview')
        self.resource_name = os.getenv('AZURE_OPENAI_RESOURCE_NAME', 'optimusrcm')
        
        # Model configuration
        self.model_name = self.deployment
        self.max_tokens = int(os.getenv('AZURE_OPENAI_MAX_TOKENS', '4096'))
        self.temperature = float(os.getenv('AZURE_OPENAI_TEMPERATURE', '0.7'))
        self.top_p = float(os.getenv('AZURE_OPENAI_TOP_P', '0.95'))
        
        # Validate configuration
        self._validate_config()
        
        # Initialize client
        self.client = None
        self._initialize_client()
        
        logger.info(f"🤖 Azure OpenAI configured: {self.deployment} at {self.endpoint}")
    
    def _validate_config(self):
        """Validate required Azure OpenAI configuration"""
        if not self.api_key:
            raise ValueError("AZURE_OPENAI_API_KEY environment variable is required")
        
        if not self.endpoint:
            raise ValueError("AZURE_OPENAI_ENDPOINT environment variable is required")
        
        if not self.deployment:
            raise ValueError("AZURE_OPENAI_DEPLOYMENT environment variable is required")
        
        # Validate endpoint format
        if not self.endpoint.startswith('https://'):
            raise ValueError("AZURE_OPENAI_ENDPOINT must start with https://")
        
        if not self.endpoint.endswith('/'):
            self.endpoint += '/'
        
        logger.info("✅ Azure OpenAI configuration validated")
    
    def _initialize_client(self):
        """Initialize Azure OpenAI client"""
        try:
            self.client = AzureOpenAI(
                api_key=self.api_key,
                api_version=self.api_version,
                azure_endpoint=self.endpoint
            )
            logger.info("✅ Azure OpenAI client initialized")
        except Exception as e:
            logger.error(f"❌ Failed to initialize Azure OpenAI client: {e}")
            raise
    
    def test_connection(self) -> bool:
        """Test Azure OpenAI API connection"""
        try:
            logger.info("🔍 Testing Azure OpenAI connection...")
            
            response = self.client.chat.completions.create(
                model=self.deployment,
                messages=[
                    {"role": "system", "content": "You are a helpful assistant."},
                    {"role": "user", "content": "Say 'Connection successful' if you can read this."}
                ],
                max_tokens=50,
                temperature=0.3
            )
            
            result = response.choices[0].message.content
            logger.info(f"✅ Azure OpenAI connection successful: {result}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Azure OpenAI connection test failed: {e}")
            return False
    
    def get_autogen_config(self) -> Dict[str, Any]:
        """
        Get AutoGen-compatible configuration for Azure OpenAI
        
        Returns:
            Dict with AutoGen LLM configuration
        """
        config = {
            "model": self.deployment,
            "api_type": "azure",
            "api_key": self.api_key,
            "base_url": self.endpoint,
            "api_version": self.api_version,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "top_p": self.top_p,
            "frequency_penalty": 0.0,
            "presence_penalty": 0.0,
            "timeout": 60,
            "cache_seed": None  # Disable caching for dynamic responses
        }
        
        return config
    
    def get_llm_config(self, 
                       temperature: Optional[float] = None,
                       max_tokens: Optional[int] = None,
                       system_message: Optional[str] = None) -> Dict[str, Any]:
        """
        Get customized LLM configuration for specific agents
        
        Args:
            temperature: Override default temperature
            max_tokens: Override default max tokens
            system_message: System message for the agent
        
        Returns:
            Dict with LLM configuration
        """
        config = self.get_autogen_config()
        
        if temperature is not None:
            config['temperature'] = temperature
        
        if max_tokens is not None:
            config['max_tokens'] = max_tokens
        
        llm_config = {
            "config_list": [config],
            "timeout": 60,
            "cache_seed": None
        }
        
        if system_message:
            llm_config['system_message'] = system_message
        
        return llm_config
    
    def create_chat_completion(self,
                              messages: list,
                              temperature: Optional[float] = None,
                              max_tokens: Optional[int] = None,
                              stream: bool = False) -> Any:
        """
        Create a chat completion using Azure OpenAI
        
        Args:
            messages: List of message dicts with 'role' and 'content'
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate
            stream: Whether to stream the response
        
        Returns:
            Chat completion response
        """
        try:
            response = self.client.chat.completions.create(
                model=self.deployment,
                messages=messages,
                temperature=temperature or self.temperature,
                max_tokens=max_tokens or self.max_tokens,
                top_p=self.top_p,
                stream=stream
            )
            
            return response
            
        except Exception as e:
            logger.error(f"❌ Azure OpenAI chat completion failed: {e}")
            raise
    
    def estimate_tokens(self, text: str) -> int:
        """
        Estimate token count for text (rough approximation)
        
        Args:
            text: Input text
        
        Returns:
            Estimated token count
        """
        # Rough estimation: ~4 characters per token for English
        return len(text) // 4
    
    def calculate_cost(self, input_tokens: int, output_tokens: int) -> float:
        """
        Calculate estimated cost for Azure OpenAI usage
        
        Args:
            input_tokens: Number of input tokens
            output_tokens: Number of output tokens
        
        Returns:
            Estimated cost in USD
        """
        # Azure OpenAI GPT-4 pricing (approximate, check current pricing)
        # These are example rates - update with actual Azure pricing
        input_cost_per_1k = 0.03  # $0.03 per 1K input tokens
        output_cost_per_1k = 0.06  # $0.06 per 1K output tokens
        
        input_cost = (input_tokens / 1000) * input_cost_per_1k
        output_cost = (output_tokens / 1000) * output_cost_per_1k
        
        return input_cost + output_cost
    
    def get_model_info(self) -> Dict[str, Any]:
        """Get information about the configured model"""
        return {
            'provider': 'Azure OpenAI',
            'model': self.deployment,
            'endpoint': self.endpoint,
            'resource': self.resource_name,
            'api_version': self.api_version,
            'max_tokens': self.max_tokens,
            'temperature': self.temperature,
            'top_p': self.top_p
        }
    
    def get_available_models(self) -> list:
        """
        Get list of available models (if API supports it)
        
        Returns:
            List of available model names
        """
        try:
            # Azure OpenAI doesn't have a direct list models endpoint
            # Return the configured deployment
            return [self.deployment]
        except Exception as e:
            logger.warning(f"Could not retrieve available models: {e}")
            return [self.deployment]
    
    def validate_message_format(self, messages: list) -> bool:
        """
        Validate message format for Azure OpenAI
        
        Args:
            messages: List of message dicts
        
        Returns:
            True if valid, False otherwise
        """
        if not isinstance(messages, list):
            return False
        
        for msg in messages:
            if not isinstance(msg, dict):
                return False
            
            if 'role' not in msg or 'content' not in msg:
                return False
            
            if msg['role'] not in ['system', 'user', 'assistant', 'function']:
                return False
        
        return True
    
    def format_error_message(self, error: Exception) -> str:
        """
        Format Azure OpenAI error messages for user display
        
        Args:
            error: Exception from Azure OpenAI
        
        Returns:
            User-friendly error message
        """
        error_str = str(error).lower()
        
        if 'rate limit' in error_str or 'quota' in error_str:
            return "I'm experiencing high demand right now. Please try again in a moment."
        elif 'timeout' in error_str:
            return "The request took too long to process. Please try a simpler question."
        elif 'authentication' in error_str or 'api key' in error_str:
            return "There's a configuration issue. Please contact support."
        elif 'content filter' in error_str or 'content policy' in error_str:
            return "Your message was flagged by content filters. Please rephrase your question."
        else:
            return "I encountered an error processing your request. Please try again."
    
    def __repr__(self):
        return f"AzureOpenAIConfig(deployment={self.deployment}, endpoint={self.endpoint[:30]}...)"


# Global instance
_azure_config = None

def get_azure_openai_config() -> AzureOpenAIConfig:
    """Get or create global Azure OpenAI configuration instance"""
    global _azure_config
    
    if _azure_config is None:
        _azure_config = AzureOpenAIConfig()
    
    return _azure_config


def test_azure_openai_setup():
    """Test Azure OpenAI setup and configuration"""
    try:
        config = get_azure_openai_config()
        
        print("🔧 Azure OpenAI Configuration:")
        print(f"  Endpoint: {config.endpoint}")
        print(f"  Deployment: {config.deployment}")
        print(f"  API Version: {config.api_version}")
        print(f"  Resource: {config.resource_name}")
        print(f"  Max Tokens: {config.max_tokens}")
        print(f"  Temperature: {config.temperature}")
        print("")
        
        # Test connection
        if config.test_connection():
            print("✅ Azure OpenAI is configured correctly and working!")
            return True
        else:
            print("❌ Azure OpenAI connection test failed")
            return False
            
    except Exception as e:
        print(f"❌ Azure OpenAI setup test failed: {e}")
        return False


if __name__ == "__main__":
    # Run test if executed directly
    test_azure_openai_setup()
