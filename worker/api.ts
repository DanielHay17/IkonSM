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
import { CHIEF_OF_STAFF_NAME, engineAvailable } from "./ai/switch";
import { authRoutes, requireStaff, sessionWithSwitch, staffFromRequest } from "./auth";
import { deleteVaultObject, fileStaffDocument, MAX_UPLOAD_BYTES, type VaultFolder } from "./docs/filing";
import { CALLBACK_PATH } from "./integrations/onedrive-oauth";
import { importFromOneDrive, onedriveRoutes } from "./integrations/onedrive-routes";
import {
  apiResponseHeaders,
  badRequest,
  contentDisposition,
  formatBytes,
  handleError,
  notFound,
  readJson,
  requestGuard,
  requireBrowserOrigin,
  validate,
  type AppEnv,
  type PropertyEnv,
} from "./http";
import { DEMO_SCENARIO } from "./seed/demo";
import { PORTFOLIO_IDS } from "./seed/portfolio";

// ---------------------------------------------------------------------------
// Limits and constants
// ---------------------------------------------------------------------------

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MAX_JSON_BYTES = 256 * 1024;
const DEFAULT_FOLDER = "07 Correspondence" satisfies VaultFolder;


/** No session needed. The OAuth callback is a top-level redirect from Microsoft and checks the session itself. */
const PUBLIC_API_PATHS = new Set(["/api/health", "/api/session", "/api/login", CALLBACK_PATH]);
const UPLOAD_PATH = /^\/api\/properties\/[^/]+\/docs$/;
const PROPERTY_ID = /^sp-\d{3,6}$/;
const RECORD_ID = /^[\w.:-]{1,100}$/;
const KNOWN_PROPERTY_IDS = new Set(PORTFOLIO_IDS);

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
const aiSwitchSchema = z.union([z.object({ engine: z.enum(["off", "workers-ai", "claude"]) }), z.object({ on: z.boolean() })]);
const memorySchema = z.object({ text: requiredText(2000) });
const draftSchema = z.object({ instructions: nullableText(4000) });

const simulateSchema = z
  .object({
    channel: withDefault(z.enum(CHANNELS), "email"),
    fromName: nullableText(200),
    fromAddress: requiredText(254),
    subject: withDefault(z.string().trim().max(300), ""),
    text: requiredText(20_000),
    /** Start a fresh thread instead of joining one with the same sender and subject (the hub's Simulate panel). */
    newThread: withDefault(z.boolean(), false),
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
  // Only a complete run sets the flag: after a partial failure the next request retries.
  portfolioSeeded = await (await chiefOfStaff(env)).ensureSeeded();
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
  const { newThread, ...input } = await readJson(c, simulateSchema);
  const result = await c.var.agent.ingestMessage({ ...input, simulated: true }, { process: "now", newThread });
  return c.json(result, 201);
});

/** Demo reset: deletes this building's simulated threads with their drafts and work orders. */
property.post("/simulated/reset", async (c) => c.json(await c.var.agent.resetSimulated(c.var.staffName)));

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

  const { propertyId, agent, staffName } = c.var;
  const doc = await fileStaffDocument(c.env, propertyId, agent, {
    folder: vaultFolder(form.get("folder")),
    name: file.name,
    mimeType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
    uploadedBy: staffName,
  });
  return c.json(doc, 201);
});

property.get("/docs/:docId/download", async (c) => {
  const doc = await c.var.agent.getDocument(recordId(c.req.param("docId")));
  if (!doc || !isOwnKey(c.var.propertyId, doc.meta.r2Key)) throw notFound("Document not found");
  const object = await c.env.VAULT.get(doc.meta.r2Key);
  if (!object) throw notFound("The file is missing from storage");

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

/** Files chosen in the OneDrive / SharePoint picker, downloaded by the Worker and filed like an upload. */
property.post("/integrations/onedrive/import", requireBrowserOrigin, importFromOneDrive);

property.get("/search", async (c) => {
  const { q, limit } = validate(searchQuery, c.req.query());
  // The vault screen also lists emailed attachments (labelled there); the agents never treat them as records.
  return c.json(q ? await c.var.agent.searchDocs(q, limit, { includeEmailed: true }) : []);
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
  if (await cos.ensureSeeded()) portfolioSeeded = true;
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

// Hub settings and demo data ------------------------------------------------

/** The hub-wide AI switch: off is the rules engine and templates; on is the deployment's AI engine. */
api.post("/settings/ai", async (c) => {
  const body = await readJson(c, aiSwitchSchema);
  // { engine } picks one; { on } is the plain switch (on = the deployment's default engine).
  const choice = "engine" in body ? body.engine : body.on ? "default" : "off";
  if (choice !== "default" && choice !== "off" && !engineAvailable(c.env, choice)) {
    throw new HTTPException(400, { message: choice === "claude" ? "Claude isn't set up on this hub yet: add an ANTHROPIC_API_KEY secret or AI Gateway credits to the Worker." : "That AI engine isn't set up on this hub." });
  }
  await (await chiefOfStaff(c.env)).setAiChoice(choice, c.var.staffName);
  return c.json(await sessionWithSwitch(c.env, c.var.staffName));
});

/** Replaces the simulated messages in the demo buildings with a few days of SAMPLE activity. */
api.post("/demo/load", async (c) => {
  const cos = await chiefOfStaff(c.env);
  if (await cos.ensureSeeded()) portfolioSeeded = true;
  const results = await Promise.all(
    Object.entries(DEMO_SCENARIO).map(async ([id, items]) => ({
      propertyId: id,
      ...(await (await getAgentByName(c.env.PropertyAgent, id)).loadDemo(items, c.var.staffName)),
    })),
  );
  return c.json({ buildings: results });
});

/** Deletes simulated messages (with their drafts and work orders) in every building. Real mail is untouched. */
api.post("/demo/clear", async (c) => {
  if (await (await chiefOfStaff(c.env)).ensureSeeded()) portfolioSeeded = true;
  const results = await Promise.all(
    PORTFOLIO_IDS.map(async (id) => ({ propertyId: id, ...(await (await getAgentByName(c.env.PropertyAgent, id)).resetSimulated(c.var.staffName)) })),
  );
  return c.json({ buildings: results.filter((r) => r.threads > 0) });
});

// Microsoft 365 (OneDrive and SharePoint) ------------------------------------

api.route("/integrations/onedrive", onedriveRoutes);

api.route("/properties/:id", property);

// ---------------------------------------------------------------------------
// App: /api/* plus the agents' live-state websockets on /agents/*
// ---------------------------------------------------------------------------

export const app = new Hono<AppEnv>();

app.route("/api", api);

app.all("/agents/*", async (c) => {
  // Browsers always send Origin on websocket upgrades: only the hub's own pages may open the live-state sockets.
  const origin = c.req.header("Origin");
  if (origin !== undefined && origin !== new URL(c.req.url).origin) {
    return c.json({ error: "Cross-origin request blocked" }, 403);
  }
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

/** Vault keys are prefixed with the property id; never touch another building's objects. */
function isOwnKey(propertyId: string, r2Key: string): boolean {
  return r2Key.startsWith(`${propertyId}/`);
}
