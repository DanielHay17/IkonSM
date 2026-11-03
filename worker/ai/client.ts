import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlock } from "@anthropic-ai/sdk/resources/messages";
import { engineLabel } from "../../shared/engines";
import type { AiInfo, AiProviderKind } from "../../shared/types";

const DEFAULT_MODELS = {
  agent: "claude-sonnet-5-5",
  triage: "claude-haiku-5-5",
} as const;

/** Workers AI chat model with documented `messages` + `response_format: { type: "json_schema" }` support. */
export const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

/** Untrusted inbound text (emails, SMS) is cut to this many characters before it reaches the model. */
export const MAX_UNTRUSTED_CHARS = 20_000;

/** Secrets and vars may be missing or "" in local dev and tests; both mean "unset". */
function setting(value: string | undefined | null): string {
  return (value ?? "").trim();
}

// ---------------------------------------------------------------------------
// Provider selection (LLM_PROVIDER)
// ---------------------------------------------------------------------------

const PROVIDER_SETTINGS = ["auto", "anthropic", "gateway", "workers-ai", "off"] as const;
export type ProviderSetting = (typeof PROVIDER_SETTINGS)[number];

export interface AiProvider {
  kind: AiProviderKind;
  /** What LLM_PROVIDER asked for (unknown values read as "auto"). */
  requested: ProviderSetting;
  /** Model per use: Claude models for anthropic/gateway, the Workers AI model for both uses, null when off. */
  models: { agent: string | null; triage: string | null };
  /** e.g. "Claude via Cloudflare AI Gateway (claude-sonnet-5-5)" or "AI offline (rules and templates)". */
  label: string;
  /** Why the requested provider is not the one in use (missing secret or binding), else null. */
  note: string | null;
}

function requestedProvider(env: Env): ProviderSetting {
  const value = setting(env.LLM_PROVIDER).toLowerCase();
  return (PROVIDER_SETTINGS as readonly string[]).includes(value) ? (value as ProviderSetting) : "auto";
}

function gatewayMissing(env: Env): string[] {
  const required = { CF_AIG_TOKEN: env.CF_AIG_TOKEN, CF_ACCOUNT_ID: env.CF_ACCOUNT_ID, AI_GATEWAY_ID: env.AI_GATEWAY_ID };
  return Object.entries(required).flatMap(([name, value]) => (setting(value) ? [] : [name]));
}

export function workersAiModel(env: Env): string {
  return setting(env.WORKERS_AI_MODEL) || DEFAULT_WORKERS_AI_MODEL;
}

/**
 * Which LLM the agents use. "auto" picks Claude with ANTHROPIC_API_KEY, else Claude through
 * Cloudflare AI Gateway unified billing (CF_AIG_TOKEN + CF_ACCOUNT_ID + AI_GATEWAY_ID), else off.
 * Workers AI is only used when LLM_PROVIDER is "workers-ai": the AI binding exists in local dev
 * and tests but cannot run there, so auto must never pick it.
 */
export function aiProvider(env: Env): AiProvider {
  const requested = requestedProvider(env);
  const hasKey = setting(env.ANTHROPIC_API_KEY) !== "";
  const missing = gatewayMissing(env);

  let kind: AiProviderKind = "off";
  let note: string | null = null;
  switch (requested) {
    case "off":
      note = "LLM_PROVIDER is off";
      break;
    case "anthropic":
      if (hasKey) kind = "anthropic";
      else note = "LLM_PROVIDER is anthropic but ANTHROPIC_API_KEY is not set";
      break;
    case "gateway":
      if (missing.length === 0) kind = "gateway";
      else note = `LLM_PROVIDER is gateway but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set`;
      break;
    case "workers-ai":
      if (env.AI) kind = "workers-ai";
      else note = "LLM_PROVIDER is workers-ai but the AI binding is missing";
      break;
    case "auto":
      kind = hasKey ? "anthropic" : missing.length === 0 ? "gateway" : "off";
      if (kind === "off") note = "no ANTHROPIC_API_KEY and no AI Gateway token (CF_AIG_TOKEN + CF_ACCOUNT_ID + AI_GATEWAY_ID)";
      break;
  }

  const models =
    kind === "anthropic" || kind === "gateway"
      ? { agent: modelFor(env, "agent"), triage: modelFor(env, "triage") }
      : kind === "workers-ai"
        ? { agent: workersAiModel(env), triage: workersAiModel(env) }
        : { agent: null, triage: null };
  const label =
    kind === "off"
      ? "AI offline (rules and templates)"
      : kind === "workers-ai"
        ? engineLabel("workers-ai", models.agent)
        : engineLabel("claude", models.agent, kind);
  return { kind, requested, models, label, note };
}

/** True when any LLM (Claude direct, Claude via AI Gateway, or Workers AI) is in use. */
export function aiOnline(env: Env): boolean {
  return aiProvider(env).kind !== "off";
}

/** True when Claude (direct or via AI Gateway) is in use, i.e. makeClient() will work. */
export function claudeOnline(env: Env): boolean {
  const { kind } = aiProvider(env);
  return kind === "anthropic" || kind === "gateway";
}

