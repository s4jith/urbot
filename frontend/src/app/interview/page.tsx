"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import {
  speak,
  stopSpeaking,
  SpeechVoiceGender,
  warmupSpeechVoices,
  prepareSpeech,
  unlockSpeechPlayback,
} from "@/lib/speech";
import { toast } from "sonner";
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  RotateCcw,
  Send,
  CheckCircle,
  Loader2,
  Edit3,
  ChevronRight,
  XCircle,
  Timer,
  AlertTriangle,
  Lock,
  MessageSquare,
  Sparkles,
} from "lucide-react";

const normalizeText = (value: string) =>
  (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
};

const difficultyConfig = (diff: string) => {
  switch (diff.toLowerCase()) {
    case "easy":   return { text: "text-emerald-600", bg: "bg-emerald-50",  border: "border-emerald-200" };
    case "medium": return { text: "text-amber-600",   bg: "bg-amber-50",   border: "border-amber-200"   };
    case "hard":   return { text: "text-rose-600",    bg: "bg-rose-50",    border: "border-rose-200"    };
    default:       return { text: "text-muted",       bg: "bg-background", border: "border-border"      };
  }
};

// ── Completion Screen ─────────────────────────────────────────────────────────

function CompletionScreen({ onViewReport, generatingReport, returnTo }: { onViewReport: () => void; generatingReport: boolean; returnTo?: string }) {
  return (
    <ProtectedRoute requiredRole="student">
      <div className="min-h-screen bg-gradient-to-br from-background via-[#e8f0fb] to-[#d6eaff] flex items-center justify-center px-4">
        <div className="w-full max-w-lg text-center animate-fade-in">
          {/* Success ring */}
          <div className="relative mx-auto mb-8 w-32 h-32">
            <div className="absolute inset-0 rounded-full bg-emerald-400/20 animate-ping" style={{ animationDuration: "2s" }} />
            <div className="absolute inset-2 rounded-full bg-emerald-100 border-2 border-emerald-200" />
            <div className="absolute inset-4 rounded-full bg-white border border-emerald-100 shadow-lg flex items-center justify-center">
              <CheckCircle className="w-12 h-12 text-emerald-500" />
            </div>
          </div>

          <div className="mb-8">
            <h1 className="text-4xl font-black text-foreground tracking-tight mb-3">
              Interview Complete! 🎉
            </h1>
            <p className="text-muted text-lg leading-relaxed">
              Outstanding effort! Your responses are being evaluated by our AI engine.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-2.5 mb-10">
            {["Detailed Scoring", "Per-question Feedback", "Improvement Tips"].map((feat) => (
              <span key={feat} className="px-3.5 py-1.5 rounded-full bg-white border border-border text-muted text-sm font-medium flex items-center gap-1.5 shadow-sm">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                {feat}
              </span>
            ))}
          </div>

          <button
            onClick={onViewReport}
            disabled={generatingReport}
            className="px-10 py-4 bg-primary hover:bg-secondary text-white rounded-2xl font-black text-lg transition-all shadow-xl shadow-primary/20 disabled:opacity-50 inline-flex items-center gap-3 active:scale-[0.97]"
          >
            {generatingReport ? (
              <><Loader2 className="w-5 h-5 animate-spin" />Generating Report…</>
            ) : returnTo ? (
              <><ChevronRight className="w-5 h-5" />Save &amp; Continue Group Test</>
            ) : (
              <><ChevronRight className="w-5 h-5" />View My Report</>
            )}
          </button>
          <p className="mt-4 text-muted/60 text-sm">Your report will be ready in a moment.</p>
        </div>
      </div>
    </ProtectedRoute>
  );
}

// ── Main Interview Content ─────────────────────────────────────────────────────

function InterviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [sessionId] = useState(searchParams.get("session") || "");
  const [currentQuestion, setCurrentQuestion] = useState(searchParams.get("q") || "");
  const [questionId, setQuestionId] = useState(searchParams.get("qid") || "");
  const [questionNumber, setQuestionNumber] = useState(parseInt(searchParams.get("num") || "1"));
  const [totalQuestions, setTotalQuestions] = useState(parseInt(searchParams.get("total") || "10"));
  const [difficulty, setDifficulty] = useState(searchParams.get("diff") || "medium");
  const [timerEnabled] = useState(searchParams.get("timerEnabled") === "1");
  const [timeLeft, setTimeLeft] = useState(parseInt(searchParams.get("timerSeconds") || "0"));
  const [isTimeUp, setIsTimeUp] = useState(false);
  const [returnTo] = useState(searchParams.get("return_to") || "");

  const [answer, setAnswer] = useState("");
  const [speechFinalTranscript, setSpeechFinalTranscript] = useState("");
  const [speechStageWarning, setSpeechStageWarning] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSpeakerEnabled, setIsSpeakerEnabled] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [isPreparingQuestionAudio, setIsPreparingQuestionAudio] = useState(false);
  const [voiceGender, setVoiceGender] = useState<SpeechVoiceGender>("female");
  const [voiceReady, setVoiceReady] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const hasSpokenRef = useRef(false);
  const didInitVoiceRef = useRef(false);
  const reportPrefetchStartedRef = useRef(false);
  const preparedQuestionRef = useRef("");
  const queuedPrefetchedTokenRef = useRef("");
  const currentQuestionToken = `${questionId || ""}::${currentQuestion || ""}`;
  const sttSupported =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;
  const [isSpeechStepComplete, setIsSpeechStepComplete] = useState(!sttSupported);

  const progress = (questionNumber / totalQuestions) * 100;
  const isTimeLow = timerEnabled && timeLeft <= 60 && timeLeft > 0;
  const diffStyle = difficultyConfig(difficulty);

  // ── Speech & Audio Effects ──

  useEffect(() => {
    if (!currentQuestion || !voiceReady || !isSpeakerEnabled || hasSpokenRef.current) return;
    let cancelled = false;
    const prepareAndPlay = async () => {
      setIsPreparingQuestionAudio(true);
      void (async () => {
        try {
          if (preparedQuestionRef.current !== currentQuestionToken) {
            await Promise.race([
              prepareSpeech(currentQuestion, { voiceGender, style: "assistant" }),
              new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 12000)),
            ]);
            preparedQuestionRef.current = currentQuestionToken;
          }
        } catch { preparedQuestionRef.current = ""; }
        finally { if (!cancelled) setIsPreparingQuestionAudio(false); }
      })();
      if (cancelled) return;
      hasSpokenRef.current = true;
      await unlockSpeechPlayback().catch(() => undefined);
      if (cancelled) return;
      playQuestion();
    };
    void prepareAndPlay();
    return () => { cancelled = true; };
  }, [currentQuestionToken, voiceReady, voiceGender, isSpeakerEnabled]);

  useEffect(() => {
    if (!sessionId || !voiceReady || !isSpeakerEnabled) return;
    let cancelled = false;
    const prefetchQueuedQuestionAudio = async () => {
      const attempts = questionNumber <= 1 ? 10 : 4;
      for (let i = 0; i < attempts; i++) {
        if (cancelled) return;
        try {
          const { data } = await api.get(`/interview/next_question?session_id=${encodeURIComponent(sessionId)}`);
          const preview = data?.next_question || null;
          const nextText = (preview?.question || "").trim();
          const nextId = (preview?.question_id || "").trim();
          if (nextText && nextId) {
            const nextToken = `${nextId}::${nextText}`;
            if (nextToken === currentQuestionToken || nextToken === preparedQuestionRef.current || nextToken === queuedPrefetchedTokenRef.current) return;
            await Promise.race([
              prepareSpeech(nextText, { voiceGender, style: "assistant" }),
              new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 20000)),
            ]);
            if (!cancelled) queuedPrefetchedTokenRef.current = nextToken;
            return;
          }
        } catch { /* retry */ }
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, questionNumber <= 1 ? 1200 : 1500));
      }
    };
    void prefetchQueuedQuestionAudio();
    return () => { cancelled = true; };
  }, [sessionId, currentQuestionToken, questionNumber, voiceReady, voiceGender, isSpeakerEnabled]);

  useEffect(() => {
    return () => {
      stopSpeaking();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
      if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach((t) => t.stop()); mediaStreamRef.current = null; }
    };
  }, []);

  useEffect(() => {
    if (didInitVoiceRef.current) return;
    didInitVoiceRef.current = true;
    const localVoice = localStorage.getItem("speech_voice_gender") as SpeechVoiceGender | null;
    const hasLocalVoice = localVoice === "male" || localVoice === "female" || localVoice === "auto";
    if (hasLocalVoice) setVoiceGender(localVoice);
    const loadVoiceFromProfile = async () => {
      if (!hasLocalVoice) {
        try {
          const { data } = await api.get("/profile");
          const serverVoice = (data?.speech_settings?.voice_gender || localVoice || "female") as SpeechVoiceGender;
          if (serverVoice === "male" || serverVoice === "female" || serverVoice === "auto") {
            setVoiceGender(serverVoice);
            localStorage.setItem("speech_voice_gender", serverVoice);
          }
        } catch { /* keep default */ }
      }
      await warmupSpeechVoices();
      setVoiceReady(true);
    };
    loadVoiceFromProfile();
  }, []);

  useEffect(() => {
    if (!isComplete || !sessionId || reportPrefetchStartedRef.current) return;
    reportPrefetchStartedRef.current = true;
    void api.get(`/interview/report?session_id=${sessionId}`).catch(() => {
      // Keep button flow as manual fallback if background prefetch fails.
      reportPrefetchStartedRef.current = false;
    });
  }, [isComplete, sessionId]);

  useEffect(() => {
    if (!timerEnabled || isComplete || isTimeUp) return;
    if (timeLeft <= 0) { setIsTimeUp(true); stopRecording(); stopSpeaking(); return; }
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) { clearInterval(timer); setIsTimeUp(true); stopRecording(); stopSpeaking(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [timerEnabled, timeLeft, isComplete, isTimeUp]);

  // ── Actions ──

  const playQuestion = () => {
    if (!isSpeakerEnabled) return;
    setIsSpeaking(true);
    void unlockSpeechPlayback().catch(() => undefined).finally(() => {
      speak(currentQuestion, () => setIsSpeaking(false), { voiceGender, style: "assistant" });
    });
  };

  const stopQuestion = () => { stopSpeaking(); setIsSpeaking(false); };

  const toggleSpeaker = () => {
    if (isSpeakerEnabled) { setIsSpeakerEnabled(false); stopQuestion(); return; }
    setIsSpeakerEnabled(true);
    if (currentQuestion && voiceReady && !isPreparingQuestionAudio) { hasSpokenRef.current = false; playQuestion(); }
  };

  const releaseRecorderResources = () => {
    if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach((t) => t.stop()); mediaStreamRef.current = null; }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
  };

  const startRecording = () => {
    if (!sttSupported || isTranscribing) return;
    stopSpeaking();
    setIsSpeaking(false);
    const beginRecording = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        const preferredMime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
        const recorder = preferredMime ? new MediaRecorder(stream, { mimeType: preferredMime }) : new MediaRecorder(stream);
        audioChunksRef.current = [];
        recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) audioChunksRef.current.push(ev.data); };
        recorder.onstop = async () => {
          setIsRecording(false); setIsTranscribing(true);
          try {
            const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
            if (blob.size === 0) throw new Error("No audio captured. Please record again.");
            const formData = new FormData();
            formData.append("audio", blob, "speech.webm");
            formData.append("language", "en");
            const { data } = await api.post("/speech/transcribe", formData, { headers: { "Content-Type": "multipart/form-data" }, timeout: 120000 });
            const transcribed = (data?.text || "").trim();
            if (!transcribed) throw new Error("No speech detected. Please speak clearly and try again.");
            setSpeechFinalTranscript(transcribed); setAnswer(transcribed); setSpeechStageWarning("");
          } catch (err: any) {
            toast.error(err.response?.data?.detail || err.message || "Failed to transcribe audio");
          } finally { setIsTranscribing(false); releaseRecorderResources(); }
        };
        recorder.onerror = () => { setIsRecording(false); setIsTranscribing(false); releaseRecorderResources(); toast.error("Microphone recording failed."); };
        mediaRecorderRef.current = recorder;
        recorder.start(200);
        setSpeechStageWarning(""); setSpeechFinalTranscript(""); setAnswer("");
        setIsSpeechStepComplete(false); setIsRecording(true);
      } catch (err: any) { setIsRecording(false); releaseRecorderResources(); toast.error(err.message || "Microphone access failed"); }
    };
    void beginRecording();
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
  };

  const submitAnswer = async () => {
    if (isTimeUp) { toast.error("Time is up. Please quit this interview."); return; }
    if (sttSupported && !isSpeechStepComplete) { toast.error("Complete speech first, then review in editor before submit."); return; }
    if (isTranscribing) { toast.error("Transcription is in progress. Please wait."); return; }
    if (!answer.trim()) return;
    setIsSubmitting(true); stopRecording(); stopSpeaking();
    try {
      const { data } = await api.post("/interview/answer", { session_id: sessionId, question_id: questionId, answer: answer.trim() });
      if (data.is_complete) {
        setIsComplete(true);
      } else if (data.next_question) {
        const nextText = data.next_question.question || "";
        const nextToken = `${data.next_question.question_id || ""}::${nextText}`;
        preparedQuestionRef.current = "";
        void prepareSpeech(nextText, { voiceGender, style: "assistant" }).then(() => { preparedQuestionRef.current = nextToken; }).catch(() => { preparedQuestionRef.current = ""; });
        hasSpokenRef.current = false;
        setCurrentQuestion(nextText); setQuestionId(data.next_question.question_id);
        setQuestionNumber(data.next_question.question_number);
        if (typeof data.next_question.total_questions === "number") setTotalQuestions(data.next_question.total_questions);
        setDifficulty(data.next_question.difficulty);
        setAnswer(""); setSpeechFinalTranscript(""); setSpeechStageWarning(""); setIsSpeechStepComplete(!sttSupported);
      }
    } catch (err: any) { toast.error(err.response?.data?.detail || "Failed to submit answer"); }
    finally { setIsSubmitting(false); }
  };

  const viewReport = async () => {
    setGeneratingReport(true);
    try {
      await api.get(`/interview/report?session_id=${sessionId}`);
      if (returnTo) {
        router.push(decodeURIComponent(returnTo));
      } else {
        router.push(`/report/${sessionId}`);
      }
    } catch (err: any) { toast.error(err.response?.data?.detail || "Failed to generate report"); setGeneratingReport(false); }
  };

  const quitInterview = async () => {
    toast("Are you sure you want to quit?", {
      description: "Your progress so far will be evaluated if you have submitted answers.",
      action: {
        label: "Quit",
        onClick: async () => {
          setIsQuitting(true); stopRecording(); stopSpeaking();
          try {
            const { data } = await api.post("/interview/quit", { session_id: sessionId });
            if (data.report_generated) { router.push(`/report/${sessionId}`); return; }
            toast.success("Interview quit successfully. No evaluated answers were found yet.");
            router.push("/dashboard");
          } catch (err: any) { toast.error(err.response?.data?.detail || "Failed to quit interview"); }
          finally { setIsQuitting(false); }
        }
      },
      cancel: { label: "Cancel", onClick: () => {} },
      duration: 10000,
    });
  };

  const markSpeechComplete = () => {
    if (!sttSupported) { setIsSpeechStepComplete(true); return; }
    stopRecording();
    if (isTranscribing) { toast.error("Please wait until transcription finishes."); return; }
    if (!speechFinalTranscript.trim()) { toast.error("Please record your answer first."); return; }
    setSpeechStageWarning(""); setAnswer(speechFinalTranscript.trim()); setIsSpeechStepComplete(true);
  };

  const onEditorChange = (nextValue: string) => {
    if (sttSupported && !isSpeechStepComplete) return;
    if (sttSupported) {
      const spoken = normalizeText(speechFinalTranscript);
      const typed = normalizeText(nextValue);
      if (spoken && typed.length > spoken.length + 3) {
        toast.error("Extra typed content is not allowed. Please continue by speaking.");
        setSpeechStageWarning("You added extra typed content. Continue in speech mode.");
        setIsSpeechStepComplete(false); setAnswer(speechFinalTranscript.trim()); return;
      }
    }
    setAnswer(nextValue);
  };

  if (isComplete) {
    return <CompletionScreen onViewReport={viewReport} generatingReport={generatingReport} returnTo={returnTo} />;
  }

  // ── 30/70 Split Layout ────────────────────────────────────────────────────

  return (
    <ProtectedRoute requiredRole="student">
      <div className="min-h-screen flex bg-background">

        {/* ── LEFT PANEL 30% — Control Panel ─────────────────────────────── */}
        <div className="w-[30%] min-w-[220px] max-w-[320px] bg-card border-r border-border flex flex-col p-5 gap-5 shadow-sm">

          {/* Brand */}
          <div className="flex items-center gap-2.5 pb-4 border-b border-border">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shrink-0 shadow-sm shadow-primary/20">
              <span className="text-white font-black text-sm">AI</span>
            </div>
            <span className="text-foreground font-bold text-sm">Interview Trainer</span>
          </div>

          {/* Status indicators */}
          <div className="space-y-3">

            {/* Question number */}
            <div className="rounded-xl bg-background border border-border p-3.5">
              <p className="text-muted text-[10px] font-bold uppercase tracking-widest mb-1">Question</p>
              <div className="flex items-end gap-1.5">
                <span className="text-primary text-3xl font-black leading-none">{questionNumber}</span>
                <span className="text-muted text-sm mb-0.5">of {totalQuestions}</span>
              </div>
              {/* Progress bar */}
              <div className="mt-3 h-1.5 bg-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-700"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-[10px] text-muted mt-1.5">{Math.round(progress)}% complete</p>
            </div>

            {/* Difficulty */}
            <div className="rounded-xl bg-background border border-border p-3.5">
              <p className="text-muted text-[10px] font-bold uppercase tracking-widest mb-2">Difficulty</p>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-xs font-bold capitalize ${diffStyle.text} ${diffStyle.bg} ${diffStyle.border}`}>
                {difficulty}
              </span>
            </div>

            {/* Timer */}
            {timerEnabled && (
              <div className={`rounded-xl border p-3.5 ${isTimeUp ? "bg-rose-50 border-rose-200" : isTimeLow ? "bg-amber-50 border-amber-200" : "bg-background border-border"}`}>
                <p className="text-muted text-[10px] font-bold uppercase tracking-widest mb-1">Time Left</p>
                <div className="flex items-center gap-2">
                  <Timer className={`w-4 h-4 ${isTimeUp ? "text-rose-500" : isTimeLow ? "text-amber-500" : "text-muted"}`} />
                  <span className={`text-2xl font-black ${isTimeUp ? "text-rose-500" : isTimeLow ? "text-amber-500" : "text-foreground"}`}>
                    {isTimeUp ? "Time up" : formatTime(timeLeft)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Speaker control */}
          <div className="rounded-xl bg-background border border-border p-3.5">
            <p className="text-muted text-[10px] font-bold uppercase tracking-widest mb-2.5">AI Voice</p>
            <button
              onClick={toggleSpeaker}
              disabled={isPreparingQuestionAudio}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold border transition-all ${
                !isSpeakerEnabled
                  ? "bg-rose-50 text-rose-500 border-rose-200"
                  : isSpeaking
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "bg-white text-muted border-border hover:border-primary/30 hover:text-primary"
              } disabled:opacity-50`}
            >
              {isSpeakerEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              {!isSpeakerEnabled ? "Speaker Off" : isSpeaking ? "Speaking…" : "Speaker On"}
            </button>
            {isSpeakerEnabled && (
              <button
                onClick={playQuestion}
                disabled={isPreparingQuestionAudio || !isSpeakerEnabled}
                className="mt-2 w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted hover:text-primary border border-border hover:border-primary/30 bg-white transition-colors disabled:opacity-40"
              >
                <RotateCcw className="w-3 h-3" />
                Repeat Question
              </button>
            )}
            {isPreparingQuestionAudio && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                <Loader2 className="w-3 h-3 animate-spin" />Preparing voice…
              </div>
            )}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Quit Button */}
          <button
            onClick={quitInterview}
            disabled={isSubmitting || isQuitting}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-rose-200 text-rose-500 bg-rose-50 hover:bg-rose-100 transition-colors text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isQuitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
            Quit Interview
          </button>
        </div>

        {/* ── RIGHT PANEL 70% — Question & Answer ─────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-background">

          {/* Top bar */}
          <div className="h-14 border-b border-border bg-card px-6 flex items-center justify-between shadow-sm shrink-0">
            <div className="flex items-center gap-2 text-muted text-sm">
              <MessageSquare className="w-4 h-4" />
              <span>Question {questionNumber} of {totalQuestions}</span>
            </div>
            <div className="flex items-center gap-2">
              {isTimeUp && (
                <span className="px-2.5 py-1 rounded-full bg-rose-50 border border-rose-200 text-rose-500 text-xs font-bold">
                  ⏰ Time Up
                </span>
              )}
              <span className={`px-2.5 py-1 rounded-full border text-xs font-bold capitalize ${diffStyle.text} ${diffStyle.bg} ${diffStyle.border}`}>
                {difficulty}
              </span>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5">

            {/* Question Card */}
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm animate-fade-in">
              <p className="text-muted text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" />
                Current Question
              </p>
              <p className="text-foreground text-xl font-semibold leading-relaxed">
                {currentQuestion}
              </p>
            </div>

            {/* Answer Panel */}
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-muted text-sm">
                  <Edit3 className="w-4 h-4" />
                  <span>{sttSupported ? (isSpeechStepComplete ? "Review Your Answer" : "Speech Mode") : "Your Answer"}</span>
                </div>

                {sttSupported && (
                  <button
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={isTimeUp || isTranscribing}
                    className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 border transition-all ${
                      isRecording
                        ? "bg-rose-50 text-rose-500 border-rose-200 hover:bg-rose-100"
                        : "bg-white text-muted border-border hover:border-primary/30 hover:text-primary"
                    } disabled:opacity-40`}
                  >
                    {isTranscribing ? (
                      <><Loader2 className="w-4 h-4 animate-spin" />Transcribing…</>
                    ) : isRecording ? (
                      <><MicOff className="w-4 h-4" />Stop Recording</>
                    ) : (
                      <><Mic className="w-4 h-4" />Use Microphone</>
                    )}
                  </button>
                )}
              </div>

              {/* Status banners */}
              {isRecording && (
                <div className="mb-4 px-4 py-2.5 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2.5">
                  <div className="w-2 h-2 rounded-full bg-rose-400 animate-pulse" />
                  <span className="text-xs text-rose-600 font-medium">Recording… Speak your answer clearly</span>
                </div>
              )}
              {sttSupported && !isSpeechStepComplete && (
                <div className="mb-4 px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-2.5">
                  <Lock className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="text-xs text-amber-700">Editor is locked. Speak your answer, then click Speech Complete.</span>
                </div>
              )}
              {speechStageWarning && (
                <div className="mb-4 px-4 py-2.5 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                  <span className="text-xs text-rose-700">{speechStageWarning}</span>
                </div>
              )}
              {sttSupported && !isSpeechStepComplete && (
                <button
                  onClick={markSpeechComplete}
                  disabled={!speechFinalTranscript.trim() || isTimeUp || isTranscribing}
                  className="mb-4 px-4 py-2.5 rounded-xl text-sm font-bold border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ✓ Speech Complete
                </button>
              )}

              {/* Textarea */}
              <textarea
                value={answer}
                onChange={(e) => onEditorChange(e.target.value)}
                placeholder={
                  sttSupported && !isSpeechStepComplete
                    ? "Speak first using the microphone. Editor unlocks after Speech Complete."
                    : "Review your spoken answer or type here…"
                }
                rows={7}
                disabled={(sttSupported && !isSpeechStepComplete) || isTimeUp}
                className="w-full rounded-xl bg-background border border-border px-4 py-3.5 text-foreground text-sm placeholder:text-muted/50 focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 resize-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              />

              {/* Footer */}
              <div className="flex items-center justify-between mt-4">
                <p className="text-xs text-muted">
                  {answer.trim() ? `${answer.trim().split(/\s+/).length} words` : "Speech-to-text output appears here."}
                </p>
                <button
                  onClick={submitAnswer}
                  disabled={!answer.trim() || isSubmitting || isTranscribing || (sttSupported && !isSpeechStepComplete) || isTimeUp}
                  className="px-6 py-2.5 bg-primary hover:bg-secondary text-white rounded-xl font-bold text-sm transition-all shadow-md shadow-primary/20 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2 active:scale-[0.97]"
                >
                  {isSubmitting ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />Submitting…</>
                  ) : (
                    <><Send className="w-4 h-4" />Submit Answer</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}

export default function InterviewPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <span className="text-sm">Loading interview session…</span>
        </div>
      </div>
    }>
      <InterviewContent />
    </Suspense>
  );
}
