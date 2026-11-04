// HTTP plumbing shared by the Hono app: context types, request guards (same-origin,
// content type, body size), JSON/query validation with zod, and error responses.

import type { Context, ErrorHandler, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

export type AppVariables = { staffName: string };
export type AppEnv = { Bindings: Env; Variables: AppVariables };

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_ERROR_CHARS = 300;
const MAX_REPORTED_ISSUES = 3;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export function badRequest(message: string): HTTPException {
  return new HTTPException(400, { message });
}

export function notFound(message = "Not found"): HTTPException {
  return new HTTPException(404, { message });
}

/**
 * Errors the agents throw on purpose (bad input, missing records, state conflicts) arrive over
 * Durable Object RPC as plain Errors with their message intact; these map them to 4xx responses.
 */
const AGENT_ERRORS: { pattern: RegExp; status: ContentfulStatusCode }[] = [
  { pattern: /^(Thread|Approval|Ticket|Document|Contact|Memory note) not found$/, status: 404 },
  { pattern: /^Approval already decided$/, status: 409 },
  { pattern: /^Thread has no inbound message\b/, status: 409 },
  { pattern: /^Invalid [\w ]+: /, status: 400 },
  { pattern: /^Unknown (contractorId|threadId): /, status: 400 },
  { pattern: /^[\w ]+ is required$/, status: 400 },
  { pattern: /^Decision must be approve or reject$/, status: 400 },
];

function agentErrorStatus(err: Error): ContentfulStatusCode | null {
  if ((err as { overloaded?: unknown }).overloaded === true) return 503;
  return AGENT_ERRORS.find(({ pattern }) => pattern.test(err.message))?.status ?? null;
}

/** Global onError: expected errors become `{ error }` with their status; anything else is logged and hidden. */
export const handleError: ErrorHandler = (err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message || "Request failed" }, err.status);
  }
  const status = agentErrorStatus(err);
  if (status === 503) return c.json({ error: "The service is busy, please try again" }, 503);
  if (status !== null) return c.json({ error: err.message.slice(0, MAX_ERROR_CHARS) }, status);

  console.error(`Unhandled error on ${c.req.method} ${c.req.path}:`, err);
  return c.json({ error: "Internal server error" }, 500);
};

// ---------------------------------------------------------------------------
// Request guards
// ---------------------------------------------------------------------------

/** Adds no-store caching, nosniff, no framing and a same-origin referrer policy to every API response (handlers may set their own Cache-Control). */
export const apiResponseHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("Referrer-Policy", "same-origin");
};

export interface RequestGuardOptions {
  /** Requests that must be multipart/form-data (file uploads) instead of JSON. */
  isUpload: (c: Context) => boolean;
  maxJsonBytes: number;
  maxUploadBytes: number;
}

/**
 * CSRF mitigation and body size limits for mutating requests:
 * - a browser Origin header, when present, must match this origin;
 * - POST/PUT/PATCH must be application/json (or multipart/form-data for uploads), which a
 *   cross-site HTML form cannot send; a bodiless DELETE may omit the Content-Type;
 * - bodies over the limit are rejected with 413 before they are parsed.
 */
export function requestGuard(options: RequestGuardOptions): MiddlewareHandler {
  const jsonLimit = sizeLimit(options.maxJsonBytes);
  const uploadLimit = sizeLimit(options.maxUploadBytes);

  return async (c, next) => {
    if (!MUTATING_METHODS.has(c.req.method)) return next();
    assertSameOrigin(c);
    const upload = options.isUpload(c);
    assertContentType(c, upload ? "multipart/form-data" : "application/json");
    return (upload ? uploadLimit : jsonLimit)(c, next);
  };
}

function sizeLimit(maxSize: number): MiddlewareHandler {
  return bodyLimit({
    maxSize,
    onError: (c) => c.json({ error: `Request body is larger than ${formatBytes(maxSize)}` }, 413),
  });
}

function assertSameOrigin(c: Context): void {
  const origin = c.req.header("Origin");
  if (origin !== undefined && origin !== new URL(c.req.url).origin) {
    throw new HTTPException(403, { message: "Cross-origin request blocked" });
  }
}

function assertContentType(c: Context, expected: "application/json" | "multipart/form-data"): void {
  const actual = mediaType(c.req.header("Content-Type"));
  if (c.req.method === "DELETE" && actual === null) return;
  if (actual !== expected) throw new HTTPException(415, { message: `Content-Type must be ${expected}` });
}

/** "application/json; charset=utf-8" → "application/json"; null when absent. */
function mediaType(header: string | undefined): string | null {
  const type = header?.split(";", 1)[0].trim().toLowerCase();
  return type ? type : null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Parses the JSON body (an empty body counts as `{}`) and validates it, or throws 400. */
export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  const raw = await c.req.text();
  let data: unknown = {};
  if (raw.trim()) {
    try {
      data = JSON.parse(raw);
    } catch {
      throw badRequest("Request body must be valid JSON");
    }
  }
  return validate(schema, data);
}

/** Validates any value (query strings, form fields) against a schema, or throws 400. */
export function validate<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw badRequest(describeIssues(result.error.issues));
  return result.data;
}

function describeIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[]): string {
  const parts = issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => {
    const where = issue.path.map(String).join(".");
    return where ? `${where}: ${issue.message}` : issue.message;
  });
  return parts.join("; ") || "Invalid request";
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

/**
 * Content-Disposition with an ASCII fallback `filename` and the exact UTF-8 name in
 * `filename*` (RFC 6266 / RFC 5987), so non-ASCII file names survive in every browser.
 */
export function contentDisposition(filename: string, disposition: "attachment" | "inline" = "attachment"): string {
  const fallback =
    filename
      .normalize("NFKD")
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/["\\]/g, "_")
      .trim() || "download";
  // encodeURIComponent leaves ' ( ) * unescaped, but they are not RFC 5987 attr-chars.
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}
