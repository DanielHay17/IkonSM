// Staff routes for onboarding a new scheme (docs/ONBOARDING_SPEC.md, "API"): the staff register, the
// dashboard list, the hub-wide directories, and each building's onboarding project under
// /api/properties/:id/onboarding. All need a signed-in session; actions record c.var.staffName.

import { getAgentByName } from "agents";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { SECTION_KEYS, STAFF_DIRECTORY } from "../shared/onboarding";
import { DEFAULT_INVITE_DAYS, isCalendarDate, MAX_INVITE_DAYS, type OnboardingResult } from "./agents/onboarding";
import { CHIEF_OF_STAFF_NAME } from "./ai/switch";
import { notFound, readJson, type AppEnv, type PropertyEnv } from "./http";

const RECORD_ID = /^[\w.:-]{1,100}$/;
const EMAIL_ADDRESS = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const requiredText = (max: number) => z.string().trim().min(1, "Required").max(max);

/** Absent → undefined (unchanged); null or blank → null (cleared). */
const clearableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === undefined ? undefined : value || null));

/** Always stored: null when absent or blank. */
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

const ymd = z.string().trim().refine(isCalendarDate, "Must be a date (YYYY-MM-DD)");
const clearableDate = ymd.nullish().transform((value) => (value === undefined ? undefined : value || null));
const staffRef = z.string().trim().max(100).nullable().optional();
const email = z.string().trim().toLowerCase().max(254).regex(EMAIL_ADDRESS, "Invalid email address");

const createProjectSchema = z.object({
  name: nullableText(200).transform((v) => v ?? undefined),
  targetGoLiveDate: clearableDate,
});

const taskPatchSchema = z.object({
  status: z.enum(["open", "done", "excluded", "cancelled"]).optional(),
  ownerId: staffRef,
  dueDate: clearableDate,
  note: clearableText(2000),
});

const sectionPatchSchema = z.object({ ownerId: staffRef, approverId: staffRef });

const sectionReviewSchema = z.object({
  decision: z.enum(["reviewed", "changes_requested", "not_reviewed"]),
  note: nullableText(2000),
});

const handoverPatchSchema = z.object({
  status: z.enum(["verified", "rejected", "not_applicable", "awaiting_supply"]),
  reviewNote: nullableText(2000),
});

const goLivePatchSchema = z.object({
  status: z.enum(["open", "verified", "not_applicable"]),
  note: clearableText(2000),
});

const approvalSchema = z.object({ note: nullableText(2000) });
const emptySchema = z.object({}).passthrough();

const inviteSchema = z.object({
  incomingManagerId: requiredText(100),
  outgoingManager: z.object({
    company: requiredText(200),
    name: requiredText(200),
    email,
    phone: nullableText(50),
  }),
  handoverDate: ymd,
  recordsDueDate: ymd,
});

const activateSchema = z.object({
  expiresInDays: z.number().int().min(1).max(MAX_INVITE_DAYS).nullish().transform((v) => v ?? DEFAULT_INVITE_DAYS),
});

const companySchema = z.object({
  name: requiredText(200),
  abn: nullableText(20).refine((abn) => abn === null || /^\d{11}$/.test(abn.replace(/\s+/g, "")), "ABN must be 11 digits"),
  phone: nullableText(50),
  email: email.nullish().transform((v) => v || null),
  website: nullableText(300),
  address: nullableText(300),
  notes: nullableText(2000),
});

