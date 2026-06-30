import asyncio
import logging
from time import perf_counter
import httpx

from config import get_settings
from services.latency_service import record_latency

logger = logging.getLogger(__name__)
settings = get_settings()

_OLLAMA_HTTP_CLIENT = None

def _get_ollama_client() -> httpx.AsyncClient:
    global _OLLAMA_HTTP_CLIENT
    if _OLLAMA_HTTP_CLIENT is None:
        _OLLAMA_HTTP_CLIENT = httpx.AsyncClient(
            base_url=settings.OLLAMA_BASE_URL,
            timeout=httpx.Timeout(60.0, connect=5.0)
        )
    return _OLLAMA_HTTP_CLIENT

async def call_ollama(
    prompt: str,
    system_instruction: str = None,
    *,
    max_attempts: int = 3,
    request_timeout_seconds: float | None = None,
    json_format: bool = True,
    options: dict | None = None,
) -> str:
    """Call Ollama API with a prompt and optional system instruction."""
    started_at = perf_counter()
    client = _get_ollama_client()
    
    payload = {
        "model": settings.OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
    }
    if json_format:
        payload["format"] = "json" # Enforce JSON output for interview parsing
    
    # Provide defaults optimized for large extractions, low temperature, and rich context length
    default_opts = {
        "num_ctx": 16384,
        "num_predict": 4096,
        "temperature": 0.1,
    }
    if options:
        default_opts.update(options)
    payload["options"] = default_opts
    
    if system_instruction:
        payload["system"] = system_instruction
        
    timeout_override = None
    if request_timeout_seconds is not None:
        timeout_override = httpx.Timeout(request_timeout_seconds, connect=5.0)

    last_error = None
    
    for attempt in range(1, max_attempts + 1):
        try:
            response = await client.post(
                "/api/generate",
                json=payload,
                timeout=timeout_override or client.timeout
            )
            response.raise_for_status()
            
            data = response.json()
            result_text = data.get("response", "").strip()
            
            elapsed_ms = (perf_counter() - started_at) * 1000.0
            await record_latency("ollama_call_ms", elapsed_ms)
            
            return result_text
            
        except httpx.HTTPStatusError as e:
            logger.warning(f"Ollama HTTP error on attempt {attempt}: {e.response.text}")
            last_error = e
        except Exception as e:
            logger.warning(f"Ollama connection/timeout error on attempt {attempt}: {str(e)}")
            last_error = e
            
        if attempt < max_attempts:
            await asyncio.sleep(1.0 * attempt)
            
    elapsed_ms = (perf_counter() - started_at) * 1000.0
    await record_latency("ollama_call_error_ms", elapsed_ms)
    logger.error(f"Ollama failed after {max_attempts} attempts. Last error: {last_error}")
    raise RuntimeError(f"Ollama API failed: {last_error}") from last_error
