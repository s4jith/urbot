"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import {
  warmupSpeechVoices,
  unlockSpeechPlayback,
  prefetchSpeech,
  prepareSpeech,
  SpeechVoiceGender,
} from "@/lib/speech";
import {
  Profile,
  JobRole,
  Topic,
  JobDescription,
  JobDescriptionAlignment,
} from "@/types";
import {
  Bot,
  AlertCircle,
  Loader2,
  Download,
  CheckCircle2,
  XCircle,
  Lightbulb,
  Upload,
  Play,
  FileText,
  X,
  ChevronRight,
  Sparkles,
  RefreshCw,
  Settings,
} from "lucide-react";
import { PageSkeleton } from "@/components/Skeleton";
import { toast } from "sonner";

// ── Start Interview Modal (reused from dashboard) ────────────────────────────

interface StartInterviewModalProps {
  open: boolean;
  onClose: () => void;
  profile: Profile | null;
  roles: JobRole[];
  topics: Topic[];
  jobDescriptions: JobDescription[];
  selectedRoleInput: string;
  setSelectedRoleInput: (v: string) => void;
  isCustomRoleMode: boolean;
  setIsCustomRoleMode: (v: boolean) => void;
  interviewMode: "resume" | "topic";
  setInterviewMode: (v: "resume" | "topic") => void;
  selectedTopicId: string;
  setSelectedTopicId: (v: string) => void;
  selectedJdId: string;
  setSelectedJdId: (v: string) => void;
  verificationResult: JobDescriptionAlignment | null;
  verificationSnapshot: any;
  isAutoVerifyingMatch: boolean;
  isStartingInterview: boolean;
  startInterviewStatus: string;
  startInterview: () => void;
}

