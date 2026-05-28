import json
import asyncio
import random
import re
import weakref
from time import perf_counter
from bson import ObjectId
from database import get_db, get_redis
from models.collections import SESSIONS, USERS, JOB_ROLES, SKILLS, QUESTIONS, TOPICS, TOPIC_QUESTIONS, RESUMES, JD_VERIFICATIONS, ANSWERS
from utils.helpers import generate_id, utc_now, str_objectid
from utils.skills import normalize_skill_list, build_interview_focus_skills
from services.interview_graph import run_interview_graph
from utils.gemini import generate_interview_question_batch, analyze_resume_vs_job_description
from services.job_description_service import get_job_description_for_user
from services.gemini_service import (
    evaluate_and_generate_followup,
    generate_resume_seed_questions,
    generate_topic_followup_batch,
)
from services.queue_service import (
    enqueue_question,
    flush_backlog_to_queue,
    get_recent_context_items,
    mark_question_asked,
    normalize_question_text,
    peek_next_question,
    pop_next_question,
    push_context_item,
    question_fingerprint as _question_fingerprint,
    queue_size,
)
from services.tts_service import prefetch_wav
from services.latency_service import record_latency

MAX_QUESTIONS = 20
RESUME_MAX_QUESTIONS = 10
RESUME_INITIAL_BATCH_SIZE = 2
SESSION_TTL = 7200  # 2 hours
BATCH_SIZE = 5
PREGEN_MIN_PENDING = 2
FOLLOWUP_AI_COUNT = 2
FOLLOWUP_BANK_COUNT = 3
MAX_QUEUE_SIZE = 3
CONTEXT_CACHE_ITEMS = 3

TOPIC_INITIAL_DB_QUESTIONS = 5
TOPIC_INITIAL_ASK_COUNT = 4
TOPIC_AI_FOLLOWUPS = 3
TOPIC_DB_FOLLOWUPS = 2
TOPIC_TOTAL_QUESTIONS = 10
MAX_SAME_TOPIC_FOLLOWUPS = 2
THIRD_FOLLOWUP_NEED_SCORE = 95

# Per-session locks for concurrent submit protection.
# WeakValueDictionary allows GC to collect locks once no coroutine holds them.
_POST_SUBMIT_LOCKS: weakref.WeakValueDictionary = weakref.WeakValueDictionary()
_QUESTION_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "if", "in", "into",
    "is", "it", "of", "on", "or", "that", "the", "this", "to", "using", "what", "when", "with", "would",
}
_GENERIC_SOFT_SKILL_KEYS = {
    "problem solving",
    "analytical skills",
    "communication",
    "communication skills",
    "teamwork",
    "leadership",
    "adaptability",
    "time management",
    "critical thinking",
}


def _safe_json_list(value: str) -> list:
    try:
        data = json.loads(value or "[]")
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _question_token_set(text: str) -> set[str]:
    key = _question_fingerprint(text)
    tokens = [token for token in key.split() if token and token not in _QUESTION_STOPWORDS]
    return set(tokens)


def _is_question_too_similar(candidate: str, recent_questions: list[str]) -> bool:
    candidate_key = _question_fingerprint(candidate)
    if not candidate_key:
        return True

    candidate_tokens = _question_token_set(candidate)
    candidate_opening = " ".join(candidate_key.split()[:6])

    for text in (recent_questions or [])[-5:]:
        other_key = _question_fingerprint(text)
        if not other_key:
            continue
        if candidate_key == other_key:
            return True

        other_opening = " ".join(other_key.split()[:6])
        if candidate_opening and candidate_opening == other_opening:
            return True

        other_tokens = _question_token_set(text)
        if not candidate_tokens or not other_tokens:
            continue

        intersection = len(candidate_tokens & other_tokens)
        union = len(candidate_tokens | other_tokens)
        if union <= 0:
            continue

        jaccard = intersection / union
        if jaccard >= 0.72:
            return True

    return False


def _unique_question_items(items: list[dict], *, excluded_questions: list[str], limit: int) -> list[dict]:
    excluded = {_question_fingerprint(q) for q in excluded_questions if q}
    unique: list[dict] = []
    for item in items or []:
        text = (item.get("question") or "").strip()
        if not text:
            continue
        key = _question_fingerprint(text)
        if not key or key in excluded:
            continue
        excluded.add(key)
        unique.append(
            {
                "question": text,
                "difficulty": item.get("difficulty", "medium"),
                "category": item.get("category", "general"),
            }
        )
        if len(unique) >= limit:
            break
    return unique


async def _update_local_summary(redis, session_id: str, question: str, answer: str) -> None:
    key = f"session:{session_id}:local_summary"
    existing = (await redis.get(key)) or ""
    combined = f"{existing}\nQ: {question}\nA: {answer}".strip()
    await redis.set(key, combined[-1500:], ex=SESSION_TTL)


def _safe_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _safe_score_0_100(value, default: int = 0) -> int:
    score = _safe_int(value, default)
    if score < 0:
        return 0
    if score > 100:
        return 100
    return score


def _normalize_voice_gender(value: str | None) -> str:
    return "male" if (value or "").strip().lower() == "male" else "female"


def _consume_prefetch_task_result(task: asyncio.Task) -> None:
    try:
        task.result()
    except Exception:
        # Prefetch is optional; ignore failures to avoid noisy task warnings.
        pass


def _schedule_question_audio_prefetch(questions: list[str], voice_gender: str) -> None:
    for q in questions:
        text = (q or "").strip()
        if not text:
            continue
        try:
            task = asyncio.create_task(prefetch_wav(text, voice_gender))
            task.add_done_callback(_consume_prefetch_task_result)
        except Exception:
            # Best-effort optimization only.
            pass


def _get_post_submit_lock(session_id: str) -> asyncio.Lock:
    lock = _POST_SUBMIT_LOCKS.get(session_id)
    if lock is None:
        lock = asyncio.Lock()
        _POST_SUBMIT_LOCKS[session_id] = lock
    return lock


def _consume_post_submit_task_result(task: asyncio.Task) -> None:
    try:
        task.result()
    except Exception:
        # Background processing is best-effort; ignore task-level failures.
        pass


def _current_generation_stats(session: dict) -> dict:
    return {
        "gemini_calls": _safe_int(session.get("metrics_gemini_calls", 0)),
        "gemini_questions": _safe_int(session.get("metrics_gemini_questions", 0)),
        "bank_questions": _safe_int(session.get("metrics_bank_questions", 0)),
        "bank_shortfall": _safe_int(session.get("metrics_bank_shortfall", 0)),
        "generation_batches": _safe_int(session.get("metrics_generation_batches", 0)),
    }


def _normalize_bank_difficulty(value: str) -> str:
    difficulty = (value or "medium").strip().lower()
    if difficulty not in {"easy", "medium", "hard"}:
        return "medium"
    if difficulty == "easy":
        return "medium"
    return difficulty


def _resume_skill_pool(session: dict) -> list[str]:
    jd_skills = normalize_skill_list(_safe_json_list(session.get("jd_required_skills", "[]")))
    focus_skills = normalize_skill_list(_safe_json_list(session.get("skills", "[]")))

    ordered: list[str] = []
    seen: set[str] = set()
    for skill in jd_skills + focus_skills:
        key = _question_fingerprint(skill)
        if not key or key in seen:
            continue
        seen.add(key)
        ordered.append(skill)

    concrete = [skill for skill in ordered if _question_fingerprint(skill) not in _GENERIC_SOFT_SKILL_KEYS]
    if len(concrete) >= 2:
        return concrete

    return ordered or ["core technical concepts"]


def _infer_focus_skill_from_question(question_text: str, skill_pool: list[str]) -> str | None:
    normalized_question = _question_fingerprint(question_text)
    if not normalized_question:
        return None

    best_skill = None
    best_score = 0

    for skill in skill_pool:
        normalized_skill = _question_fingerprint(skill)
        if not normalized_skill:
            continue

        tokens = [token for token in normalized_skill.split() if len(token) >= 3]
        if not tokens:
            tokens = normalized_skill.split()

        score = sum(1 for token in tokens if token and token in normalized_question)
        if normalized_skill in normalized_question:
            score = max(score, len(tokens) + 1)

        if score > best_score:
            best_score = score
            best_skill = skill

    return best_skill if best_score > 0 else None


def _recent_focus_streak(question_texts: list[str], skill_pool: list[str]) -> tuple[str | None, int]:
    active_skill = None
    streak = 0

    for text in reversed(question_texts):
        skill = _infer_focus_skill_from_question(text, skill_pool)
        if not skill:
            break

        if active_skill is None:
            active_skill = skill
            streak = 1
            continue

        if _question_fingerprint(skill) == _question_fingerprint(active_skill):
            streak += 1
            continue

        break

    return active_skill, streak


def _pick_alternate_focus_skill(skill_pool: list[str], current_skill: str | None, seed: int) -> str | None:
    if not skill_pool:
        return None

    if current_skill:
        current_key = _question_fingerprint(current_skill)
        alternatives = [skill for skill in skill_pool if _question_fingerprint(skill) != current_key]
        if alternatives:
            return alternatives[max(0, seed) % len(alternatives)]

    return skill_pool[max(0, seed) % len(skill_pool)]


def _apply_resume_followup_policy(
    *,
    skill_pool: list[str],
    recent_focus_topic: str | None,
    same_topic_streak: int,
    suggested_question: str,
    suggested_topic: str | None,
    followup_need_score: int,
    answered_count: int,
) -> tuple[str, str | None]:
    follow_text = (suggested_question or "").strip()
    topic = (suggested_topic or "").strip()

    if not topic and follow_text:
        inferred = _infer_focus_skill_from_question(follow_text, skill_pool)
        if inferred:
            topic = inferred

    topic_key = _question_fingerprint(topic)
    recent_key = _question_fingerprint(recent_focus_topic or "")

    if (
        same_topic_streak >= MAX_SAME_TOPIC_FOLLOWUPS
        and topic_key
        and recent_key
        and topic_key == recent_key
        and _safe_score_0_100(followup_need_score) < THIRD_FOLLOWUP_NEED_SCORE
    ):
        return "", _pick_alternate_focus_skill(skill_pool, recent_focus_topic, answered_count)

    return follow_text, None


def _avg_recent_answer_words(qa_pairs: list, window: int = 3) -> int:
    if not qa_pairs:
        return 0
    recent = qa_pairs[-window:]
    lengths = [len((item.get("answer") or "").split()) for item in recent]
    if not lengths:
        return 0
    return sum(lengths) // len(lengths)


