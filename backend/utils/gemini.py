from google import genai
from config import get_settings
from utils.skills import normalize_skill_list
import asyncio
import json
import random
import re
import threading
import time
from time import perf_counter
from langchain_core.prompts import PromptTemplate
from services.latency_service import record_latency
from utils.ollama_client import call_ollama

# Shared language style instruction injected into every question-generation prompt.
_QUESTION_LANGUAGE_RULE = (
    "LANGUAGE STYLE: Technical terms are fine, but write each sentence in plain, "
    "simple English. Use short, direct sentences. Avoid complex grammar like nested "
    "clauses or academic phrasing. The question must be easy to read even if the "
    "topic is advanced.\n"
    "DIFFICULTY GUIDE:\n"
    "  easy   = basic definition or identification (What is X? What does X do? "
    "Name the types of X.)\n"
    "  medium = practical usage or comparison (How do you use X? When would you "
    "choose X over Y? How does X work internally?)\n"
    "  hard   = system design, debugging, optimization, or trade-off scenario "
    "(Design a system using X. Debug this problem. What are the trade-offs of X vs Y?)\n"
    "VOICE INTERVIEW FORMAT — CRITICAL RULES (never violate these):\n"
    "  - This is a SPOKEN, VOICE-ONLY interview. The candidate can only answer verbally.\n"
    "  - NEVER ask the candidate to write code, write a function, implement an algorithm, "
    "write a formula, write an equation, or produce any written/text output.\n"
    "  - NEVER ask the candidate to draw, sketch, or create any diagram, flowchart, or "
    "visual representation.\n"
    "  - NEVER ask questions that require writing down math, formulas, equations, or code syntax.\n"
    "  - NEVER use phrases like 'Write a program...', 'Code the following...', 'Write the formula...', "
    "'Implement a function that...', 'Write the SQL query...', 'Draw a diagram...', "
    "'Sketch the architecture...', or any phrasing that requires writing, drawing, or notation.\n"
    "  - Instead, ask the candidate to EXPLAIN, DESCRIBE, WALK THROUGH, or DISCUSS "
    "concepts verbally. For example: 'How would you approach...', "
    "'Can you explain how...', 'Walk me through your thought process for...', "
    "'What would your strategy be for...'\n"
    "  - All questions must be answerable by speaking alone — no pen, paper, formula sheets, or "
    "keyboard required.\n"
)

settings = get_settings()

# ---------------------------------------------------------------------------
# Multi-key Gemini pool
# Supports N API keys for round-robin load balancing and per-key rate-limit
# tracking. Add extra keys via GEMINI_API_KEYS=key2,key3 in .env
# ---------------------------------------------------------------------------

_KEY_POOL: list[dict] = []
_KEY_POOL_INDEX: int = 0
_KEY_POOL_LOCK = threading.Lock()
_RELOAD_LOCK = asyncio.Lock()
_LAST_RELOAD_TIME = 0.0
_RELOAD_INTERVAL = 60.0  # seconds


async def reload_key_pool() -> None:
    """Force reload the key pool from MongoDB, falling back to .env if empty."""
    async with _RELOAD_LOCK:
        await _reload_key_pool_unsafe()


async def _reload_key_pool_unsafe() -> None:
    """Reload the key pool without acquiring the reload lock."""
    global _KEY_POOL, _LAST_RELOAD_TIME
    keys: list[str] = []

    # 1. Attempt to load from MongoDB
    from database import get_db
    db = get_db()
    if db is not None:
        try:
            from models.collections import GEMINI_KEYS
            cursor = db[GEMINI_KEYS].find({"is_active": True})
            docs = await cursor.to_list(length=1000)
            for doc in docs:
                k = (doc.get("key") or "").strip()
                if k and k not in keys:
                    keys.append(k)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning("Could not load keys from MongoDB: %s", e)

    # 2. Fallback to .env config if no keys loaded from DB
    if not keys:
        extras = (getattr(settings, "GEMINI_API_KEYS", "") or "").strip()
        if extras:
            keys.extend([k.strip() for k in extras.split(",") if k.strip() and k.strip() not in keys])

        primary = (settings.GEMINI_API_KEY or "").strip()
        if primary and primary not in keys:
            keys.append(primary)

    new_pool = []
    for k in keys:
        if k:
            import hashlib
            key_id = hashlib.sha256(k.encode()).hexdigest()[:12]
            new_pool.append({
                "key": k,
                "key_id": key_id,
                "client": genai.Client(api_key=k),
                "call_count": 0,
                "rate_limited_until_mono": 0.0,  # Memory fallback
            })

    with _KEY_POOL_LOCK:
        _KEY_POOL = new_pool
    _LAST_RELOAD_TIME = time.monotonic()


