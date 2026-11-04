import { useState } from "react";
import type { AiEngineChoice } from "../../shared/types";
import { api } from "../api";
import { cx } from "../lib/cx";
import { useSession } from "../providers/SessionProvider";
import { AiStatusPill } from "./StatusBadges";
import { useToast } from "./Toast";

/**
 * The hub-wide AI switch, in the dark sidebar: Off (rules engine and templates), Llama (Workers AI) or
 * Claude. An engine the deployment can't run is shown but disabled, with what it needs in its tooltip.
 * Without any engine set up it is just the status pill.
 */
export function AiSwitch() {
  const { session, setSession } = useSession();
  const toast = useToast();
  const [saving, setSaving] = useState<AiEngineChoice | null>(null);
  const info = session.aiSwitch;
  if (!info?.available || !info.options) return <AiStatusPill online={session.aiOnline} ai={session.ai} tone="dark" />;

  const pick = async (engine: AiEngineChoice) => {
    if (engine === info.choice) return;
    setSaving(engine);
    try {
      const next = await api.setAiEngine(engine);
      setSession(next);
      toast.success(next.aiSwitch?.on ? `AI on: ${next.aiSwitch.engine ?? "AI engine"}` : "AI off: rules engine and templates");
    } catch (err) {
      toast.error("Couldn't change the AI engine", err);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between px-1">
        <span id="ai-switch-label" className="text-[11px] font-semibold tracking-[0.14em] text-white uppercase">
          AI {info.on ? "on" : "off"}
        </span>
        {info.on ? <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-400" /> : null}
      </div>
      <div role="radiogroup" aria-labelledby="ai-switch-label" className="grid grid-cols-3 gap-px bg-white/15 p-px">
        {info.options.map((option) => {
          const selected = option.id === info.choice;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!option.available || saving !== null}
              onClick={() => void pick(option.id)}
              title={option.available ? option.detail : `Not set up: ${option.detail}`}
              className={cx(
                "px-1 py-1.5 text-[11px] font-semibold tracking-wide uppercase transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white",
                selected
                  ? option.id === "off"
                    ? "bg-white text-charcoal"
                    : "bg-emerald-400 text-charcoal"
                  : "bg-charcoal text-charcoal-text hover:bg-white/10 hover:text-white",
                !option.available && "cursor-not-allowed text-white/35 line-through decoration-white/30 hover:bg-charcoal hover:text-white/35",
                saving === option.id && "animate-pulse",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 truncate px-1 text-[11px] leading-4 text-charcoal-muted" title={info.engine ?? undefined}>
        {info.on ? (info.engine ?? "AI engine") : "Rules engine and templates"}
      </p>
    </div>
  );
}