const managerSchema = z.object({
  companyId: nullableText(100),
  name: requiredText(200),
  email,
  phone: nullableText(50),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recordId(value: string | undefined): string {
  if (!value || !RECORD_ID.test(value)) throw notFound();
  return value;
}

function sectionKey(value: string | undefined): string {
  if (!value || !(SECTION_KEYS as readonly string[]).includes(value)) throw notFound("Section not found");
  return value;
}

/** A failed agent result becomes an HTTP error with its status and message. */
export function unwrap<T>(result: OnboardingResult<T>): T {
  if (result.ok) return result.value;
  throw new HTTPException(result.status, { message: result.error });
}

/** Where the handover link points: the hub's public URL, or this request's origin (always on localhost). */
export function publicBaseUrl(c: { env: Env; req: { url: string } }): string {
  const origin = new URL(c.req.url);
  const local = LOCAL_HOSTNAMES.has(origin.hostname) || origin.hostname.endsWith(".localhost");
  const configured = c.env.PUBLIC_URL?.trim();
  return !local && configured ? configured.replace(/\/+$/, "") : origin.origin;
}

function chiefOfStaff(env: Env) {
  return getAgentByName(env.ChiefOfStaffAgent, CHIEF_OF_STAFF_NAME);
}

// ---------------------------------------------------------------------------
// Hub-wide: /api/staff, /api/onboarding, /api/directory/*
// ---------------------------------------------------------------------------

export const onboardingHubRoutes = new Hono<AppEnv>();

onboardingHubRoutes.get("/staff", (c) => c.json(STAFF_DIRECTORY));

onboardingHubRoutes.get("/onboarding", async (c) => {
  const cos = await chiefOfStaff(c.env);
  await cos.ensureSeeded();
  return c.json(await cos.listOnboarding());
});

onboardingHubRoutes.get("/directory/companies", async (c) => c.json(await (await chiefOfStaff(c.env)).listCompanies()));

onboardingHubRoutes.post("/directory/companies", async (c) => {
  const input = await readJson(c, companySchema);
  const abn = input.abn ? input.abn.replace(/\s+/g, "").replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3 $4") : null;
  return c.json(unwrap(await (await chiefOfStaff(c.env)).addCompany({ ...input, abn }, c.var.staffName)), 201);
});

onboardingHubRoutes.get("/directory/outgoing-managers", async (c) => c.json(await (await chiefOfStaff(c.env)).listOutgoingManagers()));

onboardingHubRoutes.post("/directory/outgoing-managers", async (c) => {
  const input = await readJson(c, managerSchema);
  return c.json(unwrap(await (await chiefOfStaff(c.env)).addOutgoingManager(input, c.var.staffName)), 201);
});

// ---------------------------------------------------------------------------
// One building: /api/properties/:id/onboarding/*
// ---------------------------------------------------------------------------

export const onboardingRoutes = new Hono<PropertyEnv>();

onboardingRoutes.get("/", async (c) => {
  const detail = await c.var.agent.getOnboarding();
  if (!detail) throw notFound("This building has no onboarding project");
  return c.json(detail);
});

/** The project without its detail, or null (200 either way): for the building header's "Onboarding 37%" chip. */
onboardingRoutes.get("/summary", async (c) => c.json(await c.var.agent.getOnboardingSummary()));

onboardingRoutes.post("/", async (c) => {
  const input = await readJson(c, createProjectSchema);
  return c.json(unwrap(await c.var.agent.createOnboarding(input, c.var.staffName)), 201);
});

onboardingRoutes.post("/tasks/:taskId", async (c) => {
  const taskId = recordId(c.req.param("taskId"));
  const patch = await readJson(c, taskPatchSchema);
  return c.json(unwrap(await c.var.agent.updateOnboardingTask(taskId, patch, c.var.staffName)));
});

onboardingRoutes.post("/sections/:key/review", async (c) => {
  const key = sectionKey(c.req.param("key"));
  const input = await readJson(c, sectionReviewSchema);
  return c.json(unwrap(await c.var.agent.reviewOnboardingSection(key, input, c.var.staffName)));
});

onboardingRoutes.post("/sections/:key", async (c) => {
  const key = sectionKey(c.req.param("key"));
  const patch = await readJson(c, sectionPatchSchema);
  return c.json(unwrap(await c.var.agent.updateOnboardingSection(key, patch, c.var.staffName)));
});

onboardingRoutes.post("/handover/:itemId", async (c) => {
  const itemId = recordId(c.req.param("itemId"));
  const patch = await readJson(c, handoverPatchSchema);
  return c.json(unwrap(await c.var.agent.updateHandoverItem(itemId, patch, c.var.staffName)));
});

onboardingRoutes.post("/golive/:checkId", async (c) => {
  const checkId = recordId(c.req.param("checkId"));
  const patch = await readJson(c, goLivePatchSchema);
  return c.json(unwrap(await c.var.agent.updateGoLiveCheck(checkId, patch, c.var.staffName)));
});

onboardingRoutes.post("/approve", async (c) => {
  const input = await readJson(c, approvalSchema);
  const result = await c.var.agent.approveOnboardingGoLive(input, c.var.staffName);
  // Blocked: 409 with the reasons, so the screen can list them.
  if (!result.ok && result.blockers) return c.json({ error: result.error, blockers: result.blockers }, 409);
  return c.json(unwrap(result));
});

onboardingRoutes.post("/closeout", async (c) => {
  await readJson(c, emptySchema);
  return c.json(unwrap(await c.var.agent.closeOutOnboarding(c.var.staffName)));
});

onboardingRoutes.post("/invites", async (c) => {
  const input = await readJson(c, inviteSchema);
  return c.json(unwrap(await c.var.agent.createHandoverInvite(input, c.var.staffName)), 201);
});

onboardingRoutes.post("/invites/:inviteId/activate", async (c) => {
  const inviteId = recordId(c.req.param("inviteId"));
  const { expiresInDays } = await readJson(c, activateSchema);
  return c.json(unwrap(await c.var.agent.activateHandoverInvite(inviteId, { expiresInDays, baseUrl: publicBaseUrl(c) }, c.var.staffName)));
});

onboardingRoutes.get("/invites/:inviteId/link", async (c) => {
  const inviteId = recordId(c.req.param("inviteId"));
  return c.json(unwrap(await c.var.agent.handoverInviteLink(inviteId, publicBaseUrl(c))));
});

onboardingRoutes.get("/invites/:inviteId/letter", async (c) => {
  const inviteId = recordId(c.req.param("inviteId"));
  return c.json(unwrap(await c.var.agent.handoverInviteLetter(inviteId, publicBaseUrl(c))));
});

onboardingRoutes.post("/invites/:inviteId/revoke", async (c) => {
  const inviteId = recordId(c.req.param("inviteId"));
  await readJson(c, emptySchema);
  return c.json(unwrap(await c.var.agent.revokeHandoverInvite(inviteId, c.var.staffName)));
});
