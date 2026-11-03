// Staff authentication, session cookies and the request guards (CSRF / content type / body size).

import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../worker/api";
import { createSessionToken, SESSION_TTL_SECONDS, verifySessionToken } from "../worker/auth";
import { call, callJson, login, ORIGIN, PASSCODE, PILOT } from "./helpers";

describe("session and login", () => {
  it("GET /api/health and /api/session work without a session", async () => {
    expect(await callJson("/api/health")).toEqual({ ok: true });

    const session = await callJson("/api/session");
    expect(session).toMatchObject({
      authenticated: false,
      staffName: null,
      authRequired: true,
      aiOnline: false,
      appName: "Ikon Command Hub",
      companyName: "Ikon Strata Management",
      emailDomain: "ikon.example.com",
    });
  });

  it("rejects a wrong passcode with 401 and sets no cookie", async () => {
    const res = await call("/api/login", { json: { passcode: "not-the-passcode", name: "Mallory" } });
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(await res.json()).toEqual({ error: "Incorrect passcode" });
  });

  it("rejects a login with no name (400) or a malformed body (400)", async () => {
    const noName = await call("/api/login", { json: { passcode: PASSCODE, name: "   " } });
    expect(noName.status).toBe(400);
    expect(noName.headers.get("Set-Cookie")).toBeNull();

    const notJson = await call("/api/login", {
      body: "{not json",
      headers: { "Content-Type": "application/json" },
    });
    expect(notJson.status).toBe(400);
  });

  it("logs in with the passcode, sets a hardened session cookie and reports the staff name", async () => {
    const res = await call("/api/login", { json: { passcode: PASSCODE, name: "  Daniel   Tester " } });
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body).toMatchObject({ authenticated: true, staffName: "Daniel Tester", authRequired: true });

    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toMatch(/^ikon_session=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+;/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(new RegExp(`Max-Age=${SESSION_TTL_SECONDS}`));

    const cookie = setCookie.split(";")[0]!;
    const session = await callJson("/api/session", { cookie });
    expect(session).toMatchObject({ authenticated: true, staffName: "Daniel Tester" });
  });

  it("logout clears the cookie; logout itself requires a session", async () => {
    const cookie = await login("Logout Tester");
    const res = await call("/api/logout", { cookie, json: {} });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ authenticated: false, staffName: null });
    const cleared = res.headers.get("Set-Cookie") ?? "";
    expect(cleared).toMatch(/^ikon_session=;/);
    expect(cleared).toMatch(/Max-Age=0/);

    // Note: sessions are stateless signed tokens, so logout clears the browser cookie but does not
    // revoke a copied token before it expires (12 h). That is the documented design, not tested here.

    const anonymous = await call("/api/logout", { json: {} });
    expect(anonymous.status).toBe(401);
  });
});

describe("staff names", () => {
  it("strips control and bidi-override characters and collapses whitespace in the signed-in name", async () => {
    const res = await call("/api/login", { json: { passcode: PASSCODE, name: "\u202eDaniel\u0007\n  Tester\u202c" } });
    expect(res.status).toBe(200);
    expect((await res.json<any>()).staffName).toBe("Daniel Tester");
    const long = await call("/api/login", { json: { passcode: PASSCODE, name: "N".repeat(150) } });
    expect((await long.json<any>()).staffName).toHaveLength(60);
  });
});

describe("auth configuration", () => {
  async function appFetch(path: string, overrides: Partial<Env>, init: RequestInit = {}, base = ORIGIN): Promise<Response> {
    const ctx = createExecutionContext();
    const res = await app.fetch(new Request(`${base}${path}`, init), { ...env, ...overrides } as Env, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }

  it("with AUTH_REQUIRED=false every request is the staff member Demo", async () => {
    const session = await (await appFetch("/api/session", { AUTH_REQUIRED: "false" })).json<any>();
    expect(session).toMatchObject({ authenticated: true, staffName: "Demo", authRequired: false });
    const overview = await appFetch(`/api/properties/${PILOT}`, { AUTH_REQUIRED: "false" });
    expect(overview.status).toBe(200);
    const login = await appFetch("/api/login", { AUTH_REQUIRED: "false" }, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode: "anything", name: "X" }),
    });
    expect(await login.json()).toMatchObject({ authenticated: true, staffName: "Demo" });
  });

  it("refuses passcode login (503) when no HUB_PASSCODE is configured, and never accepts an empty passcode", async () => {
    const res = await appFetch("/api/login", { HUB_PASSCODE: "", SESSION_SECRET: "" }, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode: "", name: "X" }),
    });
    expect(res.status).toBe(503);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    // And with no secret at all, no token verifies.
    const token = await createSessionToken(env, "Someone");
    expect(await verifySessionToken({ ...env, HUB_PASSCODE: "", SESSION_SECRET: "" } as Env, token)).toBeNull();
  });

  it("omits the Secure flag only for plain-http localhost", async () => {
    const res = await appFetch(
      "/api/login",
      {},
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passcode: PASSCODE, name: "Local Dev" }) },
      "http://localhost:5173",
    );
    expect(res.status).toBe(200);
    const cookie = res.headers.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).not.toMatch(/Secure/);
  });
});

