import math
from typing import Iterable

from database import get_redis


LATENCY_METRICS = ("stt_ms", "submit_ms", "gemini_ms")
_LATENCY_PREFIX = "metrics:latency"
_DEFAULT_SAMPLE_SIZE = 500
_MAX_SAMPLE_SIZE = 5000
_MAX_STORED_ITEMS = 5000
_METRICS_TTL_SECONDS = 7 * 24 * 60 * 60


def _metric_key(metric_name: str) -> str:
    return f"{_LATENCY_PREFIX}:{metric_name}"


def _normalize_metric_names(metric_names: Iterable[str] | None) -> list[str]:
    if not metric_names:
        return list(LATENCY_METRICS)

    normalized: list[str] = []
    for metric in metric_names:
        name = (metric or "").strip().lower()
        if name in LATENCY_METRICS and name not in normalized:
            normalized.append(name)
    return normalized


def _normalize_sample_size(sample_size: int) -> int:
    try:
        value = int(sample_size)
    except Exception:
        value = _DEFAULT_SAMPLE_SIZE
    return max(1, min(_MAX_SAMPLE_SIZE, value))


def _safe_float(value) -> float | None:
    try:
        parsed = float(value)
    except Exception:
        return None
    if math.isnan(parsed) or math.isinf(parsed) or parsed < 0:
        return None
    return parsed


def _percentile(sorted_values: list[float], percentile: float) -> float | None:
    if not sorted_values:
        return None

    if len(sorted_values) == 1:
        return sorted_values[0]

    position = ((len(sorted_values) - 1) * percentile) / 100.0
    lower = int(math.floor(position))
    upper = int(math.ceil(position))

    if lower == upper:
        return sorted_values[lower]

    weight = position - lower
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * weight


def _round(value: float | None) -> float | None:
    if value is None:
        return None
    return round(value, 2)


async def record_latency(
    metric_name: str,
    duration_ms: float,
    *,
    ttl_seconds: int = _METRICS_TTL_SECONDS,
    max_items: int = _MAX_STORED_ITEMS,
) -> None:
    name = (metric_name or "").strip().lower()
    if name not in LATENCY_METRICS:
        return

    value = _safe_float(duration_ms)
    if value is None:
        return

    redis = get_redis()
    if not redis:
        return

    key = _metric_key(name)
    await redis.lpush(key, f"{value:.3f}")
    await redis.ltrim(key, 0, max(0, int(max_items) - 1))
    await redis.expire(key, int(ttl_seconds))


async def get_latency_metrics(
    *,
    metric_names: Iterable[str] | None = None,
    sample_size: int = _DEFAULT_SAMPLE_SIZE,
) -> dict:
    metrics = _normalize_metric_names(metric_names)
    size = _normalize_sample_size(sample_size)

    redis = get_redis()
    if not redis:
        return {
            "sample_size": size,
            "metrics": {name: _empty_summary() for name in metrics},
            "message": "Redis is not available",
        }

    output: dict[str, dict] = {}
    for metric in metrics:
        raw = await redis.lrange(_metric_key(metric), 0, size - 1)
        values: list[float] = []
        for item in raw:
            parsed = _safe_float(item)
            if parsed is not None:
                values.append(parsed)

        # Stored newest-first in Redis; reverse to chronological for last_ms.
        values.reverse()
        output[metric] = _build_summary(values)

    return {
        "sample_size": size,
        "metrics": output,
    }


async def reset_latency_metrics(metric_names: Iterable[str] | None = None) -> dict:
    metrics = _normalize_metric_names(metric_names)
    redis = get_redis()
    if not redis:
        return {
            "cleared": [],
            "message": "Redis is not available",
        }

    keys = [_metric_key(metric) for metric in metrics]
    if keys:
        await redis.delete(*keys)

    return {
        "cleared": metrics,
    }


def _empty_summary() -> dict:
    return {
        "count": 0,
        "min_ms": None,
        "avg_ms": None,
        "p50_ms": None,
        "p95_ms": None,
        "max_ms": None,
        "last_ms": None,
    }


def _build_summary(values: list[float]) -> dict:
    if not values:
        return _empty_summary()

    sorted_values = sorted(values)
    count = len(sorted_values)
    avg = sum(sorted_values) / count

    return {
        "count": count,
        "min_ms": _round(sorted_values[0]),
        "avg_ms": _round(avg),
        "p50_ms": _round(_percentile(sorted_values, 50)),
        "p95_ms": _round(_percentile(sorted_values, 95)),
        "max_ms": _round(sorted_values[-1]),
        "last_ms": _round(values[-1]),
    }
