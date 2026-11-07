// Helpers for the onboarding and portal tests: project and invitation set-up through the API, portal calls
// (no session), and direct reads of a building agent's SQLite. Counts come from the template, never hard-coded.

import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type { HandoverInvite, OnboardingProjectDetail, PortalUploadResult } from "../shared/onboarding";
import { FINAL_APPROVAL_TASK_KEY } from "../worker/agents/onboarding";
import { ONBOARDING_TEMPLATE } from "../worker/seed/onboarding-template";
import { call, callJson, type CallOptions } from "./helpers";

export const TEMPLATE_TASKS = ONBOARDING_TEMPLATE.sections.reduce((n, s) => n + s.tasks.length, 0);
/** Tasks that hold up go-live: all but the closeout ("Completion & quality assurance") tasks and the final-approval task. */
export const GO_LIVE_TASKS = ONBOARDING_TEMPLATE.sections.reduce(
  (n, s) =>
    n +
    s.tasks.filter(
      (t) => t.key !== FINAL_APPROVAL_TASK_KEY && !(s.key === "readiness_closeout" && t.group.toLowerCase() === "completion & quality assurance"),
    ).length,
  0,
);
export const TEMPLATE_ITEMS = ONBOARDING_TEMPLATE.handoverItems.length;
export const TEMPLATE_CHECKS = ONBOARDING_TEMPLATE.goLiveChecks.length;

export const SAM = {
  company: "Sample Strata Co Pty Ltd",
  name: "Sam Outgoing",
  email: "sam.outgoing@samplestrata.example.com",
  phone: "08 5550 0111",
};
export const SAM_UPLOADER = "handover:Sam Outgoing (Sample Strata Co Pty Ltd)";

/** YYYY-MM-DD `days` from today (UTC is close enough for validation). */
export function ymd(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export async function createProject(cookie: string, propertyId: string, body: Record<string, unknown> = {}): Promise<OnboardingProjectDetail> {
  return callJson(`/api/properties/${propertyId}/onboarding`, { cookie, json: body, status: 201 });
}

export async function getProject(cookie: string, propertyId: string): Promise<OnboardingProjectDetail> {
  return callJson(`/api/properties/${propertyId}/onboarding`, { cookie });
}

export async function prepareInvite(cookie: string, propertyId: string, overrides: Record<string, unknown> = {}): Promise<HandoverInvite> {
  return callJson(`/api/properties/${propertyId}/onboarding/invites`, {
    cookie,
    json: { incomingManagerId: "tom-placeholder", outgoingManager: SAM, handoverDate: ymd(12), recordsDueDate: ymd(5), ...overrides },
    status: 201,
  });
}

export async function activateInvite(
  cookie: string,
  propertyId: string,
  inviteId: string,
  body: Record<string, unknown> = {},
): Promise<{ invite: HandoverInvite; url: string }> {
  return callJson(`/api/properties/${propertyId}/onboarding/invites/${inviteId}/activate`, { cookie, json: body });
}

export function tokenOf(url: string): string {
  return url.slice(url.lastIndexOf("/") + 1);
}

/** A project with an active handover link: the portal token, the link and the project. */
export async function openHandover(cookie: string, propertyId: string): Promise<{ token: string; url: string; invite: HandoverInvite; detail: OnboardingProjectDetail }> {
  await createProject(cookie, propertyId);
  const draft = await prepareInvite(cookie, propertyId);
  const { invite, url } = await activateInvite(cookie, propertyId, draft.id);
  return { token: tokenOf(url), url, invite, detail: await getProject(cookie, propertyId) };
}

/** Portal calls carry no session cookie. */
export function portal(token: string, path = "", opts: CallOptions = {}): Promise<Response> {
  return call(`/api/portal/${token}${path}`, { ...opts, cookie: null });
}

export async function portalJson<T = any>(token: string, path = "", opts: CallOptions & { status?: number } = {}): Promise<T> {
  return callJson(`/api/portal/${token}${path}`, { ...opts, cookie: null });
}

export function uploadForm(file: File, fields: { folder?: string; itemId?: string; relativePath?: string } = {}): FormData {
  const form = new FormData();
  form.set("file", file);
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) form.set(key, value);
  return form;
}

export function portalUpload(token: string, file: File, fields: { folder?: string; itemId?: string; relativePath?: string } = {}, opts: CallOptions = {}): Promise<Response> {
  return portal(token, "/upload", { body: uploadForm(file, fields), ...opts });
}

export async function portalUploadOk(token: string, file: File, fields: { folder?: string; itemId?: string; relativePath?: string } = {}): Promise<PortalUploadResult> {
  const res = await portalUpload(token, file, fields);
  const text = await res.text();
  if (res.status !== 201) throw new Error(`upload ${file.name}: expected 201, got ${res.status}: ${text}`);
  return JSON.parse(text) as PortalUploadResult;
}

export function textFile(name: string, text: string): File {
  return new File([text], name, { type: "text/plain" });
}

/** Rows straight from a building agent's SQLite. */
export async function agentRows<T extends Record<string, SqlStorageValue>>(propertyId: string, query: string, ...bindings: (string | number | null)[]): Promise<T[]> {
  const stub = env.PropertyAgent.get(env.PropertyAgent.idFromName(propertyId));
  return runInDurableObject(stub, async (_instance, state) => state.storage.sql.exec<T>(query, ...bindings).toArray());
}

export async function agentExec(propertyId: string, query: string, ...bindings: (string | number | null)[]): Promise<void> {
  await agentRows(propertyId, query, ...bindings);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}
