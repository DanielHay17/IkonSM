// Shared domain types for IkonSM. Imported by the Worker (worker/**) and the SPA (src/**).
// Keep this file dependency-free (types + small constants only).

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

/** A strata scheme managed by Ikon. id is always "sp-<digits>", e.g. "sp-26707". */
export interface PropertyProfile {
  id: string;
  spNumber: string; // "26707"
  street: string; // "34 Davies Road"
  suburb: string; // "Claremont"
  state: "WA";
  postcode: string | null;
  lots: number | null;
  status: "pilot" | "active" | "onboarding";
  /** Building agent's inbound address, e.g. sp26707@ikon.example.com (derived from EMAIL_DOMAIN). */
  emailAddress: string;
  /** Free-text notes, e.g. "Street number to confirm". */
  notes: string | null;
}

// ---------------------------------------------------------------------------
// AI provider (which LLM, if any, produced a result)
// ---------------------------------------------------------------------------

/**
 * anthropic = Claude with an Anthropic API key; gateway = Claude through Cloudflare AI Gateway
 * unified billing (no Anthropic key); workers-ai = a Workers AI model (lighter, no tools);
 * off = no LLM: deterministic rules and templates only.
 */
export type AiProviderKind = "anthropic" | "gateway" | "workers-ai" | "off";

export interface AiInfo {
  provider: AiProviderKind;
  /** Main model label (Claude agent model or the Workers AI model); null when off. */
  model: string | null;
  /** Technical reason the configured provider is not in use (for status panels, never chat text); null when fine. */
  note?: string | null;
}

// ---------------------------------------------------------------------------
// Triage (WA strata terminology: strata company, council, contributions, by-laws)
// ---------------------------------------------------------------------------

export const CATEGORIES = [
  "maintenance",
  "insurance",
  "levies",
  "sales_disclosure",
  "bylaws_conduct",
  "owner_approval",
  "governance",
  "contractor",
  "tenant_or_pm",
  "legal_formal",
  "general",
  "spam",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  maintenance: "Maintenance",
  insurance: "Insurance",
  levies: "Levies & accounts",
  sales_disclosure: "Sales & disclosure",
  bylaws_conduct: "By-laws & conduct",
  owner_approval: "Owner approval",
  governance: "Meetings & governance",
  contractor: "Contractor",
  tenant_or_pm: "Tenant / property manager",
  legal_formal: "Legal / formal complaint",
  general: "General enquiry",
  spam: "Spam / not relevant",
};

/** P1 = emergency (immediate), P2 = urgent (same/next business day), P3 = routine (2-5 business days). */
export type Priority = "P1" | "P2" | "P3";

export const ASSIGNEE_ROLES = [
  "strata_manager",
  "accounts",
  "council",
  "contractor",
  "insurer",
  "senior_manager",
  "emergency_services",
] as const;
export type AssigneeRole = (typeof ASSIGNEE_ROLES)[number];

export const ASSIGNEE_LABELS: Record<AssigneeRole, string> = {
  strata_manager: "Strata manager",
  accounts: "Accounts",
  council: "Council",
  contractor: "Contractor",
  insurer: "Insurer",
  senior_manager: "Senior manager",
  emergency_services: "Emergency services (000)",
};

/** Who is likely responsible for the cost/repair. */
export type Responsibility = "strata_company" | "lot_owner" | "unclear" | "not_applicable";

