"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import { AdminQuestion, Topic } from "@/types";
import { FileText, Filter, Pencil, Trash2, Upload, AlertCircle, CheckCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export default function CompactAnswersPage() {
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Upload state
  const [selectedTopic, setSelectedTopic] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");

  // Filters
  const [filterTopic, setFilterTopic] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 5;

  // Edit Modal State
  const [editingQuestion, setEditingQuestion] = useState<AdminQuestion | null>(null);
  const [editForm, setEditForm] = useState({
    question: "",
    original_answer: "",
    compacted_answer: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchTopics();
  }, []);

  useEffect(() => {
    fetchQuestions(filterTopic);
  }, [filterTopic]);

  const topicMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const topic of topics) {
      map[topic.id] = topic.name;
    }
    return map;
  }, [topics]);

  const fetchTopics = async () => {
    try {
      const topicsRes = await api.get("/admin/topics");
      const fetchedTopics = topicsRes.data.topics || [];
      setTopics(fetchedTopics);
      if (fetchedTopics.length > 0) {
        setSelectedTopic(fetchedTopics[0].id);
      }
    } catch (err) {
      console.error("Failed to fetch topics", err);
      toast.error("Failed to fetch topics");
    }
  };

  const fetchQuestions = async (topicId?: string) => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      query.set("interview_type", "topic");
      if (topicId) query.set("topic_id", topicId);
      const { data } = await api.get(`/admin/questions?${query.toString()}`);

      const normalized: AdminQuestion[] = (data.questions || []).map((q: any) => ({
        id: String(q?.id || ""),
        role_id: q?.role_id ? String(q.role_id) : undefined,
        topic_id: q?.topic_id ? String(q.topic_id) : undefined,
        interview_type: (q?.interview_type || "topic") as "resume" | "topic",
        question: String(q?.question || ""),
        difficulty: (q?.difficulty || "medium") as "easy" | "medium" | "hard",
        category: typeof q?.category === "string" ? q.category : "",
        subtopic: typeof q?.subtopic === "string" ? q.subtopic : "",
        expected_answer: typeof q?.expected_answer === "string" ? q.expected_answer : "",
        original_answer: typeof q?.original_answer === "string" ? q.original_answer : "",
        compacted_answer: typeof q?.compacted_answer === "string" ? q.compacted_answer : "",
      }));

      // Filter to only those with original_answer or compacted_answer
      const filtered = normalized.filter(q => q.original_answer || q.compacted_answer);
      setQuestions(filtered);
    } catch (err) {
      console.error("Failed to fetch questions", err);
      toast.error("Failed to load questions");
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!file.name.toLowerCase().endsWith(".csv")) {
        toast.error("Please select a valid CSV file");
        return;
      }
      setCsvFile(file);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTopic) {
      toast.error("Please select a topic first");
      return;
    }
    if (!csvFile) {
      toast.error("Please select a CSV file first");
      return;
    }

    setUploading(true);
    setUploadProgress("Reading CSV and generating compact answers via LLM...");

    const formData = new FormData();
    formData.append("topic_id", selectedTopic);
    formData.append("file", csvFile);

    try {
      const res = await api.post("/admin/questions/upload-csv", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      toast.success(res.data.message || `Uploaded and compacted ${res.data.imported_count} questions successfully!`);
      setCsvFile(null);
      // Reset input element
      const fileInput = document.getElementById("csv-file-input") as HTMLInputElement;
      if (fileInput) fileInput.value = "";
      fetchQuestions(filterTopic);
    } catch (err: any) {
      const detail = err.response?.data?.detail || "Upload and compaction failed";
      toast.error(detail);
      console.error("CSV upload error", err);
    } finally {
      setUploading(false);
      setUploadProgress("");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this question?")) return;
    try {
      await api.delete(`/admin/questions/${id}`);
      toast.success("Question deleted successfully");
      fetchQuestions(filterTopic);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to delete question");
    }
  };

  const handleEditClick = (q: AdminQuestion) => {
    setEditingQuestion(q);
    setEditForm({
      question: q.question,
      original_answer: q.original_answer || "",
      compacted_answer: q.compacted_answer || "",
    });
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingQuestion) return;

    setSaving(true);
    try {
      await api.put(`/admin/questions/${editingQuestion.id}`, {
        question: editForm.question,
        original_answer: editForm.original_answer,
        compacted_answer: editForm.compacted_answer,
        expected_answer: editForm.compacted_answer, // Sync expected_answer
      });
      toast.success("Reference answer updated successfully!");
      setEditingQuestion(null);
      fetchQuestions(filterTopic);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to save updates");
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(questions.length / pageSize));
  const visibleQuestions = questions.slice((page - 1) * pageSize, page * pageSize);

  return (
    <ProtectedRoute requiredRole="admin">
      <Navbar />
      <main className="pt-20 md:pt-8 pb-12 px-4 max-w-6xl mx-auto md:ml-[var(--admin-sidebar-width,250px)]">
        <div className="animate-fade-in space-y-6">
          {/* Header section */}
          <section className="rounded-2xl border border-border bg-gradient-to-br from-card to-black/40 p-6 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
              <FileText className="w-40 h-40" />
            </div>
            <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center border border-primary/30">
                    <FileText className="w-5 h-5 text-primary" />
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight">LLM Compact Answers</h1>
                </div>
                <p className="text-sm text-muted mt-2 max-w-2xl leading-relaxed">
                  Upload topic Q&A sheets via CSV. The local LLM will automatically extract and compact answers into concise, spoken benchmarks for interview scoring.
                </p>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left/Top Sidebar: CSV Ingestion */}
            <div className="space-y-6 lg:col-span-1">
              <section className="rounded-2xl border border-border bg-card p-5 shadow-lg">
                <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
                  <Upload className="w-4 h-4 text-primary" />
                  Import CSV Questions
                </h2>

                <form onSubmit={handleUpload} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1">Select Target Topic</label>
                    <select
                      value={selectedTopic}
                      onChange={(e) => setSelectedTopic(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-black/20 text-sm focus:outline-none focus:border-primary transition-colors"
                      disabled={uploading}
                    >
                      {topics.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-muted mb-1">Select CSV File</label>
                    <div className="relative border-2 border-dashed border-border hover:border-primary/50 transition-colors rounded-xl p-4 text-center cursor-pointer">
                      <input
                        type="file"
                        id="csv-file-input"
                        onChange={handleFileChange}
                        accept=".csv"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        disabled={uploading}
                      />
                      <Upload className="w-8 h-8 text-muted mx-auto mb-2" />
                      <p className="text-xs font-medium truncate">
                        {csvFile ? csvFile.name : "Drag & drop or click to select"}
                      </p>
                      <p className="text-[10px] text-muted mt-1">Accepts 2 columns (Q, A) or 3 columns (Subtopic, Q, A)</p>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all shadow-md shadow-primary/10 flex items-center justify-center gap-2 disabled:opacity-50"
                    disabled={uploading || !csvFile}
                  >
                    {uploading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        Upload & Compact
                      </>
                    )}
                  </button>
                </form>

                {uploading && (
                  <div className="mt-4 p-3 rounded-lg bg-primary/10 border border-primary/20 flex items-start gap-2.5 animate-pulse">
                    <RefreshCw className="w-4 h-4 text-primary shrink-0 mt-0.5 animate-spin" />
                    <div>
                      <p className="text-xs font-semibold text-primary">Local LLM Active</p>
                      <p className="text-[11px] text-muted mt-0.5 leading-normal">{uploadProgress}</p>
                    </div>
                  </div>
                )}
              </section>

              {/* Filters */}
              <section className="rounded-2xl border border-border bg-card p-5 shadow-lg">
                <h2 className="font-semibold text-base mb-3 flex items-center gap-2">
                  <Filter className="w-4 h-4 text-muted" />
                  Filter List
                </h2>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Filter by Topic</label>
                  <select
                    value={filterTopic}
                    onChange={(e) => {
                      setFilterTopic(e.target.value);
                      setPage(1);
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-black/20 text-sm focus:outline-none focus:border-primary transition-colors"
                  >
                    <option value="">All Topics</option>
                    {topics.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </section>
            </div>

            {/* Right/Bottom Main Panel: Compact Q&A List */}
            <div className="lg:col-span-2 space-y-4">
              {loading ? (
                <div className="rounded-2xl border border-border bg-card p-12 text-center text-muted">
                  <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-primary" />
                  Loading compact answers...
                </div>
              ) : questions.length === 0 ? (
                <div className="rounded-2xl border border-border bg-card p-12 text-center text-muted shadow-lg">
                  <AlertCircle className="w-12 h-12 text-muted/40 mx-auto mb-3" />
                  <p className="font-medium text-foreground">No compact reference questions found.</p>
                  <p className="text-xs text-muted mt-1">Upload a CSV using the form to populate reference answers.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {visibleQuestions.map((q) => (
                    <article key={q.id} className="rounded-2xl border border-border bg-card p-5 shadow-md hover:border-primary/30 transition-all flex flex-col gap-4 relative">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <span className="px-2 py-0.5 rounded-full text-[10px] bg-primary/10 border border-primary/20 text-primary uppercase font-bold tracking-wider">
                            {q.topic_id ? topicMap[q.topic_id] || "Topic" : "Topic"}
                          </span>
                          {q.subtopic && (
                            <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] bg-white/5 border border-white/10 text-muted uppercase font-bold tracking-wider">
                              {q.subtopic}
                            </span>
                          )}
                          <h3 className="font-semibold text-base leading-relaxed text-foreground mt-2">{q.question}</h3>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleEditClick(q)}
                            className="p-2 rounded-lg text-muted hover:text-white hover:bg-white/5 transition-colors border border-transparent hover:border-border"
                            title="Edit QA Pair"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(q.id)}
                            className="p-2 rounded-lg text-muted hover:text-rose-400 hover:bg-rose-500/10 transition-colors border border-transparent hover:border-rose-500/20"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="rounded-xl bg-black/30 border border-border/60 p-3.5">
                          <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Original Answer</p>
                          <p className="text-xs leading-relaxed text-muted max-h-[120px] overflow-y-auto pr-1">
                            {q.original_answer || "N/A"}
                          </p>
                        </div>
                        <div className="rounded-xl bg-primary/5 border border-primary/15 p-3.5 relative overflow-hidden">
                          <div className="absolute top-0 right-0 bg-primary/10 border-b border-l border-primary/20 text-primary text-[9px] font-bold px-2 py-0.5 rounded-bl-lg uppercase">
                            Compact Reference
                          </div>
                          <p className="text-[10px] font-bold text-primary uppercase tracking-wider mb-1">LLM compacted</p>
                          <p className="text-xs leading-relaxed text-foreground max-h-[120px] overflow-y-auto pr-1">
                            {q.compacted_answer || q.expected_answer || "N/A"}
                          </p>
                        </div>
                      </div>
                    </article>
                  ))}

                  {/* Pagination */}
                  <div className="flex items-center justify-between pt-2">
                    <p className="text-xs text-muted">
                      Showing {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, questions.length)} of {questions.length} questions
                    </p>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-white/5 disabled:opacity-40 transition-colors"
                      >
                        Previous
                      </button>
                      <span className="text-xs font-medium px-2.5">
                        Page {page} of {totalPages}
                      </span>
                      <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-white/5 disabled:opacity-40 transition-colors"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Edit Modal */}
      {editingQuestion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-scale-up">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-lg flex items-center gap-2">
                <Pencil className="w-4 h-4 text-primary" />
                Edit Reference Q&A
              </h2>
              <button
                onClick={() => setEditingQuestion(null)}
                className="p-1 rounded-lg text-muted hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1">Question</label>
                <textarea
                  value={editForm.question}
                  onChange={(e) => setEditForm(prev => ({ ...prev, question: e.target.value }))}
                  className="w-full h-16 px-3 py-2 text-sm rounded-lg border border-border bg-black/20 focus:outline-none focus:border-primary transition-colors"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1">Original Answer</label>
                <textarea
                  value={editForm.original_answer}
                  onChange={(e) => setEditForm(prev => ({ ...prev, original_answer: e.target.value }))}
                  className="w-full h-24 px-3 py-2 text-sm rounded-lg border border-border bg-black/20 focus:outline-none focus:border-primary transition-colors"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-primary uppercase tracking-wider mb-1">LLM Compacted Answer</label>
                <textarea
                  value={editForm.compacted_answer}
                  onChange={(e) => setEditForm(prev => ({ ...prev, compacted_answer: e.target.value }))}
                  className="w-full h-24 px-3 py-2 text-sm rounded-lg border border-primary/40 bg-primary/5 focus:outline-none focus:border-primary transition-colors"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border mt-4">
                <button
                  type="button"
                  onClick={() => setEditingQuestion(null)}
                  className="px-4 py-2 rounded-lg border border-border text-sm font-semibold hover:bg-white/5 transition-colors"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold shadow-md shadow-primary/10 transition-colors disabled:opacity-50"
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </ProtectedRoute>
  );
}
