// Staff authentication for the command hub.
//
// Demo/pilot login is a shared passcode (HUB_PASSCODE) plus the staff member's name; the
// session is a cookie `ikon_session` = base64url(JSON {n, exp}) + "." + base64url(HMAC-SHA256),
// keyed with SESSION_SECRET (or HUB_PASSCODE on localhost only), valid for 12 hours.
// Off localhost, login needs SESSION_SECRET and a passcode of at least 12 characters, and is limited
// to 10 attempts a minute per client IP (LOGIN_LIMITER). Sessions are stateless: rotate SESSION_SECRET
// to sign everyone out. With AUTH_REQUIRED = "false" every request is the staff member "Demo".
// For the pilot, put the hub behind Cloudflare Access as well.

import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { parse as parseCookies, type CookieOptions } from "hono/utils/cookie";
import { z } from "zod";
import type { SessionInfo } from "../shared/types";
import { aiInfo, aiOnline } from "./ai/client";
import { aiSwitchInfo, readAiChoice, withAiChoice } from "./ai/switch";
import { readJson, type AppEnv } from "./http";

export const SESSION_COOKIE = "ikon_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
export const DEMO_STAFF_NAME = "Demo";

const MAX_TOKEN_CHARS = 1024;
const MAX_STAFF_NAME_CHARS = 60;
/** Shortest passcode accepted when the hub is reachable from outside localhost. */
export const MIN_PASSCODE_CHARS = 12;
/** Tokens may not claim to live longer than this (clock skew allowance included). */
const MAX_TOKEN_LIFETIME_SECONDS = SESSION_TTL_SECONDS + 300;
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Secrets may be missing or "" in local dev and tests; both mean "unset". */
export function configured(value: string | undefined | null): string | null {
  return value && value.trim() ? value : null;
}

export function authRequired(env: Env): boolean {
  return (env.AUTH_REQUIRED ?? "").trim().toLowerCase() !== "false";
}

/** The key for everything the hub signs or seals: SESSION_SECRET, or HUB_PASSCODE on a bare local setup. */
export function sessionSecret(env: Env): string | null {
  return configured(env.SESSION_SECRET) ?? configured(env.HUB_PASSCODE);
}

export function sessionInfo(env: Env, staffName: string | null): SessionInfo {
  return {
    authenticated: staffName !== null,
    staffName,
    authRequired: authRequired(env),
    aiOnline: aiOnline(env),
    ai: aiInfo(env),
    appName: env.APP_NAME || "Ikon Command Hub",
    companyName: env.COMPANY_NAME || "Ikon Strata Management",
    emailDomain: env.EMAIL_DOMAIN || "ikon.example.com",
  };
}

// ---------------------------------------------------------------------------
// Staff names
// ---------------------------------------------------------------------------

/** Display-safe name: no control or bidi-override characters, single spaces, at most 60 chars. */
export function normaliseStaffName(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_STAFF_NAME_CHARS)
    .trim();
}

const staffNameSchema = z
  .string()
  .max(200)
  .transform(normaliseStaffName)
  .pipe(z.string().min(1, "Enter your name"));

const loginSchema = z.object({
  passcode: z.string().max(256),
  name: staffNameSchema,
});

// ---------------------------------------------------------------------------
// Crypto
// ---------------------------------------------------------------------------

/** Imported keys per secret; only resolved keys are cached, never in-flight promises across requests. */
const hmacKeys = new Map<string, CryptoKey>();

async function hmacKey(secret: string): Promise<CryptoKey> {
  const cached = hmacKeys.get(secret);
  if (cached) return cached;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  hmacKeys.clear(); // a rotated secret replaces the old key
  hmacKeys.set(secret, key);
  return key;
}

export async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(data)));
}

export async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Passcode and session tokens
// ---------------------------------------------------------------------------

/** Constant-time passcode check (both sides hashed first, so length is not leaked either). */
export async function passcodeMatches(env: Env, candidate: string): Promise<boolean> {
  const expected = configured(env.HUB_PASSCODE);
  if (!expected) return false;
  const [given, wanted] = await Promise.all([sha256(candidate), sha256(expected)]);
  return timingSafeEqual(given, wanted);
}

type SessionPayload = { n: string; exp: number };