async def _pick_key() -> dict:
    """Return the next available key via Redis-coordinated round-robin."""
    global _KEY_POOL
    now_mono = time.monotonic()

    # Dynamic reload check
    if not _KEY_POOL or (now_mono - _LAST_RELOAD_TIME > _RELOAD_INTERVAL):
        async with _RELOAD_LOCK:
            # Double check inside the lock
            if not _KEY_POOL or (time.monotonic() - _LAST_RELOAD_TIME > _RELOAD_INTERVAL):
                await _reload_key_pool_unsafe()

    if not _KEY_POOL:
        raise RuntimeError("No Gemini API keys configured")

    from database import get_redis
    redis = get_redis()

    if redis:
        try:
            # 1. Retrieve current index
            rotation_idx = await redis.get("gemini:rotation_index")
            idx = int(rotation_idx) if rotation_idx else 0
            n = len(_KEY_POOL)

            # 2. Find first clean key
            for i in range(n):
                cur_idx = (idx + i) % n
                entry = _KEY_POOL[cur_idx]
                key_id = entry["key_id"]

                cooldown_key = f"gemini:key:{key_id}:cooldown"
                rpd_key = f"gemini:key:{key_id}:rpd_limit_hit"

                is_cooldown = await redis.exists(cooldown_key)
                is_daily_limit = await redis.exists(rpd_key)

                if not is_cooldown and not is_daily_limit:
                    # Update index in Redis for next call
                    next_idx = (cur_idx + 1) % n
                    await redis.set("gemini:rotation_index", str(next_idx))
                    entry["call_count"] = entry.get("call_count", 0) + 1
                    return entry

            # 3. Fallback: all keys blocked in Redis. Pick the one with the shortest cooldown TTL.
            min_ttl = float('inf')
            best_entry = _KEY_POOL[0]
            for entry in _KEY_POOL:
                key_id = entry["key_id"]
                ttl = await redis.ttl(f"gemini:key:{key_id}:cooldown")
                ttl = max(0, ttl)
                if ttl < min_ttl:
                    min_ttl = ttl
                    best_entry = entry
            return best_entry

        except Exception as e:
            import logging
            logging.getLogger(__name__).warning("Redis error in key picker, falling back to memory: %s", e)

    # 4. Memory fallback (if Redis is not connected/failed)
    # We maintain a global _KEY_POOL_INDEX in memory as secondary fallback
    global _KEY_POOL_INDEX
    n = len(_KEY_POOL)
    with _KEY_POOL_LOCK:
        for i in range(n):
            idx_mem = (_KEY_POOL_INDEX + i) % n
            entry = _KEY_POOL[idx_mem]
            if entry.get("rate_limited_until_mono", 0.0) <= now_mono:
                _KEY_POOL_INDEX = (idx_mem + 1) % n
                entry["call_count"] = entry.get("call_count", 0) + 1
                return entry
        # All keys temporarily rate-limited in memory — return soonest-recovering one
        return min(_KEY_POOL, key=lambda e: e.get("rate_limited_until_mono", 0.0))


async def _mark_key_rate_limited(entry: dict, retry_seconds: float = 65.0, is_daily: bool = False) -> None:
    """Mark a key as unavailable globally (Redis) and locally (Memory fallback)."""
    key_id = entry["key_id"]
    from database import get_redis
    redis = get_redis()

    if redis:
        try:
            if is_daily:
                # Daily limit hit: block key for 24 hours
                await redis.set(f"gemini:key:{key_id}:rpd_limit_hit", "1", ex=86400)
            else:
                # Transient limit hit: block key for retry_seconds
                await redis.set(f"gemini:key:{key_id}:cooldown", "1", ex=int(retry_seconds))
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning("Failed to mark key rate limited in Redis: %s", e)

    # Memory fallback tracking
    with _KEY_POOL_LOCK:
        entry["rate_limited_until_mono"] = time.monotonic() + (24 * 3600 if is_daily else retry_seconds)


async def get_key_pool_status() -> list[dict]:
    """Return pool health summary (for admin/debug endpoints)."""
    from database import get_redis
    redis = get_redis()
    status_list = []
    now_mono = time.monotonic()
    
    for i, e in enumerate(_KEY_POOL):
        key_id = e["key_id"]
        rate_limited = False
        recovers_in_s = 0.0
        daily_limit_hit = False

        if redis:
            try:
                cooldown_ttl = await redis.ttl(f"gemini:key:{key_id}:cooldown")
                rpd_ttl = await redis.ttl(f"gemini:key:{key_id}:rpd_limit_hit")
                if cooldown_ttl > 0:
                    rate_limited = True
                    recovers_in_s = float(cooldown_ttl)
                if rpd_ttl > 0:
                    daily_limit_hit = True
            except Exception:
                pass

        if not rate_limited and e.get("rate_limited_until_mono", 0.0) > now_mono:
            rate_limited = True
            recovers_in_s = max(0.0, round(e["rate_limited_until_mono"] - now_mono, 1))

        status_list.append({
            "index": i,
            "key_id": key_id,
            "masked_key": e["key"][:10] + "..." + e["key"][-10:] if len(e["key"]) > 20 else e["key"],
            "rate_limited": rate_limited,
            "daily_limit_hit": daily_limit_hit,
            "recovers_in_s": recovers_in_s,
        })
    return status_list



def _extract_response_text(response) -> str:
    text = (getattr(response, "text", None) or "").strip()
    if text:
        return text

    try:
        candidates = getattr(response, "candidates", None) or []
        for candidate in candidates:
            content = getattr(candidate, "content", None)
            parts = getattr(content, "parts", None) or []
            gathered = []
            for part in parts:
                part_text = getattr(part, "text", None)
                if isinstance(part_text, str) and part_text.strip():
                    gathered.append(part_text.strip())
            if gathered:
                return "\n".join(gathered).strip()
    except Exception:
        return ""

    return ""


def _is_transient_gemini_error(error: Exception) -> bool:
    message = str(error or "").lower()
    transient_markers = [
        "503",
        "unavailable",
        "resource_exhausted",
        "high demand",
        "deadline",
        "timed out",
        "timeout",
    ]
    return any(marker in message for marker in transient_markers)


