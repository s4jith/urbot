"use client";

import { useEffect, useState, useCallback } from "react";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import {
  ClipboardCheck,
  Check,
  Trash2,
  HelpCircle,
  Loader2,
  Edit,
  AlertCircle,
  FileCheck,
} from "lucide-react";
import { toast } from "sonner";

// --- Types ---
interface PendingAnswer {
  id: string;
  user_answer: string;
  llm_suggested_score: number;
  llm_suggested_feedback: string;
}

interface PendingQuestion {
  question_id: string;
  question_text: string;
  original_answer: string;
  compacted_answer: string;
  answers: PendingAnswer[];
}

interface ApprovedAnswer {
  id: string;
  user_answer: string;
  score: number;
  feedback: string;
}

interface ApprovedQuestion {
  question_id: string;
  question_text: string;
  original_answer: string;
  compacted_answer: string;
  answers: ApprovedAnswer[];
}

interface TopicGroup<Q> {
  questions: Q[];
}

interface TopicsData<Q> {
  [topicName: string]: TopicGroup<Q>;
}

export default function EvaluationsPage() {
  const [activeTab, setActiveTab] = useState<"unchecked" | "checked">("unchecked");
  const [pendingTopics, setPendingTopics] = useState<TopicsData<PendingQuestion>>({});
  const [approvedTopics, setApprovedTopics] = useState<TopicsData<ApprovedQuestion>>({});
  const [loading, setLoading] = useState(true);

  // States to keep track of edit values for pending and approved answers
  const [pendingEdits, setPendingEdits] = useState<{
    [ansId: string]: { score: number; feedback: string };
  }>({});

  const [approvedEdits, setApprovedEdits] = useState<{
    [ansId: string]: { score: number; feedback: string };
  }>({});

  const [activeEditingApprovedIds, setActiveEditingApprovedIds] = useState<string[]>([]);

  // Action states
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null);

  // --- Fetchers ---
  const fetchPending = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/pending-evaluations");
      const topicsData = data.topics || {};
      setPendingTopics(topicsData);

      const initialEdits: typeof pendingEdits = {};
      Object.values(topicsData).forEach((topic: any) => {
        topic.questions.forEach((q: PendingQuestion) => {
          q.answers.forEach((ans: PendingAnswer) => {
            initialEdits[ans.id] = {
              score: ans.llm_suggested_score ?? 50,
              feedback: ans.llm_suggested_feedback ?? "",
            };
          });
        });
      });
      setPendingEdits(initialEdits);
    } catch {
      toast.error("Failed to load unchecked answers");
    }
  }, []);

  const fetchApproved = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/approved-evaluations");
      const topicsData = data.topics || {};
      setApprovedTopics(topicsData);

      const initialEdits: typeof approvedEdits = {};
      Object.values(topicsData).forEach((topic: any) => {
        topic.questions.forEach((q: ApprovedQuestion) => {
          q.answers.forEach((ans: ApprovedAnswer) => {
            initialEdits[ans.id] = {
              score: ans.score ?? 50,
              feedback: ans.feedback ?? "",
            };
          });
        });
      });
      setApprovedEdits(initialEdits);
      setActiveEditingApprovedIds([]);
    } catch {
      toast.error("Failed to load checked answers");
    }
  }, []);

  const reloadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchPending(), fetchApproved()]);
    setLoading(false);
  }, [fetchPending, fetchApproved]);

  useEffect(() => {
    reloadAll();
  }, [reloadAll]);

  // --- Pending (Unchecked) Actions ---
  const handlePendingEditChange = (ansId: string, field: "score" | "feedback", value: any) => {
    setPendingEdits((prev) => ({
      ...prev,
      [ansId]: { ...prev[ansId], [field]: value },
    }));
  };

  const handleApprove = async (ansId: string) => {
    const edits = pendingEdits[ansId];
    if (!edits) return;

    if (edits.score < 0 || edits.score > 100) {
      toast.error("Score must be between 0 and 100");
      return;
    }

    setActionInProgressId(ansId);
    try {
      await api.post(`/admin/pending-evaluations/${ansId}/approve`, {
        score: edits.score,
        feedback: edits.feedback,
      });
      toast.success("Answer approved and stored in database!");
      await reloadAll();
    } catch {
      toast.error("Failed to approve answer");
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleDismiss = async (ansId: string) => {
    if (!confirm("Are you sure you want to dismiss this unchecked answer?")) return;

    setActionInProgressId(ansId);
    try {
      await api.delete(`/admin/pending-evaluations/${ansId}`);
      toast.success("Answer dismissed.");
      await reloadAll();
    } catch {
      toast.error("Failed to dismiss answer");
    } finally {
      setActionInProgressId(null);
    }
  };

  // --- Approved (Checked) Actions ---
  const handleApprovedEditChange = (ansId: string, field: "score" | "feedback", value: any) => {
    setApprovedEdits((prev) => ({
      ...prev,
      [ansId]: { ...prev[ansId], [field]: value },
    }));
  };

  const toggleEditingApproved = (ansId: string) => {
    if (activeEditingApprovedIds.includes(ansId)) {
      setActiveEditingApprovedIds((prev) => prev.filter((id) => id !== ansId));
    } else {
      setActiveEditingApprovedIds((prev) => [...prev, ansId]);
    }
  };

  const handleUpdateApproved = async (ansId: string) => {
    const edits = approvedEdits[ansId];
    if (!edits) return;

    if (edits.score < 0 || edits.score > 100) {
      toast.error("Score must be between 0 and 100");
      return;
    }

    setActionInProgressId(ansId);
    try {
      await api.put(`/admin/approved-evaluations/${ansId}`, {
        score: edits.score,
        feedback: edits.feedback,
      });
      toast.success("Corrected evaluation updated successfully!");
      setActiveEditingApprovedIds((prev) => prev.filter((id) => id !== ansId));
      await reloadAll();
    } catch {
      toast.error("Failed to update evaluation");
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleDeleteApproved = async (ansId: string) => {
    if (!confirm("Are you sure you want to delete this checked answer? Future matching candidate answers will fall back to LLM evaluation.")) return;

    setActionInProgressId(ansId);
    try {
      await api.delete(`/admin/approved-evaluations/${ansId}`);
      toast.success("Corrected evaluation deleted.");
      await reloadAll();
    } catch {
      toast.error("Failed to delete evaluation");
    } finally {
      setActionInProgressId(null);
    }
  };

  // --- Count Helpers ---
  const totalPendingCount = Object.values(pendingTopics).reduce(
    (acc, topic) => acc + topic.questions.reduce((qAcc, q) => qAcc + q.answers.length, 0),
    0
  );

  const totalApprovedCount = Object.values(approvedTopics).reduce(
    (acc, topic) => acc + topic.questions.reduce((qAcc, q) => qAcc + q.answers.length, 0),
    0
  );

  return (
    <ProtectedRoute requiredRole="admin">
      <Navbar />
      <main className="app-page-shell md:pt-8 md:ml-[var(--admin-sidebar-width,250px)]">
        <div className="animate-fade-in max-w-6xl mx-auto px-4 pb-12">
          
          {/* Page Heading */}
          <div className="app-page-heading mb-4">
            <ClipboardCheck className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold">Evaluation Answers</h1>
          </div>

          <p className="text-sm text-muted-foreground mb-6">
            Review and manage unique candidate answers. Unchecked answers are generated by the LLM and wait for admin approval. Checked answers are gold-standard benchmarks used to instantly match and grade future student responses.
          </p>

          {/* Custom Navigation Tabs */}
          <div className="flex border-b border-border mb-6">
            <button
              onClick={() => setActiveTab("unchecked")}
              className={`px-5 py-3 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === "unchecked"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <AlertCircle className="w-4 h-4" />
              Unchecked Answers
              {totalPendingCount > 0 && (
                <span className="px-2 py-0.5 text-xs rounded-full bg-primary/20 text-primary">
                  {totalPendingCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("checked")}
              className={`px-5 py-3 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === "checked"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileCheck className="w-4 h-4" />
              Checked Answers
              {totalApprovedCount > 0 && (
                <span className="px-2 py-0.5 text-xs rounded-full bg-green-500/20 text-green-600 dark:text-green-400">
                  {totalApprovedCount}
                </span>
              )}
            </button>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 className="w-10 h-10 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground animate-pulse">Loading evaluations...</p>
            </div>
          ) : (
            <div className="animate-fade-in-soft">
              
              {/* --- Unchecked Tab --- */}
              {activeTab === "unchecked" && (
                totalPendingCount === 0 ? (
                  <div className="app-empty-state py-16 text-center border-2 border-dashed border-border rounded-xl bg-card">
                    <ClipboardCheck className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-1">All Caught Up!</h3>
                    <p className="text-sm text-muted-foreground">
                      No candidate answers are currently pending manual evaluation.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {Object.entries(pendingTopics).map(([topicName, topicGroup]) => {
                      const topicPendingCount = topicGroup.questions.reduce((acc, q) => acc + q.answers.length, 0);
                      if (topicPendingCount === 0) return null;

                      return (
                        <div key={topicName} className="space-y-4">
                          <div className="flex items-center gap-2 border-b border-border pb-2">
                            <h2 className="text-lg font-bold text-foreground">{topicName}</h2>
                            <span className="px-2 py-0.5 text-xs font-medium rounded-md bg-secondary text-secondary-foreground">
                              {topicPendingCount} answers
                            </span>
                          </div>

                          <div className="space-y-6">
                            {topicGroup.questions.map((question) => {
                              if (question.answers.length === 0) return null;

                              return (
                                <div
                                  key={question.question_id}
                                  className="bg-card border border-border rounded-xl shadow-sm overflow-hidden"
                                >
                                  {/* Question detail */}
                                  <div className="bg-muted/30 p-5 border-b border-border">
                                    <div className="flex gap-3">
                                      <HelpCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                                      <div className="space-y-3">
                                        <h3 className="font-semibold text-base text-card-foreground">
                                          {question.question_text}
                                        </h3>
                                        
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                                          {question.original_answer && (
                                            <div className="bg-background/60 p-3.5 rounded-lg border border-border/60">
                                              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                                                Original reference answer
                                              </p>
                                              <p className="text-sm text-card-foreground line-clamp-3 hover:line-clamp-none transition-all duration-300">
                                                {question.original_answer}
                                              </p>
                                            </div>
                                          )}
                                          {question.compacted_answer && (
                                            <div className="bg-primary/5 p-3.5 rounded-lg border border-primary/10">
                                              <p className="text-xs font-bold text-primary uppercase tracking-wider mb-1">
                                                Compacted benchmark answer
                                              </p>
                                              <p className="text-sm text-card-foreground line-clamp-3 hover:line-clamp-none transition-all duration-300">
                                                {question.compacted_answer}
                                              </p>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Candidate submissions */}
                                  <div className="divide-y divide-border">
                                    {question.answers.map((answer) => {
                                      const currentEdits = pendingEdits[answer.id] || { score: 50, feedback: "" };

                                      return (
                                        <div key={answer.id} className="p-5 hover:bg-muted/10 transition-colors">
                                          <div className="space-y-4">
                                            <div>
                                              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                                                Candidate's Answer
                                              </p>
                                              <blockquote className="border-l-2 border-primary/40 pl-4 py-1.5 text-sm text-card-foreground italic bg-muted/20 rounded-r-md">
                                                "{answer.user_answer}"
                                              </blockquote>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-start pt-2">
                                              <div className="md:col-span-1">
                                                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                                                  Evaluation Score (0-100)
                                                </label>
                                                <input
                                                  type="number"
                                                  min="0"
                                                  max="100"
                                                  value={currentEdits.score}
                                                  onChange={(e) =>
                                                    handlePendingEditChange(answer.id, "score", parseInt(e.target.value) || 0)
                                                  }
                                                  className="app-control w-full font-semibold text-lg"
                                                />
                                                {answer.llm_suggested_score !== undefined && (
                                                  <span className="text-[10px] text-muted-foreground mt-1 block">
                                                    Suggested by AI: {answer.llm_suggested_score}
                                                  </span>
                                                )}
                                              </div>

                                              <div className="md:col-span-3">
                                                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                                                  Evaluation Feedback
                                                </label>
                                                <textarea
                                                  value={currentEdits.feedback}
                                                  onChange={(e) =>
                                                    handlePendingEditChange(answer.id, "feedback", e.target.value)
                                                  }
                                                  className="app-control w-full min-h-[56px] py-2 resize-y text-sm"
                                                  placeholder="Write brief feedback explaining the score..."
                                                />
                                              </div>
                                            </div>

                                            <div className="flex items-center justify-end gap-3 pt-2 border-t border-border/40">
                                              <button
                                                onClick={() => handleDismiss(answer.id)}
                                                disabled={actionInProgressId !== null}
                                                className="cursor-pointer flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
                                              >
                                                {actionInProgressId === answer.id ? (
                                                  <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                  <Trash2 className="w-4 h-4" />
                                                )}
                                                Dismiss
                                              </button>
                                              <button
                                                onClick={() => handleApprove(answer.id)}
                                                disabled={actionInProgressId !== null}
                                                className="cursor-pointer flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-primary hover:bg-primary/95 text-primary-foreground shadow-sm disabled:opacity-50 transition-colors"
                                              >
                                                {actionInProgressId === answer.id ? (
                                                  <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                  <Check className="w-4 h-4" />
                                                )}
                                                Approve & Save
                                              </button>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              )}

              {/* --- Checked Tab --- */}
              {activeTab === "checked" && (
                totalApprovedCount === 0 ? (
                  <div className="app-empty-state py-16 text-center border-2 border-dashed border-border rounded-xl bg-card">
                    <FileCheck className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-1">No Benchmarks</h3>
                    <p className="text-sm text-muted-foreground">
                      No candidate answers have been approved and saved to the database yet.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {Object.entries(approvedTopics).map(([topicName, topicGroup]) => {
                      const topicApprovedCount = topicGroup.questions.reduce((acc, q) => acc + q.answers.length, 0);
                      if (topicApprovedCount === 0) return null;

                      return (
                        <div key={topicName} className="space-y-4">
                          <div className="flex items-center gap-2 border-b border-border pb-2">
                            <h2 className="text-lg font-bold text-foreground">{topicName}</h2>
                            <span className="px-2 py-0.5 text-xs font-medium rounded-md bg-secondary text-secondary-foreground">
                              {topicApprovedCount} benchmarks
                            </span>
                          </div>

                          <div className="space-y-6">
                            {topicGroup.questions.map((question) => {
                              if (question.answers.length === 0) return null;

                              return (
                                <div
                                  key={question.question_id}
                                  className="bg-card border border-border rounded-xl shadow-sm overflow-hidden"
                                >
                                  {/* Question details */}
                                  <div className="bg-muted/30 p-5 border-b border-border">
                                    <div className="flex gap-3">
                                      <HelpCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                                      <div className="space-y-3">
                                        <h3 className="font-semibold text-base text-card-foreground">
                                          {question.question_text}
                                        </h3>
                                        
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                                          {question.original_answer && (
                                            <div className="bg-background/60 p-3.5 rounded-lg border border-border/60">
                                              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                                                Original reference answer
                                              </p>
                                              <p className="text-sm text-card-foreground line-clamp-3 hover:line-clamp-none transition-all duration-300">
                                                {question.original_answer}
                                              </p>
                                            </div>
                                          )}
                                          {question.compacted_answer && (
                                            <div className="bg-primary/5 p-3.5 rounded-lg border border-primary/10">
                                              <p className="text-xs font-bold text-primary uppercase tracking-wider mb-1">
                                                Compacted benchmark answer
                                              </p>
                                              <p className="text-sm text-card-foreground line-clamp-3 hover:line-clamp-none transition-all duration-300">
                                                {question.compacted_answer}
                                              </p>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Submissions */}
                                  <div className="divide-y divide-border">
                                    {question.answers.map((answer) => {
                                      const currentEdits = approvedEdits[answer.id] || { score: 50, feedback: "" };
                                      const isEditing = activeEditingApprovedIds.includes(answer.id);

                                      return (
                                        <div key={answer.id} className="p-5 hover:bg-muted/10 transition-colors">
                                          <div className="space-y-4">
                                            <div>
                                              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                                                Approved Candidate Answer Match
                                              </p>
                                              <blockquote className="border-l-2 border-green-500/40 pl-4 py-1.5 text-sm text-card-foreground italic bg-green-500/5 rounded-r-md">
                                                "{answer.user_answer}"
                                              </blockquote>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-start pt-2">
                                              <div className="md:col-span-1">
                                                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                                                  Evaluation Score (0-100)
                                                </label>
                                                <input
                                                  type="number"
                                                  min="0"
                                                  max="100"
                                                  disabled={!isEditing}
                                                  value={currentEdits.score}
                                                  onChange={(e) =>
                                                    handleApprovedEditChange(answer.id, "score", parseInt(e.target.value) || 0)
                                                  }
                                                  className={`app-control w-full font-semibold text-lg ${
                                                    !isEditing ? "opacity-75 bg-muted cursor-not-allowed" : ""
                                                  }`}
                                                />
                                              </div>

                                              <div className="md:col-span-3">
                                                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                                                  Evaluation Feedback
                                                </label>
                                                <textarea
                                                  value={currentEdits.feedback}
                                                  disabled={!isEditing}
                                                  onChange={(e) =>
                                                    handleApprovedEditChange(answer.id, "feedback", e.target.value)
                                                  }
                                                  className={`app-control w-full min-h-[56px] py-2 resize-y text-sm ${
                                                    !isEditing ? "opacity-75 bg-muted cursor-not-allowed" : ""
                                                  }`}
                                                  placeholder="Write brief feedback explaining the score..."
                                                />
                                              </div>
                                            </div>

                                            <div className="flex items-center justify-end gap-3 pt-2 border-t border-border/40">
                                              <button
                                                onClick={() => handleDeleteApproved(answer.id)}
                                                disabled={actionInProgressId !== null}
                                                className="cursor-pointer flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
                                              >
                                                {actionInProgressId === answer.id ? (
                                                  <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                  <Trash2 className="w-4 h-4" />
                                                )}
                                                Delete
                                              </button>
                                              
                                              {!isEditing ? (
                                                <button
                                                  onClick={() => toggleEditingApproved(answer.id)}
                                                  className="cursor-pointer flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border border-border bg-background hover:bg-muted text-foreground transition-colors"
                                                >
                                                  <Edit className="w-4 h-4" />
                                                  Edit Score/Feedback
                                                </button>
                                              ) : (
                                                <>
                                                  <button
                                                    onClick={() => toggleEditingApproved(answer.id)}
                                                    className="cursor-pointer flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-border bg-background hover:bg-muted text-foreground transition-colors"
                                                  >
                                                    Cancel
                                                  </button>
                                                  <button
                                                    onClick={() => handleUpdateApproved(answer.id)}
                                                    disabled={actionInProgressId !== null}
                                                    className="cursor-pointer flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-primary hover:bg-primary/95 text-primary-foreground shadow-sm disabled:opacity-50 transition-colors"
                                                  >
                                                    {actionInProgressId === answer.id ? (
                                                      <Loader2 className="w-4 h-4 animate-spin" />
                                                    ) : (
                                                      <Check className="w-4 h-4" />
                                                    )}
                                                    Save Changes
                                                  </button>
                                                </>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              )}

            </div>
          )}
        </div>
      </main>
    </ProtectedRoute>
  );
}
