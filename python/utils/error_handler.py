"""
Error Handler
Comprehensive error handling and recovery system for Python AI agents

Provides:
- Structured error handling
- Error categorization and severity
- Recovery strategies
- Error reporting and logging
"""

import sys
import traceback
import logging
from typing import Dict, Any, Optional, Callable
from datetime import datetime
from enum import Enum

class ErrorSeverity(Enum):
    """Error severity levels"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class ErrorCategory(Enum):
    """Error categories"""
    AGENT_ERROR = "agent_error"
    LLM_ERROR = "llm_error"
    NETWORK_ERROR = "network_error"
    VALIDATION_ERROR = "validation_error"
    CONFIGURATION_ERROR = "configuration_error"
    SYSTEM_ERROR = "system_error"
    USER_INPUT_ERROR = "user_input_error"
    TIMEOUT_ERROR = "timeout_error"
    RATE_LIMIT_ERROR = "rate_limit_error"

class ErrorHandler:
    """Centralized error handling system"""
    
    def __init__(self, logger: logging.Logger):
        self.logger = logger
        self.error_counts = {}
        self.error_history = []
        self.max_history_size = 1000
        
        # Recovery strategies
        self.recovery_strategies = {
            ErrorCategory.AGENT_ERROR: self._recover_agent_error,
            ErrorCategory.LLM_ERROR: self._recover_llm_error,
            ErrorCategory.NETWORK_ERROR: self._recover_network_error,
            ErrorCategory.TIMEOUT_ERROR: self._recover_timeout_error,
            ErrorCategory.RATE_LIMIT_ERROR: self._recover_rate_limit_error,
            ErrorCategory.VALIDATION_ERROR: self._recover_validation_error,
            ErrorCategory.CONFIGURATION_ERROR: self._recover_configuration_error,
        }
        
        # User-friendly error messages
        self.user_messages = {
            ErrorCategory.AGENT_ERROR: "I encountered an internal issue while processing your request.",
            ErrorCategory.LLM_ERROR: "I'm having trouble with my language processing. Please try rephrasing your message.",
            ErrorCategory.NETWORK_ERROR: "I'm experiencing connectivity issues. Please try again in a moment.",
            ErrorCategory.TIMEOUT_ERROR: "Your request is taking longer than expected. Let me try a different approach.",
            ErrorCategory.RATE_LIMIT_ERROR: "I'm receiving too many requests right now. Please wait a moment before trying again.",
            ErrorCategory.VALIDATION_ERROR: "There was an issue with the information provided. Could you please clarify?",
            ErrorCategory.CONFIGURATION_ERROR: "I'm experiencing a configuration issue. Please contact support if this persists.",
            ErrorCategory.SYSTEM_ERROR: "I encountered a system error. Please try again shortly.",
            ErrorCategory.USER_INPUT_ERROR: "I'm having trouble understanding your request. Could you please rephrase it?"
        }
    
    def handle_error(self, 
                    error: Exception, 
                    context: Dict[str, Any] = None, 
                    user_message: str = None,
                    attempt_recovery: bool = True) -> Dict[str, Any]:
        """
        Handle an error with comprehensive logging and recovery
        
        Args:
            error: The exception that occurred
            context: Additional context about the error
            user_message: The user message that caused the error (if applicable)
            attempt_recovery: Whether to attempt automatic recovery
        
        Returns:
            Dict with error info and recovery status
        """
        try:
            # Categorize the error
            category, severity = self._categorize_error(error, context)
            
            # Create error record
            error_record = self._create_error_record(
                error, category, severity, context, user_message
            )
            
            # Log the error
            self._log_error(error_record)
            
            # Store in history
            self._store_error_history(error_record)
            
            # Update error counts
            self._update_error_counts(category, severity)
            
            # Attempt recovery if requested
            recovery_result = None
            if attempt_recovery:
                recovery_result = self._attempt_recovery(error, category, context)
            
            # Generate user-friendly response
            user_response = self._generate_user_response(category, error, user_message)
            
            return {
                'error_id': error_record['id'],
                'category': category.value,
                'severity': severity.value,
                'user_message': user_response,
                'recovery_attempted': attempt_recovery,
                'recovery_result': recovery_result,
                'should_retry': self._should_retry(category, severity),
                'escalate': self._should_escalate(category, severity),
                'timestamp': error_record['timestamp']
            }
            
        except Exception as handling_error:
            # Error in error handling - fallback to basic logging
            self.logger.critical(f"Error in error handler: {handling_error}")
            self.logger.critical(f"Original error: {error}")
            
            return {
                'error_id': 'error_handler_failure',
                'category': 'system_error',
                'severity': 'critical',
                'user_message': "I encountered a critical error. Please contact support.",
                'recovery_attempted': False,
                'recovery_result': None,
                'should_retry': False,
                'escalate': True,
                'timestamp': datetime.utcnow().isoformat()
            }
    
    def _categorize_error(self, error: Exception, context: Dict = None) -> tuple:
        """Categorize error and determine severity"""
        error_type = type(error).__name__
        error_message = str(error).lower()
        
        # LLM/API related errors
        if any(term in error_message for term in ['anthropic', 'api', 'claude', 'model']):
            if 'rate limit' in error_message or 'quota' in error_message:
                return ErrorCategory.RATE_LIMIT_ERROR, ErrorSeverity.MEDIUM
            elif 'timeout' in error_message:
                return ErrorCategory.TIMEOUT_ERROR, ErrorSeverity.MEDIUM
            else:
                return ErrorCategory.LLM_ERROR, ErrorSeverity.HIGH
        
        # Network errors
        elif any(term in error_message for term in ['connection', 'network', 'timeout', 'dns', 'ssl']):
            return ErrorCategory.NETWORK_ERROR, ErrorSeverity.MEDIUM
        
        # Configuration errors
        elif any(term in error_message for term in ['config', 'environment', 'missing', 'not found']):
            return ErrorCategory.CONFIGURATION_ERROR, ErrorSeverity.HIGH
        
        # Validation errors
        elif error_type in ['ValueError', 'TypeError', 'KeyError', 'AttributeError']:
            if context and context.get('user_input'):
                return ErrorCategory.USER_INPUT_ERROR, ErrorSeverity.LOW
            else:
                return ErrorCategory.VALIDATION_ERROR, ErrorSeverity.MEDIUM
        
        # Agent-specific errors
        elif 'agent' in error_message or context and 'agent' in str(context):
            return ErrorCategory.AGENT_ERROR, ErrorSeverity.MEDIUM
        
        # Timeout errors
        elif 'timeout' in error_message or error_type == 'TimeoutError':
            return ErrorCategory.TIMEOUT_ERROR, ErrorSeverity.MEDIUM
        
        # Default to system error
        else:
            severity = ErrorSeverity.CRITICAL if error_type in ['SystemExit', 'KeyboardInterrupt'] else ErrorSeverity.HIGH
            return ErrorCategory.SYSTEM_ERROR, severity
    
    def _create_error_record(self, error: Exception, category: ErrorCategory, 
                           severity: ErrorSeverity, context: Dict = None, 
                           user_message: str = None) -> Dict[str, Any]:
        """Create comprehensive error record"""
        
        return {
            'id': self._generate_error_id(),
            'timestamp': datetime.utcnow().isoformat(),
            'error_type': type(error).__name__,
            'error_message': str(error),
            'category': category.value,
            'severity': severity.value,
            'traceback': traceback.format_exc(),
            'context': context or {},
            'user_message': user_message,
            'system_info': {
                'python_version': sys.version,
                'platform': sys.platform
            }
        }
    
    def _log_error(self, error_record: Dict[str, Any]):
        """Log error with appropriate level"""
        severity = ErrorSeverity(error_record['severity'])
        
        log_message = (
            f"[{error_record['id']}] {error_record['error_type']}: "
            f"{error_record['error_message']}"
        )
        
        if severity == ErrorSeverity.CRITICAL:
            self.logger.critical(log_message, extra=error_record)
        elif severity == ErrorSeverity.HIGH:
            self.logger.error(log_message, extra=error_record)
        elif severity == ErrorSeverity.MEDIUM:
            self.logger.warning(log_message, extra=error_record)
        else:
            self.logger.info(log_message, extra=error_record)
        
        # Always log traceback for medium+ severity
        if severity.value in ['medium', 'high', 'critical']:
            self.logger.debug(f"Traceback for {error_record['id']}:\n{error_record['traceback']}")
    
    def _store_error_history(self, error_record: Dict[str, Any]):
        """Store error in history with size management"""
        self.error_history.append(error_record)
        
        # Maintain size limit
        if len(self.error_history) > self.max_history_size:
            self.error_history = self.error_history[-self.max_history_size:]
    
    def _update_error_counts(self, category: ErrorCategory, severity: ErrorSeverity):
        """Update error statistics"""
        key = f"{category.value}_{severity.value}"
        self.error_counts[key] = self.error_counts.get(key, 0) + 1
        
        # Also track totals
        self.error_counts[f"total_{category.value}"] = self.error_counts.get(f"total_{category.value}", 0) + 1
        self.error_counts[f"total_{severity.value}"] = self.error_counts.get(f"total_{severity.value}", 0) + 1
    
    def _attempt_recovery(self, error: Exception, category: ErrorCategory, context: Dict = None):
        """Attempt automatic recovery based on error type"""
        recovery_func = self.recovery_strategies.get(category)
        
        if recovery_func:
            try:
                return recovery_func(error, context)
            except Exception as recovery_error:
                self.logger.warning(f"Recovery attempt failed for {category.value}: {recovery_error}")
                return {'success': False, 'error': str(recovery_error)}
        
        return {'success': False, 'reason': 'No recovery strategy available'}
    
    def _recover_agent_error(self, error: Exception, context: Dict = None):
        """Recovery strategy for agent errors"""
        return {
            'success': False,
            'strategy': 'agent_restart',
            'recommendation': 'Consider restarting the affected agent'
        }
    
    def _recover_llm_error(self, error: Exception, context: Dict = None):
        """Recovery strategy for LLM errors"""
        if 'rate limit' in str(error).lower():
            return {
                'success': True,
                'strategy': 'wait_and_retry',
                'wait_time': 60,
                'recommendation': 'Wait 60 seconds before retry'
            }
        
        return {
            'success': False,
            'strategy': 'fallback_response',
            'recommendation': 'Use fallback response generation'
        }
    
    def _recover_network_error(self, error: Exception, context: Dict = None):
        """Recovery strategy for network errors"""
        return {
            'success': True,
            'strategy': 'exponential_backoff',
            'retry_count': 3,
            'base_delay': 2,
            'recommendation': 'Retry with exponential backoff'
        }
    
    def _recover_timeout_error(self, error: Exception, context: Dict = None):
        """Recovery strategy for timeout errors"""
        return {
            'success': True,
            'strategy': 'reduce_complexity',
            'recommendation': 'Simplify request and retry with shorter timeout'
        }
    
    def _recover_rate_limit_error(self, error: Exception, context: Dict = None):
        """Recovery strategy for rate limit errors"""
        return {
            'success': True,
            'strategy': 'queue_and_delay',
            'delay': 120,
            'recommendation': 'Queue request and delay execution'
        }
    
    def _recover_validation_error(self, error: Exception, context: Dict = None):
        """Recovery strategy for validation errors"""
        return {
            'success': True,
            'strategy': 'sanitize_and_retry',
            'recommendation': 'Sanitize input data and retry'
        }
    
    def _recover_configuration_error(self, error: Exception, context: Dict = None):
        """Recovery strategy for configuration errors"""
        return {
            'success': False,
            'strategy': 'require_manual_intervention',
            'recommendation': 'Manual configuration fix required'
        }
    
    def _generate_user_response(self, category: ErrorCategory, error: Exception, user_message: str = None):
        """Generate user-friendly error message"""
        base_message = self.user_messages.get(category, "I encountered an unexpected error.")
        
        # Add specific guidance for certain error types
        if category == ErrorCategory.USER_INPUT_ERROR:
            if user_message:
                return f"{base_message} Your message: '{user_message[:50]}{'...' if len(user_message) > 50 else ''}'"
        
        elif category == ErrorCategory.RATE_LIMIT_ERROR:
            return f"{base_message} You can try again in about 2 minutes."
        
        elif category == ErrorCategory.TIMEOUT_ERROR:
            return f"{base_message} Could you try asking a simpler or more specific question?"
        
        return base_message
    
    def _should_retry(self, category: ErrorCategory, severity: ErrorSeverity) -> bool:
        """Determine if operation should be retried"""
        retry_categories = [
            ErrorCategory.NETWORK_ERROR,
            ErrorCategory.TIMEOUT_ERROR,
            ErrorCategory.RATE_LIMIT_ERROR
        ]
        
        return category in retry_categories and severity != ErrorSeverity.CRITICAL
    
    def _should_escalate(self, category: ErrorCategory, severity: ErrorSeverity) -> bool:
        """Determine if error should be escalated to admin"""
        return (
            severity == ErrorSeverity.CRITICAL or
            category in [ErrorCategory.CONFIGURATION_ERROR, ErrorCategory.SYSTEM_ERROR]
        )
    
    def _generate_error_id(self) -> str:
        """Generate unique error ID"""
        from uuid import uuid4
        return f"err_{uuid4().hex[:8]}"
    
    def get_error_stats(self) -> Dict[str, Any]:
        """Get error statistics"""
        return {
            'total_errors': sum(v for k, v in self.error_counts.items() if k.startswith('total_')),
            'by_category': {k.replace('total_', ''): v for k, v in self.error_counts.items() if k.startswith('total_')},
            'by_severity': {k.replace('total_', ''): v for k, v in self.error_counts.items() if k.startswith('total_')},
            'recent_errors': len([e for e in self.error_history if 
                                (datetime.utcnow() - datetime.fromisoformat(e['timestamp'])).seconds < 3600]),
            'history_size': len(self.error_history)
        }
    
    def get_recent_errors(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get recent errors"""
        return self.error_history[-limit:] if self.error_history else []
    
    def clear_error_history(self):
        """Clear error history and reset counts"""
        self.error_history.clear()
        self.error_counts.clear()
        self.logger.info("Error history and counts cleared")
    
    def register_recovery_strategy(self, category: ErrorCategory, strategy_func: Callable):
        """Register custom recovery strategy"""
        self.recovery_strategies[category] = strategy_func
        self.logger.info(f"Registered custom recovery strategy for {category.value}")
    
    def set_user_message(self, category: ErrorCategory, message: str):
        """Set custom user-friendly message for error category"""
        self.user_messages[category] = message
        self.logger.info(f"Updated user message for {category.value}")

def handle_exceptions(error_handler: ErrorHandler, context: Dict = None):
    """Decorator for automatic exception handling"""
    def decorator(func):
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                error_result = error_handler.handle_error(e, context)
                raise RuntimeError(f"Handled error {error_result['error_id']}: {error_result['user_message']}")
        return wrapper
    return decorator
