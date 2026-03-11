"""
Python Application Bootstrap
Refactored Python application using flexible architecture with DI
"""

import asyncio
import logging
import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from core.container.ServiceContainer import ServiceContainer
from core.config.ConfigurationManager import ConfigurationManager
from adapters.AzureOpenAIAdapter import AzureOpenAIAdapter
from services.ModernAgentOrchestrator import ModernAgentOrchestrator
from services.ResearchService import ResearchService
from utils.logger import setup_logging

class PythonApplication:
    """Modern Python application with flexible architecture"""
    
    def __init__(self):
        self.container = ServiceContainer()
        self.config = None
        self.logger = None
        self.orchestrator = None
        self.is_initialized = False
        self.is_running = False

    async def initialize(self):
        """Initialize the application with DI architecture"""
        try:
            # Setup logging first
            self.logger = setup_logging()
            self.logger.info("🐍 Initializing Python Application with modern architecture...")

            # Phase 1: Configuration Management
            await self._initialize_configuration()
            
            # Phase 2: Register Services
            await self._register_services()
            
            # Phase 3: Initialize Core Services
            await self._initialize_services()
            
            self.is_initialized = True
            self.logger.info("✅ Python Application initialized successfully")
            
        except Exception as e:
            if self.logger:
                self.logger.error(f"❌ Failed to initialize Python application: {e}")
            raise

    async def _initialize_configuration(self):
        """Initialize configuration management"""
        self.config = ConfigurationManager()
        await self.config.initialize()
        
        # Register in container
        self.container.instance('ConfigurationManager', self.config)

    async def _register_services(self):
        """Register services in DI container"""
        
        # LLM Provider — create once and register as instance (singleton)
        config = self.container.resolve('ConfigurationManager')
        llm_config = config.get_section('llm')
        provider_type = llm_config.get('provider', 'azure-openai')
        
        if provider_type == 'azure-openai':
            llm_provider = AzureOpenAIAdapter(self.container)
        elif provider_type == 'claude':
            from adapters.ClaudeAdapter import ClaudeAdapter
            llm_provider = ClaudeAdapter(self.container)
        else:
            raise ValueError(f"Unknown LLM provider: {provider_type}")
        
        self.container.instance('ILLMProvider', llm_provider)
        
        # Agent Orchestrator
        self.container.singleton('AgentOrchestrator', ModernAgentOrchestrator)
        
        # Research Service (web research with DuckDuckGo + BeautifulSoup)
        self.container.instance('IResearchService', ResearchService(self.container))
        
        self.logger.info("✅ Services registered in DI container")

    async def _initialize_services(self):
        """Initialize core services"""
        
        # Initialize LLM Provider
        llm_provider = self.container.resolve('ILLMProvider')
        await llm_provider.initialize()
        
        # Initialize Agent Orchestrator
        self.orchestrator = self.container.resolve('AgentOrchestrator')
        await self.orchestrator.initialize()
        
        self.logger.info("✅ Core services initialized")

    async def start(self):
        """Start the application"""
        if not self.is_initialized:
            raise RuntimeError("Application must be initialized before starting")
        
        try:
            self.logger.info("🚀 Starting Python Application...")
            
            # Start message processing loop
            await self._start_message_loop()
            
            self.is_running = True
            self.logger.info("✅ Python Application started successfully")
            
        except Exception as e:
            self.logger.error(f"❌ Failed to start Python application: {e}")
            raise

    async def _start_message_loop(self):
        """Start the message processing loop for Node.js bridge"""
        self.logger.info("🔄 Starting message processing loop...")
        
        while True:
            try:
                # Read from stdin (Node.js bridge communication)
                line = await asyncio.get_event_loop().run_in_executor(
                    None, sys.stdin.readline
                )
                
                if not line:
                    break
                    
                # Process the request
                await self._handle_bridge_request(line.strip())
                
            except KeyboardInterrupt:
                break
            except Exception as e:
                self.logger.error(f"❌ Error in message loop: {e}")

    async def _handle_bridge_request(self, request_line: str):
        """Handle request from Node.js bridge"""
        request = None
        request_id = 'unknown'
        try:
            import json
            
            request = json.loads(request_line)
            request_id = request.get('id', 'unknown')
            request_type = request.get('type')
            data = request.get('data', {})
            
            self.logger.debug(f"📥 Processing request {request_id}: {request_type}")
            
            result = None
            
            if request_type == 'process_message':
                result = await self.orchestrator.process_message(
                    data.get('message', ''),
                    data.get('context', {})
                )
            elif request_type == 'web_research':
                # Dedicated research request from Node.js WebSearchPlugin
                research_service = self.container.resolve('IResearchService')
                result = await research_service.research(
                    data.get('query', ''),
                    data.get('options', {})
                )
            elif request_type == 'health_check':
                result = await self._health_check()
            elif request_type == 'get_stats':
                result = await self._get_stats()
            else:
                raise ValueError(f"Unknown request type: {request_type}")
            
            # Send response
            response = {
                'id': request_id,
                'result': result,
                'status': 'success',
                'timestamp': asyncio.get_event_loop().time()
            }
            
            print(json.dumps(response))
            sys.stdout.flush()
            
        except Exception as e:
            # Send error response
            error_response = {
                'id': request_id,
                'error': str(e),
                'status': 'error',
                'timestamp': asyncio.get_event_loop().time()
            }
            
            print(json.dumps(error_response))
            sys.stdout.flush()
            
            if self.logger:
                self.logger.error(f"❌ Request processing failed: {e}")
            else:
                print(f"[Python] Request processing failed: {e}", file=sys.stderr)

    async def stop(self):
        """Stop the application gracefully"""
        if self.logger:
            self.logger.info("🛑 Stopping Python Application...")
        else:
            print("[Python] Stopping Python Application...", file=sys.stderr)
        self.is_running = False
        if self.logger:
            self.logger.info("✅ Python Application stopped")
        else:
            print("[Python] Python Application stopped", file=sys.stderr)

    async def _health_check(self):
        """Perform health check"""
        try:
            llm_provider = self.container.resolve('ILLMProvider')
            llm_status = await llm_provider.get_health_status()
            
            return {
                'status': 'healthy',
                'llm_provider': llm_status,
                'services': self.container.get_registered_services(),
                'config_summary': self.config.get_summary()
            }
            
        except Exception as e:
            return {
                'status': 'unhealthy',
                'error': str(e)
            }

    async def _get_stats(self):
        """Get application statistics"""
        return {
            'initialized': self.is_initialized,
            'running': self.is_running,
            'services': len(self.container.get_registered_services()),
            'config_summary': self.config.get_summary() if self.config else {},
            'orchestrator_metrics': await self.orchestrator.get_metrics() if self.orchestrator else {}
        }

    def get_container(self):
        """Get the DI container"""
        return self.container

    def get_config(self):
        """Get the configuration manager"""
        return self.config

# Main entry point
async def main():
    """Main application entry point"""
    app = PythonApplication()
    
    try:
        await app.initialize()
        await app.start()
        
    except KeyboardInterrupt:
        print("\n[Python] Received interrupt signal", file=sys.stderr)
    except Exception as e:
        print(f"[Python] Application error: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        await app.stop()

if __name__ == "__main__":
    asyncio.run(main())
