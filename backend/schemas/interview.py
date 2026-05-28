from pydantic import BaseModel
from typing import Optional, List, Dict


class StartInterviewRequest(BaseModel):
    role_id: Optional[str] = None
    custom_role: Optional[str] = None
    interview_type: Optional[str] = "resume"
    topic_id: Optional[str] = None
    job_description_id: Optional[str] = None


class VerifyResumeJdRequest(BaseModel):
    role_id: Optional[str] = None
    custom_role: Optional[str] = None
    job_description_id: str


class SubmitAnswerRequest(BaseModel):
    session_id: str
    question_id: str
    answer: str


class QuitInterviewRequest(BaseModel):
    session_id: str


class InterviewQuestion(BaseModel):
    question_id: str
    question: str
    difficulty: str = "medium"
    question_number: int = 1
    total_questions: int = 10


class InterviewStartResponse(BaseModel):
    session_id: str
    question: InterviewQuestion
    message: str = "Interview started"


class AnswerResponse(BaseModel):
    session_id: str
    next_question: Optional[InterviewQuestion] = None
    is_complete: bool = False
    message: str = ""


class QuitInterviewResponse(BaseModel):
    session_id: str
    report_generated: bool = False
    message: str = ""


class QuestionScore(BaseModel):
    question: str
    answer: str
    score: int
    feedback: str


class InterviewReport(BaseModel):
    session_id: str
    overall_score: int
    total_questions: int
    strengths: List[str]
    weaknesses: List[str]
    detailed_scores: List[QuestionScore]
    recommendations: List[str]
    completed_at: str
