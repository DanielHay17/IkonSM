import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon, type IconName } from "./Icon";

export type BadgeTone = "neutral" | "accent" | "red" | "amber" | "slate" | "green" | "navy" | "violet" | "sky";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-[#f1efea] text-ink-soft ring-line",
  accent: "bg-accent-soft text-accent-strong ring-accent/20",
  red: "bg-red-50 text-red-800 ring-red-200",
  amber: "bg-amber-50 text-amber-900 ring-amber-200",
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  navy: "bg-navy text-white ring-navy",
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
  sky: "bg-sky-50 text-sky-800 ring-sky-200",
};

const DOTS: Record<BadgeTone, string> = {
  neutral: "bg-muted",
  accent: "bg-accent",
  red: "bg-red-600",
  amber: "bg-amber-500",
  slate: "bg-slate-500",
  green: "bg-emerald-500",
  navy: "bg-white",
  violet: "bg-violet-500",
  sky: "bg-sky-500",
};

interface BadgeProps {
  tone?: BadgeTone;
  icon?: IconName;
  dot?: boolean;
  /** Solid badges are for the most important signals (P1). */
  solid?: boolean;
  mono?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}

export function Badge({ tone = "neutral", icon, dot, solid, mono, title, className, children }: BadgeProps) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex max-w-full shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap ring-1 ring-inset",
        solid && tone === "red" ? "bg-red-600 text-white ring-red-600" : TONES[tone],
        mono && "font-mono tracking-tight",
        className,
      )}
    >
      {dot ? <span aria-hidden="true" className={cx("size-1.5 rounded-full", solid ? "bg-white" : DOTS[tone])} /> : null}
      {icon ? <Icon name={icon} className="size-3" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** A small count bubble (nav items, tabs). */
export function CountBubble({ count, tone = "neutral", label }: { count: number; tone?: "neutral" | "red" | "accent" | "dark"; label?: string }) {
  if (count <= 0) return null;
  const tones = {
    neutral: "bg-ink/[0.06] text-ink-soft",
    red: "bg-red-600 text-white",
    accent: "bg-accent text-white",
    dark: "bg-white/12 text-white",
  } as const;
  return (
    <span
      className={cx(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
        tones[tone],
      )}
    >
      {count > 99 ? "99+" : count}
      {label ? <span className="sr-only"> {label}</span> : null}
    </span>
  );
}
