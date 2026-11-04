// Microsoft 365 (OneDrive and SharePoint): status, the PKCE sign-in and its callback, sealed token storage
// and refresh, Graph browse/download mapping against canned JSON, and the per-building import.
// Real Microsoft sign-in needs an app registration, so Microsoft is always a stubbed fetch here.

import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { getAgentByName } from "agents";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocMeta, OneDriveImportResult, OneDriveListing, OneDriveStatus, SearchHit } from "../shared/types";
import { withSetting } from "../worker/ai/switch";
import { app } from "../worker/api";
import { fromBase64Url, sha256, toBase64Url } from "../worker/auth";
import { browse, downloadForImport, GRAPH_BASE, MAX_LISTED_ITEMS } from "../worker/integrations/graph";
import { CALLBACK_PATH, microsoftConfig, SCOPES, STATE_COOKIE, type FetchFn } from "../worker/integrations/onedrive-oauth";
import { finishCallback, importItems } from "../worker/integrations/onedrive-routes";
import {
  currentAccessToken,
  loadTokens,
  openTokens,
  saveTokens,
  sealTokens,
  TOKENS_KEY,
  type StoredTokens,
} from "../worker/integrations/onedrive-tokens";
import { call, callJson, login, loginAndSeed, ORIGIN, PILOT, tag } from "./helpers";

const FILES_TAB = `/buildings/${PILOT}/files`;
const IMPORT_PATH = `/api/properties/${PILOT}/integrations/onedrive/import`;
const MB = 1024 * 1024;

/** The shared env with the Microsoft app registration switched on: a view, never a mutation of `env`. */
function msEnv(overrides: Record<string, string> = {}): Env {
  let view = env;
  const settings = { MS_CLIENT_ID: "test-client-id", MS_CLIENT_SECRET: "test-client-secret", ...overrides };
  for (const [key, value] of Object.entries(settings)) view = withSetting(view, key as keyof Env & string, value);
  return view;
}

