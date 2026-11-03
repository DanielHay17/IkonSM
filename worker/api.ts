// The Worker's HTTP surface (BUILD_SPEC Module E): the authenticated /api/* JSON API and the
// read-only agent websockets on /agents/*. Mutations reach the agents over Durable Object RPC
// with the signed-in staff member as the actor; the browser never calls agent methods directly.

import { getAgentByName, routeAgentRequest, type AgentOptions } from "agents";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  ASSIGNEE_ROLES,
  CATEGORIES,
  VAULT_FOLDERS,
  type ApprovalStatus,
  type Channel,
  type ContactRole,
  type Priority,
  type ThreadStatus,
  type TicketStatus,
} from "../shared/types";
import type { PropertyAgent } from "./agents/property-agent";
import { authRoutes, requireStaff, staffFromRequest } from "./auth";
import { extractText } from "./docs/extract";
import { guessMime, r2KeyFor } from "./docs/vault";
import {
  apiResponseHeaders,
  badRequest,
  contentDisposition,
  formatBytes,
  handleError,
  notFound,
  readJson,
  requestGuard,
  validate,
  type AppEnv,
  type AppVariables,
} from "./http";
import { PORTFOLIO_IDS } from "./seed/portfolio";

// ---------------------------------------------------------------------------
// Limits and constants
// ---------------------------------------------------------------------------

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MAX_JSON_BYTES = 256 * 1024;
const DEFAULT_FOLDER = "07 Correspondence" satisfies VaultFolder;
const CHIEF_OF_STAFF_NAME = "main";

const PUBLIC_API_PATHS = new Set(["/api/health", "/api/session", "/api/login"]);
const UPLOAD_PATH = /^\/api\/properties\/[^/]+\/docs$/;
const PROPERTY_ID = /^sp-\d{3,6}$/;
const RECORD_ID = /^[\w.:-]{1,100}$/;
const KNOWN_PROPERTY_IDS = new Set(PORTFOLIO_IDS);

type VaultFolder = (typeof VAULT_FOLDERS)[number];
type PropertyStub = DurableObjectStub<PropertyAgent>;
type PropertyEnv = { Bindings: Env; Variables: AppVariables & { propertyId: string; agent: PropertyStub } };
type AgentRouteGuard = NonNullable<AgentOptions<Env>["onBeforeConnect"]>;

// ---------------------------------------------------------------------------
// Enumerations not exported as lists by shared/types (checked for completeness at compile time)
// ---------------------------------------------------------------------------

type Covers<List extends readonly string[], Union extends string> = [Exclude<Union, List[number]>] extends [never]
  ? true
  : false;

const CHANNELS = ["email", "sms", "portal", "phone", "staff"] as const satisfies readonly Channel[];
const THREAD_STATUSES = ["new", "triaged", "awaiting_approval", "replied", "closed"] as const satisfies readonly ThreadStatus[];
const APPROVAL_STATUSES = ["pending", "approved", "rejected", "failed"] as const satisfies readonly ApprovalStatus[];
const TICKET_STATUSES = ["new", "assigned", "in_progress", "waiting", "done"] as const satisfies readonly TicketStatus[];
const PRIORITIES = ["P1", "P2", "P3"] as const satisfies readonly Priority[];
const CONTACT_ROLES = [
  "owner",
  "tenant",
  "council",
  "contractor",
  "insurer",
  "property_manager",
  "staff",
  "other",
] as const satisfies readonly ContactRole[];

/** Fails to compile if a list above is missing a member of its union. */
type AssertAll<T extends true[]> = T;
type EnumListsAreComplete = AssertAll<
  [
    Covers<typeof CHANNELS, Channel>,
    Covers<typeof THREAD_STATUSES, ThreadStatus>,
    Covers<typeof APPROVAL_STATUSES, ApprovalStatus>,
    Covers<typeof TICKET_STATUSES, TicketStatus>,
    Covers<typeof PRIORITIES, Priority>,
    Covers<typeof CONTACT_ROLES, ContactRole>,
  ]
>;

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const EMAIL_ADDRESS = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

const requiredText = (max: number) => z.string().trim().min(1, "Required").max(max);

