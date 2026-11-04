// The hub's Microsoft 365 sign-in at rest: one token set, sealed with AES-256-GCM under a key derived
// (HKDF-SHA256) from SESSION_SECRET, kept in the VAULT bucket. R2 rather than a Durable Object, so the
// agent classes and their migrations stay untouched. Tokens are never logged or sent to the browser.

import { HTTPException } from "hono/http-exception";
import type { OneDriveAccount } from "../../shared/types";
import { fromBase64Url, toBase64Url } from "../auth";
import { fetchAccount } from "./graph";
import { exchangeCode, refreshTokens, TokenEndpointError, type FetchFn, type MicrosoftConfig, type TokenSet } from "./onedrive-oauth";

export const TOKENS_KEY = "integrations/onedrive.json.enc";
/** HKDF context: a key for these tokens and nothing else, even though the secret also signs sessions. */
const KEY_INFO = "ikonsm-onedrive-tokens";
const KEY_SALT = "ikonsm-command-hub";
/** Refresh this long before the access token expires, so a long import doesn't run out part-way. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface StoredTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds. */
  expiresAt: number;
  account: OneDriveAccount;
  connectedBy: string;
  connectedAt: string;
}

interface SealedEnvelope {
  v: 1;
  alg: "A256GCM";
  iv: string;
  ct: string;
}

// ---------------------------------------------------------------------------
// Sealing
// ---------------------------------------------------------------------------

/** Derived keys per secret; only resolved keys are cached, and a rotated secret replaces the old key. */
const sealingKeys = new Map<string, CryptoKey>();

async function sealingKey(secret: string): Promise<CryptoKey> {
  const cached = sealingKeys.get(secret);
  if (cached) return cached;
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode(KEY_SALT), info: encoder.encode(KEY_INFO) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  sealingKeys.clear();
  sealingKeys.set(secret, key);
  return key;
}

/** The object's key is the associated data, so a sealed blob only opens where it was written. */
export async function sealTokens(secret: string, tokens: StoredTokens): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(tokens));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(TOKENS_KEY) },
    await sealingKey(secret),
    plaintext,
  );
  const envelope: SealedEnvelope = { v: 1, alg: "A256GCM", iv: toBase64Url(iv), ct: toBase64Url(new Uint8Array(ciphertext)) };
  return JSON.stringify(envelope);
}

/** The tokens, or null if the blob is damaged or was sealed under another secret (SESSION_SECRET rotated). */
export async function openTokens(secret: string, sealed: string): Promise<StoredTokens | null> {
  try {
    const envelope = JSON.parse(sealed) as Partial<SealedEnvelope>;
    if (envelope.v !== 1 || envelope.alg !== "A256GCM" || typeof envelope.iv !== "string" || typeof envelope.ct !== "string") return null;
    const iv = fromBase64Url(envelope.iv);
    const ciphertext = fromBase64Url(envelope.ct);
    if (!iv || !ciphertext) return null;
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(TOKENS_KEY) },
      await sealingKey(secret),
      ciphertext,
    );
    return parseTokens(JSON.parse(decoder.decode(plaintext)));
  } catch {
    return null;
  }
}