async function appFetch(envView: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request(`${ORIGIN}${path}`, init), envView, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

interface StubCall {
  url: string;
  init: RequestInit;
}

/** A fetch that answers from `handler` and records every call. */
function stubFetch(handler: (url: URL, init: RequestInit) => Response | Promise<Response>): { fn: FetchFn; calls: StubCall[] } {
  const calls: StubCall[] = [];
  const fn: FetchFn = async (input, init = {}) => {
    calls.push({ url: input, init });
    return handler(new URL(input), init);
  };
  return { fn, calls };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function header(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name);
}

/** Starts sign-in as a signed-in member of staff; returns Microsoft's URL and the state cookie. */
async function startSignIn(session: string, returnTo = FILES_TAB): Promise<{ authorize: URL; stateCookie: string; setCookie: string }> {
  const res = await appFetch(msEnv(), `/api/integrations/onedrive/connect?return=${encodeURIComponent(returnTo)}`, { headers: { Cookie: session } });
  expect(res.status).toBe(302);
  const setCookie = res.headers.get("Set-Cookie") ?? "";
  const stateCookie = setCookie.split(";")[0]!.slice(`${STATE_COOKIE}=`.length);
  return { authorize: new URL(res.headers.get("Location")!), stateCookie, setCookie };
}

function decodeStateCookie(cookie: string): { s: string; v: string; r: string; exp: number } {
  return JSON.parse(new TextDecoder().decode(fromBase64Url(cookie.split(".")[0]!)!));
}

function sampleTokens(overrides: Partial<StoredTokens> = {}): StoredTokens {
  return {
    accessToken: "access-token-plaintext-1",
    refreshToken: "refresh-token-plaintext-1",
    expiresAt: Date.now() + 60 * 60 * 1000,
    account: { name: "Daniel Sample", email: "daniel@example.com" },
    connectedBy: "Token Tester",
    connectedAt: new Date().toISOString(),
    ...overrides,
  };
}

afterEach(async () => {
  await env.VAULT.delete(TOKENS_KEY);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("Microsoft 365 connection", () => {
  it("reports configured: false without the secrets, and every route needs a session", async () => {
    const cookie = await login("Status Tester");
    expect(await callJson<OneDriveStatus>("/api/integrations/onedrive/status", { cookie })).toEqual({ configured: false, connected: false });
    expect((await call("/api/integrations/onedrive/status")).status).toBe(401);
    expect((await call("/api/integrations/onedrive/connect")).status).toBe(401);
    expect((await call("/api/integrations/onedrive/browse?source=me")).status).toBe(401);

    // Signed in but not configured: back to the hub with a reason, not off to Microsoft. (app.fetch directly:
    // the loopback fetch in `call` follows redirects.)
    const res = await appFetch(env, "/api/integrations/onedrive/connect", { headers: { Cookie: cookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/?onedrive=error&reason=not_configured");

    // A tenant that isn't a tenant id or domain leaves it off too.
    expect(microsoftConfig(msEnv({ MS_TENANT: "../evil" }))).toBeNull();
    expect(microsoftConfig(msEnv())?.tenant).toBe("common");
  });

  it("connect sends staff to Microsoft with PKCE S256, a state and the scopes, and sets a short-lived signed cookie", async () => {
    const session = await login("Connect Tester");
    const { authorize, stateCookie, setCookie } = await startSignIn(session);

    expect(authorize.origin).toBe("https://login.microsoftonline.com");
    expect(authorize.pathname).toBe("/common/oauth2/v2.0/authorize");
    const params = authorize.searchParams;
    expect(params.get("client_id")).toBe("test-client-id");
    expect(params.get("response_type")).toBe("code");
    expect(params.get("redirect_uri")).toBe(`${ORIGIN}${CALLBACK_PATH}`);
    expect(params.get("scope")).toBe("offline_access User.Read Files.Read.All Sites.Read.All");
    expect(params.get("scope")).toBe(SCOPES);
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.has("client_secret")).toBe(false);

    // HttpOnly, Secure (not localhost), SameSite=Lax, ten minutes, only sent to the OneDrive routes.
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Max-Age=600/);
    expect(setCookie).toMatch(/Path=\/api\/integrations\/onedrive/);

    // The cookie holds the same state and the verifier behind the challenge.
    const saved = decodeStateCookie(stateCookie);
    expect(saved.s).toBe(params.get("state"));
    expect(toBase64Url(await sha256(saved.v))).toBe(params.get("code_challenge"));
    expect(saved.r).toBe(FILES_TAB);
    expect(JSON.stringify(saved)).not.toContain("test-client-secret");

    // Two sign-ins never share a state or verifier.
    const again = decodeStateCookie((await startSignIn(session)).stateCookie);
    expect(again.s).not.toBe(saved.s);
    expect(again.v).not.toBe(saved.v);

    // Only a building's Files tab is a return target; anything else returns to the portfolio.
    expect(decodeStateCookie((await startSignIn(session, "https://evil.example/")).stateCookie).r).toBe("/");
    expect(decodeStateCookie((await startSignIn(session, "//evil.example/buildings/sp-26707/files")).stateCookie).r).toBe("/");

    // MS_TENANT narrows sign-in to one organisation.
    const tenant = await appFetch(msEnv({ MS_TENANT: "ikon.example.com" }), "/api/integrations/onedrive/connect", { headers: { Cookie: session } });
    expect(new URL(tenant.headers.get("Location")!).pathname).toBe("/ikon.example.com/oauth2/v2.0/authorize");
  });

  it("the callback rejects a wrong or missing state (and a missing session) and never redeems the code", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const session = await login("Callback Tester");
    const { authorize, stateCookie } = await startSignIn(session);
    const state = authorize.searchParams.get("state")!;
    const callback = (query: string, cookies: string) =>
      appFetch(msEnv(), `${CALLBACK_PATH}?${query}`, { headers: cookies ? { Cookie: cookies } : {} });
    const both = `${session}; ${STATE_COOKIE}=${stateCookie}`;

    const wrong = await callback(`code=abc&state=${"x".repeat(43)}`, both);
    expect(wrong.status).toBe(302);
    expect(wrong.headers.get("Location")).toBe(`${FILES_TAB}?onedrive=error&reason=state`);
    // The state cookie is cleared whatever happened.
    expect(wrong.headers.get("Set-Cookie")).toMatch(new RegExp(`^${STATE_COOKIE}=;.*Max-Age=0`));

    const noState = await callback("code=abc", both);
    expect(noState.headers.get("Location")).toBe(`${FILES_TAB}?onedrive=error&reason=state`);

    const noCookie = await callback(`code=abc&state=${state}`, session);
    expect(noCookie.headers.get("Location")).toBe("/?onedrive=error&reason=state");

    // A cookie whose payload was swapped (signature kept) is not trusted.
    const [, signature] = stateCookie.split(".");
    const forged = toBase64Url(new TextEncoder().encode(JSON.stringify({ ...decodeStateCookie(stateCookie), s: "attacker" })));
    const tampered = await callback(`code=abc&state=attacker`, `${session}; ${STATE_COOKIE}=${forged}.${signature}`);
    expect(tampered.headers.get("Location")).toBe("/?onedrive=error&reason=state");

    // Reachable without a session (Microsoft redirects here), but it needs one to finish.
    const signedOut = await callback(`code=abc&state=${state}`, `${STATE_COOKIE}=${stateCookie}`);
    expect(signedOut.status).toBe(302);
    expect(signedOut.headers.get("Location")).toBe(`${FILES_TAB}?onedrive=error&reason=signin`);

    const denied = await callback(`error=access_denied&error_description=nope&state=${state}`, both);
    expect(denied.headers.get("Location")).toBe(`${FILES_TAB}?onedrive=error&reason=denied`);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await env.VAULT.get(TOKENS_KEY)).toBeNull();
  });

  it("a good callback redeems the code with the PKCE verifier, stores the tokens sealed, and disconnect removes them", async () => {
    const session = await login("Daniel Tester");
    const { authorize, stateCookie } = await startSignIn(session);
    const state = authorize.searchParams.get("state")!;
    const verifier = decodeStateCookie(stateCookie).v;

    const microsoft = stubFetch(async (url, init) => {
      if (url.pathname === "/common/oauth2/v2.0/token") {
        const form = new URLSearchParams(String(init.body));
        expect(init.method).toBe("POST");
        expect(Object.fromEntries(form)).toMatchObject({
          grant_type: "authorization_code",
          code: "the-code",
          code_verifier: verifier,
          client_id: "test-client-id",
          client_secret: "test-client-secret",
          redirect_uri: `${ORIGIN}${CALLBACK_PATH}`,
          scope: SCOPES,
        });
        return json({ access_token: "at-plaintext-1", refresh_token: "rt-plaintext-1", expires_in: 3600, token_type: "Bearer" });
      }
      if (url.href.startsWith(`${GRAPH_BASE}/me?`)) {
        expect(header(init, "Authorization")).toBe("Bearer at-plaintext-1");
        return json({ displayName: "Daniel Sample", mail: "daniel@example.com" });
      }
      return json({ error: { code: "unexpected" } }, 500);
    });

    const request = new Request(`${ORIGIN}${CALLBACK_PATH}?code=the-code&state=${state}`, { headers: { Cookie: session } });
    expect(await finishCallback(msEnv(), request, stateCookie, microsoft.fn)).toEqual({ returnTo: FILES_TAB, failure: null });
    expect(microsoft.calls).toHaveLength(2);

    const status = await appFetch(msEnv(), "/api/integrations/onedrive/status", { headers: { Cookie: session } });
    expect(await status.json()).toEqual({ configured: true, connected: true, account: { name: "Daniel Sample", email: "daniel@example.com" } });

    const stored = await (await env.VAULT.get(TOKENS_KEY))!.text();
    for (const secret of ["at-plaintext-1", "rt-plaintext-1", "Daniel", "daniel@example.com"]) expect(stored).not.toContain(secret);

    // Disconnect is a mutation: same-origin with an Origin header, JSON.
    const noOrigin = await appFetch(msEnv(), "/api/integrations/onedrive/disconnect", {
      method: "POST",
      headers: { Cookie: session, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(noOrigin.status).toBe(403);
    const off = await appFetch(msEnv(), "/api/integrations/onedrive/disconnect", {
      method: "POST",
      headers: { Cookie: session, "Content-Type": "application/json", Origin: ORIGIN },
      body: "{}",
    });
    expect(await off.json()).toEqual({ configured: true, connected: false });
    expect(await env.VAULT.get(TOKENS_KEY)).toBeNull();
  });

  it("a refused code exchange redirects with a safe reason and stores nothing", async () => {
    const session = await login("Exchange Tester");
    const { authorize, stateCookie } = await startSignIn(session);
    const microsoft = stubFetch(() => json({ error: "invalid_client", error_description: "AADSTS7000215: Invalid client secret" }, 401));
    const request = new Request(`${ORIGIN}${CALLBACK_PATH}?code=c&state=${authorize.searchParams.get("state")}`, { headers: { Cookie: session } });
    expect(await finishCallback(msEnv(), request, stateCookie, microsoft.fn)).toEqual({ returnTo: FILES_TAB, failure: "exchange" });
    expect(await env.VAULT.get(TOKENS_KEY)).toBeNull();
  });
});

describe("Microsoft 365 token storage", () => {
  it("round-trips through AES-GCM; the ciphertext holds no plaintext and opens only under the same secret", async () => {
    const tokens = sampleTokens();
    const sealed = await sealTokens("secret-one", tokens);
    for (const plaintext of [tokens.accessToken, tokens.refreshToken!, tokens.account.name, tokens.account.email!]) {
      expect(sealed).not.toContain(plaintext);
    }
    expect(await openTokens("secret-one", sealed)).toEqual(tokens);
    // A fresh IV each time.
    expect(await sealTokens("secret-one", tokens)).not.toBe(sealed);

    // Another secret (SESSION_SECRET rotated) or a flipped byte: unreadable, never an exception.
    expect(await openTokens("secret-two", sealed)).toBeNull();
    const envelope = JSON.parse(sealed);
    const ct = fromBase64Url(envelope.ct)!;
    ct[0] = ct[0]! ^ 1;
    expect(await openTokens("secret-one", JSON.stringify({ ...envelope, ct: toBase64Url(ct) }))).toBeNull();
    expect(await openTokens("secret-one", "not json")).toBeNull();

    // In R2 under the integrations key.
    await saveTokens(env, "secret-one", tokens);
    const object = await env.VAULT.get(TOKENS_KEY);
    expect(await object!.text()).not.toContain(tokens.accessToken);
    expect(await loadTokens(env, "secret-one")).toEqual(tokens);
  });

  it("refreshes a token within five minutes of expiry and keeps the rotated refresh token", async () => {
    const view = msEnv();
    const config = microsoftConfig(view)!;
    const now = Date.now();

    // Plenty of time left: no call to Microsoft.
    await saveTokens(view, config.secret, sampleTokens({ expiresAt: now + 30 * 60 * 1000 }));
    const idle = stubFetch(() => json({}, 500));
    expect((await currentAccessToken(view, config, idle.fn, now)).accessToken).toBe("access-token-plaintext-1");
    expect(idle.calls).toHaveLength(0);

    await saveTokens(view, config.secret, sampleTokens({ expiresAt: now + 2 * 60 * 1000 }));
    const microsoft = stubFetch((url, init) => {
      expect(url.pathname).toBe("/common/oauth2/v2.0/token");
      const form = new URLSearchParams(String(init.body));
      expect(form.get("grant_type")).toBe("refresh_token");
      expect(form.get("refresh_token")).toBe("refresh-token-plaintext-1");
      return json({ access_token: "access-token-2", refresh_token: "refresh-token-2", expires_in: 3600 });
    });
    const fresh = await currentAccessToken(view, config, microsoft.fn, now);
    expect(fresh.accessToken).toBe("access-token-2");
    expect(fresh.expiresAt).toBe(now + 3600 * 1000);
    expect(fresh.account.name).toBe("Daniel Sample");
    const reloaded = await loadTokens(view, config.secret);
    expect(reloaded?.refreshToken).toBe("refresh-token-2");
    expect(reloaded?.accessToken).toBe("access-token-2");
  });

  it("a refresh refused with invalid_grant deletes the stored sign-in, so the hub reads disconnected", async () => {
    const view = msEnv();
    const config = microsoftConfig(view)!;
    const session = await login("Expiry Tester");
    await saveTokens(view, config.secret, sampleTokens({ expiresAt: Date.now() - 1000 }));
    const microsoft = stubFetch(() => json({ error: "invalid_grant", error_description: "AADSTS70008: expired" }, 400));

    await expect(currentAccessToken(view, config, microsoft.fn)).rejects.toMatchObject({ status: 409 });
    expect(await env.VAULT.get(TOKENS_KEY)).toBeNull();
    const status = await appFetch(view, "/api/integrations/onedrive/status", { headers: { Cookie: session } });
    expect(await status.json()).toEqual({ configured: true, connected: false });
  });

  it("a passing outage keeps using a token that has not expired yet", async () => {
    const view = msEnv();
    const config = microsoftConfig(view)!;
    await saveTokens(view, config.secret, sampleTokens({ expiresAt: Date.now() + 60 * 1000 }));
    const down = stubFetch(() => json({ error: "temporarily_unavailable" }, 503));
    expect((await currentAccessToken(view, config, down.fn)).accessToken).toBe("access-token-plaintext-1");
    expect(await loadTokens(view, config.secret)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("Microsoft Graph browse mapping", () => {
  const folder = (id: string, name: string, childCount: number) => ({
    id,
    name,
    folder: { childCount },
    size: 4096,
    lastModifiedDateTime: "2026-10-01T02:00:00Z",
    webUrl: `https://ikon-my.sharepoint.com/${id}`,
    parentReference: { driveId: "b!drive-1", id: "root" },
  });
  const file = (id: string, name: string, size: number, mimeType = "application/pdf") => ({
    id,
    name,
    file: { mimeType },
    size,
    lastModifiedDateTime: "2026-10-02T03:00:00Z",
    webUrl: `https://ikon-my.sharepoint.com/${id}`,
    parentReference: { driveId: "b!drive-1", id: "root" },
  });

  it("lists OneDrive folders first, follows nextLink, leaves out packages, and never sends the token elsewhere", async () => {
    const graph = stubFetch((url, init) => {
      expect(header(init, "Authorization")).toBe("Bearer graph-token");
      if (url.pathname === "/v1.0/me/drive/root/children" && !url.searchParams.has("$skiptoken")) {
        expect(url.searchParams.get("$select")).toContain("parentReference");
        return json({
          value: [
            file("F1", "Budget 2026.xlsx", 52_000, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            folder("D2", "Strata plans", 16),
            { id: "P3", name: "Meeting notes", package: { type: "oneNote" }, parentReference: { driveId: "b!drive-1" } },
          ],
          "@odata.nextLink": `${GRAPH_BASE}/me/drive/root/children?$skiptoken=page2`,
        });
      }
      if (url.searchParams.get("$skiptoken") === "page2") return json({ value: [folder("D1", "01 Plan & By-laws", 3)] });
      if (url.pathname === "/v1.0/drives/b!drive-1/items/D2/children") return json({ value: [file("F4", "SP 26707 strata plan.pdf", 900_000)] });
      return json({ error: { code: "itemNotFound" } }, 404);
    });

    const listing = await browse(graph.fn, "graph-token", { source: "me" });
    expect(listing.truncated).toBe(false);
    expect(listing.items.map((i) => [i.kind, i.name])).toEqual([
      ["folder", "01 Plan & By-laws"],
      ["folder", "Strata plans"],
      ["file", "Budget 2026.xlsx"],
    ]);
    expect(listing.items[1]).toEqual({
      id: "D2",
      driveId: "b!drive-1",
      name: "Strata plans",
      kind: "folder",
      size: 4096,
      mimeType: null,
      modified: "2026-10-01T02:00:00Z",
      webUrl: "https://ikon-my.sharepoint.com/D2",
      childCount: 16,
    });
    expect(listing.items[2]).toMatchObject({ id: "F1", kind: "file", size: 52_000, childCount: null, mimeType: expect.stringContaining("spreadsheetml") });

    // A folder by drive and item id.
    const inside = await browse(graph.fn, "graph-token", { source: "me", driveId: "b!drive-1", itemId: "D2" });
    expect(new URL(graph.calls.at(-1)!.url).pathname).toBe("/v1.0/drives/b!drive-1/items/D2/children");
    expect(inside.items).toEqual([expect.objectContaining({ id: "F4", kind: "file", driveId: "b!drive-1" })]);

    // A nextLink that leaves Graph is not followed, and the listing says it is partial.
    const leaky = stubFetch((url) =>
      url.hostname === "graph.microsoft.com"
        ? json({ value: [file("F9", "a.pdf", 10)], "@odata.nextLink": "https://evil.example/steal?token" })
        : json({ value: [] }),
    );
    const partial = await browse(leaky.fn, "graph-token", { source: "me" });
    expect(partial).toMatchObject({ truncated: true, items: [{ id: "F9" }] });
    expect(leaky.calls.map((c) => new URL(c.url).hostname)).toEqual(["graph.microsoft.com"]);
  });

  it("SharePoint: sites, then a site's document libraries, then folders inside a library", async () => {
    const siteId = "ikon.sharepoint.com,2c712604-1370-44e7-a1f5-426573fda80a,2d2244c3-251a-49ea-93a8-39e1c3a060fe";
    const graph = stubFetch((url) => {
      if (url.pathname === "/v1.0/sites" && url.searchParams.get("search") === "*") {
        return json({
          value: [
            { id: siteId, displayName: "Operations", webUrl: "https://ikon.sharepoint.com/sites/Operations", lastModifiedDateTime: "2026-09-09T00:00:00Z" },
            { id: "ikon.sharepoint.com,a,b", displayName: "Accounts", webUrl: "https://ikon.sharepoint.com/sites/Accounts" },
          ],
        });
      }
      if (url.pathname === `/v1.0/sites/${encodeURIComponent(siteId)}/drives`) {
        return json({ value: [{ id: "b!ops-docs", name: "Documents", driveType: "documentLibrary", webUrl: "https://ikon.sharepoint.com/sites/Operations/Shared Documents" }] });
      }
      if (url.pathname === "/v1.0/drives/b!ops-docs/root/children") {
        return json({ value: [{ ...folder("SP26707", "SP 26707 - 34 Davies Road", 8), parentReference: { driveId: "b!ops-docs", siteId } }] });
      }
      return json({ error: { code: "itemNotFound" } }, 404);
    });

    const sites = await browse(graph.fn, "t", { source: "sites" });
    expect(sites.items.map((s) => [s.kind, s.name])).toEqual([
      ["site", "Accounts"],
      ["site", "Operations"],
    ]);
    expect(sites.items[1]).toMatchObject({ id: siteId, siteId, driveId: null, webUrl: "https://ikon.sharepoint.com/sites/Operations" });

    const libraries = await browse(graph.fn, "t", { source: "sites", siteId });
    expect(libraries.items).toEqual([
      expect.objectContaining({ id: "b!ops-docs", driveId: "b!ops-docs", siteId, kind: "drive", name: "Documents" }),
    ]);

    const inside = await browse(graph.fn, "t", { source: "sites", siteId, driveId: "b!ops-docs" });
    expect(inside.items).toEqual([expect.objectContaining({ id: "SP26707", kind: "folder", driveId: "b!ops-docs", siteId, childCount: 8 })]);
  });

  it("stops at the item limit and says the listing is truncated", async () => {
    let page = 0;
    const graph = stubFetch(() => {
      page += 1;
      const value = Array.from({ length: 200 }, (_, i) => ({
        id: `F${page}-${i}`,
        name: `file ${page}-${i}.pdf`,
        file: { mimeType: "application/pdf" },
        size: 100,
        parentReference: { driveId: "b!big" },
      }));
      return json({ value, "@odata.nextLink": `${GRAPH_BASE}/drives/b!big/root/children?$skiptoken=${page}` });
    });
    const listing = await browse(graph.fn, "t", { source: "me", driveId: "b!big" });
    expect(listing.items).toHaveLength(MAX_LISTED_ITEMS);
    expect(listing.truncated).toBe(true);
    expect(graph.calls).toHaveLength(3);
  });
});

describe("Microsoft Graph download for import", () => {
  const ref = { driveId: "b!drive-1", itemId: "ITEM1" };

  it("follows /content's redirect without the token, and skips folders and large files before downloading", async () => {
    const graph = stubFetch((url, init) => {
      if (url.hostname === "graph.microsoft.com" && url.pathname === "/v1.0/drives/b!drive-1/items/ITEM1") {
        return json({ id: "ITEM1", name: "Fire safety plan.txt", size: 28, file: { mimeType: "text/plain" } });
      }
      if (url.pathname === "/v1.0/drives/b!drive-1/items/ITEM1/content") {
        expect(init.redirect).toBe("manual");
        expect(header(init, "Authorization")).toBe("Bearer t");
        return new Response(null, { status: 302, headers: { Location: "https://ikon.sharepoint.com/_layouts/15/download.aspx?tempauth=abc" } });
      }
      if (url.hostname === "ikon.sharepoint.com") {
        expect(header(init, "Authorization")).toBeNull();
        return new Response("Evacuate via the north stairs");
      }
      return json({ error: { code: "itemNotFound" } }, 404);
    });
    const result = await downloadForImport(graph.fn, "t", ref, 25 * MB);
    expect(result.kind).toBe("file");
    if (result.kind !== "file") return;
    expect(result.name).toBe("Fire safety plan.txt");
    expect(result.mimeType).toBe("text/plain");
    expect(new TextDecoder().decode(result.bytes)).toBe("Evacuate via the north stairs");

    const meta = (body: unknown) => stubFetch((url) => (url.pathname.endsWith("/content") ? new Response("should not download") : json(body)));
    const folderMeta = meta({ id: "ITEM1", name: "Strata plans", folder: { childCount: 16 } });
    expect(await downloadForImport(folderMeta.fn, "t", ref, 25 * MB)).toMatchObject({ kind: "skipped", name: "Strata plans", reason: expect.stringMatching(/^Folder/) });
    expect(folderMeta.calls).toHaveLength(1);

    const bigMeta = meta({ id: "ITEM1", name: "Drone survey.mp4", size: 300 * MB, file: { mimeType: "video/mp4" } });
    expect(await downloadForImport(bigMeta.fn, "t", ref, 25 * MB)).toEqual({ kind: "skipped", name: "Drone survey.mp4", reason: "Larger than 25 MB" });
    expect(bigMeta.calls).toHaveLength(1);

    // The metadata said small, the body was not: the cap holds while streaming.
    const liar = stubFetch((url) =>
      url.pathname.endsWith("/content") ? new Response("x".repeat(64)) : json({ id: "ITEM1", name: "small.txt", size: 5, file: {} }),
    );
    expect(await downloadForImport(liar.fn, "t", ref, 32)).toMatchObject({ kind: "skipped", reason: "Larger than 32 bytes" });
  });

  it("imports into a building through the upload path: stored, indexed, labelled as from OneDrive", async () => {
    const cookie = await loginAndSeed("Import Tester");
    const word = `quokkaline${tag()}`;
    const content = `Annual fire safety plan.\n\nThe ${word} assembly point is the front lawn.\n`;
    const graph = stubFetch((url) => {
      const path = url.pathname;
      if (url.hostname === "download.example.com") return new Response(content);
      if (path === "/v1.0/drives/b!d/items/GOOD") return json({ id: "GOOD", name: "Fire safety plan 2026.txt", size: content.length, file: { mimeType: "text/plain" } });
      if (path === "/v1.0/drives/b!d/items/GOOD/content") return new Response(null, { status: 302, headers: { Location: "https://download.example.com/f?sig=1" } });
      if (path === "/v1.0/drives/b!d/items/DIR") return json({ id: "DIR", name: "Insurance", folder: { childCount: 4 } });
      if (path === "/v1.0/drives/b!d/items/BIG") return json({ id: "BIG", name: "Survey.mp4", size: 40 * MB, file: { mimeType: "video/mp4" } });
      return json({ error: { code: "itemNotFound", message: "The resource could not be found." } }, 404);
    });

    const agent = await getAgentByName(env.PropertyAgent, PILOT);
    const refs = ["GOOD", "DIR", "BIG", "GONE"].map((itemId) => ({ driveId: "b!d", itemId }));
    const results = await importItems(env, { propertyId: PILOT, agent, staffName: "Import Tester" }, refs, "06 Compliance & Safety", "t", graph.fn);
    expect(results.map((r: OneDriveImportResult) => [r.itemId, r.status])).toEqual([
      ["GOOD", "imported"],
      ["DIR", "skipped"],
      ["BIG", "skipped"],
      ["GONE", "failed"],
    ]);
    expect(results[1]!.reason).toMatch(/^Folder/);
    expect(results[2]!.reason).toBe("Larger than 25 MB");
    expect(results[3]!.reason).toMatch(/Not found/);

    const docs = await callJson<DocMeta[]>(`/api/properties/${PILOT}/docs`, { cookie });
    const doc = docs.find((d) => d.id === results[0]!.docId)!;
    expect(doc).toMatchObject({
      name: "Fire safety plan 2026.txt",
      folder: "06 Compliance & Safety",
      uploadedBy: "Import Tester (from OneDrive)",
      indexed: "full",
      scope: "building",
      sample: false,
      size: content.length,
    });
    expect(doc.r2Key.startsWith(`${PILOT}/06 Compliance & Safety/`)).toBe(true);
    expect(await (await env.VAULT.get(doc.r2Key))!.text()).toBe(content);
    // A staff import is a trusted record: the agents' own search finds it.
    const hits = await agent.searchDocs(word);
    expect(hits.map((h: SearchHit) => h.docId)).toContain(doc.id);
  });
});

describe("Microsoft 365 routes: validation and CSRF", () => {
  const valid = { items: [{ driveId: "b!drive-1", itemId: "01ABC" }], folder: "02 Insurance" };

  it("the import endpoint rejects bad folders, bad ids, too many items, non-JSON bodies and a missing or foreign Origin", async () => {
    const cookie = await loginAndSeed("Guard Tester");
    const post = (opts: Parameters<typeof call>[1]) => call(IMPORT_PATH, { cookie, ...opts });

    const badFolder = await post({ json: { ...valid, folder: "99 Not a folder" } });
    expect(badFolder.status).toBe(400);
    expect((await badFolder.json<{ error: string }>()).error).toMatch(/^folder/);
    expect((await post({ json: { ...valid, items: [{ driveId: "..", itemId: "01ABC" }] } })).status).toBe(400);
    expect((await post({ json: { ...valid, items: [{ driveId: "b!d", itemId: "a/b" }] } })).status).toBe(400);
    expect((await post({ json: { ...valid, items: [] } })).status).toBe(400);
    const many = Array.from({ length: 26 }, (_, i) => ({ driveId: "b!d", itemId: `I${i}` }));
    expect((await post({ json: { ...valid, items: many } })).status).toBe(400);

    expect((await post({ body: JSON.stringify(valid), headers: { "Content-Type": "text/plain" } })).status).toBe(415);
    expect((await post({ body: "items=1&folder=02", headers: { "Content-Type": "application/x-www-form-urlencoded" } })).status).toBe(415);
    expect((await post({ body: "{not json", headers: { "Content-Type": "application/json" } })).status).toBe(400);

    const noOrigin = await post({ json: valid, origin: null });
    expect(noOrigin.status).toBe(403);
    const foreign = await post({ json: valid, origin: "https://evil.example" });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({ error: "Cross-origin request blocked" });

    expect((await call(IMPORT_PATH, { json: valid })).status).toBe(401);
    expect((await call("/api/properties/sp-99999/integrations/onedrive/import", { cookie, json: valid })).status).toBe(404);

    // A valid request on a hub without the app registration, then with it but not signed in.
    const unconfigured = await post({ json: valid });
    expect(unconfigured.status).toBe(409);
    expect((await unconfigured.json<{ error: string }>()).error).toMatch(/isn't set up/);
    const notConnected = await appFetch(msEnv(), IMPORT_PATH, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify(valid),
    });
    expect(notConnected.status).toBe(409);
    expect((await notConnected.json<{ error: string }>()).error).toMatch(/not connected/);
  });

  it("browse needs a connection and validates its query", async () => {
    const cookie = await login("Browse Tester");
    expect((await call("/api/integrations/onedrive/browse?source=me", { cookie })).status).toBe(409);
    const get = (query: string) => appFetch(msEnv(), `/api/integrations/onedrive/browse?${query}`, { headers: { Cookie: cookie } });
    expect((await get("source=me")).status).toBe(409);
    expect((await get("source=dropbox")).status).toBe(400);
    expect((await get("source=me&itemId=01ABC")).status).toBe(400);
    expect((await get("source=me&driveId=..&itemId=x")).status).toBe(400);

    // Connected, but Microsoft rejects the token: a 409 for the picker, never a 401 that would sign staff out of the hub.
    const config = microsoftConfig(msEnv())!;
    await saveTokens(env, config.secret, sampleTokens());
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ error: { code: "InvalidAuthenticationToken" } }, 401));
    const expired = await get("source=me");
    expect(expired.status).toBe(409);
    expect((await expired.json<{ error: string }>()).error).toMatch(/expired/);
  });
});

describe("Microsoft 365 listing shape", () => {
  it("the browse route returns the trimmed shape from Graph", async () => {
    const cookie = await login("Shape Tester");
    const config = microsoftConfig(msEnv())!;
    await saveTokens(env, config.secret, sampleTokens());
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.hostname).toBe("graph.microsoft.com");
      return json({ value: [{ id: "F1", name: "By-laws.pdf", size: 1234, file: { mimeType: "application/pdf" }, parentReference: { driveId: "b!x" } }] });
    });
    const res = await appFetch(msEnv(), "/api/integrations/onedrive/browse?source=me", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(await res.json<OneDriveListing>()).toEqual({
      items: [{ id: "F1", driveId: "b!x", name: "By-laws.pdf", kind: "file", size: 1234, mimeType: "application/pdf", modified: null, webUrl: null, childCount: null }],
      truncated: false,
    });
  });
});
