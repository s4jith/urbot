"use client";

import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import { AdminAnalytics, AdminQuitInterview } from "@/types";
import { Users, BarChart3, Award, TrendingDown, Activity, Radio, UserPlus } from "lucide-react";
import { PageSkeleton } from "@/components/Skeleton";

export default function AdminDashboardPage() {
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [quitInterviews, setQuitInterviews] = useState<AdminQuitInterview[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      const [analyticsRes, quitRes] = await Promise.all([
        api.get("/admin/analytics"),
        api.get("/admin/quit-interviews?limit=50"),
      ]);
      setAnalytics(analyticsRes.data);
      setQuitInterviews(quitRes.data?.items || []);
    } catch (err) {
      console.error("Failed to fetch analytics:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ProtectedRoute requiredRole="admin">
      <Navbar />
      {loading ? (
        <PageSkeleton />
      ) : (
        <main className="pt-20 md:pt-8 pb-12 px-4 max-w-6xl mx-auto md:ml-[var(--admin-sidebar-width,250px)]">
          <div className="animate-fade-in">
            <section className="rounded-2xl border border-border bg-gradient-to-r from-emerald-500/20 via-cyan-500/10 to-transparent p-6 mb-8">
              <h1 className="text-3xl font-bold tracking-tight mb-2">Admin Control Center</h1>
              <p className="text-muted">Monitor platform activity, keep interviews live, and track performance trends in one view.</p>
            </section>

            {analytics ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-8">
                  <div className="p-5 rounded-xl bg-card border border-border bg-gradient-to-br from-card to-cyan-500/10">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 rounded-lg bg-white/5">
                        <Users className="w-5 h-5 text-muted" />
                      </div>
                      <span className="text-sm text-muted">Total Students</span>
                    </div>
                    <p className="text-3xl font-bold">{analytics.total_students}</p>
                  </div>
                  <div className="p-5 rounded-xl bg-card border border-border bg-gradient-to-br from-card to-emerald-500/10">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 rounded-lg bg-white/5">
                        <Radio className="w-5 h-5 text-emerald-300" />
                      </div>
                      <span className="text-sm text-muted">Live Users</span>
                    </div>
                    <p className="text-3xl font-bold text-emerald-300">{analytics.live_users}</p>
                  </div>
                  <div className="p-5 rounded-xl bg-card border border-border bg-gradient-to-br from-card to-violet-500/10">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 rounded-lg bg-white/5">
                        <UserPlus className="w-5 h-5 text-violet-300" />
                      </div>
                      <span className="text-sm text-muted">New Users Today</span>
                    </div>
                    <p className="text-3xl font-bold text-violet-300">{analytics.new_users_today}</p>
                  </div>
                  <div className="p-5 rounded-xl bg-card border border-border bg-gradient-to-br from-card to-amber-500/10">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 rounded-lg bg-white/5">
                        <Activity className="w-5 h-5 text-muted" />
                      </div>
                      <span className="text-sm text-muted">Total Interviews</span>
                    </div>
                    <p className="text-3xl font-bold">{analytics.total_interviews}</p>
                  </div>
                  <div className="p-5 rounded-xl bg-card border border-border bg-gradient-to-br from-card to-lime-500/10">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 rounded-lg bg-white/5">
                        <BarChart3 className="w-5 h-5 text-muted" />
                      </div>
                      <span className="text-sm text-muted">Average Score</span>
                    </div>
                    <p className="text-3xl font-bold">{analytics.average_score}%</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-6 rounded-xl bg-card border border-border">
                    <div className="flex items-center gap-2 mb-4">
                      <Award className="w-5 h-5 text-yellow-400" />
                      <h2 className="text-lg font-semibold">Top Performers</h2>
                    </div>
                    {analytics.top_performers.length === 0 ? (
                      <p className="text-sm text-muted">No data yet</p>
                    ) : (
                      <div className="space-y-3">
                        {analytics.top_performers.map((p, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between p-3 rounded-lg bg-background border border-border"
                          >
                            <div className="flex items-center gap-3">
                              <span className="w-6 h-6 rounded-full bg-white/10 text-xs flex items-center justify-center font-bold">
                                {i + 1}
                              </span>
                              <div>
                                <p className="text-sm font-medium">{p.name}</p>
                                <p className="text-xs text-muted">{p.interview_count} interviews</p>
                              </div>
                            </div>
                            <span className="font-bold text-green-400">{p.avg_score}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="p-6 rounded-xl bg-card border border-border">
                    <div className="flex items-center gap-2 mb-4">
                      <TrendingDown className="w-5 h-5 text-red-400" />
                      <h2 className="text-lg font-semibold">Common Weak Areas</h2>
                    </div>
                    {analytics.common_weak_areas.length === 0 ? (
                      <p className="text-sm text-muted">No data yet</p>
                    ) : (
                      <div className="space-y-2">
                        {analytics.common_weak_areas.map((area, i) => (
                          <div
                            key={i}
                            className="px-4 py-3 rounded-lg bg-background border border-border text-sm"
                          >
                            {area}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-8 p-6 rounded-xl bg-card border border-border">
                  <h2 className="text-lg font-semibold mb-1">Quit Interview Alerts</h2>
                  <p className="text-sm text-muted mb-4">
                    Users who quit interviews, with date, time, day, and partial evaluation details.
                  </p>
                  {quitInterviews.length === 0 ? (
                    <p className="text-sm text-muted">No users have quit interviews yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {quitInterviews.map((item) => (
                        <div key={item.session_id} className="p-4 rounded-lg border border-border bg-background">
                          <div className="flex items-center justify-between gap-3 mb-2">
                            <div>
                              <p className="text-sm font-semibold">{item.user_name} ({item.user_email})</p>
                              <p className="text-xs text-muted">
                                Session: {item.session_id} • Role: {item.role_title}
                              </p>
                            </div>
                            <span className="text-xs px-2 py-1 rounded-full border border-red-500/40 text-red-400">
                              {item.status}
                            </span>
                          </div>
                          <p className="text-xs text-muted mb-2">
                            Quit on {item.quit_day || "Unknown day"}, {item.quit_date || "Unknown date"} at {item.quit_time || "Unknown time"}
                          </p>
                          <p className="text-xs text-muted mb-2">
                            Answered: {item.answered_count}/{item.max_questions} • Report generated: {item.report_generated ? "Yes" : "No"}
                          </p>
                          {item.report_generated ? (
                            <p className="text-xs text-muted">
                              Partial score: {item.overall_score ?? "N/A"}% • Evaluated Qs: {item.total_questions_evaluated ?? 0}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="text-muted">Failed to load analytics.</p>
            )}
          </div>
        </main>
      )}
    </ProtectedRoute>
  );
}
