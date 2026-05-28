"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import { ReportHistoryItem } from "@/types";
import { BarChart3, ChevronRight, FileText } from "lucide-react";
import { PageSkeleton } from "@/components/Skeleton";

export default function ReportsPage() {
  const router = useRouter();
  const [reports, setReports] = useState<ReportHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const avgScore =
    reports.length > 0
      ? Math.round(reports.reduce((sum, item) => sum + item.overall_score, 0) / reports.length)
      : 0;

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    try {
      const { data } = await api.get("/reports/history");
      setReports(data.reports || []);
    } catch (err) {
      console.error("Failed to fetch reports:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ProtectedRoute requiredRole="student">
      <Navbar />
      {loading ? (
        <PageSkeleton />
      ) : (
        <main className="app-page-shell max-w-4xl">
          <div className="animate-fade-in">
            <div className="app-page-heading">
              <BarChart3 className="w-6 h-6" />
              <h1 className="text-2xl font-bold">Interview Reports</h1>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
              <div className="app-stat-tile">
                <p className="text-xs text-muted mb-1">Total Reports</p>
                <p className="text-2xl font-bold">{reports.length}</p>
              </div>
              <div className="app-stat-tile">
                <p className="text-xs text-muted mb-1">Average Score</p>
                <p className="text-2xl font-bold">{avgScore}%</p>
              </div>
            </div>

            {reports.length === 0 ? (
            <div className="app-empty-state">
              <FileText className="w-12 h-12 text-muted mx-auto mb-4" />
              <p className="text-muted">No interview reports yet. Start your first interview!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reports.map((r) => (
                <button
                  key={r.session_id}
                  onClick={() => router.push(`/report/${r.session_id}`)}
                  className="app-list-item w-full text-left flex items-start justify-between gap-4 group"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold break-words">{r.role_title || "Interview"}</p>
                    <p className="text-sm text-muted mt-1">
                      {new Date(r.completed_at).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}{" "}
                      • {r.total_questions} questions
                    </p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <span
                      className={`text-2xl font-bold ${
                        r.overall_score >= 70
                          ? "text-green-400"
                          : r.overall_score >= 40
                          ? "text-yellow-400"
                          : "text-red-400"
                      }`}
                    >
                      {r.overall_score}%
                    </span>
                    <ChevronRight className="w-5 h-5 text-muted group-hover:text-foreground transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
      )}
    </ProtectedRoute>
  );
}