def _candidate_gemini_models() -> list[str]:
    configured = [
        item.strip()
        for item in (getattr(settings, "GEMINI_FALLBACK_MODELS", "") or "").split(",")
        if item and item.strip()
    ]
    defaults = ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-flash-latest"]

    ordered = [settings.GEMINI_MODEL, *configured, *defaults]
    seen: set[str] = set()
    unique: list[str] = []
    for model in ordered:
        key = (model or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(key)
    return unique


async def call_gemini(
    prompt: str,
    system_instruction: str = None,
    *,
    max_attempts: int = 3,
    request_timeout_seconds: float | None = None,
) -> str:
    """Call Gemini API with a prompt and optional system instruction."""
    started_at = perf_counter()
    config = {}
    if system_instruction:
        config["system_instruction"] = system_instruction
    config["response_mime_type"] = "application/json"

    last_error = None
    model_candidates = _candidate_gemini_models()

    attempts = max(1, int(max_attempts or 1))
    for attempt in range(attempts):
        key_entry = await _pick_key()

        for model_name in model_candidates:
            try:
                try:
                    key_index = _KEY_POOL.index(key_entry) + 1
                except ValueError:
                    key_index = 0
                total_keys = len(_KEY_POOL)
                import logging
                logging.getLogger(__name__).info(
                    "Calling Gemini (attempt %d/%d) using API Key %d/%d (Key ID: %s, Model: %s)",
                    attempt + 1, attempts, key_index, total_keys, key_entry["key_id"], model_name
                )

                # Capture client at call-time to avoid closure issues during key rotation.
                def _invoke(_client=key_entry["client"]):
                    return _client.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config=config if config else None,
                    )

                if request_timeout_seconds and request_timeout_seconds > 0:
                    response = await asyncio.wait_for(
                        asyncio.to_thread(_invoke),
                        timeout=request_timeout_seconds,
                    )
                else:
                    response = await asyncio.to_thread(_invoke)

                response_text = _extract_response_text(response)
                if not response_text:
                    raise RuntimeError("Gemini returned an empty response")

                elapsed_ms = (perf_counter() - started_at) * 1000.0
                await record_latency("gemini_ms", elapsed_ms)
                return response_text

            except Exception as exc:
                last_error = exc
                message = str(exc or "").lower()

                # Rate-limit / quota exhausted — mark this key and immediately
                # rotate to the next available key before trying the next model.
                if (
                    "resource_exhausted" in message
                    or "429" in message
                    or "quota" in message
                ):
                    is_daily = "per day" in message or "daily" in message
                    limit_type = "Daily limit (RPD)" if is_daily else "Minute limit (RPM/TPM)"
                    try:
                        key_index = _KEY_POOL.index(key_entry) + 1
                    except ValueError:
                        key_index = 0
                    total_keys = len(_KEY_POOL)
                    import logging
                    logging.getLogger(__name__).warning(
                        "API Key %d/%d (Key ID: %s) hit 429 Rate Limit - Type: %s. Rotating key...",
                        key_index, total_keys, key_entry["key_id"], limit_type
                    )
                    await _mark_key_rate_limited(key_entry, is_daily=is_daily)
                    key_entry = await _pick_key()
                    continue

                # Transient service errors: try next model candidate.
                if _is_transient_gemini_error(exc):
                    continue

                # Model-not-found: try next candidate.
                if "not found" in message or "unsupported" in message:
                    continue

                break

        if _is_transient_gemini_error(last_error) and attempt < attempts - 1:
            await asyncio.sleep(0.8 * (attempt + 1))
            continue
        break

    elapsed_ms = (perf_counter() - started_at) * 1000.0
    await record_latency("gemini_ms", elapsed_ms)
    raise RuntimeError(f"Gemini request failed: {last_error}")


def _extract_json_object(text: str) -> str:
    value = (text or "").strip()
    if value.startswith("```"):
        value = value.split("\n", 1)[1]
    if value.endswith("```"):
        value = value.rsplit("```", 1)[0]
    value = value.strip()

    if value.startswith("{") and value.endswith("}"):
        return value

    # Fallback when model wraps JSON with extra text.
    start = value.find("{")
    end = value.rfind("}")
    if start != -1 and end != -1 and end > start:
        return value[start:end + 1]

    return value


def _extract_json_array(text: str) -> str:
    value = (text or "").strip()
    if value.startswith("```"):
        value = value.split("\n", 1)[1]
    if value.endswith("```"):
        value = value.rsplit("```", 1)[0]
    value = value.strip()

    if value.startswith("[") and value.endswith("]"):
        return value

    start = value.find("[")
    end = value.rfind("]")
    if start != -1 and end != -1 and end > start:
        return value[start:end + 1]

    return value


def _fallback_skill_scan(resume_text: str) -> list:
    common = [
        "python", "java", "javascript", "typescript", "react", "next.js", "node.js",
        "fastapi", "django", "flask", "spring", "mongodb", "postgresql", "mysql",
        "redis", "docker", "kubernetes", "aws", "gcp", "azure", "git", "linux",
        "rest api", "graphql", "machine learning", "data analysis", "sql",
    ]
    text = (resume_text or "").lower()
    found = []
    for skill in common:
        pattern = r"\b" + re.escape(skill.lower()) + r"\b"
        if re.search(pattern, text):
            found.append(skill)
    return normalize_skill_list(found)


def _is_unaware_answer(answer: str) -> bool:
    text = (answer or "").strip().lower()
    if not text:
        return False
    unaware_markers = [
        "don't know",
        "dont know",
        "no idea",
        "not aware",
        "haven't used",
        "have not used",
        "never used",
        "not familiar",
        "haven't worked",
        "have not worked",
        "don't recall",
        "dont recall",
    ]
    words = text.split()
    if len(words) <= 3 and any(w in ["no", "skip", "pass", "sorry", "none"] for w in words):
        return True
    return any(marker in text for marker in unaware_markers)


