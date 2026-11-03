import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlock } from "@anthropic-ai/sdk/resources/messages";

const DEFAULT_MODELS = {
  agent: "claude-sonnet-5-5",
  triage: "claude-haiku-5-5",
} as const;

/** Untrusted inbound text (emails, SMS) is cut to this many characters before it reaches the model. */
export const MAX_UNTRUSTED_CHARS = 20_000;

/** Secrets and vars may be missing or "" in local dev and tests; both mean "unset". */
function setting(value: string | undefined | null): string {
  return (value ?? "").trim();
}

export function aiOnline(env: Env): boolean {
  return setting(env.ANTHROPIC_API_KEY) !== "";
}

export function makeClient(env: Env): Anthropic {
  const accountId = setting(env.CF_ACCOUNT_ID);
  const gatewayId = setting(env.AI_GATEWAY_ID);
  const baseURL =
    accountId && gatewayId
      ? `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}/anthropic`
      : undefined;
  return new Anthropic({
    apiKey: setting(env.ANTHROPIC_API_KEY),
    baseURL,
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
