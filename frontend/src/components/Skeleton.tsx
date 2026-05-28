import { Loader2 } from "lucide-react";

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-white/10 rounded-lg ${className}`}
    ></div>
  );
}

export function PageSkeleton() {
  return (
    <div className="pt-24 pb-12 px-4 max-w-7xl mx-auto w-full animate-fade-in space-y-8">
      {/* Header Skeleton */}
      <div className="flex items-center gap-4 mb-8">
        <Skeleton className="w-10 h-10 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>

      {/* Grid Content Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="glass-card p-6 rounded-2xl space-y-4">
            <Skeleton className="w-12 h-12 rounded-xl mb-4" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-10 w-full mt-6" />
          </div>
        ))}
      </div>
    </div>
  );
}
