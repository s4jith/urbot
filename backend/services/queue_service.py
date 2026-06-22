import json
import re
from typing import Optional, Tuple

from utils.helpers import generate_id


QUESTION_QUEUE_SUFFIX = "question_queue"
QUESTION_BACKLOG_SUFFIX = "question_backlog"
CONTEXT_CACHE_SUFFIX = "context_cache"
ASKED_SET_SUFFIX = "asked_questions_set"
QUEUED_SET_SUFFIX = "queued_fingerprints_set"
QUESTION_PREFIX_RE = re.compile(
    r"^\s*(?:question|q)\s*#?\s*\d+(?:\s*of\s*\d+)?\s*[\:\-\)\.]\s*",
    re.IGNORECASE,
)


def _key(session_id: str, suffix: str) -> str:
    return f"session:{session_id}:{suffix}"


def normalize_question_text(text: str) -> str:
    value = (text or "").strip()
    if not value:
        return ""

    while True:
        updated = QUESTION_PREFIX_RE.sub("", value).strip()
        if updated == value:
            break
        value = updated

    return value


def question_fingerprint(text: str) -> str:
    value = normalize_question_text(text).lower()
    value = re.sub(r"[^a-z0-9\s]", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def are_questions_similar(q1: str, q2: str) -> bool:
    def clean(q):
        q = (q or "").lower()
        q = re.sub(r"[^\w\s]", "", q)
        words = q.split()
        stopwords = {
            "what", "is", "are", "explain", "describe", "define", "the", "a", "an", 
            "of", "to", "in", "for", "with", "about", "how", "why", "detail", "details",
            "properties", "concept", "conceptually", "briefly", "shortly"
        }
        stemmed = []
        for w in words:
            if w in stopwords:
                continue
            if w.endswith("ing"):
                w = w[:-3]
            elif w.endswith("ed"):
                w = w[:-2]
            elif w.endswith("es"):
                w = w[:-2]
            elif w.endswith("s") and not w.endswith("ss"):
                w = w[:-1]
            if w:
                stemmed.append(w)
        return set(stemmed)

    w1 = clean(q1)
    w2 = clean(q2)
    if not w1 or not w2:
        return (q1 or "").strip().lower() == (q2 or "").strip().lower()

    intersection = w1.intersection(w2)
    union = w1.union(w2)
    jaccard = len(intersection) / len(union)

    is_subset = False
    if len(w1) <= 2 or len(w2) <= 2:
        smaller = w1 if len(w1) < len(w2) else w2
        larger = w2 if len(w1) < len(w2) else w1
        if smaller.issubset(larger) and len(smaller) > 0 and len(larger) <= 3:
            is_subset = True

    return jaccard > 0.5 or is_subset


async def get_all_session_question_texts(redis, session_id: str) -> list[str]:
    texts_key = f"session:{session_id}:asked_questions_texts"
    asked = await redis.smembers(texts_key)
    asked_list = [t.decode("utf-8") if isinstance(t, bytes) else t for t in asked] if asked else []

    qids_key = f"session:{session_id}:questions"
    qids = await redis.lrange(qids_key, 0, -1)

    queued_list = []
    if qids:
        for qid_raw in qids:
            qid = qid_raw.decode("utf-8") if isinstance(qid_raw, bytes) else qid_raw
            q = await redis.hgetall(f"session:{session_id}:q:{qid}")
            q_decoded = {}
            for k, v in q.items():
                k_str = k.decode("utf-8") if isinstance(k, bytes) else k
                v_str = v.decode("utf-8") if isinstance(v, bytes) else v
                q_decoded[k_str] = v_str
            
            if q_decoded.get("question"):
                queued_list.append(q_decoded["question"])

    return list(set(asked_list + queued_list))


async def mark_question_asked(redis, session_id: str, question_text: str, ttl_seconds: int) -> None:
    fp = question_fingerprint(question_text)
    if not fp:
        return

    key = _key(session_id, ASKED_SET_SUFFIX)
    await redis.sadd(key, fp)
    await redis.expire(key, ttl_seconds)

    texts_key = f"session:{session_id}:asked_questions_texts"
    await redis.sadd(texts_key, question_text)
    await redis.expire(texts_key, ttl_seconds)


async def is_question_asked(redis, session_id: str, question_text: str) -> bool:
    fp = question_fingerprint(question_text)
    if not fp:
        return False
    key = _key(session_id, ASKED_SET_SUFFIX)
    return bool(await redis.sismember(key, fp))


async def _is_question_queued(redis, session_id: str, question_text: str) -> bool:
    fp = question_fingerprint(question_text)
    if not fp:
        return False
    key = _key(session_id, QUEUED_SET_SUFFIX)
    return bool(await redis.sismember(key, fp))


async def _mark_question_queued(redis, session_id: str, question_text: str, ttl_seconds: int) -> None:
    fp = question_fingerprint(question_text)
    if not fp:
        return
    key = _key(session_id, QUEUED_SET_SUFFIX)
    await redis.sadd(key, fp)
    await redis.expire(key, ttl_seconds)


async def _unmark_question_queued(redis, session_id: str, question_text: str) -> None:
    fp = question_fingerprint(question_text)
    if not fp:
        return
    await redis.srem(_key(session_id, QUEUED_SET_SUFFIX), fp)


async def _append_question_object(
    redis,
    session_id: str,
    question: str,
    difficulty: str,
    category: str,
    ttl_seconds: int,
    db_question_id: Optional[str] = None,
    subtopic: Optional[str] = None,
) -> str:
    normalized_question = normalize_question_text(question)
    qid = generate_id()
    q_key = f"session:{session_id}:q:{qid}"

    mapping = {
        "question_id": qid,
        "question": normalized_question,
        "difficulty": difficulty or "medium",
        "category": category or "general",
    }
    if db_question_id:
        mapping["db_question_id"] = db_question_id
        try:
            from database import get_db
            from models.collections import TOPIC_QUESTIONS
            from bson import ObjectId
            db = get_db()
            doc = await db[TOPIC_QUESTIONS].find_one({"_id": ObjectId(db_question_id)})
            if doc:
                if doc.get("expected_answer"):
                    mapping["expected_answer"] = doc["expected_answer"]
                if doc.get("original_answer"):
                    mapping["original_answer"] = doc["original_answer"]
                if doc.get("compacted_answer"):
                    mapping["compacted_answer"] = doc["compacted_answer"]
        except Exception:
            pass
    if subtopic:
        mapping["subtopic"] = subtopic

    await redis.hset(q_key, mapping=mapping)
    await redis.expire(q_key, ttl_seconds)

    questions_key = f"session:{session_id}:questions"
    await redis.rpush(questions_key, qid)
    await redis.expire(questions_key, ttl_seconds)
    return qid


async def enqueue_question(
    redis,
    session_id: str,
    question: str,
    difficulty: str = "medium",
    category: str = "general",
    ttl_seconds: int = 7200,
    max_queue_size: int = 3,
    db_question_id: Optional[str] = None,
    subtopic: Optional[str] = None,
) -> Optional[str]:
    text = normalize_question_text(question)
    if not text:
        return None

    queue_key = _key(session_id, QUESTION_QUEUE_SUFFIX)
    backlog_key = _key(session_id, QUESTION_BACKLOG_SUFFIX)

    if await is_question_asked(redis, session_id, text):
        return None
    if await _is_question_queued(redis, session_id, text):
        return None

    # Check semantic similarity!
    all_prev = await get_all_session_question_texts(redis, session_id)
    for prev in all_prev:
        if are_questions_similar(prev, text):
            return None

    q_len = await redis.llen(queue_key)
    qid = await _append_question_object(
        redis=redis,
        session_id=session_id,
        question=text,
        difficulty=difficulty,
        category=category,
        ttl_seconds=ttl_seconds,
        db_question_id=db_question_id,
        subtopic=subtopic,
    )

    await _mark_question_queued(redis, session_id, text, ttl_seconds)

    if q_len < max_queue_size:
        await redis.rpush(queue_key, qid)
        await redis.expire(queue_key, ttl_seconds)
        return qid

    await redis.rpush(backlog_key, qid)
    await redis.expire(backlog_key, ttl_seconds)
    return qid


async def flush_backlog_to_queue(
    redis,
    session_id: str,
    ttl_seconds: int = 7200,
    max_queue_size: int = 3,
) -> None:
    queue_key = _key(session_id, QUESTION_QUEUE_SUFFIX)
    backlog_key = _key(session_id, QUESTION_BACKLOG_SUFFIX)

    while await redis.llen(queue_key) < max_queue_size:
        qid = await redis.lpop(backlog_key)
        if not qid:
            break
        await redis.rpush(queue_key, qid)

    await redis.expire(queue_key, ttl_seconds)
    await redis.expire(backlog_key, ttl_seconds)


async def queue_size(redis, session_id: str) -> int:
    return int(await redis.llen(_key(session_id, QUESTION_QUEUE_SUFFIX)))


async def pop_next_question(redis, session_id: str) -> Tuple[Optional[str], Optional[dict]]:
    queue_key = _key(session_id, QUESTION_QUEUE_SUFFIX)
    qid = await redis.lpop(queue_key)
    if not qid:
        return None, None
    q = await redis.hgetall(f"session:{session_id}:q:{qid}")
    # Remove from queued set so the same text can be re-enqueued if needed.
    await _unmark_question_queued(redis, session_id, q.get("question", ""))
    return qid, q


async def peek_next_question(redis, session_id: str) -> Tuple[Optional[str], Optional[dict]]:
    queue_key = _key(session_id, QUESTION_QUEUE_SUFFIX)
    qid = await redis.lindex(queue_key, 0)
    if not qid:
        return None, None
    q = await redis.hgetall(f"session:{session_id}:q:{qid}")
    return qid, q


async def push_context_item(
    redis,
    session_id: str,
    item: dict,
    ttl_seconds: int = 7200,
    max_items: int = 3,
) -> None:
    key = _key(session_id, CONTEXT_CACHE_SUFFIX)
    await redis.lpush(key, json.dumps(item, ensure_ascii=True))
    await redis.ltrim(key, 0, max(0, max_items - 1))
    await redis.expire(key, ttl_seconds)


async def get_recent_context_items(redis, session_id: str, max_items: int = 3) -> list[dict]:
    key = _key(session_id, CONTEXT_CACHE_SUFFIX)
    raw_items = await redis.lrange(key, 0, max(0, max_items - 1))

    parsed: list[dict] = []
    for raw in raw_items:
        try:
            parsed.append(json.loads(raw))
        except Exception:
            continue

    # Convert newest-first storage into chronological order for prompting.
    parsed.reverse()
    return parsed
