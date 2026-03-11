"""
Python Logger Setup
Logging configuration for Python AI agent components

Provides structured logging for the Python side of the system
"""

import logging
import sys
import os
from pathlib import Path
from datetime import datetime

def setup_logging(log_level: str = None, log_file: str = None) -> logging.Logger:
    """
    Setup logging configuration for Python components
    
    Args:
        log_level: Log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_file: Optional log file path
    
    Returns:
        Configured logger instance
    """
    
    # Get configuration from environment
    log_level = log_level or os.getenv('LOG_LEVEL', 'INFO').upper()
    log_file = log_file or os.getenv('PYTHON_LOG_FILE', './data/logs/python.log')
    
    # Create logs directory if it doesn't exist
    log_dir = Path(log_file).parent
    log_dir.mkdir(parents=True, exist_ok=True)
    
    # Create logger
    logger = logging.getLogger('whatsapp_bot_python')
    logger.setLevel(getattr(logging, log_level, logging.INFO))
    
    # Clear existing handlers
    logger.handlers.clear()
    
    # Create formatters
    detailed_formatter = logging.Formatter(
        '%(asctime)s [%(levelname)s] %(name)s:%(lineno)d - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    simple_formatter = logging.Formatter(
        '%(asctime)s [%(levelname)s] %(message)s',
        datefmt='%H:%M:%S'
    )
    
    # Console handler (stderr to avoid interfering with stdout communication)
    if os.getenv('PYTHON_LOG_CONSOLE', 'true').lower() == 'true':
        console_handler = logging.StreamHandler(sys.stderr)
        console_handler.setLevel(logging.INFO)
        console_handler.setFormatter(simple_formatter)
        logger.addHandler(console_handler)
    
    # File handler
    try:
        file_handler = logging.FileHandler(log_file, encoding='utf-8')
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(detailed_formatter)
        logger.addHandler(file_handler)
    except Exception as e:
        print(f"Failed to create file handler: {e}", file=sys.stderr)
    
    # Prevent propagation to root logger
    logger.propagate = False
    
    # Log startup
    logger.info("🐍 Python logging initialized")
    logger.debug(f"Log level: {log_level}, Log file: {log_file}")
    
    return logger

def get_logger(name: str = None) -> logging.Logger:
    """Get logger instance for specific component"""
    base_name = 'whatsapp_bot_python'
    
    if name:
        logger_name = f"{base_name}.{name}"
    else:
        logger_name = base_name
    
    return logging.getLogger(logger_name)
