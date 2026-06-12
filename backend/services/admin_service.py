from bson import ObjectId
import json
import re
from datetime import datetime
from database import get_db
from models.collections import JOB_ROLES, ROLE_REQUIREMENTS, QUESTIONS, TOPICS, TOPIC_QUESTIONS, SESSIONS, USERS, RESULTS, RESUMES, SKILLS, ANSWERS, JOB_DESCRIPTIONS, DEPARTMENTS, APP_SETTINGS, GEMINI_KEYS
from utils.helpers import utc_now, str_objectid, str_objectids
from utils.gemini import call_gemini
from utils.resume_text import extract_resume_text


# ─── Job Roles ───

async def create_role(title: str, description: str, department: str = None) -> dict:
    db = get_db()
    doc = {
        "title": title,
        "description": description,
        "department": department,
        "created_at": utc_now(),
    }
    result = await db[JOB_ROLES].insert_one(doc)
    doc["_id"] = result.inserted_id
    return str_objectid(doc)


async def update_role(role_id: str, data: dict) -> dict:
    db = get_db()
    update_data = {k: v for k, v in data.items() if v is not None}
    if not update_data:
        raise ValueError("No fields to update")
    update_data["updated_at"] = utc_now()
    await db[JOB_ROLES].update_one({"_id": ObjectId(role_id)}, {"$set": update_data})
    doc = await db[JOB_ROLES].find_one({"_id": ObjectId(role_id)})
    if not doc:
        raise ValueError("Role not found")
    return str_objectid(doc)


async def delete_role(role_id: str) -> bool:
    db = get_db()
    result = await db[JOB_ROLES].delete_one({"_id": ObjectId(role_id)})
    return result.deleted_count > 0


async def list_roles() -> list:
    db = get_db()
    cursor = db[JOB_ROLES].find().sort("created_at", -1)
    docs = await cursor.to_list(length=100)
    return str_objectids(docs)


# ─── Questions ───

async def create_question(
    role_id: str = None,
    topic_id: str = None,
    interview_type: str = "resume",
    question: str = "",
    difficulty: str = "medium",
    category: str = None,
    subtopic: str = None,
    expected_answer: str = None,
) -> dict:
    db = get_db()
    interview_type = (interview_type or "resume").strip().lower()
    if interview_type not in {"resume", "topic"}:
        raise ValueError("interview_type must be either 'resume' or 'topic'")

    if interview_type == "resume" and not role_id:
        raise ValueError("role_id is required for resume interview questions")
    if interview_type == "topic" and not topic_id:
        raise ValueError("topic_id is required for topic interview questions")

    collection = QUESTIONS if interview_type == "resume" else TOPIC_QUESTIONS
    doc = {
        "role_id": role_id,
        "topic_id": topic_id,
        "interview_type": interview_type,
        "question": question,
        "difficulty": difficulty,
        "category": category,
        "subtopic": subtopic,
        "expected_answer": expected_answer,
        "created_at": utc_now(),
    }
    result = await db[collection].insert_one(doc)
    doc["_id"] = result.inserted_id
    return str_objectid(doc)


async def update_question(question_id: str, data: dict) -> dict:
    db = get_db()
    update_data = {k: v for k, v in data.items() if v is not None}
    if not update_data:
        raise ValueError("No fields to update")
    update_data["updated_at"] = utc_now()
    # Try resume question collection first, then topic question collection.
    result = await db[QUESTIONS].update_one({"_id": ObjectId(question_id)}, {"$set": update_data})
    if result.matched_count == 0:
        await db[TOPIC_QUESTIONS].update_one({"_id": ObjectId(question_id)}, {"$set": update_data})

    doc = await db[QUESTIONS].find_one({"_id": ObjectId(question_id)})
    if not doc:
        doc = await db[TOPIC_QUESTIONS].find_one({"_id": ObjectId(question_id)})
    if not doc:
        raise ValueError("Question not found")
    return str_objectid(doc)


async def delete_question(question_id: str) -> bool:
    db = get_db()
    result = await db[QUESTIONS].delete_one({"_id": ObjectId(question_id)})
    if result.deleted_count > 0:
        return True
    result = await db[TOPIC_QUESTIONS].delete_one({"_id": ObjectId(question_id)})
    return result.deleted_count > 0


