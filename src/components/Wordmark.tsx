import { cx } from "../lib/cx";

/** Ikon Command Hub mark: three building bars in the accent square. */
export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cx("shrink-0", className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0f766e" />
      <path d="M9.5 23V14M16 23V9M22.5 23v-6" stroke="white" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ tone = "dark", subtitle = true }: { tone?: "dark" | "light"; subtitle?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="leading-tight">
        <span className={cx("block text-[15px] font-semibold tracking-tight", tone === "dark" ? "text-white" : "text-ink")}>
          Ikon <span className={tone === "dark" ? "font-medium text-navy-text" : "font-medium text-muted"}>Command Hub</span>
        </span>
        {subtitle ? (
          <span className={cx("block text-[11px] font-medium tracking-wide uppercase", tone === "dark" ? "text-navy-muted" : "text-muted")}>
            Strata operations
          </span>
        ) : null}
      </span>
    </span>
  );
}