/** Optional text for patches: absent → undefined (unchanged), null or blank → null (cleared). */
const clearableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === undefined ? undefined : value || null));

/** Text that is always stored, null when absent or blank. */
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

const clearableDate = z
  .string()
  .trim()
  .max(64)
  .nullish()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (!value) return null;
    const time = Date.parse(value);
    if (Number.isNaN(time)) {
      ctx.addIssue({ code: "custom", message: "Invalid date" });
      return z.NEVER;
    }
    return new Date(time).toISOString();
  });

/** Optional field where the client may send null for "not given". */
const omittable = <S extends z.ZodType>(schema: S) =>
  schema.nullish().transform((value) => value ?? undefined);

/** Field with a default when absent or null. */
const withDefault = <S extends z.ZodType>(schema: S, fallback: NonNullable<z.output<S>>) =>
  schema.nullish().transform((value) => value ?? fallback);

/** Query parameters: "" behaves like an absent parameter. */
const optionalQuery = <S extends z.ZodType>(schema: S) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const chatSchema = z.object({ text: requiredText(4000) });
const memorySchema = z.object({ text: requiredText(2000) });
const draftSchema = z.object({ instructions: nullableText(4000) });

const simulateSchema = z
  .object({
    channel: withDefault(z.enum(CHANNELS), "email"),
    fromName: nullableText(200),
    fromAddress: requiredText(254),
    subject: withDefault(z.string().trim().max(300), ""),
    text: requiredText(20_000),
  })
  .refine((input) => input.channel !== "email" || EMAIL_ADDRESS.test(input.fromAddress), {
    message: "Must be an email address for the email channel",
    path: ["fromAddress"],
  });

const decisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  edits: omittable(
    z.object({
      subject: omittable(requiredText(300)),
      body: omittable(z.string().max(20_000).refine((body) => body.trim().length > 0, "Required")),
    }),
  ),
  note: omittable(z.string().trim().max(2000)),
});

const ticketFields = {
  title: requiredText(200),
  description: z.string().trim().max(10_000),
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  assigneeRole: z.enum(ASSIGNEE_ROLES),
  assigneeName: clearableText(120),
  contractorId: clearableText(100),
  threadId: clearableText(100),
  dueAt: clearableDate,
};
const ticketCreateSchema = z.object({ ...ticketFields, description: withDefault(ticketFields.description, "") });
const ticketPatchSchema = z
  .object(ticketFields)
  .partial()
  .extend({ status: z.enum(TICKET_STATUSES).optional() });

const contactSchema = z.object({
  role: z.enum(CONTACT_ROLES),
  name: requiredText(200),
  lot: nullableText(50),
  email: nullableText(254).refine((email) => email === null || EMAIL_ADDRESS.test(email), "Invalid email address"),
  phone: nullableText(50),
  trade: nullableText(100),
  afterHours: withDefault(z.boolean(), false),
  notes: nullableText(2000),
  sample: withDefault(z.boolean(), false),
});

const threadsQuery = z.object({ status: optionalQuery(z.enum([...THREAD_STATUSES, "open"])) });
const approvalsQuery = z.object({ status: optionalQuery(z.enum(APPROVAL_STATUSES)) });
const contactsQuery = z.object({ role: optionalQuery(z.enum(CONTACT_ROLES)) });
const activityQuery = z.object({ limit: optionalQuery(z.coerce.number().int().min(1).max(500)) });
const searchQuery = z.object({
  q: z.string().trim().max(500).default(""),
  limit: optionalQuery(z.coerce.number().int().min(1).max(50)),
});

// ---------------------------------------------------------------------------
// Agent access
// ---------------------------------------------------------------------------

function chiefOfStaff(env: Env) {
  return getAgentByName(env.ChiefOfStaffAgent, CHIEF_OF_STAFF_NAME);
}

/** Set once this isolate has seen ensureSeeded succeed; it is idempotent, so a stale flag is harmless. */
let portfolioSeeded = false;

/**
 * Makes sure every building agent has its profile and seed data before it is used.
 * Cheap after the first success in an isolate. Never shares an in-flight promise across requests.
 */