def _plan_followup_mix(target: int, qa_pairs: list, has_bank_source: bool) -> tuple[int, int]:
    """Decide AI-vs-bank split for the next batch.

    Baseline: 3 AI + 2 bank. Adaptation:
    - Short answers -> increase bank ratio for stability.
    - Rich answers -> increase AI follow-up ratio for personalization.
    """
    if target <= 0:
        return 0, 0
    if not has_bank_source:
        return target, 0

    avg_words = _avg_recent_answer_words(qa_pairs)

    ai_target = min(FOLLOWUP_AI_COUNT, target)
    if avg_words < 18:
        ai_target = min(2, target)
    elif avg_words > 70:
        ai_target = min(4, target)

    # Keep at least one bank question when a bank source exists and batch size allows.
    if target > 1:
        ai_target = min(ai_target, target - 1)

    bank_target = target - ai_target
    return ai_target, bank_target


async def _resolve_role_title(db, role_id: str | None, custom_role: str | None) -> str:
    if custom_role and custom_role.strip():
        return custom_role.strip()

    if role_id:
        try:
            role = await db[JOB_ROLES].find_one({"_id": ObjectId(role_id)})
            if role:
                return role["title"]
        except Exception:
            # If it's not a valid ObjectId, treat it as a direct generic title.
            return role_id

    return "Software Developer"


async def _get_recent_user_questions(db, user_id: str, limit: int = 40) -> list[str]:
    recent: list[str] = []
    seen: set[str] = set()

    cursor = db[ANSWERS].find({"user_id": user_id}, {"question": 1}).sort("stored_at", -1).limit(limit)
    async for doc in cursor:
        text = (doc.get("question") or "").strip()
        key = _question_fingerprint(text)
        if not text or not key or key in seen:
            continue
        seen.add(key)
        recent.append(text)

    return recent


_INTRO_TEMPLATES_GENERIC = [
    "Introduce yourself and explain how your background aligns with {role_phrase}.",
    "Walk me through your resume and tell me what makes you a good fit for {role_phrase}.",
    "Tell me about yourself — your key skills, notable projects, and why you are interested in {role_phrase}.",
    "Give a brief overview of your professional journey and how it has prepared you for {role_phrase}.",
    "Describe your most relevant experience and how it connects to {role_phrase}.",
    "What led you to apply for {role_phrase}, and how does your background support that decision?",
    "Summarize your technical background and explain how it positions you for {role_phrase}.",
    "Tell me about a project or achievement that best demonstrates your readiness for {role_phrase}.",
    "How would you describe your technical skill set as it relates to {role_phrase}?",
    "Start by telling me about your strongest area of expertise and how it applies to {role_phrase}.",
]

_INTRO_TEMPLATES_WITH_JD = [
    "Introduce yourself and explain how your background aligns with {role_phrase} in {title_phrase}.",
    "Walk me through your resume and tell me why you are a strong fit for {role_phrase} at {company_context}.",
    "Tell me about yourself and what excites you about this {role_phrase} opportunity.",
    "Give a brief overview of your experience and how it prepares you for {role_phrase}.",
    "Describe the most relevant project or skill that makes you a good candidate for {role_phrase}.",
    "What interests you most about this {role_phrase} position, and how does your background align with it?",
    "Summarize your technical background and explain why you feel ready for {role_phrase} at {company_context}.",
    "Tell me about your most impactful work so far and how it relates to the requirements of {role_phrase}.",
    "Walk me through your experience — especially any work that directly maps to what {company_context} is looking for.",
    "How has your journey prepared you specifically for the responsibilities of {role_phrase}?",
]


def _build_resume_intro_question(role_title: str, jd_title: str) -> str:
    role = (role_title or "this role").strip()
    title = (jd_title or "").strip()

    def _normalized_key(value: str) -> str:
        key = re.sub(r"[^a-z0-9\s]", " ", (value or "").lower())
        key = re.sub(r"\s+", " ", key).strip()
        for prefix in ("the ", "an ", "a "):
            if key.startswith(prefix):
                key = key[len(prefix):].strip()
                break
        return key

    role_clean = re.sub(r"\s+", " ", role).strip()
    if role_clean.lower().startswith("the "):
        role_clean = role_clean[4:].strip()
    role_phrase = f"the {role_clean}" if role_clean.lower().endswith(" role") else f"the {role_clean} role"

    role_key = _normalized_key(role_clean)
    title_key = _normalized_key(title)
    is_generic_title = title_key in {
        "",
        "selected job description",
        role_key,
        f"{role_key} role",
    }

    if is_generic_title:
        template = random.choice(_INTRO_TEMPLATES_GENERIC)
        return template.format(role_phrase=role_phrase)

    title_phrase = title if title.lower().startswith(("the ", "an ", "a ")) else f"the {title}"
    company_context = title
    template = random.choice(_INTRO_TEMPLATES_WITH_JD)
    return template.format(
        role_phrase=role_phrase,
        title_phrase=title_phrase,
        company_context=company_context,
    )


def _infer_experience_level(resume_summary: str, jd_description: str) -> str:
    """Infer candidate experience level from resume summary and JD text.

    Returns 'fresher', 'mid', or 'senior'.
    """
    text = f"{resume_summary} {jd_description}".lower()

    senior_signals = [
        "senior", "lead ", "principal", "staff engineer", "10+ year", "8+ year",
        "9+ year", "7+ year", "architect", "head of", "director",
    ]
    fresher_signals = [
        "fresher", "fresh graduate", "recent graduate", "entry level", "entry-level",
        "0 year", "0-1 year", "0 to 1 year", "no experience", "new graduate",
        "just graduated", "college graduate", "university graduate",
    ]

    for signal in senior_signals:
        if signal in text:
            return "senior"
    for signal in fresher_signals:
        if signal in text:
            return "fresher"
    return "mid"


def _build_resume_resilient_followup_question(
    session: dict,
    question_number: int,
    variant: int = 0,
    focus_skill: str | None = None,
) -> str:
    role_title = (session.get("role_title") or "this role").strip()
    skill_pool = _resume_skill_pool(session)

    index = max(0, question_number - 1) + max(0, variant)
    skill = (focus_skill or "").strip() or skill_pool[index % len(skill_pool)]

    templates = [
        "Describe a real project where you applied {skill} for {role}. What constraints and trade-offs shaped your design?",
        "If {skill} failed in production for a {role} workflow, how would you debug it step by step?",
        "Explain how you would test and validate a solution using {skill} before shipping it for {role}.",
        "Compare two approaches for {skill} in a {role} context and justify the final choice.",
        "Design an improvement plan to make your {skill} implementation more scalable and reliable for {role}.",
        "Your {role} service using {skill} has intermittent latency spikes. How would you investigate and stabilize it?",
        "During code review, what risks would you look for in a {skill} implementation for {role}, and why?",
        "How would you design rollback and observability for a feature centered on {skill} in {role}?",
        "Assume two engineers propose different {skill} strategies for {role}. How would you evaluate and choose between them?",
        "What failure modes around {skill} are easiest to miss in {role}, and how would you proactively test them?",
    ]
    template = templates[index % len(templates)]
    return template.format(skill=skill, role=role_title)


def _build_topic_resilient_followup_question(session: dict, question_number: int, variant: int = 0) -> str:
    topic_name = (session.get("role_title") or "this topic").strip()
    index = max(0, question_number - 1) + max(0, variant)

    templates = [
        "Explain {topic} with a practical example from a production-like scenario.",
        "What are the most common failure patterns in {topic}, and how would you detect them early?",
        "Design a step-by-step implementation plan for {topic} with measurable checkpoints.",
        "Compare two approaches in {topic}, including trade-offs in scalability, latency, and maintainability.",
        "If a {topic} solution regressed after deployment, how would you triage and recover safely?",
    ]
    template = templates[index % len(templates)]
    return template.format(topic=topic_name)


async def _enqueue_resume_followup_with_fallback(
    *,
    redis,
    session_id: str,
    session: dict,
    answered_count: int,
    suggested_text: str,
    suggested_difficulty: str,
    suggested_category: str,
    focus_skill_override: str | None = None,
) -> tuple[str | None, bool]:
    candidates: list[tuple[str, str, str, bool]] = []
    existing_questions = await _get_session_question_texts(redis, session_id)

    primary = (suggested_text or "").strip()
    if primary:
        candidates.append((primary, suggested_difficulty or "medium", suggested_category or "follow-up", True))

    # Deterministic local fallback prevents early completion when model output is empty/duplicate.
    base_question_number = max(2, answered_count + 1)
    for variant in range(6):
        question_number = base_question_number + variant
        fallback_text = _build_resume_resilient_followup_question(
            session=session,
            question_number=question_number,
            variant=variant,
            focus_skill=focus_skill_override,
        )
        candidates.append((fallback_text, "medium", "resume-fallback", False))

    seen: set[str] = set()
    for text, difficulty, category, is_primary in candidates:
        normalized_text = normalize_question_text(text)
        if _is_question_too_similar(normalized_text, existing_questions):
            continue

        key = _question_fingerprint(normalized_text)
        if not key or key in seen:
            continue
        seen.add(key)

        qid = await enqueue_question(
            redis=redis,
            session_id=session_id,
            question=normalized_text,
            difficulty=difficulty,
            category=category,
            ttl_seconds=SESSION_TTL,
            max_queue_size=MAX_QUEUE_SIZE,
        )
        if qid:
            existing_questions.append(normalized_text)
            return qid, is_primary

    return None, False


async def _get_session_question_texts(redis, session_id: str) -> list[str]:
    question_ids = await redis.lrange(f"session:{session_id}:questions", 0, -1)
    output: list[str] = []
    for qid in question_ids:
        q = await redis.hgetall(f"session:{session_id}:q:{qid}")
        text = (q.get("question") or "").strip()
        if text:
            output.append(text)
    return output


async def _get_answered_question_texts(redis, session_id: str, limit: int = 4) -> list[str]:
    answer_ids = await redis.lrange(f"session:{session_id}:answers", -max(1, limit), -1)
    output: list[str] = []

    for qid in answer_ids:
        answer_data = await redis.hgetall(f"session:{session_id}:a:{qid}")
        text = (answer_data.get("question") or "").strip()
        if not text:
            q = await redis.hgetall(f"session:{session_id}:q:{qid}")
            text = (q.get("question") or "").strip()
        if text:
            output.append(text)

    return output