def _is_loose_answer(answer: str) -> bool:
    if _is_unaware_answer(answer):
        return False
    text = (answer or "").strip().lower()
    if not text:
        return True

    word_count = len(text.split())
    if word_count < 18:
        return True

    weak_markers = [
        "i think",
        "maybe",
        "not sure",
        "something like",
        "etc",
        "kind of",
        "sort of",
    ]
    return any(marker in text for marker in weak_markers)


def _collect_loose_qa(qa_pairs: list, limit: int = 4) -> list:
    loose = []
    for qa in reversed(qa_pairs or []):
        question = (qa or {}).get("question", "")
        answer = (qa or {}).get("answer", "")
        if not question or not answer:
            continue
        if _is_loose_answer(answer):
            loose.append({"question": question, "answer": answer})
        if len(loose) >= limit:
            break
    loose.reverse()
    return loose


def _collect_unaware_questions(qa_pairs: list) -> list[str]:
    unaware = []
    for qa in qa_pairs or []:
        question = (qa or {}).get("question", "")
        answer = (qa or {}).get("answer", "")
        if question and answer and _is_unaware_answer(answer):
            unaware.append(question)
    return unaware


async def parse_resume_with_gemini(resume_text: str) -> dict:
    """Parse resume text and extract structured data using Gemini."""
    prompt = f"""Analyze the following resume and extract structured information.
CRITICAL INSTRUCTION FOR SKILLS:
1) Extract concrete tools/technologies/frameworks/languages from the resume text.
2) Exclude vague traits such as "hardworking", "leadership", "problem solving", "communication".
3) If a line contains multiple skills (comma-separated), split them into separate list items.
4) Do NOT add skills that are not present in the resume.

Return a JSON object with these exact fields:
- "name": full name of the candidate (string or null)
- "email": candidate's email address (string or null)
- "phone": candidate's phone number (string or null)
- "location": candidate's location/address (string or null)
- "skills": list of technical and soft skills verbatim from the text (array of strings)
- "recommended_roles": list of 3-5 recommended job role titles the user is qualified for based on these skills (array of strings)
- "experience_summary": brief summary of work experience (string)
- "experience": list of dictionaries, each with "company", "role", "duration", and "description"
- "education": list of dictionaries, each with "institution", "degree", "graduation_year"
- "projects": list of dictionaries, each with "name" and "description"

Resume text:
---
{resume_text}
---

Return ONLY valid JSON, no markdown formatting."""

    try:
        result = await call_ollama(prompt)
        result = _extract_json_object(result)
    except Exception:
        return {
            "name": None,
            "email": None,
            "phone": None,
            "location": None,
            "skills": _fallback_skill_scan(resume_text),
            "recommended_roles": [],
            "experience_summary": "Unable to parse with AI right now. Please retry.",
            "experience": [],
            "education": [],
            "projects": [],
        }

    try:
        parsed = json.loads(result)
        parsed.setdefault("name", None)
        parsed.setdefault("email", None)
        parsed.setdefault("phone", None)
        parsed.setdefault("location", None)
        parsed.setdefault("recommended_roles", [])
        parsed.setdefault("experience_summary", "")
        parsed.setdefault("experience", [])
        parsed.setdefault("education", [])
        parsed.setdefault("projects", [])

        parsed["skills"] = normalize_skill_list(parsed.get("skills", []))
        if not parsed["skills"]:
            parsed["skills"] = _fallback_skill_scan(resume_text)
        return parsed
    except json.JSONDecodeError:
        return {
            "name": None,
            "email": None,
            "phone": None,
            "location": None,
            "skills": _fallback_skill_scan(resume_text),
            "recommended_roles": [],
            "experience_summary": result, 
            "experience": [],
            "education": [], 
            "projects": []
        }


async def parse_jd_with_gemini(jd_text: str) -> dict:
    """Extract structured job description data (title, description, required_skills) from raw text."""
    prompt = f"""You are a job description parser. Extract structured information from the given job description text.

Return ONLY valid JSON with exactly these fields:
{{
  "title": "job title (string)",
  "company": "company name if present, else null",
  "description": "cleaned full job description text (string)",
  "required_skills": ["skill1", "skill2", ...]
}}

Rules:
1. "title" — infer the most appropriate job title from the content (e.g. "Software Engineer", "Data Analyst").
2. "company" — extract if explicitly mentioned, otherwise null.
3. "description" — cleaned, coherent description text; keep it as a single string.
4. "required_skills" — extract only specific, technical skills, tools, languages, or certifications; no vague traits.

Job Description Text:
---
{jd_text}
---

Return ONLY valid JSON, no markdown."""

    try:
        raw = await call_ollama(prompt)
        cleaned = _extract_json_object(raw)
        parsed = json.loads(cleaned)
        return {
            "title": (parsed.get("title") or "").strip() or "Untitled",
            "company": (parsed.get("company") or "").strip() or None,
            "description": (parsed.get("description") or "").strip() or jd_text[:2000],
            "required_skills": normalize_skill_list(parsed.get("required_skills") or []),
        }
    except Exception:
        return {
            "title": "Untitled",
            "company": None,
            "description": jd_text[:2000],
            "required_skills": [],
        }


