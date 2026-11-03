import { useEffect, useState } from "react";
import { cx } from "../lib/cx";
import { Icon } from "./Icon";

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for non-secure contexts (plain http on a LAN address).
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("Copy is not available in this browser");
}

interface CopyButtonProps {
  text: string;
  /** What is being copied, for the accessible name: "Copy agent email address". */
  label: string;
  tone?: "light" | "dark";
  className?: string;
}

export function CopyButton({ text, label, tone = "light", className }: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 1600);
    return () => window.clearTimeout(timer);
  }, [state]);

  const onCopy = async () => {
    try {
      await copyText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  const status = state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label;
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={status}
      title={status}
      className={cx(
        "relative inline-grid size-7 shrink-0 place-items-center rounded-md transition-colors",
        tone === "light" ? "text-muted hover:bg-ink/5 hover:text-ink" : "text-navy-text hover:bg-white/10 hover:text-white",
        state === "copied" && "text-emerald-600",
        className,
      )}
    >
      <Icon name={state === "copied" ? "check" : "copy"} className="size-3.5" />
      <span className="sr-only" aria-live="polite">
        {state === "copied" ? "Copied to clipboard" : ""}
      </span>
    </button>
  );
}
