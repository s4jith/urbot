"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Lock, Loader2, Eye, EyeOff, CheckCircle } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";

export default function ResetPasswordPage() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") || "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword.length < 8) {
      toast.error("Password too short", { description: "Must be at least 8 characters." });
      return;
    }
    if (!/\d/.test(newPassword) || !/[a-zA-Z]/.test(newPassword)) {
      toast.error("Weak password", { description: "Must contain at least one letter and one number." });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (!token) {
      toast.error("Invalid reset link", { description: "No token found in the URL." });
      return;
    }

    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, new_password: newPassword });
      setDone(true);
      toast.success("Password updated!", { description: "You can now log in." });
      setTimeout(() => router.push("/login"), 2500);
    } catch (err: any) {
      toast.error("Reset failed", {
        description: err.response?.data?.detail || "Link may have expired. Request a new one.",
      });
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

        {done ? (
          <div className="text-center py-4">
            <CheckCircle className="mx-auto mb-4 text-green-500" size={48} />
            <h2 className="text-xl font-bold text-gray-800">Password updated</h2>
            <p className="text-gray-500 mt-2 text-sm">Redirecting you to login...</p>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mb-3">
                <Lock className="text-primary" size={22} />
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Set new password</h1>
              <p className="text-gray-500 text-sm mt-1">
                Choose a strong password. It must be at least 8 characters with a letter and a number.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
                <div className="relative">
                  <input
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    autoFocus
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="Min. 8 characters"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
                <div className="relative">
                  <input
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="Re-enter password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary text-white rounded-xl py-2.5 font-semibold text-sm flex items-center justify-center gap-2 hover:bg-primary/90 transition disabled:opacity-60"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                Update password
              </button>
            </form>

            <p className="mt-6 text-center text-xs text-gray-400">
              Link expired?{" "}
              <Link href="/forgot-password" className="text-primary font-medium hover:underline">
                Request a new one
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
