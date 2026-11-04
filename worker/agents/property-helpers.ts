// Pure helpers for PropertyAgent: validation, threading keys, contractor matching,
// recipient checks and human-readable labels. No I/O here, so it is easy to unit test.

import { engineLabel } from "../../shared/engines";
import { perthShort } from "../ai/client";
import { ASSIGNEE_ROLES, CATEGORIES, CATEGORY_LABELS } from "../../shared/types";
import type {
  ApprovalStatus,
  AssigneeRole,
  Category,
  Channel,
  Citation,
  Contact,
  ContactRole,
  EmailDraft,
  InboundInput,
  Message,
  Priority,
  PropertyProfile,
  SearchHit,
  ThreadStatus,
  Ticket,
  TicketStatus,
  Triage,
} from "../../shared/types";

// ---------------------------------------------------------------------------
// Enumerations and validation
// ---------------------------------------------------------------------------

export const PRIORITIES = ["P1", "P2", "P3"] as const satisfies readonly Priority[];
export const TICKET_STATUSES = [
  "new",
  "assigned",
  "in_progress",
  "waiting",
  "done",
] as const satisfies readonly TicketStatus[];
export const THREAD_STATUSES = [
  "new",
  "triaged",
  "awaiting_approval",
  "replied",
  "closed",
] as const satisfies readonly ThreadStatus[];
export const CONTACT_ROLES = [
  "owner",
  "tenant",
  "council",
  "contractor",
  "insurer",
  "property_manager",
  "staff",
  "other",
] as const satisfies readonly ContactRole[];
export const CHANNELS = ["email", "sms", "portal", "phone", "staff"] as const satisfies readonly Channel[];
export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "failed",
] as const satisfies readonly ApprovalStatus[];
export { ASSIGNEE_ROLES, CATEGORIES };

export function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

export function requireOneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (!isOneOf(value, allowed)) throw new Error(`Invalid ${label}: ${String(value)}`);
  return value;
}

