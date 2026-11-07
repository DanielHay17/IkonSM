// The outgoing strata manager's upload portal: public routes under /api/portal/:token. The secure link's token
// is the credential (no session): "<sp number>-<43 base64url chars>" routes to building sp-<n>, whose agent
// checks the token's SHA-256 against its invitations in constant time.
//
// - Unknown or malformed tokens and unknown buildings: 404 "This link is not valid." (one body for all; the
//   response time can still differ for a known building, which only tells someone that Ikon manages that SP).
// - Revoked or expired links: 410 "This link has expired or been withdrawn. Please contact Ikon."
// - Rate limited per client IP before anything is looked up, then per token and IP (PORTAL_LIMITER); notes,
//   "not applicable" and submit have a much tighter limit per link (PORTAL_ACTION_LIMITER). Mutations need a
//   same-origin Origin header.
// - Responses carry only what the outgoing manager needs: no staff names, internal ids (beyond requested
//   item ids), token hashes, other invitations or events.

import { getAgentByName } from "agents";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { isJunkPath } from "../shared/handover-match";
import { PORTAL_TOKEN, stripInvisible, type PortalUploadResult } from "../shared/onboarding";
import { VAULT_FOLDERS } from "../shared/types";
import { LINK_NOT_VALID } from "./agents/onboarding";
import { fileHandoverDocument, MAX_UPLOAD_BYTES } from "./docs/filing";
import { displayFileName } from "./docs/vault";
import { badRequest, formatBytes, readJson, requireBrowserOrigin, type AppVariables, type PropertyStub } from "./http";
import { unwrap } from "./onboarding-routes";
import { isKnownPropertyId } from "./seed/portfolio";

export type PortalEnv = { Bindings: Env; Variables: AppVariables & { token: string; propertyId: string; agent: PropertyStub } };

const PORTAL_PATH = /^\/api\/portal\/([^/]+)/;
const ITEM_ID = /^[\w.:-]{1,100}$/;
/** Paths are display-only and kept to their last 500 characters (the end names the file). */
const MAX_RELATIVE_PATH = 500;
/** Longer than this is not a real path: the field is ignored rather than the upload refused. */
const MAX_RELATIVE_PATH_INPUT = 8000;

const noteSchema = z.object({ note: z.string().trim().min(1, "Required").max(2000) });
const submitSchema = z.object({ message: z.string().trim().max(4000).nullish().transform((v) => v || null) });

/**
 * A path from a zip or a dropped folder, for display only: no "." or ".." segments, no leading slashes or
 * drive letters, no control, bidi-override or zero-width characters, forward slashes. Over 500 characters it
 * keeps the end ("…/Insurance/Policy 2026.pdf"). null when nothing is left.
 */
export function sanitiseRelativePath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parts = stripInvisible(raw.normalize("NFC"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part && part !== "." && part !== "..");
  if (parts.length > 0 && /^[A-Za-z]:$/.test(parts[0]!)) parts.shift();
  const path = parts.join("/");
  if (!path) return null;
  return path.length <= MAX_RELATIVE_PATH ? path : `…${path.slice(path.length - (MAX_RELATIVE_PATH - 1))}`;
}

export const portalRoutes = new Hono<PortalEnv>();

/** Resolves the token to its building (404 for anything that can't be one) and applies the rate limit. */
portalRoutes.use("*", async (c, next) => {
  const token = PORTAL_PATH.exec(c.req.path)?.[1] ?? "";
  const match = PORTAL_TOKEN.exec(token);
  const propertyId = match ? `sp-${match[1]}` : "";
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  // Per IP first, so probing with made-up tokens is slowed before any building is woken up.
  if (c.env.PORTAL_LIMITER && !(await c.env.PORTAL_LIMITER.limit({ key: `portal-ip:${ip}` })).success) return tooMany(c);
  if (!match || !isKnownPropertyId(propertyId)) return c.json({ error: LINK_NOT_VALID }, 404);
  if (c.env.PORTAL_LIMITER && !(await c.env.PORTAL_LIMITER.limit({ key: `portal:${token}:${ip}` })).success) return tooMany(c);
  c.set("token", token);
  c.set("propertyId", propertyId);
  c.set("agent", await getAgentByName(c.env.PropertyAgent, propertyId));
  await next();
});

