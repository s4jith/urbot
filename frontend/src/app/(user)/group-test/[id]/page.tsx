"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import { GroupTest, GroupTestResult, GroupTestTopicResult } from "@/types";
import {
  Layers,
  ChevronLeft,
  Play,
  CheckCircle,
  Loader2,
  Clock,
  Trophy,
  RotateCcw,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
import { PageSkeleton } from "@/components/Skeleton";
import { toast } from "sonner";
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

function TopicCard({
  tr,
  resultId,
  groupTestId,
  timeLimitMinutes,
  onStarted,
}: {
  tr: GroupTestTopicResult;
  resultId: string;
  groupTestId: string;
  timeLimitMinutes?: number | null;
  onStarted: () => void;
}) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  const startTopicInterview = async () => {
    setStarting(true);
    try {
      // Start a topic interview
      const { data: startData } = await api.post("/interview/start", {
        interview_type: "topic",
        topic_id: tr.topic_id,
      });

      const sessionId = startData.session_id;
      const q = startData.question;

      // Link the session to this group test result
      await api.post(`/profile/group-tests/results/${resultId}/link-topic`, {
        topic_id: tr.topic_id,
        session_id: sessionId,
      });

      onStarted();

      // Build interview URL — include return_to so user comes back here
      const returnTo = encodeURIComponent(`/group-test/${groupTestId}?result=${resultId}`);
      const params = new URLSearchParams({
        session: sessionId,
        q: q?.question || "",
        qid: q?.question_id || "",
        num: String(q?.question_number || 1),
        total: String(q?.total_questions || 10),
        diff: q?.difficulty || "medium",
        return_to: returnTo,
      });

      if (timeLimitMinutes) {
        params.set("timerEnabled", "1");
        params.set("timerSeconds", String(timeLimitMinutes * 60));
      }

      router.push(`/interview?${params.toString()}`);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to start topic interview");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div
      className={`p-4 rounded-xl border transition-all ${
        tr.status === "completed"
          ? "border-green-500/20 bg-green-500/5"
          : tr.status === "in_progress"
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-border bg-white/3"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold">{tr.topic_name}</p>
            {tr.status === "completed" && (
              <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
            )}
          </div>
          {tr.status === "completed" && tr.completed_at && (
            <p className="text-xs text-muted mt-1">
              Completed{" "}
              {new Date(tr.completed_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
          {tr.status === "in_progress" && (
            <p className="text-xs text-amber-400 mt-1">Interview in progress — complete it to record your score</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {tr.status === "completed" && tr.overall_score != null ? (
            <div
              className={`px-3 py-1 rounded-lg border text-center min-w-[60px] ${scoreBg(
                tr.overall_score
              )}`}
            >
              <p className={`text-lg font-bold ${scoreColor(tr.overall_score)}`}>
                {tr.overall_score}%
              </p>
              {tr.total_questions && (
                <p className="text-xs text-muted">{tr.total_questions} Qs</p>
              )}
            </div>
          ) : null}

          {tr.status === "completed" && tr.session_id ? (
            <Link
              href={`/report/${tr.session_id}`}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border text-xs text-muted hover:text-white hover:border-white/40"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Report
            </Link>
          ) : tr.status === "in_progress" ? (
            <button
              onClick={startTopicInterview}
              disabled={starting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/40 text-amber-400 text-sm hover:bg-amber-500/10 disabled:opacity-50"
            >
              {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Continue
            </button>
          ) : (
            <button
              onClick={startTopicInterview}
              disabled={starting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Start
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function GroupTestPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const groupTestId = params.id as string;
  const resultId = searchParams.get("result") || "";

  const [groupTest, setGroupTest] = useState<GroupTest | null>(null);
  const [result, setResult] = useState<GroupTestResult | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [gtRes, resultRes] = await Promise.all([
        api.get(`/profile/group-tests`).then((r) =>
          (r.data.items as GroupTest[]).find((gt) => gt.id === groupTestId) || null
        ),
        resultId
          ? api.get(`/profile/group-tests/results/${resultId}`).then((r) => r.data)
          : Promise.resolve(null),
      ]);
      setGroupTest(gtRes);
      setResult(resultRes);
    } catch (err) {
      console.error("Failed to load group test", err);
    } finally {
      setLoading(false);
    }
  }, [groupTestId, resultId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const completedCount = (result?.topic_results || []).filter(
    (tr) => tr.status === "completed"
  ).length;
  const totalCount = (result?.topic_results || []).length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  if (loading) {
    return (
      <ProtectedRoute requiredRole="student">
        <Navbar />
        <PageSkeleton />
      </ProtectedRoute>
    );
  }

  if (!groupTest) {
    return (
      <ProtectedRoute requiredRole="student">
        <Navbar />
        <main className="app-page-shell max-w-3xl">
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle className="w-5 h-5" />
            <p>Group test not found.</p>
          </div>
          <Link href="/group-test" className="text-primary underline text-sm mt-2 inline-block">
            Back to Group Tests
          </Link>
        </main>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute requiredRole="student">
      <Navbar />
      <main className="app-page-shell max-w-3xl">
        <div className="animate-fade-in">
          <Link
            href="/group-test"
            className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-white mb-4"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Group Tests
          </Link>

          <div className="flex items-center gap-3 mb-2">
            <Layers className="w-6 h-6" />
            <h1 className="text-2xl font-bold">{groupTest.name}</h1>
          </div>
          {groupTest.description && (
            <p className="text-sm text-muted mb-4">{groupTest.description}</p>
          )}

          {/* Meta info */}
          <div className="flex flex-wrap gap-3 mb-5 text-xs text-muted">
            {groupTest.time_limit_minutes && (
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {groupTest.time_limit_minutes} min per topic
              </span>
            )}
            {result && (
              <span className="flex items-center gap-1">
                <RotateCcw className="w-3.5 h-3.5" />
                Attempt #{result.attempt_number}
              </span>
            )}
          </div>

          {/* Progress */}
          {result && totalCount > 0 && (
            <div className="app-panel mb-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">
                  {completedCount}/{totalCount} topics completed
                </p>
                {result.status === "completed" && result.overall_score != null && (
                  <div className="flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-amber-400" />
                    <span className={`text-lg font-bold ${scoreColor(result.overall_score)}`}>
                      Overall: {result.overall_score}%
                    </span>
                  </div>
                )}
              </div>
              <div className="w-full h-2 rounded-full bg-white/10">
                <div
                  className={`h-2 rounded-full transition-all ${
                    progressPct === 100 ? "bg-green-400" : "bg-primary"
                  }`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              {result.status === "completed" && (
                <div className="mt-3 p-3 rounded-lg bg-green-500/8 border border-green-500/20 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <p className="text-sm text-green-300">
                    You&apos;ve completed this group test! Overall score: {result.overall_score}%
                  </p>
                </div>
              )}
            </div>
          )}

          {!result && (
            <div className="app-panel mb-5 text-sm text-muted flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              No active session. Go back and click Start.
            </div>
          )}

          {/* Topics */}
          <div className="space-y-3">
            {(result?.topic_results || []).map((tr) => (
              <TopicCard
                key={tr.topic_id}
                tr={tr}
                resultId={resultId}
                groupTestId={groupTestId}
                timeLimitMinutes={result?.time_limit_minutes}
                onStarted={fetchData}
              />
            ))}
          </div>
        </div>
      </main>
    </ProtectedRoute>
  );
}
