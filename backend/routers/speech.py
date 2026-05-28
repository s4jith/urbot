from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request
from fastapi.responses import Response
from pydantic import BaseModel
from time import perf_counter

from slowapi import Limiter
from slowapi.util import get_remote_address
from auth.jwt import get_current_user
from services.tts_service import synthesize_wav, warmup_xtts_model, get_xtts_warmup_state
from services.stt_service import transcribe_audio_bytes, warmup_whisper_model
from services.latency_service import record_latency

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


class SpeechSynthesisRequest(BaseModel):
    text: str
    voice_gender: str = "female"


@router.get("/health")
async def speech_health(current_user: dict = Depends(get_current_user)):
    """Check whether speech route is available for authenticated users."""
    _ = current_user
    state = get_xtts_warmup_state()
    return {
        "status": "ok",
        "service": "speech",
        "xtts_ready": bool(state.get("is_warm")),
    }


@router.post("/warmup")
async def speech_warmup(current_user: dict = Depends(get_current_user)):
    """Warm XTTS model so first interview playback does not hit cold-start delay."""
    _ = current_user
    xtts_ready = await warmup_xtts_model()
    await warmup_whisper_model()

    state = get_xtts_warmup_state()
    if not xtts_ready:
        raise HTTPException(
            status_code=503,
            detail=f"XTTS warmup failed: {state.get('last_error') or 'unknown error'}",
        )

    return {
        "status": "ok",
        "message": "speech model warmed",
        "xtts_ready": True,
    }


@router.post("/synthesize")
@limiter.limit("20/minute")
async def synthesize_speech(
    request: Request,
    body: SpeechSynthesisRequest,
    current_user: dict = Depends(get_current_user),
):
    """Synthesize text to WAV bytes using Coqui TTS models."""
    try:
        wav_bytes = await synthesize_wav(body.text, body.voice_gender)
        return Response(content=wav_bytes, media_type="audio/wav")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        # XTTS may be in cold-start transition; warm once and retry before failing.
        try:
            xtts_ready = await warmup_xtts_model()
            if not xtts_ready:
                state = get_xtts_warmup_state()
                raise HTTPException(
                    status_code=503,
                    detail=f"XTTS warmup failed: {state.get('last_error') or str(e)}",
                )
            wav_bytes = await synthesize_wav(request.text, request.voice_gender)
            return Response(content=wav_bytes, media_type="audio/wav")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        # Retry once after explicit warmup even for non-RuntimeError failures.
        try:
            xtts_ready = await warmup_xtts_model()
            if xtts_ready:
                wav_bytes = await synthesize_wav(request.text, request.voice_gender)
                return Response(content=wav_bytes, media_type="audio/wav")
        except Exception:
            pass

        state = get_xtts_warmup_state()
        raise HTTPException(
            status_code=503,
            detail=f"Speech synthesis backend unavailable: {state.get('last_error') or str(e)}",
        )


@router.post("/transcribe")
async def transcribe_speech(
    audio: UploadFile = File(...),
    language: str = Form("en"),
    current_user: dict = Depends(get_current_user),
):
    """Transcribe uploaded interview audio using Whisper model."""
    started_at = perf_counter()
    try:
        payload = await audio.read()
        text = await transcribe_audio_bytes(
            audio_bytes=payload,
            filename=audio.filename or "speech.webm",
            language=language,
        )
        elapsed_ms = (perf_counter() - started_at) * 1000.0
        await record_latency("stt_ms", elapsed_ms)
        return {"text": text, "stt_ms": round(elapsed_ms, 2)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Speech transcription failed: {str(e)}")
