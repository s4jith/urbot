import { InterviewReport } from "./interview";

export interface AdminQuestion {
  id: string;
  role_id?: string;
  topic_id?: string;
  interview_type?: "resume" | "topic";
  question: string;
  difficulty: "easy" | "medium" | "hard";
  category?: string;
  subtopic?: string;
  expected_answer?: string;
  original_answer?: string;
  compacted_answer?: string;
}

export interface TopPerformer {
  student_id: string;
  name: string;
  avg_score: number;
  interview_count: number;
}

export interface AdminAnalytics {
  total_students: number;
  live_users: number;
  new_users_today: number;
  total_interviews: number;
  average_score: number;
  top_performers: TopPerformer[];
  common_weak_areas: string[];
}

export interface AdminQuitInterview {
  session_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  role_title: string;
  status: string;
  quit_reason: string;
  answered_count: number;
  max_questions: number;
  quit_at: string;
  quit_day?: string | null;
  quit_date?: string | null;
  quit_time?: string | null;
  report_generated: boolean;
  overall_score?: number | null;
  total_questions_evaluated?: number;
  strengths?: string[];
  weaknesses?: string[];
  recommendations?: string[];
}

export interface AdminReportSummary {
  session_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  role_title: string;
  overall_score: number;
  total_questions: number;
  completed_at: string;
  session_status: string;
  is_quit: boolean;
  generation_stats?: {
    gemini_calls?: number;
    gemini_questions?: number;
    bank_questions?: number;
    bank_shortfall?: number;
    generation_batches?: number;
  };
}

export type Difficulty = "easy" | "medium" | "hard";
export type EntryMode = "manual" | "pdf";

export interface QuestionLite {
  topic_id?: string;
}

export interface AdminReportDetail extends InterviewReport {
  id?: string;
  user_id: string;
  user_name: string;
  user_email: string;
  session_status?: string;
  is_quit?: boolean;
  quit_at?: string | null;
  generation_stats?: {
    gemini_calls?: number;
    gemini_questions?: number;
    bank_questions?: number;
    bank_shortfall?: number;
    generation_batches?: number;
  };
}

// ─── Group Tests ─────────────────────────────────────────────────────────────

export interface GroupTestTopic {
  id: string;
  name: string;
}

export interface GroupTest {
  id: string;
  name: string;
  description?: string | null;
  jd_id?: string | null;
  topic_ids: string[];
  topics: GroupTestTopic[];
  time_limit_minutes?: number | null;
  max_attempts: number;
  is_published: boolean;
  created_by: string;
  created_at: string;
  allowed_years?: string[] | null;
  allowed_dept_codes?: string[] | null;
  allowed_user_ids?: string[] | null;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  created_at: string;
}

export interface GroupTestTopicResult {
  topic_id: string;
  topic_name: string;
  session_id?: string | null;
  status: "pending" | "in_progress" | "completed";
  overall_score?: number | null;
  total_questions?: number | null;
  completed_at?: string | null;
}

export interface GroupTestResult {
  id: string;
  group_test_id: string;
  group_test_name: string;
  user_id: string;
  user_name: string;
  user_email: string;
  attempt_number: number;
  topic_results: GroupTestTopicResult[];
  overall_score?: number | null;
  status: "in_progress" | "completed";
  started_at: string;
  completed_at?: string | null;
  time_limit_minutes?: number | null;
}

