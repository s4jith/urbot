"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UserPlus, Loader2, ArrowRight, Eye, EyeOff } from "lucide-react";
import api from "@/lib/api";
import { setToken, setUser } from "@/lib/auth";
import { SmokeBackground } from "@/components/ui/spooky-smoke-animation";
import { toast } from "sonner";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast.error("Invalid Email", { description: "Please enter a valid email address format." });
      return;
    }

    setLoading(true);

    try {
      const { data } = await api.post("/auth/signup", { email, password, name });
      setToken(data.access_token);
      setUser(data.user);
      toast.success("Account Created!", { description: "Welcome to AI Mock Interview Trainer!" });
      
      if (data.user.role === "admin") {
        router.push("/admin");
      } else {
        router.push("/dashboard");
      }
    } catch (err: any) {
      toast.error("Registration Failed", {
        description: err.response?.data?.detail || "Failed to create account. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-white overflow-hidden font-sans">
      {/* Left: Glass Form Side */}
      <div className="flex-1 flex items-center justify-center p-8 sm:p-16 lg:p-20 relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#F2F2F2] via-[#e8f0fb] to-[#d6e8f5]" />

        {/* Decorative orbs */}
        <div className="absolute top-[-80px] left-[-80px] w-[340px] h-[340px] rounded-full bg-primary/8 blur-3xl pointer-events-none" />
        <div className="absolute bottom-[-60px] right-[-60px] w-[260px] h-[260px] rounded-full bg-accent/20 blur-3xl pointer-events-none" />
        <div className="absolute top-[30%] right-[-50px] w-[200px] h-[200px] rounded-full bg-primary/5 blur-2xl pointer-events-none" />

        {/* Glass card */}
        <div className="relative z-10 w-full max-w-sm">
          {/* Brand mark */}
          <div className="flex items-center gap-2.5 mb-8 animate-fade-in">
            <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center shadow-md shadow-primary/20">
              <span className="text-white font-black text-base tracking-tight">AI</span>
            </div>
            <span className="font-bold text-foreground text-sm tracking-tight">Interview Trainer</span>
          </div>

          <div
            className="rounded-3xl border border-white/60 bg-white/70 backdrop-blur-xl shadow-2xl p-8"
            style={{ boxShadow: "0 8px 48px 0 rgba(0,71,171,0.10), 0 1.5px 8px 0 rgba(0,71,171,0.06)" }}
          >
            <div className="mb-7 animate-fade-in">
              <h1 className="text-3xl font-black tracking-tighter mb-1.5 text-primary leading-tight font-sans">
                Your Journey<br />Begins Here
              </h1>
              <p className="text-muted text-sm font-medium">Create your account to get started.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5" style={{ animation: "fadeInSoft 0.4s ease-out 0.05s both" }}>
                <label className="text-[10px] font-black text-primary/50 uppercase tracking-[0.2em] ml-0.5">Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your Name"
                  required
                  className="w-full px-4 py-3.5 bg-white/80 border border-primary/10 focus:border-primary/30 focus:bg-white rounded-2xl transition-all text-foreground font-semibold text-sm placeholder:text-muted/50 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/10"
                />
              </div>

              <div className="space-y-1.5" style={{ animation: "fadeInSoft 0.4s ease-out 0.12s both" }}>
                <label className="text-[10px] font-black text-primary/50 uppercase tracking-[0.2em] ml-0.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full px-4 py-3.5 bg-white/80 border border-primary/10 focus:border-primary/30 focus:bg-white rounded-2xl transition-all text-foreground font-semibold text-sm placeholder:text-muted/50 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/10"
                />
              </div>

              <div className="space-y-1.5" style={{ animation: "fadeInSoft 0.4s ease-out 0.19s both" }}>
                <label className="text-[10px] font-black text-primary/50 uppercase tracking-[0.2em] ml-0.5">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    minLength={6}
                    required
                    className="w-full px-4 py-3.5 pr-12 bg-white/80 border border-primary/10 focus:border-primary/30 focus:bg-white rounded-2xl transition-all text-foreground font-semibold text-sm placeholder:text-muted/50 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted/60 hover:text-primary transition-colors p-1"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div style={{ animation: "fadeInSoft 0.4s ease-out 0.26s both" }}>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 py-4 bg-primary text-white rounded-2xl font-black text-base hover:bg-secondary transition-all shadow-lg shadow-primary/25 flex items-center justify-center gap-3 group active:scale-[0.98]"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <span>CREATE ACCOUNT</span>
                      <ArrowRight className="w-5 h-5 group-hover:translate-x-1.5 transition-transform" />
                    </>
                  )}
                </button>
              </div>
            </form>

            <p className="mt-6 text-muted text-sm font-semibold tracking-tight text-center" style={{ animation: "fadeInSoft 0.4s ease-out 0.33s both" }}>
              Already joined?{" "}
              <Link href="/login" className="text-primary hover:underline font-black">
                Sign In
              </Link>
            </p>
          </div>
        </div>
      </div>

      {/* Right: Smoke Side — unchanged */}
      <div className="hidden lg:flex w-[45%] relative bg-[#020617] items-center justify-center overflow-hidden">
        <SmokeBackground
          smokeColor="#1E40AF"
          baseColor="#020617"
          brightness={0.05}
        />
        <div className="relative z-10 text-center px-12 animate-fade-in delay-500">
          <h2 className="text-white text-6xl font-black tracking-tighter leading-[0.9] mb-4">
            Interview prep <br/>Anywhere Anytime
          </h2>
          <div className="w-20 h-1 bg-white/20 mx-auto rounded-full" />
        </div>
      </div>
    </div>
  );
}
