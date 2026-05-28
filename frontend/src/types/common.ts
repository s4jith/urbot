export interface Topic {
  id: string;
  name: string;
  description?: string;
  is_published?: boolean;
  timer_enabled?: boolean;
  timer_seconds?: number | null;
}

export interface JobRole {
  id: string;
  title: string;
  description: string;
  department?: string;
}

export interface JobDescription {
  id: string;
  user_id: string;
  owner_role: "student" | "admin";
  title: string;
  company?: string | null;
  description: string;
  required_skills?: string[];
  created_at: string;
  updated_at: string;
}

export interface JobDescriptionAlignment {
  meeting_expectations: string[];
  missing_expectations: string[];
  improvement_suggestions: string[];
  fit_summary: string;
}
