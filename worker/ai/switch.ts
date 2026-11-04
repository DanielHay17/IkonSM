// Hub-wide AI switch. The deployment's LLM_PROVIDER says which engine is available; staff can switch AI
// off (rules engine and templates) and back on from the hub, without a redeploy. The switch is stored in the
// Chief of Staff agent, so the API and every building agent read the same value.

import { getAgentByName } from "agents";
import type { AiSwitchInfo } from "../../shared/types";
import { aiProvider } from "./client";

/** The Chief of Staff is a single agent with this name. */
export const CHIEF_OF_STAFF_NAME = "main";

/**
 * The deployment's settings with the switch applied. Off means LLM_PROVIDER "off": the rules engine and
 * templates. A view over `env` that shadows one property; the bindings are untouched. defineProperty, not
 * assignment: `env` may expose its vars as accessors, and assigning through the prototype would change the
 * shared env for every request in the isolate.
 */
export function withAiSwitch(env: Env, on: boolean): Env {
  if (on) return env;
  return withSetting(env, "LLM_PROVIDER", "off");
}

/** A view of `env` with one var replaced. Never mutates `env`. */
export function withSetting(env: Env, key: keyof Env & string, value: string): Env {
  const view = Object.create(env) as Env;
  Object.defineProperty(view, key, { value, enumerable: true, configurable: true, writable: false });
  return view;
}

/** Whether the switch is on. If the Chief of Staff can't be reached, AI stays off: rules are the safe default. */
export async function readAiSwitch(env: Env): Promise<boolean> {
  if (aiProvider(env).kind === "off") return false;
  try {
    const cos = await getAgentByName(env.ChiefOfStaffAgent, CHIEF_OF_STAFF_NAME);
    return await cos.getAiSwitch();
  } catch (err) {
    console.warn("ai switch: could not read it from the Chief of Staff; using rules", err instanceof Error ? err.message : err);
    return false;
  }
}

/** What the hub shows on the switch: whether it is on, and whether the deployment has an engine to switch on. */
export function aiSwitchInfo(env: Env, on: boolean): AiSwitchInfo {
  const deployed = aiProvider(env);
  const available = deployed.kind !== "off";
  return { on: available && on, available, engine: available ? deployed.label : null };
}
