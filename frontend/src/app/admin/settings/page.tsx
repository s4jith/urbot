"use client";

import { useState, useEffect, useCallback } from "react";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import { Department } from "@/types/admin";
import { Trash2, Plus, AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { toast } from "sonner";

interface MaintenanceStatus {
  enabled: boolean;
  message: string;
}

export default function AdminSettingsPage() {
  // â”€â”€ Departments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [departments, setDepartments] = useState<Department[]>([]);
  const [deptLoading, setDeptLoading] = useState(true);
  const [newDeptName, setNewDeptName] = useState("");
  const [newDeptCode, setNewDeptCode] = useState("");
  const [deptSaving, setDeptSaving] = useState(false);

  // â”€â”€ Maintenance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [maintenance, setMaintenance] = useState<MaintenanceStatus>({
    enabled: false,
    message: "The platform is currently under maintenance. Please check back later.",
  });
  const [maintLoading, setMaintLoading] = useState(true);
  const [maintSaving, setMaintSaving] = useState(false);

  // -- Joining Years -------------------------------------------------
  const [joiningYears, setJoiningYears] = useState<string[]>([]);
  const [yearsLoading, setYearsLoading] = useState(true);
  const [newYear, setNewYear] = useState("");
  const [yearsSaving, setYearsSaving] = useState(false);

  // â”€â”€ Load departments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const fetchDepts = useCallback(async () => {
    setDeptLoading(true);
    try {
      const { data } = await api.get("/admin/departments");
      setDepartments(data.items ?? []);
    } catch {
      toast.error("Failed to load departments");
    } finally {
      setDeptLoading(false);
    }
  }, []);

  // â”€â”€ Load maintenance status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const fetchMaintenance = useCallback(async () => {
    setMaintLoading(true);
    try {
      const { data } = await api.get("/admin/settings/maintenance");
      setMaintenance(data);
    } catch {
      toast.error("Failed to load maintenance status");
    } finally {
      setMaintLoading(false);
    }
  }, []);

  const fetchJoiningYears = useCallback(async () => {
    setYearsLoading(true);
    try {
      const { data } = await api.get("/admin/settings/joining-years");
      setJoiningYears(data.years ?? []);
    } catch {
      toast.error("Failed to load joining years");
    } finally {
      setYearsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDepts();
    fetchMaintenance();
    fetchJoiningYears();
  }, [fetchDepts, fetchMaintenance, fetchJoiningYears]);

  // â”€â”€ Create department â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function handleCreateDept(e: React.FormEvent) {
    e.preventDefault();
    if (!newDeptName.trim() || !newDeptCode.trim()) return;
    setDeptSaving(true);
    try {
      await api.post("/admin/departments", { name: newDeptName.trim(), code: newDeptCode.trim().toUpperCase() });
      toast.success("Department created");
      setNewDeptName("");
      setNewDeptCode("");
      fetchDepts();
    } catch (err: unknown) {
      const errAny = err as { response?: { data?: { detail?: string } } };
      toast.error(errAny.response?.data?.detail || "Failed to create department");
    } finally {
      setDeptSaving(false);
    }
  }

  // â”€â”€ Delete department â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function handleDeleteDept(id: string, name: string) {
    if (!confirm(`Delete department "${name}"?`)) return;
    try {
      await api.delete(`/admin/departments/${id}`);
      toast.success("Department deleted");
      setDepartments((prev) => prev.filter((d) => d.id !== id));
    } catch (err: unknown) {
      const errAny = err as { response?: { data?: { detail?: string } } };
      toast.error(errAny.response?.data?.detail || "Failed to delete department");
    }
  }

  // â”€â”€ Toggle maintenance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function handleMaintToggle() {
    setMaintSaving(true);
    try {
      const { data } = await api.patch("/admin/settings/maintenance", {
        enabled: !maintenance.enabled,
        message: maintenance.message,
      });
      setMaintenance(data);
      toast.success(data.enabled ? "Maintenance mode ON" : "Maintenance mode OFF");
    } catch {
      toast.error("Failed to update maintenance mode");
    } finally {
      setMaintSaving(false);
    }
  }

  // â”€â”€ Save maintenance message â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function handleSaveMaintMessage() {
    setMaintSaving(true);
    try {
      const { data } = await api.patch("/admin/settings/maintenance", {
        enabled: maintenance.enabled,
        message: maintenance.message,
      });
      setMaintenance(data);
      toast.success("Maintenance message saved");
    } catch {
      toast.error("Failed to save message");
    } finally {
      setMaintSaving(false);
    }
  }

  // -- Joining Years handlers -----------------------------------------
  function handleAddYear() {
    const y = newYear.trim();
    if (!y) return;
    if (joiningYears.includes(y)) {
      toast.error("Year already exists");
      return;
    }
    const updated = [...joiningYears, y].sort();
    setJoiningYears(updated);
    setNewYear("");
  }

  function handleRemoveYear(y: string) {
    setJoiningYears((prev) => prev.filter((v) => v !== y));
  }

  async function handleSaveYears() {
    setYearsSaving(true);
    try {
      await api.put("/admin/settings/joining-years", { years: joiningYears });
      toast.success("Joining years saved");
    } catch {
      toast.error("Failed to save joining years");
    } finally {
      setYearsSaving(false);
    }
  }

  return (
    <ProtectedRoute requiredRole="admin">
      <Navbar />
      <main className="pt-20 md:pt-8 pb-12 px-4 max-w-5xl mx-auto md:ml-[var(--admin-sidebar-width,250px)]">
        <h1 className="app-page-heading mb-8">Settings</h1>

        {/* â”€â”€ Maintenance Mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <section className="app-panel mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Maintenance Mode</h2>
            {maintLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : maintenance.enabled ? (
              <span className="flex items-center gap-1.5 text-sm font-medium text-red-500">
                <AlertTriangle className="w-4 h-4" />
                Active
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-sm font-medium text-green-600">
                <CheckCircle2 className="w-4 h-4" />
                Inactive
              </span>
            )}
          </div>

          {maintenance.enabled && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400">
              <strong>Warning:</strong> The platform is currently in maintenance mode. Students cannot access the app.
            </div>
          )}

          <p className="text-sm text-muted-foreground mb-4">
            When maintenance mode is ON, all student-facing pages will display the maintenance message below and block access.
          </p>

          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Maintenance Message</label>
              <textarea
                className="app-control w-full min-h-[80px] resize-y"
                value={maintenance.message}
                onChange={(e) => setMaintenance((p) => ({ ...p, message: e.target.value }))}
                placeholder="Message shown to users during maintenanceâ€¦"
              />
              <button
                onClick={handleSaveMaintMessage}
                disabled={maintSaving}
                className="mt-2 cursor-pointer px-4 py-2 rounded-lg bg-secondary text-sm font-medium hover:bg-secondary/80 disabled:opacity-50"
              >
                Save Message
              </button>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={handleMaintToggle}
                disabled={maintSaving || maintLoading}
                className={`cursor-pointer px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 ${
                  maintenance.enabled
                    ? "bg-green-600 hover:bg-green-700 text-white"
                    : "bg-red-600 hover:bg-red-700 text-white"
                }`}
              >
                {maintSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin inline mr-1" />
                ) : null}
                {maintenance.enabled ? "Turn OFF Maintenance" : "Turn ON Maintenance"}
              </button>
              <span className="text-xs text-muted-foreground">
                {maintenance.enabled ? "Students are currently blocked." : "Students can access the app normally."}
              </span>
            </div>
          </div>
        </section>

        {/* â”€â”€ Departments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <section className="app-panel">
          <h2 className="text-lg font-semibold mb-4">Departments</h2>
          <p className="text-sm text-muted-foreground mb-5">
            Department codes correspond to the 3-digit dept segment in student registration numbers (e.g., <code className="font-mono bg-muted px-1 rounded">243</code>).
            These appear in group test targeting and user filters.
          </p>

          {/* Add form */}
          <form onSubmit={handleCreateDept} className="flex flex-wrap gap-3 mb-6">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Department Name</label>
              <input
                className="app-control w-56"
                placeholder="e.g. Computer Science"
                value={newDeptName}
                onChange={(e) => setNewDeptName(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Code (3 chars)</label>
              <input
                className="app-control w-28 font-mono uppercase"
                placeholder="e.g. 243"
                value={newDeptCode}
                maxLength={10}
                onChange={(e) => setNewDeptCode(e.target.value.toUpperCase())}
                required
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={deptSaving}
                className="cursor-pointer flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {deptSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Add Department
              </button>
            </div>
          </form>

          {/* List */}
          {deptLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : departments.length === 0 ? (
            <p className="app-empty-state">No departments yet. Add one above.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Code</th>
                    <th className="pb-2 font-medium">Name</th>
                    <th className="pb-2 font-medium w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {departments.map((dept) => (
                    <tr key={dept.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 pr-4 font-mono font-medium">{dept.code}</td>
                      <td className="py-2.5 pr-4">{dept.name}</td>
                      <td className="py-2.5">
                        <button
                          onClick={() => handleDeleteDept(dept.id, dept.name)}
                          className="cursor-pointer text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* -- Joining Years ----------------------------------------- */}
        <section className="app-panel mb-8">
          <h2 className="text-lg font-semibold mb-1">Joining Years</h2>
          <p className="text-sm text-muted-foreground mb-5">
            These are the 2-digit year values (e.g. <code className="font-mono bg-muted px-1 rounded">24</code> for 2024) used in group test student targeting. Add or remove years as needed.
          </p>

          {yearsLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-4 min-h-[36px]">
                {joiningYears.length === 0 && (
                  <p className="text-sm text-muted-foreground">No years configured yet.</p>
                )}
                {joiningYears.map((y) => (
                  <span key={y} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-primary/10 text-primary border border-primary/20 font-mono">
                    20{y}
                    <button
                      type="button"
                      onClick={() => handleRemoveYear(y)}
                      className="cursor-pointer ml-1 hover:opacity-70"
                      title="Remove"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>

              <div className="flex gap-2 items-center mb-4">
                <input
                  className="app-control w-28 font-mono"
                  placeholder="e.g. 27"
                  maxLength={2}
                  value={newYear}
                  onChange={(e) => setNewYear(e.target.value.replace(/\D/g, "").slice(0, 2))}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddYear(); } }}
                />
                <button
                  type="button"
                  onClick={handleAddYear}
                  className="cursor-pointer flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm hover:bg-muted/40"
                >
                  <Plus className="w-4 h-4" />
                  Add Year
                </button>
              </div>

              <button
                onClick={handleSaveYears}
                disabled={yearsSaving}
                className="cursor-pointer px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
              >
                {yearsSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                Save Years
              </button>
            </>
          )}
        </section>
      </main>
    </ProtectedRoute>
  );
}



