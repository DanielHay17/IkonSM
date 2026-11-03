/**
 * PropertyAgent: the "computer" for one strata scheme. One Durable Object per SP,
 * named by property id ("sp-26707"); its SQLite database holds everything the building knows.
 *
 * Responsibilities
 * - Inbox: receives email (onEmail) and other channels (ingestMessage), threads messages,
 *   and files email attachments into the vault (R2 + FTS5 document index).
 * - Pipeline (processThread): triage -> work order for urgent maintenance/insurance ->
 *   reply draft -> contractor dispatch draft. Every outbound email is an Approval.
 *   Inbound content is untrusted data and never sends anything by itself: only
 *   decideApproval (a logged-in human via /api) sends, and only to the thread's original
 *   sender or a contact stored on this building.
 * - Records: tickets (work orders), contacts, documents and search, memory notes, activity log.
 * - Chat: staff talk to the building's agent through ai/agent-loop.runAgent; the Anthropic
 *   history is persisted append-only and the system prompt is frozen per conversation.
 * - Live state (PropertyState): counts, busy indicator and recent activity, broadcast to
 *   read-only websocket clients. `version` bumps on every mutation so the hub refetches.
 */

import { Agent, type Connection } from "agents";
import type { AgentEmail } from "agents/email";
import type {
  ActivityEvent,
  ActivityKind,
  Approval,
  ApprovalDecision,
  ApprovalStatus,
  ChatMessage,
  Contact,
  ContactRole,
  DocMeta,
  EmailDraft,
  InboundInput,
  MemoryNote,
  Message,
  PropertyCounts,
  PropertyOverview,
  PropertyProfile,
  PropertyState,
  SearchHit,
  Thread,
  ThreadStatus,
  Ticket,
  TicketInput,
  TicketStatus,
  Triage,
} from "../../shared/types";
import { runAgent, type ToolHost } from "../ai/agent-loop";
import { aiOnline } from "../ai/client";
import { draftReply as composeDraft } from "../ai/drafting";
import { propertySystemPrompt } from "../ai/prompts";
import { triageMessage } from "../ai/triage";
import { chunkText, ftsQuery } from "../docs/chunk";
import { extractText } from "../docs/extract";
import { guessMime, r2KeyFor } from "../docs/vault";
import { parseInbound } from "../email/inbound";
import { sendApprovedEmail } from "../email/outbound";
import { addressForProperty } from "../email/routing";
import {
  APPROVAL_STATUSES,
  ASSIGNEE_ROLES,
  CATEGORIES,
  CONTACT_ROLES,
  PRIORITIES,
  THREAD_STATUSES,
  TICKET_STATUSES,
  applyEdits,
  capPerDoc,
  channelNoun,
  checkRecipient,
  clamp,
  cleanContact,
  describeTicketChanges,
  errorText,
  formatAddress,
  isOneOf,
  messageSender,
  needsTicket,
  historyUpdate,
  normaliseInbound,
  normaliseMessageId,
  nowIso,
  offlineAnswer,
  optionalText,
  parseMessageIds,
  pickContractor,
  placeholderProfile,
  previewOf,
  referencesFor,
  replyRecipient,
  replySkipReason,
  requireOneOf,
  requireText,
  senderKey,
  senderLabel,
  sha256Hex,
  shouldDraftReply,
  subjectKey,
  ticketAssignee,
  ticketDescription,
  ticketDueAt,
  ticketNumber,
  toolLabel,
  triageDetail,
  triageHeadline,
  truncate,
  DAY_MS,
} from "./property-helpers";
import {
  DOC_COLUMNS,
  SCHEMA,
  parseJson,
  toActivity,
  toApproval,
  toChat,
  toContact,
  toDoc,
  toMemory,
  toMessage,
  toThread,
  toTicket,
  type ActivityRow,
  type ApprovalRow,
  type ChatRow,
  type ContactRow,
  type CountsRow,
  type DocRow,
  type MemoryRow,
  type MessageRow,
  type SearchRow,
  type ThreadRow,
  type TicketRow,
} from "./property-schema";

const CORRESPONDENCE_FOLDER = "07 Correspondence";
const THREAD_WINDOW_MS = 14 * DAY_MS;
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_CHAT_CHARS = 8000;
const ACTIVITY_RETENTION = 5000;
const RECENT_ACTIVITY = 25;
const LIST_LIMIT = 500;
const OFFLINE_REASON =
  "AI offline: Claude is not connected (no ANTHROPIC_API_KEY), so this is a plain document search rather than an AI answer.";

export type PropertySeed = {
  docs: { folder: string; name: string; text: string; scope: "building" | "company"; sample: boolean }[];
  contacts: Omit<Contact, "id">[];
  memory: string[];
};

export type PropertyStats = {
  profile: PropertyProfile | null;
  counts: PropertyCounts;
  lastActivityAt: string | null;
  p1Threads: Thread[];
  pendingApprovals: Approval[];
};

type DocInput = Omit<DocMeta, "id" | "chars" | "indexed" | "uploadedAt"> & { id?: string };
type ContactInput = Omit<Contact, "id"> & { id?: string };
type TicketPatch = Partial<TicketInput> & { status?: TicketStatus };
type InboundAttachment = { name: string; mimeType: string; content: Uint8Array };
type FiledAttachment = { name: string; docId: string | null };
type ChatReply = Pick<ChatMessage, "text" | "toolCalls" | "citations">;
type NewApproval = Pick<
  Approval,
  "kind" | "title" | "rationale" | "draft" | "citations" | "threadId" | "ticketId" | "createdBy" | "engine"
>;
type WorkOrder = { ticket: Ticket; contractor: Contact | null; created: boolean };
type BusyJob = { label: string; since: string };
type SqlValue = string | number | null;

const EMPTY_COUNTS: PropertyCounts = {
  openThreads: 0,
  p1Open: 0,
  pendingApprovals: 0,
  openTickets: 0,
  docs: 0,
  contacts: 0,
};

export class PropertyAgent extends Agent<Env, PropertyState> implements ToolHost {
  initialState: PropertyState = {
    profile: null,
    counts: EMPTY_COUNTS,
    aiOnline: false,
    busy: { active: false, label: null, since: null },
    recentActivity: [],
    version: 0,
    updatedAt: null,
  };

  /** In-flight work shown as the busy indicator (innermost job's label wins). */
  private busyJobs: BusyJob[] = [];
  /** Per-key promise chains that serialise work which must not interleave across awaits. */
  private locks = new Map<string, Promise<unknown>>();

  // -------------------------------------------------------------------------
  // Lifecycle and websocket policy
  // -------------------------------------------------------------------------

  async onStart(): Promise<void> {
    for (const ddl of SCHEMA) this.ctx.storage.sql.exec(ddl);
    // A fresh instance has no work in flight, so this also clears a busy flag left by an evicted one.
    this.syncState(false);
  }

  shouldConnectionBeReadonly(): boolean {
    return true;
  }

  validateStateChange(_next: PropertyState, source: Connection | "server"): void {
    if (source !== "server") throw new Error("PropertyAgent state is read-only for clients");
  }

  async onRequest(): Promise<Response> {
    return Response.json({ error: "use /api" }, { status: 404 });
  }

  // -------------------------------------------------------------------------
  // Profile and overview
  // -------------------------------------------------------------------------

  async init(profile: PropertyProfile): Promise<void> {
    const next = JSON.stringify(profile);
    const previous = this.getMeta("profile");
    if (previous === next) return;
    this.setMeta("profile", next);
    this.logActivity(
      "system",
      previous
        ? "Building profile updated"
        : `Agent started for SP ${profile.spNumber}, ${[profile.street, profile.suburb].filter(Boolean).join(", ")}`,
    );
    this.touch();
  }

