from fastapi import APIRouter, Depends
from auth.jwt import get_current_user
from services.analytics_service import get_student_history

router = APIRouter()


@router.get("/history")
async def get_reports_history(current_user: dict = Depends(get_current_user)):
    """Get student's interview history."""
    history = await get_student_history(current_user["user_id"])
    return {"reports": history}
