"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import { AdminQuestion, Topic } from "@/types";
import { FileText, Filter, Pencil, Trash2, Plus, Tags } from "lucide-react";
import { toast } from "sonner";

export default function AdminQuestionsPage() {
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTopic, setFilterTopic] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  const pageSize = 8;

  useEffect(() => {
    fetchTopics();
  }, []);

  useEffect(() => {
    fetchQuestions(filterTopic, difficultyFilter);
  }, [filterTopic, difficultyFilter]);

  useEffect(() => {
    setPage(1);
  }, [filterTopic, difficultyFilter]);

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
      setTopics(topicsRes.data.topics || []);
    } catch (err) {
      console.error("Failed to fetch question page data", err);
    }
  };

  const fetchQuestions = async (topicId?: string, difficulty?: string) => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      query.set("interview_type", "topic");
      if (topicId) query.set("topic_id", topicId);
      if (difficulty && difficulty !== "all") query.set("difficulty", difficulty);
      const { data } = await api.get(`/admin/questions?${query.toString()}`);

      const normalized: AdminQuestion[] = (data.questions || []).map((q: any) => ({
        id: String(q?.id || ""),
        role_id: q?.role_id ? String(q.role_id) : undefined,
        topic_id: q?.topic_id ? String(q.topic_id) : undefined,
        interview_type: (q?.interview_type || "topic") as "resume" | "topic",
        question: String(q?.question || ""),
        difficulty: (q?.difficulty || "medium") as "easy" | "medium" | "hard",
        category: typeof q?.category === "string" ? q.category : "",
      }));

      setQuestions(normalized);
    } catch (err) {
      console.error("Failed to fetch questions", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this question?")) return;
    try {
      await api.delete(`/admin/questions/${id}`);
      await fetchQuestions(filterTopic, difficultyFilter);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to delete question");
    }
  };

  const difficultyColor = (d: string) => {
    if (d === "easy") return "text-emerald-300 bg-emerald-500/10 border-emerald-500/30";
    if (d === "hard") return "text-rose-300 bg-rose-500/10 border-rose-500/30";
    return "text-amber-300 bg-amber-500/10 border-amber-500/30";
  };

  const totalPages = Math.max(1, Math.ceil(questions.length / pageSize));
  const visibleQuestions = questions.slice((page - 1) * pageSize, page * pageSize);

  return (
    <ProtectedRoute requiredRole="admin">
      <Navbar />
      <main className="pt-20 md:pt-8 pb-12 px-4 max-w-6xl mx-auto md:ml-[var(--admin-sidebar-width,250px)]">
        <div className="animate-fade-in space-y-6">
          <section className="rounded-2xl border border-border bg-gradient-to-br from-card to-black/40 p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <FileText className="w-6 h-6" />
                  <h1 className="text-2xl font-bold">Topic Questions</h1>
                </div>
                <p className="text-sm text-muted mt-2">
                  Manage all topic-based interview questions in one place.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/admin/topics"
                  className="px-4 py-2 rounded-lg border border-white/30 bg-white/5 text-sm font-semibold hover:bg-white/10 transition-colors flex items-center gap-2"
                >
                  <Tags className="w-4 h-4" />
                  Manage Topics
                </Link>
                <Link
                  href="/admin/questions/new"
                  className="px-4 py-2 rounded-lg bg-white text-black text-sm font-semibold hover:bg-gray-200 transition-colors flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add Question
                </Link>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Filter className="w-4 h-4 text-muted" />
              <h2 className="font-semibold">Filters</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <select
                value={filterTopic}
                onChange={(e) => setFilterTopic(e.target.value)}
                className="px-3 py-2 rounded-lg border border-border bg-black/20 text-sm"
              >
                <option value="">All Topics</option>
                {topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.name}
                  </option>
                ))}
              </select>

              <select
                value={difficultyFilter}
                onChange={(e) => setDifficultyFilter(e.target.value)}
                className="px-3 py-2 rounded-lg border border-border bg-black/20 text-sm"
              >
                <option value="all">All Difficulty</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
          </section>

          {loading ? (
            <div className="text-center text-muted mt-12 animate-pulse-slow">Loading questions...</div>
          ) : questions.length === 0 ? (
            <section className="rounded-2xl border border-border bg-card p-10 text-center">
              <p className="text-muted">No questions found for the selected topic.</p>
            </section>
          ) : (
            <section>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {visibleQuestions.map((q) => (
                <article key={q.id} className="rounded-xl border border-border bg-card p-4 hover:bg-white/[0.03] transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium text-sm leading-relaxed">{q.question}</p>
                    <div className="flex items-center gap-1 shrink-0">
                      <Link
                        href={`/admin/questions/${q.id}`}
                        className="p-2 rounded-lg text-muted hover:text-white hover:bg-white/5 transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </Link>
                      <button
                        onClick={() => handleDelete(q.id)}
                        className="p-2 rounded-lg text-muted hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs border capitalize ${difficultyColor(q.difficulty)}`}>
                      {q.difficulty}
                    </span>
                    {(() => {
                      const category = (q.category || "").trim();
                      const topic = (q.topic_id ? (topicMap[q.topic_id] || "Topic") : "").trim();
                      const showCategory =
                        !!category && (!topic || category.toLowerCase() !== topic.toLowerCase());

                      return (
                        <>
                          {topic && (
                            <span className="px-2 py-0.5 rounded-full text-xs border border-cyan-500/30 bg-cyan-500/10 text-cyan-200">
                              {topic}
                            </span>
                          )}
                          {showCategory && (
                            <span className="px-2 py-0.5 rounded-full text-xs border border-border bg-white/5 text-muted">
                              {category}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </article>
              ))}
              </div>
              <div className="mt-5 flex items-center justify-between gap-2">
                <p className="text-xs text-muted">
                  Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, questions.length)} of {questions.length}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 rounded-lg border border-border text-sm disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <span className="text-sm text-muted">{page}/{totalPages}</span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 rounded-lg border border-border text-sm disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
    </ProtectedRoute>
  );
}
