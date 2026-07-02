from pydantic import BaseModel
from typing import Optional, List, Dict, Any


class StartInterviewRequest(BaseModel):
    role_id: Optional[str] = None
    custom_role: Optional[str] = None
    interview_type: Optional[str] = "resume"
    topic_id: Optional[str] = None
    job_description_id: Optional[str] = None
    difficulty: Optional[str] = "medium"


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
    technical_score: Optional[int] = None
    grammatical_score: Optional[int] = None
    total_questions: int
    strengths: List[str]
    weaknesses: List[str]
    detailed_scores: List[QuestionScore]
    recommendations: List[str]
    difficulty_distribution: Optional[Dict[str, int]] = None
    subtopic_scores: Optional[Dict[str, int]] = None
    strongest_subtopics: Optional[List[str]] = None
    weakest_subtopics: Optional[List[str]] = None
    coverage_percentage: Optional[int] = None
    recommended_learning_path: Optional[List[str]] = None
    completed_at: str
    performance_level: Optional[str] = None
    hiring_recommendation: Optional[str] = None
    interview_duration: Optional[str] = None
    questions_attempted: Optional[int] = None
    questions_answered: Optional[int] = None
    topic_scores: Optional[Dict[str, int]] = None
    communication_analysis: Optional[Dict[str, Any]] = None
    learning_roadmap: Optional[List[Dict[str, Any]]] = None
    hiring_simulation: Optional[Dict[str, Any]] = None
    progression: Optional[Dict[str, Any]] = None
    history: Optional[List[Dict[str, Any]]] = None
    tab_switches: Optional[int] = 0

