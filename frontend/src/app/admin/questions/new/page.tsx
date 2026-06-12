"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import { Topic, EntryMode, Difficulty } from "@/types";
import { ArrowLeft, BookOpen, Upload, Sparkles, Check, X, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface ExtractedQuestion {
  question: string;
  difficulty: "easy" | "medium" | "hard";
  subtopic?: string;
  expected_answer?: string;
}

export default function AdminCreateQuestionPage() {
  const router = useRouter();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);

  const [entryMode, setEntryMode] = useState<EntryMode>("manual");

  // Manual Mode State
  const [topicId, setTopicId] = useState("");
  const [question, setQuestion] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [subtopic, setSubtopic] = useState("");
  const [saving, setSaving] = useState(false);

  // PDF Upload & Review State
  const [uploadTopicId, setUploadTopicId] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [extractedQuestions, setExtractedQuestions] = useState<ExtractedQuestion[]>([]);
  const [isReviewMode, setIsReviewMode] = useState(false);

  useEffect(() => {
    fetchTopics();
  }, []);

  const fetchTopics = async () => {
    try {
      const { data } = await api.get("/admin/topics");
      const items: Topic[] = data.topics || [];
      setTopics(items);
      if (items.length > 0) {
        setTopicId(items[0].id);
        setUploadTopicId(items[0].id);
      }
    } catch (err) {
      console.error("Failed to load topics", err);
    } finally {
      setLoading(false);
    }
  };

  const createManualQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topicId) {
      toast.error("Please select a topic");
      return;
    }

    setSaving(true);
    try {
      await api.post("/admin/questions", {
        interview_type: "topic",
        topic_id: topicId,
        question,
        difficulty,
        subtopic: subtopic.trim(),
      });
      toast.success("Question created successfully");
      router.push("/admin/questions");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to create question");
    } finally {
      setSaving(false);
    }
  };

  const importFromPdf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadTopicId) {
      toast.error("Please select a topic");
      return;
    }
    if (!uploadFile) {
      toast.error("Please choose a PDF file");
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append("interview_type", "topic");
      form.append("topic_id", uploadTopicId);
      form.append("file", uploadFile);

      const { data } = await api.post("/admin/questions/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const questionsList = data.questions || [];
      if (questionsList.length === 0) {
        toast.error("No questions could be extracted from PDF.");
        return;
      }

      setExtractedQuestions(
        questionsList.map((q: any) => ({
          question: String(q.question || ""),
          difficulty: (q.difficulty || "medium") as "easy" | "medium" | "hard",
          subtopic: String(q.subtopic || ""),
          expected_answer: String(q.expected_answer || ""),
        }))
      );
      setIsReviewMode(true);
      toast.success(`Extracted ${questionsList.length} questions. Please review them below.`);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to extract questions from PDF");
    } finally {
      setUploading(false);
    }
  };

  const saveBatchQuestions = async () => {
    if (extractedQuestions.length === 0) {
      toast.error("No questions to save.");
      return;
    }

    setSaving(true);
    try {
      await api.post("/admin/questions/batch", {
        topic_id: uploadTopicId,
        questions: extractedQuestions.map((q) => ({
          interview_type: "topic",
          question: q.question,
          difficulty: q.difficulty,
          subtopic: q.subtopic || "",
          expected_answer: q.expected_answer || "",
        })),
      });

      toast.success("All questions saved successfully");
      router.push("/admin/questions");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to save batch questions");
    } finally {
      setSaving(false);
    }
  };

  const handleEditExtracted = (index: number, key: keyof ExtractedQuestion, value: string) => {
    const updated = [...extractedQuestions];
    updated[index] = {
      ...updated[index],
      [key]: value,
    };
    setExtractedQuestions(updated);
  };

  const handleDeleteExtracted = (index: number) => {
    const updated = extractedQuestions.filter((_, i) => i !== index);
    setExtractedQuestions(updated);
  };

  return (
    <ProtectedRoute requiredRole="admin">
      <Navbar />
      <main className="pt-20 md:pt-8 pb-12 px-4 max-w-4xl mx-auto md:ml-[var(--admin-sidebar-width,250px)]">
        <div className="animate-fade-in space-y-6">
          <section className="rounded-2xl border border-border bg-gradient-to-br from-card to-black/40 p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold">
                  {isReviewMode ? "Review Extracted Questions" : "Create Topic Question"}
                </h1>
                <p className="text-sm text-muted mt-2">
                  {isReviewMode
                    ? "Verify, edit, or remove the AI-extracted questions before batch-saving them."
                    : "Add one question manually or import a set from PDF using AI."}
                </p>
              </div>
              <Link
                href="/admin/questions"
                className="px-3 py-2 rounded-lg border border-border text-sm hover:bg-white/5 flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </Link>
            </div>
          </section>

          {loading ? (
            <div className="text-center text-muted mt-12 animate-pulse-slow">Loading topics...</div>
          ) : topics.length === 0 ? (
            <section className="rounded-2xl border border-border bg-card p-8 text-center">
              <p className="text-muted">No topics found. Create a topic first.</p>
              <Link
                href="/admin/topics"
                className="inline-block mt-4 px-4 py-2 bg-white text-black rounded-lg text-sm font-semibold"
              >
                Go to Topic Management
              </Link>
            </section>
          ) : (
            <section className="rounded-2xl border border-border bg-card p-6">
              {!isReviewMode && (
                <div className="flex items-center gap-2 mb-6">
                  <button
                    type="button"
                    onClick={() => setEntryMode("manual")}
                    className={`px-3 py-1.5 rounded-lg text-sm border flex items-center gap-1 ${
                      entryMode === "manual"
                        ? "bg-white text-black border-white"
                        : "bg-transparent text-muted border-border hover:text-white"
                    }`}
                  >
                    <BookOpen className="w-4 h-4" />
                    Manual
                  </button>
                  <button
                    type="button"
                    onClick={() => setEntryMode("pdf")}
                    className={`px-3 py-1.5 rounded-lg text-sm border flex items-center gap-1 ${
                      entryMode === "pdf"
                        ? "bg-white text-black border-white"
                        : "bg-transparent text-muted border-border hover:text-white"
                    }`}
                  >
                    <Upload className="w-4 h-4" />
                    Upload PDF + AI
                  </button>
                </div>
              )}

              {isReviewMode ? (
                <div className="space-y-6">
                  <div className="space-y-4">
                    {extractedQuestions.map((q, index) => (
                      <div
                        key={index}
                        className="p-4 rounded-xl border border-border bg-black/40 space-y-3 relative group"
                      >
                        <button
                          type="button"
                          onClick={() => handleDeleteExtracted(index)}
                          className="absolute top-4 right-4 p-2 rounded-lg text-muted hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          title="Remove question"
                        >
                          <Trash2 className="w-4.5 h-4.5" />
                        </button>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="md:col-span-2 space-y-1">
                            <label className="text-xs text-muted font-medium">Question Text</label>
                            <textarea
                              value={q.question}
                              onChange={(e) => handleEditExtracted(index, "question", e.target.value)}
                              rows={2}
                              className="w-full px-3 py-2 rounded-lg border border-border bg-black/20 text-sm resize-none"
                              required
                            />
                          </div>
                          <div className="space-y-3">
                            <div className="space-y-1">
                              <label className="text-xs text-muted font-medium">Subtopic</label>
                              <input
                                type="text"
                                value={q.subtopic || ""}
                                onChange={(e) => handleEditExtracted(index, "subtopic", e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-border bg-black/20 text-sm"
                                placeholder="General"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-muted font-medium">Difficulty</label>
                              <select
                                value={q.difficulty}
                                onChange={(e) => handleEditExtracted(index, "difficulty", e.target.value)}
                                className="w-full px-3 py-1.5 rounded-lg border border-border bg-black/20 text-sm"
                              >
                                <option value="easy">Easy</option>
                                <option value="medium">Medium</option>
                                <option value="hard">Hard</option>
                              </select>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted font-medium">Expected Answer</label>
                          <textarea
                            value={q.expected_answer || ""}
                            onChange={(e) => handleEditExtracted(index, "expected_answer", e.target.value)}
                            rows={2}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-black/20 text-sm resize-none"
                            placeholder="Describe expected correct response..."
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 pt-4 border-t border-border">
                    <button
                      type="button"
                      onClick={saveBatchQuestions}
                      disabled={saving}
                      className="px-5 py-2.5 rounded-lg bg-white text-black text-sm font-semibold hover:bg-gray-200 disabled:opacity-50 transition-colors flex items-center gap-2"
                    >
                      <Check className="w-4 h-4" />
                      {saving ? "Saving Batch..." : "Save Questions"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsReviewMode(false)}
                      disabled={saving}
                      className="px-5 py-2.5 rounded-lg border border-border text-muted text-sm font-semibold hover:text-white hover:bg-white/5 disabled:opacity-50 transition-colors flex items-center gap-2"
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : entryMode === "manual" ? (
                <form onSubmit={createManualQuestion} className="space-y-4">
                  <select value={topicId} onChange={(e) => setTopicId(e.target.value)} required>
                    <option value="">Select Topic</option>
                    {topics.map((topic) => (
                      <option key={topic.id} value={topic.id}>
                        {topic.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Subtopic (e.g., Transactions, Joins, Normalization) (optional)"
                    value={subtopic}
                    onChange={(e) => setSubtopic(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-black/20 text-sm"
                  />
                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    rows={4}
                    required
                    placeholder="Enter interview question"
                    className="resize-none"
                  />
                  <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2.5 rounded-lg bg-white text-black text-sm font-semibold hover:bg-gray-200 disabled:opacity-50 transition-colors flex items-center gap-2"
                  >
                    <Sparkles className="w-4 h-4" />
                    {saving ? "Creating..." : "Create Question"}
                  </button>
                </form>
              ) : (
                <form onSubmit={importFromPdf} className="space-y-4">
                  <select value={uploadTopicId} onChange={(e) => setUploadTopicId(e.target.value)} required>
                    <option value="">Select Topic</option>
                    {topics.map((topic) => (
                      <option key={topic.id} value={topic.id}>
                        {topic.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted">
                    Upload a PDF containing questions. AI will extract and classify them into subtopics for review.
                  </p>
                  <input
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    required
                  />
                  <button
                    type="submit"
                    disabled={uploading}
                    className="px-5 py-2.5 rounded-lg bg-white text-black text-sm font-semibold hover:bg-gray-200 disabled:opacity-50 transition-colors"
                  >
                    {uploading ? "Uploading and extracting..." : "Generate Questions from PDF"}
                  </button>
                </form>
              )}
            </section>
          )}
        </div>
      </main>
    </ProtectedRoute>
  );
}