async function ensurePortfolio(env: Env): Promise<void> {
  if (portfolioSeeded) return;
  await (await chiefOfStaff(env)).ensureSeeded();
  portfolioSeeded = true;
}

/** Best-effort ensurePortfolio for paths that can still work with an unseeded agent. */
export async function ensurePortfolioQuietly(env: Env, context: string): Promise<void> {
  try {
    await ensurePortfolio(env);
  } catch (err) {
    console.error(`Portfolio seeding failed (${context}):`, err);
  }
}

function isPortfolioProperty(id: string): boolean {
  return PROPERTY_ID.test(id) && KNOWN_PROPERTY_IDS.has(id);
}

/** A path id (thread, approval, doc, ...) that could exist; anything else cannot, so 404. */
function recordId(value: string | undefined): string {
  if (!value || !RECORD_ID.test(value)) throw notFound();
  return value;
}

// ---------------------------------------------------------------------------
// /api/properties/:id/*
// ---------------------------------------------------------------------------

const property = new Hono<PropertyEnv>();

property.use("*", async (c, next) => {
  const id = c.req.param("id") ?? "";
  if (!isPortfolioProperty(id)) throw notFound("Unknown property");
  await ensurePortfolioQuietly(c.env, `property ${id}`);
  c.set("propertyId", id);
  c.set("agent", await getAgentByName(c.env.PropertyAgent, id));
  await next();
});

property.get("/", async (c) => c.json(await c.var.agent.getOverview()));

// Threads ------------------------------------------------------------------

property.get("/threads", async (c) => {
  const { status } = validate(threadsQuery, c.req.query());
  return c.json(await c.var.agent.listThreads(status ? { status } : {}));
});

property.get("/threads/:tid", async (c) => {
  const detail = await c.var.agent.getThread(recordId(c.req.param("tid")));
  if (!detail) throw notFound("Thread not found");
  return c.json(detail);
});

property.post("/threads/:tid/retriage", async (c) => c.json(await c.var.agent.retriage(recordId(c.req.param("tid")))));

property.post("/threads/:tid/draft", async (c) => {
  const threadId = recordId(c.req.param("tid"));
  const { instructions } = await readJson(c, draftSchema);
  return c.json(await c.var.agent.draftReply(threadId, instructions, c.var.staffName), 201);
});

property.post("/threads/:tid/close", async (c) => {
  await c.var.agent.closeThread(recordId(c.req.param("tid")), c.var.staffName);
  return c.json({ ok: true });
});

property.post("/simulate", async (c) => {
  const input = await readJson(c, simulateSchema);
  const result = await c.var.agent.ingestMessage({ ...input, simulated: true }, { process: "now" });
  return c.json(result, 201);
});

// Approvals ----------------------------------------------------------------

property.get("/approvals", async (c) => {
  const { status } = validate(approvalsQuery, c.req.query());
  return c.json(await c.var.agent.listApprovals(status));
});

property.post("/approvals/:aid", async (c) => {
  const approvalId = recordId(c.req.param("aid"));
  const decision = await readJson(c, decisionSchema);
  return c.json(await c.var.agent.decideApproval(approvalId, decision, c.var.staffName));
});

// Work orders --------------------------------------------------------------

property.get("/tickets", async (c) => c.json(await c.var.agent.listTickets()));

property.post("/tickets", async (c) => {
  const input = await readJson(c, ticketCreateSchema);
  return c.json(await c.var.agent.createTicket(input, c.var.staffName), 201);
});

property.patch("/tickets/:tkid", async (c) => {
  const ticketId = recordId(c.req.param("tkid"));
  const patch = await readJson(c, ticketPatchSchema);
  return c.json(await c.var.agent.updateTicket(ticketId, patch, c.var.staffName));
});

// Documents ----------------------------------------------------------------

property.get("/docs", async (c) => c.json(await c.var.agent.listDocs()));

