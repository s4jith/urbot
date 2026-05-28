import os
import re
import aiofiles
from database import get_db
from models.collections import RESUMES, SKILLS, USERS
from utils.helpers import utc_now, str_objectid
from utils.gemini import parse_resume_with_gemini
from utils.resume_text import extract_resume_text
from utils.skills import normalize_skill_list
from config import get_settings
from bson import ObjectId

settings = get_settings()

# Expected filename format: {12 digits}_{name}.{ext}
_RESUME_FILENAME_RE = re.compile(r'^(\d{12})_(.+)\.(pdf|doc|docx|txt)$', re.IGNORECASE)


def extract_reg_no_from_filename(filename: str) -> str | None:
    """Return the 12-digit register number from the filename, or None if format is invalid."""
    m = _RESUME_FILENAME_RE.match(filename or "")
    return m.group(1) if m else None


async def upload_and_parse_resume(user_id: str, filename: str, file_content: bytes) -> dict:
    """Upload resume file, parse with Gemini, extract skills.

    Filename must match: {12_digit_reg_no}_{name}.{ext}
    """
    db = get_db()

    # ── Validate filename format ──────────────────────────────────────────────
    reg_no = extract_reg_no_from_filename(filename)
    if reg_no is None:
        raise ValueError(
            "Invalid filename format. Resume filename must start with your 12-digit register number "
            "followed by an underscore and your name. "
            "Example: 714023200122_Name.pdf"
        )

    # ── Check reg_no uniqueness ───────────────────────────────────────────────
    # Allow the same user to re-upload (same reg_no), but block if another user already holds it.
    existing_owner = await db[USERS].find_one(
        {"reg_no": reg_no, "_id": {"$ne": ObjectId(user_id)}}
    )
    if existing_owner:
        raise ValueError(
            "This register number is already associated with another account. "
            "Each student must use their own unique register number."
        )

    # Save file locally
    safe_filename = f"{user_id}_{filename}"
    file_path = os.path.join(settings.UPLOAD_DIR, safe_filename)

    async with aiofiles.open(file_path, "wb") as f:
        await f.write(file_content)

    # Extract readable text by file type before sending to Gemini.
    resume_text = extract_resume_text(filename, file_content)

    # Parse with Gemini
    parsed_data = await parse_resume_with_gemini(resume_text)
    raw_skills = parsed_data.get("skills", [])
    skills = normalize_skill_list(raw_skills)
    parsed_data["skills"] = skills

    # Upsert resume document
    resume_doc = {
        "user_id": user_id,
        "filename": safe_filename,
        "original_filename": filename,
        "file_path": file_path,
        "parsed_text": parsed_data.get("experience_summary", ""),
        "parsed_data": parsed_data,
        "reg_no": reg_no,
        "uploaded_at": utc_now(),
    }

    await db[RESUMES].update_one(
        {"user_id": user_id},
        {"$set": resume_doc},
        upsert=True,
    )

    # Persist reg_no on the user document for quick lookup and admin display
    await db[USERS].update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"reg_no": reg_no}},
    )

    # Upsert skills
    await db[SKILLS].update_one(
        {"user_id": user_id},
        {"$set": {
            "user_id": user_id,
            "skills": skills,
            "raw_skills": raw_skills,
            "updated_at": utc_now(),
        }},
        upsert=True,
    )

    result = await db[RESUMES].find_one({"user_id": user_id})
    return {
        "id": str(result["_id"]),
        "user_id": user_id,
        "filename": filename,
        "parsed_text": resume_doc["parsed_text"],
        "skills": skills,
        "reg_no": reg_no,
        "uploaded_at": resume_doc["uploaded_at"],
    }


async def get_user_skills(user_id: str) -> list:
    """Get extracted skills for a user."""
    db = get_db()
    skills_doc = await db[SKILLS].find_one({"user_id": user_id})
    if skills_doc:
        return skills_doc.get("skills", [])
    return []
