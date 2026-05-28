from bson import ObjectId

from database import get_db
from models.collections import JOB_DESCRIPTIONS
from utils.helpers import utc_now, str_objectid, str_objectids
from utils.resume_text import extract_resume_text
from utils.gemini import parse_jd_with_gemini


def _normalize_required_skills(required_skills):
    items = required_skills or []
    if not isinstance(items, list):
        return []
    seen = set()
    output = []
    for raw in items:
        skill = (raw or "").strip()
        if not skill:
            continue
        key = skill.lower()
        if key in seen:
            continue
        seen.add(key)
        output.append(skill)
    return output


def _build_update_data(data: dict) -> dict:
    update_data = {}
    if "title" in data:
        title = (data.get("title") or "").strip()
        if not title:
            raise ValueError("title is required")
        update_data["title"] = title

    if "company" in data:
        update_data["company"] = (data.get("company") or "").strip() or None

    if "description" in data:
        description = (data.get("description") or "").strip()
        if not description:
            raise ValueError("description is required")
        update_data["description"] = description

    if "required_skills" in data:
        update_data["required_skills"] = _normalize_required_skills(data.get("required_skills"))

    if not update_data:
        raise ValueError("No fields to update")

    update_data["updated_at"] = utc_now()
    return update_data


async def create_job_description(
    user_id: str,
    owner_role: str,
    title: str,
    description: str,
    company: str | None = None,
    required_skills: list[str] | None = None,
) -> dict:
    db = get_db()

    title = (title or "").strip()
    description = (description or "").strip()
    if not title:
        raise ValueError("title is required")
    if not description:
        raise ValueError("description is required")

    doc = {
        "user_id": user_id,
        "owner_role": owner_role if owner_role in {"student", "admin"} else "student",
        "title": title,
        "company": (company or "").strip() or None,
        "description": description,
        "required_skills": _normalize_required_skills(required_skills),
        "created_at": utc_now(),
        "updated_at": utc_now(),
    }
    result = await db[JOB_DESCRIPTIONS].insert_one(doc)
    doc["_id"] = result.inserted_id
    return str_objectid(doc)


async def list_my_job_descriptions(user_id: str) -> list:
    db = get_db()
    docs = await db[JOB_DESCRIPTIONS].find({"user_id": user_id}).sort("updated_at", -1).to_list(length=300)
    return str_objectids(docs)


async def update_my_job_description(user_id: str, jd_id: str, data: dict) -> dict:
    db = get_db()
    try:
        oid = ObjectId(jd_id)
    except Exception as exc:
        raise ValueError("Invalid job description id") from exc

    existing = await db[JOB_DESCRIPTIONS].find_one({"_id": oid, "user_id": user_id})
    if not existing:
        raise ValueError("Job description not found")

    update_data = _build_update_data(data)
    await db[JOB_DESCRIPTIONS].update_one({"_id": oid}, {"$set": update_data})
    updated = await db[JOB_DESCRIPTIONS].find_one({"_id": oid})
    return str_objectid(updated)


async def delete_my_job_description(user_id: str, jd_id: str) -> bool:
    db = get_db()
    try:
        oid = ObjectId(jd_id)
    except Exception:
        return False
    result = await db[JOB_DESCRIPTIONS].delete_one({"_id": oid, "user_id": user_id})
    return result.deleted_count > 0


async def list_admin_job_descriptions(owner_user_id: str | None = None) -> list:
    db = get_db()
    query = {"user_id": owner_user_id} if owner_user_id else {}
    docs = await db[JOB_DESCRIPTIONS].find(query).sort("updated_at", -1).to_list(length=1000)
    return str_objectids(docs)


async def update_admin_job_description(jd_id: str, data: dict) -> dict:
    db = get_db()
    try:
        oid = ObjectId(jd_id)
    except Exception as exc:
        raise ValueError("Invalid job description id") from exc

    existing = await db[JOB_DESCRIPTIONS].find_one({"_id": oid})
    if not existing:
        raise ValueError("Job description not found")

    update_data = _build_update_data(data)
    await db[JOB_DESCRIPTIONS].update_one({"_id": oid}, {"$set": update_data})
    updated = await db[JOB_DESCRIPTIONS].find_one({"_id": oid})
    return str_objectid(updated)


async def delete_admin_job_description(jd_id: str) -> bool:
    db = get_db()
    try:
        oid = ObjectId(jd_id)
    except Exception:
        return False
    result = await db[JOB_DESCRIPTIONS].delete_one({"_id": oid})
    return result.deleted_count > 0


async def get_job_description_for_user(user_id: str, jd_id: str) -> dict:
    db = get_db()
    try:
        oid = ObjectId(jd_id)
    except Exception as exc:
        raise ValueError("Invalid job description id") from exc

    doc = await db[JOB_DESCRIPTIONS].find_one({"_id": oid, "user_id": user_id})
    if not doc:
        raise ValueError("Job description not found")
    return str_objectid(doc)


async def parse_jd_from_file(filename: str, file_content: bytes) -> dict:
    """Extract text from an uploaded JD file and use AI to parse it into structured fields."""
    text = extract_resume_text(filename, file_content)
    if not text or len(text.strip()) < 20:
        raise ValueError("Could not extract readable text from the uploaded file")
    return await parse_jd_with_gemini(text)
