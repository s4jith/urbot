"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated, getUser } from "@/lib/auth";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated()) {
      const user = getUser();
      router.replace(user?.role === "admin" ? "/admin" : "/dashboard");
    } else {
      router.replace("/login");
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center">
      <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-6 animate-pulse-slow">
        <span className="text-black font-bold text-2xl">AI</span>
      </div>
      <p className="text-muted animate-fade-in">Loading Interview Trainer...</p>
    </div>
  );
}