async def _sample_topic_questions(
    db,
    topic_id: str,
    excluded_questions: list[str],
    limit: int,
) -> list[dict]:
    if limit <= 0:
        return []

    docs = await db[TOPIC_QUESTIONS].find({"topic_id": topic_id}).to_list(length=500)
    random.shuffle(docs)
    excluded = {_question_fingerprint(q) for q in excluded_questions if q}

    selected: list[dict] = []
    for doc in docs:
        text = (doc.get("question") or "").strip()
        if not text:
            continue
        fp = _question_fingerprint(text)
        if not fp or fp in excluded:
            continue

        excluded.add(fp)
        selected.append(
            {
                "question": text,
                "difficulty": _normalize_bank_difficulty(doc.get("difficulty") or "medium"),
                "category": doc.get("category") or "topic",
            }
        )
        if len(selected) >= limit:
            break

    return selected


async def _seed_resume_questions_task(session_id: str) -> None:
    db = get_db()
    redis = get_redis()

    session = await redis.hgetall(f"session:{session_id}")
    if not session or session.get("status") != "in_progress" or session.get("interview_type") != "resume":
        return

    try:
        await flush_backlog_to_queue(
            redis=redis,
            session_id=session_id,
            ttl_seconds=SESSION_TTL,
            max_queue_size=MAX_QUEUE_SIZE,
        )

        current_q_size = await queue_size(redis, session_id)
        needed = max(0, RESUME_INITIAL_BATCH_SIZE - current_q_size)

        if needed > 0:
            excluded_questions = await _get_session_question_texts(redis, session_id)
            seed_items = await generate_resume_seed_questions(
                role_title=session.get("role_title", "Software Developer"),
                resume_summary=session.get("resume_summary", "No summary available"),
                resume_skills=_safe_json_list(session.get("skills", "[]")),
                jd_title=session.get("job_description_title", ""),
                jd_description=session.get("job_description_text", ""),
                jd_required_skills=_safe_json_list(session.get("jd_required_skills", "[]")),
                excluded_questions=excluded_questions,
                count=needed,
                company_name=session.get("company_name", ""),
                experience_level=session.get("experience_level", "mid"),
            )

            appended = 0
            for item in seed_items:
                qid = await enqueue_question(
                    redis=redis,
                    session_id=session_id,
                    question=item.get("question", ""),
                    difficulty=item.get("difficulty", "medium"),
                    category=item.get("category", "resume-seed"),
                    ttl_seconds=SESSION_TTL,
                    max_queue_size=MAX_QUEUE_SIZE,
                )
                if qid:
                    appended += 1

            await redis.hset(
                f"session:{session_id}",
                mapping={
                    "generated_count": str(_safe_int(session.get("generated_count", 0)) + appended),
                    "metrics_gemini_calls": str(_safe_int(session.get("metrics_gemini_calls", 0)) + 1),
                    "metrics_gemini_questions": str(_safe_int(session.get("metrics_gemini_questions", 0)) + appended),
                    "metrics_generation_batches": str(_safe_int(session.get("metrics_generation_batches", 0)) + 1),
                },
            )

            await db[SESSIONS].update_one(
                {"session_id": session_id},
                {
                    "$set": {
                        "metrics_gemini_calls": _safe_int(session.get("metrics_gemini_calls", 0)) + 1,
                        "metrics_gemini_questions": _safe_int(session.get("metrics_gemini_questions", 0)) + appended,
                        "metrics_generation_batches": _safe_int(session.get("metrics_generation_batches", 0)) + 1,
                    }
                },
            )

        await flush_backlog_to_queue(
            redis=redis,
            session_id=session_id,
            ttl_seconds=SESSION_TTL,
            max_queue_size=MAX_QUEUE_SIZE,
        )

        next_qid, next_q = await peek_next_question(redis, session_id)
        if next_qid and next_q:
            _schedule_question_audio_prefetch(
                [next_q.get("question", "")],
                _normalize_voice_gender(session.get("speech_voice_gender")),
            )
    except Exception:
        # Non-blocking pre-seed path should never fail interview startup.
        return


def _normalize_role_key(role_title: str) -> str:
    normalized = re.sub(r"\s+", " ", (role_title or "").strip().lower())
    return normalized or "software developer"


def _build_verification_cache_key(
    role_key: str,
    jd_id: str,
    jd_updated_at: str,
    resume_uploaded_at: str,
) -> str:
    return "||".join([
        role_key or "software developer",
        jd_id or "-",
        jd_updated_at or "-",
        resume_uploaded_at or "-",
    ])


def _verification_doc_to_response(doc: dict, *, message: str, cached: bool) -> dict:
    return {
        "verification_id": doc.get("verification_id"),
        "saved_at": doc.get("saved_at") or doc.get("created_at") or utc_now(),
        "role_title": doc.get("role_title"),
        "job_description": doc.get("job_description") or {},
        "resume_snapshot": doc.get("resume_snapshot") or {},
        "jd_alignment": doc.get("jd_alignment") or {},
        "message": message,
        "cached": cached,
    }


async def verify_resume_job_description(
    user_id: str,
    role_id: str = None,
    custom_role: str = None,
    job_description_id: str = None,
) -> dict:
    """Run resume-vs-job-description verification without starting an interview.

    Reuses a saved verification while the selected role, JD version, and resume
    upload timestamp are unchanged.
    """
    if not job_description_id:
        raise ValueError("job_description_id is required for verification")

    db = get_db()

    resume_doc = await db[RESUMES].find_one({"user_id": user_id})
    if not resume_doc:
        raise ValueError("Please upload your resume before running verification")

    skills_doc = await db[SKILLS].find_one({"user_id": user_id})
    resume_skills = normalize_skill_list(skills_doc.get("skills", [])) if skills_doc else []

    parsed_data = (resume_doc or {}).get("parsed_data", {}) or {}
    summary_parts = [
        parsed_data.get("experience_summary") or "",
        " ".join(parsed_data.get("recommended_roles", []) or []),
    ]
    resume_summary = "\n".join([part for part in summary_parts if part]).strip() or "No summary available"

    role_title = await _resolve_role_title(db, role_id=role_id, custom_role=custom_role)
    role_key = _normalize_role_key(role_title)
    selected_jd = await get_job_description_for_user(user_id, job_description_id)

    resume_uploaded_at = resume_doc.get("uploaded_at") or ""
    jd_updated_at = selected_jd.get("updated_at") or ""
    cache_key = _build_verification_cache_key(
        role_key=role_key,
        jd_id=selected_jd.get("id") or job_description_id,
        jd_updated_at=jd_updated_at,
        resume_uploaded_at=resume_uploaded_at,
    )

    existing_verification = await db[JD_VERIFICATIONS].find_one(
        {"user_id": user_id, "cache_key": cache_key},
        sort=[("created_at", -1)],
    )

    if not existing_verification:
        compatibility_query = {
            "user_id": user_id,
            "role_title": role_title,
            "job_description.id": selected_jd.get("id"),
            "resume_snapshot.uploaded_at": resume_uploaded_at,
        }
        if jd_updated_at:
            compatibility_query["job_description.updated_at"] = jd_updated_at

        existing_verification = await db[JD_VERIFICATIONS].find_one(
            compatibility_query,
            sort=[("created_at", -1)],
        )

        if existing_verification:
            await db[JD_VERIFICATIONS].update_one(
                {"_id": existing_verification["_id"]},
                {
                    "$set": {
                        "cache_key": cache_key,
                        "role_key": role_key,
                        "saved_at": existing_verification.get("saved_at")
                        or existing_verification.get("created_at")
                        or utc_now(),
                    }
                },
            )

    if existing_verification:
        return _verification_doc_to_response(
            existing_verification,
            message="Loaded saved verification",
            cached=True,
        )

    jd_alignment = await analyze_resume_vs_job_description(
        role_title=role_title,
        resume_skills=resume_skills if resume_skills else ["general"],
        resume_summary=resume_summary,
        jd_title=selected_jd.get("title", ""),
        jd_description=selected_jd.get("description", ""),
        jd_required_skills=selected_jd.get("required_skills", []),
    )

    resume_snapshot = {
        "filename": resume_doc.get("original_filename") or resume_doc.get("filename") or "",
        "uploaded_at": resume_uploaded_at,
        "skills": resume_skills,
        "parsed_data": {
            "name": parsed_data.get("name"),
            "email": parsed_data.get("email"),
            "phone": parsed_data.get("phone"),
            "location": parsed_data.get("location"),
            "recommended_roles": parsed_data.get("recommended_roles", []) or [],
            "experience_summary": parsed_data.get("experience_summary", "") or "",
        },
    }

    verification_id = generate_id()
    saved_at = utc_now()
    verification_doc = {
        "verification_id": verification_id,
        "user_id": user_id,
        "role_id": role_id,
        "custom_role": custom_role,
        "role_title": role_title,
        "role_key": role_key,
        "cache_key": cache_key,
        "job_description": {
            "id": selected_jd.get("id"),
            "title": selected_jd.get("title"),
            "company": selected_jd.get("company"),
            "description": selected_jd.get("description"),
            "required_skills": selected_jd.get("required_skills", []) or [],
            "updated_at": jd_updated_at,
        },
        "resume_snapshot": resume_snapshot,
        "jd_alignment": jd_alignment,
        "saved_at": saved_at,
        "created_at": saved_at,
    }

    await db[JD_VERIFICATIONS].insert_one(verification_doc)

    return _verification_doc_to_response(
        verification_doc,
        message="Verification complete",
        cached=False,
    )


async def _get_generated_question_texts(redis, session_id: str) -> list[str]:
    qids = await redis.lrange(f"session:{session_id}:questions", 0, -1)
    questions = []
    for qid in qids:
        q = await redis.hgetall(f"session:{session_id}:q:{qid}")
        if q and q.get("question"):
            questions.append(q["question"])
    return questions


async def _generate_question_batch(
    role_title: str,
    skills: list[str],
    previous_questions: list[str],
    generated_count: int,
    max_questions: int,
    current_difficulty: str,
    local_summary: str | None,
    batch_size: int,
) -> tuple[list[dict], str]:
    remaining = max(0, max_questions - generated_count)
    target = min(batch_size, remaining)
    if target <= 0:
        return [], current_difficulty

    # Initial resume seed: generate the full first batch in one Gemini call.
    if generated_count == 0 and target > 1 and not local_summary:
        seeded = await generate_interview_question_batch(
            skills=skills,
            role_title=role_title,
            count=target,
            start_question_number=1,
            previous_questions=previous_questions,
            foundation_limit=3,
        )
        if seeded:
            last = seeded[-1].get("difficulty", current_difficulty)
            return seeded, last

    generated: list[dict] = []
    rolling_questions = list(previous_questions)
    rolling_difficulty = current_difficulty
    rolling_count = generated_count

    for i in range(target):
        state = {
            "role_title": role_title,
            "skills": skills,
            "previous_questions": rolling_questions,
            # Feed the local summary once per batch as extra context.
            "previous_answer": local_summary if i == 0 else None,
            "question_count": rolling_count,
            "max_questions": max_questions,
            "current_difficulty": rolling_difficulty,
        }
        graph_result = await run_interview_graph(state)
        q_data = graph_result.get("question_data", {})
        difficulty = q_data.get("difficulty", graph_result.get("current_difficulty", "medium"))
        generated.append(
            {
                "question": q_data.get("question", "Can you explain your approach?"),
                "difficulty": difficulty,
                "category": q_data.get("category", "general"),
            }
        )
        rolling_questions.append(generated[-1]["question"])
        rolling_count += 1
        rolling_difficulty = difficulty

    return generated, rolling_difficulty


