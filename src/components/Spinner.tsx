import { cx } from "../lib/cx";

interface SpinnerProps {
  className?: string;
  /** Screen-reader text; pass null when a visible label sits next to the spinner. */
  label?: string | null;
}

export function Spinner({ className = "size-4", label = "Loading" }: SpinnerProps) {
  return (
    <span role={label ? "status" : undefined} className="inline-flex items-center">
      <svg viewBox="0 0 24 24" fill="none" className={cx("animate-spin", className)} aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
