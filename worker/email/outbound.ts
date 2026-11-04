// Sends an email that a logged-in human has approved. This is the only place the hub sends mail;
// callers (PropertyAgent.decideApproval) are responsible for the approval and recipient checks.

import { renderEmailHtml } from "../../shared/email-html";
import type { EmailDraft, PropertyProfile } from "../../shared/types";

const MAX_REFERENCES = 20;
const MAX_SUBJECT_CHARS = 300;
const MAX_NAME_CHARS = 120;
const ADDRESS = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

export type SendResult = { ok: true; messageId: string } | { ok: false; error: string };

export async function sendApprovedEmail(
  env: Env,
  args: {
    fromAddress: string;
    fromName: string;
    draft: EmailDraft;
    propertyId: string;
    approvalId: string;
    /** With the property, the email also goes out as branded HTML (the text part is always sent). */
    property?: PropertyProfile;
    companyName?: string;
  },
): Promise<SendResult> {
  const { draft } = args;
  const to = cleanAddress(draft.to);
  const from = cleanAddress(args.fromAddress);
  if (!to) return { ok: false, error: `Invalid recipient address: ${JSON.stringify(draft.to)}` };
  if (!from) return { ok: false, error: `Invalid sender address: ${JSON.stringify(args.fromAddress)}` };
  if (!draft.body?.trim()) return { ok: false, error: "The email body is empty" };
  if (!env.EMAIL) return { ok: false, error: "Email sending is not configured (no EMAIL binding)" };

  try {
    const result = await env.EMAIL.send({
      from: mailbox(from, args.fromName),
      to: mailbox(to, draft.toName),
      subject: headerText(draft.subject, MAX_SUBJECT_CHARS) || "(no subject)",
      text: draft.body.replace(/\r\n?/g, "\n"),
      ...(args.property ? { html: htmlFor(env, args, from) } : {}),
      headers: outboundHeaders(draft, args.propertyId, args.approvalId),
    });
    return { ok: true, messageId: result.messageId };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

function htmlFor(env: Env, args: { draft: EmailDraft; property?: PropertyProfile; companyName?: string }, from: string): string {
  const base = (env.PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  return renderEmailHtml({
    subject: headerText(args.draft.subject, MAX_SUBJECT_CHARS),
    body: args.draft.body,
    companyName: args.companyName || env.COMPANY_NAME || "Ikon Strata Management",
    property: args.property!,
    fromAddress: from,
    logoUrl: /^https:\/\//.test(base) ? `${base}/brand/email-logo.png` : null,
  });
}

/** Threading and audit headers, with empty values dropped. */
function outboundHeaders(draft: EmailDraft, propertyId: string, approvalId: string): Record<string, string> {
  const inReplyTo = messageIds(draft.inReplyTo)[0] ?? "";
  const headers: Record<string, string> = {
    "In-Reply-To": inReplyTo,
    "References": referencesFor(draft.references, inReplyTo),
    "X-Ikon-Property": headerText(propertyId, 64),
    "X-Ikon-Approval": headerText(approvalId, 64),
  };
  return Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== ""));
}

/** RFC 5322: the parent's References followed by the parent's Message-ID, deduplicated, newest kept. */
function referencesFor(references: string | null, inReplyTo: string): string {
  const ids = [...new Set([...messageIds(references), ...(inReplyTo ? [inReplyTo] : [])])];
  return ids.slice(-MAX_REFERENCES).join(" ");
}

function messageIds(value: string | null): string[] {
  if (!value) return [];
  const bracketed = value.match(/<[^<>\s]+>/g);
  if (bracketed) return bracketed;
  // Tolerate ids stored without angle brackets.
  return value
    .split(/\s+/)
    .filter((id) => /^[^<>\s]+@[^<>\s]+$/.test(id))
    .map((id) => `<${id}>`);
}

function mailbox(email: string, name: string | null): string | EmailAddress {
  const display = headerText(name ?? "", MAX_NAME_CHARS).replace(/[<>"]/g, "");
  return display ? { name: display, email } : email;
}

function cleanAddress(value: string | null | undefined): string | null {
  const address = (value ?? "").trim();
  return ADDRESS.test(address) ? address : null;
}

/** Single-line header value: strips CR/LF (header injection) and control characters. */
function headerText(value: string, max: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, max);
}

/** Email Service errors carry a code such as E_SENDER_NOT_VERIFIED; keep it in the message. */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as Error & { code?: unknown }).code;
    return typeof code === "string" && !err.message.includes(code) ? `${code}: ${err.message}` : err.message;
  }
  return String(err);
}