async def _append_batch_to_redis(redis, session_id: str, batch: list[dict]) -> list[str]:
    created_ids: list[str] = []
    for item in batch:
        normalized_question = normalize_question_text(item.get("question", "Can you explain your approach?"))
        if not normalized_question:
            continue
        qid = generate_id()
        created_ids.append(qid)
        await redis.hset(
            f"session:{session_id}:q:{qid}",
            mapping={
                "question_id": qid,
                "question": normalized_question,
                "difficulty": item.get("difficulty", "medium"),
                "category": item.get("category", "general"),
            },
        )
        await redis.rpush(f"session:{session_id}:questions", qid)
        await redis.expire(f"session:{session_id}:q:{qid}", SESSION_TTL)
    if created_ids:
        await redis.expire(f"session:{session_id}:questions", SESSION_TTL)
    return created_ids


async def _fetch_question_bank_batch(
    db,
    role_id: str | None,
    excluded_questions: list[str],
    limit: int,
    skill_hints: list[str] | None = None,
) -> list[dict]:
    if limit <= 0:
        return []

    query = {"question": {"$exists": True, "$ne": ""}}
    if role_id:
        role_candidates = [role_id]
        try:
            oid = ObjectId(role_id)
            role_candidates.append(str(oid))
            role_candidates.append(oid)
        except Exception:
            pass
        query["role_id"] = {"$in": role_candidates}

    normalized_hints = normalize_skill_list(skill_hints or [])
    if normalized_hints:
        scope_match = []
        for skill in normalized_hints:
            token = re.escape(skill)
            scope_match.append({"category": {"$regex": token, "$options": "i"}})
            scope_match.append({"question": {"$regex": token, "$options": "i"}})
        if scope_match:
            query["$or"] = scope_match

    excluded = {q.strip().lower() for q in excluded_questions if q}
    selected: list[dict] = []

    for sample_size in (max(limit * 12, 80), max(limit * 24, 160)):
        pipeline = [
            {"$match": query},
            {"$sample": {"size": sample_size}},
        ]

        async for q in db[QUESTIONS].aggregate(pipeline):
            text = (q.get("question") or "").strip()
            if not text:
                continue
            if text.lower() in excluded:
                continue
            selected.append(
                {
                    "question": text,
                    "difficulty": _normalize_bank_difficulty(q.get("difficulty") or "medium"),
                    "category": q.get("category") or "question-bank",
                }
            )
            excluded.add(text.lower())
            if len(selected) >= limit:
                break

        if len(selected) >= limit:
            break

    # If role-scoped pool is too small, widen to global random pool.
    if len(selected) < limit and role_id:
        fallback = await _fetch_question_bank_batch(
            db=db,
            role_id=None,
            excluded_questions=list(excluded),
            limit=limit - len(selected),
            skill_hints=normalized_hints,
        )
        selected.extend(fallback)

    return selected


def _strict_followup_difficulty(answered_count: int, experience_level: str = "mid") -> str:
    if experience_level == "fresher":
        # Freshers: start easy, ramp to medium only after several answers
        return "medium" if answered_count >= 5 else "easy"
    # mid/senior: original ramp
    return "hard" if answered_count >= 10 else "medium"


def _has_followup_opportunity(qa_pairs: list, window: int = BATCH_SIZE) -> bool:
    """Decide whether Gemini follow-up questions are needed for the latest batch."""
    if not qa_pairs:
        return False

    weak_markers = {
        "i think",
        "maybe",
        "not sure",
        "dont know",
        "don't know",
        "etc",
        "kind of",
        "sort of",
    }

    for qa in qa_pairs[-window:]:
        answer = (qa.get("answer") or "").strip()
        if not answer:
            continue

        if len(answer.split()) < 30:
            return True

        lowered = answer.lower()
        if any(marker in lowered for marker in weak_markers):
            return True

    return False


async def _generate_mixed_followup_batch(
    db,
    redis,
    session_id: str,
    session: dict,
    generated_count: int,
    max_questions: int,
) -> tuple[list[dict], str, dict]:
    remaining = max(0, max_questions - generated_count)
    target = min(BATCH_SIZE, remaining)
    if target <= 0:
        return [], session.get("current_difficulty", "medium"), {
            "gemini_calls": 0,
            "gemini_questions": 0,
            "bank_questions": 0,
            "bank_shortfall": 0,
        }

    previous_questions = await _get_generated_question_texts(redis, session_id)
    qa_pairs = await get_session_qa(session_id)
    answered_count = len(qa_pairs)
    role_title = session.get("role_title", "Software Developer")
    skills = _safe_json_list(session.get("skills", "[]"))
    jd_required_skills = _safe_json_list(session.get("jd_required_skills", "[]"))
    resume_source_mode = (session.get("resume_source_mode") or "db").strip().lower()
    experience_level = (session.get("experience_level") or "mid").strip().lower()
    company_name = session.get("company_name", "")
    current_difficulty = _strict_followup_difficulty(answered_count, experience_level)

    from utils.gemini import generate_followup_question_batch_from_qa

    gemini_calls = 0
    gemini_questions = 0

    if resume_source_mode == "ai":
        ai_items = await generate_followup_question_batch_from_qa(
            role_title=role_title,
            skills=skills,
            qa_pairs=qa_pairs,
            previous_questions=previous_questions,
            count=target,
            difficulty=current_difficulty,
            experience_level=experience_level,
            company_name=company_name,
        )
        gemini_calls = 1 if target > 0 else 0

        deduped_ai = []
        excluded_lower = {q.strip().lower() for q in previous_questions if q}
        for item in ai_items:
            text = (item.get("question") or "").strip()
            if not text:
                continue
            lowered = text.lower()
            if lowered in excluded_lower:
                continue
            deduped_ai.append(item)
            excluded_lower.add(lowered)
            if len(deduped_ai) >= target:
                break

        if len(deduped_ai) < target:
            refill, refill_last = await _generate_question_batch(
                role_title=role_title,
                skills=skills,
                previous_questions=previous_questions + [i.get("question", "") for i in deduped_ai],
                generated_count=generated_count + len(deduped_ai),
                max_questions=max_questions,
                current_difficulty=current_difficulty,
                local_summary=await redis.get(f"session:{session_id}:local_summary"),
                batch_size=target - len(deduped_ai),
            )
            for item in refill:
                text = (item.get("question") or "").strip()
                if not text:
                    continue
                lowered = text.lower()
                if lowered in excluded_lower:
                    continue
                deduped_ai.append(item)
                excluded_lower.add(lowered)
                if len(deduped_ai) >= target:
                    break
            if refill:
                current_difficulty = refill_last

        final_ai = deduped_ai[:target]
        last_difficulty = final_ai[-1].get("difficulty", current_difficulty) if final_ai else current_difficulty
        return final_ai, last_difficulty, {
            "gemini_calls": gemini_calls,
            "gemini_questions": len(final_ai),
            "bank_questions": 0,
            "bank_shortfall": 0,
        }

    # Batch policy:
    # - If follow-up opportunity exists: 2 AI + 3 DB
    # - Otherwise: 5 DB
    ai_target = min(FOLLOWUP_AI_COUNT, target) if _has_followup_opportunity(qa_pairs) else 0

    excluded_lower = {q.strip().lower() for q in previous_questions if q}
    ai_items: list[dict] = []

    if ai_target > 0:
        generated_ai = await generate_followup_question_batch_from_qa(
            role_title=role_title,
            skills=skills,
            qa_pairs=qa_pairs,
            previous_questions=previous_questions,
            count=ai_target,
            difficulty=current_difficulty,
            experience_level=experience_level,
            company_name=company_name,
        )
        gemini_calls += 1
        for item in generated_ai:
            text = (item.get("question") or "").strip()
            if not text:
                continue
            lowered = text.lower()
            if lowered in excluded_lower:
                continue
            ai_items.append(item)
            excluded_lower.add(lowered)
            if len(ai_items) >= ai_target:
                break
        gemini_questions += len(ai_items)

    bank_target = max(0, target - len(ai_items))
    exclude_pool = list(excluded_lower)
    bank_items = await _fetch_question_bank_batch(
        db=db,
        role_id=session.get("role_id"),
        excluded_questions=exclude_pool,
        limit=bank_target,
        skill_hints=jd_required_skills,
    )

    for item in bank_items:
        text = (item.get("question") or "").strip()
        if text:
            excluded_lower.add(text.lower())

    if len(bank_items) < bank_target:
        # Keep total batch size stable if the bank pool is exhausted.
        refill = bank_target - len(bank_items)
        refill_ai = []
        added_refill_ai = 0
        if refill > 0:
            refill_ai = await generate_followup_question_batch_from_qa(
                role_title=role_title,
                skills=skills,
                qa_pairs=qa_pairs,
                previous_questions=list(excluded_lower),
                count=refill,
                difficulty=current_difficulty,
                experience_level=experience_level,
                company_name=company_name,
            )
            gemini_calls += 1
        for item in refill_ai:
            text = (item.get("question") or "").strip()
            if not text:
                continue
            lowered = text.lower()
            if lowered in excluded_lower:
                continue
            ai_items.append(item)
            added_refill_ai += 1
            excluded_lower.add(lowered)
            if len(ai_items) + len(bank_items) >= target:
                break
        gemini_questions += added_refill_ai

    mixed = (ai_items + bank_items)[:target]
    if len(mixed) > 1:
        random.shuffle(mixed)

    last_difficulty = mixed[-1].get("difficulty", current_difficulty) if mixed else current_difficulty
    return mixed, last_difficulty, {
        "gemini_calls": gemini_calls,
        "gemini_questions": gemini_questions,
        "bank_questions": len(bank_items),
        "bank_shortfall": max(0, bank_target - len(bank_items)),
    }