function StartInterviewModal({
  open, onClose, profile, roles, topics, jobDescriptions,
  selectedRoleInput, setSelectedRoleInput, isCustomRoleMode, setIsCustomRoleMode, interviewMode, setInterviewMode,
  selectedTopicId, setSelectedTopicId, selectedJdId, setSelectedJdId,
  verificationResult, isAutoVerifyingMatch, isStartingInterview, startInterviewStatus, startInterview,
}: StartInterviewModalProps) {
  const recommendedRoleOptions = (profile?.resume?.parsed_data?.recommended_roles || [])
    .map((role) => (role || "").trim())
    .filter((role) => role.length > 0);

  const recommendedRoleKeys = new Set(
    recommendedRoleOptions.map((role) => role.toLowerCase())
  );

  const selectedRoleValue = selectedRoleInput.trim();
  const selectedRoleIsRecommended = recommendedRoleKeys.has(selectedRoleValue.toLowerCase());
  const roleSelectValue = isCustomRoleMode
    ? "__custom__"
    : (selectedRoleIsRecommended ? selectedRoleValue : "");
  const showCustomRoleInput = recommendedRoleOptions.length === 0 || isCustomRoleMode;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-card rounded-2xl border border-border shadow-2xl animate-slide-up">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Play className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="font-bold text-foreground">Start Interview</h2>
              <p className="text-xs text-muted">Choose your mode and begin</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-border/40 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex gap-2">
            {["resume", "topic"].map((mode) => (
              <button key={mode} onClick={() => setInterviewMode(mode as "resume" | "topic")}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${interviewMode === mode ? "bg-primary text-white border-primary shadow-md shadow-primary/20" : "bg-transparent text-muted border-border hover:border-primary/30"}`}>
                {mode === "resume" ? "Resume Interview" : "Topic Interview"}
              </button>
            ))}
          </div>
          {interviewMode === "resume" ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-border bg-background/60 p-3.5">
                <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">Step 1 — Interview Role</p>
                <select
                  value={roleSelectValue}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === "__custom__") {
                      setIsCustomRoleMode(true);
                      setSelectedRoleInput("");
                      return;
                    }
                    setIsCustomRoleMode(false);
                    setSelectedRoleInput(value);
                  }}
                  className="w-full text-foreground"
                >
                  <option value="">Select interview role</option>

                  {recommendedRoleOptions.length > 0 && (
                    <optgroup label="AI Recommended Roles">
                      {recommendedRoleOptions.map((role, index) => (
                        <option key={`rec-${index}`} value={role}>
                          {role}
                        </option>
                      ))}
                    </optgroup>
                  )}

                  <option value="__custom__">Type custom role...</option>
                </select>

                {showCustomRoleInput && (
                  <input
                    type="text"
                    value={selectedRoleInput}
                    onChange={(e) => {
                      setIsCustomRoleMode(true);
                      setSelectedRoleInput(e.target.value);
                    }}
                    placeholder="Type custom role"
                    className="mt-2 w-full px-3.5 py-2.5 rounded-lg bg-background border border-border focus:outline-none focus:border-primary transition-colors text-sm text-foreground"
                  />
                )}

                {recommendedRoleOptions.length === 0 && (
                  <p className="text-xs text-muted mt-2">
                    No AI recommended roles yet. Re-upload resume in Settings after edits.
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-border bg-background/60 p-3.5">
                <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">Step 2 — Job Description</p>
                <select value={selectedJdId} onChange={(e) => setSelectedJdId(e.target.value)} className="w-full">
                  <option value="">Select Job Description</option>
                  {jobDescriptions.map((jd) => <option key={jd.id} value={jd.id}>{jd.title}{jd.company ? ` — ${jd.company}` : ""}</option>)}
                </select>
              </div>
              {isAutoVerifyingMatch && (
                <div className="flex items-center gap-2 text-xs text-muted px-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />Checking resume vs JD…
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-background/60 p-3.5">
              <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">Select Topic</p>
              <select value={selectedTopicId} onChange={(e) => setSelectedTopicId(e.target.value)} className="w-full">
                {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          {!profile?.resume && interviewMode === "resume" && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-xs text-amber-400">Upload your resume in Settings to enable Resume Interview.</p>
            </div>
          )}
        </div>
        <div className="p-5 pt-0">
          <button onClick={startInterview} disabled={isStartingInterview}
            className="w-full py-3.5 bg-primary hover:bg-secondary text-white rounded-xl font-bold transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
            {isStartingInterview ? (
              <><Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">{startInterviewStatus}</span></>
            ) : (
              <><Play className="w-4 h-4" />Start Interview</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Bot's Help Page ──────────────────────────────────────────────────────────

export default function BotsHelpPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<JobRole[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [jobDescriptions, setJobDescriptions] = useState<JobDescription[]>([]);
  const [selectedRoleInput, setSelectedRoleInput] = useState("");
  const [isCustomRoleMode, setIsCustomRoleMode] = useState(false);
  const [interviewMode, setInterviewMode] = useState<"resume" | "topic">("resume");
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const [selectedJdId, setSelectedJdId] = useState("");
  const [loading, setLoading] = useState(true);
  const [isStartingInterview, setIsStartingInterview] = useState(false);
  const [startInterviewStatus, setStartInterviewStatus] = useState("Preparing your interview session...");
  const [verificationResult, setVerificationResult] = useState<JobDescriptionAlignment | null>(null);
  const [verificationSnapshot, setVerificationSnapshot] = useState<any | null>(null);
  const [isAutoVerifyingMatch, setIsAutoVerifyingMatch] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [showStartModal, setShowStartModal] = useState(false);
  const verificationRequestRef = useRef<Promise<any | null> | null>(null);
  const latestVerificationContextRef = useRef("");
  const didBootstrapRef = useRef(false);

  const getVerificationStorageKey = (userId: string) => `jd-verification-cache:${userId}`;
  const getVerificationComboKey = (jdId: string, resumeUploadedAt: string, jdUpdatedAt: string) =>
    `${jdId || ""}::${resumeUploadedAt || ""}::${jdUpdatedAt || ""}`;

  const selectedJdUpdatedAt = jobDescriptions.find((jd) => jd.id === selectedJdId)?.updated_at || "";
  const verificationCacheOwnerId =
    ((profile as any)?.id as string | undefined) ||
    ((profile as any)?.user_id as string | undefined) || "";

  const getApiErrorMessage = (err: any, fallbackMessage: string) => {
    const detail = err?.response?.data?.detail;
    const rawDetail = typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : "";
    const normalized = rawDetail.toLowerCase();
    const isAiBusy = err?.response?.status === 503 || normalized.includes("unavailable") || normalized.includes("resource_exhausted");
    if (isAiBusy) return "AI service is currently busy. Please try again in a few seconds.";
    return rawDetail || fallbackMessage;
  };

  useEffect(() => {
    if (didBootstrapRef.current) return;
    didBootstrapRef.current = true;
    fetchData();
    void warmupSpeechVoices();
  }, []);

  useEffect(() => { setVerificationResult(null); setVerificationSnapshot(null); }, [selectedJdId]);

  useEffect(() => {
    if (!verificationSnapshot) return;
    const curr = profile?.resume?.uploaded_at || "";
    const snap = verificationSnapshot?.resume_snapshot?.uploaded_at || "";
    if (curr && snap && curr !== snap) { setVerificationResult(null); setVerificationSnapshot(null); }
  }, [profile?.resume?.uploaded_at, verificationSnapshot]);

  useEffect(() => {
    latestVerificationContextRef.current = `${interviewMode}::${selectedJdId || ""}::${profile?.resume?.uploaded_at || ""}::${selectedJdUpdatedAt || ""}`;
  }, [interviewMode, selectedJdId, profile?.resume?.uploaded_at, selectedJdUpdatedAt]);

  // Load from localStorage cache
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!verificationCacheOwnerId || !selectedJdId || !profile?.resume?.uploaded_at) return;
    if (verificationSnapshot || verificationResult) return;
    const storageKey = getVerificationStorageKey(verificationCacheOwnerId);
    const comboKey = getVerificationComboKey(selectedJdId, profile.resume.uploaded_at, selectedJdUpdatedAt);
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const entry = (JSON.parse(raw)?.cacheByCombo || {})[comboKey];
      if (!entry) return;
      setVerificationResult(entry?.result || null);
      setVerificationSnapshot(entry?.snapshot || null);
    } catch { /* ignore */ }
  }, [verificationCacheOwnerId, profile?.resume?.uploaded_at, selectedJdId, selectedJdUpdatedAt, verificationSnapshot, verificationResult]);

  // Save to localStorage cache
  useEffect(() => {
    if (typeof window === "undefined" || !verificationCacheOwnerId || !verificationSnapshot || !verificationResult) return;
    const storageKey = getVerificationStorageKey(verificationCacheOwnerId);
    const snapshotJdId = verificationSnapshot?.job_description?.id || selectedJdId || "";
    const snapshotResume = verificationSnapshot?.resume_snapshot?.uploaded_at || "";
    const snapshotJdUpdated = verificationSnapshot?.job_description?.updated_at || "";
    if (!snapshotJdId || !snapshotResume) return;
    const comboKey = getVerificationComboKey(snapshotJdId, snapshotResume, snapshotJdUpdated);
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : {};
      const cacheByCombo = parsed?.cacheByCombo || {};
      cacheByCombo[comboKey] = { snapshot: verificationSnapshot, result: verificationResult, savedAt: new Date().toISOString() };
      localStorage.setItem(storageKey, JSON.stringify({ cacheByCombo }));
    } catch { /* best-effort */ }
  }, [verificationCacheOwnerId, selectedJdId, verificationSnapshot, verificationResult]);

  const fetchData = async () => {
    try {
      const [profileRes, rolesRes, topicsRes, jdRes] = await Promise.all([
        api.get("/profile"),
        api.get("/admin/roles"),
        api.get("/admin/topics"),
        api.get("/profile/job-descriptions"),
      ]);
      setProfile(profileRes.data);
      const availableRoles = rolesRes.data.roles || [];
      setRoles(availableRoles);
      const availableTopics = topicsRes.data.topics || [];
      setTopics(availableTopics);
      if (availableTopics.length > 0) setSelectedTopicId(availableTopics[0].id);
      const jdItems = jdRes.data.items || [];
      setJobDescriptions(jdItems);
      if (jdItems.length > 0) setSelectedJdId(jdItems[0].id);
      const recRoles = profileRes.data?.resume?.parsed_data?.recommended_roles;
      if (recRoles && recRoles.length > 0) {
        setSelectedRoleInput(recRoles[0]);
        setIsCustomRoleMode(false);
      } else {
        setSelectedRoleInput("");
        setIsCustomRoleMode(false);
      }
    } catch (err) {
      console.error("Failed to fetch Bot's Help data", err);
    } finally {
      setLoading(false);
    }
  };

  const buildResumeInterviewPayload = () => {
    const payload: any = {};
    if (selectedJdId) payload.job_description_id = selectedJdId;
    const matchingRole = roles.find((r) => r.title.toLowerCase() === selectedRoleInput.trim().toLowerCase());
    if (matchingRole) payload.role_id = matchingRole.id;
    else payload.custom_role = selectedRoleInput.trim();
    return payload;
  };

  const isVerificationFresh = () => {
    if (!verificationResult || !verificationSnapshot) return false;
    if (!selectedJdId || (verificationSnapshot?.job_description?.id || "") !== selectedJdId) return false;
    const curr = profile?.resume?.uploaded_at || "";
    const snap = verificationSnapshot?.resume_snapshot?.uploaded_at || "";
    if (curr && snap && curr !== snap) return false;
    const currJd = jobDescriptions.find((jd) => jd.id === selectedJdId)?.updated_at || "";
    if (currJd && currJd !== (verificationSnapshot?.job_description?.updated_at || "")) return false;
    return true;
  };

  const runVerification = async () => {
    if (!profile?.resume || !selectedJdId) {
      toast.error("Please upload your resume and select a Job Description first."); return;
    }
    if (verificationRequestRef.current) return;
    const requestContextKey = latestVerificationContextRef.current;
    setIsVerifying(true);
    const req = (async () => {
      try {
        const payload = buildResumeInterviewPayload();
        const { data } = await api.post("/interview/verify", payload);
        if (latestVerificationContextRef.current !== requestContextKey) return null;
        setVerificationResult(data?.jd_alignment || null);
        setVerificationSnapshot(data || null);
        return data || null;
      } catch (err: any) {
        toast.error(getApiErrorMessage(err, "Failed to verify resume"));
        return null;
      } finally {
        setIsVerifying(false);
        verificationRequestRef.current = null;
      }
    })();
    verificationRequestRef.current = req;
    await req;
  };

  const downloadVerificationPdf = async () => {
    if (!verificationSnapshot || !verificationResult) { toast.error("Run analysis first."); return; }
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 40;
    const maxWidth = pageWidth - margin * 2;
    let y = 46;
    const ensureSpace = (n = 20) => { if (y + n > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 46; } };
    const addH = (t: string) => { ensureSpace(28); doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text(t, margin, y); y += 24; };
    const addLV = (l: string, v: string) => {
      const lLines = doc.splitTextToSize(`${l}:`, maxWidth);
      const vLines = doc.splitTextToSize((v || "-").toString(), maxWidth);
      ensureSpace(lLines.length * 13 + vLines.length * 14 + 10);
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.text(lLines, margin, y); y += lLines.length * 13 + 2;
      doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.text(vLines, margin, y); y += vLines.length * 14 + 8;
    };
    const addList = (title: string, items: string[]) => {
      ensureSpace(22); doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text(title, margin, y); y += 16;
      (items?.length ? items : ["-"]).forEach((item) => {
        const lines = doc.splitTextToSize(`- ${item}`, maxWidth - 6);
        ensureSpace(lines.length * 14 + 8); doc.setFont("helvetica", "normal"); doc.setFontSize(11);
        doc.text(lines, margin + 6, y); y += lines.length * 14 + 2;
      }); y += 6;
    };
    const jd = verificationSnapshot?.job_description || {};
    const resume = verificationSnapshot?.resume_snapshot || {};
    addH("Resume vs Job Description Analysis"); addLV("Role", verificationSnapshot?.role_title || selectedRoleInput || "-");
    addH("Job Description"); addLV("Title", jd?.title || "-"); addLV("Company", jd?.company || "-");
    addH("Alignment Result"); addLV("Fit Summary", verificationResult?.fit_summary || "-");
    addList("Meeting Expectations", verificationResult?.meeting_expectations || []);
    addList("Missing Expectations", verificationResult?.missing_expectations || []);
    addList("Improvement Suggestions", verificationResult?.improvement_suggestions || []);
    doc.save(`resume-analysis-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`);
  };

  const startInterview = async () => {
    if (interviewMode === "resume" && (!selectedRoleInput.trim() || !profile?.resume)) {
      toast.error("Please upload your resume and select a role."); return;
    }
    if (interviewMode === "resume" && !selectedJdId) {
      toast.error("Please select a Job Description."); return;
    }
    if (interviewMode === "topic" && !selectedTopicId) {
      toast.error("Please select a topic."); return;
    }
    setIsStartingInterview(true);
    setStartInterviewStatus("Checking audio and preparing your interview...");
    try {
      await unlockSpeechPlayback().catch(() => undefined);
      const payload: any = { interview_type: interviewMode };
      let verifiedAlignment: any = verificationResult;
      if (interviewMode === "topic") {
        setStartInterviewStatus("Loading topic interview...");
        payload.topic_id = selectedTopicId;
      } else {
        if (!isVerificationFresh()) {
          setStartInterviewStatus("Verifying resume against JD...");
          const verifyData = await (async () => {
            const p = buildResumeInterviewPayload();
            const { data } = await api.post("/interview/verify", p);
            setVerificationResult(data?.jd_alignment || null);
            setVerificationSnapshot(data || null);
            return data;
          })().catch(() => null);
          if (!verifyData) throw new Error("Unable to verify resume");
          verifiedAlignment = verifyData?.jd_alignment || null;
        }
        Object.assign(payload, buildResumeInterviewPayload());
      }
      setStartInterviewStatus("Generating your first question...");
      const { data } = await api.post("/interview/start", payload);
      const preferredVoice = ((typeof window !== "undefined"
        ? (localStorage.getItem("speech_voice_gender") as SpeechVoiceGender | null)
        : null) || (profile?.speech_settings?.voice_gender as SpeechVoiceGender | undefined) || "female") as SpeechVoiceGender;
      prefetchSpeech(data?.question?.question || "", { voiceGender: preferredVoice, style: "assistant" });
      try {
        setStartInterviewStatus("Preloading audio...");
        await Promise.race([
          prepareSpeech(data?.question?.question || "", { voiceGender: preferredVoice, style: "assistant" }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 25000)),
        ]);
      } catch { /* continue */ }
      const alignmentToStore = verifiedAlignment || data?.jd_alignment;
      if (typeof window !== "undefined" && alignmentToStore) {
        sessionStorage.setItem(`jd_alignment:${data.session_id}`, JSON.stringify(alignmentToStore));
      }
      const timerEnabled = !!data?.timer?.enabled;
      const timerSeconds = Number(data?.timer?.seconds || 0);
      const timerQuery = timerEnabled && timerSeconds > 0 ? `&timerEnabled=1&timerSeconds=${timerSeconds}` : "";
      router.push(`/interview?session=${data.session_id}&q=${encodeURIComponent(data.question.question)}&qid=${data.question.question_id}&num=${data.question.question_number}&diff=${data.question.difficulty}&total=${data.question.total_questions || 5}${timerQuery}`);
    } catch (err: any) {
      setIsStartingInterview(false);
      setStartInterviewStatus("Preparing your interview session...");
      toast.error(getApiErrorMessage(err, "Failed to start interview"));
    }
  };

  if (loading) {
    return (
      <ProtectedRoute requiredRole="student">
        <Navbar />
        <PageSkeleton />
      </ProtectedRoute>
    );
  }

  const resumeData = profile?.resume?.parsed_data;

  return (
    <ProtectedRoute requiredRole="student">
      <Navbar />

      {isStartingInterview && (
        <div className="fixed inset-0 z-[70] bg-background/90 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-7 text-center shadow-2xl">
            <Loader2 className="w-10 h-10 animate-spin mx-auto mb-4 text-primary" />
            <h2 className="text-xl font-bold mb-2">Preparing your interview</h2>
            <p className="text-muted text-sm mb-4">{startInterviewStatus}</p>
          </div>
        </div>
      )}

      <StartInterviewModal
        open={showStartModal}
        onClose={() => setShowStartModal(false)}
        profile={profile}
        roles={roles}
        topics={topics}
        jobDescriptions={jobDescriptions}
        selectedRoleInput={selectedRoleInput}
        setSelectedRoleInput={setSelectedRoleInput}
        isCustomRoleMode={isCustomRoleMode}
        setIsCustomRoleMode={setIsCustomRoleMode}
        interviewMode={interviewMode}
        setInterviewMode={setInterviewMode}
        selectedTopicId={selectedTopicId}
        setSelectedTopicId={setSelectedTopicId}
        selectedJdId={selectedJdId}
        setSelectedJdId={setSelectedJdId}
        verificationResult={verificationResult}
        verificationSnapshot={verificationSnapshot}
        isAutoVerifyingMatch={isAutoVerifyingMatch}
        isStartingInterview={isStartingInterview}
        startInterviewStatus={startInterviewStatus}
        startInterview={startInterview}
      />

      <main className="pt-20 pb-16 px-4 max-w-5xl mx-auto">
        <div className="animate-fade-in space-y-6">

          {/* ── Hero Header ─────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/8 via-card to-accent/8 p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-primary/25 shrink-0">
                <Bot className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
                  Bot&apos;s Help
                  <Sparkles className="w-5 h-5 text-amber-400" />
                </h1>
                <p className="text-muted text-sm mt-0.5">Your personal AI career coach — resume analysis & personalized prep.</p>
              </div>
            </div>
            <button
              onClick={() => setShowStartModal(true)}
              className="inline-flex items-center gap-2 px-5 py-3 bg-primary hover:bg-secondary text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-primary/20 whitespace-nowrap active:scale-[0.97]"
            >
              <Play className="w-4 h-4" />
              Facilitate a New Test
            </button>
          </div>

          {/* ── No Resume Banner ─────────────────────────────────────────── */}
          {!profile?.resume && (
            <div className="p-5 rounded-2xl border border-amber-400/25 bg-amber-400/6 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-400/15 flex items-center justify-center">
                  <Upload className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <p className="font-bold text-amber-600 text-sm">Resume Required for Full Analysis</p>
                  <p className="text-xs text-amber-500/80">Upload your resume to unlock Bot&apos;s Help insights.</p>
                </div>
              </div>
              <Link href="/settings"
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-bold transition-colors whitespace-nowrap flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Upload Resume
              </Link>
            </div>
          )}

          {profile?.resume && (
            <>
              {/* ── JD Selector + Run Analysis ──────────────────────────── */}
              <div className="rounded-2xl border border-border bg-card p-5">
                <h2 className="font-bold text-foreground mb-4 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  Resume vs Job Description Analysis
                </h2>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1">
                    <p className="text-xs text-muted mb-1.5 font-semibold">Select Job Description</p>
                    <select
                      value={selectedJdId}
                      onChange={(e) => setSelectedJdId(e.target.value)}
                      className="w-full"
                    >
                      <option value="">Select Job Description</option>
                      {jobDescriptions.map((jd) => (
                        <option key={jd.id} value={jd.id}>{jd.title}{jd.company ? ` — ${jd.company}` : ""}</option>
                      ))}
                    </select>
                    {jobDescriptions.length === 0 && (
                      <p className="text-xs text-muted mt-1.5">
                        <Link href="/settings" className="text-primary hover:underline">Add a JD in Settings</Link> to enable analysis.
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 items-end">
                    <button
                      onClick={runVerification}
                      disabled={isVerifying || !selectedJdId}
                      className="px-4 py-2.5 bg-primary hover:bg-secondary text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
                    >
                      {isVerifying ? <><Loader2 className="w-4 h-4 animate-spin" />Analysing…</> : <><RefreshCw className="w-4 h-4" />Run Analysis</>}
                    </button>
                    {verificationResult && (
                      <button
                        onClick={downloadVerificationPdf}
                        className="px-3.5 py-2.5 border border-border text-muted hover:text-foreground hover:border-primary/30 rounded-xl text-sm transition-colors flex items-center gap-1.5"
                        title="Download PDF"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Verification Result */}
                {verificationResult && (
                  <div className="mt-5 animate-fade-in">
                    {/* Fit Summary */}
                    <div className="p-4 rounded-xl bg-primary/5 border border-primary/15 mb-4">
                      <p className="text-xs font-bold text-primary uppercase tracking-wide mb-1">Overall Fit</p>
                      <p className="text-sm text-foreground leading-relaxed font-medium">{verificationResult.fit_summary}</p>
                      {verificationSnapshot?.saved_at && (
                        <p className="text-xs text-muted mt-2">
                          Last updated: {new Date(verificationSnapshot.saved_at).toLocaleString()}
                          {verificationSnapshot?.cached ? " (cached)" : ""}
                        </p>
                      )}
                    </div>

                    {/* Three columns */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Meeting */}
                      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                          <p className="text-sm font-bold text-emerald-600">Strengths</p>
                        </div>
                        <ul className="space-y-2">
                          {verificationResult.meeting_expectations.map((item, idx) => (
                            <li key={idx} className="text-xs text-foreground flex items-start gap-2">
                              <span className="text-emerald-500 mt-0.5 shrink-0">·</span>
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Missing */}
                      <div className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                          <p className="text-sm font-bold text-rose-500">Gaps</p>
                        </div>
                        <ul className="space-y-2">
                          {verificationResult.missing_expectations.map((item, idx) => (
                            <li key={idx} className="text-xs text-foreground flex items-start gap-2">
                              <span className="text-rose-400 mt-0.5 shrink-0">·</span>
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Suggestions */}
                      <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Lightbulb className="w-4 h-4 text-amber-500 shrink-0" />
                          <p className="text-sm font-bold text-amber-600">What Will Help</p>
                        </div>
                        <ul className="space-y-2">
                          {verificationResult.improvement_suggestions.map((item, idx) => (
                            <li key={idx} className="text-xs text-foreground flex items-start gap-2">
                              <span className="text-amber-500 mt-0.5 shrink-0">·</span>
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {!verificationResult && !isVerifying && selectedJdId && (
                  <div className="mt-4 p-3 rounded-xl border border-dashed border-border text-center">
                    <p className="text-sm text-muted">Click <strong>Run Analysis</strong> to compare your resume against the selected JD.</p>
                  </div>
                )}
              </div>

              {/* ── Resume Summary Card ──────────────────────────────────── */}
              {resumeData && (
                <div className="rounded-2xl border border-border bg-card p-5">
                  <h2 className="font-bold text-foreground mb-4 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-primary" />
                    Resume Summary
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {resumeData.experience_summary && (
                      <div>
                        <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">Experience</p>
                        <p className="text-sm text-foreground leading-relaxed">{resumeData.experience_summary}</p>
                      </div>
                    )}
                    <div>
                      {profile?.skills && profile.skills.length > 0 && (
                        <>
                          <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">Skills Extracted</p>
                          <div className="flex flex-wrap gap-1.5">
                            {profile.skills.map((skill: string, i: number) => (
                              <span key={i} className="px-2.5 py-1 rounded-lg bg-primary/8 border border-primary/15 text-primary text-xs font-semibold">{skill}</span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                    {resumeData.recommended_roles && resumeData.recommended_roles.length > 0 && (
                      <div className="md:col-span-2">
                        <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">AI Recommended Roles</p>
                        <div className="flex flex-wrap gap-2">
                          {resumeData.recommended_roles.map((role: string, i: number) => (
                            <span key={i} className="px-3 py-1.5 rounded-xl bg-accent/20 border border-accent/30 text-secondary text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:bg-primary/10 transition-colors" onClick={() => { setIsCustomRoleMode(false); setSelectedRoleInput(role); setShowStartModal(true); }}>
                              <Play className="w-3 h-3" />
                              {role}
                            </span>
                          ))}
                        </div>
                        <p className="text-xs text-muted mt-2">Click a role to start an interview for it.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── CTA Strip ───────────────────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => setShowStartModal(true)}
              className="flex-1 flex items-center justify-center gap-2 py-4 bg-primary hover:bg-secondary text-white rounded-2xl font-bold transition-all shadow-lg shadow-primary/20 active:scale-[0.97]"
            >
              <Play className="w-5 h-5" />
              Facilitate a New Test
            </button>
            <Link href="/reports"
              className="flex-1 flex items-center justify-center gap-2 py-4 border border-border hover:border-primary/30 text-foreground hover:text-primary rounded-2xl font-bold transition-all">
              <ChevronRight className="w-5 h-5" />
              View All Reports
            </Link>
          </div>

        </div>
      </main>
    </ProtectedRoute>
  );
}