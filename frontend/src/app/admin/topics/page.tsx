"use client";

import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import { Topic } from "@/types";
import { Tags, Plus, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";

export default function AdminTopicsPage() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicQuestionCounts, setTopicQuestionCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [topicName, setTopicName] = useState("");
  const [topicDescription, setTopicDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [topicsRes, questionsRes] = await Promise.all([
        api.get("/admin/topics"),
        api.get("/admin/questions?interview_type=topic"),
      ]);

      const topicList: Topic[] = topicsRes.data.topics || [];
      const counts: Record<string, number> = {};
      for (const q of questionsRes.data.questions || []) {
        const topicId = String(q?.topic_id || "");
        if (topicId) {
          counts[topicId] = (counts[topicId] || 0) + 1;
        }
      }

      setTopics(topicList);
      setTopicQuestionCounts(counts);
    } catch (err) {
      console.error("Failed to fetch topic data", err);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingTopicId(null);
    setTopicName("");
    setTopicDescription("");
  };

  const editTopic = (topic: Topic) => {
    setEditingTopicId(topic.id);
    setTopicName(topic.name);
    setTopicDescription(topic.description || "");
    setShowForm(true);
  };

  const saveTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topicName.trim()) {
      toast.error("Topic name is required");
      return;
    }

    setSaving(true);
    try {
      if (editingTopicId) {
        await api.put(`/admin/topics/${editingTopicId}`, {
          name: topicName.trim(),
          description: topicDescription.trim() || undefined,
        });
      } else {
        await api.post("/admin/topics", {
          name: topicName.trim(),
          description: topicDescription.trim() || undefined,
        });
      }

      resetForm();
      await fetchData();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to save topic");
    } finally {
      setSaving(false);
    }
  };

  const deleteTopic = async (topicId: string) => {
    if (!confirm("Delete this topic and all linked topic questions?")) return;
    try {
      await api.delete(`/admin/topics/${topicId}`);
      await fetchData();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to delete topic");
    }
  };

  return (
    <ProtectedRoute requiredRole="admin">
      <Navbar />
      <main className="pt-20 md:pt-8 pb-12 px-4 max-w-6xl mx-auto md:ml-[var(--admin-sidebar-width,250px)]">
        <div className="animate-fade-in space-y-6">
          <section className="rounded-2xl border border-border bg-gradient-to-br from-card to-black/40 p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <Tags className="w-6 h-6" />
                  <h1 className="text-2xl font-bold">Topic Management</h1>
                </div>
                <p className="text-sm text-muted mt-2">
                  Create and manage interview topics. Questions will be mapped to these topics.
                </p>
              </div>
              <button
                onClick={() => {
                  resetForm();
                  setShowForm(true);
                }}
                className="px-4 py-2 rounded-lg bg-white text-black text-sm font-semibold hover:bg-gray-200 transition-colors flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                New Topic
              </button>
            </div>
          </section>

          {showForm && (
            <section className="rounded-2xl border border-border bg-card p-6 animate-slide-up">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold">{editingTopicId ? "Edit Topic" : "Create Topic"}</h2>
                <button onClick={resetForm} className="p-2 rounded-lg hover:bg-white/5 text-muted hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={saveTopic} className="space-y-4">
                <input
                  value={topicName}
                  onChange={(e) => setTopicName(e.target.value)}
                  placeholder="Topic name"
                  required
                />
                <textarea
                  value={topicDescription}
                  onChange={(e) => setTopicDescription(e.target.value)}
                  placeholder="Topic description (optional)"
                  rows={3}
                  className="resize-none"
                />
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 rounded-lg bg-white text-black text-sm font-semibold hover:bg-gray-200 disabled:opacity-50 transition-colors"
                >
                  {saving ? "Saving..." : editingTopicId ? "Update Topic" : "Create Topic"}
                </button>
              </form>
            </section>
          )}

          {loading ? (
            <div className="text-center text-muted mt-12 animate-pulse-slow">Loading topics...</div>
          ) : topics.length === 0 ? (
            <section className="rounded-2xl border border-border bg-card p-10 text-center">
              <p className="text-muted">No topics yet. Create the first topic.</p>
            </section>
          ) : (
            <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {topics.map((topic) => (
                <article key={topic.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{topic.name}</p>
                      <p className="text-xs text-muted mt-1">{topic.description || "No description"}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => editTopic(topic)}
                        className="p-2 rounded-lg text-muted hover:text-white hover:bg-white/5 transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteTopic(topic.id)}
                        className="p-2 rounded-lg text-muted hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted">{topicQuestionCounts[topic.id] || 0} questions</p>
                </article>
              ))}
            </section>
          )}
        </div>
      </main>
    </ProtectedRoute>
  );
}