async def _start_topic_interview(user_id: str, topic_id: str) -> dict:
    """Start topic interview with low-cost DB-first flow and staged AI follow-ups."""
    db = get_db()
    redis = get_redis()

    topic = await db[TOPICS].find_one({"_id": __import__("bson").ObjectId(topic_id)})
    if not topic:
        raise ValueError("Topic not found")
    if not topic.get("is_published", False):
        raise ValueError("This topic interview is not published yet")

    initial_items = await _sample_topic_questions(
        db=db,
        topic_id=topic_id,
        excluded_questions=[],
        limit=TOPIC_INITIAL_DB_QUESTIONS,
    )
    if len(initial_items) < TOPIC_INITIAL_ASK_COUNT:
        raise ValueError("Not enough topic questions to start interview")

    first_question = initial_items[0]
    queued_initial = initial_items[1:TOPIC_INITIAL_ASK_COUNT]

    timer_enabled = bool(topic.get("timer_enabled", False))
    timer_seconds = topic.get("timer_seconds") if timer_enabled else None

    session_id = generate_id()
    await redis.set(f"session:{session_id}:local_summary", "", ex=SESSION_TTL)

    user_doc = None
    try:
        user_doc = await db[USERS].find_one({"_id": ObjectId(user_id)}, {"speech_settings": 1})
    except Exception:
        user_doc = await db[USERS].find_one({"user_id": user_id}, {"speech_settings": 1})
    speech_voice_gender = _normalize_voice_gender(((user_doc or {}).get("speech_settings") or {}).get("voice_gender"))

    first_id = generate_id()
    await redis.hset(
        f"session:{session_id}:q:{first_id}",
        mapping={
            "question_id": first_id,
            "question": normalize_question_text(first_question.get("question", "Can you explain this topic?")),
            "difficulty": first_question.get("difficulty", "medium"),
            "category": first_question.get("category", topic.get("name", "topic")),
        },
    )
    await redis.expire(f"session:{session_id}:q:{first_id}", SESSION_TTL)
    await redis.rpush(f"session:{session_id}:questions", first_id)
    await redis.expire(f"session:{session_id}:questions", SESSION_TTL)

    await mark_question_asked(
        redis=redis,
        session_id=session_id,
        question_text=first_question.get("question", ""),
        ttl_seconds=SESSION_TTL,
    )

    queued_count = 0
    for item in queued_initial:
        qid = await enqueue_question(
            redis=redis,
            session_id=session_id,
            question=item.get("question", ""),
            difficulty=item.get("difficulty", "medium"),
            category=item.get("category", topic.get("name", "topic")),
            ttl_seconds=SESSION_TTL,
            max_queue_size=MAX_QUEUE_SIZE,
        )
        if qid:
            queued_count += 1

    await flush_backlog_to_queue(
        redis=redis,
        session_id=session_id,
        ttl_seconds=SESSION_TTL,
        max_queue_size=MAX_QUEUE_SIZE,
    )

    session_doc = {
        "session_id": session_id,
        "user_id": user_id,
        "role_id": None,
        "role_title": topic.get("name", "Topic Interview"),
        "topic_id": topic_id,
        "interview_type": "topic",
        "status": "in_progress",
        "question_count": 1,
        "max_questions": TOPIC_TOTAL_QUESTIONS,
        "current_difficulty": first_question.get("difficulty", "medium"),
        "metrics_gemini_calls": 0,
        "metrics_gemini_questions": 0,
        "metrics_bank_questions": queued_count + 1,
        "metrics_bank_shortfall": max(0, TOPIC_INITIAL_ASK_COUNT - (queued_count + 1)),
        "metrics_generation_batches": 1,
        "speech_voice_gender": speech_voice_gender,
        "timer_enabled": timer_enabled,
        "timer_seconds": timer_seconds,
        "topic_followups_generated": False,
        "started_at": utc_now(),
    }
    await db[SESSIONS].insert_one(session_doc)

    session_state = {
        "user_id": user_id,
        "role_title": topic.get("name", "Topic Interview"),
        "topic_id": topic_id,
        "interview_type": "topic",
        "skills": json.dumps([topic.get("name", "general")]),
        "user_skills": json.dumps([]),
        "required_skills": json.dumps([]),
        "matched_skills": json.dumps([]),
        "missing_skills": json.dumps([]),
        "question_count": 1,
        "answered_count": 0,
        "served_count": 1,
        "generated_count": queued_count + 1,
        "max_questions": TOPIC_TOTAL_QUESTIONS,
        "current_difficulty": first_question.get("difficulty", "medium"),
        "timer_enabled": str(timer_enabled),
        "timer_seconds": str(timer_seconds or ""),
        "status": "in_progress",
        "speech_voice_gender": speech_voice_gender,
        "metrics_gemini_calls": 0,
        "metrics_gemini_questions": 0,
        "metrics_bank_questions": queued_count + 1,
        "metrics_bank_shortfall": max(0, TOPIC_INITIAL_ASK_COUNT - (queued_count + 1)),
        "metrics_generation_batches": 1,
        "topic_followups_generated": "0",
    }
    await redis.hset(f"session:{session_id}", mapping=session_state)
    await redis.expire(f"session:{session_id}", SESSION_TTL)

    next_qid, next_q = await peek_next_question(redis, session_id)
    prefetch_targets = [next_q.get("question", "")] if next_qid and next_q else []
    _schedule_question_audio_prefetch(prefetch_targets, speech_voice_gender)

    return {
        "session_id": session_id,
        "interview_type": "topic",
        "topic": {
            "topic_id": topic_id,
            "name": topic.get("name", "Topic Interview"),
            "description": topic.get("description", ""),
        },
        "skill_alignment": {
            "user_skills": [],
            "required_skills": [topic.get("name", "")],
            "matched_skills": [],
            "missing_skills": [],
            "interview_focus": [topic.get("name", "")],
        },
        "question": {
            "question_id": first_id,
            "question": normalize_question_text(first_question.get("question", "Can you explain this topic?")),
            "difficulty": first_question.get("difficulty", "medium"),
            "question_number": 1,
            "total_questions": TOPIC_TOTAL_QUESTIONS,
        },
        "timer": {
            "enabled": timer_enabled,
            "seconds": timer_seconds,
        },
        "message": "Topic interview started. Good luck!",
    }


async def _async_pregenerate_next_batch(session_id: str) -> None:
    db = get_db()
    redis = get_redis()
    pregen_key = f"session:{session_id}:pregen_in_flight"
    acquired = await redis.set(pregen_key, "1", nx=True, ex=SESSION_TTL)
    if not acquired:
        return
    try:
        session = await redis.hgetall(f"session:{session_id}")
        if not session or session.get("status") != "in_progress":
            return

        if session.get("interview_type", "resume") != "resume":
            return

        pending_len = await redis.llen(f"session:{session_id}:pending_questions")
        generated_count = int(session.get("generated_count", 0))
        max_questions = int(session.get("max_questions", MAX_QUESTIONS))

        if pending_len >= PREGEN_MIN_PENDING or generated_count >= max_questions:
            return

        batch, last_difficulty, batch_metrics = await _generate_mixed_followup_batch(
            db=db,
            redis=redis,
            session_id=session_id,
            session=session,
            generated_count=generated_count,
            max_questions=max_questions,
        )
        if not batch:
            return

        new_ids = await _append_batch_to_redis(redis, session_id, batch)
        if new_ids:
            await redis.rpush(f"session:{session_id}:pending_questions", *new_ids)
            await redis.expire(f"session:{session_id}:pending_questions", SESSION_TTL)

            prefetch_targets = []
            for qid in new_ids[:2]:
                q = await redis.hgetall(f"session:{session_id}:q:{qid}")
                prefetch_targets.append(q.get("question", ""))
            _schedule_question_audio_prefetch(
                prefetch_targets,
                _normalize_voice_gender(session.get("speech_voice_gender")),
            )

            await redis.hset(
                f"session:{session_id}",
                mapping={
                    "generated_count": str(generated_count + len(new_ids)),
                    "current_difficulty": last_difficulty,
                    "metrics_gemini_calls": str(_safe_int(session.get("metrics_gemini_calls", 0)) + batch_metrics.get("gemini_calls", 0)),
                    "metrics_gemini_questions": str(_safe_int(session.get("metrics_gemini_questions", 0)) + batch_metrics.get("gemini_questions", 0)),
                    "metrics_bank_questions": str(_safe_int(session.get("metrics_bank_questions", 0)) + batch_metrics.get("bank_questions", 0)),
                    "metrics_bank_shortfall": str(_safe_int(session.get("metrics_bank_shortfall", 0)) + batch_metrics.get("bank_shortfall", 0)),
                    "metrics_generation_batches": str(_safe_int(session.get("metrics_generation_batches", 0)) + 1),
                },
            )
            await db[SESSIONS].update_one(
                {"session_id": session_id},
                {
                    "$set": {
                        "metrics_gemini_calls": _safe_int(session.get("metrics_gemini_calls", 0)) + batch_metrics.get("gemini_calls", 0),
                        "metrics_gemini_questions": _safe_int(session.get("metrics_gemini_questions", 0)) + batch_metrics.get("gemini_questions", 0),
                        "metrics_bank_questions": _safe_int(session.get("metrics_bank_questions", 0)) + batch_metrics.get("bank_questions", 0),
                        "metrics_bank_shortfall": _safe_int(session.get("metrics_bank_shortfall", 0)) + batch_metrics.get("bank_shortfall", 0),
                        "metrics_generation_batches": _safe_int(session.get("metrics_generation_batches", 0)) + 1,
                    }
                },
            )
    finally:
        await redis.delete(pregen_key)


def _schedule_pregen(session_id: str, answered_count: int) -> None:
    # Start pre-generation as soon as Q1 is answered, while user is on Q2.
    # Dedup is handled atomically inside the async task via Redis SETNX.
    if answered_count < 1:
        return
    asyncio.create_task(_async_pregenerate_next_batch(session_id))