property.post("/docs", async (c) => {
  const form = await readForm(c);
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Attach the document as the 'file' field");
  if (file.size === 0) throw badRequest("The file is empty");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new HTTPException(413, { message: `Files must be ${formatBytes(MAX_UPLOAD_BYTES)} or smaller` });
  }

  const folder = vaultFolder(form.get("folder"));
  const name = displayFileName(file.name);
  const mimeType = guessMime(name, file.type);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extracted = await extractText(bytes, mimeType, name);
  if (extracted.error) console.warn(`Text extraction failed for "${name}" (${extracted.method}): ${extracted.error}`);

  const { propertyId, agent, staffName } = c.var;
  const r2Key = r2KeyFor(propertyId, folder, name);
  await c.env.VAULT.put(r2Key, bytes, { httpMetadata: { contentType: mimeType }, customMetadata: { propertyId } });
  try {
    const doc = await agent.addDocument(
      { folder, name, mimeType, size: bytes.byteLength, r2Key, scope: "building", sample: false, uploadedBy: staffName },
      extracted.text,
    );
    return c.json(doc, 201);
  } catch (err) {
    await deleteVaultObject(c.env, r2Key);
    throw err;
  }
});

property.get("/docs/:docId/download", async (c) => {
  const doc = await c.var.agent.getDocument(recordId(c.req.param("docId")));
  if (!doc || !isOwnKey(c.var.propertyId, doc.meta.r2Key)) throw notFound("Document not found");
  const object = await c.env.VAULT.get(doc.meta.r2Key);
  if (!object) throw notFound("The file is missing from the vault");

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || doc.meta.mimeType || "application/octet-stream",
      "Content-Disposition": contentDisposition(doc.meta.name),
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
      ETag: object.httpEtag,
    },
  });
});

property.get("/docs/:docId/text", async (c) => {
  const doc = await c.var.agent.getDocument(recordId(c.req.param("docId")));
  if (!doc) throw notFound("Document not found");
  return c.json(doc);
});

property.delete("/docs/:docId", async (c) => {
  const doc = await c.var.agent.deleteDocument(recordId(c.req.param("docId")), c.var.staffName);
  if (!doc) throw notFound("Document not found");
  if (isOwnKey(c.var.propertyId, doc.r2Key)) await deleteVaultObject(c.env, doc.r2Key);
  return c.json({ ok: true });
});

property.get("/search", async (c) => {
  const { q, limit } = validate(searchQuery, c.req.query());
  return c.json(q ? await c.var.agent.searchDocs(q, limit) : []);
});

// Contacts -----------------------------------------------------------------

property.get("/contacts", async (c) => {
  const { role } = validate(contactsQuery, c.req.query());
  return c.json(await c.var.agent.listContacts(role));
});

property.post("/contacts", async (c) => {
  const contact = await readJson(c, contactSchema);
  return c.json(await c.var.agent.upsertContact(contact, c.var.staffName), 201);
});

property.put("/contacts/:cid", async (c) => {
  const id = recordId(c.req.param("cid"));
  const contact = await readJson(c, contactSchema);
  return c.json(await c.var.agent.upsertContact({ ...contact, id }, c.var.staffName));
});

property.delete("/contacts/:cid", async (c) => {
  await c.var.agent.deleteContact(recordId(c.req.param("cid")), c.var.staffName);
  return c.json({ ok: true });
});

// Chat, activity, memory ---------------------------------------------------

property.get("/chat", async (c) => c.json(await c.var.agent.getChat()));

property.post("/chat", async (c) => {
  const { text } = await readJson(c, chatSchema);
  return c.json(await c.var.agent.chat(text, c.var.staffName));
});

property.delete("/chat", async (c) => {
  await c.var.agent.resetChat(c.var.staffName);
  return c.json({ ok: true });
});

property.get("/activity", async (c) => {
  const { limit } = validate(activityQuery, c.req.query());
  return c.json(await c.var.agent.listActivity(limit ?? 50));
});

property.get("/memory", async (c) => c.json(await c.var.agent.listMemory()));

property.post("/memory", async (c) => {
  const { text } = await readJson(c, memorySchema);
  return c.json(await c.var.agent.addMemory(text, `staff:${c.var.staffName}`), 201);
});

