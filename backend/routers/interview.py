from fastapi import APIRouter, Depends, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from auth.jwt import get_current_user
from schemas.interview import (
    StartInterviewRequest,
    VerifyResumeJdRequest,
    SubmitAnswerRequest,
    QuitInterviewRequest,
    InterviewStartResponse,
    AnswerResponse,
)
from services.interview_service import (
    start_interview,
    verify_resume_job_description,
    submit_answer,
    get_next_question,
    quit_interview,
)
from services.evaluation_service import generate_report
from services.latency_service import get_latency_metrics, reset_latency_metrics

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


@router.post("/start")
@limiter.limit("10/minute")
async def start_interview_endpoint(
    request: Request,
    body: StartInterviewRequest,
    current_user: dict = Depends(get_current_user),
):
    """Start a new interview session."""
    try:
        result = await start_interview(
            user_id=current_user["user_id"],
            role_id=body.role_id,
            custom_role=body.custom_role,
            interview_type=body.interview_type,
            topic_id=body.topic_id,
            job_description_id=body.job_description_id,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/start_interview")
@limiter.limit("10/minute")
async def start_interview_compat_endpoint(
    request: Request,
    body: StartInterviewRequest,
    current_user: dict = Depends(get_current_user),
):
    """Compatibility endpoint aligned with alternate API naming."""
    try:
        result = await start_interview(
            user_id=current_user["user_id"],
            role_id=body.role_id,
            custom_role=body.custom_role,
            interview_type=body.interview_type,
            topic_id=body.topic_id,
            job_description_id=body.job_description_id,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/verify")
async def verify_resume_job_description_endpoint(
    request: VerifyResumeJdRequest,
    current_user: dict = Depends(get_current_user),
):
    """Verify resume vs selected job description before starting interview."""
    try:
        result = await verify_resume_job_description(
            user_id=current_user["user_id"],
            role_id=request.role_id,
            custom_role=request.custom_role,
            job_description_id=request.job_description_id,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/answer")
@limiter.limit("30/minute")
async def submit_answer_endpoint(
    request: Request,
    body: SubmitAnswerRequest,
    current_user: dict = Depends(get_current_user),
):
    """Submit an answer and get next question."""
    try:
        result = await submit_answer(
            session_id=body.session_id,
            question_id=body.question_id,
            answer=body.answer,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/submit_answer")
@limiter.limit("30/minute")
async def submit_answer_compat_endpoint(
    request: Request,
    body: SubmitAnswerRequest,
    current_user: dict = Depends(get_current_user),
):
    """Compatibility endpoint aligned with alternate API naming."""
    try:
        result = await submit_answer(
            session_id=body.session_id,
            question_id=body.question_id,
            answer=body.answer,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/next_question")
async def get_next_question_endpoint(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Preview next queued question without modifying answer state."""
    try:
        result = await get_next_question(
            session_id=session_id,
            user_id=current_user["user_id"],
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/quit")
async def quit_interview_endpoint(
    request: QuitInterviewRequest,
    current_user: dict = Depends(get_current_user),
):
    """Quit an in-progress interview and generate a partial report if answers exist."""
    try:
        quit_result = await quit_interview(
            session_id=request.session_id,
            user_id=current_user["user_id"],
        )

        report = None
        if quit_result.get("report_generated"):
            report = await generate_report(
                session_id=request.session_id,
                user_id=current_user["user_id"],
            )

        return {
            "session_id": request.session_id,
            "report_generated": bool(report),
            "report": report,
            "message": quit_result.get("message", "Interview quit"),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/latency")
async def interview_latency_metrics(
    sample_size: int = 500,
    current_user: dict = Depends(get_current_user),
):
    """Get STT/submit/Gemini latency metrics with p50 and p95."""
    _ = current_user
    return await get_latency_metrics(sample_size=sample_size)


@router.post("/latency/reset")
async def reset_interview_latency_metrics(
    current_user: dict = Depends(get_current_user),
):
    """Reset latency metric samples to start a fresh before/after comparison."""
    _ = current_user
    return await reset_latency_metrics()


@router.get("/report")
async def get_interview_report(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Generate and retrieve interview report."""
    try:
        result = await generate_report(
            session_id=session_id,
            user_id=current_user["user_id"],
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