async def list_questions(
    role_id: str = None,
    topic_id: str = None,
    interview_type: str = None,
    difficulty: str = None,
) -> list:
    db = get_db()
    interview_type = (interview_type or "").strip().lower()
    difficulty = (difficulty or "").strip().lower()

    docs = []
    if interview_type in {"", "resume"}:
        query = {"role_id": role_id} if role_id else {}
        if difficulty:
            query["difficulty"] = difficulty
        cursor = db[QUESTIONS].find(query).sort("created_at", -1)
        resume_docs = await cursor.to_list(length=200)
        docs.extend(resume_docs)

    if interview_type in {"", "topic"}:
        query = {"topic_id": topic_id} if topic_id else {}
        if difficulty:
            query["difficulty"] = difficulty
        cursor = db[TOPIC_QUESTIONS].find(query).sort("created_at", -1)
        topic_docs = await cursor.to_list(length=200)
        docs.extend(topic_docs)

    docs.sort(key=lambda d: d.get("created_at", ""), reverse=True)
    return str_objectids(docs)


async def get_question_by_id(question_id: str) -> dict:
    db = get_db()
    doc = await db[QUESTIONS].find_one({"_id": ObjectId(question_id)})
    if not doc:
        doc = await db[TOPIC_QUESTIONS].find_one({"_id": ObjectId(question_id)})
    if not doc:
        raise ValueError("Question not found")
    return str_objectid(doc)


# ─── Topics ───

