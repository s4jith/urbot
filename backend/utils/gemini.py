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
    "or produce any written output.\n"
    "  - NEVER ask the candidate to draw, sketch, or create any diagram, flowchart, or "
    "visual representation.\n"
    "  - NEVER use prompts like 'Write a program...', 'Code the following...', "
    "'Implement a function that...', 'Write the SQL query...', 'Draw a diagram...', "
    "'Sketch the architecture...', or any phrasing that requires writing or drawing.\n"
    "  - Instead, ask the candidate to EXPLAIN, DESCRIBE, WALK THROUGH, or DISCUSS "
    "concepts verbally. For example: 'How would you approach...', "
    "'Can you explain how...', 'Walk me through your thought process for...', "
    "'What would your strategy be for...'\n"
    "  - All questions must be answerable by speaking alone — no pen, paper, or "
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


def _init_key_pool() -> None:
    """Build the key pool from GEMINI_API_KEY (primary) + GEMINI_API_KEYS (extras)."""
    global _KEY_POOL
    keys: list[str] = []

    # Extra keys first so primary is used as last resort / first round-robin entry
    extras = (getattr(settings, "GEMINI_API_KEYS", "") or "").strip()
    if extras:
        keys.extend([k.strip() for k in extras.split(",") if k.strip()])

    primary = (settings.GEMINI_API_KEY or "").strip()
    if primary and primary not in keys:
        keys.append(primary)

    _KEY_POOL = [
        {
            "key": k,
            "client": genai.Client(api_key=k),
            "call_count": 0,
            "rate_limited_until": 0.0,  # time.monotonic() deadline
        }
        for k in keys
        if k
    ]


def _pick_key() -> dict:
    """Return the next available key via round-robin, skipping rate-limited keys."""
    global _KEY_POOL_INDEX
    if not _KEY_POOL:
        raise RuntimeError("No Gemini API keys configured")

    now = time.monotonic()
    n = len(_KEY_POOL)
    with _KEY_POOL_LOCK:
        for i in range(n):
            idx = (_KEY_POOL_INDEX + i) % n
            entry = _KEY_POOL[idx]
            if entry["rate_limited_until"] <= now:
                _KEY_POOL_INDEX = (idx + 1) % n
                entry["call_count"] += 1
                return entry
        # All keys temporarily rate-limited — return soonest-recovering one
        return min(_KEY_POOL, key=lambda e: e["rate_limited_until"])


def _mark_key_rate_limited(entry: dict, retry_seconds: float = 65.0) -> None:
    """Mark a key as unavailable for retry_seconds (one Gemini quota window)."""
    with _KEY_POOL_LOCK:
        entry["rate_limited_until"] = time.monotonic() + retry_seconds


def get_key_pool_status() -> list[dict]:
    """Return pool health summary (for admin/debug endpoints)."""
    now = time.monotonic()
    return [
        {
            "index": i,
            "call_count": e["call_count"],
            "rate_limited": e["rate_limited_until"] > now,
            "recovers_in_s": max(0.0, round(e["rate_limited_until"] - now, 1)),
        }
        for i, e in enumerate(_KEY_POOL)
    ]


_init_key_pool()


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
        key_entry = _pick_key()

        for model_name in model_candidates:
            try:
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
                    _mark_key_rate_limited(key_entry)
                    key_entry = _pick_key()
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


def _is_loose_answer(answer: str) -> bool:
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
        "dont know",
        "don't know",
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
        result = await call_gemini(prompt)
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
4. "required_skills" — extract only specific, concrete technical skills, tools, languages, or certifications; no vague traits like "teamwork".

Job Description Text:
---
{jd_text}
---

Return ONLY valid JSON, no markdown."""

    try:
        raw = await call_gemini(prompt)
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
        result = _extract_json_object(await call_gemini(prompt))
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
        result = _extract_json_object(await call_gemini(prompt))
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
        result = _extract_json_array((await call_gemini(prompt)).strip())
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
3. Do not repeat or paraphrase any question in previous_questions.
4. Prioritize loose_qa first: if any answer is vague/short/uncertain, ask a direct follow-up that probes missing concept depth.
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
        result = (await call_gemini(prompt)).strip()
        data = json.loads(result)
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
  "overall_score": 0-100 integer,
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
            await call_gemini(
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
            "detailed_scores": detailed_scores,
            "strengths": strengths,
            "weaknesses": weaknesses,
            "recommendations": recommendations,
        }

    fallback_overall = int(round(sum(item["score"] for item in detailed_scores) / max(1, len(detailed_scores))))
    return {
        "overall_score": _clamp_score(fallback_overall, 50),
        "detailed_scores": detailed_scores,
        "strengths": ["Attempted responses for all interview prompts"],
        "weaknesses": ["Detailed AI evaluation was unavailable for this run"],
        "recommendations": ["Retry report generation to get full AI feedback"],
    }
