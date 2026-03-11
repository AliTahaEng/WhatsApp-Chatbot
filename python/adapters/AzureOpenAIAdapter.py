"""
Azure OpenAI Adapter for Python
Implements ILLMProvider interface for Azure OpenAI
"""

import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any
from openai import AsyncAzureOpenAI

from core.interfaces.ILLMProvider import ILLMProvider, LLMResponse, LLMMessage

class AzureOpenAIAdapter(ILLMProvider):
    """Azure OpenAI implementation of ILLMProvider"""
    
    def __init__(self, container):
        self.container = container
        self.config = container.resolve('ConfigurationManager')
        self.logger = logging.getLogger(__name__)
        
        # Get Azure OpenAI configuration
        self.azure_config = self.config.get_section('llm.azureOpenAI')
        
        self.client = None
        self.is_initialized = False
        
        # Token pricing (approximate rates per 1M tokens)
        self.pricing = {
            'gpt-4': {'input': 30, 'output': 60},
            'gpt-4-turbo': {'input': 10, 'output': 30},
            'gpt-35-turbo': {'input': 0.5, 'output': 1.5}
        }

    async def initialize(self) -> bool:
        """Initialize Azure OpenAI client"""
        try:
            endpoint = self.azure_config.get('endpoint')
            api_key = self.azure_config.get('apiKey')
            deployment = self.azure_config.get('deployment')
            
            self.logger.info(f"🔧 Azure OpenAI config: endpoint={endpoint}, deployment={deployment}, apiKey={'set' if api_key else 'MISSING'}")
            
            if not all([endpoint, api_key, deployment]):
                missing = []
                if not endpoint: missing.append('endpoint')
                if not api_key: missing.append('apiKey')
                if not deployment: missing.append('deployment')
                raise ValueError(f"Missing required Azure OpenAI configuration: {', '.join(missing)}")

            self.client = AsyncAzureOpenAI(
                api_key=api_key,
                api_version=self.azure_config.get('apiVersion', '2024-02-01'),
                azure_endpoint=endpoint
            )
            
            self.is_initialized = True
            self.logger.info(f"✅ Azure OpenAI initialized: {deployment}")
            return True
            
        except Exception as e:
            self.logger.error(f"❌ Failed to initialize Azure OpenAI: {e}")
            return False

    async def _test_connection(self):
        """Test the Azure OpenAI connection"""
        try:
            response = await self.client.chat.completions.create(
                model=self.azure_config.get('deployment'),
                messages=[{"role": "user", "content": "Test"}],
                max_tokens=5
            )
            
            if not response.choices:
                raise ValueError("Invalid response from Azure OpenAI")
                
        except Exception as e:
            raise ConnectionError(f"Azure OpenAI connection test failed: {e}")

    async def is_ready(self) -> bool:
        """Check if provider is ready"""
        return self.is_initialized and self.client is not None

    def get_provider_name(self) -> str:
        """Get provider name"""
        return "Azure OpenAI"

    def get_model_name(self) -> str:
        """Get model name"""
        return self.azure_config.get('deployment', 'gpt-4')

    async def generate_response(
        self,
        messages: List[LLMMessage],
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
        **kwargs
    ) -> LLMResponse:
        """Generate response from messages"""
        if not await self.is_ready():
            raise RuntimeError("Azure OpenAI provider not ready")

        try:
            # Convert to OpenAI format
            openai_messages = [
                {
                    "role": msg.role,
                    "content": msg.content,
                    **({"name": msg.name} if msg.name else {})
                }
                for msg in messages
            ]

            # Make request
            response = await self.client.chat.completions.create(
                model=self.azure_config.get('deployment'),
                messages=openai_messages,
                max_tokens=max_tokens or self.azure_config.get('maxTokens', 4096),
                temperature=temperature or self.azure_config.get('temperature', 0.7),
                top_p=self.azure_config.get('topP', 0.95),
                **kwargs
            )

            # Format response
            choice = response.choices[0]
            usage = response.usage or {}

            return LLMResponse(
                content=choice.message.content or "",
                usage={
                    "prompt_tokens": usage.prompt_tokens or 0,
                    "completion_tokens": usage.completion_tokens or 0,
                    "total_tokens": usage.total_tokens or 0
                },
                model=response.model or self.get_model_name(),
                provider=self.get_provider_name(),
                finish_reason=choice.finish_reason or "stop",
                timestamp=datetime.utcnow().isoformat()
            )

        except Exception as e:
            self.logger.error(f"❌ Azure OpenAI generation failed: {e}")
            raise

    async def generate_with_tools(
        self,
        messages: List[LLMMessage],
        tools: List[Dict] = None,
        **kwargs
    ) -> LLMResponse:
        """Generate response with tool calling"""
        if not tools:
            return await self.generate_response(messages, **kwargs)

        try:
            # Convert tools to OpenAI format
            openai_tools = [
                {
                    "type": "function",
                    "function": {
                        "name": tool["name"],
                        "description": tool["description"],
                        "parameters": tool["parameters"]
                    }
                }
                for tool in tools
            ]

            # Convert messages
            openai_messages = [
                {"role": msg.role, "content": msg.content}
                for msg in messages
            ]

            response = await self.client.chat.completions.create(
                model=self.azure_config.get('deployment'),
                messages=openai_messages,
                tools=openai_tools,
                tool_choice="auto",
                **kwargs
            )

            choice = response.choices[0]
            usage = response.usage or {}

            # Handle tool calls if present
            content = choice.message.content or ""
            if choice.message.tool_calls:
                # Add tool calls to response
                content += f"\n\nTool calls: {len(choice.message.tool_calls)}"

            return LLMResponse(
                content=content,
                usage={
                    "prompt_tokens": usage.prompt_tokens or 0,
                    "completion_tokens": usage.completion_tokens or 0,
                    "total_tokens": usage.total_tokens or 0
                },
                model=response.model or self.get_model_name(),
                provider=self.get_provider_name(),
                finish_reason=choice.finish_reason or "stop",
                timestamp=datetime.utcnow().isoformat()
            )

        except Exception as e:
            self.logger.error(f"❌ Azure OpenAI tool generation failed: {e}")
            raise

    def get_autogen_config(self) -> Dict[str, Any]:
        """Get AutoGen compatible configuration"""
        return {
            "config_list": [{
                "model": self.azure_config.get('deployment'),
                "api_type": "azure",
                "api_base": self.azure_config.get('endpoint'),
                "api_key": self.azure_config.get('apiKey'),
                "api_version": self.azure_config.get('apiVersion')
            }],
            "temperature": self.azure_config.get('temperature', 0.7),
            "max_tokens": self.azure_config.get('maxTokens', 4096),
            "top_p": self.azure_config.get('topP', 0.95)
        }

    async def estimate_tokens(self, text: str) -> int:
        """Estimate token count (rough approximation)"""
        # Rough estimation: 1 token ≈ 0.75 words
        words = len(text.split())
        return int(words / 0.75)

    async def calculate_cost(self, input_tokens: int, output_tokens: int) -> Dict:
        """Calculate cost for token usage"""
        model_key = self.get_model_name().lower()
        rates = self.pricing.get('gpt-4', self.pricing['gpt-4'])  # Default
        
        for key, value in self.pricing.items():
            if key in model_key:
                rates = value
                break

        input_cost = (input_tokens / 1000000) * rates['input']
        output_cost = (output_tokens / 1000000) * rates['output']
        
        return {
            "input_cost": input_cost,
            "output_cost": output_cost,
            "total_cost": input_cost + output_cost,
            "currency": "USD"
        }

    async def supports_vision(self) -> bool:
        """Check if model supports vision"""
        model = self.get_model_name().lower()
        return 'vision' in model or 'gpt-4' in model

    async def supports_tools(self) -> bool:
        """Check if model supports function calling"""
        return True  # Most Azure OpenAI models support tools

    async def supports_streaming(self) -> bool:
        """Check if provider supports streaming"""
        return True

    async def get_health_status(self) -> Dict:
        """Get provider health status"""
        try:
            if await self.is_ready():
                await self._test_connection()
                status = "healthy"
            else:
                status = "not_ready"
        except Exception as e:
            status = f"unhealthy: {str(e)}"

        return {
            "provider": self.get_provider_name(),
            "model": self.get_model_name(),
            "status": status,
            "ready": await self.is_ready(),
            "endpoint": self.azure_config.get('endpoint', 'unknown'),
            "deployment": self.azure_config.get('deployment', 'unknown')
        }
