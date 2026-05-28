"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import { GroupTest, GroupTestResult } from "@/types";
import { Layers, ChevronRight, Loader2, Clock, RotateCcw, CheckCircle } from "lucide-react";
import { PageSkeleton } from "@/components/Skeleton";
import { toast } from "sonner";

export default function GroupTestsPage() {
  const router = useRouter();
  const [items, setItems] = useState<GroupTest[]>([]);
  const [myResults, setMyResults] = useState<GroupTestResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [listRes, resultsRes] = await Promise.all([
        api.get("/profile/group-tests"),
        api.get("/profile/group-tests/my-results"),
      ]);
      setItems(listRes.data.items || []);
      setMyResults(resultsRes.data.items || []);
    } catch (err) {
      console.error("Failed to fetch group tests", err);
    } finally {
      setLoading(false);
    }
  };

  // Latest result per group test id
  const resultByGroupTestId = myResults.reduce<Record<string, GroupTestResult>>((acc, r) => {
    if (!acc[r.group_test_id] || r.attempt_number > acc[r.group_test_id].attempt_number) {
      acc[r.group_test_id] = r;
    }
    return acc;
  }, {});

  const attemptCount = (groupTestId: string) =>
    myResults.filter((r) => r.group_test_id === groupTestId).length;

  const handleStart = async (item: GroupTest) => {
    const existing = resultByGroupTestId[item.id];
    if (existing && existing.status === "in_progress") {
      // Resume existing in-progress attempt
      router.push(`/group-test/${item.id}?result=${existing.id}`);
      return;
    }

    setStartingId(item.id);
    try {
      const { data } = await api.post(`/profile/group-tests/${item.id}/start`);
      router.push(`/group-test/${item.id}?result=${data.id}`);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to start group test");
    } finally {
      setStartingId(null);
    }
  };

  const getActionLabel = (item: GroupTest) => {
    const existing = resultByGroupTestId[item.id];
    const count = attemptCount(item.id);
    if (existing?.status === "in_progress") return "Resume";
    if (count >= item.max_attempts) return "Max Attempts Reached";
    if (count > 0) return "Retake";
    return "Start";
  };

  const isDisabled = (item: GroupTest) => {
    const count = attemptCount(item.id);
    return count >= item.max_attempts && resultByGroupTestId[item.id]?.status !== "in_progress";
  };

  return (
    <ProtectedRoute requiredRole="student">
      <Navbar />
      {loading ? (
        <PageSkeleton />
      ) : (
        <main className="app-page-shell max-w-3xl">
          <div className="animate-fade-in">
            <div className="app-page-heading">
              <Layers className="w-6 h-6" />
              <h1 className="text-2xl font-bold">Group Tests</h1>
            </div>
            <p className="text-muted text-sm mb-6">
              Complete multiple topic interviews in one structured session.
            </p>

            {items.length === 0 ? (
              <div className="app-empty-state">
                <Layers className="w-12 h-12 text-muted mx-auto mb-4" />
                <p className="text-muted">No group tests available yet. Check back later.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((item) => {
                  const existing = resultByGroupTestId[item.id];
                  const count = attemptCount(item.id);
                  const disabled = isDisabled(item);
                  const label = getActionLabel(item);

                  return (
                    <div key={item.id} className="app-panel">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">{item.name}</p>
                          {item.description && (
                            <p className="text-xs text-muted mt-1">{item.description}</p>
                          )}
                          <div className="flex flex-wrap gap-1 mt-2">
                            {(item.topics || []).map((t) => (
                              <span
                                key={t.id}
                                className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
                              >
                                {t.name}
                              </span>
                            ))}
                          </div>
                          <div className="flex items-center gap-3 mt-2 text-xs text-muted">
                            {item.time_limit_minutes && (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" />
                                {item.time_limit_minutes} min/topic
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <RotateCcw className="w-3.5 h-3.5" />
                              {count}/{item.max_attempts} attempts
                            </span>
                            {existing?.status === "completed" && existing.overall_score != null && (
                              <span className="flex items-center gap-1 text-green-400">
                                <CheckCircle className="w-3.5 h-3.5" />
                                Best: {existing.overall_score}%
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0">
                          {disabled ? (
                            <span className="text-xs text-muted px-3 py-1.5 rounded-lg border border-border">
                              Max Attempts
                            </span>
                          ) : (
                            <button
                              onClick={() => handleStart(item)}
                              disabled={startingId === item.id}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                            >
                              {startingId === item.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                              {label}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* In-progress indicator */}
                      {existing?.status === "in_progress" && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(existing.topic_results || []).map((tr) => (
                            <span
                              key={tr.topic_id}
                              className={`text-xs px-2 py-0.5 rounded-full border ${
                                tr.status === "completed"
                                  ? "border-green-500/40 text-green-400 bg-green-500/8"
                                  : tr.status === "in_progress"
                                  ? "border-amber-500/40 text-amber-400"
                                  : "border-border text-muted"
                              }`}
                            >
                              {tr.topic_name}: {tr.status === "completed" ? `${tr.overall_score}%` : tr.status}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>
      )}
    </ProtectedRoute>
  );
}
