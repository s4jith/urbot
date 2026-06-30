import json
import csv
import io
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from auth.jwt import require_role, get_current_user
from schemas.admin import (
    JobRoleCreate, JobRoleUpdate,
    QuestionCreate, QuestionUpdate, QuestionBatchCreate,
    RoleRequirementCreate,
    TopicCreate, TopicUpdate, TopicPublishUpdate,
    GroupTestCreate, GroupTestUpdate, GroupTestPublishUpdate,
    ChatbotQueryRequest, ChatbotExportRequest, ChatbotStudentUpdate,
    DepartmentCreate, MaintenanceModeUpdate, JoiningYearsUpdate,
    GeminiKeyCreate, GeminiKeyUpdate,
)
from services.admin_service import (
    create_role, update_role, delete_role, list_roles,
    create_question, update_question, delete_question, list_questions, get_question_by_id,
    create_topic, list_topics, update_topic, delete_topic, set_topic_publish_status,
    import_questions_from_pdf,
    create_requirement, list_requirements, delete_requirement,
    list_quit_interviews, list_admin_reports, get_admin_report_detail,
    list_admin_users, delete_admin_user,
    list_departments, create_department, delete_department,
    get_maintenance_status, set_maintenance_status,
    get_joining_years, set_joining_years,
    add_gemini_key, list_gemini_keys, update_gemini_key, delete_gemini_key,
)
from services.job_description_service import (
    create_job_description,
    list_admin_job_descriptions,
    update_admin_job_description,
    delete_admin_job_description,
    parse_jd_from_file,
)
from services.group_test_service import (
    create_group_test,
    list_group_tests,
    get_group_test,
    update_group_test,
    delete_group_test,
    set_group_test_publish,
    get_group_test_results_admin,
)
from services.analytics_service import get_admin_analytics

router = APIRouter()


# ─── Job Roles ───

@router.get("/roles")
async def get_roles(current_user: dict = Depends(get_current_user)):
    """List all job roles (accessible by all authenticated users for interview selection)."""
    roles = await list_roles()
    return {"roles": roles}


@router.post("/roles")
async def create_role_endpoint(
    request: JobRoleCreate,
    current_user: dict = Depends(require_role("admin")),
):
    """Create a new job role (admin only)."""
    result = await create_role(
        title=request.title,
        description=request.description,
        department=request.department,
    )
    return result


@router.put("/roles/{role_id}")
async def update_role_endpoint(
    role_id: str,
    request: JobRoleUpdate,
    current_user: dict = Depends(require_role("admin")),
):
    """Update a job role (admin only)."""
    try:
        result = await update_role(role_id, request.model_dump())
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/roles/{role_id}")
async def delete_role_endpoint(
    role_id: str,
    current_user: dict = Depends(require_role("admin")),
):
    """Delete a job role (admin only)."""
    success = await delete_role(role_id)
    if not success:
        raise HTTPException(status_code=404, detail="Role not found")
    return {"message": "Role deleted"}


# ─── Questions ───

@router.get("/questions")
async def get_questions(
    role_id: str = Query(None),
    topic_id: str = Query(None),
    interview_type: str = Query(None),
    difficulty: str = Query(None),
    current_user: dict = Depends(require_role("admin")),
):
    """List questions, optionally filtered by role."""
    questions = await list_questions(
        role_id=role_id,
        topic_id=topic_id,
        interview_type=interview_type,
        difficulty=difficulty,
    )
    return {"questions": questions}


@router.post("/questions")
async def create_question_endpoint(
    request: QuestionCreate,
    current_user: dict = Depends(require_role("admin")),
):
    """Create a new question (admin only)."""
    original_answer = request.original_answer
    compacted_answer = request.compacted_answer
    expected_answer = request.expected_answer

    if original_answer and not compacted_answer:
        from utils.gemini import compact_answer_with_llm
        try:
            compacted_answer = await compact_answer_with_llm(original_answer)
            expected_answer = compacted_answer
        except Exception as e:
            # fallback to original if LLM fails
            compacted_answer = original_answer
            expected_answer = original_answer

    result = await create_question(
        role_id=request.role_id,
        topic_id=request.topic_id,
        interview_type=request.interview_type,
        question=request.question,
        difficulty=request.difficulty,
        category=request.category,
        subtopic=request.subtopic,
        expected_answer=expected_answer or request.expected_answer,
        original_answer=original_answer,
        compacted_answer=compacted_answer,
    )
    return result


