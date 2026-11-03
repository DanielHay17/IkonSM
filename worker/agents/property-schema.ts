// SQLite schema for PropertyAgent (one database per strata scheme) plus row types
// and mappers from snake_case rows to the shared domain types.
//
// Arrays/objects are stored as JSON text columns; booleans as 0/1 integers.
// Column names avoid SQL keywords (from/to/references/text) on purpose.

import type {
  ActivityEvent,
  ActivityKind,
  Approval,
  ApprovalKind,
  ApprovalStatus,
  AssigneeRole,
  Category,
  Channel,
  ChatMessage,
  Citation,
  Contact,
  ContactRole,
  DocMeta,
  EmailDraft,
  MemoryNote,
  Message,
  Priority,
  Thread,
  ThreadStatus,
  Ticket,
  TicketStatus,
  Triage,
} from "../../shared/types";

/** Columns added after the first release: [table, column, type]. Applied by addMissingColumns() after SCHEMA. */
export const ADDED_COLUMNS: readonly (readonly [table: string, column: string, type: string])[] = [
  ["approvals", "engine_model", "TEXT"],
  ["approvals", "engine_provider", "TEXT"],
  ["messages", "sender_verified", "INTEGER"],
];

/** Idempotent DDL, run in order on every wake (onStart). */
export const SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    subject_key TEXT NOT NULL,
    channel TEXT NOT NULL,
    from_name TEXT,
    from_address TEXT NOT NULL,
    sender_key TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT,
    triage TEXT,
    ticket_id TEXT,
    preview TEXT NOT NULL DEFAULT '',
    simulated INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_threads_updated ON threads (updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_threads_sender ON threads (sender_key, subject_key)`,

  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    channel TEXT NOT NULL,
    from_addr TEXT NOT NULL,
    to_addr TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    message_id TEXT,
    in_reply_to TEXT,
    refs TEXT,
    attachments TEXT NOT NULL DEFAULT '[]',
    author TEXT,
    created_at TEXT NOT NULL,
    sender_verified INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages (thread_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages (message_id)`,

  `CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL UNIQUE,
    number TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    priority TEXT NOT NULL,
    status TEXT NOT NULL,
    assignee_role TEXT NOT NULL,
    assignee_name TEXT,
    contractor_id TEXT,
    thread_id TEXT,
    due_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    rationale TEXT NOT NULL,
    draft TEXT NOT NULL,
    citations TEXT NOT NULL DEFAULT '[]',
    thread_id TEXT,
    ticket_id TEXT,
    status TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by TEXT,
    result TEXT,
    engine TEXT NOT NULL,
    engine_model TEXT,
    engine_provider TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals (status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_approvals_thread ON approvals (thread_id)`,

  // body holds the full extracted text (null when only metadata is indexed).
  `CREATE TABLE IF NOT EXISTS docs (
    id TEXT PRIMARY KEY,
    folder TEXT NOT NULL,
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    r2_key TEXT NOT NULL,
    scope TEXT NOT NULL,
    sample INTEGER NOT NULL DEFAULT 0,
    indexed TEXT NOT NULL,
    chars INTEGER NOT NULL DEFAULT 0,
    body TEXT,
    uploaded_at TEXT NOT NULL,
    uploaded_by TEXT NOT NULL
  )`,
  // doc_chunks.id is the rowid of the matching doc_fts row.
  `CREATE TABLE IF NOT EXISTS doc_chunks (
    id INTEGER PRIMARY KEY,
    doc_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    body TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_doc_chunks_doc ON doc_chunks (doc_id)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS doc_fts USING fts5 (body, name, folder, tokenize='porter unicode61')`,

  `CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    lot TEXT,
    email TEXT,
    phone TEXT,
    trade TEXT,
    after_hours INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    sample INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS activity (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    detail TEXT,
    ref TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_activity_at ON activity (at)`,

  `CREATE TABLE IF NOT EXISTS memory (
    id TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS chat (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    body TEXT NOT NULL,
    author TEXT,
    tool_calls TEXT NOT NULL DEFAULT '[]',
    citations TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  )`,

  // Inbound email per sender per Perth day, for the daily AI and attachment limits.
  `CREATE TABLE IF NOT EXISTS inbound_counts (
    day TEXT NOT NULL,
    sender_key TEXT NOT NULL,
    n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, sender_key)
  )`,

  // Anthropic MessageParam JSON, append-only; seq preserves order.
  `CREATE TABLE IF NOT EXISTS llm_history (
    seq INTEGER PRIMARY KEY,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
];

// ---------------------------------------------------------------------------
// Row types (type aliases, not interfaces, so they satisfy SqlStorage's Record constraint)
// ---------------------------------------------------------------------------

export type ThreadRow = {
  id: string;
  subject: string;
  subject_key: string;
  channel: string;
  from_name: string | null;
  from_address: string;
  sender_key: string;
  status: string;
  priority: string | null;
  triage: string | null;
  ticket_id: string | null;
  preview: string;
  simulated: number;
  created_at: string;
  updated_at: string;
};

export type MessageRow = {
  id: string;
  thread_id: string;
  direction: string;
  channel: string;
  from_addr: string;
  to_addr: string;
  subject: string;
  body: string;
  message_id: string | null;
  in_reply_to: string | null;
  refs: string | null;
  attachments: string;
  author: string | null;
  created_at: string;
  sender_verified: number | null;
};

export type TicketRow = {
  id: string;
  seq: number;
  number: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  assignee_role: string;
  assignee_name: string | null;
  contractor_id: string | null;
  thread_id: string | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ApprovalRow = {
  id: string;
  kind: string;
  title: string;
  rationale: string;
  draft: string;
  citations: string;
  thread_id: string | null;
  ticket_id: string | null;
  status: string;
  created_by: string;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  result: string | null;
  engine: string;
  engine_model: string | null;
  engine_provider: string | null;
  /** threads.simulated of the approval's thread (selected by a subquery; null without a thread). */
  thread_simulated?: number | null;
};

/** docs row without the (potentially large) body column. */
export type DocRow = {
  id: string;
  folder: string;
  name: string;
  mime_type: string;
  size: number;
  r2_key: string;
  scope: string;
  sample: number;
  indexed: string;
  chars: number;
  uploaded_at: string;
  uploaded_by: string;
};

/** Column list matching DocRow, for SELECTs that must not load the body. */
export const DOC_COLUMNS =
  "id, folder, name, mime_type, size, r2_key, scope, sample, indexed, chars, uploaded_at, uploaded_by";

export type SearchRow = {
  doc_id: string;
  chunk_index: number;
  doc_name: string;
  folder: string;
  body: string;
  snippet: string | null;
  rank: number;
  uploaded_by: string;
};

export type ContactRow = {
  id: string;
  role: string;
  name: string;
  lot: string | null;
  email: string | null;
  phone: string | null;
  trade: string | null;
  after_hours: number;
  notes: string | null;
  sample: number;
  created_at: string;
  updated_at: string;
};

export type ActivityRow = {
  id: string;
  at: string;
  kind: string;
  summary: string;
  detail: string | null;
  ref: string | null;
};

export type MemoryRow = { id: string; body: string; source: string; created_at: string };

export type ChatRow = {
  id: string;
  role: string;
  body: string;
  author: string | null;
  tool_calls: string;
  citations: string;
  created_at: string;
};

export type CountsRow = {
  open_threads: number;
  p1_open: number;
  pending_approvals: number;
  open_tickets: number;
  docs: number;
  contacts: number;
};

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/** Parses a JSON column, returning `fallback` for null or corrupt values. */
export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toThread(r: ThreadRow): Thread {
  return {
    id: r.id,
    subject: r.subject,
    channel: r.channel as Channel,
    fromName: r.from_name,
    fromAddress: r.from_address,
    status: r.status as ThreadStatus,
    triage: parseJson<Triage | null>(r.triage, null),
    ticketId: r.ticket_id,
    preview: r.preview,
    simulated: r.simulated === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toMessage(r: MessageRow): Message {
  return {
    id: r.id,
    threadId: r.thread_id,
    direction: r.direction as Message["direction"],
    channel: r.channel as Channel,
    from: r.from_addr,
    to: r.to_addr,
    subject: r.subject,
    text: r.body,
    messageId: r.message_id,
    inReplyTo: r.in_reply_to,
    references: r.refs,
    attachments: parseJson<Message["attachments"]>(r.attachments, []),
    createdAt: r.created_at,
    author: r.author,
    senderVerified: r.sender_verified === null || r.sender_verified === undefined ? null : r.sender_verified === 1,
  };
}

export function toTicket(r: TicketRow): Ticket {
  return {
    id: r.id,
    number: r.number,
    title: r.title,
    description: r.description,
    category: r.category as Category,
    priority: r.priority as Priority,
    status: r.status as TicketStatus,
    assigneeRole: r.assignee_role as AssigneeRole,
    assigneeName: r.assignee_name,
    contractorId: r.contractor_id,
    threadId: r.thread_id,
    dueAt: r.due_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toApproval(r: ApprovalRow, propertyId: string): Approval {
  return {
    id: r.id,
    propertyId,
    kind: r.kind as ApprovalKind,
    title: r.title,
    rationale: r.rationale,
    draft: parseJson<EmailDraft>(r.draft, {
      to: "",
      toName: null,
      subject: "",
      body: "",
      inReplyTo: null,
      references: null,
    }),
    citations: parseJson<Citation[]>(r.citations, []),
    threadId: r.thread_id,
    ticketId: r.ticket_id,
    status: r.status as ApprovalStatus,
    createdBy: r.created_by,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    decidedBy: r.decided_by,
    result: r.result,
    engine: r.engine as Approval["engine"],
    model: r.engine_model ?? null,
    provider: (r.engine_provider as Approval["provider"]) ?? null,
    simulated: r.thread_simulated === 1,
  };
}

export function toDoc(r: DocRow): DocMeta {
  return {
    id: r.id,
    folder: r.folder,
    name: r.name,
    mimeType: r.mime_type,
    size: r.size,
    r2Key: r.r2_key,
    scope: r.scope as DocMeta["scope"],
    sample: r.sample === 1,
    indexed: r.indexed as DocMeta["indexed"],
    chars: r.chars,
    uploadedAt: r.uploaded_at,
    uploadedBy: r.uploaded_by,
  };
}

export function toContact(r: ContactRow): Contact {
  return {
    id: r.id,
    role: r.role as ContactRole,
    name: r.name,
    lot: r.lot,
    email: r.email,
    phone: r.phone,
    trade: r.trade,
    afterHours: r.after_hours === 1,
    notes: r.notes,
    sample: r.sample === 1,
  };
}

export function toActivity(r: ActivityRow): ActivityEvent {
  return {
    id: r.id,
    at: r.at,
    kind: r.kind as ActivityKind,
    summary: r.summary,
    detail: r.detail,
    ref: r.ref,
  };
}

export function toMemory(r: MemoryRow): MemoryNote {
  return { id: r.id, text: r.body, source: r.source, createdAt: r.created_at };
}

export function toChat(r: ChatRow): ChatMessage {
  return {
    id: r.id,
    role: r.role as ChatMessage["role"],
    text: r.body,
    author: r.author,
    toolCalls: parseJson<ChatMessage["toolCalls"]>(r.tool_calls, []),
    citations: parseJson<Citation[]>(r.citations, []),
    createdAt: r.created_at,
  };
}