  async getProfile(): Promise<PropertyProfile | null> {
    return this.storedProfile();
  }

  async getOverview(): Promise<PropertyOverview> {
    return {
      profile: this.profile(),
      counts: this.computeCounts(),
      aiOnline: aiOnline(this.env),
      p1Threads: this.openP1Threads(),
      recentThreads: this.selectThreads("ORDER BY updated_at DESC LIMIT 20"),
      pendingApprovals: this.selectApprovals("WHERE status = 'pending' ORDER BY created_at DESC"),
    };
  }

  async getStats(): Promise<PropertyStats> {
    return {
      profile: this.storedProfile(),
      counts: this.computeCounts(),
      lastActivityAt: this.sql<{ at: string | null }>`SELECT MAX(at) AS at FROM activity`[0]?.at ?? null,
      p1Threads: this.openP1Threads(),
      pendingApprovals: this.selectApprovals("WHERE status = 'pending' ORDER BY created_at DESC"),
    };
  }

  // -------------------------------------------------------------------------
  // Inbound messages
  // -------------------------------------------------------------------------

  /** Email Routing entry point (called by routeAgentEmail). Never replies or sends. */
  async onEmail(email: AgentEmail): Promise<void> {
    try {
      const parsed = await parseInbound(await email.getRaw(), { from: email.from, to: email.to });
      if (parsed.isAutoReply) {
        this.logActivity(
          "email_in",
          `Ignored automatic reply from ${parsed.input.fromAddress}: ${parsed.input.subject}`,
        );
        this.touch();
        return;
      }
      const attachments = await this.fileAttachments(parsed.attachments, parsed.input.fromAddress);
      await this.ingestMessage(
        { ...parsed.input, channel: "email", attachments: attachments.length ? attachments : parsed.input.attachments },
        { process: "background" },
      );
    } catch (err) {
      this.logActivity("error", `Could not read an email from ${email.from}`, errorText(err));
      this.touch();
    }
  }

  async ingestMessage(
    input: InboundInput,
    opts: { process?: "now" | "background" } = {},
  ): Promise<{ threadId: string; messageId: string }> {
    const inbound = normaliseInbound(input);
    const duplicate = inbound.messageId ? this.findInboundByMessageId(inbound.messageId) : null;
    if (duplicate) return duplicate;

    const thread = this.findThreadFor(inbound) ?? this.insertThread(inbound);
    const message = this.insertMessage({
      threadId: thread.id,
      direction: "inbound",
      channel: inbound.channel,
      from: formatAddress(inbound.fromName, inbound.fromAddress),
      to: this.profile().emailAddress,
      subject: inbound.subject,
      text: inbound.text,
      messageId: inbound.messageId ?? null,
      inReplyTo: inbound.inReplyTo ?? null,
      references: inbound.references ?? null,
      attachments: inbound.attachments ?? [],
      author: null,
    });
    // New inbound mail (re)opens the thread until it has been triaged again.
    this.sql`UPDATE threads SET status = 'new', preview = ${previewOf(inbound.text)}, updated_at = ${message.createdAt}
      WHERE id = ${thread.id}`;
    this.logActivity(
      inbound.channel === "email" ? "email_in" : "message_in",
      `${capitalise(channelNoun(inbound.channel))} from ${inbound.fromName ?? inbound.fromAddress}: ${inbound.subject}${inbound.simulated ? " (simulated)" : ""}`,
      previewOf(inbound.text, 300),
      thread.id,
    );
    this.touch();

    if (opts.process === "background") await this.queue("processThreadTask", { threadId: thread.id });
    else await this.processThread(thread.id);
    return { threadId: thread.id, messageId: message.id };
  }

  /** Queue callback for ingestMessage(..., { process: "background" }). */
  async processThreadTask(payload: { threadId: string }): Promise<void> {
    await this.processThread(payload.threadId);
  }

  /** Triage -> work order -> reply approval -> dispatch approval. Logs failures instead of throwing. */
  async processThread(threadId: string): Promise<void> {
    await this.serialize(`thread:${threadId}`, async () => {
      try {
        await this.runPipeline(threadId);
      } catch (err) {
        this.logActivity("error", "Could not finish processing a message", errorText(err), threadId);
      } finally {
        this.touch();
      }
    });
  }

  async retriage(threadId: string): Promise<Triage> {
    const thread = this.requireThread(threadId);
    const latest = this.latestInbound(threadId);
    if (!latest) throw new Error("Thread has no inbound message to triage");
    const triage = await this.triageThread(thread, latest);
    this.refreshThreadStatus(threadId);
    this.touch();
    return triage;
  }

  async draftReply(threadId: string, instructions: string | null, actor: string): Promise<Approval> {
    const approval = await this.composeReplyApproval(threadId, optionalText(instructions, 4000), actor);
    this.refreshThreadStatus(threadId);
    this.touch();
    return approval;
  }

  // -------------------------------------------------------------------------
  // Threads
  // -------------------------------------------------------------------------

  async listThreads(filter: { status?: ThreadStatus | "open" } = {}): Promise<Thread[]> {
    const status = filter?.status;
    if (status === "open") {
      return this.selectThreads(`WHERE status != 'closed' ORDER BY updated_at DESC LIMIT ${LIST_LIMIT}`);
    }
    if (isOneOf(status, THREAD_STATUSES)) {
      return this.selectThreads(`WHERE status = ? ORDER BY updated_at DESC LIMIT ${LIST_LIMIT}`, status);
    }
    return this.selectThreads(`ORDER BY updated_at DESC LIMIT ${LIST_LIMIT}`);
  }

  async getThread(
    threadId: string,
  ): Promise<{ thread: Thread; messages: Message[]; approvals: Approval[]; ticket: Ticket | null } | null> {
    const thread = this.findThread(threadId);
    if (!thread) return null;
    return {
      thread,
      messages: this.messagesFor(threadId),
      approvals: this.selectApprovals("WHERE thread_id = ? ORDER BY created_at DESC", threadId),
      ticket: thread.ticketId ? this.findTicket(thread.ticketId) : null,
    };
  }

  /** Closes the thread and withdraws its pending reply drafts (contractor dispatches stay queued). */
  async closeThread(threadId: string, actor: string): Promise<void> {
    const thread = this.requireThread(threadId);
    if (thread.status === "closed") return;
    const now = nowIso();
    this.sql`UPDATE approvals SET status = 'rejected', decided_at = ${now}, decided_by = ${actor},
      result = ${`Withdrawn: thread closed by ${actor}`}
      WHERE thread_id = ${threadId} AND kind = 'send_email' AND status = 'pending'`;
    this.sql`UPDATE threads SET status = 'closed', updated_at = ${now} WHERE id = ${threadId}`;
    this.logActivity("system", `${actor} closed "${thread.subject}"`, null, threadId);
    this.touch();
  }

  // -------------------------------------------------------------------------
  // Approvals
  // -------------------------------------------------------------------------

  async listApprovals(status?: ApprovalStatus): Promise<Approval[]> {
    return isOneOf(status, APPROVAL_STATUSES)
      ? this.selectApprovals(`WHERE status = ? ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`, status)
      : this.selectApprovals(`ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`);
  }

  /** Approve (validate recipient, send, record) or reject a pending approval. Send errors become status "failed". */
  async decideApproval(approvalId: string, decision: ApprovalDecision, actor: string): Promise<Approval> {
    const approval = this.findApproval(approvalId);
    if (!approval) throw new Error("Approval not found");
    if (approval.status !== "pending") throw new Error("Approval already decided");
    if (decision?.decision === "reject") return this.rejectApproval(approval, decision.note, actor);
    if (decision?.decision !== "approve") throw new Error("Decision must be approve or reject");
    return this.approveAndSend(approval, decision, actor);
  }