/** Trimmed non-empty string capped at `max` chars, or throws with `label`. */
export function requireText(value: unknown, label: string, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label} is required`);
  return text.slice(0, max);
}

/** Trimmed string or null when empty/absent. */
export function optionalText(value: unknown, max = 2000): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, max) : null;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// Small text utilities
// ---------------------------------------------------------------------------

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

export function nowIso(): string {
  return new Date().toISOString();
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Single-line preview for lists. */
export function previewOf(text: string, max = 200): string {
  return truncate(text.replace(/\s+/g, " ").trim(), max);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Threading
// ---------------------------------------------------------------------------

const SUBJECT_PREFIXES = /^\s*(?:(?:re|fw|fwd|aw|wg|sv|antw)\s*(?:\[\d+\])?\s*:\s*|\[[^\]]*\]\s*)+/i;

/** Subject used to group messages: reply/forward prefixes and [tags] stripped, case-folded. */
export function subjectKey(subject: string): string {
  return subject.replace(SUBJECT_PREFIXES, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Australian-normalised digits so "+61 412 345 678" and "0412345678" compare equal. */
export function phoneKey(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.startsWith("61") && digits.length === 11 ? `0${digits.slice(2)}` : digits;
}

/** Canonical sender identity: bare lowercase email, or normalised phone digits. */
export function senderKey(address: string): string {
  const trimmed = address.trim().toLowerCase();
  const bare = trimmed.match(/<([^<>]+)>/)?.[1]?.trim() ?? trimmed;
  return bare.includes("@") ? bare : phoneKey(bare);
}

export function isEmailAddress(value: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim());
}

/** RFC Message-IDs (with brackets) found in In-Reply-To/References headers; last 20 kept. */
export function parseMessageIds(...headers: (string | null | undefined)[]): string[] {
  const ids = new Set<string>();
  for (const header of headers) {
    const value = header?.trim();
    if (!value) continue;
    const bracketed = value.match(/<[^<>\s]+>/g);
    if (bracketed) bracketed.forEach((id) => ids.add(id));
    else if (!/\s/.test(value)) ids.add(`<${value}>`);
  }
  return [...ids].slice(-20);
}

/** Stored form of a Message-ID: always "<...>" so replies' In-Reply-To headers match it. */
export function normaliseMessageId(id: string | null | undefined): string | null {
  return parseMessageIds(id)[0] ?? null;
}

/** References header for a reply to `message`: its references plus its own Message-ID. */
export function referencesFor(message: Message | null): string | null {
  if (!message) return null;
  return parseMessageIds(message.references, message.messageId).join(" ") || null;
}

/** "Jane Citizen <jane@example.com>", or just the address. */
export function formatAddress(name: string | null, address: string): string {
  const cleanName = name?.replace(/[<>"]/g, "").trim();
  return cleanName ? `${cleanName} <${address}>` : address;
}

const MAX_INBOUND_CHARS = 50_000;

/** Validated copy of an inbound message: known channel, sender required, bounded text. */
export function normaliseInbound(input: InboundInput): InboundInput {
  return {
    ...input,
    channel: isOneOf(input.channel, CHANNELS) ? input.channel : "email",
    fromName: optionalText(input.fromName, 200),
    fromAddress: requireText(input.fromAddress, "Sender address", 320),
    subject: optionalText(input.subject, 500) ?? "(no subject)",
    text: typeof input.text === "string" ? input.text.slice(0, MAX_INBOUND_CHARS) : "",
    messageId: normaliseMessageId(input.messageId),
    inReplyTo: optionalText(input.inReplyTo, 2000),
    references: optionalText(input.references, 8000),
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
    simulated: input.simulated === true,
    senderVerified: typeof input.senderVerified === "boolean" ? input.senderVerified : null,
  };
}

export function channelNoun(channel: Channel): string {
  const nouns: Record<Channel, string> = {
    email: "email",
    sms: "SMS",
    portal: "portal message",
    phone: "call note",
    staff: "staff note",
  };
  return nouns[channel] ?? "message";
}

// ---------------------------------------------------------------------------
// Triage → work order rules
// ---------------------------------------------------------------------------

const SLA_HOURS: Record<Priority, number> = { P1: 4, P2: 24, P3: 120 };

/** Due time from the priority SLA (P1 immediate/4h, P2 next business day, P3 up to 5 days). */
export function ticketDueAt(priority: Priority, from = new Date()): string {
  return new Date(from.getTime() + SLA_HOURS[priority] * HOUR_MS).toISOString();
}

export function ticketNumber(spNumber: string, seq: number): string {
  return `WO-${spNumber}-${String(seq).padStart(4, "0")}`;
}

/**
 * P1/P2 maintenance and insurance items get a work order, and so does any P1 that needs a trade
 * (the rules engine's P1 rail can leave a model's non-work category, e.g. a tenant reporting a flood).
 */
export function needsTicket(triage: Triage): boolean {
  const workCategory: Category[] = ["maintenance", "insurance"];
  const urgent = triage.priority === "P1" || triage.priority === "P2";
  return (workCategory.includes(triage.category) && urgent) || (triage.priority === "P1" && !!triage.contractorTrade);
}

/** Likely the lot owner's to fix and not an emergency: track it, but don't dispatch the strata company's contractor. */
export function ownerToArrange(triage: Triage): boolean {
  return triage.responsibility === "lot_owner" && triage.priority !== "P1";
}

export function shouldDraftReply(triage: Triage): boolean {
  return triage.replyNeeded && !triage.suspectedPromptInjection && triage.category !== "spam";
}

export function replySkipReason(triage: Triage): string {
  if (triage.suspectedPromptInjection) return "No reply drafted: possible prompt injection, flagged for a human to review";
  if (triage.category === "spam") return "No reply drafted: message looks like spam";
  return "No reply needed for this message";
}

/** One-line activity summary of a triage result. */
export function triageHeadline(triage: Triage): string {
  const label = CATEGORY_LABELS[triage.category] ?? triage.category;
  const flag = triage.suspectedPromptInjection ? " [possible prompt injection]" : "";
  return `Triaged ${triage.priority} ${label}: ${triage.summary}${flag}`;
}

export function triageDetail(triage: Triage): string {
  const engine = engineLabel(triage.engine, triage.model, triage.provider);
  return [
    `Responsibility: ${RESPONSIBILITY_LABELS[triage.responsibility] ?? triage.responsibility}. ${triage.responsibilityReason}`,
    `Allocate to: ${triage.allocateTo.join(", ") || "-"}${triage.contractorTrade ? ` (trade: ${triage.contractorTrade})` : ""}`,
    triage.safetyNotice ? `Safety: ${triage.safetyNotice}` : null,
    triage.statutoryDeadline ? `Deadline: ${triage.statutoryDeadline}` : null,
    `Needs human: ${triage.needsHuman ? "yes" : "no"}. Confidence ${Math.round(triage.confidence * 100)}%. Engine: ${engine}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** "status new -> assigned; priority P2 -> P1" for the activity log. */
