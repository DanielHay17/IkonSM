import { useState } from "react";
import { api } from "../api";
import { cx } from "../lib/cx";
import { useSession } from "../providers/SessionProvider";
import { AiStatusPill } from "./StatusBadges";
import { useToast } from "./Toast";

/**
 * The hub-wide AI switch, in the dark sidebar. On uses the deployment's AI engine (for example Workers AI);
 * off is the rules engine and templates. Without an engine to switch on, it is just the status pill.
 */
export function AiSwitch() {
  const { session, setSession } = useSession();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const info = session.aiSwitch;
  if (!info?.available) return <AiStatusPill online={session.aiOnline} ai={session.ai} tone="dark" />;

  const on = info.on;
  const toggle = async () => {
    setSaving(true);
    try {
      const next = await api.setAiSwitch(!on);
      setSession(next);
      toast.success(next.aiSwitch?.on ? `AI on: ${next.aiSwitch.engine ?? "AI engine"}` : "AI off: rules engine and templates");
    } catch (err) {
      toast.error("Couldn't change the AI switch", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="AI"
      aria-describedby="ai-switch-state"
      disabled={saving}
      onClick={() => void toggle()}
      title={on ? `On: ${info.engine ?? "AI engine"}. Click to use the rules engine and templates.` : "Off: rules engine and templates. Click to switch AI on."}
      className="group flex w-full items-center gap-3 px-1 py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-wait disabled:opacity-70"
    >
      <span
        aria-hidden="true"
        className={cx(
          "relative inline-flex h-5 w-9 shrink-0 items-center ring-1 transition-colors ring-inset",
          on ? "bg-emerald-500/90 ring-emerald-300/60" : "bg-white/10 ring-white/25 group-hover:bg-white/15",
        )}
      >
        <span
          className={cx(
            "absolute top-1 size-3 bg-white shadow transition-transform motion-reduce:transition-none",
            on ? "translate-x-5" : "translate-x-1",
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold tracking-[0.14em] text-white uppercase">AI {on ? "on" : "off"}</span>
        <span id="ai-switch-state" className="block truncate text-[11px] leading-4 text-charcoal-muted">
          {on ? (info.engine ?? "AI engine") : "Rules engine and templates"}
        </span>
      </span>
    </button>
  );
}
