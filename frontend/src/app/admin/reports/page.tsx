"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import { AdminReportSummary } from "@/types";
import { FileText, ChevronRight, BarChart3, AlertTriangle, Search } from "lucide-react";

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
    if (score >= 70) return "text-emerald-500 bg-emerald-500/10 border-emerald-500/20";
    if (score >= 40) return "text-amber-500 bg-amber-500/10 border-amber-500/20";
    return "text-rose-500 bg-rose-500/10 border-rose-500/20";
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
    const byName =
      !nameFilter.trim() ||
      item.user_name.toLowerCase().includes(nameFilter.trim().toLowerCase()) ||
      item.user_email.toLowerCase().includes(nameFilter.trim().toLowerCase());
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
        <div className="animate-fade-in max-w-6xl mx-auto px-4">
          
          <div className="app-page-heading mb-6 flex items-center gap-3">
            <BarChart3 className="w-7 h-7 text-primary" />
            <div>
              <h1 className="text-2xl font-black tracking-tight">Interview Reports</h1>
              <p className="text-sm text-muted">Review student interview results, scores, and exam integrity metrics.</p>
            </div>
          </div>

          <div className="app-panel mb-6 grid grid-cols-1 md:grid-cols-4 gap-4 bg-white shadow-sm border border-slate-100 rounded-xl p-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 w-4 h-4 text-muted" />
              <input
                value={nameFilter}
                onChange={(e) => {
                  setNameFilter(e.target.value);
                  setPage(1);
                }}
                placeholder="Search by name or email..."
                className="app-control pl-9 w-full rounded-lg"
              />
            </div>
            <div>
              <select
                value={topicFilter}
                onChange={(e) => {
                  setTopicFilter(e.target.value);
                  setPage(1);
                }}
                className="app-control w-full rounded-lg"
              >
                <option value="all">All Topics</option>
                {availableTopics.map((topic) => (
                  <option key={topic} value={topic}>{topic}</option>
                ))}
              </select>
            </div>
            <div>
              <select
                value={performanceFilter}
                onChange={(e) => {
                  setPerformanceFilter(e.target.value as "all" | "top" | "low");
                  setPage(1);
                }}
                className="app-control w-full rounded-lg"
              >
                <option value="all">All Performance</option>
                <option value="top">Top Performance (&gt;= 70%)</option>
                <option value="low">Low Performance (&lt; 40%)</option>
              </select>
            </div>
            <div>
              <select
                value={rangeFilter}
                onChange={(e) => {
                  setRangeFilter(e.target.value as "all" | "7" | "30" | "90");
                  setPage(1);
                  setTopicFilter("all");
                }}
                className="app-control w-full rounded-lg"
              >
                <option value="all">All Time</option>
                <option value="7">Last 7 Days</option>
                <option value="30">Last 30 Days</option>
                <option value="90">Last 90 Days</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted animate-pulse">
              <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
              <span>Loading report data...</span>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="app-empty-state py-20 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
              <FileText className="w-12 h-12 text-muted/60 mx-auto mb-4" />
              <p className="text-muted font-medium">No interview reports found matching filters.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-3">
                {visibleItems.map((item) => (
                  <Link
                    key={item.session_id}
                    href={`/admin/reports/${item.session_id}`}
                    className="app-list-item block bg-white hover:bg-slate-50/70 border border-slate-100 rounded-xl p-5 transition-all shadow-sm hover:shadow-md"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-1.5">
                          <p className="font-bold text-lg text-slate-800 leading-tight">
                            {item.user_name}
                          </p>
                          <span className="text-sm text-slate-500 font-normal">
                            ({item.user_email})
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-primary mb-2">
                          {item.role_title}
                        </p>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                          <span>{new Date(item.completed_at).toLocaleString()}</span>
                          <span className="w-1.5 h-1.5 bg-slate-200 rounded-full" />
                          <span>{item.total_questions} questions</span>
                          <span className="w-1.5 h-1.5 bg-slate-200 rounded-full" />
                          
                          {/* Tab switch display */}
                          {item.tab_switches !== undefined && (
                            item.tab_switches > 0 ? (
                              <span className="inline-flex items-center gap-1 text-rose-600 font-bold bg-rose-50 px-2 py-0.5 rounded-full border border-rose-100">
                                <AlertTriangle className="w-3 h-3 text-rose-500" />
                                {item.tab_switches} tab switch{item.tab_switches > 1 ? "es" : ""}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                                ✓ No tab switches
                              </span>
                            )
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-4 shrink-0 justify-end self-end sm:self-center">
                        <div className={`px-4 py-2 rounded-xl border text-xl font-extrabold flex items-center justify-center ${scoreColor(item.overall_score)}`}>
                          {item.overall_score}%
                        </div>
                        <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-primary transition-colors" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>

              {/* Pagination controls */}
              <div className="pt-4 flex items-center justify-between border-t border-slate-100">
                <p className="text-xs text-muted">
                  Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, filteredItems.length)} of {filteredItems.length} records
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    Prev
                  </button>
                  <span className="text-xs font-bold text-muted bg-slate-100 px-3 py-1.5 rounded-lg">
                    {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
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
