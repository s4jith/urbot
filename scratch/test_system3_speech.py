import asyncio
import sys
import os
import io

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

from config import get_settings
import httpx

settings = get_settings()

async def main():
    print("Testing System 3 Speech Services...")
    print(f"TTS URL: {settings.TTS_SERVICE_URL}")
    print(f"STT URL: {settings.STT_SERVICE_URL}")
    
    # Test TTS
    print("\n--- Testing TTS ---")
    wav_bytes = b""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                settings.TTS_SERVICE_URL,
                data={"text": "Hello, this is a test of the Kokoro text to speech system.", "voice_gender": "female"},
                timeout=15.0
            )
            response.raise_for_status()
            wav_bytes = response.content
            print(f"SUCCESS: Received TTS audio response ({len(wav_bytes)} bytes).")
    except httpx.ConnectError:
        print("FAILED: Connection refused. System 3 is not reachable or service is not running on port 8002.")
        return
    except Exception as e:
        print(f"FAILED TTS: {e}")
        return

    # Test STT
    print("\n--- Testing STT ---")
    if not wav_bytes:
        print("FAILED: No audio bytes from TTS to test STT.")
        return
        
    try:
        async with httpx.AsyncClient() as client:
            files = {"audio": ("test.wav", wav_bytes, "audio/wav")}
            data = {"language": "en"}
            response = await client.post(
                settings.STT_SERVICE_URL,
                files=files,
                data=data,
                timeout=15.0
            )
            response.raise_for_status()
            result = response.json()
            print(f"SUCCESS: Transcribed text -> \"{result.get('text', '')}\"")
    except httpx.HTTPStatusError as e:
        print(f"FAILED STT: HTTP {e.response.status_code} - {e.response.text}")
    except Exception as e:
        print(f"FAILED STT: {e}")

if __name__ == "__main__":
    asyncio.run(main())
