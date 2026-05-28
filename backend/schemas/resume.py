from pydantic import BaseModel
from typing import Optional, List


class ResumeResponse(BaseModel):
    id: str
    user_id: str
    filename: str
    parsed_text: Optional[str] = None
    skills: List[str] = []
    uploaded_at: str

class UpdateSkillsRequest(BaseModel):
    skills: List[str]

class ParsedDataPayload(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    recommended_roles: Optional[List[str]] = []
    experience_summary: Optional[str] = None
    experience: Optional[List[dict]] = []
    education: Optional[List[dict]] = []
    projects: Optional[List[dict]] = []

class UpdateResumeDataRequest(BaseModel):
    parsed_data: ParsedDataPayload