  // -------------------------------------------------------------------------
  // Tickets (work orders)
  // -------------------------------------------------------------------------

  async listTickets(): Promise<Ticket[]> {
    return this.selectTickets(`ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`);
  }

  async createTicket(input: TicketInput, actor: string): Promise<Ticket> {
    const clean = this.cleanTicketInput(input);
    const ticket = this.insertTicket({ ...clean, dueAt: clean.dueAt ?? ticketDueAt(clean.priority) }, actor);
    this.touch();
    return ticket;
  }

  async updateTicket(id: string, patch: TicketPatch, actor: string): Promise<Ticket> {
    const before = this.findTicket(id);
    if (!before) throw new Error("Ticket not found");
    const changes = Object.fromEntries(Object.entries(patch ?? {}).filter(([, v]) => v !== undefined)) as TicketPatch;
    const next = this.cleanTicketInput({ ...before, ...changes });
    const status = changes.status === undefined ? before.status : requireOneOf(changes.status, TICKET_STATUSES, "ticket status");
    this.sql`UPDATE tickets SET title = ${next.title}, description = ${next.description}, category = ${next.category},
      priority = ${next.priority}, status = ${status}, assignee_role = ${next.assigneeRole},
      assignee_name = ${next.assigneeName ?? null}, contractor_id = ${next.contractorId ?? null},
      thread_id = ${next.threadId ?? null}, due_at = ${next.dueAt ?? null}, updated_at = ${nowIso()}
      WHERE id = ${id}`;
    if (next.threadId) this.linkThreadToTicket(next.threadId, id);
    const after = this.findTicket(id) as Ticket;
    this.logActivity("ticket", `${actor} updated ${after.number}: ${describeTicketChanges(before, after)}`, null, id);
    this.touch();
    return after;
  }

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------

  async listDocs(): Promise<DocMeta[]> {
    return this.selectDocs("ORDER BY folder, name");
  }

  /** Indexes text into doc_chunks + doc_fts (name and folder are always searchable). Same id re-indexes. */
  async addDocument(meta: DocInput, text: string | null): Promise<DocMeta> {
    const doc = this.indexDocument(meta, text);
    this.logActivity("doc", `Indexed "${doc.name}" in ${doc.folder} (${indexNote(doc)})`, null, doc.id);
    this.touch();
    return doc;
  }

  /** Removes the document from the index; the caller deletes the R2 object. */
  async deleteDocument(id: string, actor: string): Promise<DocMeta | null> {
    const doc = this.findDoc(id);
    if (!doc) return null;
    this.ctx.storage.transactionSync(() => this.removeDocumentRows(id));
    this.logActivity("doc", `${actor} deleted "${doc.name}" from ${doc.folder}`, null, id);
    this.touch();
    return doc;
  }

  async getDocument(id: string): Promise<{ meta: DocMeta; text: string | null } | null> {
    const meta = this.findDoc(id);
    if (!meta) return null;
    const text = this.sql<{ body: string | null }>`SELECT body FROM docs WHERE id = ${id}`[0]?.body ?? null;
    return { meta, text };
  }

  async searchDocs(query: string, limit = 8): Promise<SearchHit[]> {
    return this.searchIndex(query, limit);
  }

  // -------------------------------------------------------------------------
  // Contacts
  // -------------------------------------------------------------------------

  async listContacts(role?: ContactRole): Promise<Contact[]> {
    if (role !== undefined && !isOneOf(role, CONTACT_ROLES)) return [];
    return this.contactRows(role);
  }

  async upsertContact(c: ContactInput, actor: string): Promise<Contact> {
    const contact = this.saveContact(c);
    this.logActivity("system", `${actor} saved contact ${contact.name} (${contact.role})`, null, contact.id);
    this.touch();
    return contact;
  }

  async deleteContact(id: string, actor: string): Promise<void> {
    const contact = this.findContact(id);
    if (!contact) return;
    this.sql`DELETE FROM contacts WHERE id = ${id}`;
    this.sql`UPDATE tickets SET contractor_id = NULL WHERE contractor_id = ${id}`;
    this.logActivity("system", `${actor} deleted contact ${contact.name} (${contact.role})`, null, id);
    this.touch();
  }

  // -------------------------------------------------------------------------
  // Chat with the building's agent
  // -------------------------------------------------------------------------

  async chat(text: string, actor: string): Promise<ChatMessage> {
    const question = requireText(text, "Message", MAX_CHAT_CHARS);
    return this.serialize("chat", () => this.runChat(question, actor));
  }

  async getChat(): Promise<ChatMessage[]> {
    return this.sql<ChatRow>`SELECT * FROM chat ORDER BY created_at, rowid`.map(toChat);
  }

  async resetChat(actor: string): Promise<void> {
    await this.serialize("chat", async () => {
      this.sql`DELETE FROM chat`;
      this.sql`DELETE FROM llm_history`;
      this.sql`DELETE FROM meta WHERE key = 'chat_system'`;
      this.logActivity("chat", `${actor} started a new conversation`);
      this.touch();
    });
  }

  // -------------------------------------------------------------------------
  // Activity and memory
  // -------------------------------------------------------------------------

  async listActivity(limit = 50): Promise<ActivityEvent[]> {
    const max = clamp(Math.floor(Number(limit)) || 50, 1, LIST_LIMIT);
    return this.recentActivity(max);
  }

  async listMemory(): Promise<MemoryNote[]> {
    return this.memoryNotes();
  }

  async addMemory(text: string, source: string): Promise<MemoryNote> {
    const note = this.insertMemory(requireText(text, "Memory note", 2000), optionalText(source, 100) ?? "agent");
    this.logActivity("memory", `Remembered: ${truncate(note.text, 120)}`, `Source: ${note.source}`, note.id);
    this.touch();
    return note;
  }

  async deleteMemory(id: string): Promise<void> {
    const row = this.sql<MemoryRow>`SELECT * FROM memory WHERE id = ${id}`[0];
    if (!row) return;
    this.sql`DELETE FROM memory WHERE id = ${id}`;
    this.logActivity("memory", `Forgot: ${truncate(row.body, 120)}`, null, id);
    this.touch();
  }

  // -------------------------------------------------------------------------
  // Seed data
  // -------------------------------------------------------------------------

  /**
   * Loads sample docs, contacts and memory. Idempotent: an identical payload is skipped
   * (fingerprint in meta), and items already present (same folder+name, role+name, text)
   * are never duplicated, so the pilot data and company policy docs can be seeded separately.
   */
  async seed(data: PropertySeed): Promise<{ docs: number; contacts: number }> {
    return this.serialize("seed", async () => {
      const fingerprint = await sha256Hex(JSON.stringify(data));
      const applied = parseJson<string[]>(this.getMeta("seed_fingerprints"), []);
      if (applied.includes(fingerprint)) return { docs: 0, contacts: 0 };

      let docs = 0;
      for (const doc of data.docs ?? []) if (await this.seedDocument(doc)) docs++;
      const contacts = (data.contacts ?? []).filter((c) => this.seedContact(c)).length;
      const notes = (data.memory ?? []).filter((text) => this.seedMemoryNote(text)).length;

      this.setMeta("seed_fingerprints", JSON.stringify([...applied, fingerprint]));
      this.setMeta("seeded", nowIso());
      this.logActivity("system", `Loaded seed data: ${docs} documents, ${contacts} contacts, ${notes} memory notes`);
      this.touch();
      return { docs, contacts };
    });
  }

