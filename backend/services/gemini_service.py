import json
import re
import random

from utils.gemini import call_gemini, _QUESTION_LANGUAGE_RULE


def _extract_json_object(text: str) -> str:
    value = (text or "").strip()
    if value.startswith("```"):
        value = value.split("\n", 1)[1]
    if value.endswith("```"):
        value = value.rsplit("```", 1)[0]
    value = value.strip()

    if value.startswith("{") and value.endswith("}"):
        return value

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


def _parse_json_object_loose(text: str) -> dict:
    value = _extract_json_object(text)
    try:
        parsed = json.loads(value)
    except Exception:
        cleaned = re.sub(r",\s*([}\]])", r"\1", value)
        parsed = json.loads(cleaned)
    if not isinstance(parsed, dict):
        raise ValueError("Parsed payload is not a JSON object")
    return parsed


def _parse_json_array_loose(text: str) -> list:
    value = _extract_json_array(text)
    try:
        parsed = json.loads(value)
    except Exception:
        cleaned = re.sub(r",\s*([}\]])", r"\1", value)
        parsed = json.loads(cleaned)
    if not isinstance(parsed, list):
        raise ValueError("Parsed payload is not a JSON array")
    return parsed


def _fallback_score(answer: str) -> int:
    text = (answer or "").strip().lower()
    words = len(text.split())
    weak = any(marker in text for marker in ["not sure", "maybe", "i think", "dont know", "don't know"])

    if words < 10:
        return 35
    if words < 25:
        return 55
    if weak:
        return 50
    if words > 80:
        return 75
    return 65


async def generate_resume_seed_questions(
    role_title: str,
    resume_summary: str,
    resume_skills: list[str],
    jd_title: str,
    jd_description: str,
    jd_required_skills: list[str],
    excluded_questions: list[str],
    count: int = 2,
    company_name: str = "",
    experience_level: str = "mid",
) -> list[dict]:
    count = max(1, int(count or 2))

    payload = {
        "role_title": role_title,
        "resume_summary": resume_summary,
        "resume_skills": resume_skills,
        "jd_title": jd_title,
        "jd_description": jd_description,
        "jd_required_skills": jd_required_skills,
        "excluded_questions": excluded_questions[-25:] if excluded_questions else [],
        "count": count,
        "company_name": company_name or "",
        "experience_level": experience_level or "mid",
    }

    company_guidance = ""
    if company_name:
        company_guidance = f"""
Company context: The candidate is applying to "{company_name}". Tailor questions to match the interview style and technical depth that {company_name} is known to prefer. For well-known companies (e.g. Google, Amazon, Microsoft, Infosys, TCS, Wipro, etc.) use knowledge of their typical interview patterns and values.
"""

    level_guidance = {
        "fresher": (
            "Candidate level: FRESHER (0–1 year experience or fresh graduate). "
            "Ask only foundational questions: definitions, basic usage, simple project-level scenarios. "
            "Avoid system design, production trade-offs, or advanced optimization. "
            "Use easy difficulty. The goal is to assess conceptual awareness, not deep expertise."
        ),
        "senior": (
            "Candidate level: SENIOR (5+ years). "
            "Ask deep technical questions: architecture, trade-offs, production failures, scalability. "
            "Use hard difficulty."
        ),
    }.get(
        experience_level,
        (
            "Candidate level: MID-LEVEL (2–4 years). "
            "Balance practical implementation questions with some conceptual depth. "
            "Use easy to medium difficulty."
        ),
    )

    prompt = f"""{_QUESTION_LANGUAGE_RULE}
Generate exactly {count} resume interview questions.
{company_guidance}
{level_guidance}

Input JSON:
{json.dumps(payload, ensure_ascii=True)}

Rules:
1) Questions must be strictly from JD required skills and role context.
2) Use resume context for relevance — reference the candidate's actual background where useful.
3) Do not repeat or paraphrase excluded_questions.
4) Keep questions concise and practical.
5) Make the set diverse: use different styles (scenario, debugging, trade-off, implementation, testing).
6) Do not prefix with numbering like "Question 1:".
7) Avoid generic repeats like "Explain your hands-on experience" for every question.
8) Strictly respect the candidate level guidance above when choosing difficulty.

Return ONLY valid JSON array with objects:
- question (string)
- difficulty (easy|medium|hard)
- category (string)
"""

    try:
        result = await call_gemini(
            prompt,
            max_attempts=3,
            request_timeout_seconds=20,
        )
        data = _parse_json_array_loose(result)

        output = []
        for item in data[:count]:
            if not isinstance(item, dict):
                item = {}
            output.append(
                {
                    "question": (item.get("question") or "").strip(),
                    "difficulty": item.get("difficulty") if item.get("difficulty") in {"easy", "medium", "hard"} else "medium",
                    "category": item.get("category") or "resume-seed",
                }
            )
        return [q for q in output if q.get("question")]
    except Exception:
        base_skill = jd_required_skills[0] if jd_required_skills else (resume_skills[0] if resume_skills else "this role")
        fallback_templates = [
            "In a project aligned with {role}, where did {skill} materially change your design decisions?",
            "If your {skill} implementation regressed after deployment for {role}, how would you triage it?",
            "What trade-offs did you make while using {skill} under real delivery constraints in {role}?",
            "How did you test and validate a {skill}-based feature before production in {role}?",
            "Describe one architecture decision around {skill} that improved reliability or scale for {role}.",
        ]
        fallback = []
        for i in range(count):
            template = fallback_templates[i % len(fallback_templates)]
            fallback.append(
                {
                    "question": template.format(skill=base_skill, role=role_title),
                    "difficulty": "medium",
                    "category": "resume-seed",
                }
            )
        return fallback