describe("protected routes", () => {
  const protectedGets = [
    "/api/portfolio",
    "/api/brief",
    "/api/approvals",
    "/api/cos/chat",
    `/api/properties/${PILOT}`,
    `/api/properties/${PILOT}/threads`,
    `/api/properties/${PILOT}/docs`,
    `/api/properties/${PILOT}/search?q=water`,
    `/api/properties/${PILOT}/contacts`,
    `/api/properties/${PILOT}/memory`,
  ];

  it.each(protectedGets)("GET %s without a cookie is 401", async (path) => {
    const res = await call(path);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Sign in required" });
  });

  it("mutating routes without a cookie are 401", async () => {
    for (const [method, path, json] of [
      ["POST", "/api/brief/refresh", {}],
      ["POST", `/api/properties/${PILOT}/simulate`, { fromAddress: "a@example.com", text: "hello" }],
      ["POST", `/api/properties/${PILOT}/memory`, { text: "x" }],
      ["POST", `/api/properties/${PILOT}/approvals/abc`, { decision: "approve" }],
    ] as const) {
      const res = await call(path, { method, json });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("rejects tampered, foreign-key and expired session tokens", async () => {
    const cookie = await login("Token Tester");
    const token = cookie.slice("ikon_session=".length);
    const [payload, signature] = token.split(".");

    // Payload swapped for another name, original signature kept.
    const forged = `${btoa(JSON.stringify({ n: "Admin", exp: 4102444800 })).replace(/=+$/, "")}.${signature}`;
    expect((await call("/api/portfolio", { cookie: `ikon_session=${forged}` })).status).toBe(401);
    // Signature flipped.
    const flipped = `${payload}.${signature!.startsWith("A") ? "B" : "A"}${signature!.slice(1)}`;
    expect((await call("/api/portfolio", { cookie: `ikon_session=${flipped}` })).status).toBe(401);
    // Garbage.
    expect((await call("/api/portfolio", { cookie: "ikon_session=nope" })).status).toBe(401);

    // Signed with the right key but expired 13 hours ago.
    const expired = await createSessionToken(env, "Old Session", Date.now() - 13 * 60 * 60 * 1000);
    expect(await verifySessionToken(env, expired)).toBeNull();
    expect((await call("/api/portfolio", { cookie: `ikon_session=${expired}` })).status).toBe(401);

    // Same token shape signed with a different secret.
    const otherKey = await createSessionToken({ ...env, SESSION_SECRET: "some-other-secret" } as Env, "Intruder");
    expect((await call("/api/portfolio", { cookie: `ikon_session=${otherKey}` })).status).toBe(401);

    // A fresh token made with the real secret works.
    const fresh = await createSessionToken(env, "Fresh Token");
    expect(await verifySessionToken(env, fresh)).toBe("Fresh Token");
  });
});

describe("CSRF and body guards", () => {
  it("rejects POSTs that are not application/json with 415", async () => {
    const cookie = await login("CSRF Tester");
    const path = `/api/properties/${PILOT}/memory`;
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const res = await call(path, { cookie, body: JSON.stringify({ text: "csrf" }), headers: { "Content-Type": contentType } });
      expect(res.status, contentType).toBe(415);
    }
    const noType = await call(path, { cookie, body: "text=csrf" });
    // A body without an explicit type is sent by fetch as text/plain.
    expect(noType.status).toBe(415);

    // Login is guarded too (a cross-site form cannot log a victim in).
    const formLogin = await call("/api/login", {
      body: `passcode=${PASSCODE}&name=x`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    expect(formLogin.status).toBe(415);
  });

  it("rejects cross-origin mutations with 403 but allows same-origin and Origin-less requests", async () => {
    const cookie = await login("Origin Tester");
    const path = `/api/properties/${PILOT}/memory`;
    const evil = await call(path, { cookie, json: { text: "from evil" }, origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    expect(await evil.json()).toEqual({ error: "Cross-origin request blocked" });

    const sameOrigin = await call(path, { cookie, json: { text: "same origin note" }, origin: ORIGIN });
    expect(sameOrigin.status).toBe(201);
    const noOrigin = await call(path, { cookie, json: { text: "no origin note" }, origin: null });
    expect(noOrigin.status).toBe(201);

    // Clean up.
    for (const note of [await sameOrigin.json<any>(), await noOrigin.json<any>()]) {
      const del = await call(`${path}/${note.id}`, { cookie, method: "DELETE" });
      expect(del.status).toBe(200);
    }
  });

  it("allows a bodiless DELETE without a Content-Type but still checks its Origin", async () => {
    const cookie = await login("Delete Tester");
    const note = await callJson(`/api/properties/${PILOT}/memory`, { cookie, json: { text: "to delete" }, status: 201 });
    const cross = await call(`/api/properties/${PILOT}/memory/${note.id}`, { cookie, method: "DELETE", origin: "https://evil.example" });
    expect(cross.status).toBe(403);
    const ok = await call(`/api/properties/${PILOT}/memory/${note.id}`, { cookie, method: "DELETE" });
    expect(ok.status).toBe(200);
  });

  it("rejects JSON bodies over 256 KB with 413", async () => {
    const cookie = await login("Size Tester");
    const res = await call(`/api/properties/${PILOT}/memory`, { cookie, json: { text: "x".repeat(300 * 1024) } });
    expect(res.status).toBe(413);
  });
});
