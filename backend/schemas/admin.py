from pydantic import BaseModel
from typing import Optional, List


class JobRoleCreate(BaseModel):
    title: str
    description: str
    department: Optional[str] = None


class JobRoleUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    department: Optional[str] = None


class JobRoleResponse(BaseModel):
    id: str
    title: str
    description: str
    department: Optional[str] = None
    created_at: str


class QuestionCreate(BaseModel):
    role_id: Optional[str] = None
    topic_id: Optional[str] = None
    interview_type: str = "resume"
    question: str
    difficulty: str = "medium"
    category: Optional[str] = None
    expected_answer: Optional[str] = None


class QuestionUpdate(BaseModel):
    question: Optional[str] = None
    difficulty: Optional[str] = None
    category: Optional[str] = None
    expected_answer: Optional[str] = None


class QuestionResponse(BaseModel):
    id: str
    role_id: Optional[str] = None
    topic_id: Optional[str] = None
    interview_type: str = "resume"
    question: str
    difficulty: str
    category: Optional[str] = None
    created_at: str


class TopicCreate(BaseModel):
    name: str
    description: Optional[str] = None


class TopicUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class TopicPublishUpdate(BaseModel):
    is_published: bool
    timer_enabled: Optional[bool] = None
    timer_seconds: Optional[int] = None


class TopicResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    created_at: str


class RoleRequirementCreate(BaseModel):
    role_id: str
    skill: str
    level: str = "intermediate"


class GroupTestCreate(BaseModel):
    name: str
    description: Optional[str] = None
    jd_id: Optional[str] = None
    topic_ids: List[str]
    time_limit_minutes: Optional[int] = None
    max_attempts: int = 1
    allowed_years: Optional[List[str]] = None
    allowed_dept_codes: Optional[List[str]] = None
    allowed_user_ids: Optional[List[str]] = None


class GroupTestUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    jd_id: Optional[str] = None
    topic_ids: Optional[List[str]] = None
    time_limit_minutes: Optional[int] = None
    max_attempts: Optional[int] = None
    allowed_years: Optional[List[str]] = None
    allowed_dept_codes: Optional[List[str]] = None
    allowed_user_ids: Optional[List[str]] = None


class GroupTestPublishUpdate(BaseModel):
    is_published: bool


class LinkTopicSessionRequest(BaseModel):
    topic_id: str
    session_id: str


class RoleRequirementResponse(BaseModel):
    id: str
    role_id: str
    skill: str
    level: str


# ── Department ───────────────────────────────────────────────────────────────

class DepartmentCreate(BaseModel):
    name: str
    code: str  # e.g. "243"


# ── App Settings ─────────────────────────────────────────────────────────────

class MaintenanceModeUpdate(BaseModel):
    enabled: bool
    message: Optional[str] = None


class JoiningYearsUpdate(BaseModel):
    years: List[str]  # e.g. ["20", "21", "22"]


# ── Chatbot (legacy) ──────────────────────────────────────────────────────────

class ChatbotQueryRequest(BaseModel):
    query: str
    jd_id: Optional[str] = None


class ChatbotExportRequest(BaseModel):
    rows: List[dict]
    topic_columns: List[dict]
    group_test_name: str


class ChatbotStudentUpdate(BaseModel):
    user_id: str
    reg_no: Optional[str] = None
    name: Optional[str] = None


# ── Structured Student Filter ─────────────────────────────────────────────────

class StudentFilterRequest(BaseModel):
    group_test_ids: Optional[List[str]] = None   # None = all tests
    jd_id: Optional[str] = None
    start_date: Optional[str] = None             # "YYYY-MM-DD"
    end_date: Optional[str] = None               # "YYYY-MM-DD"
    top_k: Optional[int] = None
    min_score: Optional[float] = None
    sort_fields: List[str] = ["time"]            # ordered priority: "time"|"score"|"duration"
    sort_orders: List[str] = ["desc"]            # matching orders: "asc"|"desc"


class StudentFilterExportRequest(BaseModel):
    rows: List[dict]
    topic_columns: List[dict]
    group_test_name: str


class GeminiKeyCreate(BaseModel):
    key: str
    description: Optional[str] = None


class GeminiKeyUpdate(BaseModel):
    is_active: Optional[bool] = None
    description: Optional[str] = None