@router.post("/questions/batch")
async def create_questions_batch_endpoint(
    request: QuestionBatchCreate,
    current_user: dict = Depends(require_role("admin")),
):
    """Create a batch of questions (admin only)."""
    inserted_count = 0
    for q in request.questions:
        t_id = q.topic_id or request.topic_id
        r_id = q.role_id or request.role_id
        await create_question(
            role_id=r_id,
            topic_id=t_id,
            interview_type=q.interview_type,
            question=q.question,
            difficulty=q.difficulty,
            category=q.category,
            subtopic=q.subtopic,
            expected_answer=q.expected_answer,
            original_answer=q.original_answer,
            compacted_answer=q.compacted_answer,
        )
        inserted_count += 1
    return {"inserted_count": inserted_count}


@router.get("/questions/{question_id}")
async def get_question_by_id_endpoint(
    question_id: str,
    current_user: dict = Depends(require_role("admin")),
):
    """Get one question by id (admin only)."""
    try:
        question = await get_question_by_id(question_id)
        return question
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/questions/upload")
async def upload_questions_file_endpoint(
    interview_type: str = Form("resume"),
    role_id: str | None = Form(None),
    topic_id: str | None = Form(None),
    subjects: str | None = Form(None),
    file: UploadFile = File(...),
    current_user: dict = Depends(require_role("admin")),
):
    """Upload a file (PDF, CSV, or Excel) and extract/parse interview questions and answers (admin only)."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    filename_lower = file.filename.lower()
    if not (filename_lower.endswith(".pdf") or filename_lower.endswith(".csv") or filename_lower.endswith(".xlsx") or filename_lower.endswith(".xls")):
        raise HTTPException(status_code=400, detail="Only PDF, CSV, and Excel (.xlsx, .xls) files are supported")

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Maximum 10MB")

    parsed_subjects = []
    if subjects:
        try:
            parsed_subjects = json.loads(subjects)
            if not isinstance(parsed_subjects, list):
                raise ValueError
        except Exception:
            parsed_subjects = [s.strip() for s in subjects.split(",") if s.strip()]

    # 1. Handle PDF
    if filename_lower.endswith(".pdf"):
        try:
            result = await import_questions_from_pdf(
                role_id=role_id,
                topic_id=topic_id,
                interview_type=interview_type,
                subjects=parsed_subjects,
                filename=file.filename,
                file_content=content,
            )
            return result
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to import questions from PDF: {str(e)}")

    # 2. Handle CSV or Excel
    rows = []
    if filename_lower.endswith(".csv"):
        try:
            text_content = content.decode("utf-8-sig")
        except Exception:
            try:
                text_content = content.decode("latin-1")
            except Exception:
                raise HTTPException(status_code=400, detail="Failed to decode file content")
        csv_reader = csv.reader(io.StringIO(text_content))
        rows = list(csv_reader)
    else:
        # Excel
        try:
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
            sheet = wb.active
            for r in sheet.iter_rows(values_only=True):
                rows.append(list(r))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse Excel file: {str(e)}")

    if not rows:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    start_idx = 0
    # Detect header
    if len(rows) > 0:
        first_row_str = "".join([str(col or "") for col in rows[0]]).lower()
        if "question" in first_row_str or "answer" in first_row_str or "subtopic" in first_row_str:
            start_idx = 1

    valid_rows = []
    for r in rows[start_idx:]:
        cleaned_row = [str(cell).strip() if cell is not None else "" for cell in r]
        non_empty = [c for c in cleaned_row if c]
        if len(non_empty) >= 2:
            valid_rows.append(cleaned_row)

    if not valid_rows:
        raise HTTPException(status_code=400, detail="No valid question/answer rows found in file")

    docs = []
    topic_name = ""
    if interview_type == "topic" and topic_id:
        from database import get_db
        from models.collections import TOPICS
        from bson import ObjectId
        db = get_db()
        topic_doc = await db[TOPICS].find_one({"_id": ObjectId(topic_id)})
        if topic_doc:
            topic_name = (topic_doc.get("name") or "").strip()

    from utils.gemini import compact_answer_with_llm
    from utils.helpers import utc_now

    for row in valid_rows:
        if len(row) >= 4:
            subtopic = row[0]
            q_text = row[1]
            ans_text = row[2]
            diff = row[3].lower()
        elif len(row) == 3:
            subtopic = row[0]
            q_text = row[1]
            ans_text = row[2]
            diff = "medium"
        else:
            subtopic = "General"
            q_text = row[0]
            ans_text = row[1]
            diff = "medium"

        if not q_text or not ans_text:
            continue

        if diff not in {"easy", "medium", "hard"}:
            diff = "medium"

        compacted = await compact_answer_with_llm(ans_text)

        docs.append({
            "role_id": role_id,
            "topic_id": topic_id,
            "interview_type": interview_type,
            "question": q_text,
            "difficulty": diff,
            "category": topic_name or "Technical",
            "subtopic": subtopic or "General",
            "original_answer": ans_text,
            "compacted_answer": compacted,
            "expected_answer": compacted,
            "source": "file_upload",
            "created_at": utc_now(),
        })

    return {
        "questions": docs,
        "subjects": parsed_subjects,
        "interview_type": interview_type,
        "topic_id": topic_id,
    }


@router.post("/questions/upload-csv")
async def upload_questions_csv_endpoint(
    topic_id: str = Form(...),
    file: UploadFile = File(...),
    current_user: dict = Depends(require_role("admin")),
):
    """Upload a CSV of questions and original answers, compact answers using LLM, and store in DB (admin only)."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Maximum 10MB")

    try:
        text_content = content.decode("utf-8-sig")
    except Exception:
        try:
            text_content = content.decode("latin-1")
        except Exception:
            raise HTTPException(status_code=400, detail="Failed to decode file content")

    csv_reader = csv.reader(io.StringIO(text_content))
    rows = list(csv_reader)
    if not rows:
        raise HTTPException(status_code=400, detail="CSV file is empty")

    valid_rows = []
    
    # Try to skip header if it contains words like 'question', 'answer'
    start_idx = 0
    if len(rows) > 0:
        first_row_str = "".join(rows[0]).lower()
        if "question" in first_row_str or "answer" in first_row_str:
            start_idx = 1

    for row in rows[start_idx:]:
        filtered_row = [col.strip() for col in row if col.strip()]
        if len(filtered_row) >= 2:
            valid_rows.append(row)

    if not valid_rows:
        raise HTTPException(status_code=400, detail="No valid question/answer rows found in CSV")

    imported_count = 0
    from utils.gemini import compact_answer_with_llm

    for row in valid_rows:
        category = None
        if len(row) >= 3:
            category = row[0].strip()
            question_text = row[1].strip()
            answer_text = row[2].strip()
        else:
            question_text = row[0].strip()
            answer_text = row[1].strip()

        if not question_text or not answer_text:
            continue

        # Call local LLM to compact the answer
        compacted = await compact_answer_with_llm(answer_text)

        await create_question(
            topic_id=topic_id,
            interview_type="topic",
            question=question_text,
            difficulty="medium",
            category=category or "Technical",
            subtopic=category or "General",
            expected_answer=compacted,
            original_answer=answer_text,
            compacted_answer=compacted
        )
        imported_count += 1

    return {"message": "CSV uploaded successfully", "imported_count": imported_count}