async def start_interview(
    user_id: str,
    role_id: str = None,
    custom_role: str = None,
    interview_type: str = "resume",
    topic_id: str = None,
    job_description_id: str = None,
) -> dict:
    """Start a new interview session with low-cost queue-first orchestration."""
    interview_type = (interview_type or "resume").strip().lower()
    if interview_type == "topic":
        if not topic_id:
            raise ValueError("topic_id is required for topic interviews")
        return await _start_topic_interview(user_id=user_id, topic_id=topic_id)

    db = get_db()
    redis = get_redis()

    user_doc = None
    try:
        user_doc = await db[USERS].find_one({"_id": ObjectId(user_id)}, {"speech_settings": 1})
    except Exception:
        user_doc = await db[USERS].find_one({"user_id": user_id}, {"speech_settings": 1})
    speech_voice_gender = _normalize_voice_gender(((user_doc or {}).get("speech_settings") or {}).get("voice_gender"))

    skills_doc = await db[SKILLS].find_one({"user_id": user_id})
    user_skills = normalize_skill_list(skills_doc.get("skills", [])) if skills_doc else []

    resume_doc = await db[RESUMES].find_one({"user_id": user_id})
    if not resume_doc:
        raise ValueError("Please upload your resume before starting a resume interview")

    parsed_resume = (resume_doc or {}).get("parsed_data", {}) or {}
    resume_summary_parts = [
        parsed_resume.get("experience_summary") or "",
        " ".join(parsed_resume.get("recommended_roles", []) or []),
    ]
    resume_summary = "\n".join([part for part in resume_summary_parts if part]).strip() or "No summary available"

    if not job_description_id:
        raise ValueError("Please select a Job Description before starting Resume Interview")

    role_title = await _resolve_role_title(db, role_id=role_id, custom_role=custom_role)
    selected_jd = await get_job_description_for_user(user_id, job_description_id)

    jd_required_skills = normalize_skill_list((selected_jd or {}).get("required_skills", []))
    if not jd_required_skills:
        raise ValueError("Selected Job Description has no required skills. Add required skills first.")

    user_skill_set = {s.lower() for s in user_skills}
    matched_role_skills = [s for s in jd_required_skills if s.lower() in user_skill_set]
    missing_role_skills = [s for s in jd_required_skills if s.lower() not in user_skill_set]
    base_skills_for_interview = matched_role_skills + [s for s in missing_role_skills if s not in matched_role_skills]
    skills_for_interview = build_interview_focus_skills(base_skills_for_interview) or list(jd_required_skills)

    intro_question = _build_resume_intro_question(role_title=role_title, jd_title=selected_jd.get("title", ""))
    intro_question = normalize_question_text(intro_question)

    session_id = generate_id()
    await redis.set(f"session:{session_id}:local_summary", "", ex=SESSION_TTL)

    first_id = generate_id()
    await redis.hset(
        f"session:{session_id}:q:{first_id}",
        mapping={
            "question_id": first_id,
            "question": intro_question,
            "difficulty": "easy",
            "category": "intro",
        },
    )
    await redis.expire(f"session:{session_id}:q:{first_id}", SESSION_TTL)
    await redis.rpush(f"session:{session_id}:questions", first_id)
    await redis.expire(f"session:{session_id}:questions", SESSION_TTL)

    await mark_question_asked(
        redis=redis,
        session_id=session_id,
        question_text=intro_question,
        ttl_seconds=SESSION_TTL,
    )

    session_doc = {
        "session_id": session_id,
        "user_id": user_id,
        "role_id": role_id,
        "role_title": role_title,
        "job_description_id": selected_jd.get("id"),
        "job_description_title": selected_jd.get("title"),
        "status": "in_progress",
        "interview_type": "resume",
        "question_count": 1,
        "max_questions": RESUME_MAX_QUESTIONS,
        "current_difficulty": "easy",
        "metrics_gemini_calls": 0,
        "metrics_gemini_questions": 0,
        "metrics_bank_questions": 1,
        "metrics_bank_shortfall": 0,
        "metrics_generation_batches": 0,
        "speech_voice_gender": speech_voice_gender,
        "started_at": utc_now(),
        "interview_generation_mode": "queue_followup",
    }
    await db[SESSIONS].insert_one(session_doc)

    session_state = {
        "user_id": user_id,
        "role_id": role_id or "",
        "role_title": role_title,
        "skills": json.dumps(skills_for_interview),
        "user_skills": json.dumps(user_skills),
        "required_skills": json.dumps(jd_required_skills),
        "matched_skills": json.dumps(matched_role_skills),
        "missing_skills": json.dumps(missing_role_skills),
        "question_count": 1,
        "answered_count": 0,
        "served_count": 1,
        "generated_count": 1,
        "max_questions": RESUME_MAX_QUESTIONS,
        "current_difficulty": "easy",
        "interview_type": "resume",
        "status": "in_progress",
        "speech_voice_gender": speech_voice_gender,
        "jd_required_skills": json.dumps(jd_required_skills),
        "job_description_title": selected_jd.get("title", ""),
        "job_description_text": selected_jd.get("description", ""),
        "company_name": selected_jd.get("company") or "",
        "resume_summary": resume_summary,
        "experience_level": _infer_experience_level(resume_summary, selected_jd.get("description", "")),
        "metrics_gemini_calls": 0,
        "metrics_gemini_questions": 0,
        "metrics_bank_questions": 1,
        "metrics_bank_shortfall": 0,
        "metrics_generation_batches": 0,
        "interview_generation_mode": "queue_followup",
    }
    await redis.hset(f"session:{session_id}", mapping=session_state)
    await redis.expire(f"session:{session_id}", SESSION_TTL)

    # Preload initial queue in background (2 questions) without blocking first question delivery.
    asyncio.create_task(_seed_resume_questions_task(session_id))

    return {
        "session_id": session_id,
        "skill_alignment": {
            "user_skills": user_skills,
            "required_skills": jd_required_skills,
            "matched_skills": matched_role_skills,
            "missing_skills": missing_role_skills,
            "interview_focus": skills_for_interview,
        },
        "question": {
            "question_id": first_id,
            "question": intro_question,
            "difficulty": "easy",
            "question_number": 1,
            "total_questions": RESUME_MAX_QUESTIONS,
        },
        "timer": {
            "enabled": False,
            "seconds": None,
        },
        "message": "Interview started. Good luck!",
        "job_description": selected_jd,
        "jd_alignment": None,
    }


async def _record_submit_latency(started_at: float) -> float:
    elapsed_ms = (perf_counter() - started_at) * 1000.0
    await record_latency("submit_ms", elapsed_ms)
    return round(elapsed_ms, 2)


async def _apply_generation_metric_delta(
    *,
    db,
    redis,
    session_id: str,
    session: dict,
    metrics_delta: dict,
    generated_count: int | None = None,
    extra_redis_fields: dict | None = None,
    extra_db_fields: dict | None = None,
) -> dict:
    base_stats = _current_generation_stats(session)
    effective_stats = {
        "gemini_calls": base_stats["gemini_calls"] + _safe_int(metrics_delta.get("gemini_calls", 0)),
        "gemini_questions": base_stats["gemini_questions"] + _safe_int(metrics_delta.get("gemini_questions", 0)),
        "bank_questions": base_stats["bank_questions"] + _safe_int(metrics_delta.get("bank_questions", 0)),
        "bank_shortfall": base_stats["bank_shortfall"] + _safe_int(metrics_delta.get("bank_shortfall", 0)),
        "generation_batches": base_stats["generation_batches"] + _safe_int(metrics_delta.get("generation_batches", 0)),
    }

    redis_mapping = {
        "metrics_gemini_calls": str(effective_stats["gemini_calls"]),
        "metrics_gemini_questions": str(effective_stats["gemini_questions"]),
        "metrics_bank_questions": str(effective_stats["bank_questions"]),
        "metrics_bank_shortfall": str(effective_stats["bank_shortfall"]),
        "metrics_generation_batches": str(effective_stats["generation_batches"]),
    }
    if generated_count is not None:
        redis_mapping["generated_count"] = str(generated_count)
    if extra_redis_fields:
        redis_mapping.update(extra_redis_fields)

    await redis.hset(f"session:{session_id}", mapping=redis_mapping)

    db_set = {
        "metrics_gemini_calls": effective_stats["gemini_calls"],
        "metrics_gemini_questions": effective_stats["gemini_questions"],
        "metrics_bank_questions": effective_stats["bank_questions"],
        "metrics_bank_shortfall": effective_stats["bank_shortfall"],
        "metrics_generation_batches": effective_stats["generation_batches"],
    }
    if generated_count is not None:
        db_set["generated_count"] = generated_count
    if extra_db_fields:
        db_set.update(extra_db_fields)

    await db[SESSIONS].update_one({"session_id": session_id}, {"$set": db_set})
    return effective_stats


async def _post_submit_resume_processing(
    session_id: str,
    question_id: str,
    question_text: str,
    answer: str,
    answered_count: int,
    max_questions: int,
) -> None:
    db = get_db()
    redis = get_redis()

    async with _get_post_submit_lock(session_id):
        session = await redis.hgetall(f"session:{session_id}")
        if not session:
            return

        skill_pool = _resume_skill_pool(session)
        recent_answered_questions = await _get_answered_question_texts(
            redis=redis,
            session_id=session_id,
            limit=4,
        )
        recent_focus_topic, same_topic_streak = _recent_focus_streak(
            recent_answered_questions,
            skill_pool,
        )

        recent_context = await get_recent_context_items(
            redis=redis,
            session_id=session_id,
            max_items=CONTEXT_CACHE_ITEMS,
        )
        excluded_questions = await _get_session_question_texts(redis, session_id)
        evaluation = await evaluate_and_generate_followup(
            role_title=session.get("role_title", "Software Developer"),
            required_skills=_safe_json_list(session.get("jd_required_skills", "[]")),
            recent_context=recent_context,
            current_question=question_text,
            current_answer=answer,
            excluded_questions=excluded_questions,
            focus_topic=recent_focus_topic or "",
            same_topic_streak=same_topic_streak,
        )

        await redis.hset(
            f"session:{session_id}:a:{question_id}",
            mapping={
                "score": str(_safe_int(evaluation.get("score", 0))),
                "feedback": evaluation.get("feedback", ""),
            },
        )

        metrics_delta = {
            "gemini_calls": 1,
            "gemini_questions": 0,
            "bank_questions": 0,
            "bank_shortfall": 0,
            "generation_batches": 1,
        }
        generated_count = _safe_int(session.get("generated_count", 0))

        follow_text, focus_skill_override = _apply_resume_followup_policy(
            skill_pool=skill_pool,
            recent_focus_topic=recent_focus_topic,
            same_topic_streak=same_topic_streak,
            suggested_question=(evaluation.get("followup_question") or "").strip(),
            suggested_topic=(evaluation.get("followup_topic") or "").strip(),
            followup_need_score=_safe_score_0_100(evaluation.get("followup_need_score", 0)),
            answered_count=answered_count,
        )

        if answered_count < max_questions and session.get("status") == "in_progress":
            qid, used_model_followup = await _enqueue_resume_followup_with_fallback(
                redis=redis,
                session_id=session_id,
                session=session,
                answered_count=answered_count,
                suggested_text=follow_text,
                suggested_difficulty=evaluation.get("difficulty", "medium"),
                suggested_category=evaluation.get("category", "follow-up"),
                focus_skill_override=focus_skill_override,
            )
            if qid:
                generated_count += 1
                if used_model_followup:
                    metrics_delta["gemini_questions"] += 1

        await _apply_generation_metric_delta(
            db=db,
            redis=redis,
            session_id=session_id,
            session=session,
            metrics_delta=metrics_delta,
            generated_count=generated_count,
        )

        await flush_backlog_to_queue(
            redis=redis,
            session_id=session_id,
            ttl_seconds=SESSION_TTL,
            max_queue_size=MAX_QUEUE_SIZE,
        )

        if session.get("status") == "in_progress":
            qid, q = await peek_next_question(redis, session_id)
            if qid and q:
                _schedule_question_audio_prefetch(
                    [q.get("question", "")],
                    _normalize_voice_gender(session.get("speech_voice_gender")),
                )