async def evaluate_and_generate_followup(
    role_title: str,
    required_skills: list[str],
    recent_context: list[dict],
    current_question: str,
    current_answer: str,
    excluded_questions: list[str],
    focus_topic: str = "",
    same_topic_streak: int = 0,
) -> dict:
    payload = {
        "role_title": role_title,
        "required_skills": required_skills,
        "recent_context": recent_context[-3:] if recent_context else [],
        "current_question": current_question,
        "current_answer": current_answer,
        "excluded_questions": excluded_questions[-25:] if excluded_questions else [],
        "focus_topic": focus_topic,
        "same_topic_streak": int(same_topic_streak or 0),
    }

    prompt = f"""{_QUESTION_LANGUAGE_RULE}
You are a strict technical interviewer.

Input JSON:
{json.dumps(payload, ensure_ascii=True)}

Task:
1) Evaluate current_answer for current_question.
2) Generate one non-duplicate follow-up question.

Rules:
1) Follow-up must stay within required_skills only.
2) Use recent_context for continuity.
3) Do not repeat/paraphrase excluded_questions.
4) Score should reflect conceptual correctness, not verbosity.
5) If same_topic_streak is 2 or more, avoid another same-topic follow-up unless truly critical.
6) Ask in realistic live-interview style (specific scenario, debugging, trade-off, design decision), not generic textbook phrasing.
7) Do not prefix numbering like "Question 4:".
8) Avoid repeating the previous follow-up wording pattern.

Return ONLY valid JSON object:
{{
  "score": 0-100,
  "feedback": "short technical feedback",
  "followup_question": "...",
    "followup_topic": "specific required skill/topic for the follow-up",
    "followup_need_score": 0-100,
  "difficulty": "easy|medium|hard",
  "category": "..."
}}
"""

    try:
        result = await call_gemini(
            prompt,
            max_attempts=3,
            request_timeout_seconds=18,
        )
        data = _parse_json_object_loose(result)
        followup = (data.get("followup_question") or "").strip()
        try:
            followup_need_score = int(data.get("followup_need_score", 70))
        except Exception:
            followup_need_score = 70
        followup_need_score = max(0, min(100, followup_need_score))
        return {
            "score": int(data.get("score", 0)),
            "feedback": (data.get("feedback") or "").strip() or "Answer reviewed.",
            "followup_question": followup,
            "followup_topic": (data.get("followup_topic") or "").strip(),
            "followup_need_score": followup_need_score,
            "difficulty": data.get("difficulty") if data.get("difficulty") in {"easy", "medium", "hard"} else "medium",
            "category": data.get("category") or "follow-up",
        }
    except Exception:
        fallback_skill = required_skills[0] if required_skills else "the selected role requirement"
        fallback_templates = [
            "In a production system for {role}, describe a failure you would expect around {skill} and how you would debug it end-to-end.",
            "Given a feature built with {skill}, what trade-offs would you make between speed, reliability, and maintainability in {role}?",
            "How would you test and validate a {skill}-based implementation before release for {role}?",
            "Walk through one real incident where {skill} decisions changed the final architecture for {role}.",
        ]
        template = random.choice(fallback_templates)
        return {
            "score": _fallback_score(current_answer),
            "feedback": "Try to explain the mechanism, trade-offs, and one concrete example.",
            "followup_question": template.format(skill=fallback_skill, role=role_title),
            "followup_topic": fallback_skill,
            "followup_need_score": 70,
            "difficulty": "medium",
            "category": "follow-up",
        }


async def generate_topic_followup_batch(
    topic_name: str,
    qa_pairs: list[dict],
    excluded_questions: list[str],
    count: int = 3,
) -> list[dict]:
    count = max(1, int(count or 3))

    payload = {
        "topic": topic_name,
        "qa_pairs": qa_pairs,
        "excluded_questions": excluded_questions[-30:] if excluded_questions else [],
        "count": count,
    }

    prompt = f"""{_QUESTION_LANGUAGE_RULE}
Generate exactly {count} topic-focused technical follow-up questions.

Input JSON:
{json.dumps(payload, ensure_ascii=True)}

Rules:
1) Stay in topic scope only.
2) Build on candidate weak points from qa_pairs.
3) Do not repeat/paraphrase excluded_questions.

Return ONLY valid JSON array with objects:
- question (string)
- difficulty (easy|medium|hard)
- category (string)
"""

    try:
        result = await call_gemini(
            prompt,
            max_attempts=3,
            request_timeout_seconds=20,
        )
        data = _parse_json_array_loose(result)

        out = []
        for item in data[:count]:
            if not isinstance(item, dict):
                item = {}
            text = (item.get("question") or "").strip()
            if not text:
                continue
            out.append(
                {
                    "question": text,
                    "difficulty": item.get("difficulty") if item.get("difficulty") in {"easy", "medium", "hard"} else "medium",
                    "category": item.get("category") or topic_name,
                }
            )
        return out
    except Exception:
        fallback = []
        for i in range(count):
            fallback.append(
                {
                    "question": f"In {topic_name}, explain how you would solve a real production issue and why.",
                    "difficulty": "medium" if i < 2 else "hard",
                    "category": topic_name,
                }
            )
        return fallback
