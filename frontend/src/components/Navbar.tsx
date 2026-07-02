"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LogOut,
  User as UserIcon,
  Settings,
  BarChart3,
  FileSignature,
  Tags,
  FileText,
  Send,
  Users,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Bot,
  Layers,
  MessageSquareDot,
  ClipboardCheck,
  CheckSquare,
} from "lucide-react";
import { getUser, logout } from "@/lib/auth";
import { User } from "@/types";

export default function Navbar() {
  const pathname = usePathname();
  const [user, setUserState] = useState<User | null>(null);
  const [isAdminCollapsed, setIsAdminCollapsed] = useState(false);

  useEffect(() => {
    setUserState(getUser());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("admin_sidebar_collapsed");
    setIsAdminCollapsed(saved === "1");
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (user?.role !== "admin") {
      document.documentElement.style.setProperty("--admin-sidebar-width", "0px");
      return;
    }

    const width = isAdminCollapsed ? "88px" : "250px";
    document.documentElement.style.setProperty("--admin-sidebar-width", width);
    localStorage.setItem("admin_sidebar_collapsed", isAdminCollapsed ? "1" : "0");
  }, [isAdminCollapsed, user?.role]);

  if (!user) return null;

  const NavLink = ({ href, icon: Icon, label }: { href: string; icon: any; label: string }) => {
    const isActive =
      href === "/admin"
        ? pathname === "/admin"
        : href === "/admin/questions"
        ? pathname === "/admin/questions" || (pathname.startsWith("/admin/questions/") && !pathname.startsWith("/admin/questions/compact"))
        : pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        href={href}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-sm font-medium ${
          isActive
            ? "bg-primary text-white shadow-lg"
            : "text-muted hover:text-primary hover:bg-primary/10"
        }`}
      >
        <Icon className="w-4 h-4 shrink-0" />
        {(!isAdminCollapsed || user.role !== "admin") && <span>{label}</span>}
      </Link>
    );
  };

  if (user.role === "admin") {
    return (
      <>
        <nav
          className={`hidden md:flex fixed top-0 left-0 bottom-0 z-50 border-r border-border bg-white/95 backdrop-blur-xl transition-all duration-200 ${
            isAdminCollapsed ? "w-[88px]" : "w-[250px]"
          }`}
        >
          <div className="w-full p-3 flex flex-col">
            <div className="flex items-center justify-between mb-5">
              <Link href="/admin" className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center shrink-0">
                  <span className="text-white font-bold text-lg">AI</span>
                </div>
                {!isAdminCollapsed && <span className="font-semibold truncate text-foreground">Interview Trainer</span>}
              </Link>
              <button
                onClick={() => setIsAdminCollapsed((prev) => !prev)}
                className="p-1.5 rounded-md text-muted hover:text-primary hover:bg-primary/10"
                aria-label="Toggle sidebar"
                title={isAdminCollapsed ? "Expand" : "Collapse"}
              >
                {isAdminCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
              </button>
            </div>

            <div className="space-y-1">
              <NavLink href="/admin" icon={BarChart3} label="Dashboard" />
              <NavLink href="/admin/topics" icon={Tags} label="Topics" />
              <NavLink href="/admin/questions" icon={FileSignature} label="Questions" />
              <NavLink href="/admin/questions/compact" icon={FileText} label="Compact Answers" />
              <NavLink href="/admin/job-descriptions" icon={Briefcase} label="Job Descriptions" />
              <NavLink href="/admin/group-tests" icon={Layers} label="Group Tests" />
              <NavLink href="/admin/chatbot" icon={MessageSquareDot} label="Student Filter" />
              <NavLink href="/admin/interviews" icon={Send} label="Make Interview" />
              <NavLink href="/admin/evaluations" icon={ClipboardCheck} label="Evaluation Answers" />
              <NavLink href="/admin/users" icon={Users} label="Users" />
              <NavLink href="/admin/settings" icon={Settings} label="Settings" />
            </div>

            <div className="mt-auto pt-4 border-t border-border">
              {!isAdminCollapsed && (
                <div className="mb-3 px-2">
                  <p className="text-sm font-medium truncate text-foreground">{user.name}</p>
                  <p className="text-xs text-muted capitalize">{user.role}</p>
                </div>
              )}
              <button
                onClick={logout}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-muted hover:text-secondary hover:bg-secondary/10 transition-colors"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
                {!isAdminCollapsed && <span>Logout</span>}
              </button>
            </div>
          </div>
        </nav>

        <nav className="md:hidden fixed top-0 left-0 right-0 z-50 glass border-b border-border">
          <div className="px-4 h-16 flex items-center justify-between">
            <Link href="/admin" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-lg">AI</span>
              </div>
              <span className="font-bold text-foreground">Interview Trainer</span>
            </Link>
            <div className="flex items-center gap-2">
              <button
                onClick={logout}
                className="p-2 rounded-lg text-muted hover:text-secondary hover:bg-secondary/10 transition-colors"
                title="Logout"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </nav>
      </>
    );
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-border">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center border border-primary/20">
              <span className="text-white font-bold text-lg">AI</span>
            </div>
            <span className="font-bold hidden sm:inline text-foreground">Interview Trainer</span>
          </Link>

          <div className="flex items-center gap-1">
            <NavLink href="/dashboard" icon={UserIcon} label="Overview" />
            <NavLink href="/bots-help" icon={Bot} label="Bot's Help" />
            <NavLink href="/group-test" icon={Layers} label="Group Tests" />
            <NavLink href="/reports" icon={BarChart3} label="Reports" />
            <NavLink href="/settings" icon={Settings} label="Settings" />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex flex-col items-end">
            <span className="text-sm font-medium text-foreground">{user.name}</span>
            <span className="text-xs text-muted capitalize">{user.role}</span>
          </div>
          <button
            onClick={logout}
            className="p-2 rounded-lg text-muted hover:text-secondary hover:bg-secondary/10 transition-colors"
            title="Logout"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>
    </nav>
  );
}