async def _post_submit_topic_processing(
    session_id: str,
    answered_count: int,
) -> None:
    db = get_db()
    redis = get_redis()

    if answered_count < TOPIC_INITIAL_ASK_COUNT:
        return

    async with _get_post_submit_lock(session_id):
        session = await redis.hgetall(f"session:{session_id}")
        if not session:
            return

        max_questions = max(
            TOPIC_TOTAL_QUESTIONS,
            _safe_int(session.get("max_questions", TOPIC_TOTAL_QUESTIONS)),
        )
        generated_count = _safe_int(session.get("generated_count", 0))
        remaining_needed = max(0, max_questions - generated_count)

        if remaining_needed <= 0:
            await redis.hset(f"session:{session_id}", mapping={"topic_followups_generated": "1"})
            await db[SESSIONS].update_one(
                {"session_id": session_id},
                {"$set": {"topic_followups_generated": True, "max_questions": max_questions}},
            )
            return

        if session.get("topic_followups_generated", "0") == "1":
            return

        qa_pairs = await get_session_qa(session_id)
        excluded_questions = await _get_session_question_texts(redis, session_id)

        ai_target = min(TOPIC_AI_FOLLOWUPS, remaining_needed)
        ai_items = await generate_topic_followup_batch(
            topic_name=session.get("role_title", "Topic Interview"),
            qa_pairs=qa_pairs,
            excluded_questions=excluded_questions,
            count=ai_target,
        )
        db_target = max(0, remaining_needed - len(ai_items))
        db_items = await _sample_topic_questions(
            db=db,
            topic_id=session.get("topic_id", ""),
            excluded_questions=excluded_questions + [i.get("question", "") for i in ai_items],
            limit=db_target,
        )

        topic_added = 0
        ai_added = 0
        db_added = 0
        for item in ai_items:
            qid = await enqueue_question(
                redis=redis,
                session_id=session_id,
                question=item.get("question", ""),
                difficulty=item.get("difficulty", "medium"),
                category=item.get("category", session.get("role_title", "topic")),
                ttl_seconds=SESSION_TTL,
                max_queue_size=MAX_QUEUE_SIZE,
            )
            if qid:
                topic_added += 1
                ai_added += 1

        for item in db_items:
            qid = await enqueue_question(
                redis=redis,
                session_id=session_id,
                question=item.get("question", ""),
                difficulty=item.get("difficulty", "medium"),
                category=item.get("category", session.get("role_title", "topic")),
                ttl_seconds=SESSION_TTL,
                max_queue_size=MAX_QUEUE_SIZE,
            )
            if qid:
                topic_added += 1
                db_added += 1

        fallback_added = 0
        fallback_variants = max(10, remaining_needed * 4)
        for variant in range(fallback_variants):
            if topic_added >= remaining_needed:
                break

            next_question_number = generated_count + topic_added + 1
            fallback_text = _build_topic_resilient_followup_question(
                session=session,
                question_number=next_question_number,
                variant=variant,
            )
            qid = await enqueue_question(
                redis=redis,
                session_id=session_id,
                question=fallback_text,
                difficulty="medium",
                category="topic-fallback",
                ttl_seconds=SESSION_TTL,
                max_queue_size=MAX_QUEUE_SIZE,
            )
            if qid:
                topic_added += 1
                fallback_added += 1

        generated_count += topic_added
        await _apply_generation_metric_delta(
            db=db,
            redis=redis,
            session_id=session_id,
            session=session,
            metrics_delta={
                "gemini_calls": 1 if ai_target > 0 else 0,
                "gemini_questions": ai_added,
                "bank_questions": db_added + fallback_added,
                "bank_shortfall": max(0, remaining_needed - topic_added),
                "generation_batches": 1,
            },
            generated_count=generated_count,
            extra_redis_fields={
                "topic_followups_generated": "1",
                "max_questions": str(max_questions),
            },
            extra_db_fields={
                "topic_followups_generated": True,
                "max_questions": max_questions,
            },
        )

        await flush_backlog_to_queue(
            redis=redis,
            session_id=session_id,
            ttl_seconds=SESSION_TTL,
            max_queue_size=MAX_QUEUE_SIZE,
        )

        if session.get("status") == "in_progress":
            qid, q = await peek_next_question(redis, session_id)
            if qid and q:
                _schedule_question_audio_prefetch(
                    [q.get("question", "")],
                    _normalize_voice_gender(session.get("speech_voice_gender")),
                )


def _schedule_post_submit_processing(
    *,
    session_id: str,
    question_id: str,
    question_text: str,
    answer: str,
    answered_count: int,
    max_questions: int,
    interview_type: str,
) -> None:
    try:
        if interview_type == "resume":
            task = asyncio.create_task(
                _post_submit_resume_processing(
                    session_id=session_id,
                    question_id=question_id,
                    question_text=question_text,
                    answer=answer,
                    answered_count=answered_count,
                    max_questions=max_questions,
                )
            )
            task.add_done_callback(_consume_post_submit_task_result)
            return

        if interview_type == "topic":
            task = asyncio.create_task(
                _post_submit_topic_processing(
                    session_id=session_id,
                    answered_count=answered_count,
                )
            )
            task.add_done_callback(_consume_post_submit_task_result)
    except Exception:
        # Never block request response on scheduler errors.
        return