/** Provider and main model, for SessionInfo / PropertyState. */
export function aiInfo(env: Env): AiInfo {
  const provider = aiProvider(env);
  return { provider: provider.kind, model: provider.models.agent, note: provider.note };
}

/** Short reason used in "AI offline" messages, e.g. "no ANTHROPIC_API_KEY and no AI Gateway token …". */
export function offlineReason(env: Env): string {
  return aiProvider(env).note ?? "no LLM provider is configured";
}

// ---------------------------------------------------------------------------
// Claude client
// ---------------------------------------------------------------------------

/**
 * The SDK requires a credential and sends it as `Authorization: Bearer <apiKey>` (client.mjs
 * apiKeyAuth). With AI Gateway unified billing Cloudflare supplies the Anthropic credential, so
 * this placeholder satisfies the SDK and gatewayFetch strips it before the request leaves.
 */
const GATEWAY_PLACEHOLDER_KEY = "cloudflare-ai-gateway-unified-billing";

/** Removes every Anthropic credential header; the gateway authenticates with cf-aig-authorization. */
const gatewayFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const headers = new Headers(init?.headers);
  headers.delete("authorization");
  headers.delete("x-api-key");
  return fetch(input, { ...init, headers });
};

function gatewayBaseURL(env: Env): string | undefined {
  const accountId = setting(env.CF_ACCOUNT_ID);
  const gatewayId = setting(env.AI_GATEWAY_ID);
  return accountId && gatewayId
    ? `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}/anthropic`
    : undefined;
}

/** Claude client for the "anthropic" and "gateway" providers. Check claudeOnline() first. */
export function makeClient(env: Env): Anthropic {
  const baseURL = gatewayBaseURL(env);
  const token = setting(env.CF_AIG_TOKEN);
  const gatewayAuth = token && baseURL ? { "cf-aig-authorization": `Bearer ${token}` } : undefined;

  if (aiProvider(env).kind === "gateway") {
    // Unified billing: no Anthropic key leaves the Worker; usage is billed to Cloudflare credits.
    return new Anthropic({
      apiKey: GATEWAY_PLACEHOLDER_KEY,
      baseURL,
      defaultHeaders: gatewayAuth,
      fetch: gatewayFetch,
      maxRetries: 2,
      timeout: 90_000,
    });
  }
  // Direct key; routed through AI Gateway (logging only) when CF_ACCOUNT_ID + AI_GATEWAY_ID are set.
  return new Anthropic({
    apiKey: setting(env.ANTHROPIC_API_KEY),
    baseURL,
    defaultHeaders: gatewayAuth,
    maxRetries: 2,
    timeout: 90_000,
  });
}

export function modelFor(env: Env, use: "agent" | "triage"): string {
  const configured = use === "agent" ? env.MODEL_AGENT : env.MODEL_TRIAGE;
  return setting(configured) || DEFAULT_MODELS[use];
}

// ---------------------------------------------------------------------------
// Small text helpers shared by the AI modules
// ---------------------------------------------------------------------------

export function truncate(text: string, max: number, marker = "\n…[truncated]"): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - marker.length)) + marker;
}

/** Joins the visible text blocks of a response (thinking and tool blocks are skipped). */
export function textFromContent(content: readonly ContentBlock[]): string {
  return content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
}

const TAG_LIKE = /<(\/?)\s*(message|from|subject|body|channel)\b/gi;

/** Stops untrusted text from closing or opening our wrapper tags. */
function neutraliseTags(text: string): string {
  return text.replace(TAG_LIKE, (_match, slash: string, tag: string) => `‹${slash}${tag}`);
}

export interface UntrustedMessage {
  from: string;
  subject: string;
  body: string;
  channel?: string;
}

/**
 * Wraps an inbound message as clearly-delimited data. Every field is untrusted,
 * so all of them are length-capped and tag-neutralised.
 */
export function wrapUntrusted(message: UntrustedMessage, maxChars = MAX_UNTRUSTED_CHARS): string {
  const lines = [
    "<message>",
    message.channel ? `<channel>${neutraliseTags(truncate(message.channel, 40))}</channel>` : null,
    `<from>${neutraliseTags(truncate(message.from, 300))}</from>`,
    `<subject>${neutraliseTags(truncate(message.subject, 500))}</subject>`,
    "<body>",
    neutraliseTags(truncate(message.body, maxChars)),
    "</body>",
    "</message>",
  ];
  return lines.filter((line): line is string => line !== null).join("\n");
}

const PERTH_FORMAT = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Perth",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** e.g. "Tuesday 3 November 2026 at 9:41 pm (Perth time)". */
export function perthTimestamp(date: Date = new Date()): string {
  return `${PERTH_FORMAT.format(date)} (Perth time)`;
}

const PERTH_PARTS = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Perth",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Perth calendar date as YYYY-MM-DD (a UTC date is a day early for anything before 8 am in Perth). */
export function perthDate(value: string | Date = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value.slice(0, 10) : "";
  const part = (type: Intl.DateTimeFormatPartTypes) => PERTH_PARTS.formatToParts(date).find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const PERTH_SHORT = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Perth",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** e.g. "4 Nov 2026, 7:30 am" in Perth time. */
export function perthShort(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? String(value) : PERTH_SHORT.format(date);
}
