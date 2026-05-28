"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import { Topic, QuestionLite } from "@/types";
import { Send, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

export default function AdminInterviewsPage() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [questions, setQuestions] = useState<QuestionLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingTopicId, setUpdatingTopicId] = useState<string | null>(null);
  const [timerEnabledByTopic, setTimerEnabledByTopic] = useState<Record<string, boolean>>({});
  const [timerMinutesByTopic, setTimerMinutesByTopic] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [topicsRes, questionsRes] = await Promise.all([
        api.get("/admin/topics"),
        api.get("/admin/questions?interview_type=topic"),
      ]);
      setTopics(topicsRes.data?.topics || []);
      setQuestions(questionsRes.data?.questions || []);

      const topicList: Topic[] = topicsRes.data?.topics || [];
      const timerEnabledMap: Record<string, boolean> = {};
      const timerMinutesMap: Record<string, string> = {};

      for (const topic of topicList) {
        timerEnabledMap[topic.id] = !!topic.timer_enabled;
        timerMinutesMap[topic.id] =
          topic.timer_seconds && topic.timer_seconds > 0
            ? String(Math.ceil(topic.timer_seconds / 60))
            : "10";
      }

      setTimerEnabledByTopic(timerEnabledMap);
      setTimerMinutesByTopic(timerMinutesMap);
    } catch (err) {
      console.error("Failed to fetch interview controls", err);
    } finally {
      setLoading(false);
    }
  };

  const questionCountMap = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const q of questions) {
      const topicId = String(q?.topic_id || "");
      if (!topicId) continue;
      counts[topicId] = (counts[topicId] || 0) + 1;
    }
    return counts;
  }, [questions]);

  const setPublishStatus = async (topicId: string, isPublished: boolean) => {
    setUpdatingTopicId(topicId);
    try {
      const timerEnabled = !!timerEnabledByTopic[topicId];
      const timerMinutes = Number(timerMinutesByTopic[topicId] || "0");

      if (isPublished && timerEnabled && (!Number.isFinite(timerMinutes) || timerMinutes <= 0)) {
        toast.error("Please enter a valid timer in minutes before publishing.");
        setUpdatingTopicId(null);
        return;
      }

      const payload: any = { is_published: isPublished };
      if (isPublished) {
        payload.timer_enabled = timerEnabled;
        payload.timer_seconds = timerEnabled ? Math.round(timerMinutes * 60) : null;
      }

      await api.put(`/admin/topics/${topicId}/publish`, payload);
      setTopics((prev) =>
        prev.map((topic) =>
          topic.id === topicId
            ? {
                ...topic,
                is_published: isPublished,
                timer_enabled: isPublished ? timerEnabled : topic.timer_enabled,
                timer_seconds:
                  isPublished && timerEnabled
                    ? Math.round(timerMinutes * 60)
                    : isPublished
                    ? null
                    : topic.timer_seconds,
              }
            : topic
        )
      );
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to update publish status");
    } finally {
      setUpdatingTopicId(null);
    }
  };

  return (
    <ProtectedRoute requiredRole="admin">
      <Navbar />
      <main className="pt-20 md:pt-8 pb-12 px-4 max-w-6xl mx-auto md:ml-[var(--admin-sidebar-width,250px)]">
        <div className="animate-fade-in space-y-6">
          <section className="rounded-2xl border border-border bg-gradient-to-br from-card to-black/40 p-6">
            <div className="flex items-center gap-3 mb-2">
              <Send className="w-6 h-6" />
              <h1 className="text-2xl font-bold">Make Interview</h1>
            </div>
            <p className="text-sm text-muted">
              Topics stay hidden from students until you publish them here.
            </p>
          </section>

          {loading ? (
            <div className="text-center text-muted mt-12 animate-pulse-slow">Loading topics...</div>
          ) : topics.length === 0 ? (
            <section className="rounded-2xl border border-border bg-card p-10 text-center">
              <p className="text-muted">No topics found. Create a topic first.</p>
            </section>
          ) : (
            <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {topics.map((topic) => {
                const questionCount = questionCountMap[topic.id] || 0;
                const isPublished = !!topic.is_published;
                const isUpdating = updatingTopicId === topic.id;

                return (
                  <article key={topic.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{topic.name}</p>
                        <p className="text-xs text-muted mt-1">{topic.description || "No description"}</p>
                      </div>
                      <span
                        className={`text-xs px-2 py-1 rounded-full border ${
                          isPublished
                            ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
                            : "border-amber-500/40 text-amber-300 bg-amber-500/10"
                        }`}
                      >
                        {isPublished ? "Live" : "Hidden"}
                      </span>
                    </div>

                    <p className="mt-3 text-xs text-muted">{questionCount} questions</p>

                    <div className="mt-3 p-3 rounded-lg border border-border bg-black/20 space-y-2">
                      <label className="flex items-center justify-between text-xs text-muted">
                        <span>Enable Timer</span>
                        <input
                          type="checkbox"
                          checked={!!timerEnabledByTopic[topic.id]}
                          onChange={(e) =>
                            setTimerEnabledByTopic((prev) => ({
                              ...prev,
                              [topic.id]: e.target.checked,
                            }))
                          }
                        />
                      </label>

                      {timerEnabledByTopic[topic.id] && (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            value={timerMinutesByTopic[topic.id] || "10"}
                            onChange={(e) =>
                              setTimerMinutesByTopic((prev) => ({
                                ...prev,
                                [topic.id]: e.target.value,
                              }))
                            }
                            className="w-24 px-2 py-1 rounded border border-border bg-black/20 text-sm"
                          />
                          <span className="text-xs text-muted">minutes</span>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 flex gap-2">
                      <button
                        onClick={() => setPublishStatus(topic.id, true)}
                        disabled={isUpdating || isPublished}
                        className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <span className="inline-flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4" />
                          Publish
                        </span>
                      </button>
                      <button
                        onClick={() => setPublishStatus(topic.id, false)}
                        disabled={isUpdating || !isPublished}
                        className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold border border-border text-muted hover:text-white hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <span className="inline-flex items-center gap-2">
                          <XCircle className="w-4 h-4" />
                          Hide
                        </span>
                      </button>
                    </div>
                  </article>
                );
              })}
            </section>
          )}
        </div>
      </main>
    </ProtectedRoute>
  );
}
