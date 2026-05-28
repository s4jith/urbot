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
  ReportHistoryItem,
  JobRole,
  Topic,
  JobDescription,
  JobDescriptionAlignment,
} from "@/types";
import {
  FileText,
  AlertCircle,
  Clock,
  ChevronRight,
  Loader2,
  Download,
  X,
  Bot,
  Trophy,
  TrendingUp,
  Target,
  CheckCircle2,
  XCircle,
  Lightbulb,
  Upload,
  User,
  Mail,
  Star,
  Play,
  BookOpen,
} from "lucide-react";
import { PageSkeleton } from "@/components/Skeleton";
import { toast } from "sonner";

// ── Start Interview Modal ────────────────────────────────────────────────────

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
  open,
  onClose,
  profile,
  roles,
  topics,
  jobDescriptions,
  selectedRoleInput,
  setSelectedRoleInput,
  isCustomRoleMode,
  setIsCustomRoleMode,
  interviewMode,
  setInterviewMode,
  selectedTopicId,
  setSelectedTopicId,
  selectedJdId,
  setSelectedJdId,
  verificationResult,
  verificationSnapshot,
  isAutoVerifyingMatch,
  isStartingInterview,
  startInterviewStatus,
  startInterview,
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
        {/* Header */}
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
          {/* Mode Toggle */}
          <div className="flex gap-2">
            {["resume", "topic"].map((mode) => (
              <button
                key={mode}
                onClick={() => setInterviewMode(mode as "resume" | "topic")}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                  interviewMode === mode
                    ? "bg-primary text-white border-primary shadow-md shadow-primary/20"
                    : "bg-transparent text-muted border-border hover:border-primary/30"
                }`}
              >
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
                <select
                  value={selectedJdId}
                  onChange={(e) => setSelectedJdId(e.target.value)}
                  className="w-full"
                >
                  <option value="">Select Job Description</option>
                  {jobDescriptions.map((jd) => (
                    <option key={jd.id} value={jd.id}>
                      {jd.title}{jd.company ? ` — ${jd.company}` : ""}
                    </option>
                  ))}
                </select>
                {jobDescriptions.length === 0 && (
                  <p className="text-xs text-muted mt-2">Add a job description in Settings first.</p>
                )}
              </div>

              {/* Verification result inline */}
              {(isAutoVerifyingMatch) && (
                <div className="flex items-center gap-2 text-xs text-muted px-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Checking resume vs JD…
                </div>
              )}
              {verificationResult && interviewMode === "resume" && (
                <div className="rounded-xl border border-border bg-background/50 p-3 text-xs space-y-2">
                  <p className="font-semibold text-foreground">{verificationResult.fit_summary}</p>
                  <div className="flex gap-4">
                    <div>
                      <span className="text-green-500 font-bold">✓ Meeting</span>
                      <ul className="text-muted mt-0.5 space-y-0.5">
                        {verificationResult.meeting_expectations.slice(0, 2).map((i, idx) => (
                          <li key={idx}>· {i}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <span className="text-amber-500 font-bold">✗ Missing</span>
                      <ul className="text-muted mt-0.5 space-y-0.5">
                        {verificationResult.missing_expectations.slice(0, 2).map((i, idx) => (
                          <li key={idx}>· {i}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-background/60 p-3.5">
              <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">Select Topic</p>
              <select
                value={selectedTopicId}
                onChange={(e) => setSelectedTopicId(e.target.value)}
                className="w-full"
              >
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
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

        {/* Footer */}
        <div className="p-5 pt-0">
          <button
            onClick={startInterview}
            disabled={isStartingInterview}
            className="w-full py-3.5 bg-primary hover:bg-secondary text-white rounded-xl font-bold transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isStartingInterview ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">{startInterviewStatus}</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Start Interview
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Overview Page ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [history, setHistory] = useState<ReportHistoryItem[]>([]);
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
    ((profile as any)?.user_id as string | undefined) ||
    "";

  const getApiErrorMessage = (err: any, fallbackMessage: string) => {
    const status = err?.response?.status;
    const detail = err?.response?.data?.detail;
    const rawDetail =
      typeof detail === "string"
        ? detail
        : typeof detail?.message === "string"
        ? detail.message
        : detail
        ? JSON.stringify(detail)
        : "";
    const normalized = rawDetail.toLowerCase();
    const isAiBusy =
      status === 503 ||
      normalized.includes("unavailable") ||
      normalized.includes("high demand") ||
      normalized.includes("resource_exhausted");
    if (isAiBusy) return "AI service is currently busy. Please try again in a few seconds.";
    return rawDetail || fallbackMessage;
  };

  useEffect(() => {
    if (didBootstrapRef.current) return;
    didBootstrapRef.current = true;
    fetchDashboardData();
    void warmupSpeechVoices();
  }, []);

  useEffect(() => { setVerificationResult(null); setVerificationSnapshot(null); }, [selectedJdId]);

  useEffect(() => {
    if (!verificationSnapshot) return;
    const currentResumeUploadedAt = profile?.resume?.uploaded_at || "";
    const snapshotResumeUploadedAt = verificationSnapshot?.resume_snapshot?.uploaded_at || "";
    if (currentResumeUploadedAt && snapshotResumeUploadedAt && currentResumeUploadedAt !== snapshotResumeUploadedAt) {
      setVerificationResult(null); setVerificationSnapshot(null);
    }
  }, [profile?.resume?.uploaded_at, verificationSnapshot]);

  useEffect(() => {
    latestVerificationContextRef.current = `${interviewMode}::${selectedJdId || ""}::${profile?.resume?.uploaded_at || ""}::${selectedJdUpdatedAt || ""}`;
  }, [interviewMode, selectedJdId, profile?.resume?.uploaded_at, selectedJdUpdatedAt]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!verificationCacheOwnerId || !selectedJdId || !profile?.resume?.uploaded_at) return;
    if (verificationSnapshot || verificationResult) return;
    const storageKey = getVerificationStorageKey(verificationCacheOwnerId);
    const comboKey = getVerificationComboKey(selectedJdId, profile.resume.uploaded_at, selectedJdUpdatedAt);
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const entry = (parsed?.cacheByCombo || {})[comboKey];
      if (!entry) return;
      setVerificationResult(entry?.result || null);
      setVerificationSnapshot(entry?.snapshot || null);
    } catch { /* ignore malformed cache */ }
  }, [verificationCacheOwnerId, profile?.resume?.uploaded_at, selectedJdId, selectedJdUpdatedAt, verificationSnapshot, verificationResult]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!verificationCacheOwnerId) return;
    const storageKey = getVerificationStorageKey(verificationCacheOwnerId);
    if (!verificationSnapshot || !verificationResult) return;
    const snapshotJdId = verificationSnapshot?.job_description?.id || selectedJdId || "";
    const snapshotResumeUploadedAt = verificationSnapshot?.resume_snapshot?.uploaded_at || "";
    const snapshotJdUpdatedAt = verificationSnapshot?.job_description?.updated_at || "";
    if (!snapshotJdId || !snapshotResumeUploadedAt) return;
    const comboKey = getVerificationComboKey(snapshotJdId, snapshotResumeUploadedAt, snapshotJdUpdatedAt);
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : {};
      const cacheByCombo = parsed?.cacheByCombo || {};
      cacheByCombo[comboKey] = { snapshot: verificationSnapshot, result: verificationResult, savedAt: verificationSnapshot?.saved_at || new Date().toISOString() };
      localStorage.setItem(storageKey, JSON.stringify({ cacheByCombo }));
    } catch { /* best-effort */ }
  }, [verificationCacheOwnerId, selectedJdId, verificationSnapshot, verificationResult]);

  const fetchDashboardData = async () => {
    try {
      const [profileRes, historyRes, rolesRes, topicsRes, jdRes] = await Promise.all([
        api.get("/profile"),
        api.get("/reports/history"),
        api.get("/admin/roles"),
        api.get("/admin/topics"),
        api.get("/profile/job-descriptions"),
      ]);
      setProfile(profileRes.data);
      setHistory(historyRes.data.reports || []);
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
      console.error("Failed to fetch dashboard data", err);
    } finally {
      setLoading(false);
    }
  };

  const buildResumeInterviewPayload = () => {
    const payload: any = {};
    if (selectedJdId) payload.job_description_id = selectedJdId;
    const matchingAdminRole = roles.find((r) => r.title.toLowerCase() === selectedRoleInput.trim().toLowerCase());
    if (matchingAdminRole) payload.role_id = matchingAdminRole.id;
    else payload.custom_role = selectedRoleInput.trim();
    return payload;
  };

  const verifyResumeMatchInternal = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (interviewMode !== "resume") return null;
    if (!profile?.resume || !selectedJdId) return null;
    if (verificationRequestRef.current) return verificationRequestRef.current;
    const requestContextKey = `${interviewMode}::${selectedJdId}::${profile?.resume?.uploaded_at || ""}::${selectedJdUpdatedAt || ""}`;
    const requestPromise = (async () => {
      if (silent) setIsAutoVerifyingMatch(true);
      try {
        const payload = buildResumeInterviewPayload();
        const { data } = await api.post("/interview/verify", payload);
        if (latestVerificationContextRef.current !== requestContextKey) return null;
        setVerificationResult(data?.jd_alignment || null);
        setVerificationSnapshot(data || null);
        return data || null;
      } catch (err: any) {
        if (silent) console.warn("Auto verification failed", err);
        else toast.error(getApiErrorMessage(err, "Failed to verify resume against job description"));
        return null;
      } finally {
        if (silent) setIsAutoVerifyingMatch(false);
      }
    })();
    verificationRequestRef.current = requestPromise;
    try { return await requestPromise; } finally { verificationRequestRef.current = null; }
  };

  const isVerificationFresh = () => {
    if (!verificationResult || !verificationSnapshot) return false;
    const snapshotJdId = verificationSnapshot?.job_description?.id || "";
    if (!selectedJdId || snapshotJdId !== selectedJdId) return false;
    const currentResumeUploadedAt = profile?.resume?.uploaded_at || "";
    const snapshotResumeUploadedAt = verificationSnapshot?.resume_snapshot?.uploaded_at || "";
    if (currentResumeUploadedAt && snapshotResumeUploadedAt && currentResumeUploadedAt !== snapshotResumeUploadedAt) return false;
    const currentJdUpdatedAt = jobDescriptions.find((jd) => jd.id === selectedJdId)?.updated_at || "";
    const snapshotJdUpdatedAt = verificationSnapshot?.job_description?.updated_at || "";
    if (currentJdUpdatedAt && currentJdUpdatedAt !== snapshotJdUpdatedAt) return false;
    return true;
  };

  useEffect(() => {
    if (interviewMode !== "resume") return;
    if (!profile?.resume || !selectedJdId) return;
    if (isStartingInterview || isAutoVerifyingMatch) return;
    if (isVerificationFresh()) return;
    const timer = setTimeout(() => { void verifyResumeMatchInternal({ silent: true }); }, 450);
    return () => clearTimeout(timer);
  }, [interviewMode, profile?.resume?.uploaded_at, selectedJdId, selectedJdUpdatedAt, isStartingInterview, isAutoVerifyingMatch, verificationSnapshot, verificationResult]);

  const startInterview = async () => {
    if (interviewMode === "resume" && (!selectedRoleInput.trim() || !profile?.resume)) {
      toast.error("Please upload your resume first and select or type a job role."); return;
    }
    if (interviewMode === "resume" && !selectedJdId) {
      toast.error("Please select a Job Description before starting Resume Interview."); return;
    }
    if (interviewMode === "topic" && !selectedTopicId) {
      toast.error("Please select a topic for topic-wise interview."); return;
    }
    setIsStartingInterview(true);
    setStartInterviewStatus("Checking audio and preparing your interview setup...");
    try {
      await unlockSpeechPlayback().catch(() => undefined);
      const payload: any = { interview_type: interviewMode };
      let verifiedAlignment: any = verificationResult;
      if (interviewMode === "topic") {
        setStartInterviewStatus("Loading selected topic interview...");
        payload.topic_id = selectedTopicId;
      } else {
        if (!isVerificationFresh()) {
          setStartInterviewStatus("Verifying resume against selected job description...");
          const verifyData = await verifyResumeMatchInternal({ silent: true });
          if (!verifyData) throw new Error("Unable to verify resume against the selected job description");
          verifiedAlignment = verifyData?.jd_alignment || null;
        }
        setStartInterviewStatus("Finalizing resume interview configuration...");
        Object.assign(payload, buildResumeInterviewPayload());
      }
      setStartInterviewStatus("Generating your first question...");
      const { data } = await api.post("/interview/start", payload);
      const preferredVoice = ((typeof window !== "undefined"
        ? (localStorage.getItem("speech_voice_gender") as SpeechVoiceGender | null)
        : null) || (profile?.speech_settings?.voice_gender as SpeechVoiceGender | undefined) || "female") as SpeechVoiceGender;
      prefetchSpeech(data?.question?.question || "", { voiceGender: preferredVoice, style: "assistant" });
      try {
        setStartInterviewStatus("Preloading first question audio...");
        await Promise.race([
          prepareSpeech(data?.question?.question || "", { voiceGender: preferredVoice, style: "assistant" }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("xtts prefetch timeout")), 25000)),
        ]);
      } catch { /* continue */ }
      const alignmentToStore = verifiedAlignment || data?.jd_alignment;
      if (typeof window !== "undefined" && alignmentToStore) {
        sessionStorage.setItem(`jd_alignment:${data.session_id}`, JSON.stringify(alignmentToStore));
      }
      const timerEnabled = !!data?.timer?.enabled;
      const timerSeconds = Number(data?.timer?.seconds || 0);
      const timerQuery = timerEnabled && timerSeconds > 0 ? `&timerEnabled=1&timerSeconds=${timerSeconds}` : "";
      setStartInterviewStatus("Opening interview room...");
      router.push(
        `/interview?session=${data.session_id}&q=${encodeURIComponent(data.question.question)}&qid=${data.question.question_id}&num=${data.question.question_number}&diff=${data.question.difficulty}&total=${data.question.total_questions || 5}${timerQuery}`
      );
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

  const avgScore = history.length > 0
    ? Math.round(history.reduce((acc, h) => acc + h.overall_score, 0) / history.length)
    : 0;

  const firstName = profile?.name?.split(" ")[0] || "there";

  // Build topic performance from history
  const topicScoreMap: Record<string, { scores: number[]; name: string }> = {};
  history.forEach((h) => {
    const key = h.role_title || "General";
    if (!topicScoreMap[key]) topicScoreMap[key] = { scores: [], name: key };
    topicScoreMap[key].scores.push(h.overall_score);
  });
  const topicPerf = Object.values(topicScoreMap).map((t) => ({
    name: t.name,
    avg: Math.round(t.scores.reduce((a, b) => a + b, 0) / t.scores.length),
    count: t.scores.length,
  })).sort((a, b) => b.avg - a.avg);
  const skills: string[] = profile?.skills || [];

  return (
    <ProtectedRoute requiredRole="student">
      <Navbar />

      {/* Loading overlay when starting interview */}
      {isStartingInterview && (
        <div className="fixed inset-0 z-[70] bg-background/90 backdrop-blur-sm px-4 flex items-center justify-center">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-7 text-center shadow-2xl">
            <Loader2 className="w-10 h-10 animate-spin mx-auto mb-4 text-primary" />
            <h2 className="text-xl font-bold mb-2">Preparing your interview</h2>
            <p className="text-muted text-sm mb-4">{startInterviewStatus}</p>
            <p className="text-xs text-muted">Please keep this page open while we prepare your session.</p>
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

      <main className="pt-20 pb-16 px-4 max-w-7xl mx-auto">
        <div className="animate-fade-in space-y-6">

          {/* ── Page Header ───────────────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-black tracking-tight text-foreground">
                Overview
              </h1>
              <p className="text-muted text-sm mt-0.5">
                Welcome back, <span className="text-primary font-semibold">{firstName}</span> — here&apos;s your snapshot.
              </p>
            </div>
            <button
              onClick={() => setShowStartModal(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-secondary text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-primary/20 active:scale-[0.97]"
            >
              <Play className="w-4 h-4" />
              Start Interview
            </button>
          </div>

          {/* ── Stats Strip ───────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Total Sessions", value: history.length, icon: BookOpen, color: "text-primary", bg: "bg-primary/8" },
              { label: "Average Score", value: `${avgScore}%`, icon: TrendingUp, color: "text-amber-500", bg: "bg-amber-500/8" },
              { label: "Best Score", value: history.length > 0 ? `${Math.max(...history.map(h => h.overall_score))}%` : "—", icon: Trophy, color: "text-emerald-500", bg: "bg-emerald-500/8" },
              { label: "Resume", value: profile?.resume ? "Uploaded" : "Missing", icon: FileText, color: profile?.resume ? "text-emerald-500" : "text-rose-400", bg: profile?.resume ? "bg-emerald-500/8" : "bg-rose-400/8" },
            ].map((stat) => (
              <div key={stat.label} className="p-4 rounded-xl bg-card border border-border flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg ${stat.bg} flex items-center justify-center shrink-0`}>
                  <stat.icon className={`w-4.5 h-4.5 ${stat.color}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted truncate">{stat.label}</p>
                  <p className={`text-lg font-black tracking-tight ${stat.color}`}>{stat.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* ── Main Two-Column Layout ─────────────────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

            {/* Left: Profile Card */}
            <div className="rounded-2xl border border-border bg-card p-5 space-y-5">
              <h2 className="font-bold text-foreground flex items-center gap-2">
                <User className="w-4 h-4 text-primary" />
                Profile
              </h2>

              {/* Avatar + Name */}
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center shrink-0 shadow-lg shadow-primary/20">
                  <span className="text-white font-black text-xl">
                    {profile?.name?.charAt(0).toUpperCase() || "?"}
                  </span>
                </div>
                <div>
                  <p className="font-bold text-foreground text-lg leading-tight">{profile?.name}</p>
                  <p className="text-muted text-sm flex items-center gap-1.5 mt-0.5">
                    <Mail className="w-3.5 h-3.5" />
                    {profile?.email}
                  </p>
                </div>
              </div>

              {/* Resume status */}
              <div className={`flex items-center justify-between p-3.5 rounded-xl border ${profile?.resume ? "border-emerald-500/20 bg-emerald-500/5" : "border-rose-400/20 bg-rose-400/5"}`}>
                <div className="flex items-center gap-2">
                  <FileText className={`w-4 h-4 ${profile?.resume ? "text-emerald-500" : "text-rose-400"}`} />
                  <div>
                    <p className={`text-sm font-semibold ${profile?.resume ? "text-emerald-600" : "text-rose-400"}`}>
                      {profile?.resume ? "Resume Uploaded" : "No Resume"}
                    </p>
                    {profile?.resume && (
                      <p className="text-xs text-muted">{profile.resume.filename}</p>
                    )}
                  </div>
                </div>
                <Link href="/settings" className="text-xs text-primary hover:underline font-semibold">
                  {profile?.resume ? "Update" : "Upload →"}
                </Link>
              </div>

              {/* Skills */}
              {skills.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2.5">Skills</p>
                  <div className="flex flex-wrap gap-1.5">
                    {skills.slice(0, 12).map((skill, i) => (
                      <span
                        key={i}
                        className="px-2.5 py-1 rounded-lg bg-primary/8 border border-primary/15 text-primary text-xs font-semibold"
                      >
                        {skill}
                      </span>
                    ))}
                    {skills.length > 12 && (
                      <span className="px-2.5 py-1 rounded-lg bg-border/40 text-muted text-xs font-semibold">
                        +{skills.length - 12}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Recommended roles */}
              {profile?.resume?.parsed_data?.recommended_roles && profile.resume.parsed_data.recommended_roles.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2.5">AI Recommended Roles</p>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.resume.parsed_data.recommended_roles.slice(0, 4).map((role, i) => (
                      <span key={i} className="px-2.5 py-1 rounded-lg bg-accent/20 border border-accent/30 text-secondary text-xs font-semibold flex items-center gap-1">
                        <Star className="w-3 h-3" />
                        {role}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right: History */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-foreground flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  Session History
                </h2>
                {history.length > 5 && (
                  <Link href="/reports" className="text-xs text-primary hover:underline font-semibold">
                    View all →
                  </Link>
                )}
              </div>

              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center border border-dashed border-border rounded-xl">
                  <div className="w-12 h-12 rounded-xl bg-primary/8 flex items-center justify-center mb-3">
                    <BookOpen className="w-5 h-5 text-primary" />
                  </div>
                  <p className="font-semibold text-foreground text-sm mb-1">No sessions yet</p>
                  <p className="text-xs text-muted">Start your first interview to see history here.</p>
                  <button
                    onClick={() => setShowStartModal(true)}
                    className="mt-3 px-4 py-2 bg-primary text-white rounded-lg text-xs font-bold hover:bg-secondary transition-colors"
                  >
                    Begin Now
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-0.5">
                  {history.slice(0, 8).map((r) => (
                    <Link
                      href={`/report/${r.session_id}`}
                      key={r.session_id}
                      className="flex items-center justify-between p-3.5 rounded-xl bg-background border border-border hover:border-primary/30 hover:bg-primary/2 transition-all group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-2 h-8 rounded-full shrink-0 ${r.overall_score >= 70 ? "bg-emerald-400" : r.overall_score >= 40 ? "bg-amber-400" : "bg-rose-400"}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                            {r.role_title || "Mock Interview"}
                          </p>
                          <p className="text-xs text-muted">
                            {new Date(r.completed_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-sm font-black ${r.overall_score >= 70 ? "text-emerald-500" : r.overall_score >= 40 ? "text-amber-500" : "text-rose-400"}`}>
                          {r.overall_score}%
                        </span>
                        <ChevronRight className="w-4 h-4 text-muted group-hover:text-primary transition-colors" />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Row 2: Performance + Bot's Help ───────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

            {/* Topic Performance */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="font-bold text-foreground flex items-center gap-2 mb-4">
                <Target className="w-4 h-4 text-primary" />
                Topic Performance
              </h2>
              {topicPerf.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <Trophy className="w-8 h-8 text-muted/40 mb-2" />
                  <p className="text-sm text-muted">Complete interviews to see your topic strengths.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {topicPerf.slice(0, 5).map((t, i) => (
                    <div key={t.name} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-foreground flex items-center gap-2">
                          {i === 0 && <Trophy className="w-3.5 h-3.5 text-amber-400" />}
                          <span className="truncate max-w-[180px]">{t.name}</span>
                        </span>
                        <span className={`font-black text-xs ${t.avg >= 70 ? "text-emerald-500" : t.avg >= 40 ? "text-amber-500" : "text-rose-400"}`}>
                          {t.avg}% <span className="text-muted font-normal">({t.count} test{t.count > 1 ? "s" : ""})</span>
                        </span>
                      </div>
                      <div className="h-1.5 bg-border rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${t.avg >= 70 ? "bg-emerald-400" : t.avg >= 40 ? "bg-amber-400" : "bg-rose-400"}`}
                          style={{ width: `${t.avg}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Bot's Help CTA */}
            <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-accent/5 p-5 flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-md shadow-primary/20">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-bold text-foreground">Bot&apos;s Help</h2>
                  <p className="text-xs text-muted">Your personal career coach</p>
                </div>
              </div>

              <p className="text-sm text-muted leading-relaxed mb-4">
                Get a deep analysis of your resume, discover your strengths and skill gaps, and receive personalized interview preparation guidance.
              </p>

              <div className="space-y-2.5 mb-5">
                {[
                  { icon: CheckCircle2, text: "Resume strength analysis", color: "text-emerald-500" },
                  { icon: XCircle, text: "Skill gap identification", color: "text-rose-400" },
                  { icon: Lightbulb, text: "Personalized improvement tips", color: "text-amber-400" },
                ].map((item) => (
                  <div key={item.text} className="flex items-center gap-2.5">
                    <item.icon className={`w-4 h-4 shrink-0 ${item.color}`} />
                    <span className="text-sm text-foreground font-medium">{item.text}</span>
                  </div>
                ))}
              </div>

              <div className="mt-auto flex flex-col sm:flex-row gap-2.5">
                <Link
                  href="/bots-help"
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-primary hover:bg-secondary text-white rounded-xl font-bold text-sm transition-all shadow-md shadow-primary/20 active:scale-[0.97]"
                >
                  <Bot className="w-4 h-4" />
                  Open Bot&apos;s Help
                </Link>
                <button
                  onClick={() => setShowStartModal(true)}
                  className="flex-1 flex items-center justify-center gap-2 py-3 border border-primary/30 text-primary hover:bg-primary/8 rounded-xl font-bold text-sm transition-all"
                >
                  <Play className="w-4 h-4" />
                  Quick Start
                </button>
              </div>
            </div>
          </div>

          {/* Missing resume banner */}
          {!profile?.resume && (
            <div className="p-4 rounded-xl bg-primary/8 border border-primary/20 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
                  <Upload className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-primary text-sm">Upload Your Resume</p>
                  <p className="text-xs text-primary/70">We personalize your interview questions based on your resume.</p>
                </div>
              </div>
              <Link
                href="/settings"
                className="px-4 py-2 bg-primary hover:bg-secondary text-white rounded-lg text-sm font-bold transition-colors whitespace-nowrap"
              >
                Go to Settings →
              </Link>
            </div>
          )}

        </div>
      </main>
    </ProtectedRoute>
  );
}
