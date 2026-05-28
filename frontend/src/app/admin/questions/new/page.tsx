"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import { Topic, EntryMode, Difficulty } from "@/types";
import { ArrowLeft, BookOpen, Upload, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function AdminCreateQuestionPage() {
  const router = useRouter();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);

  const [entryMode, setEntryMode] = useState<EntryMode>("manual");

  const [topicId, setTopicId] = useState("");
  const [question, setQuestion] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [saving, setSaving] = useState(false);

  const [uploadTopicId, setUploadTopicId] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchTopics();
  }, []);

  const fetchTopics = async () => {
    try {
      const { data } = await api.get("/admin/topics");
      const items: Topic[] = data.topics || [];
      setTopics(items);
      if (items.length > 0) {
        setTopicId(items[0].id);
        setUploadTopicId(items[0].id);
      }
    } catch (err) {
      console.error("Failed to load topics", err);
    } finally {
      setLoading(false);
    }
  };

  const createManualQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topicId) {
      toast.error("Please select a topic");
      return;
    }

    setSaving(true);
    try {
      await api.post("/admin/questions", {
        interview_type: "topic",
        topic_id: topicId,
        question,
        difficulty,
      });
      router.push("/admin/questions");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to create question");
    } finally {
      setSaving(false);
    }
  };

  const importFromPdf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadTopicId) {
      toast.error("Please select a topic");
      return;
    }
    if (!uploadFile) {
      toast.error("Please choose a PDF file");
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append("interview_type", "topic");
      form.append("topic_id", uploadTopicId);
      form.append("file", uploadFile);

      const { data } = await api.post("/admin/questions/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      toast.success(`Imported ${data.inserted_count} questions successfully`);
      router.push("/admin/questions");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to import questions from PDF");
    } finally {
      setUploading(false);
    }
  };

  return (
    <ProtectedRoute requiredRole="admin">
      <Navbar />
      <main className="pt-20 md:pt-8 pb-12 px-4 max-w-3xl mx-auto md:ml-[var(--admin-sidebar-width,250px)]">
        <div className="animate-fade-in space-y-6">
          <section className="rounded-2xl border border-border bg-gradient-to-br from-card to-black/40 p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold">Create Topic Question</h1>
                <p className="text-sm text-muted mt-2">Add one question manually or import a set from PDF using AI.</p>
              </div>
              <Link
                href="/admin/questions"
                className="px-3 py-2 rounded-lg border border-border text-sm hover:bg-white/5 flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </Link>
            </div>
          </section>

          {loading ? (
            <div className="text-center text-muted mt-12 animate-pulse-slow">Loading topics...</div>
          ) : topics.length === 0 ? (
            <section className="rounded-2xl border border-border bg-card p-8 text-center">
              <p className="text-muted">No topics found. Create a topic first.</p>
              <Link href="/admin/topics" className="inline-block mt-4 px-4 py-2 bg-white text-black rounded-lg text-sm font-semibold">
                Go to Topic Management
              </Link>
            </section>
          ) : (
            <section className="rounded-2xl border border-border bg-card p-6">
              <div className="flex items-center gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => setEntryMode("manual")}
                  className={`px-3 py-1.5 rounded-lg text-sm border ${
                    entryMode === "manual" ? "bg-white text-black border-white" : "bg-transparent text-muted border-border"
                  }`}
                >
                  <BookOpen className="w-4 h-4 inline mr-1" />
                  Manual
                </button>
                <button
                  type="button"
                  onClick={() => setEntryMode("pdf")}
                  className={`px-3 py-1.5 rounded-lg text-sm border ${
                    entryMode === "pdf" ? "bg-white text-black border-white" : "bg-transparent text-muted border-border"
                  }`}
                >
                  <Upload className="w-4 h-4 inline mr-1" />
                  Upload PDF + AI
                </button>
              </div>

              {entryMode === "manual" ? (
                <form onSubmit={createManualQuestion} className="space-y-4">
                  <select value={topicId} onChange={(e) => setTopicId(e.target.value)} required>
                    <option value="">Select Topic</option>
                    {topics.map((topic) => (
                      <option key={topic.id} value={topic.id}>
                        {topic.name}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    rows={4}
                    required
                    placeholder="Enter interview question"
                    className="resize-none"
                  />
                  <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2.5 rounded-lg bg-white text-black text-sm font-semibold hover:bg-gray-200 disabled:opacity-50 transition-colors flex items-center gap-2"
                  >
                    <Sparkles className="w-4 h-4" />
                    {saving ? "Creating..." : "Create Question"}
                  </button>
                </form>
              ) : (
                <form onSubmit={importFromPdf} className="space-y-4">
                  <select value={uploadTopicId} onChange={(e) => setUploadTopicId(e.target.value)} required>
                    <option value="">Select Topic</option>
                    {topics.map((topic) => (
                      <option key={topic.id} value={topic.id}>
                        {topic.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted">Difficulty is assigned automatically by AI for each extracted question.</p>
                  <input
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    required
                  />
                  <button
                    type="submit"
                    disabled={uploading}
                    className="px-5 py-2.5 rounded-lg bg-white text-black text-sm font-semibold hover:bg-gray-200 disabled:opacity-50 transition-colors"
                  >
                    {uploading ? "Uploading and extracting..." : "Generate Questions from PDF"}
                  </button>
                </form>
              )}
            </section>
          )}
        </div>
      </main>
    </ProtectedRoute>
  );
}