portalRoutes.get("/:token", async (c) => c.json(unwrap(await c.var.agent.portalView(c.var.token))));

portalRoutes.post("/:token/upload", requireBrowserOrigin, async (c) => {
  const form = await readForm(c);
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Attach the document as the 'file' field");
  if (file.size === 0) throw badRequest("The file is empty");
  if (file.size > MAX_UPLOAD_BYTES) throw new HTTPException(413, { message: `Files must be ${formatBytes(MAX_UPLOAD_BYTES)} or smaller` });

  const relativePath = textField(form, "relativePath");
  const sourcePath = relativePath && relativePath.length <= MAX_RELATIVE_PATH_INPUT ? sanitiseRelativePath(relativePath) : null;
  const name = displayFileName(file.name || sourcePath?.split("/").pop() || "upload");
  if (isJunkPath(file.name) || isJunkPath(name) || (sourcePath && isJunkPath(sourcePath))) {
    throw badRequest("System files (such as .DS_Store, Thumbs.db or __MACOSX) are not uploaded");
  }

  const folderField = textField(form, "folder")?.trim() || null;
  if (folderField && !VAULT_FOLDERS.some((f) => f === folderField)) throw badRequest(`folder must be one of: ${VAULT_FOLDERS.join(", ")}`);
  const itemField = textField(form, "itemId")?.trim() || null;
  if (itemField && !ITEM_ID.test(itemField)) throw badRequest("Invalid itemId");

  const result = unwrap(
    await fileHandoverDocument(c.env, c.var.propertyId, c.var.agent, c.var.token, {
      name,
      mimeType: file.type || null,
      bytes: new Uint8Array(await file.arrayBuffer()),
      folder: folderField,
      itemId: itemField,
      sourcePath,
    }),
  );
  const body: PortalUploadResult = { file: result.file, itemId: result.itemId, itemTitle: result.itemTitle };
  return c.json(body, 201);
});

portalRoutes.post("/:token/items/:itemId/not-applicable", requireBrowserOrigin, actionLimit, async (c) => {
  const itemId = portalItemId(c.req.param("itemId"));
  const { note } = await readJson(c, noteSchema);
  return c.json(unwrap(await c.var.agent.portalNotApplicable(c.var.token, itemId, note)));
});

portalRoutes.post("/:token/items/:itemId/note", requireBrowserOrigin, actionLimit, async (c) => {
  const itemId = portalItemId(c.req.param("itemId"));
  const { note } = await readJson(c, noteSchema);
  return c.json(unwrap(await c.var.agent.portalNote(c.var.token, itemId, note)));
});

portalRoutes.post("/:token/submit", requireBrowserOrigin, actionLimit, async (c) => {
  const { message } = await readJson(c, submitSchema);
  return c.json(unwrap(await c.var.agent.portalSubmit(c.var.token, message)));
});

portalRoutes.all("*", (c) => c.json({ error: "Not found" }, 404));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tooMany(c: Context) {
  return c.json({ error: "Too many requests. Please wait a minute and try again." }, 429);
}

/** Notes, "not applicable" and submit: a person does a few a minute, so a tight limit per link stops a flood. */
async function actionLimit(c: Context<PortalEnv>, next: () => Promise<void>) {
  const limiter = c.env.PORTAL_ACTION_LIMITER;
  if (limiter && !(await limiter.limit({ key: `portal-action:${c.var.token}` })).success) return tooMany(c);
  await next();
}

function portalItemId(value: string | undefined): string {
  if (!value || !ITEM_ID.test(value)) throw new HTTPException(404, { message: "That requested document is not part of this handover" });
  return value;
}

function textField(form: FormData, name: string): string | null {
  const value = form.get(name);
  if (value === null) return null;
  if (typeof value !== "string") throw badRequest(`${name} must be text`);
  return value;
}

async function readForm(c: Context): Promise<FormData> {
  try {
    return await c.req.formData();
  } catch {
    throw badRequest("Upload must be a valid multipart/form-data body");
  }
}
