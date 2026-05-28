"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Mail, Loader2, RefreshCw, CheckCircle } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";

export default function VerifyEmailPage() {
  const router = useRouter();
  const params = useSearchParams();
  const emailParam = params.get("email") || "";

  const [email, setEmail] = useState(emailParam);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 6) {
      toast.error("Enter the 6-digit code from your email.");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/verify-email", { email, otp });
      setVerified(true);
      toast.success("Email verified!", { description: "Redirecting to login..." });
      setTimeout(() => router.push("/login"), 2000);
    } catch (err: any) {
      toast.error("Verification failed", {
        description: err.response?.data?.detail || "Invalid or expired code.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      await api.post("/auth/resend-otp", { email });
      toast.success("New code sent", { description: "Check your inbox." });
      setCooldown(60);
    } catch (err: any) {
      const detail = err.response?.data?.detail || "Could not resend. Try again later.";
      toast.error("Could not resend", { description: detail });
      if (err.response?.status === 429) setCooldown(60);
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#F2F2F2] via-[#e8f0fb] to-[#d6e8f5] p-6">
      <div className="w-full max-w-sm bg-white/80 backdrop-blur-md rounded-2xl shadow-xl border border-white/60 p-8">
        {verified ? (
          <div className="text-center py-4">
            <CheckCircle className="mx-auto mb-4 text-green-500" size={48} />
            <h2 className="text-xl font-bold text-gray-800">Email Verified</h2>
            <p className="text-gray-500 mt-2 text-sm">Redirecting you to login...</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2.5 mb-6">
              <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center">
                <span className="text-white font-black text-base">AI</span>
              </div>
              <span className="font-semibold text-gray-700 text-sm tracking-wide">Interview Bot</span>
            </div>

            <div className="mb-6">
              <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mb-3">
                <Mail className="text-primary" size={22} />
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Verify your email</h1>
              <p className="text-gray-500 text-sm mt-1">
                We sent a 6-digit code to <span className="font-medium text-gray-700">{email}</span>.
                Enter it below to activate your account.
              </p>
            </div>

            <form onSubmit={handleVerify} className="space-y-4">
              {!emailParam && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="you@example.com"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Verification code</label>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                  maxLength={6}
                  inputMode="numeric"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-center tracking-widest text-lg font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="000000"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary text-white rounded-xl py-2.5 font-semibold text-sm flex items-center justify-center gap-2 hover:bg-primary/90 transition disabled:opacity-60"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                Verify Email
              </button>
            </form>

            <div className="mt-4 text-center">
              <button
                onClick={handleResend}
                disabled={resending || cooldown > 0}
                className="text-sm text-primary font-medium flex items-center gap-1.5 mx-auto hover:underline disabled:opacity-50 disabled:no-underline"
              >
                <RefreshCw size={13} />
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </button>
            </div>

            <p className="mt-6 text-center text-xs text-gray-400">
              Already verified?{" "}
              <Link href="/login" className="text-primary font-medium hover:underline">
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