async def analyze_resume_vs_job_description(
    role_title: str,
    resume_skills: list,
    resume_summary: str,
    jd_title: str,
    jd_description: str,
    jd_required_skills: list | None = None,
) -> dict:
    """Compare resume and job description to produce interview guidance."""
    jd_required_skills = jd_required_skills or []
    prompt = f"""You are an interview coach helping a student prepare for a job.

Role title: {role_title}
Job Description Title: {jd_title}
Job Description Text:
---
{jd_description}
---

Job Description Required Skills (if provided): {json.dumps(jd_required_skills)}

Student Resume Skills: {json.dumps(resume_skills)}
Student Resume Summary:
---
{resume_summary}
---

Return ONLY valid JSON with this structure:
{{
  "meeting_expectations": ["..."],
  "missing_expectations": ["..."],
  "improvement_suggestions": ["..."],
  "fit_summary": "short summary"
}}

Rules:
1) Be practical and concise.
2) Mention what already matches first.
3) Missing expectations should be specific and skill/experience-oriented.
4) Suggestions should be actionable and student-friendly.
5) Avoid harsh wording.
"""

    try:
        result = _extract_json_object(await call_ollama(prompt))
        parsed = json.loads(result)
        return {
            "meeting_expectations": parsed.get("meeting_expectations", [])[:10],
            "missing_expectations": parsed.get("missing_expectations", [])[:10],
            "improvement_suggestions": parsed.get("improvement_suggestions", [])[:10],
            "fit_summary": parsed.get("fit_summary", ""),
        }
    except Exception:
        resume_set = {s.lower() for s in normalize_skill_list(resume_skills)}
        required = normalize_skill_list(jd_required_skills)
        missing = [s for s in required if s.lower() not in resume_set]
        met = [s for s in required if s.lower() in resume_set]
        return {
            "meeting_expectations": met[:6],
            "missing_expectations": missing[:6],
            "improvement_suggestions": [
                "Build 1-2 focused projects aligned with missing JD skills.",
                "Use STAR-style examples for your strongest matching skills.",
                "Revise resume bullets to highlight measurable impact.",
            ],
            "fit_summary": "You match some expectations and can improve fit by addressing the missing skills.",
        }


async def generate_interview_question(
    skills: list,
    role_title: str,
    previous_questions: list = None,
    previous_answer: str = None,
    difficulty: str = "medium",
    question_stage: str = "deep",
    foundation_limit: int = 3,
) -> dict:
    """Generate an interview question using Gemini."""
    context = f"Role: {role_title}\nCandidate Skill Focus Areas: {', '.join(skills)}\nDifficulty: {difficulty}"
    context += f"\nCurrent Stage: {question_stage}"
    context += f"\nFoundation Question Limit: {foundation_limit}"

    if previous_questions:
        context += f"\n\nPrevious questions asked (do NOT repeat these):\n"
        for i, q in enumerate(previous_questions, 1):
            context += f"{i}. {q}\n"

    if previous_answer:
        context += f"\nCandidate's last answer: {previous_answer}"
        context += "\nGenerate a follow-up question based on this answer to probe deeper."

    prompt_template = PromptTemplate.from_template(
        """{language_rule}
{context}

Generate ONE interview question for this candidate. The question should:
1. Be relevant to the role and candidate's skills
1a. Ask ONLY from the provided Candidate Skill Focus Areas. Do not introduce technologies/skills outside that list.
2. Match the {difficulty} difficulty level (see DIFFICULTY GUIDE above)
3. Be clear and specific
4. Test practical knowledge
5. If a skill is a cluster label like "Deep Learning (CNN, LSTM)", pick one member skill from that cluster and ask a concrete question on it
6. Rotate topics to avoid repeatedly asking from the same cluster
7. If Current Stage is "foundation": ask only core/fundamental basics (easy-level definition questions)
8. If Current Stage is "applied": ask practical usage or comparison questions (medium-level)
9. If Current Stage is "deep": ask applied scenario, debugging, optimization, or trade-off questions only (hard-level)
10. Once the foundation stage is done, never return to basic definition questions
11. VOICE INTERVIEW — CRITICAL: Never ask the candidate to write code, implement a function, write SQL, draw a diagram, or produce any written/visual output. All questions must be answerable by speaking only.

Return ONLY a JSON object with:
- "question": the interview question text
- "difficulty": "{difficulty}"
- "category": the skill category this tests

Return ONLY valid JSON, no markdown formatting."""
    )
    prompt = prompt_template.format(context=context, difficulty=difficulty, language_rule=_QUESTION_LANGUAGE_RULE)

    try:
        result = _extract_json_object(await call_ollama(prompt))
        return json.loads(result)
    except Exception:
        return {
            "question": f"Tell me about your experience with {skills[0] if skills else 'software development'}.",
            "difficulty": difficulty,
            "category": "general",
        }