function parseTokens(value: unknown): StoredTokens | null {
  if (typeof value !== "object" || value === null) return null;
  const t = value as Record<string, unknown>;
  const account = (typeof t.account === "object" && t.account !== null ? t.account : {}) as Record<string, unknown>;
  if (typeof t.accessToken !== "string" || typeof t.expiresAt !== "number" || typeof account.name !== "string") return null;
  return {
    accessToken: t.accessToken,
    refreshToken: typeof t.refreshToken === "string" ? t.refreshToken : null,
    expiresAt: t.expiresAt,
    account: { name: account.name, email: typeof account.email === "string" ? account.email : null },
    connectedBy: typeof t.connectedBy === "string" ? t.connectedBy : "unknown",
    connectedAt: typeof t.connectedAt === "string" ? t.connectedAt : "",
  };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export async function saveTokens(env: Env, secret: string, tokens: StoredTokens): Promise<void> {
  await env.VAULT.put(TOKENS_KEY, await sealTokens(secret, tokens), { httpMetadata: { contentType: "application/json" } });
}

export async function loadTokens(env: Env, secret: string): Promise<StoredTokens | null> {
  const object = await env.VAULT.get(TOKENS_KEY);
  if (!object) return null;
  const tokens = await openTokens(secret, await object.text());
  if (!tokens) console.warn("Microsoft 365: the stored sign-in could not be opened (SESSION_SECRET changed?); connect again");
  return tokens;
}

export async function deleteTokens(env: Env): Promise<void> {
  await env.VAULT.delete(TOKENS_KEY);
}

// ---------------------------------------------------------------------------
// Signing in and staying signed in
// ---------------------------------------------------------------------------

/** Finishes the authorisation-code flow: redeems the code, reads the account and stores the sealed tokens. */
export async function completeSignIn(
  env: Env,
  config: MicrosoftConfig,
  grant: { code: string; verifier: string; redirectUri: string; staffName: string },
  fetchFn: FetchFn,
  nowMs = Date.now(),
): Promise<StoredTokens> {
  const tokens = await exchangeCode(config, grant, fetchFn);
  const stored: StoredTokens = {
    ...fromTokenSet(tokens, null, nowMs),
    account: await fetchAccount(fetchFn, tokens.accessToken),
    connectedBy: grant.staffName,
    connectedAt: new Date(nowMs).toISOString(),
  };
  await saveTokens(env, config.secret, stored);
  return stored;
}

export function notConnected(): HTTPException {
  return new HTTPException(409, { message: "OneDrive is not connected. Use Connect to OneDrive on a building's Files tab." });
}

/**
 * A usable access token, refreshed when it is within five minutes of expiry (the rotated refresh token is
 * stored). A refresh Microsoft refuses for good (invalid_grant: revoked, expired or password changed)
 * deletes the stored sign-in, so the hub shows OneDrive as disconnected instead of failing every call.
 */
export async function currentAccessToken(env: Env, config: MicrosoftConfig, fetchFn: FetchFn, nowMs = Date.now()): Promise<StoredTokens> {
  const stored = await loadTokens(env, config.secret);
  if (!stored) throw notConnected();
  if (stored.expiresAt - nowMs > REFRESH_MARGIN_MS) return stored;

  if (!stored.refreshToken) {
    if (stored.expiresAt > nowMs) return stored;
    await deleteTokens(env);
    throw notConnected();
  }

  try {
    const refreshed: StoredTokens = { ...stored, ...fromTokenSet(await refreshTokens(config, stored.refreshToken, fetchFn), stored.refreshToken, nowMs) };
    await saveTokens(env, config.secret, refreshed);
    return refreshed;
  } catch (err) {
    if (err instanceof TokenEndpointError && err.code === "invalid_grant") {
      console.warn("Microsoft 365: the refresh token was refused (invalid_grant); the stored sign-in is removed");
      await deleteTokens(env);
      throw notConnected();
    }
    // A passing outage: the current token still works for a few minutes, so use it.
    if (stored.expiresAt > nowMs) return stored;
    console.error("Microsoft 365: could not refresh the access token:", err instanceof Error ? err.message : err);
    throw new HTTPException(503, { message: "Microsoft 365 sign-in could not be renewed. Try again in a moment." });
  }
}

/** Microsoft usually rotates the refresh token; when a response leaves it out, the old one stays valid. */
function fromTokenSet(tokens: TokenSet, previousRefreshToken: string | null, nowMs: number): Pick<StoredTokens, "accessToken" | "refreshToken" | "expiresAt"> {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? previousRefreshToken,
    expiresAt: nowMs + tokens.expiresInSeconds * 1000,
  };
}
