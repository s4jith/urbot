"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import { GroupTest, GroupTestResult, GroupTestTopicResult } from "@/types";
import { BarChart3, ChevronLeft, ChevronDown, ChevronUp, Layers } from "lucide-react";
import { PageSkeleton } from "@/components/Skeleton";
import Link from "next/link";

function scoreColor(score: number) {
  return score >= 70 ? "text-green-400" : score >= 40 ? "text-yellow-400" : "text-red-400";
}

function scoreBg(score: number) {
  return score >= 70
    ? "bg-green-500/10 border-green-500/20"
    : score >= 40
    ? "bg-yellow-500/10 border-yellow-500/20"
    : "bg-red-500/10 border-red-500/20";
}

function TopicResultRow({ tr }: { tr: GroupTestTopicResult }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/3 border border-border">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{tr.topic_name}</p>
        {tr.completed_at && (
          <p className="text-xs text-muted mt-0.5">
            {new Date(tr.completed_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {tr.status === "completed" && tr.overall_score != null ? (
          <>
            <span className={`text-lg font-bold ${scoreColor(tr.overall_score)}`}>
              {tr.overall_score}%
            </span>
            {tr.session_id && (
              <Link
                href={`/report/${tr.session_id}`}
                className="text-xs text-primary underline hover:opacity-80"
              >
                Report
              </Link>
            )}
          </>
        ) : (
          <span
            className={`text-xs px-2 py-0.5 rounded-full border ${
              tr.status === "in_progress"
                ? "border-amber-500/40 text-amber-400"
                : "border-border text-muted"
            }`}
          >
            {tr.status === "in_progress" ? "In Progress" : "Pending"}
          </span>
        )}
      </div>
    </div>
  );
}

function StudentResultCard({ result }: { result: GroupTestResult }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="app-panel">
      <div
        className="flex items-start justify-between gap-3 cursor-pointer"
        onClick={() => setExpanded((p) => !p)}
      >
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{result.user_name || "—"}</p>
          <p className="text-xs text-muted">{result.user_email}</p>
          <p className="text-xs text-muted mt-1">
            Attempt #{result.attempt_number} ·{" "}
            {new Date(result.started_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {result.status === "completed" && result.overall_score != null ? (
            <div
              className={`px-3 py-1 rounded-lg border text-center min-w-[64px] ${scoreBg(
                result.overall_score
              )}`}
            >
              <p className={`text-xl font-bold ${scoreColor(result.overall_score)}`}>
                {result.overall_score}%
              </p>
            </div>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-400">
              In Progress
            </span>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-2">
          {(result.topic_results || []).map((tr) => (
            <TopicResultRow key={tr.topic_id} tr={tr} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function GroupTestResultsPage() {
  const params = useParams();
  const groupTestId = params.id as string;
  const [groupTest, setGroupTest] = useState<GroupTest | null>(null);
  const [results, setResults] = useState<GroupTestResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [groupTestId]);

  const fetchData = async () => {
    try {
      const [gtRes, resultsRes] = await Promise.all([
        api.get(`/admin/group-tests/${groupTestId}`),
        api.get(`/admin/group-tests/${groupTestId}/results`),
      ]);
      setGroupTest(gtRes.data);
      setResults(resultsRes.data.items || []);
    } catch (err) {
      console.error("Failed to load group test results", err);
    } finally {
      setLoading(false);
    }
  };

  const completed = results.filter((r) => r.status === "completed");
  const avgScore =
    completed.length > 0
      ? Math.round(
          completed.reduce((sum, r) => sum + (r.overall_score || 0), 0) / completed.length
        )
      : null;

  return (
    <ProtectedRoute requiredRole="admin">
      <Navbar />
      {loading ? (
        <PageSkeleton />
      ) : (
        <main className="pt-20 md:pt-8 pb-12 px-4 max-w-5xl mx-auto md:ml-[var(--admin-sidebar-width,250px)]">
          <div className="animate-fade-in">
            <Link
              href="/admin/group-tests"
              className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-white mb-4"
            >
              <ChevronLeft className="w-4 h-4" />
              Back to Group Tests
            </Link>

            <div className="flex items-center gap-3 mb-2">
              <Layers className="w-6 h-6" />
              <h1 className="text-2xl font-bold">{groupTest?.name || "Group Test"}</h1>
            </div>
            {groupTest?.description && (
              <p className="text-sm text-muted mb-4">{groupTest.description}</p>
            )}

            {/* Topics */}
            <div className="flex flex-wrap gap-1.5 mb-6">
              {(groupTest?.topics || []).map((t) => (
                <span
                  key={t.id}
                  className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
                >
                  {t.name}
                </span>
              ))}
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div className="app-stat-tile">
                <p className="text-xs text-muted mb-1">Total Attempts</p>
                <p className="text-2xl font-bold">{results.length}</p>
              </div>
              <div className="app-stat-tile">
                <p className="text-xs text-muted mb-1">Completed</p>
                <p className="text-2xl font-bold">{completed.length}</p>
              </div>
              <div className="app-stat-tile">
                <p className="text-xs text-muted mb-1">In Progress</p>
                <p className="text-2xl font-bold">{results.length - completed.length}</p>
              </div>
              <div className="app-stat-tile">
                <p className="text-xs text-muted mb-1">Avg Score</p>
                <p className="text-2xl font-bold">{avgScore != null ? `${avgScore}%` : "—"}</p>
              </div>
            </div>

            {results.length === 0 ? (
              <div className="text-sm text-muted">No student attempts yet.</div>
            ) : (
              <div className="space-y-3">
                {results.map((r) => (
                  <StudentResultCard key={r.id} result={r} />
                ))}
              </div>
            )}
          </div>
        </main>
      )}
    </ProtectedRoute>
  );
}
