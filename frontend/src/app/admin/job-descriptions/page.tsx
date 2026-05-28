"use client";

import { useEffect, useRef, useState } from "react";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import { JobDescription } from "@/types";
import { Briefcase, FileUp, Loader2, Plus, PencilLine, FileText } from "lucide-react";
import { toast } from "sonner";

export default function AdminJobDescriptionsPage() {
  const [items, setItems] = useState<JobDescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    company: "",
    description: "",
    requiredSkillsText: "",
  });
  const [inputMode, setInputMode] = useState<"type" | "upload">("type");
  const [fileUploading, setFileUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchItems();
  }, []);

  const fetchItems = async () => {
    try {
      const { data } = await api.get("/admin/job-descriptions");
      setItems(data.items || []);
    } catch (err) {
      console.error("Failed to load job descriptions", err);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setInputMode("type");
    setForm({
      title: "",
      company: "",
      description: "",
      requiredSkillsText: "",
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleJdFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedExts = [".pdf", ".doc", ".docx", ".txt"];
    const ext = "." + file.name.split(".").pop()!.toLowerCase();
    if (!allowedExts.includes(ext)) {
      toast.error("Unsupported file type. Please upload PDF, DOC, DOCX, or TXT.");
      return;
    }

    setFileUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const { data } = await api.post("/admin/job-descriptions/parse-file", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setForm({
        title: data.title || "",
        company: data.company || "",
        description: data.description || "",
        requiredSkillsText: (data.required_skills || []).join(", "),
      });
      setInputMode("type");
      toast.success("JD extracted — review and save below.");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to parse JD file");
    } finally {
      setFileUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const saveItem = async () => {
    if (!form.title.trim() || !form.description.trim()) {
      toast.error("Title and description are required");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        company: form.company.trim(),
        description: form.description.trim(),
        required_skills: form.requiredSkillsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };

      if (editingId) {
        await api.put(`/admin/job-descriptions/${editingId}`, payload);
      } else {
        await api.post("/admin/job-descriptions", payload);
      }

      resetForm();
      fetchItems();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to save job description");
    } finally {
      setSaving(false);
    }
  };

  const editItem = (item: JobDescription) => {
    setEditingId(item.id);
    setInputMode("type");
    setForm({
      title: item.title || "",
      company: item.company || "",
      description: item.description || "",
      requiredSkillsText: (item.required_skills || []).join(", "),
    });
  };

  const deleteItem = async (id: string) => {
    toast("Delete this job description?", {
      description: "This action cannot be undone.",
      action: {
        label: "Delete",
        onClick: async () => {
          try {
            await api.delete(`/admin/job-descriptions/${id}`);
            if (editingId === id) resetForm();
            fetchItems();
          } catch (err: any) {
            toast.error(err.response?.data?.detail || "Failed to delete job description");
          }
        }
      },
      cancel: { label: "Cancel", onClick: () => {} }
    });
  };

  return (
    <ProtectedRoute requiredRole="admin">
      <Navbar />
      <main className="pt-20 md:pt-8 pb-12 px-4 max-w-5xl mx-auto md:ml-[var(--admin-sidebar-width,250px)]">
        <div className="animate-fade-in">
          <div className="flex items-center gap-3 mb-6">
            <Briefcase className="w-6 h-6" />
            <h1 className="text-2xl font-bold">Job Descriptions</h1>
          </div>

          <div className="app-panel mb-5">
            {/* Input mode toggle */}
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setInputMode("type")}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-all ${inputMode === "type" ? "bg-white text-black border-white" : "bg-transparent text-muted border-border hover:border-white/30"}`}
              >
                <PencilLine className="inline-block w-3.5 h-3.5 mr-1.5 -mt-0.5" strokeWidth={1.75} /> Type manually
              </button>
              <button
                type="button"
                onClick={() => setInputMode("upload")}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-all ${inputMode === "upload" ? "bg-white text-black border-white" : "bg-transparent text-muted border-border hover:border-white/30"}`}
              >
                <FileText className="inline-block w-3.5 h-3.5 mr-1.5 -mt-0.5" strokeWidth={1.75} /> Upload file (AI extract)
              </button>
            </div>

            {inputMode === "upload" ? (
              <label className="block cursor-pointer mb-4">
                <div className="p-6 rounded-lg border-2 border-dashed border-border hover:border-white/30 transition-colors text-center">
                  {fileUploading ? (
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin text-muted" />
                      <span className="text-sm text-muted">Extracting JD with AI…</span>
                    </div>
                  ) : (
                    <>
                      <FileUp className="w-6 h-6 text-muted mx-auto mb-2" />
                      <p className="text-sm text-muted">Upload JD file — AI extracts title, description & skills</p>
                      <p className="text-xs text-muted mt-1">PDF, DOC, DOCX, TXT (max 10MB)</p>
                    </>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.txt"
                  onChange={handleJdFileUpload}
                  className="hidden"
                  disabled={fileUploading}
                />
              </label>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                  <input
                    placeholder="JD title"
                    value={form.title}
                    onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                    className="app-control"
                  />
                  <input
                    placeholder="Company (optional)"
                    value={form.company}
                    onChange={(e) => setForm((prev) => ({ ...prev, company: e.target.value }))}
                    className="app-control"
                  />
                </div>
                <textarea
                  rows={5}
                  placeholder="Job description text"
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  className="app-control mb-3"
                />
                <input
                  placeholder="Required skills (comma separated)"
                  value={form.requiredSkillsText}
                  onChange={(e) => setForm((prev) => ({ ...prev, requiredSkillsText: e.target.value }))}
                  className="app-control"
                />
              </>
            )}

            {inputMode === "type" && (
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={saveItem}
                  disabled={saving}
                  className="px-3 py-1.5 rounded-lg bg-white text-black text-sm font-medium hover:bg-gray-200 disabled:opacity-40 inline-flex items-center gap-2"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {editingId ? "Update JD" : "Add JD"}
                </button>
                {editingId && (
                  <button onClick={resetForm} className="app-btn">
                    Cancel Edit
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3">
            {loading ? (
              <div className="text-sm text-muted">Loading job descriptions...</div>
            ) : items.length === 0 ? (
              <div className="text-sm text-muted">No job descriptions yet.</div>
            ) : (
              items.map((item) => (
                <div key={item.id} className="app-panel">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{item.title}</p>
                      <p className="text-xs text-muted mt-1">{item.company || "No company"}</p>
                      <p className="text-xs text-muted mt-2 line-clamp-2">{item.description}</p>
                      <p className="text-xs text-muted mt-2">Owner: {item.owner_role}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button className="app-btn" onClick={() => editItem(item)}>Edit</button>
                      <button
                        className="px-3 py-1.5 rounded-lg border border-red-500/40 text-red-400 text-sm hover:bg-red-500/10"
                        onClick={() => deleteItem(item.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </ProtectedRoute>
  );
}

