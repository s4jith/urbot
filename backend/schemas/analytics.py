from pydantic import BaseModel
from typing import List, Optional, Dict


class StudentAnalytics(BaseModel):
    user_id: str
    name: str
    email: str
    total_interviews: int
    average_score: float
    best_score: int
    worst_score: int
    weak_topics: List[str]
    strong_topics: List[str]


class OverallAnalytics(BaseModel):
    total_students: int
    total_interviews: int
    average_score: float
    top_performers: List[Dict]
    common_weak_areas: List[str]


class ReportHistory(BaseModel):
    session_id: str
    overall_score: int
    total_questions: int
    completed_at: str
    role_title: Optional[str] = None
