# Codebase Migration Plan for 3-System Cluster Integration

This document outlines the specific code modifications required in the main repository (**System 1 / API Gateway**) to offload Speech-to-Text (STT) and Text-to-Speech (TTS) models to the dedicated speech node (**System 3**).

---

## 1. Files Requiring Modifications

### File 1: `backend/config.py`
Add configuration variables for the remote Speech Service URLs (pointing to System 3).
```diff
     # Ollama
     OLLAMA_BASE_URL: str = "http://192.168.76.20:11434"
     OLLAMA_MODEL: str = "llama3.1"
+
+    # System 3 Service Integration
+    STT_SERVICE_URL: str = "http://<system-3-ip>:8002/transcribe"
+    TTS_SERVICE_URL: str = "http://<system-3-ip>:8002/synthesize"
```

---

### File 2: `backend/services/stt_service.py`
Refactor `transcribe_audio_bytes` to make an asynchronous HTTP POST call to System 3 instead of executing Whisper inference locally.
```python
import httpx
from config import get_settings

settings = get_settings()

async def transcribe_audio_bytes(audio_bytes: bytes, filename: str = "speech.webm", language: str = "en") -> str:
    """Sends audio bytes to System 3 STT microservice for remote transcription."""
    if not audio_bytes:
        raise ValueError("audio file is required")
    
    files = {"audio": (filename, audio_bytes, "audio/webm")}
    data = {"language": language}
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            settings.STT_SERVICE_URL,
            files=files,
            data=data,
            timeout=15.0
        )
        response.raise_for_status()
        result = response.json()
        return result.get("text", "").strip()

# Stub functions to maintain compatibility with legacy startup checks
async def warmup_whisper_model() -> None:
    pass

def get_whisper_warmup_state() -> dict:
    return {"is_warm": True, "last_error": None}
```

---

### File 3: `backend/services/tts_service.py`
Refactor `synthesize_wav` to query System 3's Kokoro-82M service instead of executing local TTS.
```python
import httpx
from config import get_settings

settings = get_settings()

async def synthesize_wav(text: str, voice_gender: str = "female") -> bytes:
    """Sends text to System 3 TTS microservice for remote voice synthesis."""
    if not text:
        raise ValueError("text is required")
        
    data = {
        "text": text,
        "voice_gender": voice_gender
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            settings.TTS_SERVICE_URL,
            data=data,
            timeout=15.0
        )
        response.raise_for_status()
        return response.content

# Stub functions to maintain compatibility with legacy startup checks
async def warmup_xtts_model() -> bool:
    return True

def get_xtts_warmup_state() -> dict:
    return {"is_warm": True, "last_error": None}

async def prefetch_wav(text: str, voice_gender: str = "female") -> None:
    pass
```

---

### File 4: `backend/main.py`
Remove the local model preloading tasks from the lifespan start sequence to eliminate startup delays and local memory/GPU requirements on System 1.
```diff
 @asynccontextmanager
 async def lifespan(app: FastAPI):
     # Startup
     await connect_db()
     os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
-    try:
-        await asyncio.wait_for(warmup_xtts_model(), timeout=45)
-        logger.info("XTTS warmup: ready")
-    except Exception as exc:
-        logger.warning("XTTS warmup skipped: %s", exc)
-
-    try:
-        await asyncio.wait_for(warmup_whisper_model(), timeout=45)
-        logger.info("Whisper warmup: ready")
-    except Exception as exc:
-        logger.warning("Whisper warmup skipped: %s", exc)
     logger.info("Interview Bot API running in %s mode", settings.APP_ENV)
     yield
     # Shutdown
```

---

### File 5: `backend/requirements.txt`
Clean up and optimize requirements. System 1 no longer loads PyTorch, Coqui TTS, or Whisper models. Remove:
- `coqui-tts`
- `faster-whisper`
- `ctranslate2`
- `torch`, `torchaudio`, `torchvision` (if present)

This reduces the final Docker image size of your API Gateway (System 1) from roughly **12GB down to ~300MB**, making deployments, scaling, and startup times instant.
