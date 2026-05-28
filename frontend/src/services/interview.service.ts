import api from "@/lib/api";
import { InterviewQuestion, InterviewStartResponse, AnswerResponse, InterviewReport } from "@/types";

export const interviewService = {
  startInterview: async (interviewType: string = "resume"): Promise<InterviewStartResponse> => {
    const { data } = await api.post("/interview/start", { interview_type: interviewType });
    return data;
  },

  submitAnswer: async (sessionId: string, questionId: string, answer: string): Promise<AnswerResponse> => {
    const { data } = await api.post("/interview/answer", {
      session_id: sessionId,
      question_id: questionId,
      answer: answer,
    });
    return data;
  },

  getReport: async (sessionId: string): Promise<InterviewReport> => {
    const { data } = await api.get(`/interview/report?session_id=${sessionId}`);
    return data;
  },
};
