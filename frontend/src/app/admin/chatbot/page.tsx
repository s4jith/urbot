"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import {
  FileSpreadsheet,
  FileText,
  Save,
  Loader2,
  Edit3,
  Check,
  X,
  Users,
  ChevronDown,
  SlidersHorizontal,
  RefreshCcw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Calendar,
  Building2,
  ClipboardList,
  Filter,
  Plus,
  Trash2,
  GripVertical,
  Search,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TopicScore {
  topic_name: string;
  score: number | null;
  status: string;
}

interface StudentRow {
  user_id: string;
  reg_no: string;
  name: string;
  email: string;
  group_test_id: string;
  group_test_name: string;
  overall_score: number;
  total_attempts: number;
  status: string;
  topic_scores: Record<string, TopicScore>;
  skill_match: number | null;
  rank: number;
  attempt_time: string | null;
  duration_minutes: number | null;
}

interface TopicColumn {
  id: string;
  name: string;
}

interface FilterResult {
  group_test_name: string;
  group_test_id: string | null;
  topic_columns: TopicColumn[];
  rows: StudentRow[];
  total: number;
}

interface GroupTestItem {
  id: string;
  name: string;
}

interface JD {
  id: string;
  title: string;
  company?: string | null;
}

type SortField = "time" | "score" | "duration";
type SortOrder = "asc" | "desc";

