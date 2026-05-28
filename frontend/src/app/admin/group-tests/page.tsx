"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import { GroupTest, GroupTestResult } from "@/types";
import { Topic } from "@/types";
import { Department } from "@/types/admin";
import { JobDescription } from "@/types";
import {
  Layers,
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Loader2,
  X,
  BarChart3,
  UserCheck,
  Briefcase,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface AdminUser {
  id: string;
  name: string;
  email: string;
  reg_no?: string | null;
}

export default function AdminGroupTestsPage() {
  const [items, setItems] = useState<GroupTest[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [allUsers, setAllUsers] = useState<AdminUser[]>([]);
  const [joiningYears, setJoiningYears] = useState<string[]>([]);
  const [adminJDs, setAdminJDs] = useState<JobDescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showTargetSection, setShowTargetSection] = useState(false);

  // Additional students picker state
  const [addStudentDept, setAddStudentDept] = useState<string>("");

  const [form, setForm] = useState({
    name: "",
    description: "",
    jd_id: "",
    topic_ids: [] as string[],
    time_limit_minutes: "",
    max_attempts: "1",
    allowedDeptCodes: [] as string[],
    allowedYears: [] as string[],
    allowedUserIds: [] as string[],
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [groupRes, topicsRes, deptsRes, usersRes, yearsRes, jdRes] = await Promise.all([
        api.get("/admin/group-tests"),
        api.get("/admin/topics"),
        api.get("/admin/departments"),
        api.get("/admin/users"),
        api.get("/admin/settings/joining-years"),
        api.get("/admin/job-descriptions"),
      ]);
      setItems(groupRes.data.items || []);
      setTopics(topicsRes.data.topics || []);
      setDepartments(deptsRes.data?.items || []);
      setAllUsers(usersRes.data?.items || []);
      setJoiningYears(yearsRes.data?.years || []);
      setAdminJDs(jdRes.data?.items || []);
    } catch (err) {
      console.error("Failed to load data", err);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setShowForm(false);
    setShowTargetSection(false);
    setAddStudentDept("");
    setForm({ name: "", description: "", jd_id: "", topic_ids: [], time_limit_minutes: "", max_attempts: "1", allowedDeptCodes: [], allowedYears: [], allowedUserIds: [] });
  };

  const editItem = (item: GroupTest) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      description: item.description || "",
      jd_id: item.jd_id || "",
      topic_ids: item.topic_ids || [],
      time_limit_minutes: item.time_limit_minutes ? String(item.time_limit_minutes) : "",
      max_attempts: String(item.max_attempts ?? 1),
      allowedDeptCodes: item.allowed_dept_codes || [],
      allowedYears: item.allowed_years || [],
      allowedUserIds: item.allowed_user_ids || [],
    });
    const hasTargeting = (item.allowed_dept_codes?.length || 0) + (item.allowed_years?.length || 0) + (item.allowed_user_ids?.length || 0) > 0;
    setShowTargetSection(hasTargeting);
    setAddStudentDept("");
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleTopicSelection = (topicId: string) => {
    setForm((prev) => ({
      ...prev,
      topic_ids: prev.topic_ids.includes(topicId)
        ? prev.topic_ids.filter((id) => id !== topicId)
        : [...prev.topic_ids, topicId],
    }));
  };

  const saveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Group test name is required");
      return;
    }
    if (form.topic_ids.length === 0) {
      toast.error("Select at least one topic");
      return;
    }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      jd_id: form.jd_id || null,
      topic_ids: form.topic_ids,
      time_limit_minutes: form.time_limit_minutes ? parseInt(form.time_limit_minutes) : null,
      max_attempts: parseInt(form.max_attempts) || 1,
      allowed_dept_codes: form.allowedDeptCodes.length > 0 ? form.allowedDeptCodes : null,
      allowed_years: form.allowedYears.length > 0 ? form.allowedYears : null,
      allowed_user_ids: form.allowedUserIds.length > 0 ? form.allowedUserIds : null,
    };

    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/admin/group-tests/${editingId}`, payload);
        toast.success("Group test updated");
      } else {
        await api.post("/admin/group-tests", payload);
        toast.success("Group test created");
      }
      resetForm();
      fetchData();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to save group test");
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = (id: string, name: string) => {
    toast(`Delete "${name}"?`, {
      description: "All student results for this group test will remain but the test won't be accessible.",
      action: {
        label: "Delete",
        onClick: async () => {
          try {
            await api.delete(`/admin/group-tests/${id}`);
            if (editingId === id) resetForm();
            fetchData();
          } catch (err: any) {
            toast.error(err.response?.data?.detail || "Failed to delete");
          }
        },
      },
      cancel: { label: "Cancel", onClick: () => {} },
    });
  };

  const togglePublish = async (item: GroupTest) => {
    try {
      await api.patch(`/admin/group-tests/${item.id}/publish`, {
        is_published: !item.is_published,
      });
      fetchData();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to update visibility");
    }
  };

  const scoreColor = (s: number) =>
    s >= 70 ? "text-green-400" : s >= 40 ? "text-yellow-400" : "text-red-400";

  // Users from the selected dept for the additional-students picker
  const usersInPickerDept = useMemo(() => {
    if (!addStudentDept) return [];
    return allUsers.filter((u) => {
      if (!u.reg_no || u.reg_no.length < 9) return false;
      return u.reg_no.slice(6, 9) === addStudentDept;
    });
  }, [allUsers, addStudentDept]);

  return (
    <ProtectedRoute requiredRole="admin">
      <Navbar />
      <main className="pt-20 md:pt-8 pb-12 px-4 max-w-5xl mx-auto md:ml-[var(--admin-sidebar-width,250px)]">
        <div className="animate-fade-in">
          <div className="flex items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              <Layers className="w-6 h-6" />
              <h1 className="text-2xl font-bold">Group Tests</h1>
            </div>
            {!showForm && (
              <button
                onClick={() => setShowForm(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white text-black text-sm font-medium hover:bg-gray-200"
              >
                <Plus className="w-4 h-4" />
                New Group Test
              </button>
            )}
          </div>

          {/* ── Form ── */}
          {showForm && (
            <div className="app-panel mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold">{editingId ? "Edit Group Test" : "New Group Test"}</h2>
                <button onClick={resetForm} className="text-muted hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={saveItem} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    placeholder="Group test name *"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    className="app-control"
                  />
                  <input
                    placeholder="Description (optional)"
                    value={form.description}
                    onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                    className="app-control"
                  />
                  <div>
                    <label className="text-xs text-muted mb-1 block">Time limit per topic (minutes, blank = no limit)</label>
                    <input
                      type="number"
                      min="1"
                      placeholder="e.g. 30"
                      value={form.time_limit_minutes}
                      onChange={(e) => setForm((p) => ({ ...p, time_limit_minutes: e.target.value }))}
                      className="app-control"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted mb-1 block">Max attempts per student</label>
                    <input
                      type="number"
                      min="1"
                      placeholder="e.g. 2"
                      value={form.max_attempts}
                      onChange={(e) => setForm((p) => ({ ...p, max_attempts: e.target.value }))}
                      className="app-control"
                    />
                  </div>
                </div>

                {/* JD Mapping */}
                <div>
                  <label className="text-xs text-muted mb-1 flex items-center gap-1.5 block">
                    <Briefcase className="w-3.5 h-3.5" />
                    Link to Job Description
                    <span className="text-muted-foreground font-normal"></span>
                  </label>
                  {adminJDs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No job descriptions found.{" "}
                      <a href="/admin/job-descriptions" className="text-primary underline">Create a JD first.</a>
                    </p>
                  ) : (
                    <select
                      className="app-control"
                      value={form.jd_id}
                      onChange={(e) => setForm((p) => ({ ...p, jd_id: e.target.value }))}
                    >
                      <option value="">— No JD (unlinked) —</option>
                      {adminJDs.map((jd) => (
                        <option key={jd.id} value={jd.id}>
                          {jd.title}{jd.company ? ` — ${jd.company}` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Topic selector */}
                <div>
                  <p className="text-xs text-muted mb-2">
                    Select topics *{" "}
                    <span className="text-amber-400">(topics must already exist)</span>
                  </p>
                  {topics.length === 0 ? (
                    <p className="text-sm text-muted">
                      No topics found.{" "}
                      <a href="/admin/topics" className="text-primary underline">
                        Create topics first.
                      </a>
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {topics.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => toggleTopicSelection(t.id)}
                          className={`px-3 py-2 rounded-lg text-sm border transition-all text-left ${
                            form.topic_ids.includes(t.id)
                              ? "bg-primary text-white border-primary"
                              : "bg-transparent text-muted border-border hover:border-primary/40"
                          }`}
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {form.topic_ids.length > 0 && (
                    <p className="text-xs text-muted mt-2">
                      Selected: {form.topic_ids
                        .map((id) => topics.find((t) => t.id === id)?.name || id)
                        .join(", ")}
                    </p>
                  )}
                </div>

                {/* Target Students */}
                <div className="border border-border rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowTargetSection((v) => !v)}
                    className="cursor-pointer w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-left hover:bg-muted/30 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <UserCheck className="w-4 h-4" />
                      Target Students{" "}
                      <span className="text-xs text-muted-foreground font-normal">(optional — leave empty for all students)</span>
                    </span>
                    {showTargetSection ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>

                  {showTargetSection && (
                    <div className="px-4 pb-4 space-y-5 border-t border-border/60">
                      {/* Department filter */}
                      <div className="pt-4">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-medium">Departments (3-digit code from reg_no)</p>
                          {departments.length > 0 && (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setForm((p) => ({ ...p, allowedDeptCodes: departments.map((d) => d.code) }))}
                                className="text-xs text-primary hover:underline"
                              >
                                Select All
                              </button>
                              <span className="text-muted text-xs">·</span>
                              <button
                                type="button"
                                onClick={() => setForm((p) => ({ ...p, allowedDeptCodes: [] }))}
                                className="text-xs text-muted hover:text-white"
                              >
                                Uncheck All
                              </button>
                            </div>
                          )}
                        </div>
                        {departments.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No departments defined. <a href="/admin/settings" className="text-primary underline">Add departments in Settings.</a></p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {departments.map((dept) => (
                              <button
                                key={dept.id}
                                type="button"
                                onClick={() =>
                                  setForm((p) => ({
                                    ...p,
                                    allowedDeptCodes: p.allowedDeptCodes.includes(dept.code)
                                      ? p.allowedDeptCodes.filter((c) => c !== dept.code)
                                      : [...p.allowedDeptCodes, dept.code],
                                  }))
                                }
                                className={`cursor-pointer px-3 py-1.5 rounded-lg text-xs border transition-all ${
                                  form.allowedDeptCodes.includes(dept.code)
                                    ? "bg-primary text-white border-primary"
                                    : "bg-transparent text-muted-foreground border-border hover:border-primary/40"
                                }`}
                              >
                                {dept.name} ({dept.code})
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Year filter */}
                      <div>
                        <p className="text-xs font-medium mb-2">Joining Years</p>
                        {joiningYears.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No joining years configured. <a href="/admin/settings" className="text-primary underline">Add years in Settings.</a></p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {joiningYears.map((y) => (
                              <button
                                key={y}
                                type="button"
                                onClick={() =>
                                  setForm((p) => ({
                                    ...p,
                                    allowedYears: p.allowedYears.includes(y)
                                      ? p.allowedYears.filter((v) => v !== y)
                                      : [...p.allowedYears, y],
                                  }))
                                }
                                className={`cursor-pointer px-3 py-1.5 rounded-lg text-xs border transition-all ${
                                  form.allowedYears.includes(y)
                                    ? "bg-primary text-white border-primary"
                                    : "bg-transparent text-muted-foreground border-border hover:border-primary/40"
                                }`}
                              >
                                20{y}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Additional Students */}
                      <div>
                        <p className="text-xs font-medium mb-1">Additional Students</p>
                        <p className="text-xs text-muted-foreground mb-2">
                          Add specific students from other departments. They get access regardless of dept/year filters above.
                        </p>

                        {/* Dept picker for filtering students */}
                        <div className="flex flex-wrap gap-2 mb-3">
                          <select
                            className="app-control text-xs py-1.5 w-56"
                            value={addStudentDept}
                            onChange={(e) => setAddStudentDept(e.target.value)}
                          >
                            <option value="">Filter by department...</option>
                            {departments.map((d) => (
                              <option key={d.id} value={d.code}>{d.name} ({d.code})</option>
                            ))}
                          </select>
                        </div>

                        {/* Students list for selected dept */}
                        {addStudentDept && (
                          <div className="border border-border/60 rounded-lg max-h-48 overflow-y-auto mb-3">
                            {usersInPickerDept.length === 0 ? (
                              <p className="text-xs text-muted-foreground p-3">No students found in this department.</p>
                            ) : (
                              <div className="divide-y divide-border/40">
                                {usersInPickerDept.map((u) => {
                                  const selected = form.allowedUserIds.includes(u.id);
                                  return (
                                    <label
                                      key={u.id}
                                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer text-xs hover:bg-muted/30 transition-colors ${selected ? "bg-primary/5" : ""}`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={selected}
                                        onChange={() =>
                                          setForm((p) => ({
                                            ...p,
                                            allowedUserIds: selected
                                              ? p.allowedUserIds.filter((id) => id !== u.id)
                                              : [...p.allowedUserIds, u.id],
                                          }))
                                        }
                                        className="accent-primary"
                                      />
                                      <span className="flex-1 min-w-0">
                                        <span className="font-medium">{u.name}</span>
                                        <span className="text-muted-foreground ml-1.5">{u.reg_no || u.email}</span>
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Selected additional students chips */}
                        {form.allowedUserIds.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {form.allowedUserIds.map((uid) => {
                              const u = allUsers.find((x) => x.id === uid);
                              return (
                                <span key={uid} className="flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">
                                  {u ? u.name : uid}
                                  <button
                                    type="button"
                                    onClick={() => setForm((p) => ({ ...p, allowedUserIds: p.allowedUserIds.filter((id) => id !== uid) }))}
                                    className="cursor-pointer hover:opacity-70"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-1.5 rounded-lg bg-white text-black text-sm font-medium hover:bg-gray-200 disabled:opacity-40 inline-flex items-center gap-2"
                  >
                    {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                    {editingId ? "Update" : "Create"}
                  </button>
                  <button type="button" onClick={resetForm} className="app-btn">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ── List ── */}
          {loading ? (
            <div className="text-sm text-muted">Loading...</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-muted">No group tests yet. Create one above.</div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.id} className="app-panel">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold">{item.name}</p>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full border ${
                            item.is_published
                              ? "border-green-500/40 text-green-400 bg-green-500/8"
                              : "border-border text-muted bg-white/5"
                          }`}
                        >
                          {item.is_published ? "Published" : "Draft"}
                        </span>
                        {item.jd_id && (() => {
                          const jd = adminJDs.find((j) => j.id === item.jd_id);
                          return jd ? (
                            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-blue-500/30 text-blue-400 bg-blue-500/8">
                              <Briefcase className="w-3 h-3" />
                              {jd.title}
                            </span>
                          ) : null;
                        })()}
                      </div>
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
                      <p className="text-xs text-muted mt-2">
                        {item.time_limit_minutes
                          ? `${item.time_limit_minutes} min/topic`
                          : "No time limit"}{" "}
                        · Max {item.max_attempts} attempt{item.max_attempts !== 1 ? "s" : ""}
                      </p>
                      {/* Targeting badges */}
                      {((item.allowed_dept_codes?.length || 0) + (item.allowed_years?.length || 0) + (item.allowed_user_ids?.length || 0)) > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {(item.allowed_dept_codes || []).map((c) => (
                            <span key={c} className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">Dept:{c}</span>
                          ))}
                          {(item.allowed_years || []).map((y) => (
                            <span key={y} className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">20{y}</span>
                          ))}
                          {(item.allowed_user_ids?.length || 0) > 0 && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">+{item.allowed_user_ids!.length} student{item.allowed_user_ids!.length !== 1 ? "s" : ""}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                      <Link
                        href={`/admin/group-tests/${item.id}/results`}
                        className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border text-xs text-muted hover:text-white hover:border-white/40"
                      >
                        <BarChart3 className="w-3.5 h-3.5" />
                        Results
                      </Link>
                      <button
                        onClick={() => togglePublish(item)}
                        className={`flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs transition-all ${
                          item.is_published
                            ? "border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                            : "border-green-500/40 text-green-400 hover:bg-green-500/10"
                        }`}
                      >
                        {item.is_published ? (
                          <>
                            <EyeOff className="w-3.5 h-3.5" /> Unpublish
                          </>
                        ) : (
                          <>
                            <Eye className="w-3.5 h-3.5" /> Publish
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => editItem(item)}
                        className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border text-xs text-muted hover:text-white hover:border-white/40"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      <button
                        onClick={() => deleteItem(item.id, item.name)}
                        className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-red-500/40 text-red-400 text-xs hover:bg-red-500/10"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </ProtectedRoute>
  );
}
