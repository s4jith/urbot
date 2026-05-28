import asyncio
import os
import tempfile

# On Windows, ctranslate2 and torch can load separate OpenMP runtimes.
# Allowing duplicates avoids process aborts during model initialization.
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

_WHISPER_MODEL_CACHE = {}
_WHISPER_MODEL_LOCK = asyncio.Lock()
_WHISPER_RUNTIME_FORCE_CPU = False
_WHISPER_LAST_ERROR: str | None = None
_WHISPER_WARM = False


def _is_cuda_runtime_error(error: Exception) -> bool:
    message = str(error or "").strip().lower()
    if not message:
        return False
    markers = (
        "cublas64_12.dll",
        "cublas",
        "cudnn",
        "libcudart",
        "cuda",
        "ctranslate2",
        "failed to load library",
        "cannot be loaded",
    )
    return any(marker in message for marker in markers)


def _force_whisper_cpu_mode(reason: Exception | None = None) -> None:
    global _WHISPER_RUNTIME_FORCE_CPU, _WHISPER_LAST_ERROR
    _WHISPER_RUNTIME_FORCE_CPU = True
    if reason is not None:
        _WHISPER_LAST_ERROR = str(reason)

    # Drop cached CUDA models so all future requests resolve to CPU safely.
    for key in list(_WHISPER_MODEL_CACHE.keys()):
        if "|cuda|" in key:
            _WHISPER_MODEL_CACHE.pop(key, None)


def _has_cuda_device_via_ctranslate2() -> bool:
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


def _resolve_device() -> str:
    if _WHISPER_RUNTIME_FORCE_CPU:
        return "cpu"

    pref = os.getenv("WHISPER_DEVICE", "auto").strip().lower()
    if pref in {"cpu", "cuda"}:
        return pref

    # Prefer ctranslate2 probe first because faster-whisper relies on it.
    if _has_cuda_device_via_ctranslate2():
        return "cuda"

    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def _resolve_compute_type(device: str) -> str:
    pref = os.getenv("WHISPER_COMPUTE_TYPE", "auto").strip().lower()
    if pref and pref != "auto":
        return pref
    return "float16" if device == "cuda" else "int8"


def _resolve_model_size() -> str:
    # Fast default for real-time interview UX; can be overridden in env.
    return os.getenv("WHISPER_MODEL_SIZE", "small.en").strip() or "small.en"


def _resolve_beam_size() -> int:
    try:
        return max(1, int(os.getenv("WHISPER_BEAM_SIZE", "1")))
    except Exception:
        return 1


def _resolve_best_of() -> int:
    try:
        return max(1, int(os.getenv("WHISPER_BEST_OF", "1")))
    except Exception:
        return 1


def _resolve_vad_filter() -> bool:
    value = os.getenv("WHISPER_VAD_FILTER", "0").strip().lower()
    return value in {"1", "true", "yes", "on"}


async def _get_whisper_model():
    model_size = _resolve_model_size()
    device = _resolve_device()
    compute_type = _resolve_compute_type(device)
    cache_key = f"{model_size}|{device}|{compute_type}"

    async with _WHISPER_MODEL_LOCK:
        if cache_key in _WHISPER_MODEL_CACHE:
            return _WHISPER_MODEL_CACHE[cache_key]

        def _load_model():
            try:
                from faster_whisper import WhisperModel
            except Exception as exc:
                raise RuntimeError(
                    "faster-whisper is not installed in the active Python environment"
                ) from exc

            try:
                return WhisperModel(model_size, device=device, compute_type=compute_type)
            except Exception as exc:
                if device == "cuda" and _is_cuda_runtime_error(exc):
                    _force_whisper_cpu_mode(exc)
                # Keep service resilient if GPU config mismatches runtime.
                return WhisperModel(model_size, device="cpu", compute_type="int8")

        model = await asyncio.to_thread(_load_model)
        _WHISPER_MODEL_CACHE[cache_key] = model
        return model


async def warmup_whisper_model() -> None:
    global _WHISPER_WARM, _WHISPER_LAST_ERROR
    try:
        await _get_whisper_model()
        _WHISPER_WARM = True
        _WHISPER_LAST_ERROR = None
    except Exception as exc:
        _WHISPER_LAST_ERROR = str(exc)
        # Best-effort warmup only.


def get_whisper_warmup_state() -> dict:
    return {
        "is_warm": _WHISPER_WARM,
        "last_error": _WHISPER_LAST_ERROR,
    }


async def transcribe_audio_bytes(audio_bytes: bytes, filename: str = "speech.webm", language: str = "en") -> str:
    if not audio_bytes:
        raise ValueError("audio file is required")

    model = await _get_whisper_model()
    ext = os.path.splitext(filename or "speech.webm")[1] or ".webm"
    target_language = (language or "en").strip().lower() or "en"
    beam_size = _resolve_beam_size()
    best_of = _resolve_best_of()
    vad_filter = _resolve_vad_filter()

    fd, tmp_path = tempfile.mkstemp(suffix=ext)
    os.close(fd)

    try:
        with open(tmp_path, "wb") as f:
            f.write(audio_bytes)

        def _transcribe(model_instance) -> str:
            segments, _ = model_instance.transcribe(
                tmp_path,
                language=target_language,
                beam_size=beam_size,
                best_of=best_of,
                vad_filter=vad_filter,
                condition_on_previous_text=False,
                temperature=0.0,
                without_timestamps=True,
            )
            parts = []
            for seg in segments:
                text = (seg.text or "").strip()
                if text:
                    parts.append(text)
            return " ".join(parts).strip()

        try:
            text = await asyncio.to_thread(_transcribe, model)
        except Exception as exc:
            if not _is_cuda_runtime_error(exc):
                raise RuntimeError(f"Whisper transcription failed: {str(exc)}") from exc

            # Runtime CUDA failures can occur even after successful model construction.
            _force_whisper_cpu_mode(exc)
            cpu_model = await _get_whisper_model()
            try:
                text = await asyncio.to_thread(_transcribe, cpu_model)
            except Exception as retry_exc:
                raise RuntimeError(
                    f"Whisper transcription failed after CPU fallback: {str(retry_exc)}"
                ) from retry_exc

        return text
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
