import os
import httpx
from config import get_settings

settings = get_settings()

_WHISPER_WARM = True
_WHISPER_LAST_ERROR: str | None = None

async def warmup_whisper_model() -> None:
    """
    Stub warmup function for backwards compatibility with main.py.
    The STT model is now hosted externally on System 3.
    """
    global _WHISPER_WARM, _WHISPER_LAST_ERROR
    _WHISPER_WARM = True
    _WHISPER_LAST_ERROR = None

def get_whisper_warmup_state() -> dict:
    return {
        "is_warm": _WHISPER_WARM,
        "last_error": _WHISPER_LAST_ERROR,
    }

async def transcribe_audio_bytes(audio_bytes: bytes, filename: str = "speech.webm", language: str = "en") -> str:
    """
    Sends the raw audio bytes to the System 3 external STT endpoint for transcription.
    """
    if not audio_bytes:
        raise ValueError("audio file is required")
        
    ext = os.path.splitext(filename or "speech.webm")[1] or ".webm"
    target_language = (language or "en").strip().lower() or "en"
    
    files = {"audio": (f"audio{ext}", audio_bytes, f"audio/{ext.strip('.')}")}
    data = {"language": target_language}
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                settings.STT_SERVICE_URL,
                files=files,
                data=data,
                timeout=20.0
            )
            response.raise_for_status()
            result = response.json()
            return result.get("text", "").strip()
    except httpx.HTTPStatusError as e:
        raise RuntimeError(f"Whisper transcription service returned error {e.response.status_code}: {e.response.text}") from e
    except Exception as exc:
        raise RuntimeError(f"Whisper transcription failed to connect to System 3: {str(exc)}") from exc
