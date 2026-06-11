import asyncio
import os
import weakref
import httpx
from collections import OrderedDict
from config import get_settings

settings = get_settings()

_AUDIO_CACHE = OrderedDict()
_AUDIO_CACHE_LOCK = asyncio.Lock()
# Per-cache-key locks: allows concurrent synthesis of different texts.
# WeakValueDictionary lets GC collect locks when no synthesis is in progress.
_SYNTHESIZE_LOCKS: weakref.WeakValueDictionary = weakref.WeakValueDictionary()

AUDIO_CACHE_MAX_ITEMS = 300

_XTTS_WARM = True
_XTTS_LAST_ERROR: str | None = None

def _resolve_xtts_max_text_length() -> int:
    """0 disables truncation so full question text is spoken."""
    try:
        return max(0, int(os.getenv("XTTS_MAX_TEXT_LENGTH", "0")))
    except Exception:
        return 0

XTTS_MAX_TEXT_LENGTH = _resolve_xtts_max_text_length()


def _normalize_text_for_speech(value: str, max_length: int = XTTS_MAX_TEXT_LENGTH) -> str:
    if not value:
        return ""

    import re
    # Remove code blocks (lines between ``` and ```)
    text = re.sub(r'```[\s\S]*?```', ' [code block] ', value)

    # Remove inline code backticks but keep the content
    text = re.sub(r'`([^`]+)`', r'\1', text)

    # Remove markdown bold/italic asterisks or underscores
    text = re.sub(r'\*+', '', text)
    text = re.sub(r'_+', '', text)

    # Replace special symbols that might cause hiccups/noises in TTS
    text = text.replace('[', ' ').replace(']', ' ')
    text = text.replace('{', ' ').replace('}', ' ')
    text = text.replace('(', ' ').replace(')', ' ')

    # Convert common arrow function syntax to readable words
    text = re.sub(r'[-=]>', ' to ', text)

    content = " ".join(text.strip().split())
    if max_length <= 0:
        return content
    if len(content) <= max_length:
        return content
    trimmed = content[:max_length].rstrip()
    # Keep sentence boundaries cleaner when truncating.
    for marker in ("?", "!", "."):
        if marker in trimmed:
            head = trimmed.rsplit(marker, 1)[0].strip()
            if len(head) >= max_length // 2:
                return f"{head}{marker}"
    return trimmed


async def warmup_xtts_model() -> bool:
    """Stub warmup for backwards compatibility with main.py. Model runs on System 3."""
    global _XTTS_WARM, _XTTS_LAST_ERROR
    _XTTS_WARM = True
    _XTTS_LAST_ERROR = None
    return True

def get_xtts_warmup_state() -> dict:
    return {
        "is_warm": _XTTS_WARM,
        "last_error": _XTTS_LAST_ERROR,
    }

def _build_audio_cache_key(text: str, voice_gender: str) -> str:
    return f"{(voice_gender or 'female').strip().lower()}::{text.strip()}"

def _get_or_create_synthesize_lock(cache_key: str) -> asyncio.Lock:
    lock = _SYNTHESIZE_LOCKS.get(cache_key)
    if lock is None:
        lock = asyncio.Lock()
        _SYNTHESIZE_LOCKS[cache_key] = lock
    return lock

async def _get_cached_audio(cache_key: str) -> bytes | None:
    async with _AUDIO_CACHE_LOCK:
        value = _AUDIO_CACHE.get(cache_key)
        if value is None:
            return None
        # LRU touch.
        _AUDIO_CACHE.move_to_end(cache_key)
        return value

async def _set_cached_audio(cache_key: str, data: bytes) -> None:
    async with _AUDIO_CACHE_LOCK:
        _AUDIO_CACHE[cache_key] = data
        _AUDIO_CACHE.move_to_end(cache_key)
        while len(_AUDIO_CACHE) > AUDIO_CACHE_MAX_ITEMS:
            _AUDIO_CACHE.popitem(last=False)

async def prefetch_wav(text: str, voice_gender: str = "female") -> None:
    """Best-effort speech prefetch to warm audio cache."""
    try:
        await synthesize_wav(text, voice_gender)
    except Exception:
        pass

async def synthesize_wav(text: str, voice_gender: str = "female") -> bytes:
    content = _normalize_text_for_speech(text)
    if not content:
        raise ValueError("text is required")

    normalized_gender = (voice_gender or "female").strip().lower()
    if normalized_gender not in {"male", "female", "auto"}:
        normalized_gender = "female"

    cache_key = _build_audio_cache_key(content, normalized_gender)
    cached = await _get_cached_audio(cache_key)
    if cached:
        return cached

    async with _get_or_create_synthesize_lock(cache_key):
        # Recheck cache after waiting for lock in case another request already synthesized it.
        cached = await _get_cached_audio(cache_key)
        if cached:
            return cached

        try:
            async with httpx.AsyncClient() as client:
                data = {
                    "text": content,
                    "voice_gender": normalized_gender
                }
                response = await client.post(
                    settings.TTS_SERVICE_URL,
                    data=data,
                    timeout=20.0
                )
                response.raise_for_status()
                wav = response.content
                
                # Cache the generated WAV bytes
                await _set_cached_audio(cache_key, wav)
                return wav
                
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"TTS synthesis service returned error {e.response.status_code}: {e.response.text}") from e
        except Exception as exc:
            raise RuntimeError(f"TTS synthesis failed to connect to System 3: {str(exc)}") from exc
