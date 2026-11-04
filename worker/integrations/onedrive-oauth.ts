// Microsoft identity platform (v2.0) sign-in for the hub-wide Microsoft 365 connection: configuration,
// the authorisation-code flow with PKCE (S256), the short-lived state cookie, and the token endpoint.
// One connection serves the whole hub: staff sign in once and every building can import from it.

import type { CookieOptions } from "hono/utils/cookie";
import { configured, cookieOptions, fromBase64Url, hmacSha256, sessionSecret, sha256, timingSafeEqual, toBase64Url } from "../auth";

/** Delegated scopes: read the account's files and the SharePoint sites it can reach, and stay signed in. */
export const SCOPES = "offline_access User.Read Files.Read.All Sites.Read.All";
export const CALLBACK_PATH = "/api/integrations/onedrive/callback";
export const STATE_COOKIE = "ikon_onedrive_oauth";
/** The state cookie is only ever needed by the connect and callback routes. */
const STATE_COOKIE_PATH = "/api/integrations/onedrive";
export const STATE_TTL_SECONDS = 10 * 60;

const LOGIN_BASE = "https://login.microsoftonline.com";
/** "common", "organizations", "consumers", a tenant GUID or a verified domain. */
const TENANT = /^[A-Za-z0-9][A-Za-z0-9.-]{0,99}$/;
/** The only places the callback sends staff back to, besides "/": a building's Files tab. */
const RETURN_PATH = /^\/buildings\/sp-\d{3,6}\/files$/;
const MAX_STATE_COOKIE_CHARS = 1024;
/** Prefixed to the signed text so a state cookie's MAC can never pass as a session token's. */
const STATE_SIGNING_CONTEXT = "ikonsm-onedrive-state";
const MIN_TOKEN_LIFETIME_SECONDS = 60;
const MAX_TOKEN_LIFETIME_SECONDS = 24 * 60 * 60;
/** Microsoft's usual access-token lifetime, assumed if a response leaves expires_in out. */
const DEFAULT_TOKEN_LIFETIME_SECONDS = 60 * 60;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The fetch the Microsoft calls go through; tests pass a stub with canned responses. */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface MicrosoftConfig {
  clientId: string;
  clientSecret: string;
  tenant: string;
  /** SESSION_SECRET: signs the state cookie and seals the stored tokens. */
  secret: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** The app registration, or null when the Worker lacks MS_CLIENT_ID, MS_CLIENT_SECRET or a session secret. */
export function microsoftConfig(env: Env): MicrosoftConfig | null {
  const clientId = configured(env.MS_CLIENT_ID)?.trim();
  const clientSecret = configured(env.MS_CLIENT_SECRET);
  const secret = sessionSecret(env);
  if (!clientId || !clientSecret || !secret) return null;
  const tenant = configured(env.MS_TENANT)?.trim() ?? "common";
  if (!TENANT.test(tenant)) {
    console.warn("MS_TENANT must be a tenant ID, a domain, or common/organizations/consumers; Microsoft 365 import is off");
    return null;
  }
  return { clientId, clientSecret, tenant, secret };
}

/** Derived from the request so the same build works on localhost, workers.dev and a custom domain. */
export function redirectUriFor(requestUrl: string): string {
  return new URL(CALLBACK_PATH, requestUrl).toString();
}

/** A building's Files tab when that is where staff started, otherwise the portfolio. Never another site. */
export function safeReturnPath(value: string | null | undefined): string {
  return value && RETURN_PATH.test(value) ? value : "/";
}

// ---------------------------------------------------------------------------
// Authorisation request (PKCE)
// ---------------------------------------------------------------------------

export interface SignInStart {
  state: string;
  verifier: string;
  challenge: string;
}

/** A fresh state and PKCE pair: 256 random bits each, the challenge is base64url(SHA-256(verifier)). */
export async function newSignIn(): Promise<SignInStart> {
  const state = randomToken();
  const verifier = randomToken();
  return { state, verifier, challenge: toBase64Url(await sha256(verifier)) };
}

function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function authorizeUrl(config: MicrosoftConfig, request: { redirectUri: string; state: string; challenge: string }): string {
  const url = new URL(`${LOGIN_BASE}/${encodeURIComponent(config.tenant)}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: request.redirectUri,
    response_mode: "query",
    scope: SCOPES,
    state: request.state,
    code_challenge: request.challenge,
    code_challenge_method: "S256",
    // Staff often have more than one Microsoft account in the browser: let them pick Ikon's.
    prompt: "select_account",
  }).toString();
  return url.toString();
}

// ---------------------------------------------------------------------------
// State cookie: state, code verifier and return path, HMAC-signed, 10 minutes
// ---------------------------------------------------------------------------

export interface SavedSignIn {
  state: string;
  verifier: string;
  returnTo: string;
}

type StatePayload = { s: string; v: string; r: string; exp: number };

/** HttpOnly, SameSite=Lax (sent on the top-level redirect back from Microsoft), Secure off localhost. */
export function stateCookieOptions(requestUrl: string, maxAge: number): CookieOptions {
  return { ...cookieOptions(requestUrl, maxAge), path: STATE_COOKIE_PATH };
}

export async function sealState(secret: string, saved: SavedSignIn, nowMs = Date.now()): Promise<string> {
  const payload: StatePayload = { s: saved.state, v: saved.verifier, r: saved.returnTo, exp: Math.floor(nowMs / 1000) + STATE_TTL_SECONDS };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  return `${body}.${toBase64Url(await stateMac(secret, body))}`;
}

/** The saved sign-in from a valid, unexpired cookie this server signed; null for anything else. Never throws. */
export async function openState(secret: string, cookie: string | undefined, nowMs = Date.now()): Promise<SavedSignIn | null> {
  if (!cookie || cookie.length > MAX_STATE_COOKIE_CHARS) return null;
  const parts = cookie.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts as [string, string];
  const given = fromBase64Url(signature);
  if (!given || !timingSafeEqual(given, await stateMac(secret, body))) return null;

  const payload = decodeState(body);
  const nowSeconds = nowMs / 1000;
  if (!payload || payload.exp <= nowSeconds || payload.exp > nowSeconds + STATE_TTL_SECONDS + 60) return null;
  return { state: payload.s, verifier: payload.v, returnTo: safeReturnPath(payload.r) };
}

function stateMac(secret: string, body: string): Promise<Uint8Array> {
  return hmacSha256(secret, `${STATE_SIGNING_CONTEXT}.${body}`);
}

function decodeState(body: string): StatePayload | null {
  const bytes = fromBase64Url(body);
  if (!bytes) return null;
  try {
    const value: unknown = JSON.parse(decoder.decode(bytes));
    if (typeof value !== "object" || value === null) return null;
    const { s, v, r, exp } = value as Record<string, unknown>;
    if (typeof s !== "string" || typeof v !== "string" || typeof r !== "string") return null;
    if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
    return { s, v, r, exp };
  } catch {
    return null;
  }
}

/** Constant-time comparison of the state Microsoft echoed back with the one in the cookie. */
export async function stateMatches(expected: string, given: string | null | undefined): Promise<boolean> {
  if (!given) return false;
  const [a, b] = await Promise.all([sha256(expected), sha256(given)]);
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

export interface TokenSet {
  accessToken: string;
  /** Absent when the account did not grant offline_access; the connection then lasts about an hour. */
  refreshToken: string | null;
  expiresInSeconds: number;
}

/** A refusal from the token endpoint. Carries Microsoft's error code (e.g. invalid_grant), never a token. */
export class TokenEndpointError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(`Microsoft token endpoint refused the request: ${code} (HTTP ${status})`);
    this.name = "TokenEndpointError";
    this.code = code;
    this.status = status;
  }
}

export function exchangeCode(
  config: MicrosoftConfig,
  grant: { code: string; verifier: string; redirectUri: string },
  fetchFn: FetchFn,
): Promise<TokenSet> {
  return requestTokens(config, { grant_type: "authorization_code", code: grant.code, redirect_uri: grant.redirectUri, code_verifier: grant.verifier }, fetchFn);
}

export function refreshTokens(config: MicrosoftConfig, refreshToken: string, fetchFn: FetchFn): Promise<TokenSet> {
  return requestTokens(config, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchFn);
}

async function requestTokens(config: MicrosoftConfig, grant: Record<string, string>, fetchFn: FetchFn): Promise<TokenSet> {
  const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, scope: SCOPES, ...grant });
  let res: Response;
  try {
    res = await fetchFn(`${LOGIN_BASE}/${encodeURIComponent(config.tenant)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    });
  } catch {
    throw new TokenEndpointError("network_error", 0);
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || typeof json?.access_token !== "string" || !json.access_token) {
    throw new TokenEndpointError(typeof json?.error === "string" ? json.error.slice(0, 60) : "unexpected_response", res.status);
  }
  const lifetime = Number(json.expires_in);
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === "string" && json.refresh_token ? json.refresh_token : null,
    expiresInSeconds: Number.isFinite(lifetime)
      ? Math.min(Math.max(lifetime, MIN_TOKEN_LIFETIME_SECONDS), MAX_TOKEN_LIFETIME_SECONDS)
      : DEFAULT_TOKEN_LIFETIME_SECONDS,
  };
}