async def generate_interview_question_batch(
    skills: list,
    role_title: str,
    count: int,
    start_question_number: int = 1,
    previous_questions: list = None,
    foundation_limit: int = 3,
) -> list:
    """Generate a batch of interview questions in a single Gemini call."""
    previous_questions = previous_questions or []
    count = max(0, int(count or 0))
    if count == 0:
        return []

    plan = []
    for i in range(count):
        qn = start_question_number + i
        # Progressive ramp: easy warmup → medium applied → hard deep
        if qn <= foundation_limit:
            difficulty = "easy"
            stage = "foundation"
        else:
            relative = qn - foundation_limit
            if relative <= 4:
                difficulty = "medium"
                stage = "applied"
            else:
                difficulty = "hard"
                stage = "deep"
        plan.append({"question_number": qn, "difficulty": difficulty, "stage": stage})

    context = (
        f"Role: {role_title}\n"
        f"Candidate Skill Focus Areas: {', '.join(skills)}\n"
        f"Question Plan: {json.dumps(plan)}\n"
        f"Foundation Question Limit: {foundation_limit}"
    )

    if previous_questions:
        context += "\n\nPrevious questions asked (do NOT repeat these):\n"
        for i, q in enumerate(previous_questions, 1):
            context += f"{i}. {q}\n"

    prompt_template = PromptTemplate.from_template(
        """{language_rule}
{context}

Generate exactly {count} interview questions as a JSON array where each item follows the corresponding Question Plan entry.

Rules:
1. Questions must be relevant to the role and listed skills.
1a. Ask ONLY from the provided Candidate Skill Focus Areas. Do not introduce skills outside this list.
2. Do not repeat or rephrase previous questions.
3. If stage is "foundation": ask only basic definition or identification questions (easy-level).
4. If stage is "applied": ask practical usage or comparison questions (medium-level).
5. If stage is "deep": ask scenario, debugging, optimization, or trade-off questions (hard-level).
6. Rotate topics across skills to avoid repetitive focus.
7. If a skill is a cluster label like "Deep Learning (CNN, LSTM)", ask about one concrete member skill.
8. VOICE INTERVIEW — CRITICAL: Never ask the candidate to write code, implement a function, write SQL, draw a diagram, or produce any written/visual output. All questions must be answerable by speaking only. Use phrasing like "How would you approach...", "Explain how...", "Walk me through..." instead.

Return ONLY valid JSON array with objects of shape:
- "question": string
- "difficulty": one of "easy" | "medium" | "hard"
- "category": string

Return ONLY JSON, no markdown."""
    )
    prompt = prompt_template.format(context=context, count=count, language_rule=_QUESTION_LANGUAGE_RULE)

    try:
        result = _extract_json_array((await call_ollama(prompt)).strip())
        data = json.loads(result)
        if not isinstance(data, list):
            raise ValueError("Batch response is not a list")
        normalized = []
        for i, item in enumerate(data[:count]):
            spec = plan[i]
            if not isinstance(item, dict):
                item = {}
            normalized.append(
                {
                    "question": item.get("question") or f"Explain your approach for {skills[0] if skills else 'this topic'}.",
                    "difficulty": item.get("difficulty") if item.get("difficulty") in {"easy", "medium", "hard"} else spec["difficulty"],
                    "category": item.get("category") or "general",
                }
            )
        while len(normalized) < count:
            spec = plan[len(normalized)]
            normalized.append(
                {
                    "question": f"Tell me about your experience with {skills[0] if skills else 'software development'}.",
                    "difficulty": spec["difficulty"],
                    "category": "general",
                }
            )
        return normalized
    except Exception:
        fallback = []
        for i in range(count):
            spec = plan[i]
            fallback.append(
                {
                    "question": f"Tell me about your experience with {skills[0] if skills else 'software development'}.",
                    "difficulty": spec["difficulty"],
                    "category": "general",
                }
            )
        return fallback


async def generate_realtime_technical_round(
    role_title: str,
    resume_skills: list,
    resume_summary: str,
    jd_title: str,
    jd_description: str,
    jd_required_skills: list,
    previous_questions: list,
    count: int = 10,
) -> list:
    """Generate a full interview round plan from opening to closing using resume + JD context."""
    count = max(1, int(count or 10))
    skills = normalize_skill_list(resume_skills or [])
    jd_skills = normalize_skill_list(jd_required_skills or [])

    # Use small randomness to avoid deterministic opening phrasing across attempts.
    variation_seed = random.randint(1000, 9999)

    payload = {
        "role_title": role_title,
        "resume_skills": skills,
        "resume_summary": resume_summary,
        "jd_title": jd_title,
        "jd_description": jd_description,
        "jd_required_skills": jd_skills,
        "previous_questions": previous_questions[-30:] if previous_questions else [],
        "count": count,
        "variation_seed": variation_seed,
    }

    prompt_template = PromptTemplate.from_template(
        """You are an expert interviewer creating a realistic technical interview round.

Input JSON:
{payload}

Task:
Generate exactly {count} questions in sequence, simulating one real-time technical round from opening to wrap-up.

Required flow:
1) Opening/warm-up that is specific to the candidate profile and role.
2) Resume-linked experience probe.
3-7) Deep technical questions grounded in JD-required skills.
8) Debugging/failure-mode question.
9) Design/trade-off/decision-making question.
10) Final reflective closing question.

Strict rules:
1. Ask ONLY within JD required skills and role scope.
2. Use resume context to personalize wording and sequencing.
3. Do NOT repeat or closely paraphrase any question in previous_questions.
4. If previous_questions already include a generic "introduce yourself" opener, do not use that opener again.
5. Keep wording concise and interview-ready.

Return ONLY valid JSON array with objects:
- "question": string
- "difficulty": "easy" | "medium" | "hard"
- "category": string

No markdown, no extra text."""
    )

    prompt = prompt_template.format(payload=json.dumps(payload, ensure_ascii=True), count=count)

    try:
        result = _extract_json_array((await call_gemini(prompt)).strip())
        data = json.loads(result)
        if not isinstance(data, list):
            raise ValueError("Realtime round response is not a list")

        normalized = []
        for i, item in enumerate(data[:count]):
            if not isinstance(item, dict):
                item = {}

            if i <= 1:
                fallback_difficulty = "easy"
            elif i <= 6:
                fallback_difficulty = "medium"
            else:
                fallback_difficulty = "hard"

            normalized.append(
                {
                    "question": item.get("question") or f"Explain your approach to {jd_skills[0] if jd_skills else (skills[0] if skills else 'this role expectation')}",
                    "difficulty": item.get("difficulty") if item.get("difficulty") in {"easy", "medium", "hard"} else fallback_difficulty,
                    "category": item.get("category") or "technical-round",
                }
            )

        while len(normalized) < count:
            idx = len(normalized)
            if idx == 0:
                fallback_q = "Walk me through your background and the projects most relevant to this role."
            elif idx == count - 1:
                fallback_q = "If you had one week to improve your readiness for this role, what would you focus on and why?"
            else:
                target_skill = jd_skills[idx % len(jd_skills)] if jd_skills else (skills[idx % len(skills)] if skills else "this requirement")
                fallback_q = f"How would you handle a practical scenario involving {target_skill}?"

            normalized.append(
                {
                    "question": fallback_q,
                    "difficulty": "easy" if idx <= 1 else ("medium" if idx <= 6 else "hard"),
                    "category": "technical-round",
                }
            )

        return normalized[:count]
    except Exception:
        fallback = []
        skill_pool = jd_skills or skills or ["core technical concepts"]
        for idx in range(count):
            if idx == 0:
                text = "Walk me through your background and the most role-relevant work you have done."
            elif idx == 1:
                text = "Pick one project from your resume and explain your exact responsibilities and impact."
            elif idx == count - 2:
                text = "Describe a difficult production issue you would debug for this role and your step-by-step approach."
            elif idx == count - 1:
                text = "What is one technical area you would improve next for this job, and what is your plan?"
            else:
                text = f"How would you solve a realistic problem involving {skill_pool[idx % len(skill_pool)]}?"

            fallback.append(
                {
                    "question": text,
                    "difficulty": "easy" if idx <= 1 else ("medium" if idx <= 6 else "hard"),
                    "category": "technical-round",
                }
            )
        return fallback


