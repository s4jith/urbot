"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import { AdminReportSummary } from "@/types";
import { FileText, ChevronRight, BarChart3 } from "lucide-react";

export default function AdminReportsPage() {
  const [items, setItems] = useState<AdminReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [nameFilter, setNameFilter] = useState("");
  const [topicFilter, setTopicFilter] = useState("all");
  const [performanceFilter, setPerformanceFilter] = useState<"all" | "top" | "low">("all");
  const [rangeFilter, setRangeFilter] = useState<"all" | "7" | "30" | "90">("30");

  const pageSize = 8;

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    try {
      const { data } = await api.get("/admin/reports?limit=200");
      setItems(data.items || []);
    } catch (err) {
      console.error("Failed to fetch admin reports", err);
    } finally {
      setLoading(false);
    }
  };

  const scoreColor = (score: number) => {
    if (score >= 70) return "text-green-400";
    if (score >= 40) return "text-yellow-400";
    return "text-red-400";
  };

  const isInRange = (completedAt: string) => {
    if (rangeFilter === "all") return true;
    const days = Number(rangeFilter);
    if (!days) return true;
    const dt = new Date(completedAt);
    if (Number.isNaN(dt.getTime())) return false;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return dt.getTime() >= cutoff;
  };

  const rangeFilteredItems = items.filter((item) => isInRange(item.completed_at));

  const availableTopics = Array.from(
    new Set(rangeFilteredItems.map((item) => item.role_title?.trim()).filter((v): v is string => !!v))
  ).sort((a, b) => a.localeCompare(b));

  const filteredItems = rangeFilteredItems.filter((item) => {
    const byName = !nameFilter.trim() || item.user_name.toLowerCase().includes(nameFilter.trim().toLowerCase());
    const byTopic = topicFilter === "all" || item.role_title === topicFilter;
    const byPerf =
      performanceFilter === "all" ||
      (performanceFilter === "top" && item.overall_score >= 70) ||
      (performanceFilter === "low" && item.overall_score < 40);

    return byName && byTopic && byPerf;
  });

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const visibleItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  return (
    <ProtectedRoute requiredRole="admin">
      <Navbar />
      <main className="app-page-shell md:pt-8 md:ml-[var(--admin-sidebar-width,250px)]">
        <div className="animate-fade-in">
          <div className="app-page-heading">
            <BarChart3 className="w-6 h-6" />
            <h1 className="text-2xl font-bold">Interview Reports</h1>
          </div>

          <div className="app-panel mb-5 grid grid-cols-1 md:grid-cols-4 gap-3 animate-fade-in-soft">
            <input
              value={nameFilter}
              onChange={(e) => {
                setNameFilter(e.target.value);
                setPage(1);
              }}
              placeholder="Filter by name"
              className="app-control"
            />
            <select
              value={topicFilter}
              onChange={(e) => {
                setTopicFilter(e.target.value);
                setPage(1);
              }}
              className="app-control"
            >
              <option value="all">All Topics</option>
              {availableTopics.map((topic) => (
                <option key={topic} value={topic}>{topic}</option>
              ))}
            </select>
            <select
              value={performanceFilter}
              onChange={(e) => {
                setPerformanceFilter(e.target.value as "all" | "top" | "low");
                setPage(1);
              }}
              className="app-control"
            >
              <option value="all">All Performance</option>
              <option value="top">Top Performance (&gt;= 70)</option>
              <option value="low">Low Performance (&lt; 40)</option>
            </select>
            <select
              value={rangeFilter}
              onChange={(e) => {
                setRangeFilter(e.target.value as "all" | "7" | "30" | "90");
                setPage(1);
                setTopicFilter("all");
              }}
              className="app-control"
            >
              <option value="all">All Time</option>
              <option value="7">Last 7 Days</option>
              <option value="30">Last 30 Days</option>
              <option value="90">Last 90 Days</option>
            </select>
          </div>

          {loading ? (
            <div className="text-center text-muted mt-12 animate-pulse-slow">Loading reports...</div>
          ) : filteredItems.length === 0 ? (
            <div className="app-empty-state">
              <FileText className="w-12 h-12 text-muted mx-auto mb-4" />
              <p className="text-muted">No interview reports found for current filters.</p>
            </div>
          ) : (
            <div>
              <div className="space-y-3">
              {visibleItems.map((item) => (
                <Link
                  key={item.session_id}
                  href={`/admin/reports/${item.session_id}`}
                  className="app-list-item"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-lg mb-1 break-words">{item.user_name} ({item.user_email})</p>
                      <p className="text-sm text-muted break-words">{item.role_title}</p>
                      <p className="text-xs text-muted mt-2">
                        {new Date(item.completed_at).toLocaleString()} • {item.total_questions} questions
                      </p>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <span className={`text-2xl font-bold ${scoreColor(item.overall_score)}`}>{item.overall_score}%</span>
                      <ChevronRight className="w-5 h-5 text-muted" />
                    </div>
                  </div>
                </Link>
              ))}
              </div>
              <div className="mt-5 flex items-center justify-between gap-2">
                <p className="text-xs text-muted">
                  Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, filteredItems.length)} of {filteredItems.length}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="app-btn"
                  >
                    Prev
                  </button>
                  <span className="text-sm text-muted">{page}/{totalPages}</span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="app-btn"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </ProtectedRoute>
  );
}