@router.put("/questions/{question_id}")
async def update_question_endpoint(
    question_id: str,
    request: QuestionUpdate,
    current_user: dict = Depends(require_role("admin")),
):
    """Update a question (admin only)."""
    try:
        result = await update_question(question_id, request.model_dump())
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/questions/{question_id}")
async def delete_question_endpoint(
    question_id: str,
    current_user: dict = Depends(require_role("admin")),
):
    """Delete a question (admin only)."""
    success = await delete_question(question_id)
    if not success:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"message": "Question deleted"}


# ─── Role Requirements ───

@router.get("/requirements/{role_id}")
async def get_requirements(
    role_id: str,
    current_user: dict = Depends(require_role("admin")),
):
    """List requirements for a role."""
    requirements = await list_requirements(role_id)
    return {"requirements": requirements}


# ─── Topics ───

@router.get("/topics")
async def get_topics(current_user: dict = Depends(get_current_user)):
    """List all topic categories (accessible by all authenticated users)."""
    only_published = current_user.get("role") != "admin"
    topics = await list_topics(only_published=only_published)
    return {"topics": topics}


@router.post("/topics")
async def create_topic_endpoint(
    request: TopicCreate,
    current_user: dict = Depends(require_role("admin")),
):
    """Create a topic category (admin only)."""
    try:
        result = await create_topic(name=request.name, description=request.description)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/topics/{topic_id}")
