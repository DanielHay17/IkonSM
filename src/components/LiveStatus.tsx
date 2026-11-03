import type { PropertyState } from "../../shared/types";
import { POLL_INTERVAL_MS, type LiveMode } from "../hooks/usePropertyLive";
import { useNow } from "../hooks/useNow";
import { cx } from "../lib/cx";
import { formatElapsed } from "../lib/format";

/** "Agent working: Triaging email from Jane…" with a soft pulse and an elapsed timer. */
export function BusyIndicator({ busy, className }: { busy: PropertyState["busy"] | null | undefined; className?: string }) {
  const active = !!busy?.active;
  const now = useNow(1000, active);

  return (
    <div aria-live="polite" className={className}>
      {active ? (
        <span className="inline-flex max-w-full animate-fade-in items-center gap-2 rounded-full bg-accent-soft py-1 pr-3 pl-2.5 text-xs font-medium text-accent-strong ring-1 ring-accent/20 ring-inset">
          <span aria-hidden="true" className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent/50 motion-reduce:hidden" />
            <span className="relative inline-flex size-2 animate-soft-pulse rounded-full bg-accent" />
          </span>
          <span className="truncate">
            <span className="font-semibold">Agent working</span>
            {busy?.label ? <span className="font-normal">: {busy.label}</span> : null}
          </span>
          {busy?.since ? <span className="shrink-0 font-mono text-[11px] text-accent/80 tabular-nums">{formatElapsed(busy.since, now)}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

const MODES: Record<LiveMode, { label: string; dot: string; title: string }> = {
  live: { label: "Live", dot: "bg-emerald-500", title: "Connected to the building agent: updates appear instantly" },
  connecting: { label: "Connecting", dot: "bg-slate-400 animate-soft-pulse", title: "Connecting to the building agent" },
  polling: {
    label: `Refreshing every ${POLL_INTERVAL_MS / 1000}s`,
    dot: "bg-amber-500",
    title: "Live connection unavailable: checking for updates on a timer",
  },
};

export function LiveModeIndicator({ mode, className }: { mode: LiveMode; className?: string }) {
  const { label, dot, title } = MODES[mode];
  return (
    <span title={title} className={cx("inline-flex items-center gap-1.5 text-xs text-muted", className)}>
      <span aria-hidden="true" className={cx("size-1.5 rounded-full", dot)} />
      <span>{label}</span>
      <span className="sr-only">: {title}</span>
    </span>
  );
}
