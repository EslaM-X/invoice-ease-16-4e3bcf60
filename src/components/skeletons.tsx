import { Skeleton } from "@/components/ui/skeleton";

export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y" aria-busy="true" aria-live="polite">
      <div className="flex gap-3 px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3.5 flex-1 skeleton-shimmer" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3 px-4 py-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-4 flex-1 skeleton-shimmer" style={{ animationDelay: `${(r * cols + c) * 40}ms` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-border/60 bg-card p-5">
          <Skeleton className="h-3 w-24 skeleton-shimmer" />
          <Skeleton className="mt-4 h-6 w-32 skeleton-shimmer" />
        </div>
      ))}
    </div>
  );
}

/** Full-page shimmer block for gate/permission loads (replaces a centered spinner). */
export function PageBlockSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6" aria-busy="true" aria-live="polite">
      <Skeleton className="h-8 w-56 skeleton-shimmer" />
      <Skeleton className="h-4 w-80 skeleton-shimmer" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/60 bg-card p-5">
            <Skeleton className="h-3 w-24 skeleton-shimmer" style={{ animationDelay: `${i * 60}ms` }} />
            <Skeleton className="mt-4 h-6 w-32 skeleton-shimmer" style={{ animationDelay: `${i * 60 + 30}ms` }} />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full skeleton-shimmer" style={{ animationDelay: `${i * 50}ms` }} />
        ))}
      </div>
    </div>
  );
}

/** Card-grid shimmer for list pages that render cards instead of tables. */
export function CardGridSkeleton({ count = 6, cols = "sm:grid-cols-2 lg:grid-cols-3" }: { count?: number; cols?: string }) {
  return (
    <div className={`stagger grid gap-3 ${cols}`} aria-busy="true" aria-live="polite">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-lg skeleton-shimmer" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/3 skeleton-shimmer" />
              <Skeleton className="h-3 w-1/2 skeleton-shimmer" />
            </div>
          </div>
          <Skeleton className="h-3 w-full skeleton-shimmer" />
          <Skeleton className="h-3 w-4/5 skeleton-shimmer" />
        </div>
      ))}
    </div>
  );
}
