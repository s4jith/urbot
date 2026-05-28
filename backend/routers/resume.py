from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from auth.jwt import get_current_user
from services.resume_service import upload_and_parse_resume

router = APIRouter()


@router.post("/upload")
async def upload_resume(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Upload and parse a resume using Gemini AI."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    allowed_types = [
        "application/pdf",
    ]

    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{file.content_type}'. Allowed: PDF Only.",
        )

    content = await file.read()
    if len(content) > 5 * 1024 * 1024:  # 5MB limit
        raise HTTPException(status_code=400, detail="File too large. Maximum 5MB.")

    try:
        result = await upload_and_parse_resume(
            user_id=current_user["user_id"],
            filename=file.filename,
            file_content=content,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process resume: {str(e)}")
