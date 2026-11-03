// Human labels for the engine that produced a result. Shared by the Worker (activity log)
// and the SPA (badges) so both always say the same thing. Never blurs AI and non-AI output.

import type { AiInfo, AiProviderKind } from "./types";

export type EngineKind = "claude" | "workers-ai" | "rules" | "template";

export const GATEWAY_LABEL = "Claude via Cloudflare AI Gateway";

/** e.g. "Claude claude-sonnet-5-5", "Claude via Cloudflare AI Gateway (claude-haiku-5-5)", "Workers AI @cf/…". */
export function engineLabel(engine: EngineKind, model?: string | null, provider?: AiProviderKind | null): string {
  switch (engine) {
    case "workers-ai":
      return model ? `Workers AI ${model}` : "Workers AI";
    case "claude":
      if (provider === "gateway") return model ? `${GATEWAY_LABEL} (${model})` : GATEWAY_LABEL;
      return model ? `Claude ${model}` : "Claude";
    case "rules":
      return "Rules engine";
    case "template":
      return "Template";
  }
}

/** How each provider is described in the hub's status panels. */
export const PROVIDER_NAMES: Record<AiProviderKind, string> = {
  anthropic: "Claude (Anthropic API key)",
  gateway: GATEWAY_LABEL,
  "workers-ai": "Workers AI (light mode, no tools)",
  off: "Off: rules engine and templates",
};

/** Label for the provider the Worker is configured to use right now. */
export function providerLabel(ai: AiInfo | null | undefined): string {
  if (!ai || ai.provider === "off") return "AI offline (rules and templates)";
  if (ai.provider === "workers-ai") return engineLabel("workers-ai", ai.model);
  return engineLabel("claude", ai.model, ai.provider);
}
