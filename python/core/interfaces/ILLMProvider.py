"""
ILLMProvider - Python Interface for Language Model Providers
Enables switching between Azure OpenAI, Claude, local models, etc.
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Any
from dataclasses import dataclass

@dataclass
class LLMResponse:
    content: str
    usage: Dict[str, int]
    model: str
    provider: str
    finish_reason: str = "stop"
    timestamp: str = None

@dataclass
class LLMMessage:
    role: str
    content: str
    name: Optional[str] = None

class ILLMProvider(ABC):
    """Abstract interface for Language Model providers"""
    
    @abstractmethod
    async def initialize(self) -> bool:
        """Initialize the provider and test connection"""
        pass
    
    @abstractmethod
    async def is_ready(self) -> bool:
        """Check if provider is ready to handle requests"""
        pass
    
    @abstractmethod
    def get_provider_name(self) -> str:
        """Get the provider name (e.g., 'Azure OpenAI', 'Claude')"""
        pass
    
    @abstractmethod
    def get_model_name(self) -> str:
        """Get the current model name"""
        pass
    
    @abstractmethod
    async def generate_response(
        self, 
        messages: List[LLMMessage], 
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
        **kwargs
    ) -> LLMResponse:
        """Generate response from messages"""
        pass
    
    @abstractmethod
    async def generate_with_tools(
        self,
        messages: List[LLMMessage],
        tools: List[Dict] = None,
        **kwargs
    ) -> LLMResponse:
        """Generate response with tool calling support"""
        pass
    
    @abstractmethod
    def get_autogen_config(self) -> Dict[str, Any]:
        """Get configuration for AutoGen compatibility"""
        pass
    
    @abstractmethod
    async def estimate_tokens(self, text: str) -> int:
        """Estimate token count for text"""
        pass
    
    @abstractmethod
    async def calculate_cost(self, input_tokens: int, output_tokens: int) -> Dict:
        """Calculate cost for token usage"""
        pass
    
    # Optional methods with default implementations
    async def supports_vision(self) -> bool:
        """Check if provider supports vision/image analysis"""
        return False
    
    async def supports_tools(self) -> bool:
        """Check if provider supports function/tool calling"""
        return False
    
    async def supports_streaming(self) -> bool:
        """Check if provider supports streaming responses"""
        return False
    
    async def get_health_status(self) -> Dict:
        """Get provider health status"""
        return {
            "provider": self.get_provider_name(),
            "model": self.get_model_name(),
            "status": "unknown",
            "ready": await self.is_ready()
        }
