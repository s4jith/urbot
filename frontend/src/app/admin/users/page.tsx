"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import { Department } from "@/types/admin";
import { AdminUser } from "@/types";
import { Users, Trash2, Search, X } from "lucide-react";

function parseRegNo(reg: string | undefined | null) {
  if (!reg || reg.length !== 12) return null;
  return {
    collegeCode: reg.slice(0, 4),
    year: reg.slice(4, 6),
    deptCode: reg.slice(6, 9),
    studentId: reg.slice(9, 12),
  };
}

export default function AdminUsersPage() {
  const [items, setItems] = useState<AdminUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [page, setPage] = useState(1);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  const pageSize = 10;

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/users?limit=500");
      setItems(data.items || []);
    } catch (err) {
      console.error("Failed to fetch users", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDepts = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/departments");
      setDepartments(data.items ?? []);
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchDepts();
  }, [fetchUsers, fetchDepts]);

  // Unique years from loaded users
  const uniqueYears = useMemo(() => {
    const years = new Set<string>();
    items.forEach((u) => {
      const p = parseRegNo(u.reg_no);
      if (p) years.add(p.year);
    });
    return Array.from(years).sort();
  }, [items]);

  // Unique dept codes (with names from departments)
  const uniqueDeptCodes = useMemo(() => {
    const codes = new Set<string>();
    items.forEach((u) => {
      const p = parseRegNo(u.reg_no);
      if (p) codes.add(p.deptCode);
    });
    return Array.from(codes).sort();
  }, [items]);

  function getDeptName(code: string) {
    const dept = departments.find((d) => d.code === code);
    return dept ? dept.name : code;
  }

  const filteredItems = useMemo(() => {
    let result = items;
    const term = query.trim().toLowerCase();
    if (term) {
      result = result.filter(
        (user) =>
          user.name.toLowerCase().includes(term) ||
          user.email.toLowerCase().includes(term) ||
          (user.reg_no || "").toLowerCase().includes(term)
      );
    }
    if (deptFilter) {
      result = result.filter((user) => {
        const p = parseRegNo(user.reg_no);
        return p?.deptCode === deptFilter;
      });
    }
    if (yearFilter) {
      result = result.filter((user) => {
        const p = parseRegNo(user.reg_no);
        return p?.year === yearFilter;
      });
    }
    return result;
  }, [items, query, deptFilter, yearFilter]);

  useEffect(() => {
    setPage(1);
  }, [query, deptFilter, yearFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const visibleItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);

  const removeUser = async (user: AdminUser) => {
    const confirmed = confirm(`Delete user ${user.name} (${user.email})? This will remove related sessions/reports.`);
    if (!confirmed) return;

    setDeletingUserId(user.id);
    try {
      await api.delete(`/admin/users/${user.id}`);
      setItems((prev) => prev.filter((item) => item.id !== user.id));
    } catch (err: unknown) {
      const errAny = err as { response?: { data?: { detail?: string } } };
      alert(errAny.response?.data?.detail || "Failed to delete user");
    } finally {
      setDeletingUserId(null);
    }
  };

  const hasFilters = query || deptFilter || yearFilter;

  return (
    <ProtectedRoute requiredRole="admin">
      <Navbar />
      <main className="pt-20 md:pt-8 pb-12 px-4 max-w-6xl mx-auto md:ml-[var(--admin-sidebar-width,250px)]">
        <div className="animate-fade-in space-y-6">
          <section className="rounded-2xl border border-border bg-gradient-to-br from-card to-black/40 p-6">
            <div className="flex items-center gap-3 mb-2">
              <Users className="w-6 h-6" />
              <h1 className="text-2xl font-bold">Registered Users</h1>
            </div>
            <p className="text-sm text-muted">View all registered users and remove accounts when required.</p>
          </section>

          <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
            {/* Search */}
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name or email"
                  className="w-full pl-9 app-control"
                />
              </div>
              {/* Year filter */}
              <select
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
                className="app-control min-w-[140px] cursor-pointer"
              >
                <option value="">All Years</option>
                {uniqueYears.map((y) => (
                  <option key={y} value={y}>
                    20{y}
                  </option>
                ))}
              </select>
              {/* Department filter */}
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="app-control min-w-[180px] cursor-pointer"
              >
                <option value="">All Departments</option>
                {uniqueDeptCodes.map((code) => (
                  <option key={code} value={code}>
                    {getDeptName(code)} ({code})
                  </option>
                ))}
              </select>
              {hasFilters && (
                <button
                  onClick={() => { setQuery(""); setDeptFilter(""); setYearFilter(""); }}
                  className="cursor-pointer flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted/40"
                >
                  <X className="w-4 h-4" /> Clear
                </button>
              )}
            </div>
            {/* Active filter chips */}
            {hasFilters && (
              <div className="flex flex-wrap gap-2 text-xs">
                {query && (
                  <span className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-full">
                    Search: &quot;{query}&quot;
                    <button onClick={() => setQuery("")} className="cursor-pointer hover:opacity-70"><X className="w-3 h-3" /></button>
                  </span>
                )}
                {yearFilter && (
                  <span className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-full">
                    Year: 20{yearFilter}
                    <button onClick={() => setYearFilter("")} className="cursor-pointer hover:opacity-70"><X className="w-3 h-3" /></button>
                  </span>
                )}
                {deptFilter && (
                  <span className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-full">
                    Dept: {getDeptName(deptFilter)}
                    <button onClick={() => setDeptFilter("")} className="cursor-pointer hover:opacity-70"><X className="w-3 h-3" /></button>
                  </span>
                )}
              </div>
            )}
          </section>

          {loading ? (
            <div className="text-center text-muted mt-12 animate-pulse-slow">Loading users...</div>
          ) : filteredItems.length === 0 ? (
            <section className="rounded-2xl border border-border bg-card p-10 text-center">
              <p className="text-muted">No users found.</p>
            </section>
          ) : (
            <section className="rounded-2xl border border-border bg-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-white/5 text-muted">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Name</th>
                      <th className="text-left px-4 py-3 font-medium">Email</th>
                      <th className="text-left px-4 py-3 font-medium">Reg No</th>
                      <th className="text-left px-4 py-3 font-medium">Dept</th>
                      <th className="text-left px-4 py-3 font-medium">Year</th>
                      <th className="text-left px-4 py-3 font-medium">Joined</th>
                      <th className="text-left px-4 py-3 font-medium">Interviews</th>
                      <th className="text-left px-4 py-3 font-medium">Reports</th>
                      <th className="text-right px-4 py-3 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((user) => {
                      const parsed = parseRegNo(user.reg_no);
                      return (
                      <tr key={user.id} className="border-t border-border/70">
                        <td className="px-4 py-3 font-medium">{user.name || "Unknown"}</td>
                        <td className="px-4 py-3 text-muted">{user.email}</td>
                        <td className="px-4 py-3 font-mono text-xs text-primary">{user.reg_no || <span className="text-muted italic">—</span>}</td>
                        <td className="px-4 py-3 text-sm">
                          {parsed ? (
                            <span title={getDeptName(parsed.deptCode)} className="font-mono">{parsed.deptCode}</span>
                          ) : <span className="text-muted">—</span>}
                        </td>
                        <td className="px-4 py-3 text-sm">{parsed ? `20${parsed.year}` : <span className="text-muted">—</span>}</td>
                        <td className="px-4 py-3 text-muted">{user.created_at ? new Date(user.created_at).toLocaleDateString() : "-"}</td>
                        <td className="px-4 py-3">{user.interview_count}</td>
                        <td className="px-4 py-3">{user.report_count}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => removeUser(user)}
                            disabled={deletingUserId === user.id}
                            className="cursor-pointer inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="px-4 py-3 border-t border-border/70 flex items-center justify-between gap-2">
                <p className="text-xs text-muted">
                  Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, filteredItems.length)} of {filteredItems.length}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 rounded-lg border border-border text-sm disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <span className="text-sm text-muted">{page}/{totalPages}</span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 rounded-lg border border-border text-sm disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
    </ProtectedRoute>
  );
}