async def create_topic(name: str, description: str = None) -> dict:
    db = get_db()
    existing = await db[TOPICS].find_one({"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}})
    if existing:
        raise ValueError("Topic already exists")

    doc = {
        "name": name,
        "description": description,
        "is_published": False,
        "timer_enabled": False,
        "timer_seconds": None,
        "created_at": utc_now(),
    }
    result = await db[TOPICS].insert_one(doc)
    doc["_id"] = result.inserted_id
    return str_objectid(doc)


async def list_topics(only_published: bool = False) -> list:
    db = get_db()
    query = {"is_published": True} if only_published else {}
    cursor = db[TOPICS].find(query).sort("created_at", -1)
    docs = await cursor.to_list(length=200)
    return str_objectids(docs)


async def update_topic(topic_id: str, data: dict) -> dict:
    db = get_db()
    update_data = {k: v for k, v in data.items() if v is not None}
    if not update_data:
        raise ValueError("No fields to update")
    update_data["updated_at"] = utc_now()
    await db[TOPICS].update_one({"_id": ObjectId(topic_id)}, {"$set": update_data})
    doc = await db[TOPICS].find_one({"_id": ObjectId(topic_id)})
    if not doc:
        raise ValueError("Topic not found")
    return str_objectid(doc)


async def delete_topic(topic_id: str) -> bool:
    db = get_db()
    await db[TOPIC_QUESTIONS].delete_many({"topic_id": topic_id})
    result = await db[TOPICS].delete_one({"_id": ObjectId(topic_id)})
    return result.deleted_count > 0


async def set_topic_publish_status(
    topic_id: str,
    is_published: bool,
    timer_enabled: bool | None = None,
    timer_seconds: int | None = None,
) -> dict:
    db = get_db()

    update_data = {
        "is_published": is_published,
        "updated_at": utc_now(),
    }

    if timer_enabled is not None:
        update_data["timer_enabled"] = bool(timer_enabled)

    if timer_seconds is not None:
        if timer_seconds <= 0:
            raise ValueError("timer_seconds must be greater than 0")
        update_data["timer_seconds"] = int(timer_seconds)

    if timer_enabled is False:
        update_data["timer_seconds"] = None

    await db[TOPICS].update_one(
        {"_id": ObjectId(topic_id)},
        {"$set": update_data},
    )
    doc = await db[TOPICS].find_one({"_id": ObjectId(topic_id)})
    if not doc:
        raise ValueError("Topic not found")
    return str_objectid(doc)


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


def _normalize_subject(subject: str, allowed_subjects: list[str]) -> str:
    raw = (subject or "").strip().lower()
    if not raw:
        return ""

    for allowed in allowed_subjects:
        if raw == allowed.lower():
            return allowed

    for allowed in allowed_subjects:
        a = allowed.lower()
        if raw in a or a in raw:
            return allowed

    return ""


async def import_questions_from_pdf(
    role_id: str | None,
    topic_id: str | None,
    interview_type: str,
    subjects: list[str] | None,
    filename: str,
    file_content: bytes,
) -> dict:
    db = get_db()

    interview_type = (interview_type or "resume").strip().lower()
    if interview_type not in {"resume", "topic"}:
        raise ValueError("interview_type must be either 'resume' or 'topic'")

    clean_subjects = []
    for item in (subjects or []):
        value = (item or "").strip()
        if value and value.lower() not in [s.lower() for s in clean_subjects]:
            clean_subjects.append(value)

    if interview_type == "resume" and not role_id:
        raise ValueError("role_id is required for resume question import")

    if interview_type == "topic" and not topic_id:
        raise ValueError("topic_id is required for topic question import")

    if interview_type == "resume" and not clean_subjects:
        raise ValueError("At least one subject is required")

    text = extract_resume_text(filename, file_content)
    if not text or len(text) < 20:
        raise ValueError("Could not extract readable text from PDF")

    topic_name = ""
    if interview_type == "topic" and topic_id:
        topic_doc = await db[TOPICS].find_one({"_id": ObjectId(topic_id)})
        if not topic_doc:
            raise ValueError("Topic not found")
        topic_name = (topic_doc.get("name") or "").strip()

    if interview_type == "topic":
        prompt = f"""You are extracting topic-specific interview questions from a document.

Target topic: {topic_name or "General"}

Rules:
1. Extract only actual interview questions relevant to the target topic.
2. Automatically classify each question into a highly specific subtopic (e.g., for Topic DBMS, subtopics could be Transactions, Joins, Indexing, Normalization).
3. Ignore headings, instructions, answers, explanations, and duplicates.
4. Keep each question concise and interview-ready.
5. Assign a difficulty: easy, medium, or hard.

Return ONLY valid JSON in this format:
{{
  "questions": [
    {{"question": "...", "subtopic": "...", "difficulty": "medium"}}
  ]
}}

Document text:
---
{text}
---"""
    else:
        prompt = f"""You are extracting interview questions from a document.

Allowed subjects (must choose one of these for each question): {', '.join(clean_subjects)}

Rules:
1. Extract only actual interview questions from the document.
2. Ignore headings, instructions, answers, explanations, and duplicates.
3. Assign each extracted question to ONE allowed subject from the list above.
4. Automatically classify each question into a specific subtopic.
5. Assign a difficulty: easy, medium, or hard.
6. Keep question text clean and concise.

Return ONLY valid JSON in this format:
{{
  "questions": [
    {{"question": "...", "subject": "...", "subtopic": "...", "difficulty": "medium"}}
  ]
}}

Document text:
---
{text}
---"""

    raw = await call_gemini(prompt)
    parsed_text = _extract_json_object(raw)
    try:
        parsed = json.loads(parsed_text)
    except json.JSONDecodeError as exc:
        raise ValueError("Failed to parse extracted questions from AI response") from exc

    items = parsed.get("questions", []) if isinstance(parsed, dict) else []
    if not isinstance(items, list) or not items:
        raise ValueError("No questions were extracted from this PDF")

    allowed_difficulties = {"easy", "medium", "hard"}
    docs = []
    seen = set()

    for item in items:
        if not isinstance(item, dict):
            continue

        q_text = (item.get("question") or "").strip()
        if len(q_text) < 8:
            continue
        q_text = re.sub(r"\s+", " ", q_text)

        if interview_type == "topic":
            subject = topic_name or "Topic"
        else:
            subject = _normalize_subject(item.get("subject", ""), clean_subjects)
            if not subject:
                continue

        difficulty = (item.get("difficulty") or "medium").strip().lower()
        if difficulty not in allowed_difficulties:
            difficulty = "medium"

        subtopic = (item.get("subtopic") or "").strip()

        key = q_text.lower()
        if key in seen:
            continue
        seen.add(key)

        docs.append(
            {
                "role_id": role_id,
                "topic_id": topic_id,
                "interview_type": interview_type,
                "question": q_text,
                "difficulty": difficulty,
                "category": subject,
                "subtopic": subtopic,
                "source": "pdf_upload",
                "created_at": utc_now(),
            }
        )

    if not docs:
        if interview_type == "topic":
            raise ValueError("No valid topic questions found in this PDF")
        raise ValueError("No valid questions found after subject filtering")

    return {
        "questions": docs,
        "subjects": clean_subjects,
        "interview_type": interview_type,
        "topic_id": topic_id,
    }


# ─── Role Requirements ───

async def create_requirement(role_id: str, skill: str, level: str = "intermediate") -> dict:
    db = get_db()
    doc = {
        "role_id": role_id,
        "skill": skill,
        "level": level,
        "created_at": utc_now(),
    }
    result = await db[ROLE_REQUIREMENTS].insert_one(doc)
    doc["_id"] = result.inserted_id
    return str_objectid(doc)


async def list_requirements(role_id: str) -> list:
    db = get_db()
    cursor = db[ROLE_REQUIREMENTS].find({"role_id": role_id})
    docs = await cursor.to_list(length=100)
    return str_objectids(docs)


async def delete_requirement(req_id: str) -> bool:
    db = get_db()
    result = await db[ROLE_REQUIREMENTS].delete_one({"_id": ObjectId(req_id)})
    return result.deleted_count > 0


async def list_quit_interviews(limit: int = 100) -> list:
    """List interviews quit by users with full admin-facing details."""
    db = get_db()

    cursor = db[SESSIONS].find(
        {"status": {"$in": ["quit", "quit_with_report"]}}
    ).sort("quit_at", -1).limit(limit)
    sessions = await cursor.to_list(length=limit)

    output = []
    for session in sessions:
        user_id = session.get("user_id")
        user_doc = None
        if user_id:
            try:
                user_doc = await db[USERS].find_one({"_id": ObjectId(user_id)})
            except Exception:
                user_doc = await db[USERS].find_one({"id": user_id})

        result_doc = await db[RESULTS].find_one({"session_id": session.get("session_id")})

        quit_at = session.get("quit_at")
        quit_dt = None
        if isinstance(quit_at, str):
            try:
                quit_dt = datetime.fromisoformat(quit_at.replace("Z", "+00:00"))
            except Exception:
                quit_dt = None

        output.append(
            {
                "session_id": session.get("session_id"),
                "user_id": user_id,
                "user_name": (user_doc or {}).get("name", "Unknown"),
                "user_email": (user_doc or {}).get("email", "Unknown"),
                "role_title": session.get("role_title", "Unknown"),
                "status": session.get("status"),
                "quit_reason": session.get("quit_reason", "user_requested"),
                "answered_count": session.get("answered_count", 0),
                "max_questions": session.get("max_questions", 0),
                "quit_at": quit_at,
                "quit_day": quit_dt.strftime("%A") if quit_dt else None,
                "quit_date": quit_dt.strftime("%Y-%m-%d") if quit_dt else None,
                "quit_time": quit_dt.strftime("%H:%M:%S %Z") if quit_dt else None,
                "report_generated": bool(result_doc),
                "overall_score": (result_doc or {}).get("overall_score"),
                "total_questions_evaluated": (result_doc or {}).get("total_questions", 0),
                "strengths": (result_doc or {}).get("strengths", []),
                "weaknesses": (result_doc or {}).get("weaknesses", []),
                "recommendations": (result_doc or {}).get("recommendations", []),
            }
        )

    return output


async def list_admin_reports(limit: int = 100) -> list:
    """List all interview results for admin overview."""
    db = get_db()
    cursor = db[RESULTS].find().sort("completed_at", -1).limit(limit)
    reports = await cursor.to_list(length=limit)

    output = []
    for report in reports:
        user_id = report.get("user_id")
        user_doc = None
        if user_id:
            try:
                user_doc = await db[USERS].find_one({"_id": ObjectId(user_id)})
            except Exception:
                user_doc = await db[USERS].find_one({"id": user_id})

        output.append(
            {
                "session_id": report.get("session_id"),
                "user_id": user_id,
                "user_name": (user_doc or {}).get("name", "Unknown"),
                "user_email": (user_doc or {}).get("email", "Unknown"),
                "role_title": report.get("role_title", "Unknown"),
                "overall_score": report.get("overall_score", 0),
                "technical_score": report.get("technical_score"),
                "grammatical_score": report.get("grammatical_score"),
                "total_questions": report.get("total_questions", 0),
                "completed_at": report.get("completed_at", ""),
                "session_status": report.get("session_status", "completed"),
                "is_quit": bool(report.get("is_quit", False)),
                "generation_stats": {
                    "gemini_calls": int((report.get("generation_stats") or {}).get("gemini_calls", 0) or 0),
                    "gemini_questions": int((report.get("generation_stats") or {}).get("gemini_questions", 0) or 0),
                    "bank_questions": int((report.get("generation_stats") or {}).get("bank_questions", 0) or 0),
                    "bank_shortfall": int((report.get("generation_stats") or {}).get("bank_shortfall", 0) or 0),
                    "generation_batches": int((report.get("generation_stats") or {}).get("generation_batches", 0) or 0),
                },
            }
        )

    return output
async def get_admin_report_detail(session_id: str) -> dict:
    """Get full interview result detail for admin view."""
    db = get_db()
    report = await db[RESULTS].find_one({"session_id": session_id})
    if not report:
        raise ValueError("Report not found")

    user_id = report.get("user_id")
    user_doc = None
    if user_id:
        try:
            user_doc = await db[USERS].find_one({"_id": ObjectId(user_id)})
        except Exception:
            user_doc = await db[USERS].find_one({"id": user_id})

    payload = str_objectid(report)
    payload["user_name"] = (user_doc or {}).get("name", "Unknown")
    payload["user_email"] = (user_doc or {}).get("email", "Unknown")
    return payload


async def list_admin_users(limit: int = 500, skip: int = 0) -> list:
    """List users for admin management with lightweight activity stats."""
    db = get_db()

    user_cursor = db[USERS].find({"role": "student"}, {"password": 0}).sort("created_at", -1).skip(skip).limit(limit)
    users = await user_cursor.to_list(length=limit)

    interview_counts = await db[SESSIONS].aggregate([
        {"$group": {"_id": "$user_id", "count": {"$sum": 1}}},
    ]).to_list(length=2000)
    report_counts = await db[RESULTS].aggregate([
        {"$group": {"_id": "$user_id", "count": {"$sum": 1}}},
    ]).to_list(length=2000)

    interview_map = {str(item.get("_id")): item.get("count", 0) for item in interview_counts}
    report_map = {str(item.get("_id")): item.get("count", 0) for item in report_counts}

    output = []
    for user in users:
        normalized = str_objectid(user)
        user_id = normalized.get("id", "")
        output.append(
            {
                "id": user_id,
                "name": normalized.get("name", ""),
                "email": normalized.get("email", ""),
                "role": normalized.get("role", "student"),
                "reg_no": normalized.get("reg_no") or None,
                "created_at": normalized.get("created_at", ""),
                "interview_count": interview_map.get(user_id, 0),
                "report_count": report_map.get(user_id, 0),
            }
        )

    return output


async def delete_admin_user(target_user_id: str, current_admin_user_id: str) -> bool:
    """Delete a user and associated data. Admin users cannot be deleted from this endpoint."""
    db = get_db()

    if target_user_id == current_admin_user_id:
        raise ValueError("You cannot delete your own account")

    user_doc = await db[USERS].find_one({"_id": ObjectId(target_user_id)})
    if not user_doc:
        raise ValueError("User not found")

    if user_doc.get("role") == "admin":
        raise ValueError("Admin users cannot be deleted from this page")

    await db[RESUMES].delete_many({"user_id": target_user_id})
    await db[SKILLS].delete_many({"user_id": target_user_id})
    await db[JOB_DESCRIPTIONS].delete_many({"user_id": target_user_id})
    await db[SESSIONS].delete_many({"user_id": target_user_id})
    await db[ANSWERS].delete_many({"user_id": target_user_id})
    await db[RESULTS].delete_many({"user_id": target_user_id})

    result = await db[USERS].delete_one({"_id": ObjectId(target_user_id)})
    return result.deleted_count > 0


# ─── Departments ───────────────────────────────────────────────────

async def list_departments() -> list:
    db = get_db()
    cursor = db[DEPARTMENTS].find().sort("code", 1)
    docs = await cursor.to_list(length=500)
    return str_objectids(docs)


async def create_department(name: str, code: str) -> dict:
    db = get_db()
    name = name.strip()
    code = code.strip().upper()
    if not name or not code:
        raise ValueError("Name and code are required")
    existing = await db[DEPARTMENTS].find_one({"code": code})
    if existing:
        raise ValueError(f"Department with code '{code}' already exists")
    doc = {"name": name, "code": code, "created_at": utc_now()}
    result = await db[DEPARTMENTS].insert_one(doc)
    doc["_id"] = result.inserted_id
    return str_objectid(doc)


async def delete_department(dept_id: str) -> bool:
    db = get_db()
    result = await db[DEPARTMENTS].delete_one({"_id": ObjectId(dept_id)})
    return result.deleted_count > 0


# ─── App Settings (maintenance mode, etc.) ───────────────────────────────

async def get_app_setting(key: str, default=None):
    db = get_db()
    doc = await db[APP_SETTINGS].find_one({"key": key})
    if doc is None:
        return default
    return doc.get("value", default)


async def set_app_setting(key: str, value) -> None:
    db = get_db()
    await db[APP_SETTINGS].update_one(
        {"key": key},
        {"$set": {"key": key, "value": value, "updated_at": utc_now()}},
        upsert=True,
    )


async def get_maintenance_status() -> dict:
    enabled = await get_app_setting("maintenance_enabled", False)
    message = await get_app_setting("maintenance_message", "The platform is currently under maintenance. Please check back later.")
    return {"enabled": bool(enabled), "message": message}


async def set_maintenance_status(enabled: bool, message: str | None = None) -> dict:
    await set_app_setting("maintenance_enabled", enabled)
    if message is not None:
        await set_app_setting("maintenance_message", message)
    return await get_maintenance_status()


async def get_joining_years() -> list:
    years = await get_app_setting("joining_years", None)
    if years is None:
        # Default: last 7 years as 2-digit strings
        from datetime import date
        current = date.today().year
        years = [str(y)[2:] for y in range(current - 6, current + 1)]
    return years


async def set_joining_years(years: list) -> list:
    cleaned = [str(y).strip() for y in years if str(y).strip()]
    await set_app_setting("joining_years", cleaned)
    return cleaned


# ─── Gemini Keys ───

async def add_gemini_key(key: str, description: str = None) -> dict:
    db = get_db()
    key = (key or "").strip()
    if not key:
        raise ValueError("API Key is required")
    # Clean check
    existing = await db[GEMINI_KEYS].find_one({"key": key})
    if existing:
        raise ValueError("This API Key already exists in the database")

    doc = {
        "key": key,
        "description": description,
        "is_active": True,
        "created_at": utc_now(),
        "updated_at": utc_now(),
    }
    result = await db[GEMINI_KEYS].insert_one(doc)
    doc["_id"] = result.inserted_id

    # Notify key pool of change
    from utils.gemini import reload_key_pool
    await reload_key_pool()

    # Mask key for return value
    doc["key"] = key[:10] + "..." + key[-10:] if len(key) > 20 else key
    return str_objectid(doc)


async def list_gemini_keys(mask_keys: bool = True) -> list:
    db = get_db()
    from database import get_redis
    redis = get_redis()
    cursor = db[GEMINI_KEYS].find().sort("created_at", -1)
    docs = await cursor.to_list(length=1000)
    
    import hashlib
    for doc in docs:
        key = doc.get("key") or ""
        key_id = hashlib.sha256(key.encode()).hexdigest()[:12]
        
        # Redis status
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
                
        doc["rate_limited"] = rate_limited
        doc["daily_limit_hit"] = daily_limit_hit
        doc["recovers_in_s"] = recovers_in_s
        
        if mask_keys and "key" in doc:
            doc["key"] = key[:10] + "..." + key[-10:] if len(key) > 20 else key
    return str_objectids(docs)



async def update_gemini_key(key_id: str, is_active: bool | None = None, description: str | None = None) -> dict:
    db = get_db()
    update_data = {}
    if is_active is not None:
        update_data["is_active"] = is_active
    if description is not None:
        update_data["description"] = description

    if not update_data:
        raise ValueError("No fields to update")

    update_data["updated_at"] = utc_now()
    await db[GEMINI_KEYS].update_one({"_id": ObjectId(key_id)}, {"$set": update_data})
    doc = await db[GEMINI_KEYS].find_one({"_id": ObjectId(key_id)})
    if not doc:
        raise ValueError("Gemini key not found")

    # Notify key pool of change
    from utils.gemini import reload_key_pool
    await reload_key_pool()

    if "key" in doc:
        key = doc["key"]
        doc["key"] = key[:10] + "..." + key[-10:] if len(key) > 20 else key
    return str_objectid(doc)


async def delete_gemini_key(key_id: str) -> bool:
    db = get_db()
    result = await db[GEMINI_KEYS].delete_one({"_id": ObjectId(key_id)})
    if result.deleted_count > 0:
        # Notify key pool of change
        from utils.gemini import reload_key_pool
        await reload_key_pool()
        return True
    return False