export async function createSessionToken(env: Env, staffName: string, nowMs = Date.now()): Promise<string> {
  const secret = sessionSecret(env);
  if (!secret) throw new Error("No session secret configured (set SESSION_SECRET or HUB_PASSCODE)");
  const payload: SessionPayload = { n: staffName, exp: Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  return `${body}.${toBase64Url(await hmacSha256(secret, body))}`;
}

/** The staff name in a valid, unexpired token; null for anything else. Never throws. */
export async function verifySessionToken(env: Env, token: string | undefined, nowMs = Date.now()): Promise<string | null> {
  const secret = sessionSecret(env);
  if (!secret || !token || token.length > MAX_TOKEN_CHARS) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  const given = fromBase64Url(signature);
  if (!given || !timingSafeEqual(given, await hmacSha256(secret, body))) return null;

  const payload = decodePayload(body);
  if (!payload || payload.exp * 1000 <= nowMs) return null;
  // Only this server signs tokens, so one that claims to outlive a session was not made by login.
  if (payload.exp * 1000 > nowMs + MAX_TOKEN_LIFETIME_SECONDS * 1000) return null;
  return payload.n;
}

function decodePayload(body: string): SessionPayload | null {
  const bytes = fromBase64Url(body);
  if (!bytes) return null;
  try {
    const value: unknown = JSON.parse(decoder.decode(bytes));
    if (typeof value !== "object" || value === null) return null;
    const { n, exp } = value as Record<string, unknown>;
    if (typeof n !== "string" || typeof exp !== "number" || !Number.isFinite(exp)) return null;
    const name = normaliseStaffName(n);
    return name ? { n: name, exp } : null;
  } catch {
    return null;
  }
}

/** The signed-in staff member for a raw request ("Demo" when auth is off), or null. */
export async function staffFromRequest(env: Env, request: Request): Promise<string | null> {
  if (!authRequired(env)) return DEMO_STAFF_NAME;
  const token = parseCookies(request.headers.get("Cookie") ?? "", SESSION_COOKIE)[SESSION_COOKIE];
  return verifySessionToken(env, token);
}

// ---------------------------------------------------------------------------
// Hono integration
// ---------------------------------------------------------------------------

/** Sets `staffName` for the request or answers 401. */
export const requireStaff: MiddlewareHandler<AppEnv> = async (c, next) => {
  const staffName = await staffFromRequest(c.env, c.req.raw);
  if (!staffName) return c.json({ error: "Sign in required" }, 401);
  c.set("staffName", staffName);
  await next();
};

function isLocalHost(url: URL): boolean {
  return LOCAL_HOSTNAMES.has(url.hostname) || url.hostname.endsWith(".localhost");
}

/** Session cookies are Secure everywhere except plain-http localhost (local dev). */
export function cookieOptions(requestUrl: string, maxAge: number): CookieOptions {
  const url = new URL(requestUrl);
  const localHttp = url.protocol === "http:" && isLocalHost(url);
  return { path: "/", httpOnly: true, sameSite: "Lax", secure: !localHttp, maxAge };
}

/** Why passcode login must stay off on a reachable host, or null when the setup is safe enough. */
function unsafeLoginSetup(env: Env, requestUrl: string): string | null {
  if (isLocalHost(new URL(requestUrl))) return null;
  if (!configured(env.SESSION_SECRET)) return "Set SESSION_SECRET (a long random string) before staff can sign in";
  if ((configured(env.HUB_PASSCODE) ?? "").length < MIN_PASSCODE_CHARS) {
    return `HUB_PASSCODE must be at least ${MIN_PASSCODE_CHARS} characters before staff can sign in`;
  }
  return null;
}

/** 10 attempts a minute per client IP (Workers rate limiting binding). Requests without CF-Connecting-IP skip it. */
async function checkLoginRate(env: Env, ip: string | undefined): Promise<void> {
  if (!ip || !env.LOGIN_LIMITER) return;
  const { success } = await env.LOGIN_LIMITER.limit({ key: `login:${ip}` });
  if (!success) throw new HTTPException(429, { message: "Too many sign-in attempts. Wait a minute and try again." });
}

/** GET /session, POST /login, POST /logout (mounted under /api; logout is behind requireStaff). */
export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/session", async (c) => {
  const staff = await staffFromRequest(c.env, c.req.raw);
  if (staff === null) return c.json(sessionInfo(c.env, null));
  return c.json(await sessionWithSwitch(c.env, staff));
});

/** Session info for a signed-in member of staff, with the hub-wide AI switch applied. */
export async function sessionWithSwitch(env: Env, staffName: string): Promise<SessionInfo> {
  const choice = await readAiChoice(env);
  return { ...sessionInfo(withAiChoice(env, choice), staffName), aiSwitch: aiSwitchInfo(env, choice) };
}

authRoutes.post("/login", async (c) => {
  if (!authRequired(c.env)) return c.json(await sessionWithSwitch(c.env, DEMO_STAFF_NAME));
  if (!configured(c.env.HUB_PASSCODE) || !sessionSecret(c.env)) {
    throw new HTTPException(503, { message: "Passcode login is not set up on this server (HUB_PASSCODE is empty)" });
  }
  const unsafe = unsafeLoginSetup(c.env, c.req.url);
  if (unsafe) throw new HTTPException(503, { message: unsafe });
  await checkLoginRate(c.env, c.req.header("CF-Connecting-IP"));

  const { passcode, name } = await readJson(c, loginSchema);
  if (!(await passcodeMatches(c.env, passcode))) {
    throw new HTTPException(401, { message: "Incorrect passcode" });
  }

  const token = await createSessionToken(c.env, name);
  setCookie(c, SESSION_COOKIE, token, cookieOptions(c.req.url, SESSION_TTL_SECONDS));
  return c.json(await sessionWithSwitch(c.env, name));
});

authRoutes.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, cookieOptions(c.req.url, 0));
  return c.json(sessionInfo(c.env, authRequired(c.env) ? null : DEMO_STAFF_NAME));
});