export interface Triage {
  category: Category;
  priority: Priority;
  responsibility: Responsibility;
  responsibilityReason: string;
  /** One-line summary for lists. */
  summary: string;
  allocateTo: AssigneeRole[];
  /** e.g. "plumber", "electrician", "locksmith" when a contractor is needed. */
  contractorTrade: string | null;
  /** e.g. "s110 certificate: 14 days from fee paid". */
  statutoryDeadline: string | null;
  /** Immediate safety guidance for P1 items, else null. */
  safetyNotice: string | null;
  /** Whether a reply to the sender should be drafted. */
  replyNeeded: boolean;
  needsHuman: boolean;
  suspectedPromptInjection: boolean;
  confidence: number; // 0..1
  engine: "claude" | "rules" | "workers-ai";
  model: string | null;
  /** Provider that served the engine ("anthropic" or "gateway" for Claude). Absent on older records. */
  provider?: AiProviderKind | null;
  triagedAt: string; // ISO
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

export type Channel = "email" | "sms" | "portal" | "phone" | "staff";

export interface InboundInput {
  channel: Channel;
  fromName: string | null;
  fromAddress: string; // email address or phone number
  subject: string;
  text: string;
  html?: string | null;
  messageId?: string | null; // RFC Message-ID incl. <brackets>
  inReplyTo?: string | null;
  references?: string | null;
  attachments?: { name: string; docId: string | null }[];
  /** true when created from the hub's "Simulate inbound" panel. */
  simulated?: boolean;
  /** Email only: false when SPF/DKIM/DMARC (or envelope alignment) do not back the From address, so it may be forged. */
  senderVerified?: boolean | null;
}

export type ThreadStatus = "new" | "triaged" | "awaiting_approval" | "replied" | "closed";

export interface Thread {
  id: string;
  subject: string;
  channel: Channel;
  fromName: string | null;
  fromAddress: string;
  status: ThreadStatus;
  triage: Triage | null;
  ticketId: string | null;
  preview: string;
  simulated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  threadId: string;
  direction: "inbound" | "outbound" | "internal";
  channel: Channel;
  from: string;
  to: string;
  subject: string;
  text: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  attachments: { name: string; docId: string | null }[];
  createdAt: string;
  author: string | null; // staff name for outbound, null for inbound
  /** Inbound email only: false when the From address could not be verified (possibly forged); null when not checked. */
  senderVerified?: boolean | null;
}

// ---------------------------------------------------------------------------
// Work orders
// ---------------------------------------------------------------------------

export type TicketStatus = "new" | "assigned" | "in_progress" | "waiting" | "done";

export interface Ticket {
  id: string;
  number: string; // "WO-26707-0001"
  title: string;
  description: string;
  category: Category;
  priority: Priority;
  status: TicketStatus;
  assigneeRole: AssigneeRole;
  assigneeName: string | null;
  contractorId: string | null; // Contact.id
  threadId: string | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketInput {
  title: string;
  description: string;
  category: Category;
  priority: Priority;
  assigneeRole: AssigneeRole;
  assigneeName?: string | null;
  contractorId?: string | null;
  threadId?: string | null;
  dueAt?: string | null;
}

// ---------------------------------------------------------------------------
// Approvals ("asks before it acts")
// ---------------------------------------------------------------------------

export type ApprovalKind = "send_email" | "dispatch_contractor";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "failed";

export interface Citation {
  docId: string;
  docName: string;
  snippet: string;
}

export interface EmailDraft {
  to: string; // single recipient
  toName: string | null;
  subject: string;
  body: string; // plain text
  inReplyTo: string | null;
  references: string | null;
}

export interface Approval {
  id: string;
  propertyId: string;
  kind: ApprovalKind;
  /** Short human title: "Reply to Jane (Lot 4) about water leak". */
  title: string;
  /** Why the agent wants to do this. */
  rationale: string;
  draft: EmailDraft;
  citations: Citation[];
  threadId: string | null;
  ticketId: string | null;
  status: ApprovalStatus;
  createdBy: string; // "agent" or staff name
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  /** Result of execution, e.g. "Sent (messageId <...>)" or error text. */
  result: string | null;
  engine: "claude" | "template" | "workers-ai";
  /** Model that wrote the draft (null for templates). Absent on older records. */
  model?: string | null;
  /** Provider that served the engine ("anthropic" or "gateway" for Claude). Absent on older records. */
  provider?: AiProviderKind | null;
  /** True when the approval belongs to a simulated thread (approving still sends a real email). */
  simulated?: boolean;
}

export interface ApprovalDecision {
  decision: "approve" | "reject";
  /** Optional staff edits applied before sending. */
  edits?: { subject?: string; body?: string };
  note?: string;
}

// ---------------------------------------------------------------------------
// Documents (the Files tab; "vault" internally)
// ---------------------------------------------------------------------------

export const VAULT_FOLDERS = [
  "01 Plan & By-laws",
  "02 Insurance",
  "03 Meetings",
  "04 Financials & Levies",
  "05 Maintenance & Contractors",
  "06 Compliance & Safety",
  "07 Correspondence",
  "08 Sales & Disclosure",
] as const;

export interface DocMeta {
  id: string;
  folder: string;
  name: string;
  mimeType: string;
  size: number;
  r2Key: string;
  /** "building" docs belong to this scheme; "company" docs are Ikon-wide policy copied into every agent. */
  scope: "building" | "company";
  /** true for clearly-labelled sample/demo documents. */
  sample: boolean;
  /** full = text extracted and searchable; metadata = only name/folder searchable; failed = extraction error. */
  indexed: "full" | "metadata" | "failed";
  chars: number;
  uploadedAt: string;
  uploadedBy: string;
}

/** DocMeta.uploadedBy prefix for attachments filed from inbound email: untrusted, never a building record. */
export const EMAILED_UPLOAD_PREFIX = "email:";

/** The sender of an emailed attachment ("email:jane@example.com" → "jane@example.com"), else null. */
export function emailedBy(uploadedBy: string | null | undefined): string | null {
  return uploadedBy?.startsWith(EMAILED_UPLOAD_PREFIX) ? uploadedBy.slice(EMAILED_UPLOAD_PREFIX.length) || "unknown sender" : null;
}

export interface SearchHit {
  docId: string;
  docName: string;
  folder: string;
  chunkIndex: number;
  snippet: string;
  score: number;
  /** Who added the document ("seed", a staff name, or "email:<sender>" for an emailed attachment). */
  uploadedBy?: string;
}

// ---------------------------------------------------------------------------
// Microsoft 365 import (OneDrive and SharePoint document libraries)
// ---------------------------------------------------------------------------

/** Where the picker starts: the signed-in account's own OneDrive, or the SharePoint sites it can reach. */
export type OneDriveSource = "me" | "sites";

export interface OneDriveAccount {
  name: string;
  email: string | null;
}

/** configured = the Worker has MS_CLIENT_ID and MS_CLIENT_SECRET; connected = a Microsoft account is signed in. */
export interface OneDriveStatus {
  configured: boolean;
  connected: boolean;
  account?: OneDriveAccount;
}

/** site = a SharePoint site; drive = a document library (or a OneDrive); folder and file are drive items. */
export type OneDriveItemKind = "site" | "drive" | "folder" | "file";

export interface OneDriveItem {
  id: string;
  /** The drive the item is in (for a drive, its own id); null for sites. */
  driveId: string | null;
  siteId?: string;
  name: string;
  kind: OneDriveItemKind;
  size: number | null;
  mimeType: string | null;
  modified: string | null;
  webUrl: string | null;
  /** Folders only: how many items are inside. */
  childCount: number | null;
}

export interface OneDriveListing {
  items: OneDriveItem[];
  /** True when there were more items than the hub lists at once. */
  truncated: boolean;
}

export interface OneDriveItemRef {
  driveId: string;
  itemId: string;
}

export type OneDriveImportStatus = "imported" | "skipped" | "failed";

export interface OneDriveImportResult extends OneDriveItemRef {
  status: OneDriveImportStatus;
  name: string | null;
  /** Why it was skipped or failed; null when imported. */
  reason: string | null;
  docId: string | null;
}

export interface OneDriveImportResponse {
  results: OneDriveImportResult[];
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export type ContactRole =
  | "owner"
  | "tenant"
  | "council"
  | "contractor"
  | "insurer"
  | "property_manager"
  | "staff"
  | "other";

export interface Contact {
  id: string;
  role: ContactRole;
  name: string;
  lot: string | null;
  email: string | null;
  phone: string | null;
  trade: string | null; // for contractors: "plumber", "electrician"...
  afterHours: boolean;
  notes: string | null;
  sample: boolean;
}

// ---------------------------------------------------------------------------
// Agent "computer": activity, memory, chat
// ---------------------------------------------------------------------------

export type ActivityKind =
  | "email_in"
  | "message_in"
  | "triage"
  | "tool"
  | "draft"
  | "approval"
  | "email_out"
  | "ticket"
  | "doc"
  | "memory"
  | "chat"
  | "error"
  | "system";

export interface ActivityEvent {
  id: string;
  at: string;
  kind: ActivityKind;
  summary: string;
  detail: string | null;
  ref: string | null; // thread/ticket/approval/doc id
}

export interface MemoryNote {
  id: string;
  text: string;
  source: string; // "staff:Daniel", "agent", "seed"
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  author: string | null;
  toolCalls: { name: string; summary: string }[];
  citations: Citation[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Live agent state (synced to the browser over the agents websocket; keep it small)
// ---------------------------------------------------------------------------

export interface PropertyCounts {
  openThreads: number;
  p1Open: number;
  pendingApprovals: number;
  openTickets: number;
  docs: number;
  contacts: number;
}

export interface PropertyState {
  profile: PropertyProfile | null;
  counts: PropertyCounts;
  aiOnline: boolean;
  /** Which LLM provider and model the agent is using right now. */
  ai?: AiInfo;
  busy: { active: boolean; label: string | null; since: string | null };
  recentActivity: ActivityEvent[]; // newest first, max 25
  /** Bumped on every change so clients know to refetch lists. */
  version: number;
  updatedAt: string | null;
}

export interface PropertyOverview {
  profile: PropertyProfile;
  counts: PropertyCounts;
  aiOnline: boolean;
  p1Threads: Thread[];
  recentThreads: Thread[];
  pendingApprovals: Approval[];
}

export interface PropertyCard {
  profile: PropertyProfile;
  counts: PropertyCounts;
  lastActivityAt: string | null;
  /** Set when the building agent did not respond: counts are then unknown, not zero. */
  error?: string | null;
}

export interface PortfolioBrief {
  text: string; // markdown-ish plain text
  generatedAt: string;
  engine: "claude" | "rules" | "workers-ai";
  model?: string | null;
  provider?: AiProviderKind | null;
  highlights: { propertyId: string; label: string; priority: Priority | null }[];
}

/** The hub-wide AI switch: staff turn the deployment's AI engine off (rules and templates) and on again. */
export interface AiSwitchInfo {
  on: boolean;
  /** False when the deployment has no AI engine configured (LLM_PROVIDER off or missing keys). */
  available: boolean;
  /** The engine the switch turns on, e.g. "Workers AI Llama 4 Scout"; null when unavailable. */
  engine: string | null;
}

export interface SessionInfo {
  authenticated: boolean;
  staffName: string | null;
  authRequired: boolean;
  aiOnline: boolean;
  /** Which LLM provider and model is in use right now (after the AI switch). */
  ai?: AiInfo;
  /** Present when signed in. */
  aiSwitch?: AiSwitchInfo;
  appName: string;
  companyName: string;
  emailDomain: string;
}
