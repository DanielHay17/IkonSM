// Hub-wide AI switch. Staff pick the engine from the hub without a redeploy:
// - Off: the rules engine and templates.
// - Llama: Workers AI.
// - Claude: the Anthropic API directly, or through Cloudflare AI Gateway.
// An engine can only be picked when the deployment has what it needs: the AI binding for Llama, and an
// ANTHROPIC_API_KEY or the AI Gateway secrets for Claude. The choice is stored in the Chief of Staff
// agent, so the API and every building agent read the same value.

import { getAgentByName } from "agents";
import type { AiEngineChoice, AiSwitchInfo } from "../../shared/types";
import { aiProvider } from "./client";

/** The Chief of Staff is a single agent with this name. */
export const CHIEF_OF_STAFF_NAME = "main";

/** What is stored: an engine, or "default" (the deployment's LLM_PROVIDER, used until someone picks). */
export type StoredAiChoice = AiEngineChoice | "default";

/**
 * A view of `env` with one var replaced. Never mutates `env`. defineProperty, not assignment: `env` may
 * expose its vars as accessors, and assigning through the prototype would change the shared env for every
 * request in the isolate.
 */
export function withSetting(env: Env, key: keyof Env & string, value: string): Env {
  const view = Object.create(env) as Env;
  Object.defineProperty(view, key, { value, enumerable: true, configurable: true, writable: false });
  return view;
}

/** The provider setting each engine maps to, or null when the deployment can't run it. */
function providerFor(env: Env, engine: AiEngineChoice): string | null {
  if (engine === "off") return "off";
  if (engine === "workers-ai") return aiProvider(withSetting(env, "LLM_PROVIDER", "workers-ai")).kind === "workers-ai" ? "workers-ai" : null;
  for (const setting of ["anthropic", "gateway"]) {
    if (aiProvider(withSetting(env, "LLM_PROVIDER", setting)).kind === setting) return setting;
  }
  return null;
}

/** The deployment's settings with the switch applied. An engine that isn't set up falls back to off. */
export function withAiChoice(env: Env, choice: StoredAiChoice): Env {
  if (choice === "default") return env;
  return withSetting(env, "LLM_PROVIDER", providerFor(env, choice) ?? "off");
}

/** Shorthand for callers that only need on (the stored choice) or off. */
export function withAiSwitch(env: Env, on: boolean): Env {
  return on ? env : withAiChoice(env, "off");
}

/** Whether anything but the rules engine can run on this deployment. */
export function anyEngineAvailable(env: Env): boolean {
  return providerFor(env, "workers-ai") !== null || providerFor(env, "claude") !== null;
}

/** The stored choice. If the Chief of Staff can't be reached, AI stays off: rules are the safe default. */
export async function readAiChoice(env: Env): Promise<StoredAiChoice> {
  if (!anyEngineAvailable(env)) return "off";
  try {
    const cos = await getAgentByName(env.ChiefOfStaffAgent, CHIEF_OF_STAFF_NAME);
    return await cos.getAiChoice();
  } catch (err) {
    console.warn("ai switch: could not read it from the Chief of Staff; using rules", err instanceof Error ? err.message : err);
    return "off";
  }
}

/** The engine a provider kind belongs to. */
function engineOf(kind: string): AiEngineChoice {
  return kind === "workers-ai" ? "workers-ai" : kind === "anthropic" || kind === "gateway" ? "claude" : "off";
}

/** What the hub shows on the switch: the engine in use and which engines can be picked. */
export function aiSwitchInfo(env: Env, choice: StoredAiChoice): AiSwitchInfo {
  const effective = aiProvider(withAiChoice(env, choice));
  const current = engineOf(effective.kind);
  const llama = providerFor(env, "workers-ai");
  const claude = providerFor(env, "claude");
  return {
    on: current !== "off",
    available: llama !== null || claude !== null,
    engine: current === "off" ? null : effective.label,
    choice: current,
    options: [
      { id: "off", label: "Off", available: true, detail: "Rules engine and templates" },
      {
        id: "workers-ai",
        label: "Llama",
        available: llama !== null,
        detail: llama ? aiProvider(withSetting(env, "LLM_PROVIDER", llama)).label : "Needs the Workers AI binding",
      },
      {
        id: "claude",
        label: "Claude",
        available: claude !== null,
        detail: claude
          ? aiProvider(withSetting(env, "LLM_PROVIDER", claude)).label
          : "Add an ANTHROPIC_API_KEY secret, or AI Gateway credits (CF_AIG_TOKEN, CF_ACCOUNT_ID, AI_GATEWAY_ID)",
      },
    ],
  };
}

/** Whether `engine` can be picked on this deployment. */
export function engineAvailable(env: Env, engine: AiEngineChoice): boolean {
  return providerFor(env, engine) !== null;
}