async def submit_answer(session_id: str, question_id: str, answer: str) -> dict:
    """Submit answer and return next queued question immediately."""
    started_at = perf_counter()
    db = get_db()
    redis = get_redis()

    session = await redis.hgetall(f"session:{session_id}")
    if not session:
        raise ValueError("Interview session not found or expired")
    if session.get("status") != "in_progress":
        raise ValueError("Interview is not in progress")

    current_q = await redis.hgetall(f"session:{session_id}:q:{question_id}")
    current_question_text = current_q.get("question", "")

    await redis.hset(
        f"session:{session_id}:a:{question_id}",
        mapping={
            "question_id": question_id,
            "answer": answer,
            "question": current_question_text,
            "difficulty": current_q.get("difficulty", "medium"),
            "category": current_q.get("category", "general"),
            "submitted_at": utc_now(),
        },
    )
    await redis.rpush(f"session:{session_id}:answers", question_id)
    await redis.expire(f"session:{session_id}:a:{question_id}", SESSION_TTL)
    await redis.expire(f"session:{session_id}:answers", SESSION_TTL)

    await db[ANSWERS].update_one(
        {
            "session_id": session_id,
            "question_id": question_id,
            "user_id": session.get("user_id"),
        },
        {
            "$set": {
                "question": current_question_text,
                "answer": answer,
                "difficulty": current_q.get("difficulty", "medium"),
                "category": current_q.get("category", "general"),
                "stored_at": utc_now(),
            }
        },
        upsert=True,
    )

    question_count = _safe_int(session.get("question_count", 1))
    answered_count = _safe_int(session.get("answered_count", 0)) + 1
    served_count = _safe_int(session.get("served_count", 1))
    generated_count = _safe_int(session.get("generated_count", 0))
    max_questions = _safe_int(session.get("max_questions", MAX_QUESTIONS))
    interview_type = session.get("interview_type", "resume")
    speech_voice_gender = _normalize_voice_gender(session.get("speech_voice_gender"))

    if interview_type == "resume" and max_questions < RESUME_MAX_QUESTIONS:
        max_questions = RESUME_MAX_QUESTIONS
        await redis.hset(f"session:{session_id}", mapping={"max_questions": str(max_questions)})
        await db[SESSIONS].update_one(
            {"session_id": session_id},
            {"$set": {"max_questions": max_questions}},
        )

    if interview_type == "topic" and max_questions < TOPIC_TOTAL_QUESTIONS:
        max_questions = TOPIC_TOTAL_QUESTIONS
        await redis.hset(f"session:{session_id}", mapping={"max_questions": str(max_questions)})
        await db[SESSIONS].update_one(
            {"session_id": session_id},
            {"$set": {"max_questions": max_questions}},
        )

    await _update_local_summary(redis, session_id, current_question_text, answer)
    await push_context_item(
        redis=redis,
        session_id=session_id,
        item={
            "question": current_question_text,
            "answer": answer,
        },
        ttl_seconds=SESSION_TTL,
        max_items=CONTEXT_CACHE_ITEMS,
    )

    if answered_count >= max_questions:
        await redis.hset(
            f"session:{session_id}",
            mapping={
                "status": "completed",
                "answered_count": str(answered_count),
            },
        )
        await db[SESSIONS].update_one(
            {"session_id": session_id},
            {"$set": {"status": "completed", "completed_at": utc_now()}},
        )

        submit_ms = await _record_submit_latency(started_at)
        return {
            "session_id": session_id,
            "next_question": None,
            "is_complete": True,
            "message": "Interview complete! Generating your report...",
            "submit_ms": submit_ms,
        }

    await flush_backlog_to_queue(
        redis=redis,
        session_id=session_id,
        ttl_seconds=SESSION_TTL,
        max_queue_size=MAX_QUEUE_SIZE,
    )
    next_question_id, q_data = await pop_next_question(redis, session_id)

    effective_stats = _current_generation_stats(session)
    fallback_evaluation = None

    # Emergency fallback for rare queue-empty cases.
    if not next_question_id and interview_type == "resume":
        skill_pool = _resume_skill_pool(session)
        recent_answered_questions = await _get_answered_question_texts(
            redis=redis,
            session_id=session_id,
            limit=4,
        )
        recent_focus_topic, same_topic_streak = _recent_focus_streak(
            recent_answered_questions,
            skill_pool,
        )

        recent_context = await get_recent_context_items(
            redis=redis,
            session_id=session_id,
            max_items=CONTEXT_CACHE_ITEMS,
        )
        excluded_questions = await _get_session_question_texts(redis, session_id)
        fallback_evaluation = await evaluate_and_generate_followup(
            role_title=session.get("role_title", "Software Developer"),
            required_skills=_safe_json_list(session.get("jd_required_skills", "[]")),
            recent_context=recent_context,
            current_question=current_question_text,
            current_answer=answer,
            excluded_questions=excluded_questions,
            focus_topic=recent_focus_topic or "",
            same_topic_streak=same_topic_streak,
        )

        await redis.hset(
            f"session:{session_id}:a:{question_id}",
            mapping={
                "score": str(_safe_int(fallback_evaluation.get("score", 0))),
                "feedback": fallback_evaluation.get("feedback", ""),
            },
        )

        fallback_delta = {
            "gemini_calls": 1,
            "gemini_questions": 0,
            "bank_questions": 0,
            "bank_shortfall": 0,
            "generation_batches": 1,
        }
        follow_text, focus_skill_override = _apply_resume_followup_policy(
            skill_pool=skill_pool,
            recent_focus_topic=recent_focus_topic,
            same_topic_streak=same_topic_streak,
            suggested_question=(fallback_evaluation.get("followup_question") or "").strip(),
            suggested_topic=(fallback_evaluation.get("followup_topic") or "").strip(),
            followup_need_score=_safe_score_0_100(fallback_evaluation.get("followup_need_score", 0)),
            answered_count=answered_count,
        )

        if answered_count < max_questions:
            qid, used_model_followup = await _enqueue_resume_followup_with_fallback(
                redis=redis,
                session_id=session_id,
                session=session,
                answered_count=answered_count,
                suggested_text=follow_text,
                suggested_difficulty=fallback_evaluation.get("difficulty", "medium"),
                suggested_category=fallback_evaluation.get("category", "follow-up"),
                focus_skill_override=focus_skill_override,
            )
            if qid:
                generated_count += 1
                if used_model_followup:
                    fallback_delta["gemini_questions"] = 1

        effective_stats = await _apply_generation_metric_delta(
            db=db,
            redis=redis,
            session_id=session_id,
            session=session,
            metrics_delta=fallback_delta,
            generated_count=generated_count,
        )

        await flush_backlog_to_queue(
            redis=redis,
            session_id=session_id,
            ttl_seconds=SESSION_TTL,
            max_queue_size=MAX_QUEUE_SIZE,
        )
        next_question_id, q_data = await pop_next_question(redis, session_id)

    if (
        not next_question_id
        and interview_type == "topic"
        and answered_count < max_questions
    ):
        # Topic follow-up generation runs in background, so synchronously top-up once
        # before concluding interview to avoid premature completion around Q4.
        await _post_submit_topic_processing(
            session_id=session_id,
            answered_count=answered_count,
        )
        await flush_backlog_to_queue(
            redis=redis,
            session_id=session_id,
            ttl_seconds=SESSION_TTL,
            max_queue_size=MAX_QUEUE_SIZE,
        )
        next_question_id, q_data = await pop_next_question(redis, session_id)

    if not next_question_id or not q_data:
        await redis.hset(
            f"session:{session_id}",
            mapping={"status": "completed", "answered_count": str(answered_count)},
        )
        await db[SESSIONS].update_one(
            {"session_id": session_id},
            {"$set": {"status": "completed", "completed_at": utc_now()}},
        )

        submit_ms = await _record_submit_latency(started_at)
        payload = {
            "session_id": session_id,
            "next_question": None,
            "is_complete": True,
            "message": "Interview complete! Generating your report...",
            "submit_ms": submit_ms,
        }
        if fallback_evaluation:
            payload["answer_evaluation"] = {
                "score": _safe_int(fallback_evaluation.get("score", 0)),
                "feedback": fallback_evaluation.get("feedback", ""),
            }
        return payload

    await mark_question_asked(
        redis=redis,
        session_id=session_id,
        question_text=q_data.get("question", ""),
        ttl_seconds=SESSION_TTL,
    )

    await flush_backlog_to_queue(
        redis=redis,
        session_id=session_id,
        ttl_seconds=SESSION_TTL,
        max_queue_size=MAX_QUEUE_SIZE,
    )
    peek_next_id, peek_q = await peek_next_question(redis, session_id)
    if peek_next_id and peek_q:
        _schedule_question_audio_prefetch([peek_q.get("question", "")], speech_voice_gender)

    next_difficulty = q_data.get("difficulty", session.get("current_difficulty", "medium"))
    new_question_count = question_count + 1
    new_served_count = served_count + 1

    await redis.hset(
        f"session:{session_id}",
        mapping={
            "question_count": str(new_question_count),
            "answered_count": str(answered_count),
            "served_count": str(new_served_count),
            "generated_count": str(generated_count),
            "current_difficulty": next_difficulty,
        },
    )

    response = {
        "session_id": session_id,
        "next_question": {
            "question_id": next_question_id,
            "question": q_data.get("question", "Can you elaborate further?"),
            "difficulty": q_data.get("difficulty", "medium"),
            "question_number": new_served_count,
            "total_questions": max_questions,
        },
        "is_complete": False,
        "message": f"Question {new_served_count} of {max_questions}",
        "generation_stats": effective_stats,
    }

    if fallback_evaluation:
        response["answer_evaluation"] = {
            "score": _safe_int(fallback_evaluation.get("score", 0)),
            "feedback": fallback_evaluation.get("feedback", ""),
        }
    elif interview_type == "resume":
        response["answer_evaluation"] = {
            "status": "processing",
        }

    _schedule_post_submit_processing(
        session_id=session_id,
        question_id=question_id,
        question_text=current_question_text,
        answer=answer,
        answered_count=answered_count,
        max_questions=max_questions,
        interview_type=interview_type,
    )

    submit_ms = await _record_submit_latency(started_at)
    response["submit_ms"] = submit_ms
    return response


async def get_next_question(session_id: str, user_id: str) -> dict:
    """Preview next queued question without submitting a new answer."""
    db = get_db()
    redis = get_redis()

    session_doc = await db[SESSIONS].find_one({"session_id": session_id})
    if not session_doc:
        raise ValueError("Session not found")
    if session_doc.get("user_id") != user_id:
        raise ValueError("Unauthorized access to session")

    session = await redis.hgetall(f"session:{session_id}")
    if not session:
        raise ValueError("Interview session not found or expired")
    if session.get("status") != "in_progress":
        return {
            "session_id": session_id,
            "next_question": None,
            "is_complete": True,
            "message": "Interview is not in progress",
        }

    await flush_backlog_to_queue(
        redis=redis,
        session_id=session_id,
        ttl_seconds=SESSION_TTL,
        max_queue_size=MAX_QUEUE_SIZE,
    )

    qid, q = await peek_next_question(redis, session_id)
    if not qid or not q:
        return {
            "session_id": session_id,
            "next_question": None,
            "is_complete": False,
            "message": "No queued question yet",
            "queue_size": await queue_size(redis, session_id),
        }

    return {
        "session_id": session_id,
        "next_question": {
            "question_id": qid,
            "question": q.get("question", ""),
            "difficulty": q.get("difficulty", "medium"),
            "category": q.get("category", "general"),
        },
        "is_complete": False,
        "queue_size": await queue_size(redis, session_id),
        "message": "Next question ready",
    }


async def quit_interview(session_id: str, user_id: str) -> dict:
    """Mark an interview as quit and indicate whether a partial report can be generated."""
    db = get_db()
    redis = get_redis()

    session = await db[SESSIONS].find_one({"session_id": session_id})
    if not session:
        raise ValueError("Session not found")
    if session.get("user_id") != user_id:
        raise ValueError("Unauthorized access to session")

    if session.get("status") in {"completed", "quit", "quit_with_report"}:
        return {
            "session_id": session_id,
            "report_generated": session.get("status") == "quit_with_report",
            "message": "Interview already finalized",
        }

    quit_at = utc_now()

    # Update Redis state if still present.
    redis_session_key = f"session:{session_id}"
    redis_session = await redis.hgetall(redis_session_key)
    answered_count = int(redis_session.get("answered_count", 0)) if redis_session else 0
    if redis_session:
        await redis.hset(
            redis_session_key,
            mapping={
                "status": "quit",
                "quit_at": quit_at,
            },
        )
        await redis.expire(redis_session_key, SESSION_TTL)

    # Persist quit metadata for admin visibility.
    await db[SESSIONS].update_one(
        {"session_id": session_id},
        {
            "$set": {
                "status": "quit",
                "quit_at": quit_at,
                "quit_reason": "user_requested",
                "answered_count": answered_count,
            }
        },
    )

    has_answers = answered_count > 0
    return {
        "session_id": session_id,
        "report_generated": has_answers,
        "message": "Interview quit successfully" if has_answers else "Interview quit. No answers to evaluate yet.",
    }


async def get_session_qa(session_id: str) -> list:
    """Get all Q&A pairs from Redis for a session."""
    redis = get_redis()

    answer_ids = await redis.lrange(f"session:{session_id}:answers", 0, -1)
    qa_pairs = []

    if answer_ids:
        for qid in answer_ids:
            q = await redis.hgetall(f"session:{session_id}:q:{qid}")
            a = await redis.hgetall(f"session:{session_id}:a:{qid}")
            if not a:
                continue

            question_text = (a.get("question") or q.get("question") or "").strip()
            answer_text = (a.get("answer") or "").strip()
            if not question_text or not answer_text:
                continue

            qa_pairs.append({
                "question_id": qid,
                "question": question_text,
                "answer": answer_text,
                "difficulty": a.get("difficulty") or q.get("difficulty", "medium"),
                "category": a.get("category") or q.get("category", "general"),
            })

        if qa_pairs:
            return qa_pairs

    question_ids = await redis.lrange(f"session:{session_id}:questions", 0, -1)
    for qid in question_ids:
        q = await redis.hgetall(f"session:{session_id}:q:{qid}")
        a = await redis.hgetall(f"session:{session_id}:a:{qid}")
        if q and a:
            qa_pairs.append({
                "question_id": qid,
                "question": q.get("question", ""),
                "answer": a.get("answer", ""),
                "difficulty": q.get("difficulty", "medium"),
                "category": q.get("category", "general"),
            })

    return qa_pairs


async def cleanup_interview_local_state(session_id: str) -> None:
    """Cleanup per-session state stored in Redis."""
    redis = get_redis()
    await redis.delete(
        f"session:{session_id}:local_summary",
        f"session:{session_id}:pregen_in_flight",
    )
    # _POST_SUBMIT_LOCKS uses WeakValueDictionary — GC handles cleanup automatically.
