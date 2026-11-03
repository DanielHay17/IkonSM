// The read-only live-state websockets on /agents/*: only signed-in staff, only known agents.

import { describe, expect, it } from "vitest";
import { call, login, loginAndSeed, PILOT } from "./helpers";

const UPGRADE = { Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==" };

describe("agent websocket guard", () => {
  it("rejects a websocket upgrade without a session (401)", async () => {
    for (const path of [`/agents/property-agent/${PILOT}`, "/agents/chief-of-staff-agent/main"]) {
      const res = await call(path, { headers: UPGRADE });
      expect(res.status, path).toBe(401);
      expect(res.webSocket).toBeNull();
    }
  });

  it("rejects plain HTTP requests to agents without a session (401)", async () => {
    const res = await call(`/agents/property-agent/${PILOT}`);
    expect(res.status).toBe(401);
  });

  it("rejects unknown agent names and classes even when signed in (4xx)", async () => {
    const cookie = await login("WS Tester");
    for (const path of [
      "/agents/property-agent/sp-99999",
      "/agents/property-agent/not-a-scheme",
      "/agents/chief-of-staff-agent/other",
      "/agents/some-other-agent/main",
      "/agents/",
    ]) {
      const res = await call(path, { cookie, headers: UPGRADE });
      expect(res.status, path).toBeGreaterThanOrEqual(400);
      expect(res.status, path).toBeLessThan(500);
      expect(res.webSocket, path).toBeNull();
    }
  });

  it("accepts a signed-in upgrade and streams read-only state", async () => {
    const cookie = await loginAndSeed("WS Viewer");
    const res = await call(`/agents/property-agent/${PILOT}`, { cookie, headers: UPGRADE });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    expect(ws).toBeTruthy();
    const messages: any[] = [];
    const gotState = new Promise<any>((resolve) => {
      ws.addEventListener("message", (event) => {
        const data = JSON.parse(String(event.data));
        messages.push(data);
        if (data.type === "cf_agent_state") resolve(data.state);
      });
    });
    ws.accept();
    const state = await Promise.race([gotState, new Promise((_, reject) => setTimeout(() => reject(new Error("no state")), 5000))]);
    expect(state).toMatchObject({ profile: { id: PILOT }, aiOnline: false });
    expect(state.counts.docs).toBeGreaterThan(5);

    // Clients cannot write state: the agent refuses it and the state is unchanged.
    ws.send(JSON.stringify({ type: "cf_agent_state", state: { ...state, version: 999_999, profile: null } }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const overview = await call(`/api/properties/${PILOT}`, { cookie });
    expect((await overview.json<any>()).profile.id).toBe(PILOT);
    expect(messages.some((m) => m.type === "cf_agent_state" && m.state?.version === 999_999)).toBe(false);
    ws.close();
  });

  it("streams the Chief of Staff state to signed-in staff", async () => {
    const cookie = await loginAndSeed("WS CoS Viewer");
    const res = await call("/agents/chief-of-staff-agent/main", { cookie, headers: UPGRADE });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    const state = new Promise<any>((resolve) => {
      ws.addEventListener("message", (event) => {
        const data = JSON.parse(String(event.data));
        if (data.type === "cf_agent_state") resolve(data.state);
      });
    });
    ws.accept();
    const received = await Promise.race([state, new Promise((_, reject) => setTimeout(() => reject(new Error("no state")), 5000))]);
    expect(received).toHaveProperty("version");
    expect(received).toHaveProperty("brief");
    ws.close();
  });

  it("refuses agent method calls over the websocket (no @callable methods)", async () => {
    const cookie = await loginAndSeed("WS RPC Tester");
    const res = await call(`/agents/property-agent/${PILOT}`, { cookie, headers: UPGRADE });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    const replies = new Map<string, any>();
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(String(event.data));
      if (data.type === "rpc") replies.set(data.id, data);
    });
    ws.accept();
    const marker = `ws-pwned-${crypto.randomUUID()}`;
    const calls = [
      { id: "1", method: "addMemory", args: [marker, "ws"] },
      { id: "2", method: "decideApproval", args: ["x", { decision: "approve" }, "ws"] },
      { id: "3", method: "upsertContact", args: [{ role: "owner", name: marker, email: "attacker@evil.example" }, "ws"] },
      { id: "4", method: "constructor", args: [] },
    ];
    for (const c of calls) ws.send(JSON.stringify({ type: "rpc", ...c }));
    const deadline = Date.now() + 5000;
    while (replies.size < calls.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    for (const c of calls) {
      const reply = replies.get(c.id);
      expect(reply, c.method).toBeTruthy();
      expect(reply.success, c.method).toBe(false);
      expect(reply.error, c.method).toMatch(/not callable|does not exist/);
    }
    ws.close();

    const memory = await (await call(`/api/properties/${PILOT}/memory`, { cookie })).json<any[]>();
    expect(memory.some((n) => n.text === marker)).toBe(false);
    const contacts = await (await call(`/api/properties/${PILOT}/contacts`, { cookie })).json<any[]>();
    expect(contacts.some((c) => c.name === marker)).toBe(false);
  });

  it("plain HTTP to a known agent with a session is answered by the agent, not exposed", async () => {
    const cookie = await login("WS HTTP Tester");
    const res = await call(`/agents/property-agent/${PILOT}`, { cookie });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "use /api" });
  });
});