  // =========================================================================
  // Private: pipeline
  // =========================================================================

  private async runPipeline(threadId: string): Promise<void> {
    const thread = this.findThread(threadId);
    const latest = thread && thread.status !== "closed" ? this.latestInbound(threadId) : null;
    if (!thread || !latest) return;

    const triage = await this.triageThread(thread, latest);
    const work = this.ensureWorkOrder(thread, triage, latest);

    if (shouldDraftReply(triage)) {
      await this.attempt("draft a reply", threadId, () => this.composeReplyApproval(threadId, null, "agent"));
    } else {
      this.logActivity("draft", replySkipReason(triage), null, threadId);
    }

    const contractor = work?.created ? work.contractor : null;
    if (work && contractor?.email) {
      const email = contractor.email;
      await this.attempt("draft the contractor work order", threadId, () =>
        this.composeDispatchApproval(threadId, triage, work.ticket, contractor, email),
      );
    }
    this.refreshThreadStatus(threadId);
  }

  /** Triages the latest inbound message (its sender may differ from the thread's, e.g. a contractor replying). */
  private async triageThread(thread: Thread, latest: Message): Promise<Triage> {
    const sender = messageSender(latest);
    const label = `Triaging ${channelNoun(latest.channel)} from ${sender.name ?? sender.address}`;
    return this.withBusy(label, async (status) => {
      status("Searching documents …");
      const context = this.searchIndex(`${latest.subject} ${latest.text.slice(0, 600)}`, 6);
      status(label);
      const triage = await triageMessage(this.env, {
        property: this.profile(),
        channel: latest.channel,
        fromName: sender.name,
        fromAddress: sender.address,
        subject: latest.subject,
        text: latest.text,
        context,
      });
      this.sql`UPDATE threads SET triage = ${JSON.stringify(triage)}, priority = ${triage.priority},
        status = CASE WHEN status = 'closed' THEN status ELSE 'triaged' END
        WHERE id = ${thread.id}`;
      this.logActivity("triage", triageHeadline(triage), triageDetail(triage), thread.id);
      return triage;
    });
  }

  /** Existing ticket for the thread, or a new one for P1/P2 maintenance and insurance items. */
  private ensureWorkOrder(thread: Thread, triage: Triage, latest: Message): WorkOrder | null {
    const existing = thread.ticketId ? this.findTicket(thread.ticketId) : null;
    if (existing) return { ticket: existing, contractor: null, created: false };
    if (!needsTicket(triage)) return null;

    const contractor = pickContractor(this.contactRows("contractor"), triage.contractorTrade, triage.priority);
    const ticket = this.insertTicket(
      {
        title: truncate(triage.summary || thread.subject, 140),
        description: ticketDescription(triage, latest),
        category: triage.category,
        priority: triage.priority,
        ...ticketAssignee(triage, contractor),
        contractorId: contractor?.id ?? null,
        threadId: thread.id,
        dueAt: ticketDueAt(triage.priority),
      },
      "agent",
    );
    return { ticket, contractor, created: true };
  }

  private async composeReplyApproval(threadId: string, instructions: string | null, actor: string): Promise<Approval> {
    const latest = this.latestInbound(threadId);
    let thread = this.requireThread(threadId);
    if (!thread.triage && latest) {
      await this.triageThread(thread, latest);
      thread = this.requireThread(threadId);
    }
    const triage = thread.triage;
    if (!triage || !latest) throw new Error("Thread has no inbound message to reply to");

    const contacts = this.contactRows();
    const sender = messageSender(latest);
    const to = replyRecipient(sender, contacts);
    const ticket = thread.ticketId ? this.findTicket(thread.ticketId) : null;
    const draft = await this.withBusy(`Drafting reply to ${to.name ?? to.address}`, () =>
      composeDraft(this.env, {
        property: this.profile(),
        companyName: this.companyName(),
        thread,
        messages: this.messagesFor(threadId),
        triage,
        host: this,
        instructions,
        to,
        purpose: "reply",
        ticket,
        contractor: null,
      }),
    );

    this.supersedePendingReplies(threadId, actor);
    return this.insertApproval({
      kind: "send_email",
      title: `Reply to ${senderLabel(sender, contacts)}: ${truncate(triage.summary || thread.subject, 80)}`,
      rationale: draft.rationale,
      draft: {
        to: to.address,
        toName: to.name,
        subject: draft.subject,
        body: draft.body,
        inReplyTo: latest.messageId,
        references: referencesFor(latest),
      },
      citations: draft.citations,
      threadId,
      ticketId: ticket?.id ?? null,
      createdBy: actor,
      engine: draft.engine,
    });
  }

  private async composeDispatchApproval(
    threadId: string,
    triage: Triage,
    ticket: Ticket,
    contractor: Contact,
    email: string,
  ): Promise<Approval> {
    const thread = this.requireThread(threadId);
    const to = { address: email.trim().toLowerCase(), name: contractor.name };
    const draft = await this.withBusy(`Drafting work order for ${contractor.name}`, () =>
      composeDraft(this.env, {
        property: this.profile(),
        companyName: this.companyName(),
        thread,
        messages: this.messagesFor(threadId),
        triage,
        host: this,
        instructions: null,
        to,
        purpose: "dispatch",
        ticket,
        contractor,
      }),
    );
    return this.insertApproval({
      kind: "dispatch_contractor",
      title: `Send ${ticket.number} to ${contractor.name}${contractor.trade ? ` (${contractor.trade})` : ""}`,
      rationale: draft.rationale,
      draft: { to: to.address, toName: to.name, subject: draft.subject, body: draft.body, inReplyTo: null, references: null },
      citations: draft.citations,
      threadId,
      ticketId: ticket.id,
      createdBy: "agent",
      engine: draft.engine,
    });
  }

  /** A new reply draft replaces any older pending one for the same thread. */
  private supersedePendingReplies(threadId: string, actor: string): void {
    this.sql`UPDATE approvals SET status = 'rejected', decided_at = ${nowIso()}, decided_by = ${actor},
      result = 'Superseded by a newer draft'
      WHERE thread_id = ${threadId} AND kind = 'send_email' AND status = 'pending'`;
  }

  /** Status follows the work: pending approvals > last message outbound (replied) > triaged > new. */
  private refreshThreadStatus(threadId: string): void {
    const thread = this.findThread(threadId);
    if (!thread || thread.status === "closed") return;
    const pending =
      this.sql<{ n: number }>`SELECT COUNT(*) AS n FROM approvals WHERE thread_id = ${threadId} AND status = 'pending'`[0]
        ?.n ?? 0;
    const last = this.sql<{ direction: string }>`SELECT direction FROM messages WHERE thread_id = ${threadId}
      ORDER BY created_at DESC, rowid DESC LIMIT 1`[0];
    const status: ThreadStatus =
      pending > 0 ? "awaiting_approval" : last?.direction === "outbound" ? "replied" : thread.triage ? "triaged" : "new";
    if (status !== thread.status) this.sql`UPDATE threads SET status = ${status} WHERE id = ${threadId}`;
  }

