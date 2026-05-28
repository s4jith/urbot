from fastapi import APIRouter, Depends, HTTPException
from auth.jwt import get_current_user
from database import get_db
from models.collections import USERS, RESUMES, SKILLS
from utils.helpers import str_objectid
from utils.skills import normalize_skill_list, cluster_skills
from bson import ObjectId
from services.job_description_service import (
    list_admin_job_descriptions,
    parse_jd_from_file,
)
from services.group_test_service import (
    list_group_tests,
    get_group_test,
    start_group_test_attempt,
    get_group_test_result,
    link_topic_session,
    get_my_group_test_results,
    get_my_group_test_attempt,
)
from fastapi import UploadFile, File

router = APIRouter()


@router.get("")
async def get_profile(current_user: dict = Depends(get_current_user)):
    """Get current user's profile with skills and resume info."""
    db = get_db()

    user = await db[USERS].find_one({"_id": ObjectId(current_user["user_id"])})
    if not user:
        # Fallback: try finding by email
        user = await db[USERS].find_one({"email": current_user["email"]})

    profile = {
        "user_id": current_user["user_id"],
        "name": current_user.get("name", ""),
        "email": current_user.get("email", ""),
        "role": current_user.get("role", "student"),
        "speech_settings": {
            "voice_gender": (user or {}).get("speech_settings", {}).get("voice_gender", "female"),
        },
        "reg_no": (user or {}).get("reg_no") or None,
    }

    # Get resume info
    resume = await db[RESUMES].find_one({"user_id": current_user["user_id"]})
    if resume:
        profile["resume"] = {
            "filename": resume.get("original_filename", ""),
            "uploaded_at": resume.get("uploaded_at", ""),
            "parsed_text": resume.get("parsed_text", ""),
            "parsed_data": resume.get("parsed_data", {}),
        }
    else:
        profile["resume"] = None

    # Get skills
    skills_doc = await db[SKILLS].find_one({"user_id": current_user["user_id"]})
    profile["skills"] = skills_doc.get("skills", []) if skills_doc else []
    profile["clustered_skills"] = cluster_skills(profile["skills"])

    return profile


@router.put("/speech-settings")
async def update_speech_settings(
    request_data: dict,
    current_user: dict = Depends(get_current_user),
):
    """Update user's speech assistant preferences."""
    db = get_db()
    voice_gender = (request_data.get("voice_gender") or "female").strip().lower()
    if voice_gender not in {"male", "female", "auto"}:
        raise HTTPException(status_code=400, detail="voice_gender must be one of: male, female, auto")

    await db[USERS].update_one(
        {"_id": ObjectId(current_user["user_id"])},
        {"$set": {"speech_settings.voice_gender": voice_gender}},
    )
    return {
        "message": "Speech settings updated successfully",
        "speech_settings": {"voice_gender": voice_gender},
    }

@router.put("/skills")
async def update_user_skills(
    request_data: dict,  # Or use UpdateSkillsRequest if imported
    current_user: dict = Depends(get_current_user)
):
    """Update the current user's extracted skills."""
    db = get_db()
    skills = normalize_skill_list(request_data.get("skills", []))
    
    # Upsert the skills document for this user
    await db[SKILLS].update_one(
        {"user_id": current_user["user_id"]},
        {"$set": {"skills": skills, "user_id": current_user["user_id"]}},
        upsert=True
    )
    
    return {"message": "Skills updated successfully", "skills": skills}


@router.put("/resume-data")
async def update_resume_data(
    request_data: dict, 
    current_user: dict = Depends(get_current_user)
):
    """Update the detailed parsed data of the user's resume."""
    db = get_db()
    parsed_data = request_data.get("parsed_data", {})
    
    # Update only the parsed_data property inside the RESUMES collection
    result = await db[RESUMES].update_one(
        {"user_id": current_user["user_id"]},
        {"$set": {"parsed_data": parsed_data}}
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Resume not found. Upload a resume first.")

    return {"message": "Resume details updated successfully", "parsed_data": parsed_data}


@router.get("/job-descriptions")
async def get_my_job_descriptions(
    current_user: dict = Depends(get_current_user),
):
    """List job descriptions (returns admin-created job descriptions for all users)."""
    items = await list_admin_job_descriptions()
    return {"items": items}


@router.post("/job-descriptions")
async def create_my_job_description(
    request_data: dict,
    current_user: dict = Depends(get_current_user),
):
    """Disabled: Job descriptions can only be created by administrators."""
    raise HTTPException(status_code=403, detail="Job descriptions can only be created by administrators.")


@router.put("/job-descriptions/{jd_id}")
async def update_my_job_description_endpoint(
    jd_id: str,
    request_data: dict,
    current_user: dict = Depends(get_current_user),
):
    """Disabled: Job descriptions can only be updated by administrators."""
    raise HTTPException(status_code=403, detail="Job descriptions can only be updated by administrators.")


@router.delete("/job-descriptions/{jd_id}")
async def delete_my_job_description_endpoint(
    jd_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Disabled: Job descriptions can only be deleted by administrators."""
    raise HTTPException(status_code=403, detail="Job descriptions can only be deleted by administrators.")


@router.post("/job-descriptions/parse-file")
async def parse_jd_file_for_user(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Disabled: Job description parsing is restricted to administrators."""
    raise HTTPException(status_code=403, detail="Job description parsing is restricted to administrators.")


# ─── Group Tests (student) ───────────────────────────────────────────────────

@router.get("/group-tests")
async def list_available_group_tests(
    current_user: dict = Depends(get_current_user),
):
    """List published group tests available to students (filtered by reg_no if restrictions set)."""
    db = get_db()
    user_doc = await db[USERS].find_one({"_id": ObjectId(current_user["user_id"])})
    reg_no = (user_doc or {}).get("reg_no") or None
    items = await list_group_tests(only_published=True, user_reg_no=reg_no, user_id=current_user["user_id"])
    return {"items": items}


@router.get("/group-tests/my-results")
async def my_group_test_results(
    current_user: dict = Depends(get_current_user),
):
    """List all group test results for the current student."""
    items = await get_my_group_test_results(current_user["user_id"])
    return {"items": items}


@router.post("/group-tests/{group_test_id}/start")
async def start_group_test(
    group_test_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Start a new attempt for a group test."""
    try:
        result = await start_group_test_attempt(group_test_id, current_user["user_id"])
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/group-tests/{group_test_id}/my-attempt")
async def get_my_attempt(
    group_test_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get student's latest attempt at a group test."""
    result = await get_my_group_test_attempt(group_test_id, current_user["user_id"])
    return result  # may be None


@router.get("/group-tests/results/{result_id}")
async def get_result_detail(
    result_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get full detail of a group test result."""
    try:
        return await get_group_test_result(result_id, current_user["user_id"])
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/group-tests/results/{result_id}/link-topic")
async def link_topic_to_result(
    result_id: str,
    request_data: dict,
    current_user: dict = Depends(get_current_user),
):
    """Link a completed interview session to a topic inside a group test result."""
    topic_id = (request_data.get("topic_id") or "").strip()
    session_id = (request_data.get("session_id") or "").strip()
    if not topic_id or not session_id:
        raise HTTPException(status_code=400, detail="topic_id and session_id are required")
    try:
        return await link_topic_session(result_id, current_user["user_id"], topic_id, session_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
