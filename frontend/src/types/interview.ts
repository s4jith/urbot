export type PracticeStep = "intro" | "playing" | "recording" | "review" | "report";

export interface InterviewQuestion {
  question_id: string;
  question: string;
  difficulty: string;
  question_number: number;
  total_questions: number;
}

export interface InterviewStartResponse {
  session_id: string;
  question: InterviewQuestion;
  message: string;
  job_description_id?: string;
}

export interface AnswerResponse {
  session_id: string;
  next_question?: InterviewQuestion;
  is_complete: boolean;
  message: string;
}

export interface InterviewReport {
  session_id: string;
  student_id?: string;
  role_id?: string;
  role_title?: string;
  overall_score: number;
  total_questions: number;
  strengths: string[];
  weaknesses: string[];
  detailed_scores: {
    question: string;
    answer: string;
    score: number;
    feedback: string;
  }[];
  recommendations: string[];
  completed_at: string;
}

export interface ReportHistoryItem {
  session_id: string;
  role_title: string;
  overall_score: number;
  completed_at: string;
  total_questions: number;
}