  private async attempt(what: string, ref: string | null, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logActivity("error", `Could not ${what}`, errorText(err), ref);
    }
  }

  // =========================================================================
  // Private: approvals
  // =========================================================================

  private insertApproval(input: NewApproval): Approval {
    const id = crypto.randomUUID();
    const createdAt = nowIso();
    this.sql`INSERT INTO approvals (id, kind, title, rationale, draft, citations, thread_id, ticket_id, status,
        created_by, created_at, engine)
      VALUES (${id}, ${input.kind}, ${input.title}, ${input.rationale}, ${JSON.stringify(input.draft)},
        ${JSON.stringify(input.citations ?? [])}, ${input.threadId}, ${input.ticketId}, 'pending',
        ${input.createdBy}, ${createdAt}, ${input.engine})`;
    this.logActivity("approval", `Waiting for approval: ${input.title}`, `Drafted by ${input.createdBy} (${input.engine})`, id);
    return this.requireApproval(id);
  }

  private async approveAndSend(approval: Approval, decision: ApprovalDecision, actor: string): Promise<Approval> {
    const draft = applyEdits(approval.draft, decision.edits);
    // Claim the approval before the first await so a concurrent decision sees it as decided.
    this.sql`UPDATE approvals SET status = 'approved', draft = ${JSON.stringify(draft)}, decided_at = ${nowIso()},
      decided_by = ${actor} WHERE id = ${approval.id}`;

    const thread = approval.threadId ? this.findThread(approval.threadId) : null;
    const check = checkRecipient(draft.to, thread?.fromAddress ?? null, this.contactRows());
    if (!check.ok) return this.failApproval(approval, actor, `Blocked: ${check.reason}`);

    const profile = this.profile();
    const fromAddress = profile.emailAddress || addressForProperty(this.env, this.name);
    const sent = await this.withBusy(`Sending email to ${draft.toName ?? draft.to}`, () =>
      sendApprovedEmail(this.env, {
        fromAddress,
        fromName: `${this.companyName()} - SP ${profile.spNumber}`,
        draft,
        propertyId: this.name,
        approvalId: approval.id,
      }),
    ).catch((err: unknown) => ({ ok: false as const, error: errorText(err) }));
    if (!sent.ok) return this.failApproval(approval, actor, `Send failed: ${sent.error}`);

    this.recordSent(approval, draft, fromAddress, sent.messageId, actor, decision.note);
    this.touch();
    return this.requireApproval(approval.id);
  }

  private recordSent(
    approval: Approval,
    draft: EmailDraft,
    fromAddress: string,
    sentMessageId: string,
    actor: string,
    note: string | undefined,
  ): void {
    const messageId = normaliseMessageId(sentMessageId);
    this.sql`UPDATE approvals SET result = ${`Sent (messageId ${messageId ?? sentMessageId})`} WHERE id = ${approval.id}`;
    if (approval.threadId) {
      const message = this.insertMessage({
        threadId: approval.threadId,
        direction: "outbound",
        channel: "email",
        from: fromAddress,
        to: formatAddress(draft.toName, draft.to),
        subject: draft.subject,
        text: draft.body,
        messageId,
        inReplyTo: draft.inReplyTo,
        references: draft.references,
        attachments: [],
        author: actor,
      });
      this.sql`UPDATE threads SET updated_at = ${message.createdAt} WHERE id = ${approval.threadId}`;
    }
    if (approval.kind === "dispatch_contractor" && approval.ticketId) this.markDispatched(approval.ticketId, draft, actor);
    if (approval.threadId) this.refreshThreadStatus(approval.threadId);
    this.logActivity("approval", `${actor} approved: ${approval.title}`, optionalText(note), approval.id);
    this.logActivity("email_out", `Email sent to ${draft.toName ?? draft.to}: ${draft.subject}`, null, approval.threadId ?? approval.id);
  }

  private markDispatched(ticketId: string, draft: EmailDraft, actor: string): void {
    const ticket = this.findTicket(ticketId);
    if (!ticket || ticket.status !== "new") return;
    const contractor = ticket.contractorId ? this.findContact(ticket.contractorId) : null;
    const name = contractor?.name ?? draft.toName ?? draft.to;
    this.sql`UPDATE tickets SET status = 'assigned', assignee_role = 'contractor', assignee_name = ${name},
      updated_at = ${nowIso()} WHERE id = ${ticketId}`;
    this.logActivity("ticket", `${ticket.number} assigned to ${name}`, `Work order sent with approval from ${actor}`, ticketId);
  }

  private failApproval(approval: Approval, actor: string, reason: string): Approval {
    this.sql`UPDATE approvals SET status = 'failed', result = ${reason} WHERE id = ${approval.id}`;
    if (approval.threadId) this.refreshThreadStatus(approval.threadId);
    this.logActivity("error", `Could not send "${approval.title}" (approved by ${actor})`, reason, approval.id);
    this.touch();
    return this.requireApproval(approval.id);
  }

  private rejectApproval(approval: Approval, note: string | undefined, actor: string): Approval {
    const reason = optionalText(note);
    this.sql`UPDATE approvals SET status = 'rejected', decided_at = ${nowIso()}, decided_by = ${actor},
      result = ${reason ? `Rejected: ${reason}` : "Rejected"} WHERE id = ${approval.id}`;
    if (approval.threadId) this.refreshThreadStatus(approval.threadId);
    this.logActivity("approval", `${actor} rejected: ${approval.title}`, reason, approval.id);
    this.touch();
    return this.requireApproval(approval.id);
  }

  // =========================================================================
  // Private: threads and messages
  // =========================================================================

  /** In-Reply-To/References match first, then same sender + same subject within 14 days. */
  private findThreadFor(inbound: InboundInput): Thread | null {
    const ids = parseMessageIds(inbound.inReplyTo, inbound.references);
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(", ");
      const hit = this.rows<{ thread_id: string }>(
        `SELECT thread_id FROM messages WHERE message_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 1`,
        ...ids,
      )[0];
      const thread = hit ? this.findThread(hit.thread_id) : null;
      if (thread) return thread;
    }
    const since = new Date(Date.now() - THREAD_WINDOW_MS).toISOString();
    const row = this.sql<ThreadRow>`SELECT * FROM threads
      WHERE sender_key = ${senderKey(inbound.fromAddress)} AND subject_key = ${subjectKey(inbound.subject)}
        AND updated_at >= ${since}
      ORDER BY updated_at DESC LIMIT 1`[0];
    return row ? toThread(row) : null;
  }

  private findInboundByMessageId(messageId: string): { threadId: string; messageId: string } | null {
    const row = this.sql<{ id: string; thread_id: string }>`SELECT id, thread_id FROM messages
      WHERE message_id = ${messageId} AND direction = 'inbound' LIMIT 1`[0];
    return row ? { threadId: row.thread_id, messageId: row.id } : null;
  }

  private insertThread(inbound: InboundInput): Thread {
    const id = crypto.randomUUID();
    const now = nowIso();
    this.sql`INSERT INTO threads (id, subject, subject_key, channel, from_name, from_address, sender_key, status,
        preview, simulated, created_at, updated_at)
      VALUES (${id}, ${inbound.subject}, ${subjectKey(inbound.subject)}, ${inbound.channel}, ${inbound.fromName},
        ${inbound.fromAddress}, ${senderKey(inbound.fromAddress)}, 'new', ${previewOf(inbound.text)},
        ${inbound.simulated ? 1 : 0}, ${now}, ${now})`;
    return this.requireThread(id);
  }

  private insertMessage(m: Omit<Message, "id" | "createdAt">): Message {
    const message: Message = {
      ...m,
      id: crypto.randomUUID(),
      createdAt: nowIso(),
      messageId: normaliseMessageId(m.messageId),
    };
    this.sql`INSERT INTO messages (id, thread_id, direction, channel, from_addr, to_addr, subject, body, message_id,
        in_reply_to, refs, attachments, author, created_at)
      VALUES (${message.id}, ${message.threadId}, ${message.direction}, ${message.channel}, ${message.from},
        ${message.to}, ${message.subject}, ${message.text}, ${message.messageId}, ${message.inReplyTo},
        ${message.references}, ${JSON.stringify(message.attachments)}, ${message.author}, ${message.createdAt})`;
    return message;
  }

  private latestInbound(threadId: string): Message | null {
    const row = this.sql<MessageRow>`SELECT * FROM messages WHERE thread_id = ${threadId} AND direction = 'inbound'
      ORDER BY created_at DESC, rowid DESC LIMIT 1`[0];
    return row ? toMessage(row) : null;
  }

  private messagesFor(threadId: string): Message[] {
    return this.sql<MessageRow>`SELECT * FROM messages WHERE thread_id = ${threadId} ORDER BY created_at, rowid`.map(
      toMessage,
    );
  }

  private openP1Threads(): Thread[] {
    return this.selectThreads("WHERE status != 'closed' AND priority = 'P1' ORDER BY updated_at DESC LIMIT 50");
  }

  // =========================================================================
  // Private: tickets
  // =========================================================================

  /** Validates enum fields and referenced ids (input may come from the model's tools). */
  private cleanTicketInput(input: TicketInput): TicketInput {
    const contractorId = optionalText(input.contractorId, 100);
    const threadId = optionalText(input.threadId, 100);
    if (contractorId && !this.findContact(contractorId)) throw new Error(`Unknown contractorId: ${contractorId}`);
    if (threadId && !this.findThread(threadId)) throw new Error(`Unknown threadId: ${threadId}`);
    return {
      title: requireText(input.title, "Ticket title", 200),
      description: typeof input.description === "string" ? input.description.slice(0, 10_000) : "",
      category: requireOneOf(input.category, CATEGORIES, "category"),
      priority: requireOneOf(input.priority, PRIORITIES, "priority"),
      assigneeRole: requireOneOf(input.assigneeRole, ASSIGNEE_ROLES, "assignee role"),
      assigneeName: optionalText(input.assigneeName, 200),
      contractorId,
      threadId,
      dueAt: optionalText(input.dueAt, 40),
    };
  }

  private insertTicket(input: TicketInput, actor: string): Ticket {
    const seq = this.sql<{ next: number }>`SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM tickets`[0]?.next ?? 1;
    const id = crypto.randomUUID();
    const now = nowIso();
    this.sql`INSERT INTO tickets (id, seq, number, title, description, category, priority, status, assignee_role,
        assignee_name, contractor_id, thread_id, due_at, created_at, updated_at)
      VALUES (${id}, ${seq}, ${ticketNumber(this.profile().spNumber, seq)}, ${input.title}, ${input.description},
        ${input.category}, ${input.priority}, 'new', ${input.assigneeRole}, ${input.assigneeName ?? null},
        ${input.contractorId ?? null}, ${input.threadId ?? null}, ${input.dueAt ?? null}, ${now}, ${now})`;
    if (input.threadId) this.linkThreadToTicket(input.threadId, id);
    const ticket = this.findTicket(id) as Ticket;
    this.logActivity("ticket", `${actor} created ${ticket.number} (${ticket.priority}): ${ticket.title}`, null, id);
    return ticket;
  }

  private linkThreadToTicket(threadId: string, ticketId: string): void {
    this.sql`UPDATE threads SET ticket_id = ${ticketId} WHERE id = ${threadId} AND ticket_id IS NULL`;
  }

  // =========================================================================
  // Private: documents
  // =========================================================================

  private indexDocument(meta: DocInput, text: string | null, extractionFailed = false): DocMeta {
    const body = typeof text === "string" && text.trim() ? text : null;
    const doc: DocMeta = {
      id: optionalText(meta.id, 100) ?? crypto.randomUUID(),
      folder: requireText(meta.folder, "Folder", 200),
      name: requireText(meta.name, "Document name", 300),
      mimeType: optionalText(meta.mimeType, 200) ?? "application/octet-stream",
      size: Math.max(0, Math.floor(Number(meta.size) || 0)),
      r2Key: requireText(meta.r2Key, "r2Key", 1024),
      scope: meta.scope === "company" ? "company" : "building",
      sample: meta.sample === true,
      indexed: body ? "full" : extractionFailed ? "failed" : "metadata",
      chars: body?.length ?? 0,
      uploadedAt: nowIso(),
      uploadedBy: optionalText(meta.uploadedBy, 200) ?? "unknown",
    };
    // Metadata-only documents still get one empty chunk so their name and folder are searchable.
    const chunks = body ? chunkText(body) : [];
    const pieces = chunks.length ? chunks : [""];

    this.ctx.storage.transactionSync(() => {
      this.removeDocumentRows(doc.id);
      this.sql`INSERT INTO docs (id, folder, name, mime_type, size, r2_key, scope, sample, indexed, chars, body,
          uploaded_at, uploaded_by)
        VALUES (${doc.id}, ${doc.folder}, ${doc.name}, ${doc.mimeType}, ${doc.size}, ${doc.r2Key}, ${doc.scope},
          ${doc.sample ? 1 : 0}, ${doc.indexed}, ${doc.chars}, ${body}, ${doc.uploadedAt}, ${doc.uploadedBy})`;
      pieces.forEach((chunk, index) => {
        const rowid = this.sql<{ id: number }>`INSERT INTO doc_chunks (doc_id, chunk_index, body)
          VALUES (${doc.id}, ${index}, ${chunk}) RETURNING id`[0]?.id;
        this.sql`INSERT INTO doc_fts (rowid, body, name, folder) VALUES (${rowid ?? null}, ${chunk}, ${doc.name}, ${doc.folder})`;
      });
    });
    return doc;
  }

  private removeDocumentRows(docId: string): void {
    this.sql`DELETE FROM doc_fts WHERE rowid IN (SELECT id FROM doc_chunks WHERE doc_id = ${docId})`;
    this.sql`DELETE FROM doc_chunks WHERE doc_id = ${docId}`;
    this.sql`DELETE FROM docs WHERE id = ${docId}`;
  }

  /** BM25 search over chunk text (weight 1), document name (5) and folder (2). Never throws. */
  private searchIndex(query: string, limit: number): SearchHit[] {
    const match = typeof query === "string" ? ftsQuery(query) : null;
    if (!match) return [];
    const max = clamp(Math.floor(Number(limit)) || 8, 1, 25);
    try {
      const rows = this.rows<SearchRow>(
        `SELECT c.doc_id AS doc_id, c.chunk_index AS chunk_index, d.name AS doc_name, d.folder AS folder,
            c.body AS body, snippet(doc_fts, -1, '', '', ' … ', 40) AS snippet,
            bm25(doc_fts, 1.0, 5.0, 2.0) AS rank
          FROM doc_fts
          JOIN doc_chunks c ON c.id = doc_fts.rowid
          JOIN docs d ON d.id = c.doc_id
          WHERE doc_fts MATCH ?
          ORDER BY rank
          LIMIT ?`,
        match,
        max * 4,
      );
      return capPerDoc(rows, 2)
        .slice(0, max)
        .map((r) => ({
          docId: r.doc_id,
          docName: r.doc_name,
          folder: r.folder,
          chunkIndex: r.chunk_index,
          snippet: r.snippet?.trim() || previewOf(r.body, 240) || `${r.folder} / ${r.doc_name}`,
          // bm25() is lower-is-better; expose higher-is-better.
          score: -r.rank,
        }));
    } catch (err) {
      console.warn(`[${this.name}] document search failed for ${JSON.stringify(query)}: ${errorText(err)}`);
      return [];
    }
  }

  private async fileAttachments(files: InboundAttachment[], sender: string): Promise<FiledAttachment[]> {
    const filed: FiledAttachment[] = [];
    for (const [index, file] of files.entries()) {
      const name = optionalText(file.name, 200) ?? `attachment-${index + 1}`;
      const docId = index < MAX_ATTACHMENTS ? await this.fileAttachment(file, name, sender) : null;
      filed.push({ name, docId });
    }
    return filed;
  }

  /** Stores one email attachment in R2 under 07 Correspondence and indexes its text. */
  private async fileAttachment(file: InboundAttachment, name: string, sender: string): Promise<string | null> {
    if (file.content.byteLength > MAX_ATTACHMENT_BYTES) {
      this.logActivity("doc", `Skipped attachment "${name}" from ${sender}: larger than 25 MB`);
      return null;
    }
    try {
      const mimeType = guessMime(name, file.mimeType);
      const r2Key = r2KeyFor(this.name, CORRESPONDENCE_FOLDER, name);
      await this.env.VAULT.put(r2Key, file.content, { httpMetadata: { contentType: mimeType } });
      const extracted = await extractText(file.content, mimeType, name);
      const doc = this.indexDocument(
        {
          folder: CORRESPONDENCE_FOLDER,
          name,
          mimeType,
          size: file.content.byteLength,
          r2Key,
          scope: "building",
          sample: false,
          uploadedBy: `email:${sender}`,
        },
        extracted.text,
        extracted.error != null,
      );
      this.logActivity("doc", `Filed attachment "${name}" from ${sender} (${indexNote(doc)})`, extracted.error, doc.id);
      return doc.id;
    } catch (err) {
      this.logActivity("error", `Could not file attachment "${name}" from ${sender}`, errorText(err));
      return null;
    }
  }

  // =========================================================================
  // Private: contacts, memory, seed
  // =========================================================================

  private contactRows(role?: ContactRole): Contact[] {
    const rows = role
      ? this.sql<ContactRow>`SELECT * FROM contacts WHERE role = ${role} ORDER BY CAST(lot AS INTEGER), lot, name`
      : this.sql<ContactRow>`SELECT * FROM contacts ORDER BY role, CAST(lot AS INTEGER), lot, name`;
    return rows.map(toContact);
  }

  private saveContact(input: ContactInput): Contact {
    const c = cleanContact(input);
    const now = nowIso();
    this.sql`INSERT INTO contacts (id, role, name, lot, email, phone, trade, after_hours, notes, sample, created_at,
        updated_at)
      VALUES (${c.id}, ${c.role}, ${c.name}, ${c.lot}, ${c.email}, ${c.phone}, ${c.trade}, ${c.afterHours ? 1 : 0},
        ${c.notes}, ${c.sample ? 1 : 0}, ${now}, ${now})
      ON CONFLICT(id) DO UPDATE SET role = excluded.role, name = excluded.name, lot = excluded.lot,
        email = excluded.email, phone = excluded.phone, trade = excluded.trade, after_hours = excluded.after_hours,
        notes = excluded.notes, sample = excluded.sample, updated_at = excluded.updated_at`;
    return c;
  }

  private insertMemory(text: string, source: string): MemoryNote {
    const note: MemoryNote = { id: crypto.randomUUID(), text, source, createdAt: nowIso() };
    this.sql`INSERT INTO memory (id, body, source, created_at) VALUES (${note.id}, ${note.text}, ${note.source},
      ${note.createdAt})`;
    return note;
  }

  private memoryNotes(): MemoryNote[] {
    return this.sql<MemoryRow>`SELECT * FROM memory ORDER BY created_at DESC, rowid DESC`.map(toMemory);
  }

  private async seedDocument(doc: PropertySeed["docs"][number]): Promise<boolean> {
    const exists = this.sql<{ id: string }>`SELECT id FROM docs WHERE folder = ${doc.folder} AND name = ${doc.name}`;
    if (exists.length) return false;
    const r2Key = `${this.name}/${doc.folder}/${doc.name}`;
    const bytes = new TextEncoder().encode(doc.text);
    try {
      await this.env.VAULT.put(r2Key, bytes, { httpMetadata: { contentType: "text/markdown; charset=utf-8" } });
    } catch (err) {
      this.logActivity("error", `Could not store "${doc.name}" in the vault (indexed anyway)`, errorText(err));
    }
    this.indexDocument(
      {
        folder: doc.folder,
        name: doc.name,
        mimeType: "text/markdown",
        size: bytes.byteLength,
        r2Key,
        scope: doc.scope,
        sample: doc.sample,
        uploadedBy: "seed",
      },
      doc.text,
    );
    return true;
  }

  private seedContact(contact: Omit<Contact, "id">): boolean {
    const exists = this.sql<{ id: string }>`SELECT id FROM contacts
      WHERE role = ${contact.role} AND lower(name) = ${contact.name.trim().toLowerCase()}`;
    if (exists.length) return false;
    this.saveContact(contact);
    return true;
  }

  private seedMemoryNote(text: string): boolean {
    const body = optionalText(text, 2000);
    if (!body || this.sql<{ id: string }>`SELECT id FROM memory WHERE body = ${body}`.length) return false;
    this.insertMemory(body, "seed");
    return true;
  }

  // =========================================================================
  // Private: chat
  // =========================================================================

  private async runChat(text: string, actor: string): Promise<ChatMessage> {
    this.insertChat({ role: "user", text, author: actor, toolCalls: [], citations: [] });
    this.logActivity("chat", `${actor} asked: ${truncate(text, 120)}`);
    this.touch();

    const reply = aiOnline(this.env) ? await this.answerWithClaude(text, actor) : this.offlineReply(text, OFFLINE_REASON);
    const answer = this.insertChat({ role: "assistant", author: null, ...reply });
    this.touch();
    return answer;
  }

  private async answerWithClaude(text: string, actor: string): Promise<ChatReply> {
    const history = this.loadHistory();
    const system = await this.chatSystemPrompt(history.length === 0);
    try {
      const result = await this.withBusy(`Thinking about "${truncate(text, 60)}"`, (status) =>
        runAgent(this.env, {
          system,
          history: [...history],
          userText: text,
          host: this,
          toolset: "chat",
          actor,
          onTool: (name, summary) => {
            status(toolLabel(name));
            this.logActivity("tool", `${name}: ${truncate(summary, 200)}`);
          },
        }),
      );
      this.saveHistory(historyUpdate(history, result.history));
      return {
        text: result.text,
        toolCalls: result.toolCalls.map(({ name, summary }) => ({ name, summary })),
        citations: result.citations,
      };
    } catch (err) {
      this.logActivity("error", "Claude request failed during chat", errorText(err));
      return this.offlineReply(text, `The AI request failed (${errorText(err)}), so this is a plain document search instead.`);
    }
  }

  private offlineReply(text: string, reason: string): ChatReply {
    const hits = this.searchIndex(text, 5);
    return {
      ...offlineAnswer(reason, hits),
      toolCalls: [{ name: "search_documents", summary: `${hits.length} result(s) for "${truncate(text, 60)}"` }],
    };
  }

  /** The system prompt is fixed for a conversation (prompt caching and append-only history) until resetChat. */
  private async chatSystemPrompt(newConversation: boolean): Promise<string> {
    const stored = this.getMeta("chat_system");
    if (stored && !newConversation) return stored;
    const prompt = await propertySystemPrompt(this.profile(), this.companyName(), this.memoryNotes());
    this.setMeta("chat_system", prompt);
    return prompt;
  }

  private loadHistory(): unknown[] {
    return this.sql<{ message: string }>`SELECT message FROM llm_history ORDER BY seq`
      .map((row) => parseJson<unknown>(row.message, null))
      .filter((entry) => entry !== null);
  }

  /** Appends the turn's messages (or replaces the stored copy when runAgent restarted the conversation). */
  private saveHistory(update: { replace: boolean; entries: unknown[] }): void {
    if (!update.replace && update.entries.length === 0) return;
    const now = nowIso();
    try {
      // All-or-nothing so a turn's tool_use/tool_result pairs are never split.
      this.ctx.storage.transactionSync(() => {
        if (update.replace) this.sql`DELETE FROM llm_history`;
        for (const entry of update.entries) {
          this.sql`INSERT INTO llm_history (message, created_at) VALUES (${JSON.stringify(entry)}, ${now})`;
        }
      });
      if (update.replace) this.logActivity("chat", "Conversation memory restarted: Claude rejected the stored history");
    } catch (err) {
      this.logActivity("error", "Could not save this chat turn to the agent's conversation memory", errorText(err));
    }
  }

  private insertChat(entry: Omit<ChatMessage, "id" | "createdAt">): ChatMessage {
    const message: ChatMessage = { ...entry, id: crypto.randomUUID(), createdAt: nowIso() };
    this.sql`INSERT INTO chat (id, role, body, author, tool_calls, citations, created_at)
      VALUES (${message.id}, ${message.role}, ${message.text}, ${message.author}, ${JSON.stringify(message.toolCalls)},
        ${JSON.stringify(message.citations)}, ${message.createdAt})`;
    return message;
  }

  // =========================================================================
  // Private: live state, busy indicator, activity
  // =========================================================================

  /** Recomputes counts and recent activity, bumps `version` and broadcasts. Call after every mutation. */
  private touch(): void {
    this.syncState(true);
  }

  private syncState(bumpVersion: boolean): void {
    const current = this.state;
    this.setState({
      profile: this.storedProfile(),
      counts: this.computeCounts(),
      aiOnline: aiOnline(this.env),
      busy: this.busyState(),
      recentActivity: this.recentActivity(RECENT_ACTIVITY),
      version: (current?.version ?? 0) + (bumpVersion ? 1 : 0),
      updatedAt: bumpVersion ? nowIso() : (current?.updatedAt ?? null),
    });
  }

  private busyState(): PropertyState["busy"] {
    const job = this.busyJobs.at(-1);
    return job ? { active: true, label: job.label, since: job.since } : { active: false, label: null, since: null };
  }

  /** Shows `label` as the agent's busy state while `fn` runs; `status` updates the label mid-way. */
  private async withBusy<T>(label: string, fn: (status: (label: string) => void) => Promise<T>): Promise<T> {
    const job: BusyJob = { label, since: nowIso() };
    this.busyJobs.push(job);
    this.syncState(false);
    try {
      return await fn((next) => {
        job.label = next;
        this.syncState(false);
      });
    } finally {
      this.busyJobs = this.busyJobs.filter((j) => j !== job);
      this.syncState(false);
    }
  }

  /** Runs `fn` after any earlier work queued under the same key has settled. */
  private serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.locks.set(key, tail);
    void tail.then(() => {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    });
    return run;
  }

  private logActivity(kind: ActivityKind, summary: string, detail: string | null = null, ref: string | null = null): void {
    this.sql`INSERT INTO activity (id, at, kind, summary, detail, ref)
      VALUES (${crypto.randomUUID()}, ${nowIso()}, ${kind}, ${truncate(summary, 300)},
        ${detail ? truncate(detail, 4000) : null}, ${ref})`;
    this.sql`DELETE FROM activity WHERE rowid <= (SELECT MAX(rowid) FROM activity) - ${ACTIVITY_RETENTION}`;
  }

  private recentActivity(limit: number): ActivityEvent[] {
    return this.sql<ActivityRow>`SELECT * FROM activity ORDER BY at DESC, rowid DESC LIMIT ${limit}`.map(toActivity);
  }

  private computeCounts(): PropertyCounts {
    const row = this.sql<CountsRow>`SELECT
      (SELECT COUNT(*) FROM threads WHERE status != 'closed') AS open_threads,
      (SELECT COUNT(*) FROM threads WHERE status != 'closed' AND priority = 'P1') AS p1_open,
      (SELECT COUNT(*) FROM approvals WHERE status = 'pending') AS pending_approvals,
      (SELECT COUNT(*) FROM tickets WHERE status != 'done') AS open_tickets,
      (SELECT COUNT(*) FROM docs) AS docs,
      (SELECT COUNT(*) FROM contacts) AS contacts`[0];
    if (!row) return EMPTY_COUNTS;
    return {
      openThreads: row.open_threads,
      p1Open: row.p1_open,
      pendingApprovals: row.pending_approvals,
      openTickets: row.open_tickets,
      docs: row.docs,
      contacts: row.contacts,
    };
  }

  // =========================================================================
  // Private: meta, profile and row access
  // =========================================================================

  private getMeta(key: string): string | null {
    return this.sql<{ value: string }>`SELECT value FROM meta WHERE key = ${key}`[0]?.value ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.sql`INSERT INTO meta (key, value) VALUES (${key}, ${value})
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`;
  }

  private storedProfile(): PropertyProfile | null {
    return parseJson<PropertyProfile | null>(this.getMeta("profile"), null);
  }

  /** The stored profile, or a clearly-marked placeholder so mail that arrives before init() still works. */
  private profile(): PropertyProfile {
    return this.storedProfile() ?? placeholderProfile(this.name, addressForProperty(this.env, this.name));
  }

  private companyName(): string {
    return this.env.COMPANY_NAME || "Ikon Strata Management";
  }

  /** Dynamic SQL (IN lists, optional filters); static queries use this.sql. */
  private rows<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: SqlValue[]): T[] {
    return this.ctx.storage.sql.exec<T>(query, ...bindings).toArray();
  }

  private selectThreads(tail: string, ...bindings: SqlValue[]): Thread[] {
    return this.rows<ThreadRow>(`SELECT * FROM threads ${tail}`, ...bindings).map(toThread);
  }

  private selectApprovals(tail: string, ...bindings: SqlValue[]): Approval[] {
    return this.rows<ApprovalRow>(`SELECT * FROM approvals ${tail}`, ...bindings).map((r) => toApproval(r, this.name));
  }

  private selectTickets(tail: string, ...bindings: SqlValue[]): Ticket[] {
    return this.rows<TicketRow>(`SELECT * FROM tickets ${tail}`, ...bindings).map(toTicket);
  }

  private selectDocs(tail: string, ...bindings: SqlValue[]): DocMeta[] {
    return this.rows<DocRow>(`SELECT ${DOC_COLUMNS} FROM docs ${tail}`, ...bindings).map(toDoc);
  }

  private findThread(id: string): Thread | null {
    return this.selectThreads("WHERE id = ?", id)[0] ?? null;
  }

  private requireThread(id: string): Thread {
    const thread = this.findThread(id);
    if (!thread) throw new Error("Thread not found");
    return thread;
  }

  private findApproval(id: string): Approval | null {
    return this.selectApprovals("WHERE id = ?", id)[0] ?? null;
  }

  private requireApproval(id: string): Approval {
    const approval = this.findApproval(id);
    if (!approval) throw new Error("Approval not found");
    return approval;
  }

  private findTicket(id: string): Ticket | null {
    return this.selectTickets("WHERE id = ?", id)[0] ?? null;
  }

  private findDoc(id: string): DocMeta | null {
    return this.selectDocs("WHERE id = ?", id)[0] ?? null;
  }

  private findContact(id: string): Contact | null {
    const row = this.sql<ContactRow>`SELECT * FROM contacts WHERE id = ${id}`[0];
    return row ? toContact(row) : null;
  }
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function indexNote(doc: DocMeta): string {
  if (doc.indexed === "full") return `${doc.chars.toLocaleString("en-AU")} characters indexed`;
  if (doc.indexed === "failed") return "text extraction failed; name and folder searchable";
  return "no text; name and folder searchable";
}
