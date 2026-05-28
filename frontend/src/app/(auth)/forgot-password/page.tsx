"use client";

import { useState } from "react";
import Link from "next/link";
import { KeyRound, Loader2, CheckCircle } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch {
      // Always show success to prevent user enumeration
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#F2F2F2] via-[#e8f0fb] to-[#d6e8f5] p-6">
      <div className="w-full max-w-sm bg-white/80 backdrop-blur-md rounded-2xl shadow-xl border border-white/60 p-8">
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center">
            <span className="text-white font-black text-base">AI</span>
          </div>
          <span className="font-semibold text-gray-700 text-sm tracking-wide">Interview Bot</span>
        </div>

        {sent ? (
          <div className="text-center py-4">
            <CheckCircle className="mx-auto mb-4 text-green-500" size={48} />
            <h2 className="text-xl font-bold text-gray-800">Check your inbox</h2>
            <p className="text-gray-500 mt-2 text-sm">
              If <span className="font-medium text-gray-700">{email}</span> is registered, a
              password-reset link has been sent. It expires in 30 minutes.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-block text-sm text-primary font-medium hover:underline"
            >
              Back to login
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mb-3">
                <KeyRound className="text-primary" size={22} />
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Forgot password?</h1>
              <p className="text-gray-500 text-sm mt-1">
                Enter your email and we will send you a reset link.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="you@example.com"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary text-white rounded-xl py-2.5 font-semibold text-sm flex items-center justify-center gap-2 hover:bg-primary/90 transition disabled:opacity-60"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                Send reset link
              </button>
            </form>

            <p className="mt-6 text-center text-xs text-gray-400">
              Remembered it?{" "}
              <Link href="/login" className="text-primary font-medium hover:underline">
                Back to login
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
