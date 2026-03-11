"""
Python Configuration Manager
Centralized configuration management for Python services
"""

import os
import json
import logging
from typing import Dict, Any, Optional
from pathlib import Path

try:
    import yaml  # type: ignore
except ImportError:  # pragma: no cover
    yaml = None

class ConfigurationManager:
    """Centralized configuration management for Python services"""
    
    def __init__(self, config_path: Optional[str] = None):
        self.config_path = config_path or os.getcwd()
        self.environment = os.getenv('NODE_ENV', 'development')
        self.config = {}
        self.logger = logging.getLogger(__name__)
        
        self.default_config = {
            # LLM Configuration
            'llm': {
                'provider': 'azure-openai',
                'azureOpenAI': {
                    'endpoint': os.getenv('AZURE_OPENAI_ENDPOINT'),
                    'apiKey': os.getenv('AZURE_OPENAI_API_KEY'),
                    'deployment': os.getenv('AZURE_OPENAI_DEPLOYMENT', 'gpt-4'),
                    'apiVersion': os.getenv('AZURE_OPENAI_API_VERSION', '2024-02-01'),
                    'maxTokens': int(os.getenv('AZURE_OPENAI_MAX_TOKENS', '4096')),
                    'temperature': float(os.getenv('AZURE_OPENAI_TEMPERATURE', '0.7')),
                    'topP': float(os.getenv('AZURE_OPENAI_TOP_P', '0.95'))
                },
                'claude': {
                    'apiKey': os.getenv('ANTHROPIC_API_KEY'),
                    'model': os.getenv('CLAUDE_MODEL', 'claude-3-sonnet-20240229'),
                    'maxTokens': int(os.getenv('CLAUDE_MAX_TOKENS', '4096')),
                    'temperature': float(os.getenv('CLAUDE_TEMPERATURE', '0.7'))
                }
            },
            
            # Agent Configuration
            'agents': {
                'maxRounds': int(os.getenv('MAX_ROUNDS', '10')),
                'enabledAgents': os.getenv('ENABLED_AGENTS', 'all').split(','),
                'defaultTimeout': int(os.getenv('AGENT_TIMEOUT', '60'))
            },
            
            # Plugin Configuration
            'plugins': {
                'enabled': os.getenv('PLUGINS_ENABLED', 'true').lower() == 'true',
                'directory': os.getenv('PLUGINS_DIRECTORY', './plugins'),
                'maxPlugins': int(os.getenv('MAX_PLUGINS', '50')),
                'timeout': int(os.getenv('PLUGIN_TIMEOUT', '30'))
            },
            
            # Performance Configuration
            'performance': {
                'maxConcurrentRequests': int(os.getenv('MAX_CONCURRENT_REQUESTS', '10')),
                'requestTimeout': int(os.getenv('REQUEST_TIMEOUT', '30')),
                'enableCaching': os.getenv('ENABLE_CACHING', 'true').lower() == 'true'
            },
            
            # Logging Configuration
            'logging': {
                'level': os.getenv('LOG_LEVEL', 'INFO'),
                'file': os.getenv('LOG_FILE', './logs/python.log'),
                'enableConsole': os.getenv('LOG_CONSOLE', 'true').lower() == 'true'
            }
        }

    async def initialize(self):
        """Initialize configuration manager"""
        try:
            # Load configurations in priority order
            await self._load_default_config()
            await self._load_file_config()
            await self._load_environment_config()
            
            self.logger.info(f"✅ Python Configuration initialized ({self.environment})")
            
        except Exception as e:
            self.logger.error(f"❌ Failed to initialize Python configuration: {e}")
            raise

    async def _load_default_config(self):
        """Load default configuration"""
        self.config = json.loads(json.dumps(self.default_config))  # Deep copy

    async def _load_file_config(self):
        """Load configuration from files"""
        config_files = [
            f'config.{self.environment}.json',
            'config.json',
            f'config.{self.environment}.yml', 
            'config.yml'
        ]
        
        for config_file in config_files:
            config_path = Path(self.config_path) / config_file
            
            if config_path.exists():
                try:
                    with open(config_path, 'r') as f:
                        if config_file.endswith('.yml') or config_file.endswith('.yaml'):
                            if yaml is None:
                                self.logger.warning(
                                    f"⚠️ Skipping YAML config {config_path} because PyYAML is not installed"
                                )
                                continue
                            file_config = yaml.safe_load(f)
                        else:
                            file_config = json.load(f)
                    
                    self.config = self._merge_deep(self.config, file_config)
                    self.logger.debug(f"📄 Loaded Python config: {config_path}")
                    
                except Exception as e:
                    self.logger.warn(f"⚠️ Failed to load {config_file}: {e}")

    async def _load_environment_config(self):
        """Load configuration from environment variables"""
        # Environment variables override file configuration
        env_mappings = {
            'LLM_PROVIDER': 'llm.provider',
            'AZURE_OPENAI_ENDPOINT': 'llm.azureOpenAI.endpoint',
            'AZURE_OPENAI_API_KEY': 'llm.azureOpenAI.apiKey',
            'AZURE_OPENAI_DEPLOYMENT': 'llm.azureOpenAI.deployment',
            'ANTHROPIC_API_KEY': 'llm.claude.apiKey',
            'MAX_ROUNDS': 'agents.maxRounds',
            'PLUGINS_ENABLED': 'plugins.enabled',
            'LOG_LEVEL': 'logging.level'
        }
        
        for env_var, config_path in env_mappings.items():
            value = os.getenv(env_var)
            if value is not None:
                self._set_nested_value(self.config, config_path, self._parse_value(value))

    def get(self, path: str, default_value: Any = None) -> Any:
        """Get configuration value by path"""
        return self._get_nested_value(self.config, path, default_value)

    def get_section(self, section: str) -> Dict:
        """Get entire configuration section"""
        return self.get(section, {})

    def set(self, path: str, value: Any):
        """Set configuration value"""
        self._set_nested_value(self.config, path, value)

    def _get_nested_value(self, obj: Dict, path: str, default: Any = None) -> Any:
        """Get nested dictionary value by dot path"""
        keys = path.split('.')
        current = obj
        
        for key in keys:
            if isinstance(current, dict) and key in current:
                current = current[key]
            else:
                return default
                
        return current

    def _set_nested_value(self, obj: Dict, path: str, value: Any):
        """Set nested dictionary value by dot path"""
        keys = path.split('.')
        current = obj
        
        for key in keys[:-1]:
            if key not in current:
                current[key] = {}
            current = current[key]
            
        current[keys[-1]] = value

    def _merge_deep(self, target: Dict, source: Dict) -> Dict:
        """Deep merge two dictionaries"""
        result = target.copy()
        
        for key, value in source.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = self._merge_deep(result[key], value)
            else:
                result[key] = value
                
        return result

    def _parse_value(self, value: str) -> Any:
        """Parse string value to appropriate type"""
        # Try JSON parsing first
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            pass
            
        # Parse boolean
        if value.lower() in ('true', 'false'):
            return value.lower() == 'true'
            
        # Parse number
        try:
            if '.' in value:
                return float(value)
            return int(value)
        except ValueError:
            pass
            
        # Return as string
        return value

    def get_all(self) -> Dict:
        """Get entire configuration"""
        return json.loads(json.dumps(self.config))  # Deep copy

    def get_summary(self) -> Dict:
        """Get configuration summary for debugging"""
        return {
            'environment': self.environment,
            'llm_provider': self.get('llm.provider'),
            'plugins_enabled': self.get('plugins.enabled'),
            'log_level': self.get('logging.level'),
            'config_sections': list(self.config.keys())
        }
