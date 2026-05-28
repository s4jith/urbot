"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import { Topic } from "@/types";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Difficulty = "easy" | "medium" | "hard";

export default function AdminEditQuestionPage() {
  const params = useParams();
  const router = useRouter();
  const questionId = String(params.id || "");

  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);

  const [topicId, setTopicId] = useState("");
  const [question, setQuestion] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!questionId) return;
    fetchData();
  }, [questionId]);

  const fetchData = async () => {
    try {
      const [topicsRes, questionRes] = await Promise.all([
        api.get("/admin/topics"),
        api.get(`/admin/questions/${questionId}`),
      ]);

      const topicItems: Topic[] = topicsRes.data.topics || [];
      setTopics(topicItems);

      const q = questionRes.data;
      setTopicId(String(q?.topic_id || ""));
      setQuestion(String(q?.question || ""));
      setDifficulty((q?.difficulty || "medium") as Difficulty);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to load question");
      router.push("/admin/questions");
    } finally {
      setLoading(false);
    }
  };

  const updateQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topicId) {
      toast.error("Please select a topic");
      return;
    }

    setSaving(true);
    try {
      await api.put(`/admin/questions/${questionId}`, {
        topic_id: topicId,
        question,
        difficulty,
      });
      router.push("/admin/questions");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to update question");
    } finally {
      setSaving(false);
    }
  };

  const deleteQuestion = async () => {
    if (!confirm("Delete this question?")) return;
    setDeleting(true);
    try {
      await api.delete(`/admin/questions/${questionId}`);
      router.push("/admin/questions");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to delete question");
      setDeleting(false);
    }
  };

  return (
    <ProtectedRoute requiredRole="admin">
      <Navbar />
      <main className="pt-20 md:pt-8 pb-12 px-4 max-w-3xl mx-auto md:ml-[var(--admin-sidebar-width,250px)]">
        <div className="animate-fade-in space-y-6">
          <section className="rounded-2xl border border-border bg-gradient-to-br from-card to-black/40 p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold">Edit Question</h1>
                <p className="text-sm text-muted mt-2">Update topic, text, and difficulty for this question.</p>
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
            <div className="text-center text-muted mt-12 animate-pulse-slow">Loading question...</div>
          ) : (
            <section className="rounded-2xl border border-border bg-card p-6">
              <form onSubmit={updateQuestion} className="space-y-4">
                <select value={topicId} onChange={(e) => setTopicId(e.target.value)} required>
                  <option value="">Select Topic</option>
                  {topics.map((topic) => (
                    <option key={topic.id} value={topic.id}>
                      {topic.name}
                    </option>
                  ))}
                </select>
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  rows={4}
                  required
                  className="resize-none"
                />
                <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2.5 rounded-lg bg-white text-black text-sm font-semibold hover:bg-gray-200 disabled:opacity-50 transition-colors flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                  <button
                    type="button"
                    onClick={deleteQuestion}
                    disabled={deleting}
                    className="px-5 py-2.5 rounded-lg border border-rose-500/40 text-rose-300 text-sm font-semibold hover:bg-rose-500/10 disabled:opacity-50 transition-colors flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    {deleting ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </form>
            </section>
          )}
        </div>
      </main>
    </ProtectedRoute>
  );
}
