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
  technical_score?: number | null;
  grammatical_score?: number | null;
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
  difficulty_distribution?: Record<string, number> | null;
  subtopic_scores?: Record<string, number> | null;
  strongest_subtopics?: string[] | null;
  weakest_subtopics?: string[] | null;
  coverage_percentage?: number | null;
  recommended_learning_path?: string[] | null;
  performance_level?: string | null;
  hiring_recommendation?: string | null;
  interview_duration?: string | null;
  questions_attempted?: number | null;
  questions_answered?: number | null;
  topic_scores?: Record<string, number> | null;
  communication_analysis?: {
    speaking_speed_wpm: number;
    average_response_delay: number;
    filler_word_count: number;
    speech_confidence_score: number;
    recommendations: string[];
  } | null;
  learning_roadmap?: {
    subtopic: string;
    recommendations: string[];
  }[] | null;
  hiring_simulation?: {
    role: string;
    recommendation: string;
    confidence: number;
    reasoning: string;
  } | null;
  progression?: {
    score_trend: number[];
    confidence_trend: number[];
    topic_mastery_trend: number[];
    labels: string[];
    history_metrics?: {
      score_improvement: number;
      weakness_fixed: string[];
      new_weaknesses: string[];
    } | null;
  } | null;
  history?: {
    session_id: string;
    overall_score: number;
    completed_at: string;
    role_title: string;
  }[] | null;
  tab_switches?: number;
  completed_at: string;
}

export interface ReportHistoryItem {
  session_id: string;
  role_title: string;
  overall_score: number;
  completed_at: string;
  total_questions: number;
}