export function describeTicketChanges(before: Ticket, after: Ticket): string {
  const fields = ["status", "priority", "assigneeRole", "assigneeName", "title", "dueAt", "contractorId"] as const;
  const changes = fields
    .filter((field) => before[field] !== after[field])
    .map((field) => `${field} ${before[field] ?? "-"} -> ${after[field] ?? "-"}`);
  return changes.join("; ") || "details edited";
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Case-insensitive trade match: substring either way ("plumber" / "Plumber (after hours)"),
 * or a shared word stem ("plumbing" / "plumber", "electrical" / "electrician").
 */
export function tradeMatches(contactTrade: string | null, wanted: string): boolean {
  const have = contactTrade?.toLowerCase().trim() ?? "";
  const want = wanted.toLowerCase().trim();
  if (!have || !want) return false;
  if (have.includes(want) || want.includes(have)) return true;
  const words = (s: string) => s.split(/[^a-z]+/).filter((w) => w.length >= 4);
  return words(have).some((h) =>
    words(want).some((w) => {
      const shared = commonPrefixLength(h, w);
      return shared >= 4 && shared >= 0.6 * Math.min(h.length, w.length);
    }),
  );
}

/** Best contractor for a trade: after-hours first for P1, then those with an email (needed to dispatch). */
export function pickContractor(contacts: Contact[], trade: string | null, priority: Priority): Contact | null {
  if (!trade) return null;
  const score = (c: Contact) => (priority === "P1" && c.afterHours ? 2 : 0) + (c.email ? 1 : 0);
  return (
    contacts
      .filter((c) => c.role === "contractor" && tradeMatches(c.trade, trade))
      .sort((a, b) => score(b) - score(a))[0] ?? null
  );
}

/** Work-order assignee from the first allocation. 000 can't hold a work order, so the strata manager does. */
export function ticketAssignee(
  triage: Triage,
  contractor: Contact | null,
): { assigneeRole: AssigneeRole; assigneeName: string | null } {
  const first = triage.allocateTo.find((role) => isOneOf(role, ASSIGNEE_ROLES)) ?? "strata_manager";
  const role: AssigneeRole = first === "emergency_services" ? "strata_manager" : first;
  if (role !== "contractor") return { assigneeRole: role, assigneeName: null };
  return contractor
    ? { assigneeRole: "contractor", assigneeName: contractor.name }
    : { assigneeRole: "strata_manager", assigneeName: null };
}

const RESPONSIBILITY_LABELS: Record<Triage["responsibility"], string> = {
  strata_company: "Strata company (common property)",
  lot_owner: "Lot owner",
  unclear: "Unclear - check plan and by-laws",
  not_applicable: "Not applicable",
};

/** The rules engine appends the quoted subject (` - "URGENT: water…"`) to its summaries; titles drop it. */
export function stripSubjectHint(summary: string): string {
  return summary.replace(/\s+-\s+".*$/, "").trim();
}

/** Work-order title: the triage summary without the quoted subject, else the thread subject. */
export function ticketTitle(triage: Triage, subject: string): string {
  return truncate(stripSubjectHint(triage.summary) || subject.trim() || "Work order", 140);
}

/** Work-order description (the title already carries the summary, so it is not repeated here). */
export function ticketDescription(triage: Triage, message: Message, recurrenceOf: string | null = null): string {
  const sender = messageSender(message);
  const lines = [
    ...(recurrenceOf ? [`Recurrence of ${recurrenceOf} (marked done).`, ""] : []),
    `Reported by: ${sender.name ?? sender.address} via ${channelNoun(message.channel)} on ${perthShort(message.createdAt)} (Perth time)`,
    `Responsibility: ${RESPONSIBILITY_LABELS[triage.responsibility] ?? triage.responsibility}. ${triage.responsibilityReason}`,
  ];
  if (ownerToArrange(triage)) lines.push("Likely the lot owner's to arrange: contact the owner or their property manager before dispatching.");
  if (triage.safetyNotice) lines.push(`Safety: ${triage.safetyNotice}`);
  if (triage.statutoryDeadline) lines.push(`Deadline: ${triage.statutoryDeadline}`);
  lines.push("", "What the occupant reported (excerpt):", truncate(message.text.trim(), 600));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// People and recipients
// ---------------------------------------------------------------------------

export type Sender = { name: string | null; address: string };

/** Splits a stored "Name <address>" (see formatAddress) back into its parts. */
export function messageSender(message: Message): Sender {
  const match = message.from.match(/^(.*?)\s*<([^<>]+)>\s*$/);
  return match ? { name: match[1]?.trim() || null, address: match[2]!.trim() } : { name: null, address: message.from.trim() };
}

function contactForSender(address: string, contacts: Contact[]): Contact | null {
  const key = senderKey(address);
  return (
    contacts.find((c) =>
      key.includes("@") ? c.email != null && senderKey(c.email) === key : c.phone != null && phoneKey(c.phone) === key,
    ) ?? null
  );
}

/** "Jane Citizen (Lot 4)" when the sender is a known contact, else their name or address. */
export function senderLabel(sender: Sender, contacts: Contact[]): string {
  const contact = contactForSender(sender.address, contacts);
  const name = contact?.name ?? sender.name ?? sender.address;
  if (!contact?.lot) return name;
  return /^lot\b/i.test(contact.lot) ? `${name} (${contact.lot})` : `${name} (Lot ${contact.lot})`;
}

/** Where a reply should go: the sender's email, or a contact's email matched by phone for SMS/calls. */
export function replyRecipient(sender: Sender, contacts: Contact[]): { address: string; name: string | null } {
  const key = senderKey(sender.address);
  if (isEmailAddress(key)) return { address: key, name: sender.name };
  const contact = contactForSender(sender.address, contacts);
  return contact?.email ? { address: contact.email.trim().toLowerCase(), name: contact.name } : sender;
}

export type RecipientCheck = { ok: true } | { ok: false; reason: string };

/** RFC 2606 / 6761 reserved domains: example.com/.net/.org and the .example, .test, .invalid, .localhost TLDs. */
export function isReservedTestAddress(address: string): boolean {
  const domain = senderKey(address).split("@")[1] ?? "";
  if (!domain) return false;
  return /^(.+\.)?example\.(com|net|org)$/.test(domain) || /\.(example|test|invalid|localhost)$/.test(domain);
}

/** Outbound email may only go to the thread's original sender or a contact stored on this building. */
export function checkRecipient(address: string, threadSender: string | null, contacts: Contact[]): RecipientCheck {
  const key = senderKey(address);
  if (!isEmailAddress(key)) {
    return { ok: false, reason: `"${address}" is not an email address (SMS and phone replies must be sent manually)` };
  }
  if (threadSender && senderKey(threadSender) === key) return { ok: true };
  if (contacts.some((c) => c.email && senderKey(c.email) === key)) return { ok: true };
  return { ok: false, reason: `${address} is neither the thread's sender nor a contact of this building` };
}

/** Validated contact with normalised email; keeps the given id (upsert) or assigns a new one. */
export function cleanContact(input: Omit<Contact, "id"> & { id?: string }): Contact {
  const email = optionalText(input.email, 320)?.toLowerCase() ?? null;
  if (email && !isEmailAddress(email)) throw new Error(`Invalid email address: ${email}`);
  return {
    id: optionalText(input.id, 100) ?? crypto.randomUUID(),
    role: requireOneOf(input.role, CONTACT_ROLES, "contact role"),
    name: requireText(input.name, "Contact name", 200),
    lot: optionalText(input.lot, 50),
    email,
    phone: optionalText(input.phone, 50),
    trade: optionalText(input.trade, 100),
    afterHours: input.afterHours === true,
    notes: optionalText(input.notes, 2000),
    sample: input.sample === true,
  };
}

export function applyEdits(draft: EmailDraft, edits?: { subject?: string; body?: string }): EmailDraft {
  const subject = edits?.subject?.trim();
  const body = edits?.body?.trim();
  return { ...draft, subject: subject || draft.subject, body: body || draft.body };
}

// ---------------------------------------------------------------------------
// Documents and chat
// ---------------------------------------------------------------------------

/** Keeps at most `perDoc` hits from any one document so results cover more sources. */
export function capPerDoc<T extends { doc_id: string }>(rows: T[], perDoc: number): T[] {
  const seen = new Map<string, number>();
  return rows.filter((row) => {
    const count = seen.get(row.doc_id) ?? 0;
    seen.set(row.doc_id, count + 1);
    return count < perDoc;
  });
}

export function citationsFrom(hits: SearchHit[]): Citation[] {
  const byDoc = new Map<string, Citation>();
  for (const hit of hits) {
    if (!byDoc.has(hit.docId)) byDoc.set(hit.docId, { docId: hit.docId, docName: hit.docName, snippet: hit.snippet });
  }
  return [...byDoc.values()];
}

const TABLE_SEPARATOR = /^\|?[-\s|:]+\|?$/;

/** Markdown passage as one plain line: table rows become "cell · cell", headings and emphasis are dropped. */
export function plainPassage(text: string, max = 300): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !TABLE_SEPARATOR.test(line))
    .map((line) =>
      (line.startsWith("|")
        ? line
            .split("|")
            .map((cell) => cell.trim())
            .filter(Boolean)
            .join(" · ")
        : line
      )
        .replace(/^#{1,6}\s*/, "")
        .replace(/\*\*|__|`/g, ""),
    );
  return previewOf(lines.join(" "), max);
}

/** Chat answer used when no LLM is in use: says so plainly, then lists document matches (and any matching contacts). */
export function offlineAnswer(
  reason: string,
  hits: SearchHit[],
  contactLines: string[] = [],
): { text: string; citations: Citation[] } {
  // A contact that answers the question ("Who is our after-hours plumber?") goes first, above the document passages.
  const contacts = contactLines.length ? `\n\nFrom this building's contacts:\n${contactLines.map((l) => `- ${l}`).join("\n")}` : "";
  if (hits.length === 0) {
    return { text: `${reason}${contacts}\n\nI found nothing in this building's documents that matches the question.`, citations: [] };
  }
  const lines = hits.map((hit) => `- ${hit.docName} (${hit.folder}): ${plainPassage(hit.snippet)}`);
  return {
    text: `${reason}${contacts}\n\nThe most relevant passages in this building's documents are:\n${lines.join("\n")}`,
    citations: citationsFrom(hits),
  };
}

const CHAT_TRADES: [RegExp, string][] = [
  [/\bplumb/i, "plumber"],
  [/\belectric/i, "electrician"],
  [/\blocksmith|\blocked out\b|\bkeys?\b/i, "locksmith"],
  [/\bglaz|\bwindow/i, "glazier"],
  [/\bgarden|\blawn|\bretic/i, "gardener"],
  [/\bclean/i, "cleaner"],
  [/\broof/i, "roofer"],
  [/\bpest|termite/i, "pest controller"],
  [/\bgas fitter|\bgas\b/i, "gas fitter"],
  [/\blift|\belevator/i, "lift technician"],
];

/** "After-hours plumber: Sample Plumbing (24/7), 08 5550 0021" lines for the trades a question names. */
export function contractorLines(question: string, contacts: Contact[]): string[] {
  const afterHours = /after[- ]?hours|24\/7|emergency|urgent|tonight|weekend/i.test(question);
  const trades = CHAT_TRADES.filter(([pattern]) => pattern.test(question)).map(([, trade]) => trade);
  const lines: string[] = [];
  for (const trade of trades) {
    const c = pickContractor(contacts, trade, afterHours ? "P1" : "P3");
    if (!c) continue;
    const label = `${c.afterHours ? "After-hours " : ""}${trade}`;
    const details = [c.phone, c.email].filter(Boolean).join(", ");
    lines.push(`${label.charAt(0).toUpperCase()}${label.slice(1)}: ${c.name}${details ? `, ${details}` : ""}${c.sample ? " (SAMPLE contact)" : ""}`);
  }
  return lines;
}

const TOOL_LABELS: Record<string, string> = {
  search_documents: "Searching documents …",
  read_document: "Reading a document …",
  list_contacts: "Checking contacts …",
  list_tickets: "Checking work orders …",
  list_threads: "Checking the inbox …",
  create_ticket: "Creating a work order …",
  remember: "Saving a memory note …",
  draft_reply: "Drafting a reply …",
  save_draft: "Saving the draft …",
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? `Using ${name} …`;
}

/**
 * How to persist runAgent's returned history. Normally it extends the stored one, so only the
 * new turns are appended. If it does not (runAgent restarted a conversation the API rejected),
 * the stored copy must be replaced.
 */
export function historyUpdate(previous: unknown[], returned: unknown[]): { replace: boolean; entries: unknown[] } {
  const extendsPrevious =
    returned.length >= previous.length &&
    previous.every((entry, i) => JSON.stringify(entry) === JSON.stringify(returned[i]));
  return extendsPrevious ? { replace: false, entries: returned.slice(previous.length) } : { replace: true, entries: returned };
}

/** Stand-in profile for an agent that has not been init()ed yet (never persisted). */
export function placeholderProfile(id: string, emailAddress: string): PropertyProfile {
  return {
    id,
    spNumber: id.replace(/^sp-/i, ""),
    street: "Address not set",
    suburb: "",
    state: "WA",
    postcode: null,
    lots: null,
    status: "onboarding",
    emailAddress,
    notes: "Profile not initialised yet",
  };
}
