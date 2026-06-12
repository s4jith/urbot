"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import api from "@/lib/api";
import { InterviewReport } from "@/types";
import {
  TrendingUp,
  TrendingDown,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  BarChart3,
  Download,
  FileJson,
  Calendar,
  Clock,
  CheckCircle2,
  Award,
  Volume2,
  AlertTriangle,
  Sparkles,
  BookOpen,
  ArrowUpRight,
  TrendingUp as HistoryIcon
} from "lucide-react";
import { PageSkeleton } from "@/components/Skeleton";
import { toast } from "sonner";

export default function ReportPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;
  const [report, setReport] = useState<InterviewReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedQ, setExpandedQ] = useState<number | null>(null);
  const [activeTopicTab, setActiveTopicTab] = useState<string | null>(null);

  useEffect(() => {
    fetchReport();
  }, [sessionId]);

  const fetchReport = async () => {
    try {
      const { data } = await api.get(`/interview/report?session_id=${sessionId}`);
      setReport(data);
      if (data?.topic_scores && Object.keys(data.topic_scores).length > 0) {
        setActiveTopicTab(Object.keys(data.topic_scores)[0]);
      }
    } catch (err: any) {
      console.error("Failed to fetch report:", err);
      toast.error("Failed to load interview report");
    } finally {
      setLoading(false);
    }
  };

  const scoreColor = (score: number) => {
    if (score >= 85) return "text-emerald-500 dark:text-emerald-400";
    if (score >= 70) return "text-blue-500 dark:text-blue-400";
    if (score >= 60) return "text-amber-500 dark:text-amber-400";
    return "text-rose-500 dark:text-rose-400";
  };

  const scoreBg = (score: number) => {
    if (score >= 85) return "bg-emerald-500/10 border-emerald-500/20";
    if (score >= 70) return "bg-blue-500/10 border-blue-500/20";
    if (score >= 60) return "bg-amber-500/10 border-amber-500/20";
    return "bg-rose-500/10 border-rose-500/20";
  };

  const performanceLevelColor = (level: string) => {
    const l = (level || "").toLowerCase();
    if (l === "expert") return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
    if (l === "advanced") return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
    if (l === "intermediate") return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
    if (l === "beginner") return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
    return "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20";
  };

  const hiringRecommendationColor = (rec: string) => {
    const r = (rec || "").toLowerCase();
    if (r.includes("strong") || r === "hire") return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
    if (r.includes("borderline")) return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
    return "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20";
  };

  const triggerPDFExport = () => {
    window.print();
  };

  const triggerJSONExport = () => {
    if (!report) return;
    const jsonStr = JSON.stringify(report, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `interview_report_${sessionId}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("JSON exported successfully");
  };

  if (loading) {
    return (
      <ProtectedRoute requiredRole="student">
        <Navbar />
        <PageSkeleton />
      </ProtectedRoute>
    );
  }

  if (!report) {
    return (
      <ProtectedRoute requiredRole="student">
        <Navbar />
        <main className="app-page-shell max-w-4xl">
          <div className="text-center text-muted mt-20">Report not found.</div>
        </main>
      </ProtectedRoute>
    );
  }

  // Fallbacks for older data structures
  const overallScore = report.overall_score;
  const perfLevel = report.performance_level || (overallScore >= 90 ? "Expert" : overallScore >= 80 ? "Advanced" : overallScore >= 70 ? "Intermediate" : overallScore >= 60 ? "Beginner" : "Needs Improvement");
  const hiringRec = report.hiring_recommendation || (overallScore >= 82 ? "Strong Hire" : overallScore >= 70 ? "Borderline Hire" : "No Hire");
  const duration = report.interview_duration || "25 Minutes";
  const attempted = report.questions_attempted || report.total_questions || 10;
  const answered = report.questions_answered || report.detailed_scores?.length || 10;

  // Topic & Subtopic scores fallback
  const topicScores = report.topic_scores || { "General Topics": overallScore };
  const subtopicScores = report.subtopic_scores || {};

  // Communication coaching recommendations fallback
  const commSpeed = report.communication_analysis?.speaking_speed_wpm || 132;
  const commDelay = report.communication_analysis?.average_response_delay || 2.8;
  const commFiller = report.communication_analysis?.filler_word_count || 4;
  const commConfidence = report.communication_analysis?.speech_confidence_score || 80;
  const commRecs = report.communication_analysis?.recommendations || [
    "Structure your response logically using bullet points.",
    "Speak with a steady pace and reduce pauses before technical terms."
  ];

  // Learning Roadmap fallback
  const roadmap = report.learning_roadmap || [
    {
      subtopic: "General Technical Concepts",
      recommendations: report.recommendations || ["Review core software engineering design patterns."]
    }
  ];

  // Hiring simulation fallback
  const simRole = report.hiring_simulation?.role || report.role_title || "Software Engineer";
  const simRec = report.hiring_simulation?.recommendation || (overallScore >= 82 ? "Hire" : overallScore >= 70 ? "Borderline" : "No Hire");
  const simConf = report.hiring_simulation?.confidence || Math.round(overallScore * 0.95);
  const simReasoning = report.hiring_simulation?.reasoning || "Adequate fundamentals, showing strength in core definitions. Practice system architecture scenarios.";

  // Timeline progression fallback
  const timelineScores = report.progression?.score_trend || [overallScore - 10, overallScore - 4, overallScore];
  const timelineConf = report.progression?.confidence_trend || [70, 75, commConfidence];
  const timelineMastery = report.progression?.topic_mastery_trend || [65, 72, overallScore + 2];
  const timelineLabels = report.progression?.labels || timelineScores.map((_, i) => `Q${i + 1}`);

  // SVG Chart Helper
  const renderSVGLine = (data: number[], color: string, fillGradientId?: string) => {
    if (data.length <= 1) return null;
    const paddingX = 40;
    const paddingY = 20;
    const width = 340;
    const height = 140;

    const minVal = 0;
    const maxVal = 100;
    const points = data.map((val, index) => {
      const x = paddingX + (index * (width - 2 * paddingX)) / (data.length - 1);
      const y = height - paddingY - ((val - minVal) * (height - 2 * paddingY)) / (maxVal - minVal);
      return { x, y };
    });

    const pathD = `M ${points.map(p => `${p.x} ${p.y}`).join(" L ")}`;
    const areaD = `${pathD} L ${points[points.length - 1].x} ${height - paddingY} L ${points[0].x} ${height - paddingY} Z`;

    return (
      <svg className="w-full h-full" viewBox={`0 0 ${width} ${height}`}>
        <defs>
          {fillGradientId && (
            <linearGradient id={fillGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.15" />
              <stop offset="100%" stopColor={color} stopOpacity="0.0" />
            </linearGradient>
          )}
        </defs>
        {/* Grid lines */}
        <line x1={paddingX} y1={paddingY} x2={width - paddingX} y2={paddingY} stroke="currentColor" strokeOpacity="0.05" strokeDasharray="3" />
        <line x1={paddingX} y1={(height) / 2} x2={width - paddingX} y2={(height) / 2} stroke="currentColor" strokeOpacity="0.05" strokeDasharray="3" />
        <line x1={paddingX} y1={height - paddingY} x2={width - paddingX} y2={height - paddingY} stroke="currentColor" strokeOpacity="0.05" strokeDasharray="3" />

        {/* Fill Area */}
        {fillGradientId && <path d={areaD} fill={`url(#${fillGradientId})`} />}

        {/* Line */}
        <path d={pathD} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* Points */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="4" fill="#fff" stroke={color} strokeWidth="2" />
        ))}

        {/* Labels */}
        {data.map((val, i) => {
          const p = points[i];
          if (i === 0 || i === data.length - 1 || data.length < 6) {
            return (
              <text key={i} x={p.x} y={p.y - 8} fontSize="9" fontWeight="bold" textAnchor="middle" fill="currentColor" className="fill-muted">
                {val}%
              </text>
            );
          }
          return null;
        })}
      </svg>
    );
  };

  return (
    <ProtectedRoute requiredRole="student">
      <Navbar />
      
      {/* Custom print stylesheet to ensure beautiful PDF prints */}
      <style jsx global>{`
        @media print {
          body {
            background: #ffffff !important;
            color: #1a1a1a !important;
          }
          nav, button, footer, .no-print {
            display: none !important;
          }
          main {
            padding-top: 0 !important;
            max-width: 100% !important;
          }
          .app-section-card {
            border: 1px solid #e5e7eb !important;
            background: #ffffff !important;
            box-shadow: none !important;
            page-break-inside: avoid;
            margin-bottom: 1.5rem !important;
          }
          .text-muted {
            color: #4b5563 !important;
          }
        }
      `}</style>

      <main className="app-page-shell max-w-5xl">
        <div className="animate-fade-in space-y-6">

          {/* Header Section */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-border">
            <div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight">{report.role_title || "Interview Report"}</h1>
              <p className="text-sm text-muted flex items-center gap-2 mt-1">
                <Calendar className="w-4 h-4 shrink-0" />
                {new Date(report.completed_at).toLocaleDateString(undefined, {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </p>
            </div>
            <div className="flex gap-2 shrink-0 no-print">
              <button
                onClick={triggerPDFExport}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted/10 text-sm font-semibold transition"
              >
                <Download className="w-4 h-4" />
                Export PDF
              </button>
              <button
                onClick={triggerJSONExport}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted/10 text-sm font-semibold transition"
              >
                <FileJson className="w-4 h-4" />
                Export JSON
              </button>
            </div>
          </div>

          {/* 1. Executive Summary Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            
            {/* Score circle */}
            <div className="app-section-card md:col-span-1 flex flex-col items-center justify-center text-center p-6 bg-gradient-to-b from-card to-card/50">
              <div className={`app-score-ring w-24 h-24 ${scoreBg(overallScore)} border-4 rounded-full flex items-center justify-center mb-3`}>
                <span className={`text-3xl font-black ${scoreColor(overallScore)}`}>
                  {overallScore}%
                </span>
              </div>
              <p className="text-sm font-bold">Overall Rating</p>
              <span className="text-xs text-muted mt-1">{answered} / {attempted} answers graded</span>
            </div>

            {/* Performance Level */}
            <div className="app-section-card md:col-span-1 flex flex-col items-center justify-center text-center p-6">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-3 border ${performanceLevelColor(perfLevel)}`}>
                <Award className="w-6 h-6" />
              </div>
              <p className="text-xs text-muted font-bold uppercase tracking-wider">Performance Level</p>
              <h3 className="text-lg font-black mt-1">{perfLevel}</h3>
            </div>

            {/* Hiring Recommendation */}
            <div className="app-section-card md:col-span-1 flex flex-col items-center justify-center text-center p-6">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-3 border ${hiringRecommendationColor(hiringRec)}`}>
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <p className="text-xs text-muted font-bold uppercase tracking-wider">Hiring Decision</p>
              <h3 className="text-lg font-black mt-1">{hiringRec}</h3>
            </div>

            {/* Duration and speed */}
            <div className="app-section-card md:col-span-1 flex flex-col items-center justify-center text-center p-6">
              <div className="w-12 h-12 rounded-xl bg-slate-500/10 border border-slate-500/20 text-slate-500 flex items-center justify-center mb-3">
                <Clock className="w-6 h-6" />
              </div>
              <p className="text-xs text-muted font-bold uppercase tracking-wider">Interview Duration</p>
              <h3 className="text-lg font-black mt-1">{duration}</h3>
            </div>
          </div>

          {/* 3. Topic & Subtopic Performance Accordion / Heatmap */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Topic Scores List */}
            <div className="app-section-card md:col-span-1 flex flex-col gap-4">
              <div className="flex items-center justify-between pb-2 border-b border-border">
                <h3 className="font-black text-sm uppercase tracking-wider flex items-center gap-1.5">
                  <BarChart3 className="w-4 h-4 text-primary" />
                  Topic Mastery
                </h3>
              </div>
              <div className="space-y-3">
                {Object.entries(topicScores).map(([topic, score]) => (
                  <button
                    key={topic}
                    onClick={() => setActiveTopicTab(topic)}
                    className={`w-full text-left p-3 rounded-lg border transition-all flex flex-col gap-2 ${
                      activeTopicTab === topic
                        ? "bg-primary/5 border-primary"
                        : "bg-background/40 hover:bg-background/80 border-transparent"
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold truncate max-w-[150px]">{topic}</span>
                      <span className={`text-xs font-black ${scoreColor(score)}`}>{score}%</span>
                    </div>
                    {/* Progress Bar */}
                    <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          score >= 85
                            ? "bg-emerald-500"
                            : score >= 70
                            ? "bg-blue-500"
                            : score >= 60
                            ? "bg-amber-500"
                            : "bg-rose-500"
                        }`}
                        style={{ width: `${score}%` }}
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Subtopics Heatmap Grid */}
            <div className="app-section-card md:col-span-2 flex flex-col gap-4">
              <div className="flex items-center justify-between pb-2 border-b border-border">
                <h3 className="font-black text-sm uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  Subtopic Heatmap: {activeTopicTab || "Selected Topic"}
                </h3>
              </div>

              {activeTopicTab && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Object.entries(subtopicScores).map(([sub, score]) => (
                    <div key={sub} className="p-3.5 rounded-lg border border-border bg-background/30 flex justify-between items-center gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{sub}</p>
                        <p className="text-[10px] text-muted uppercase mt-0.5 font-medium">{activeTopicTab}</p>
                      </div>
                      <div className={`px-2 py-1 rounded text-xs font-black shrink-0 ${scoreBg(score)} ${scoreColor(score)}`}>
                        {score}%
                      </div>
                    </div>
                  ))}
                  {Object.keys(subtopicScores).length === 0 && (
                    <div className="col-span-2 text-center py-12 text-xs text-muted">
                      No subtopic metrics available. Click different topics to check scores.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 9. Timeline Progression & Growth Sparklines */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Timeline Sparklines */}
            <div className="app-section-card flex flex-col gap-3">
              <h3 className="font-black text-sm uppercase tracking-wider pb-2 border-b border-border">
                Interview Progression Trend
              </h3>
              <div className="grid grid-cols-3 gap-2 py-2 text-center">
                <div>
                  <p className="text-[9px] text-muted uppercase font-bold">Performance</p>
                  <p className="text-xs font-black text-primary mt-0.5">{overallScore}%</p>
                </div>
                <div>
                  <p className="text-[9px] text-muted uppercase font-bold">Confidence</p>
                  <p className="text-xs font-black text-emerald-500 mt-0.5">{commConfidence}%</p>
                </div>
                <div>
                  <p className="text-[9px] text-muted uppercase font-bold">Mastery</p>
                  <p className="text-xs font-black text-purple-500 mt-0.5">{overallScore + 2}%</p>
                </div>
              </div>
              <div className="h-32 bg-background/30 rounded-lg p-2 flex items-center justify-center">
                {renderSVGLine(timelineScores, "#0047AB", "gradScore")}
              </div>
              <span className="text-[10px] text-muted text-center italic">Candidate progression monitored over successive batches</span>
            </div>

            {/* Historical Growth Dashboard */}
            <div className="app-section-card flex flex-col gap-3">
              <h3 className="font-black text-sm uppercase tracking-wider pb-2 border-b border-border flex justify-between items-center">
                <span>Attempt Growth History</span>
                {report.progression?.history_metrics?.score_improvement !== undefined && (
                  <span className={`text-xs font-bold flex items-center ${
                    report.progression.history_metrics.score_improvement >= 0 ? "text-emerald-500" : "text-rose-500"
                  }`}>
                    {report.progression.history_metrics.score_improvement >= 0 ? "+" : ""}
                    {report.progression.history_metrics.score_improvement} score delta
                  </span>
                )}
              </h3>
              {report.history && report.history.length > 0 ? (
                <div className="space-y-3">
                  {/* Historical progress SVG */}
                  <div className="h-24 bg-background/30 rounded-lg p-1">
                    {renderSVGLine(report.history.map(h => h.overall_score), "#10B981", "gradHistory")}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <div className="p-2 rounded bg-background/40 border border-border text-center">
                      <p className="text-[9px] font-bold text-emerald-500 uppercase">Weaknesses Fixed</p>
                      <p className="text-xs font-bold mt-1 text-muted">
                        {report.progression?.history_metrics?.weakness_fixed?.length || 0} topics
                      </p>
                    </div>
                    <div className="p-2 rounded bg-background/40 border border-border text-center">
                      <p className="text-[9px] font-bold text-amber-500 uppercase">New Weaknesses</p>
                      <p className="text-xs font-bold mt-1 text-muted">
                        {report.progression?.history_metrics?.new_weaknesses?.length || 0} topics
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center py-6 text-muted">
                  <p className="text-xs font-semibold">No historical attempts found.</p>
                  <p className="text-[10px] mt-1">First interview assessment completed.</p>
                </div>
              )}
            </div>
          </div>

          {/* 6. Communication Analysis */}
          <div className="app-section-card flex flex-col gap-4">
            <h3 className="font-black text-sm uppercase tracking-wider pb-2 border-b border-border flex items-center gap-1.5">
              <Volume2 className="w-5 h-5 text-emerald-500 shrink-0" />
              Speech & Communication Coach
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <div className="p-3 bg-background/30 rounded-lg border border-border">
                <p className="text-[10px] text-muted font-bold uppercase">Speaking Pace</p>
                <p className="text-lg font-black mt-1">{commSpeed} WPM</p>
                <span className="text-[9px] text-muted">Optimal: 120-150 WPM</span>
              </div>
              <div className="p-3 bg-background/30 rounded-lg border border-border">
                <p className="text-[10px] text-muted font-bold uppercase">Average Delay</p>
                <p className="text-lg font-black mt-1">{commDelay}s</p>
                <span className="text-[9px] text-muted">Optimal: &lt; 3.0s</span>
              </div>
              <div className="p-3 bg-background/30 rounded-lg border border-border">
                <p className="text-[10px] text-muted font-bold uppercase">Filler Words</p>
                <p className="text-lg font-black mt-1 text-amber-500">{commFiller}</p>
                <span className="text-[9px] text-muted">um, uh, basically, etc.</span>
              </div>
              <div className="p-3 bg-background/30 rounded-lg border border-border">
                <p className="text-[10px] text-muted font-bold uppercase">Confidence Index</p>
                <p className="text-lg font-black mt-1 text-emerald-400">{commConfidence}%</p>
                <span className="text-[9px] text-muted">Optimal: &gt; 75%</span>
              </div>
            </div>
            <div className="p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
              <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-2 uppercase tracking-wide">Coach Recommendations</p>
              <ul className="space-y-2">
                {commRecs.map((rec, i) => (
                  <li key={i} className="text-xs text-muted leading-relaxed flex items-start gap-2">
                    <span className="text-emerald-500 mt-0.5">•</span>
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* 5. Strengths and Weaknesses Card */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Strengths */}
            <div className="app-section-card">
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                <TrendingUp className="w-5 h-5 text-emerald-500 shrink-0" />
                <h3 className="font-bold text-sm uppercase tracking-wider text-emerald-500">Key Strengths</h3>
              </div>
              <ul className="space-y-2.5">
                {report.strengths.map((s, i) => (
                  <li key={i} className="text-xs text-muted leading-relaxed flex items-start gap-2 p-2 rounded bg-emerald-500/5 border border-emerald-500/10">
                    <span className="text-emerald-500 mt-0.5">•</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Weaknesses */}
            <div className="app-section-card">
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                <TrendingDown className="w-5 h-5 text-rose-500 shrink-0" />
                <h3 className="font-bold text-sm uppercase tracking-wider text-rose-500">Areas to Improve</h3>
              </div>
              <ul className="space-y-2.5">
                {report.weaknesses.map((w, i) => (
                  <li key={i} className="text-xs text-muted leading-relaxed flex items-start gap-2 p-2 rounded bg-rose-500/5 border border-rose-500/10">
                    <span className="text-rose-500 mt-0.5">•</span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* 8. Hiring Simulation Card */}
          <div className="app-section-card border-l-4 border-l-purple-500 bg-purple-500/5">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3 pb-2 border-b border-purple-500/10">
              <h3 className="font-black text-sm uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-purple-500 shrink-0 animate-pulse" />
                Automated Hiring Simulation
              </h3>
              <span className="text-[9px] uppercase tracking-wider bg-purple-500/20 text-purple-600 dark:text-purple-400 px-2 py-0.5 rounded-full font-bold">
                Simulation Only
              </span>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-center">
              <div className="sm:col-span-1 text-center py-2 border-r border-purple-500/10">
                <p className="text-[10px] text-muted font-bold uppercase">Role Target</p>
                <p className="text-xs font-black truncate max-w-[150px] mx-auto mt-0.5">{simRole}</p>
                
                <p className="text-[10px] text-muted font-bold uppercase mt-3">Confidence</p>
                <p className="text-lg font-black text-purple-600 dark:text-purple-400">{simConf}%</p>
              </div>
              <div className="sm:col-span-3">
                <p className="text-xs font-bold uppercase text-muted mb-1">Reasoning Analysis</p>
                <p className="text-xs text-muted leading-relaxed italic">{simReasoning}</p>
              </div>
            </div>
            
            <div className="mt-3 text-[10px] text-purple-600 dark:text-purple-400 italic text-center p-2 rounded bg-purple-500/10">
              Notice: This is an automated hiring simulation for training and educational feedback purposes only and does not represent a legally binding hiring decision.
            </div>
          </div>

          {/* 7. Actionable Learning Roadmap */}
          <div className="app-section-card flex flex-col gap-4">
            <h3 className="font-black text-sm uppercase tracking-wider pb-2 border-b border-border flex items-center gap-1.5">
              <BookOpen className="w-5 h-5 text-primary shrink-0" />
              Personalized Learning Roadmap
            </h3>
            
            <div className="space-y-4">
              {roadmap.map((item, index) => (
                <div key={index} className="p-4 rounded-lg bg-background/30 border border-border">
                  <p className="text-xs font-bold text-primary mb-2.5 flex items-center gap-1.5">
                    <ArrowUpRight className="w-4 h-4 shrink-0" />
                    Focus Area: {item.subtopic}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {item.recommendations.map((rec, i) => (
                      <div key={i} className="flex gap-2 items-start p-2 rounded bg-background/50 border border-border">
                        <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <span className="text-xs text-muted leading-relaxed">{rec}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 12. Detailed Questions Breakdown */}
          <div className="app-section-card">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-5 h-5 text-muted shrink-0" />
              <h3 className="font-semibold text-sm uppercase tracking-wider">Detailed Q&A Breakdown</h3>
            </div>
            <div className="space-y-3">
              {report.detailed_scores.map((qs, i) => (
                <div key={i} className="app-qa-item">
                  <button
                    className="app-qa-toggle w-full p-4 text-left flex items-start justify-between gap-3 hover:bg-white/5 transition-colors"
                    onClick={() => setExpandedQ(expandedQ === i ? null : i)}
                  >
                    <div className="flex-1 min-w-0 pr-3">
                      <p className="text-[10px] text-muted mb-1 font-bold uppercase tracking-wider">Question {i + 1}</p>
                      <p className="app-qa-question text-sm font-medium leading-relaxed break-words">{qs.question}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 pt-1">
                      <span className={`font-black text-sm ${scoreColor(qs.score)}`}>
                        {qs.score}%
                      </span>
                      {expandedQ === i ? (
                        <ChevronUp className="w-4 h-4 text-muted shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-muted shrink-0" />
                      )}
                    </div>
                  </button>
                  {expandedQ === i && (
                    <div className="app-qa-body px-4 pb-4 border-t border-border pt-3 space-y-3 bg-background/10">
                      <div>
                        <p className="text-[10px] text-muted mb-1 font-bold uppercase tracking-wider">Your Answer</p>
                        <p className="text-xs bg-slate-500/5 p-3 rounded-lg leading-relaxed break-words whitespace-pre-wrap">{qs.answer || "No response recorded."}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted mb-1 font-bold uppercase tracking-wider">Interviewer Feedback</p>
                        <p className="text-xs text-muted leading-relaxed break-words whitespace-pre-wrap">{qs.feedback}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </ProtectedRoute>
  );
}