async def update_topic_endpoint(
    topic_id: str,
    request: TopicUpdate,
    current_user: dict = Depends(require_role("admin")),
):
    """Update a topic category (admin only)."""
    try:
        result = await update_topic(topic_id, request.model_dump())
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/topics/{topic_id}")
async def delete_topic_endpoint(
    topic_id: str,
    current_user: dict = Depends(require_role("admin")),
):
    """Delete a topic category and its topic questions (admin only)."""
    success = await delete_topic(topic_id)
    if not success:
        raise HTTPException(status_code=404, detail="Topic not found")
    return {"message": "Topic deleted"}


@router.put("/topics/{topic_id}/publish")
async def publish_topic_endpoint(
    topic_id: str,
    request: TopicPublishUpdate,
    current_user: dict = Depends(require_role("admin")),
):
    """Publish/unpublish a topic for student interview selection (admin only)."""
    try:
        result = await set_topic_publish_status(
            topic_id,
            request.is_published,
            timer_enabled=request.timer_enabled,
            timer_seconds=request.timer_seconds,
        )
        return result
    except ValueError as e:
        detail = str(e)
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail)


@router.post("/requirements")
async def create_requirement_endpoint(
    request: RoleRequirementCreate,
    current_user: dict = Depends(require_role("admin")),
):
    """Create a role requirement (admin only)."""
    result = await create_requirement(
        role_id=request.role_id,
        skill=request.skill,
        level=request.level,
    )
    return result


@router.delete("/requirements/{req_id}")
async def delete_requirement_endpoint(
    req_id: str,
    current_user: dict = Depends(require_role("admin")),
):
    """Delete a role requirement (admin only)."""
    success = await delete_requirement(req_id)
    if not success:
        raise HTTPException(status_code=404, detail="Requirement not found")
    return {"message": "Requirement deleted"}


# ─── Analytics ───

@router.get("/analytics")
async def get_analytics(
    current_user: dict = Depends(require_role("admin")),
):
    """Get admin analytics dashboard data."""
    analytics = await get_admin_analytics()
    return analytics


@router.get("/quit-interviews")
async def get_quit_interviews(
    limit: int = Query(100, ge=1, le=500),
    current_user: dict = Depends(require_role("admin")),
):
    """Get full details about interviews quit by users."""
    items = await list_quit_interviews(limit=limit)
    return {"items": items}


@router.get("/reports")
async def get_admin_reports(
    limit: int = Query(100, ge=1, le=500),
    current_user: dict = Depends(require_role("admin")),
):
    """Get all interview report summaries for admin."""
    items = await list_admin_reports(limit=limit)
    return {"items": items}


@router.get("/reports/{session_id}")
async def get_admin_report_by_session(
    session_id: str,
    current_user: dict = Depends(require_role("admin")),
):
    """Get full report details for a specific interview session (admin only)."""
    try:
        item = await get_admin_report_detail(session_id=session_id)
        return item
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/users")
async def get_admin_users(
    limit: int = Query(100, ge=1, le=500),
    skip: int = Query(0, ge=0),
    current_user: dict = Depends(require_role("admin")),
):
    """List users for admin management. Use skip/limit for pagination."""
    items = await list_admin_users(limit=limit, skip=skip)
    return {"items": items, "limit": limit, "skip": skip}


@router.get("/job-descriptions")
async def get_admin_job_descriptions(
    owner_user_id: str = Query(None),
    current_user: dict = Depends(require_role("admin")),
):
    """List job descriptions for admin management."""
    items = await list_admin_job_descriptions(owner_user_id=owner_user_id)
    return {"items": items}


@router.post("/job-descriptions")
async def create_admin_job_description_endpoint(
    request_data: dict,
    current_user: dict = Depends(require_role("admin")),
):
    """Create a job description as admin."""
    try:
        item = await create_job_description(
            user_id=current_user["user_id"],
            owner_role="admin",
            title=request_data.get("title"),
            company=request_data.get("company"),
            description=request_data.get("description"),
            required_skills=request_data.get("required_skills"),
        )
        return item
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/job-descriptions/{jd_id}")
async def update_admin_job_description_endpoint(
    jd_id: str,
    request_data: dict,
    current_user: dict = Depends(require_role("admin")),
):
    """Update any job description (admin only)."""
    try:
        item = await update_admin_job_description(jd_id, request_data)
        return item
    except ValueError as e:
        status_code = 404 if "not found" in str(e).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(e))


@router.delete("/job-descriptions/{jd_id}")
async def delete_admin_job_description_endpoint(
    jd_id: str,
    current_user: dict = Depends(require_role("admin")),
):
    """Delete any job description (admin only)."""
    success = await delete_admin_job_description(jd_id)
    if not success:
        raise HTTPException(status_code=404, detail="Job description not found")
    return {"message": "Job description deleted"}


