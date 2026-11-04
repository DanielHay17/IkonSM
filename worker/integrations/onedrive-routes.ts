// HTTP routes for the Microsoft 365 connection (mounted at /api/integrations/onedrive) and the
// per-building import (POST /api/properties/:id/integrations/onedrive/import). The browser never talks
// to Microsoft Graph: it navigates to /connect, and everything else goes through these routes.

import { Hono, type Handler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { VAULT_FOLDERS, type OneDriveImportResult, type OneDriveItemRef, type OneDriveStatus } from "../../shared/types";
import { staffFromRequest } from "../auth";
import { fileStaffDocument, MAX_UPLOAD_BYTES, type VaultFolder } from "../docs/filing";
import { readJson, requireBrowserOrigin, validate, type AppEnv, type PropertyEnv, type PropertyStub } from "../http";
import { browse, downloadForImport, GraphError } from "./graph";
import {
  authorizeUrl,
  microsoftConfig,
  newSignIn,
  openState,
  redirectUriFor,
  safeReturnPath,
  sealState,
  STATE_COOKIE,
  stateCookieOptions,
  stateMatches,
  STATE_TTL_SECONDS,
  TokenEndpointError,
  type FetchFn,
} from "./onedrive-oauth";
import { completeSignIn, currentAccessToken, deleteTokens, loadTokens, type StoredTokens } from "./onedrive-tokens";

/** At most this many files per import request (each is downloaded and indexed in turn). */
export const MAX_IMPORT_ITEMS = 25;
export const UPLOADER_SUFFIX = " (from OneDrive)";

/** Microsoft drive, item and site ids: letters, digits and ! , . _ ~ - (never "." or ".." on their own). */
const GRAPH_ID = /^(?!\.+$)[A-Za-z0-9!,._~-]{1,300}$/;

/** Wrapped so the runtime's fetch is always called unbound. */
const runtimeFetch: FetchFn = (input, init) => fetch(input, init);

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const graphId = z.string().regex(GRAPH_ID, "Invalid Microsoft 365 id");
const optionalId = z.preprocess((value) => (value === "" ? undefined : value), graphId.optional());

const browseQuery = z
  .object({
    source: z.enum(["me", "sites"]),
    siteId: optionalId,
    driveId: optionalId,
    itemId: optionalId,
  })
  .refine((q) => !q.itemId || q.driveId, { message: "itemId needs a driveId", path: ["itemId"] });

const importSchema = z.object({
  items: z
    .array(z.object({ driveId: graphId, itemId: graphId }))
    .min(1, "Choose at least one file")
    .max(MAX_IMPORT_ITEMS, `Import at most ${MAX_IMPORT_ITEMS} files at a time`),
  folder: z.enum(VAULT_FOLDERS),
});

// ---------------------------------------------------------------------------
// /api/integrations/onedrive/*
// ---------------------------------------------------------------------------

export const onedriveRoutes = new Hono<AppEnv>();

onedriveRoutes.get("/status", async (c) => c.json(await onedriveStatus(c.env)));

/** Starts sign-in: a top-level navigation (not fetch), so the CSP's connect-src and form-action stay 'self'. */
onedriveRoutes.get("/connect", async (c) => {
  const returnTo = safeReturnPath(c.req.query("return"));
  const config = microsoftConfig(c.env);
  if (!config) return c.redirect(resultLocation(returnTo, "not_configured"));

  const start = await newSignIn();
  const cookie = await sealState(config.secret, { state: start.state, verifier: start.verifier, returnTo });
  setCookie(c, STATE_COOKIE, cookie, stateCookieOptions(c.req.url, STATE_TTL_SECONDS));
  return c.redirect(authorizeUrl(config, { redirectUri: redirectUriFor(c.req.url), state: start.state, challenge: start.challenge }));
});

/** Microsoft redirects here. Public in the router (like /api/session), so it checks the staff session itself. */
onedriveRoutes.get("/callback", async (c) => {
  const outcome = await finishCallback(c.env, c.req.raw, getCookie(c, STATE_COOKIE), runtimeFetch);
  deleteCookie(c, STATE_COOKIE, stateCookieOptions(c.req.url, 0));
  return c.redirect(resultLocation(outcome.returnTo, outcome.failure));
});

onedriveRoutes.post("/disconnect", requireBrowserOrigin, async (c) => {
  await deleteTokens(c.env);
  console.log(`Microsoft 365 disconnected by ${c.var.staffName}`);
  return c.json(await onedriveStatus(c.env));
});

onedriveRoutes.get("/browse", async (c) => {
  const query = validate(browseQuery, c.req.query());
  const { accessToken } = await connectedTokens(c.env);
  try {
    return c.json(await browse(runtimeFetch, accessToken, query));
  } catch (err) {
    throw graphFailure(err);
  }
});

export async function onedriveStatus(env: Env): Promise<OneDriveStatus> {
  const config = microsoftConfig(env);
  if (!config) return { configured: false, connected: false };
  const tokens = await loadTokens(env, config.secret);
  return tokens ? { configured: true, connected: true, account: tokens.account } : { configured: true, connected: false };
}

async function connectedTokens(env: Env): Promise<StoredTokens> {
  const config = microsoftConfig(env);
  if (!config) throw new HTTPException(409, { message: "OneDrive isn't set up on this hub yet (MS_CLIENT_ID and MS_CLIENT_SECRET)." });
  return currentAccessToken(env, config, runtimeFetch);
}

// ---------------------------------------------------------------------------
// The OAuth callback
// ---------------------------------------------------------------------------

/** Short, safe codes for the `reason` the hub shows after a failed sign-in. Never Microsoft's own text. */
export type CallbackFailure = "not_configured" | "state" | "signin" | "denied" | "microsoft" | "exchange" | "storage";

export interface CallbackOutcome {
  returnTo: string;
  failure: CallbackFailure | null;
}

/**
 * Checks the state against the signed cookie and that a member of staff is signed in, then redeems the
 * code (with the PKCE verifier from the cookie) and stores the tokens. Nothing is redeemed on a mismatch.
 */
export async function finishCallback(env: Env, request: Request, stateCookie: string | undefined, fetchFn: FetchFn): Promise<CallbackOutcome> {
  const config = microsoftConfig(env);
  if (!config) return { returnTo: "/", failure: "not_configured" };
  const saved = await openState(config.secret, stateCookie);
  const params = new URL(request.url).searchParams;
  if (!saved || !(await stateMatches(saved.state, params.get("state")))) return { returnTo: saved?.returnTo ?? "/", failure: "state" };

  const fail = (failure: CallbackFailure): CallbackOutcome => ({ returnTo: saved.returnTo, failure });
  const staffName = await staffFromRequest(env, request);
  if (!staffName) return fail("signin");

  const error = params.get("error");
  if (error) {
    console.warn(`Microsoft 365 sign-in returned ${error.slice(0, 60)}`);
    return fail(error === "access_denied" || error === "consent_required" ? "denied" : "microsoft");
  }
  const code = params.get("code");
  if (!code) return fail("microsoft");

  try {
    const stored = await completeSignIn(env, config, { code, verifier: saved.verifier, redirectUri: redirectUriFor(request.url), staffName }, fetchFn);
    console.log(`Microsoft 365 connected by ${staffName}${stored.refreshToken ? "" : " (no refresh token: offline_access not granted)"}`);
    return { returnTo: saved.returnTo, failure: null };
  } catch (err) {
    console.error("Microsoft 365 sign-in could not be completed:", err instanceof Error ? err.message : err);
    return fail(err instanceof TokenEndpointError ? "exchange" : "storage");
  }
}

function resultLocation(returnTo: string, failure: CallbackFailure | null): string {
  const query = failure ? `onedrive=error&reason=${failure}` : "onedrive=connected";
  return `${returnTo}?${query}`;
}

// ---------------------------------------------------------------------------
// Import into a building
// ---------------------------------------------------------------------------

/** POST /api/properties/:id/integrations/onedrive/import: `{ items: [{ driveId, itemId }], folder }`. */
export const importFromOneDrive: Handler<PropertyEnv> = async (c) => {
  const { items, folder } = await readJson(c, importSchema);
  const { accessToken } = await connectedTokens(c.env);
  const { propertyId, agent, staffName } = c.var;
  const results = await importItems(c.env, { propertyId, agent, staffName }, uniqueRefs(items), folder, accessToken, runtimeFetch);
  return c.json({ results });
};

export interface ImportTarget {
  propertyId: string;
  agent: PropertyStub;
  staffName: string;
}

/**
 * Downloads and files each item in turn (one file in memory at a time), through the same path as the
 * upload form. Staff chose these files, so they are trusted records, labelled as coming from OneDrive.
 */
export async function importItems(
  env: Env,
  target: ImportTarget,
  refs: OneDriveItemRef[],
  folder: VaultFolder,
  accessToken: string,
  fetchFn: FetchFn,
): Promise<OneDriveImportResult[]> {
  const results: OneDriveImportResult[] = [];
  for (const ref of refs) results.push(await importOne(env, target, ref, folder, accessToken, fetchFn));
  return results;
}

async function importOne(
  env: Env,
  target: ImportTarget,
  ref: OneDriveItemRef,
  folder: VaultFolder,
  accessToken: string,
  fetchFn: FetchFn,
): Promise<OneDriveImportResult> {
  let name: string | null = null;
  try {
    const download = await downloadForImport(fetchFn, accessToken, ref, MAX_UPLOAD_BYTES);
    name = download.name;
    if (download.kind === "skipped") return { ...ref, status: "skipped", name, reason: download.reason, docId: null };
    const doc = await fileStaffDocument(env, target.propertyId, target.agent, {
      folder,
      name: download.name,
      mimeType: download.mimeType,
      bytes: download.bytes,
      uploadedBy: `${target.staffName}${UPLOADER_SUFFIX}`,
    });
    return { ...ref, status: "imported", name: doc.name, reason: null, docId: doc.id };
  } catch (err) {
    console.warn(`Microsoft 365 import into ${target.propertyId} failed:`, err instanceof Error ? err.message : err);
    return { ...ref, status: "failed", name, reason: importFailureReason(err), docId: null };
  }
}

function uniqueRefs(items: OneDriveItemRef[]): OneDriveItemRef[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.driveId}\u0000${item.itemId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function importFailureReason(err: unknown): string {
  if (!(err instanceof GraphError)) return "Downloaded, but it could not be filed. Try again.";
  if (err.status === 401) return "Microsoft 365 sign-in has expired. Connect again.";
  if (err.status === 403) return "Your Microsoft 365 account can't open this file";
  if (err.status === 404) return "Not found: it may have been moved or deleted";
  if (err.status === 429 || err.status === 503 || err.status === 504) return "Microsoft 365 was busy. Try again in a moment.";
  return "Download from Microsoft 365 failed";
}

/** Graph's status, translated for the picker. Graph's 401 is not ours: it must not sign staff out of the hub. */
function graphFailure(err: unknown): unknown {
  if (!(err instanceof GraphError)) return err;
  console.warn(`Microsoft 365 browse failed: ${err.message}`);
  if (err.status === 401) return new HTTPException(409, { message: "Microsoft 365 sign-in has expired. Disconnect and connect again." });
  if (err.status === 403) return new HTTPException(403, { message: "Your Microsoft 365 account doesn't have access to that." });
  if (err.status === 404) return new HTTPException(404, { message: "Not found in Microsoft 365. It may have been moved or deleted." });
  if (err.status === 429 || err.status === 503 || err.status === 504) {
    return new HTTPException(503, { message: "Microsoft 365 is busy. Try again in a moment." });
  }
  return new HTTPException(502, { message: "Microsoft 365 returned an error. Try again." });
}