async def generate_followup_question_batch_from_qa(
    role_title: str,
    skills: list,
    qa_pairs: list,
    previous_questions: list,
    count: int,
    difficulty: str = "medium",
    experience_level: str = "mid",
    company_name: str = "",
) -> list:
    """Generate follow-up questions from interview Q&A context in a single Gemini call."""
    count = max(0, int(count or 0))
    if count == 0:
        return []

    compact_qa = []
    for qa in qa_pairs[-8:]:
        q = (qa or {}).get("question", "")
        a = (qa or {}).get("answer", "")
        if q and a:
            compact_qa.append({"question": q, "answer": a})

    payload = {
        "role_title": role_title,
        "skills": skills,
        "difficulty": difficulty,
        "count": count,
        "answered_qa": compact_qa,
        "loose_qa": _collect_loose_qa(qa_pairs),
        "unaware_questions": _collect_unaware_questions(qa_pairs),
        "previous_questions": previous_questions,
        "company_name": company_name or "",
        "experience_level": experience_level or "mid",
    }

    level_instruction = {
        "fresher": (
            "Candidate level is FRESHER. Ask foundational questions only: "
            "definitions, basic usage, simple scenarios a student or new graduate could answer. "
            "Avoid system design, production trade-offs, and advanced optimization."
        ),
        "senior": (
            "Candidate level is SENIOR. Ask deep technical questions: "
            "architecture decisions, production failure analysis, scalability trade-offs."
        ),
    }.get(
        experience_level,
        "Candidate level is MID-LEVEL. Balance practical implementation with some conceptual depth.",
    )

    company_instruction = (
        f'The candidate is applying to "{company_name}". '
        f"Tailor questions to reflect the values and technical depth {company_name} is known for in interviews."
        if company_name
        else ""
    )

    prompt_template = PromptTemplate.from_template(
        """You are generating strict, concept-focused technical interview follow-up questions.

Input JSON:
{payload}

{level_instruction}
{company_instruction}

Instructions:
1. Generate exactly {count} follow-up questions using answered_qa context.
2. Questions must continue naturally from candidate's previous answers.
2a. Ask ONLY from the provided skills list. Do not introduce new unrelated skills/tools.
2b. If the candidate's answer indicates they do not know, are not familiar with, or lack experience with a concept (listed in unaware_questions), DO NOT ask any follow-up or future questions on that topic. Immediately switch/rotate to a completely different skill/topic from the skills list.
3. Do not repeat, paraphrase, or ask about the same concept as previous_questions or unaware_questions.
4. Prioritize loose_qa first: if any answer is vague/short/uncertain (and NOT an unaware response), ask a direct follow-up that probes missing concept depth.
5. Focus on concept validation (why, how, trade-offs, failure modes), not memorized definitions.
6. Keep questions practical and role-relevant.
7. Use difficulty {difficulty}. Strictly respect the candidate level instruction above.

Return ONLY valid JSON array with objects:
- "question": string
- "difficulty": "easy" | "medium" | "hard"
- "category": string

No markdown, no extra text."""
    )
    prompt = prompt_template.format(
        payload=json.dumps(payload, ensure_ascii=True),
        count=count,
        difficulty=difficulty,
        level_instruction=level_instruction,
        company_instruction=company_instruction,
    )

    try:
        result = await call_ollama(
            prompt,
            max_attempts=3,
            request_timeout_seconds=20,
        )
        data = json.loads(_extract_json_array(result.strip()))
        if not isinstance(data, list):
            raise ValueError("Follow-up batch response is not a list")

        normalized = []
        for item in data[:count]:
            if not isinstance(item, dict):
                item = {}
            normalized.append(
                {
                    "question": item.get("question") or f"Can you explain your approach for {skills[0] if skills else 'this scenario'}?",
                    "difficulty": item.get("difficulty") if item.get("difficulty") in {"easy", "medium", "hard"} else difficulty,
                    "category": item.get("category") or "follow-up",
                }
            )

        while len(normalized) < count:
            normalized.append(
                {
                    "question": f"Can you explain your approach for {skills[0] if skills else 'this scenario'}?",
                    "difficulty": difficulty,
                    "category": "follow-up",
                }
            )
        return normalized
    except Exception:
        fallback = []
        for _ in range(count):
            fallback.append(
                {
                    "question": f"Can you explain your approach for {skills[0] if skills else 'this scenario'}?",
                    "difficulty": difficulty,
                    "category": "follow-up",
                }
            )
        return fallback