interface SortRule {
  id: string;
  field: SortField;
  order: SortOrder;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtScore(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toFixed(1)}%`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtDuration(mins: number | null | undefined): string {
  if (mins == null) return "—";
  if (mins < 60) return `${mins.toFixed(0)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const SORT_FIELD_LABELS: Record<SortField, string> = {
  time: "Attempt Time",
  score: "Score",
  duration: "Duration",
};

const SORT_ORDER_LABELS: Record<SortField, Record<SortOrder, string>> = {
  time: { desc: "Newest first", asc: "Oldest first" },
  score: { desc: "Highest first", asc: "Lowest first" },
  duration: { desc: "Longest first", asc: "Shortest first" },
};

let _idCounter = 0;
function genId() { return `sort-${++_idCounter}`; }

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const s = (status || "").replace(/_/g, " ").toLowerCase();
  const cls: Record<string, string> = {
    completed: "bg-emerald-100 text-emerald-700",
    "in progress": "bg-amber-100 text-amber-700",
    pending: "bg-slate-100 text-slate-600",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${cls[s] || "bg-slate-100 text-slate-600"}`}>
      {s}
    </span>
  );
}

function ScorePill({ score }: { score: number }) {
  const cls =
    score >= 80 ? "bg-emerald-100 text-emerald-700"
    : score >= 60 ? "bg-amber-100 text-amber-700"
    : "bg-red-100 text-red-600";
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      {score.toFixed(1)}%
    </span>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold border border-primary/20">
      {label}
      <button
        onClick={onRemove}
        className="hover:text-red-500 transition-colors cursor-pointer"
        type="button"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

function SectionLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold text-muted flex items-center gap-1.5 uppercase tracking-wider mb-2">
      {icon}
      {children}
    </p>
  );
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

function buildCSV(rows: StudentRow[], topicCols: TopicColumn[], gtName: string): void {
  const hasJd = rows.some((r) => r.skill_match != null);
  const headers = [
    "Rank", "Reg No", "Name", "Email",
    ...topicCols.map((tc) => `${tc.name} Score`),
    "Overall Score", "Attempts", "Status",
    "Attempt Time", "Duration (min)",
    ...(hasJd ? ["JD Match (%)"] : []),
  ];
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [
    headers,
    ...rows.map((r) => [
      r.rank, r.reg_no, r.name, r.email,
      ...topicCols.map((tc) => { const ts = r.topic_scores?.[tc.id]; return ts?.score != null ? `${ts.score.toFixed(1)}%` : "N/A"; }),
      fmtScore(r.overall_score), r.total_attempts, r.status,
      r.attempt_time ? new Date(r.attempt_time).toLocaleString() : "N/A",
      r.duration_minutes != null ? r.duration_minutes.toFixed(1) : "N/A",
      ...(hasJd ? [r.skill_match != null ? `${r.skill_match.toFixed(1)}%` : "N/A"] : []),
    ]),
  ].map((row) => row.map(esc).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${gtName.replace(/\s+/g, "_")}_students.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Editable Cell ────────────────────────────────────────────────────────────

interface EditableCellProps {
  value: string;
  isEditing: boolean;
  editValue: string;
  onEditValueChange: (v: string) => void;
  onStartEdit: () => void;
  onCommit: () => void;
  onCancel: () => void;
  modified?: boolean;
}

function EditableCell({
  value, isEditing, editValue, onEditValueChange,
  onStartEdit, onCommit, onCancel, modified,
}: EditableCellProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (isEditing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [isEditing]);

  if (isEditing) {
    return (
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onCommit(); if (e.key === "Escape") onCancel(); }}
            onBlur={onCommit}
            className="flex-1 min-w-0 text-sm border border-primary/50 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary bg-white"
          />
          <button onMouseDown={(e) => { e.preventDefault(); onCommit(); }} className="p-0.5 text-emerald-600 hover:text-emerald-700 cursor-pointer"><Check className="w-3.5 h-3.5" /></button>
          <button onMouseDown={(e) => { e.preventDefault(); onCancel(); }} className="p-0.5 text-red-500 hover:text-red-600 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
        </div>
      </td>
    );
  }
  return (
    <td className={`px-3 py-2.5 cursor-pointer group ${modified ? "font-semibold text-amber-700" : ""}`} onClick={onStartEdit} title="Click to edit">
      <span className="flex items-center gap-1">
        {value || <span className="text-muted/50 italic text-xs">N/A</span>}
        <Edit3 className="w-3 h-3 text-muted/25 group-hover:text-primary/50 transition-colors shrink-0" />
      </span>
    </td>
  );
}

// ─── Sort Rule Row ────────────────────────────────────────────────────────────

function SortRuleRow({
  rule, index, total, onChange, onRemove,
}: {
  rule: SortRule;
  index: number;
  total: number;
  onChange: (id: string, patch: Partial<SortRule>) => void;
  onRemove: (id: string) => void;
}) {
  const orderOpts: SortOrder[] = ["desc", "asc"];
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-background border border-border">
      <GripVertical className="w-3.5 h-3.5 text-muted/40 shrink-0" />
      <span className="text-xs text-muted w-5 shrink-0 text-right">{index + 1}.</span>

      {/* Field select */}
      <div className="relative flex-1 min-w-0">
        <select
          value={rule.field}
          onChange={(e) => onChange(rule.id, { field: e.target.value as SortField })}
          className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-primary appearance-none pr-6 cursor-pointer"
        >
          <option value="time">Attempt Time</option>
          <option value="score">Score</option>
          <option value="duration">Duration</option>
        </select>
        <ChevronDown className="w-3 h-3 text-muted absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>

      {/* Order toggle */}
      <div className="flex rounded-lg border border-border overflow-hidden shrink-0">
        {orderOpts.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(rule.id, { order: o })}
            title={SORT_ORDER_LABELS[rule.field][o]}
            className={`px-2 py-1.5 text-xs font-semibold flex items-center gap-0.5 transition-colors cursor-pointer ${
              rule.order === o ? "bg-primary text-white" : "bg-white text-muted hover:bg-slate-50"
            }`}
          >
            {o === "desc" ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />}
            {o === "desc" ? "↓" : "↑"}
          </button>
        ))}
      </div>

      {/* Remove */}
      {total > 1 && (
        <button
          type="button"
          onClick={() => onRemove(rule.id)}
          className="p-1 text-muted hover:text-red-500 transition-colors cursor-pointer shrink-0"
          title="Remove sort"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StudentFilterPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <Navbar />
      <main
        style={{ marginLeft: "var(--admin-sidebar-width, 250px)" }}
        className="min-h-screen pt-6 pb-12 px-4 transition-all duration-200"
      >
        <FilterContent />
      </main>
    </ProtectedRoute>
  );
}

// ─── Main Content ─────────────────────────────────────────────────────────────

function FilterContent() {
  // Reference data
  const [groupTests, setGroupTests] = useState<GroupTestItem[]>([]);
  const [jdList, setJdList] = useState<JD[]>([]);
  const [loadingRef, setLoadingRef] = useState(true);

  // Filter state
  const [selGroupTests, setSelGroupTests] = useState<Set<string>>(new Set());
  const [selJd, setSelJd] = useState("");
  const [selCompanies, setSelCompanies] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [topK, setTopK] = useState("");
  const [minScore, setMinScore] = useState("");
  const [nameSearch, setNameSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "in_progress">("all");

  // Multi-sort
  const [sortRules, setSortRules] = useState<SortRule[]>([
    { id: genId(), field: "time", order: "desc" },
  ]);

  // Results
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FilterResult | null>(null);
  const [tableRows, setTableRows] = useState<StudentRow[]>([]);

  // Inline edit
  type EditField = "reg_no" | "name";
  const [editCell, setEditCell] = useState<{ userId: string; field: EditField } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [dirtyRows, setDirtyRows] = useState<Record<string, { reg_no?: string; name?: string }>>({});
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Load reference data
  useEffect(() => {
    Promise.all([api.get("/admin/group-tests"), api.get("/admin/job-descriptions")])
      .then(([gtRes, jdRes]) => {
        setGroupTests(gtRes.data.items || []);
        setJdList(jdRes.data.items || []);
      })
      .catch(() => toast.error("Failed to load filter options"))
      .finally(() => setLoadingRef(false));
  }, []);

  const companies = useMemo(() => {
    const s = new Set<string>();
    jdList.forEach((j) => { if (j.company) s.add(j.company); });
    return Array.from(s).sort();
  }, [jdList]);

  const filteredJdList = useMemo(() => {
    if (selCompanies.size === 0) return jdList;
    return jdList.filter((j) => j.company && selCompanies.has(j.company));
  }, [jdList, selCompanies]);

  useEffect(() => {
    if (selJd && !filteredJdList.find((j) => j.id === selJd)) setSelJd("");
  }, [filteredJdList, selJd]);

  // Sort rule helpers
  function addSortRule() {
    const usedFields = new Set(sortRules.map((r) => r.field));
    const next = (["time", "score", "duration"] as SortField[]).find((f) => !usedFields.has(f));
    if (!next) { toast.info("All sort fields already added."); return; }
    setSortRules((prev) => [...prev, { id: genId(), field: next, order: "desc" }]);
  }

  function updateSortRule(id: string, patch: Partial<SortRule>) {
    setSortRules((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, ...patch };
        // if field changed, reset order to desc
        if (patch.field && patch.field !== r.field) updated.order = "desc";
        return updated;
      })
    );
  }

  function removeSortRule(id: string) {
    setSortRules((prev) => prev.filter((r) => r.id !== id));
  }

  // Apply filters
  async function applyFilters() {
    setLoading(true);
    setDirtyRows({});
    setEditCell(null);
    try {
      const res = await api.post("/admin/students/filter", {
        group_test_ids: selGroupTests.size > 0 ? Array.from(selGroupTests) : null,
        jd_id: selJd || null,
        start_date: startDate || null,
        end_date: endDate || null,
        top_k: topK ? parseInt(topK, 10) : null,
        min_score: minScore ? parseFloat(minScore) : null,
        sort_fields: sortRules.map((r) => r.field),
        sort_orders: sortRules.map((r) => r.order),
      });
      setResult(res.data);
      setTableRows(res.data.rows);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to fetch results");
    } finally {
      setLoading(false);
    }
  }

  function resetFilters() {
    setSelGroupTests(new Set());
    setSelJd("");
    setSelCompanies(new Set());
    setStartDate("");
    setEndDate("");
    setTopK("");
    setMinScore("");
    setNameSearch("");
    setStatusFilter("all");
    setSortRules([{ id: genId(), field: "time", order: "desc" }]);
    setResult(null);
    setTableRows([]);
    setDirtyRows({});
    setEditCell(null);
  }

  // Client-side search + status filter
  const displayRows = useMemo(() => {
    let rows = tableRows;
    if (nameSearch.trim()) {
      const q = nameSearch.trim().toLowerCase();
      rows = rows.filter(
        (r) => r.name.toLowerCase().includes(q) || r.reg_no.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") rows = rows.filter((r) => r.status === statusFilter);
    return rows;
  }, [tableRows, nameSearch, statusFilter]);

  // Active chips
  const activeChips: { label: string; clear: () => void }[] = [];
  selGroupTests.forEach((id) => {
    const gt = groupTests.find((g) => g.id === id);
    activeChips.push({ label: `Test: ${gt?.name || id}`, clear: () => setSelGroupTests((p) => { const n = new Set(p); n.delete(id); return n; }) });
  });
  selCompanies.forEach((c) => {
    activeChips.push({ label: `Company: ${c}`, clear: () => setSelCompanies((p) => { const n = new Set(p); n.delete(c); return n; }) });
  });
  if (selJd) {
    const jd = filteredJdList.find((j) => j.id === selJd);
    activeChips.push({ label: `JD: ${jd?.title || selJd}`, clear: () => setSelJd("") });
  }
  if (startDate) activeChips.push({ label: `From: ${startDate}`, clear: () => setStartDate("") });
  if (endDate) activeChips.push({ label: `To: ${endDate}`, clear: () => setEndDate("") });
  if (minScore) activeChips.push({ label: `Min score: ${minScore}%`, clear: () => setMinScore("") });
  if (topK) activeChips.push({ label: `Top ${topK}`, clear: () => setTopK("") });

  // Inline edit
  function startEdit(userId: string, field: EditField, current: string) { setEditCell({ userId, field }); setEditValue(current); }
  function commitEdit() {
    if (!editCell) return;
    const { userId, field } = editCell;
    const original = tableRows.find((r) => r.user_id === userId)?.[field] ?? "";
    const trimmed = editValue.trim();
    if (trimmed !== original) setDirtyRows((p) => ({ ...p, [userId]: { ...(p[userId] || {}), [field]: trimmed } }));
    setTableRows((rows) => rows.map((r) => r.user_id === userId ? { ...r, [field]: trimmed || r[field] } : r));
    setEditCell(null);
  }
  function cancelEdit() { setEditCell(null); }

  async function saveChanges() {
    const entries = Object.entries(dirtyRows);
    if (!entries.length) { toast.info("No changes to save."); return; }
    setSaving(true);
    let saved = 0, failed = 0;
    for (const [userId, fields] of entries) {
      try { await api.patch("/admin/students", { user_id: userId, ...fields }); saved++; }
      catch { failed++; }
    }
    setSaving(false); setDirtyRows({});
    if (saved) toast.success(`Saved ${saved} update${saved > 1 ? "s" : ""}.`);
    if (failed) toast.error(`Failed to save ${failed}.`);
  }

  async function downloadExcel() {
    if (!result || !displayRows.length) return;
    setExporting(true);
    try {
      const res = await api.post(
        "/admin/students/export-excel",
        { rows: displayRows, topic_columns: result.topic_columns, group_test_name: result.group_test_name },
        { responseType: "blob" }
      );
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${result.group_test_name.replace(/\s+/g, "_")}_students.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      toast.success("Excel downloaded.");
    } catch { toast.error("Failed to export Excel."); }
    finally { setExporting(false); }
  }

  const hasDirty = Object.keys(dirtyRows).length > 0;
  const topicCols = result?.topic_columns || [];
  const hasJdMatch = displayRows.some((r) => r.skill_match != null);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex gap-5 items-start animate-fade-in max-w-[1600px] mx-auto">

      {/* ════════════════════ LEFT FILTER SIDEBAR ══════════════════════════ */}
      <aside className="w-72 shrink-0 sticky top-6 flex flex-col gap-4">

        {/* Header */}
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-5 h-5 text-primary shrink-0" />
          <h1 className="font-bold text-lg text-foreground">Student Filter</h1>
        </div>

        {/* ── Group Tests ─────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <SectionLabel icon={<ClipboardList className="w-3.5 h-3.5" />}>Group Tests</SectionLabel>
          {loadingRef ? (
            <p className="text-xs text-muted">Loading…</p>
          ) : groupTests.length === 0 ? (
            <p className="text-xs text-muted/60">No group tests found</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {groupTests.map((gt) => {
                const sel = selGroupTests.has(gt.id);
                return (
                  <button
                    key={gt.id}
                    type="button"
                    onClick={() => setSelGroupTests((p) => { const n = new Set(p); sel ? n.delete(gt.id) : n.add(gt.id); return n; })}
                    className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg border text-xs font-medium text-left transition-all cursor-pointer ${
                      sel
                        ? "bg-primary text-white border-primary shadow-sm"
                        : "border-border text-muted hover:border-primary/40 hover:text-foreground hover:bg-primary/5"
                    }`}
                  >
                    <span className={`w-3 h-3 rounded border flex items-center justify-center shrink-0 transition-colors ${sel ? "bg-white/30 border-white/50" : "border-border"}`}>
                      {sel && <Check className="w-2 h-2 text-white" />}
                    </span>
                    <span className="truncate">{gt.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Date Range ──────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <SectionLabel icon={<Calendar className="w-3.5 h-3.5" />}>Attempt Date Range</SectionLabel>
          <div className="flex flex-col gap-2">
            <div>
              <label className="block text-[11px] text-muted mb-1">From</label>
              <input type="date" value={startDate} max={endDate || undefined}
                onChange={(e) => setStartDate(e.target.value)}
                className="app-control cursor-pointer" />
            </div>
            <div>
              <label className="block text-[11px] text-muted mb-1">To</label>
              <input type="date" value={endDate} min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
                className="app-control cursor-pointer" />
            </div>
          </div>
        </div>

        {/* ── Company filter ───────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <SectionLabel icon={<Building2 className="w-3.5 h-3.5" />}>Company</SectionLabel>
          {companies.length === 0 ? (
            <p className="text-xs text-muted/60">No companies in JD list</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {companies.map((c) => {
                const sel = selCompanies.has(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setSelCompanies((p) => { const n = new Set(p); sel ? n.delete(c) : n.add(c); return n; })}
                    className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg border text-xs font-medium text-left transition-all cursor-pointer ${
                      sel
                        ? "bg-primary/15 text-primary border-primary/40"
                        : "border-border text-muted hover:border-primary/30 hover:text-foreground hover:bg-primary/5"
                    }`}
                  >
                    <span className={`w-3 h-3 rounded border flex items-center justify-center shrink-0 ${sel ? "bg-primary border-primary" : "border-border"}`}>
                      {sel && <Check className="w-2 h-2 text-white" />}
                    </span>
                    <span className="truncate">{c}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* JD select */}
          <div className="mt-3 pt-3 border-t border-border">
            <label className="block text-[11px] text-muted mb-1.5">
              Job Description <span className="text-muted/50">(enables JD Match column)</span>
            </label>
            <div className="relative">
              <select
                value={selJd}
                onChange={(e) => setSelJd(e.target.value)}
                disabled={loadingRef}
                className="app-control appearance-none pr-8 cursor-pointer"
              >
                <option value="">— None —</option>
                {filteredJdList.map((jd) => (
                  <option key={jd.id} value={jd.id}>
                    {jd.title}{jd.company ? ` (${jd.company})` : ""}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-muted absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* ── Sort Rules ───────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <SectionLabel icon={<ArrowUpDown className="w-3.5 h-3.5" />}>Sort Order</SectionLabel>
            {sortRules.length < 3 && (
              <button
                type="button"
                onClick={addSortRule}
                className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/70 font-semibold cursor-pointer"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {sortRules.map((rule, i) => (
              <SortRuleRow
                key={rule.id}
                rule={rule}
                index={i}
                total={sortRules.length}
                onChange={updateSortRule}
                onRemove={removeSortRule}
              />
            ))}
          </div>
        </div>

        {/* ── Score / TopK ─────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <SectionLabel icon={<Filter className="w-3.5 h-3.5" />}>Score & Limit</SectionLabel>
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-[11px] text-muted mb-1">Min Score (%)</label>
              <input type="number" min={0} max={100} value={minScore}
                onChange={(e) => setMinScore(e.target.value)}
                placeholder="e.g. 60"
                className="app-control" />
            </div>
            <div>
              <label className="block text-[11px] text-muted mb-1">
                Top K <span className="text-muted/50">(blank = all)</span>
              </label>
              <input type="number" min={1} value={topK}
                onChange={(e) => setTopK(e.target.value)}
                placeholder="e.g. 10"
                className="app-control" />
            </div>
          </div>
        </div>

        {/* Active chips */}
        {activeChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {activeChips.map((chip, i) => (
              <Chip key={i} label={chip.label} onRemove={chip.clear} />
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={applyFilters}
            disabled={loading}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl bg-primary hover:bg-secondary text-white font-semibold text-sm transition-colors shadow disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Filter className="w-4 h-4" />}
            {loading ? "Loading…" : "Apply Filters"}
          </button>
          <button
            type="button"
            onClick={resetFilters}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl border border-border hover:border-primary/40 text-muted hover:text-primary text-sm transition-colors cursor-pointer"
          >
            <RefreshCcw className="w-3.5 h-3.5" />
            Reset All
          </button>
        </div>
      </aside>

      {/* ════════════════════ RIGHT RESULTS PANEL ══════════════════════════ */}
      <div className="flex-1 min-w-0">

        {/* Quick search + status (above table) */}
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={nameSearch}
              onChange={(e) => setNameSearch(e.target.value)}
              placeholder="Search name / reg no / email…"
              className="w-full bg-white border border-border rounded-xl pl-8 pr-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary"
            />
          </div>
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | "completed" | "in_progress")}
              className="bg-white border border-border rounded-xl pl-4 pr-8 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary appearance-none cursor-pointer"
            >
              <option value="all">All status</option>
              <option value="completed">Completed</option>
              <option value="in_progress">In Progress</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-muted absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Empty state */}
        {!result && !loading && (
          <div className="app-empty-state mt-8">
            <SlidersHorizontal className="w-10 h-10 mx-auto mb-3 text-primary/30" />
            <p className="font-semibold text-foreground mb-1">Configure filters and click Apply</p>
            <p className="text-sm text-muted max-w-sm mx-auto text-center">
              Use the panel on the left to select group tests, date range, company, sort rules and more. All filters compose together.
            </p>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="app-panel animate-fade-in-soft">
            {/* Result header */}
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="font-bold text-foreground text-base">{result.group_test_name}</h2>
                <p className="text-xs text-muted mt-0.5">
                  {displayRows.length} student{displayRows.length !== 1 ? "s" : ""}
                  {displayRows.length !== tableRows.length && (
                    <span className="ml-1 text-muted/60">(filtered from {tableRows.length})</span>
                  )}
                  {" · "}Sorted by{" "}
                  {sortRules.map((r, i) => (
                    <span key={r.id}>
                      {i > 0 && <span className="text-muted/40"> → </span>}
                      <strong className="text-foreground">{SORT_FIELD_LABELS[r.field]}</strong>{" "}
                      <span className="text-muted/70">({r.order === "desc" ? "↓" : "↑"})</span>
                    </span>
                  ))}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {hasDirty && (
                  <button
                    type="button"
                    onClick={saveChanges}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Save Changes
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => buildCSV(displayRows, topicCols, result.group_test_name)}
                  disabled={!displayRows.length}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border hover:border-primary/40 text-sm text-foreground disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                >
                  <FileText className="w-3.5 h-3.5 text-muted" /> CSV
                </button>
                <button
                  type="button"
                  onClick={downloadExcel}
                  disabled={exporting || !displayRows.length}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold shadow disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
                  Excel
                </button>
              </div>
            </div>

            {hasDirty && (
              <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
                <Edit3 className="w-3 h-3 shrink-0" />
                {Object.keys(dirtyRows).length} unsaved change{Object.keys(dirtyRows).length > 1 ? "s" : ""} — click <strong>Save Changes</strong>.
              </div>
            )}

            {displayRows.length === 0 ? (
              <div className="app-empty-state">
                <Users className="w-10 h-10 mx-auto mb-3 text-muted/30" />
                <p className="text-sm text-muted">No students match the current filters.</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-muted mb-2 flex items-center gap-1">
                  <Edit3 className="w-3 h-3" />
                  Click <strong className="text-foreground">Reg No</strong> or <strong className="text-foreground">Name</strong> to edit inline.
                </p>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-primary text-white text-xs">
                        <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Rank</th>
                        <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Reg No</th>
                        <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Name</th>
                        <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Email</th>
                        {topicCols.map((tc) => (
                          <th key={tc.id} className="px-3 py-3 text-left font-semibold whitespace-nowrap">{tc.name}</th>
                        ))}
                        <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Overall</th>
                        <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Attempts</th>
                        <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Status</th>
                        <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Attempt Time</th>
                        <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Duration</th>
                        {hasJdMatch && <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">JD Match</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {displayRows.map((row, idx) => {
                        const isDirty = !!dirtyRows[row.user_id];
                        return (
                          <tr
                            key={row.user_id + idx}
                            className={`border-t border-border/60 transition-colors ${
                              isDirty ? "bg-amber-50" : idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"
                            } hover:bg-primary/5`}
                          >
                            <td className="px-3 py-2.5 text-center font-bold text-primary text-sm">#{row.rank}</td>

                            <EditableCell
                              value={row.reg_no}
                              isEditing={editCell?.userId === row.user_id && editCell?.field === "reg_no"}
                              editValue={editValue}
                              onEditValueChange={setEditValue}
                              onStartEdit={() => startEdit(row.user_id, "reg_no", row.reg_no)}
                              onCommit={commitEdit}
                              onCancel={cancelEdit}
                              modified={!!dirtyRows[row.user_id]?.reg_no}
                            />
                            <EditableCell
                              value={row.name}
                              isEditing={editCell?.userId === row.user_id && editCell?.field === "name"}
                              editValue={editValue}
                              onEditValueChange={setEditValue}
                              onStartEdit={() => startEdit(row.user_id, "name", row.name)}
                              onCommit={commitEdit}
                              onCancel={cancelEdit}
                              modified={!!dirtyRows[row.user_id]?.name}
                            />

                            <td className="px-3 py-2.5 text-muted text-xs max-w-[180px] truncate">{row.email}</td>

                            {topicCols.map((tc) => {
                              const ts = row.topic_scores?.[tc.id];
                              return (
                                <td key={tc.id} className="px-3 py-2.5 text-center">
                                  {ts?.score != null ? <ScorePill score={ts.score} /> : <span className="text-muted/40 text-xs">—</span>}
                                </td>
                              );
                            })}

                            <td className="px-3 py-2.5 text-center">
                              {row.overall_score != null ? <ScorePill score={row.overall_score} /> : <span className="text-muted/40">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-center text-muted">{row.total_attempts}</td>
                            <td className="px-3 py-2.5 text-center"><StatusBadge status={row.status} /></td>
                            <td className="px-3 py-2.5 text-xs text-muted whitespace-nowrap">{fmtDate(row.attempt_time)}</td>
                            <td className="px-3 py-2.5 text-center text-xs text-muted">{fmtDuration(row.duration_minutes)}</td>
                            {hasJdMatch && (
                              <td className="px-3 py-2.5 text-center">
                                {row.skill_match != null ? <ScorePill score={row.skill_match} /> : <span className="text-muted/40 text-xs">—</span>}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
