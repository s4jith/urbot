import asyncio
import sys
import os
import json

sys.path.append("/home/techpark-11/Important/Intbot/interview-bot/backend")

# Set env before importing config
os.environ["APP_ENV"] = "development"
_env_path = "/home/techpark-11/Important/Intbot/interview-bot/backend/.env"
if os.path.exists(_env_path):
    with open(_env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            os.environ.setdefault(key, val)

from utils.ollama_client import call_ollama
from config import get_settings

settings = get_settings()

async def main():
    print(f"Testing Ollama Client...")
    print(f"Base URL: {settings.OLLAMA_BASE_URL}")
    print(f"Model: {settings.OLLAMA_MODEL}")
    
    prompt = """
    Generate exactly 1 short interview question for a software engineer.
    Return ONLY valid JSON with keys: "question", "difficulty", "category".
    """
    
    try:
        response = await call_ollama(prompt, request_timeout_seconds=30)
        print("\nRaw Response:", response)
        print("\nSUCCESS!")
    except Exception as e:
        print(f"\nFAILED: {e}")

if __name__ == "__main__":
    asyncio.run(main())