async def evaluate_interview(questions_and_answers: list, role_title: str) -> dict:
    """Batch evaluate all interview Q&A pairs using Gemini."""

    def _clamp_score(value, default: int = 50) -> int:
        try:
            score = int(value)
        except Exception:
            score = default
        return max(0, min(100, score))

    def _fallback_item_score(answer: str) -> int:
        text = (answer or "").strip().lower()
        words = len(text.split())
        if words < 10:
            return 35
        if words < 25:
            return 52
        if any(marker in text for marker in ["not sure", "maybe", "i think", "dont know", "don't know"]):
            return 50
        if words > 90:
            return 74
        return 64

    if not questions_and_answers:
        return {
            "overall_score": 50,
            "detailed_scores": [],
            "strengths": ["No answers were available for evaluation"],
            "weaknesses": ["No answers were available for evaluation"],
            "recommendations": ["Complete the interview and generate report again"],
        }

    compact_qa = []
    for i, qa in enumerate(questions_and_answers, 1):
        question = (qa.get("question") or "").strip()
        answer = (qa.get("answer") or "").strip()
        compact_qa.append(
            {
                "index": i,
                "question": question[:260],
                "answer": answer[:520],
            }
        )

    payload = {
        "role_title": role_title,
        "question_count": len(compact_qa),
        "qa": compact_qa,
    }

    prompt_template = PromptTemplate.from_template(
        """You are a strict technical interviewer evaluating a candidate for role: {role_title}.

Input JSON:
{payload}

Scoring policy:
1) Score conceptual correctness and depth, not verbosity.
2) Penalize vague, uncertain, or incorrect technical claims.
3) Reward concrete reasoning, trade-offs, and debugging clarity.

Return ONLY valid JSON object with this exact schema:
{{
  "overall_score": 0-100 integer (weighted balance of technical score and language/grammar),
  "technical_score": 0-100 integer (representing the overall technical knowledge shown across all questions),
  "grammatical_score": 0-100 integer (representing the overall language usage, grammar, and speaking clarity shown across all answers),
  "per_question": [
    {{"index": 1-based integer, "score": 0-100 integer, "feedback": "short concept-focused feedback"}}
  ],
  "strengths": ["3 to 5 concise points"],
  "weaknesses": ["3 to 5 concise points"],
  "recommendations": ["3 to 5 actionable points"]
}}

Rules:
- per_question must include every question index from 1..question_count exactly once.
- Do NOT echo full question or answer text in output.
- Keep each feedback under 220 characters.
"""
    )
    prompt = prompt_template.format(
        role_title=role_title,
        payload=json.dumps(payload, ensure_ascii=True),
    )

    parsed = None
    try:
        result = _extract_json_object(
            await call_ollama(
                prompt,
                max_attempts=3,
                request_timeout_seconds=45,
            )
        )
        parsed = json.loads(result)
    except Exception:
        parsed = None

    score_map: dict[int, tuple[int, str]] = {}
    if isinstance(parsed, dict):
        for item in parsed.get("per_question", []) or []:
            if not isinstance(item, dict):
                continue
            idx = item.get("index")
            try:
                index = int(idx)
            except Exception:
                continue
            if index < 1 or index > len(questions_and_answers):
                continue
            score = _clamp_score(item.get("score"), _fallback_item_score(questions_and_answers[index - 1].get("answer", "")))
            feedback = (item.get("feedback") or "").strip() or "Answer reviewed with focus on conceptual correctness."
            score_map[index] = (score, feedback)

    detailed_scores = []
    for index, qa in enumerate(questions_and_answers, 1):
        fallback_score = _fallback_item_score(qa.get("answer", ""))
        score, feedback = score_map.get(
            index,
            (fallback_score, "Could not derive detailed AI feedback for this answer; score based on response quality signals."),
        )
        detailed_scores.append(
            {
                "question": qa.get("question", ""),
                "answer": qa.get("answer", ""),
                "score": score,
                "feedback": feedback,
            }
        )

    if isinstance(parsed, dict):
        overall_score = _clamp_score(parsed.get("overall_score"), int(round(sum(item["score"] for item in detailed_scores) / max(1, len(detailed_scores)))))
        technical_score = _clamp_score(parsed.get("technical_score"), overall_score)
        grammatical_score = _clamp_score(parsed.get("grammatical_score"), 75)
        strengths = [str(s).strip() for s in (parsed.get("strengths") or []) if str(s).strip()][:5]
        weaknesses = [str(w).strip() for w in (parsed.get("weaknesses") or []) if str(w).strip()][:5]
        recommendations = [str(r).strip() for r in (parsed.get("recommendations") or []) if str(r).strip()][:5]

        if not strengths:
            strengths = ["Shows baseline understanding in parts of the discussion"]
        if not weaknesses:
            weaknesses = ["Needs deeper concept-level reasoning and sharper technical precision"]
        if not recommendations:
            recommendations = ["Practice answering with mechanisms, trade-offs, and one concrete production example per question"]

        return {
            "overall_score": overall_score,
            "technical_score": technical_score,
            "grammatical_score": grammatical_score,
            "detailed_scores": detailed_scores,
            "strengths": strengths,
            "weaknesses": weaknesses,
            "recommendations": recommendations,
        }

    fallback_overall = int(round(sum(item["score"] for item in detailed_scores) / max(1, len(detailed_scores))))
    return {
        "overall_score": _clamp_score(fallback_overall, 50),
        "technical_score": _clamp_score(fallback_overall, 50),
        "grammatical_score": 75,
        "detailed_scores": detailed_scores,
        "strengths": ["Attempted responses for all interview prompts"],
        "weaknesses": ["Detailed AI evaluation was unavailable for this run"],
        "recommendations": ["Retry report generation to get full AI feedback"],
    }
