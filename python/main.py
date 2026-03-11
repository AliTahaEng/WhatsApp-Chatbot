#!/usr/bin/env python3

"""
WhatsApp AutoGen Bot - Python Main Entry Point
Multi-Agent AI System using AutoGen and Azure OpenAI GPT-4

This is the Python side of the inter-process communication bridge.
It receives messages from Node.js and processes them using AutoGen agents.
"""

import sys
import json
import asyncio
import logging
import os
from pathlib import Path

# Add project root to Python path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from services.agent_orchestrator import AgentOrchestrator
from services.azure_openai_config import AzureOpenAIConfig
from utils.logger import setup_logging
from utils.error_handler import ErrorHandler

class BridgeServer:
    """
    Main bridge server that handles communication with Node.js
    """
    
    def __init__(self):
        # Setup logging
        self.logger = setup_logging()
        
        # Initialize error handler
        self.error_handler = ErrorHandler(self.logger)
        
        # Initialize Azure OpenAI configuration
        self.azure_openai_config = AzureOpenAIConfig()
        
        # Initialize agent orchestrator
        self.orchestrator = None
        
        # Performance tracking
        self.request_count = 0
        self.start_time = asyncio.get_event_loop().time()
        
        self.logger.info("🐍 Python Bridge Server initializing...")
    
    async def initialize(self):
        """Initialize the orchestrator and all agents"""
        try:
            # Test Azure OpenAI connection
            if not self.azure_openai_config.test_connection():
                raise ValueError("Azure OpenAI connection test failed")
            
            # Initialize orchestrator
            self.orchestrator = AgentOrchestrator(
                azure_openai_config=self.azure_openai_config,
                logger=self.logger
            )
            
            await self.orchestrator.initialize()
            
            self.logger.info("✅ Agent orchestrator initialized successfully")
            return True
            
        except Exception as e:
            self.logger.error(f"❌ Failed to initialize orchestrator: {e}")
            return False
    
    async def handle_request(self, request):
        """Handle incoming request from Node.js"""
        request_id = request.get('id', 'unknown')
        
        try:
            request_type = request.get('type')
            data = request.get('data', {})
            
            self.logger.debug(f"📥 Processing request {request_id}: {request_type}")
            
            if request_type == 'process_message':
                result = await self.process_message(data)
                
            elif request_type == 'health_check':
                result = await self.health_check()
                
            elif request_type == 'get_stats':
                result = await self.get_stats()
                
            elif request_type == 'reset_agents':
                result = await self.reset_agents()
                
            elif request_type == 'shutdown':
                result = await self.shutdown()
                
            else:
                raise ValueError(f"Unknown request type: {request_type}")
            
            # Send success response
            response = {
                'id': request_id,
                'result': result,
                'timestamp': asyncio.get_event_loop().time(),
                'status': 'success'
            }
            
            self.send_response(response)
            self.request_count += 1
            
        except Exception as e:
            # Send error response
            error_response = {
                'id': request_id,
                'error': str(e),
                'timestamp': asyncio.get_event_loop().time(),
                'status': 'error'
            }
            
            self.send_response(error_response)
            self.logger.error(f"❌ Request {request_id} failed: {e}")
    
    async def process_message(self, data):
        """Process a message using the agent orchestrator"""
        try:
            message = data.get('message', '')
            context = data.get('context', {})
            
            if not message.strip():
                raise ValueError("Empty message received")
            
            # Process through agent orchestrator
            result = await self.orchestrator.process_message(message, context)
            
            return {
                'response': result.get('response', ''),
                'agentName': result.get('agent_name', 'unknown'),
                'tokensUsed': result.get('tokens_used', 0),
                'processingTime': result.get('processing_time', 0),
                'confidence': result.get('confidence', 0.0),
                'metadata': result.get('metadata', {})
            }
            
        except Exception as e:
            self.logger.error(f"❌ Error processing message: {e}")
            raise
    
    async def health_check(self):
        """Perform health check"""
        try:
            health_status = {
                'status': 'healthy',
                'uptime': asyncio.get_event_loop().time() - self.start_time,
                'requests_processed': self.request_count,
                'orchestrator_ready': self.orchestrator is not None,
                'claude_api_status': await self.claude_config.test_connection(),
                'agents_status': {}
            }
            
            if self.orchestrator:
                health_status['agents_status'] = await self.orchestrator.get_agent_health()
            
            return health_status
            
        except Exception as e:
            self.logger.error(f"❌ Health check failed: {e}")
            return {
                'status': 'unhealthy',
                'error': str(e)
            }
    
    async def get_stats(self):
        """Get system statistics"""
        try:
            stats = {
                'uptime': asyncio.get_event_loop().time() - self.start_time,
                'requests_processed': self.request_count,
                'memory_usage': self.get_memory_usage(),
                'orchestrator_stats': {}
            }
            
            if self.orchestrator:
                stats['orchestrator_stats'] = await self.orchestrator.get_stats()
            
            return stats
            
        except Exception as e:
            self.logger.error(f"❌ Failed to get stats: {e}")
            return {'error': str(e)}
    
    async def reset_agents(self):
        """Reset all agents"""
        try:
            if self.orchestrator:
                await self.orchestrator.reset_agents()
            
            return {'status': 'success', 'message': 'Agents reset successfully'}
            
        except Exception as e:
            self.logger.error(f"❌ Failed to reset agents: {e}")
            return {'error': str(e)}
    
    async def shutdown(self):
        """Graceful shutdown"""
        try:
            self.logger.info("🛑 Shutting down Python bridge server...")
            
            if self.orchestrator:
                await self.orchestrator.cleanup()
            
            return {'status': 'success', 'message': 'Shutdown complete'}
            
        except Exception as e:
            self.logger.error(f"❌ Shutdown error: {e}")
            return {'error': str(e)}
    
    def send_response(self, response):
        """Send response to Node.js via stdout"""
        try:
            response_json = json.dumps(response, ensure_ascii=False)
            print(response_json, flush=True)
            
        except Exception as e:
            self.logger.error(f"❌ Failed to send response: {e}")
            # Try to send error response
            try:
                error_response = {
                    'id': response.get('id', 'unknown'),
                    'error': f"Failed to serialize response: {str(e)}",
                    'status': 'error'
                }
                print(json.dumps(error_response), flush=True)
            except:
                pass  # Give up
    
    def get_memory_usage(self):
        """Get current memory usage"""
        try:
            import psutil
            process = psutil.Process()
            memory_info = process.memory_info()
            
            return {
                'rss': memory_info.rss,
                'vms': memory_info.vms,
                'percent': process.memory_percent(),
                'available': psutil.virtual_memory().available
            }
        except ImportError:
            return {'error': 'psutil not available'}
        except Exception as e:
            return {'error': str(e)}
    
    async def run(self):
        """Main event loop - read from stdin and process requests"""
        self.logger.info("🚀 Python Bridge Server starting main loop...")
        
        # Initialize orchestrator
        if not await self.initialize():
            self.logger.error("❌ Failed to initialize. Exiting.")
            return
        
        self.logger.info("✅ Python Bridge Server ready for requests")
        
        try:
            while True:
                # Read line from stdin (blocking)
                line = await asyncio.get_event_loop().run_in_executor(
                    None, sys.stdin.readline
                )
                
                if not line:
                    self.logger.info("📴 EOF received, shutting down...")
                    break
                
                line = line.strip()
                if not line:
                    continue
                
                try:
                    request = json.loads(line)
                    await self.handle_request(request)
                    
                except json.JSONDecodeError as e:
                    self.logger.error(f"❌ Invalid JSON received: {e}")
                    self.send_response({
                        'id': 'unknown',
                        'error': f'Invalid JSON: {str(e)}',
                        'status': 'error'
                    })
                
                except Exception as e:
                    self.logger.error(f"❌ Request handling error: {e}")
                    self.send_response({
                        'id': 'unknown',
                        'error': f'Request handling error: {str(e)}',
                        'status': 'error'
                    })
        
        except KeyboardInterrupt:
            self.logger.info("🛑 Keyboard interrupt received")
        
        except Exception as e:
            self.logger.error(f"💥 Fatal error in main loop: {e}")
        
        finally:
            await self.shutdown()
            self.logger.info("👋 Python Bridge Server stopped")

def main():
    """Main entry point"""
    try:
        # Setup asyncio event loop
        if sys.platform == 'win32':
            asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
        
        # Create and run server
        server = BridgeServer()
        asyncio.run(server.run())
        
    except Exception as e:
        print(f"FATAL ERROR: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