@router.post("/job-descriptions/parse-file")
async def parse_admin_jd_file(
    file: UploadFile = File(...),
    current_user: dict = Depends(require_role("admin")),
):
    """Upload a JD file (PDF/DOCX/TXT) and extract structured fields via AI (admin only)."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    allowed_ext = {".pdf", ".doc", ".docx", ".txt"}
    ext = "." + file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in allowed_ext:
        raise HTTPException(status_code=400, detail="Unsupported file type. Allowed: PDF, DOC, DOCX, TXT")

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Maximum 10MB")

    try:
        result = await parse_jd_from_file(file.filename, content)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse JD file: {str(e)}")


@router.delete("/users/{user_id}")
async def delete_admin_user_endpoint(
    user_id: str,
    current_user: dict = Depends(require_role("admin")),
):
    """Delete a student user and related records (admin only)."""
    try:
        success = await delete_admin_user(user_id, current_user["user_id"])
        if not success:
            raise HTTPException(status_code=404, detail="User not found")
        return {"message": "User deleted"}
    except ValueError as e:
        detail = str(e)
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail)


# ─── Group Tests ─────────────────────────────────────────────────────────────

@router.get("/group-tests")
async def list_group_tests_endpoint(
    current_user: dict = Depends(require_role("admin")),
):
    items = await list_group_tests(only_published=False)
    return {"items": items}


@router.post("/group-tests")
async def create_group_test_endpoint(
    request: GroupTestCreate,
    current_user: dict = Depends(require_role("admin")),
):
    try:
        result = await create_group_test(
            name=request.name,
            description=request.description,
            jd_id=request.jd_id,
            topic_ids=request.topic_ids,
            time_limit_minutes=request.time_limit_minutes,
            max_attempts=request.max_attempts,
            created_by=current_user["user_id"],
            allowed_years=request.allowed_years,
            allowed_dept_codes=request.allowed_dept_codes,
            allowed_user_ids=request.allowed_user_ids,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/group-tests/{group_test_id}")
async def get_group_test_endpoint(
    group_test_id: str,
    current_user: dict = Depends(require_role("admin")),
):
    try:
        return await get_group_test(group_test_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.put("/group-tests/{group_test_id}")
async def update_group_test_endpoint(
    group_test_id: str,
    request: GroupTestUpdate,
    current_user: dict = Depends(require_role("admin")),
):
    try:
        return await update_group_test(group_test_id, request.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/group-tests/{group_test_id}")
async def delete_group_test_endpoint(
    group_test_id: str,
    current_user: dict = Depends(require_role("admin")),
):
    success = await delete_group_test(group_test_id)
    if not success:
        raise HTTPException(status_code=404, detail="Group test not found")
    return {"message": "Group test deleted"}


@router.patch("/group-tests/{group_test_id}/publish")
async def publish_group_test_endpoint(
    group_test_id: str,
    request: GroupTestPublishUpdate,
    current_user: dict = Depends(require_role("admin")),
):
    try:
        return await set_group_test_publish(group_test_id, request.is_published)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/group-tests/{group_test_id}/results")
async def get_group_test_results_endpoint(
    group_test_id: str,
    current_user: dict = Depends(require_role("admin")),
):
    results = await get_group_test_results_admin(group_test_id)
    return {"items": results}


# ─── Chatbot ──────────────────────────────────────────────────────────────────
from services.chatbot_service import (
    process_chatbot_query,
    update_student_info,
    generate_excel,
    filter_students_structured,
)
from schemas.admin import StudentFilterRequest, StudentFilterExportRequest


@router.post("/students/filter")
async def students_filter(
    request: StudentFilterRequest,
    current_user: dict = Depends(require_role("admin")),
):
    """Structured student filter — no AI, direct params (sort + date range + multi-test)."""
    try:
        result = await filter_students_structured(
            group_test_ids=request.group_test_ids,
            jd_id=request.jd_id,
            start_date=request.start_date,
            end_date=request.end_date,
            top_k=request.top_k,
            min_score=request.min_score,
            sort_fields=request.sort_fields,
            sort_orders=request.sort_orders,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/students/export-excel")
async def students_export_excel(
    request: StudentFilterExportRequest,
    current_user: dict = Depends(require_role("admin")),
):
    """Generate styled Excel for structured student filter results."""
    try:
        bio = generate_excel(
            rows=request.rows,
            topic_columns=request.topic_columns,
            group_test_name=request.group_test_name,
        )
        safe_name = request.group_test_name.replace(" ", "_").replace("/", "-")[:40]
        filename = f"{safe_name}_students.xlsx"
        return StreamingResponse(
            bio,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/students")
async def update_student(
    request: ChatbotStudentUpdate,
    current_user: dict = Depends(require_role("admin")),
):
    """Admin corrects a student's reg_no or name (shared by both filter endpoints)."""
    try:
        return await update_student_info(request.user_id, request.reg_no, request.name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/chatbot/query")
async def chatbot_query(
    request: ChatbotQueryRequest,
    current_user: dict = Depends(require_role("admin")),
):
    """AI-powered student filter — returns ranked student rows."""
    try:
        result = await process_chatbot_query(request.query, request.jd_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chatbot/export-excel")
async def chatbot_export_excel(
    request: ChatbotExportRequest,
    current_user: dict = Depends(require_role("admin")),
):
    """Generate styled Excel (.xlsx) from current chatbot result rows."""
    try:
        bio = generate_excel(
            rows=request.rows,
            topic_columns=request.topic_columns,
            group_test_name=request.group_test_name,
        )
        safe_name = request.group_test_name.replace(" ", "_").replace("/", "-")[:40]
        filename = f"{safe_name}_students.xlsx"
        return StreamingResponse(
            bio,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/chatbot/students")
async def chatbot_update_student(
    request: ChatbotStudentUpdate,
    current_user: dict = Depends(require_role("admin")),
):
    """Admin corrects a student's reg_no or name."""
    try:
        return await update_student_info(request.user_id, request.reg_no, request.name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─── Departments ──────────────────────────────────────────────────────────────

@router.get("/departments")
async def list_departments_endpoint(
    current_user: dict = Depends(require_role("admin")),
):
    items = await list_departments()
    return {"items": items}


@router.post("/departments")
async def create_department_endpoint(
    request: DepartmentCreate,
    current_user: dict = Depends(require_role("admin")),
):
    try:
        return await create_department(name=request.name, code=request.code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/departments/{dept_id}")
async def delete_department_endpoint(
    dept_id: str,
    current_user: dict = Depends(require_role("admin")),
):
    success = await delete_department(dept_id)
    if not success:
        raise HTTPException(status_code=404, detail="Department not found")
    return {"message": "Deleted"}


# ─── App Settings ───────────────────────────────────────────────────────────

@router.get("/settings/maintenance")
async def get_maintenance_endpoint(
    current_user: dict = Depends(require_role("admin")),
):
    return await get_maintenance_status()


@router.patch("/settings/maintenance")
async def set_maintenance_endpoint(
    request: MaintenanceModeUpdate,
    current_user: dict = Depends(require_role("admin")),
):
    return await set_maintenance_status(enabled=request.enabled, message=request.message)


@router.get("/settings/joining-years")
async def get_joining_years_endpoint(
    current_user: dict = Depends(require_role("admin")),
):
    years = await get_joining_years()
    return {"years": years}


@router.put("/settings/joining-years")
async def set_joining_years_endpoint(
    request: JoiningYearsUpdate,
    current_user: dict = Depends(require_role("admin")),
):
    years = await set_joining_years(request.years)
    return {"years": years}


# ─── Gemini Keys ───

@router.post("/gemini-keys")
async def add_gemini_key_endpoint(
    request: GeminiKeyCreate,
    current_user: dict = Depends(require_role("admin")),
):
    try:
        result = await add_gemini_key(key=request.key, description=request.description)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/gemini-keys")
async def list_gemini_keys_endpoint(
    current_user: dict = Depends(require_role("admin")),
):
    keys = await list_gemini_keys()
    return {"keys": keys}


@router.patch("/gemini-keys/{key_id}")
async def update_gemini_key_endpoint(
    key_id: str,
    request: GeminiKeyUpdate,
    current_user: dict = Depends(require_role("admin")),
):
    try:
        result = await update_gemini_key(
            key_id=key_id,
            is_active=request.is_active,
            description=request.description,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/gemini-keys/{key_id}")
async def delete_gemini_key_endpoint(
    key_id: str,
    current_user: dict = Depends(require_role("admin")),
):
    success = await delete_gemini_key(key_id)
    if not success:
        raise HTTPException(status_code=404, detail="Gemini API Key not found")
    return {"message": "Gemini API Key deleted"}

