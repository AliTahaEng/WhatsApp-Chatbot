#!/usr/bin/env python3

"""
Modern Python Entry Point
Replaces main.py with new flexible architecture
"""

import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv

# Add project root to path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

# Load environment variables from repo root .env
load_dotenv(project_root.parent / '.env')

from core.application.Application import PythonApplication

async def main():
    """Main entry point using modern architecture"""
    app = PythonApplication()
    
    try:
        print("[Python] Starting Python Application with modern architecture...")
        
        await app.initialize()
        await app.start()
        
    except KeyboardInterrupt:
        print("\n[Python] Received interrupt signal")
    except Exception as e:
        print(f"[Python] Application error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        if 'app' in locals():
            await app.stop()

if __name__ == "__main__":
    asyncio.run(main())
