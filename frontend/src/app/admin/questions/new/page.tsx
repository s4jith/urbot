"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import { Topic, EntryMode, Difficulty } from "@/types";
import { ArrowLeft, BookOpen, Upload, Sparkles, Check, X, Pencil, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface ExtractedQuestion {
  question: string;
  difficulty: "easy" | "medium" | "hard";
  subtopic?: string;
  original_answer?: string;
  compacted_answer?: string;
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
  const [originalAnswer, setOriginalAnswer] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [subtopic, setSubtopic] = useState("");
  const [saving, setSaving] = useState(false);

  // CSV Upload State
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvUploading, setCsvUploading] = useState(false);

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
    if (!question.trim()) {
      toast.error("Question is required");
      return;
    }
    if (!originalAnswer.trim()) {
      toast.error("Answer is required");
      return;
    }

    setSaving(true);
    try {
      await api.post("/admin/questions", {
        interview_type: "topic",
        topic_id: topicId,
        question: question.trim(),
        original_answer: originalAnswer.trim(),
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

  const importFromFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadTopicId) {
      toast.error("Please select a topic");
      return;
    }
    if (!uploadFile) {
      toast.error("Please choose a PDF, CSV, or Excel file");
      return;
    }

    const name = uploadFile.name.toLowerCase();
    if (!name.endsWith(".pdf") && !name.endsWith(".csv") && !name.endsWith(".xlsx") && !name.endsWith(".xls")) {
      toast.error("Unsupported file type. Please upload PDF, CSV, or Excel.");
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
        toast.error("No questions could be extracted from the file.");
        return;
      }

      setExtractedQuestions(
        questionsList.map((q: any) => ({
          question: String(q.question || ""),
          difficulty: (q.difficulty || "medium") as "easy" | "medium" | "hard",
          subtopic: String(q.subtopic || ""),
          original_answer: String(q.original_answer || ""),
          compacted_answer: String(q.compacted_answer || ""),
          expected_answer: String(q.expected_answer || ""),
        }))
      );
      setIsReviewMode(true);
      toast.success(`Extracted ${questionsList.length} questions. Please review them below.`);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to extract questions from file");
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
          topic_id: uploadTopicId,
          interview_type: "topic",
          question: q.question,
          difficulty: q.difficulty,
          subtopic: q.subtopic || "",
          original_answer: q.original_answer || "",
          compacted_answer: q.compacted_answer || "",
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
                    onClick={() => setEntryMode("ai")}
                    className={`px-3 py-1.5 rounded-lg text-sm border flex items-center gap-1 ${
                      entryMode === "ai"
                        ? "bg-white text-black border-white"
                        : "bg-transparent text-muted border-border hover:text-white"
                    }`}
                  >
                    <Upload className="w-4 h-4" />
                    AI Question Upload
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
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs text-muted font-medium">Original Answer</label>
                            <textarea
                              value={q.original_answer || ""}
                              onChange={(e) => handleEditExtracted(index, "original_answer", e.target.value)}
                              rows={3}
                              className="w-full px-3 py-2 rounded-lg border border-border bg-black/20 text-sm resize-none text-muted"
                              placeholder="Original answer from document..."
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted font-medium">Compacted Reference Answer</label>
                            <textarea
                              value={q.expected_answer || ""}
                              onChange={(e) => {
                                handleEditExtracted(index, "expected_answer", e.target.value);
                                handleEditExtracted(index, "compacted_answer", e.target.value);
                              }}
                              rows={3}
                              className="w-full px-3 py-2 rounded-lg border border-border bg-black/20 text-sm resize-none"
                              placeholder="Compacted answer..."
                            />
                          </div>
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
                  <select
                    value={topicId}
                    onChange={(e) => setTopicId(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-lg border border-border bg-black/20 text-sm focus:outline-none focus:border-primary transition-colors"
                  >
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
                    placeholder="Enter interview question (Compulsory)"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-black/20 text-sm resize-none focus:outline-none focus:border-primary transition-colors"
                  />
                  <textarea
                    value={originalAnswer}
                    onChange={(e) => setOriginalAnswer(e.target.value)}
                    rows={4}
                    required
                    placeholder="Enter reference answer (Compulsory - will be compacted automatically by local LLM)"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-black/20 text-sm resize-none focus:outline-none focus:border-primary transition-colors"
                  />
                  <select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-black/20 text-sm focus:outline-none focus:border-primary transition-colors"
                  >
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
                <form onSubmit={importFromFile} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1">Select Target Topic</label>
                    <select
                      value={uploadTopicId}
                      onChange={(e) => setUploadTopicId(e.target.value)}
                      required
                      className="w-full px-3 py-2 rounded-lg border border-border bg-black/20 text-sm focus:outline-none focus:border-primary transition-colors"
                    >
                      <option value="">Select Topic</option>
                      {topics.map((topic) => (
                        <option key={topic.id} value={topic.id}>
                          {topic.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1">Select File (PDF, CSV, or Excel)</label>
                    <div className="relative border-2 border-dashed border-border hover:border-primary/50 transition-colors rounded-xl p-6 text-center cursor-pointer bg-black/10">
                      <input
                        type="file"
                        onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                        accept=".pdf,.csv,.xlsx,.xls,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                        required
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        disabled={uploading}
                      />
                      <Upload className="w-10 h-10 text-muted mx-auto mb-2" />
                      <p className="text-sm font-medium truncate">
                        {uploadFile ? uploadFile.name : "Drag & drop or click to select PDF, CSV, or Excel"}
                      </p>
                      <p className="text-xs text-muted mt-1">Accepts PDF questions, 2-column CSV/Excel (Q, A), or 3-column (Subtopic, Q, A)</p>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={uploading}
                    className="w-full py-2.5 rounded-lg bg-white text-black text-sm font-semibold hover:bg-gray-200 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                  >
                    {uploading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        AI extracting & compacting answers...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Generate & Compact with AI
                      </>
                    )}
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
