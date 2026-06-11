from contextlib import asynccontextmanager
import asyncio
import logging
import logging.config
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os
import uvicorn

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from config import get_settings
from database import connect_db, close_db, ping_services
from services.tts_service import warmup_xtts_model, get_xtts_warmup_state
from services.stt_service import warmup_whisper_model, get_whisper_warmup_state

from routers import auth, resume, profile, interview, reports, admin, speech

# ── Logging setup ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
# Suppress noisy third-party loggers
logging.getLogger("uvicorn.access").setLevel(logging.INFO)
logging.getLogger("httpx").setLevel(logging.INFO)
logging.getLogger("httpcore").setLevel(logging.WARNING)

logger = logging.getLogger(__name__)

settings = get_settings()
limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await connect_db()
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    try:
        await warmup_xtts_model()
        logger.info("XTTS proxy configured")
    except Exception as exc:
        logger.warning("XTTS proxy error: %s", exc)

    try:
        await warmup_whisper_model()
        logger.info("Whisper proxy configured")
    except Exception as exc:
        logger.warning("Whisper proxy error: %s", exc)
    logger.info("Interview Bot API running in %s mode", settings.APP_ENV)
    yield
    # Shutdown
    await close_db()


app = FastAPI(
    title="AI Mock Interview Trainer",
    description="Production-ready AI-powered mock interview platform",
    version="1.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# CORS — origins controlled by CORS_ALLOWED_ORIGINS env var (default "*")
_raw_origins = settings.CORS_ALLOWED_ORIGINS.strip()
_cors_origins: list[str] = (
    ["*"] if _raw_origins == "*"
    else [o.strip() for o in _raw_origins.split(",") if o.strip()]
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_raw_origins != "*",
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers (mounted under both root and /api prefixes for local test & Cloudflare Tunnel compatibility)
for prefix in ["", "/api"]:
    app.include_router(auth.router, prefix=f"{prefix}/auth", tags=["Authentication"])
    app.include_router(resume.router, prefix=f"{prefix}/resume", tags=["Resume"])
    app.include_router(profile.router, prefix=f"{prefix}/profile", tags=["Profile"])
    app.include_router(interview.router, prefix=f"{prefix}/interview", tags=["Interview"])
    app.include_router(reports.router, prefix=f"{prefix}/reports", tags=["Reports"])
    app.include_router(admin.router, prefix=f"{prefix}/admin", tags=["Admin"])
    app.include_router(speech.router, prefix=f"{prefix}/speech", tags=["Speech"])


@app.get("/health")
@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": "1.0.0"}


@app.get("/health/services")
@app.get("/api/health/services")
async def health_services():
    """Deep health check: probes MongoDB, Redis, TTS, and Whisper.
    Returns HTTP 200 with status='degraded' when any dependency is unhealthy
    so load balancers can still reach the endpoint while operators investigate.
    """
    db_results = await ping_services()

    tts = get_xtts_warmup_state()
    stt = get_whisper_warmup_state()

    services = {
        **db_results,
        "tts": {
            "status": "ok" if tts["is_warm"] else ("error" if tts["last_error"] else "warming_up"),
            "ready": tts["is_warm"],
            **({"detail": tts["last_error"][:120]} if tts["last_error"] else {}),
        },
        "stt": {
            "status": "ok" if stt["is_warm"] else ("error" if stt["last_error"] else "warming_up"),
            "ready": stt["is_warm"],
            **({"detail": stt["last_error"][:120]} if stt["last_error"] else {}),
        },
    }

    overall = "ok" if all(s.get("status") == "ok" for s in services.values()) else "degraded"
    return {"status": overall, "version": "1.0.0", "services": services}


@app.get("/maintenance")
@app.get("/api/maintenance")
async def public_maintenance_check():
    """Public endpoint — returns maintenance status without requiring auth."""
    from services.admin_service import get_maintenance_status
    return await get_maintenance_status()


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.APP_HOST,
        port=settings.APP_PORT,
        reload=settings.APP_ENV != "production",
    )
