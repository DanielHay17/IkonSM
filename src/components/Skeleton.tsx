import { cx } from "../lib/cx";

/** Where the skeleton sits: on white or the page (default), inside a grey well (board columns), or on charcoal. */
export type SkeletonTone = "default" | "onSunken" | "onDark";

const TONES: Record<SkeletonTone, string> = {
  default: "bg-sunken",
  onSunken: "bg-surface",
  onDark: "bg-white/5",
};

export function Skeleton({ className, tone = "default" }: { className?: string; tone?: SkeletonTone }) {
  return <div aria-hidden="true" className={cx("animate-pulse rounded-md", TONES[tone], className)} />;
}

/** A few lines of placeholder text. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cx("space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cx("h-3", i === lines - 1 ? "w-3/5" : "w-full")} />
      ))}
    </div>
  );
}

/** Placeholder rows for lists while the first load is in flight. */
export function SkeletonList({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cx("divide-y divide-line", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-4">
          <Skeleton className="h-5 w-8" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cx("rounded-xl border border-line bg-surface p-5 shadow-card", className)}>
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-5 w-16" />
      </div>
      <Skeleton className="mt-4 h-4 w-3/4" />
      <Skeleton className="mt-2 h-3 w-1/3" />
      <div className="mt-5 grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-8" />
        ))}
      </div>
    </div>
  );
}