property.delete("/memory/:mid", async (c) => {
  await c.var.agent.deleteMemory(recordId(c.req.param("mid")));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// /api/*
// ---------------------------------------------------------------------------

const api = new Hono<AppEnv>();

api.use("*", apiResponseHeaders);
api.use(
  "*",
  requestGuard({
    isUpload: (c) => c.req.method === "POST" && UPLOAD_PATH.test(c.req.path),
    maxJsonBytes: MAX_JSON_BYTES,
    maxUploadBytes: MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES,
  }),
);
api.use("*", (c, next) => (PUBLIC_API_PATHS.has(c.req.path) ? next() : requireStaff(c, next)));

api.get("/health", (c) => c.json({ ok: true }));
api.route("/", authRoutes);

// Portfolio and Chief of Staff ---------------------------------------------

api.get("/portfolio", async (c) => {
  const cos = await chiefOfStaff(c.env);
  await cos.ensureSeeded();
  portfolioSeeded = true;
  return c.json(await cos.listProperties());
});

api.get("/brief", async (c) => c.json(await (await chiefOfStaff(c.env)).getBrief()));

api.post("/brief/refresh", async (c) => c.json(await (await chiefOfStaff(c.env)).refreshBrief()));

api.get("/approvals", async (c) => c.json(await (await chiefOfStaff(c.env)).portfolioApprovals()));

api.get("/cos/chat", async (c) => c.json(await (await chiefOfStaff(c.env)).getChat()));

api.post("/cos/chat", async (c) => {
  const { text } = await readJson(c, chatSchema);
  return c.json(await (await chiefOfStaff(c.env)).chat(text, c.var.staffName));
});

api.delete("/cos/chat", async (c) => {
  await (await chiefOfStaff(c.env)).resetChat(c.var.staffName);
  return c.json({ ok: true });
});

api.route("/properties/:id", property);

// ---------------------------------------------------------------------------
// App: /api/* plus the agents' live-state websockets on /agents/*
// ---------------------------------------------------------------------------

export const app = new Hono<AppEnv>();

app.route("/api", api);

app.all("/agents/*", async (c) => {
  // Resolved before routing because the hooks only see the request, not the Hono context.
  const staffName = await staffFromRequest(c.env, c.req.raw);
  const guard: AgentRouteGuard = (_request, route) => rejectAgentRoute(staffName, route.className, route.name);
  const response = await routeAgentRequest(c.req.raw, c.env, { onBeforeConnect: guard, onBeforeRequest: guard });
  return response ?? c.json({ error: "Not found" }, 404);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError(handleError);

/** Only signed-in staff, only our two agent classes, and only real instances (no agents created on demand). */
function rejectAgentRoute(staffName: string | null, className: string, name: string): Response | undefined {
  if (!staffName) return Response.json({ error: "Sign in required" }, { status: 401 });
  const known =
    (className === "PropertyAgent" && isPortfolioProperty(name)) ||
    (className === "ChiefOfStaffAgent" && name === CHIEF_OF_STAFF_NAME);
  return known ? undefined : Response.json({ error: "Not found" }, { status: 404 });
}

// ---------------------------------------------------------------------------
// Upload and vault helpers
// ---------------------------------------------------------------------------

async function readForm(c: Context): Promise<FormData> {
  try {
    return await c.req.formData();
  } catch {
    throw badRequest("Upload must be a valid multipart/form-data body");
  }
}

function vaultFolder(value: File | string | null): VaultFolder {
  if (value === null || value === "") return DEFAULT_FOLDER;
  const folder = typeof value === "string" ? VAULT_FOLDERS.find((f) => f === value.trim()) : undefined;
  if (!folder) throw badRequest(`folder must be one of: ${VAULT_FOLDERS.join(", ")}`);
  return folder;
}

/** The name shown in the vault: the original file name without any path or control characters. */
function displayFileName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? "";
  const clean = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.slice(0, 200) || "upload";
}

/** Vault keys are prefixed with the property id; never touch another building's objects. */
function isOwnKey(propertyId: string, r2Key: string): boolean {
  return r2Key.startsWith(`${propertyId}/`);
}

/** The index entry is already gone; an orphaned object only costs storage, so log instead of failing. */
async function deleteVaultObject(env: Env, r2Key: string): Promise<void> {
  try {
    await env.VAULT.delete(r2Key);
  } catch (err) {
    console.error(`Could not delete vault object ${r2Key}:`, err);
  }
}
