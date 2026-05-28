"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getUser, isAuthenticated, logout } from "@/lib/auth";

import { ProtectedRouteProps } from "@/types";

export default function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    // Check if user is authenticated
    if (!isAuthenticated()) {
      router.replace("/login");
      return;
    }

    const user = getUser();
    if (!user) {
      logout();
      return;
    }

    // Role-based access control
    if (requiredRole && user.role !== requiredRole) {
      // Redirect to their respective dashboard if wrong role
      router.replace(user.role === "admin" ? "/admin" : "/dashboard");
      return;
    }

    setIsAuthorized(true);
  }, [requiredRole, router]);

  if (!isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse-slow text-muted">Checking authorization...</div>
      </div>
    );
  }

  return <>{children}</>;
}
