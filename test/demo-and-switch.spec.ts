// The demo scenario loader and the hub-wide AI switch.

import { env } from "cloudflare:workers";
import { getAgentByName } from "agents";
import { describe, expect, it } from "vitest";
import type { SessionInfo, Thread, Ticket } from "../shared/types";
import { aiProvider } from "../worker/ai/client";
import { paragraphs } from "../worker/ai/drafting";
import { aiSwitchInfo, CHIEF_OF_STAFF_NAME, engineAvailable, readAiChoice, withAiChoice, withSetting } from "../worker/ai/switch";
import { mergeWithRules, rulesTriage } from "../worker/ai/triage";
import { DEMO_SCENARIO } from "../worker/seed/demo";
import { callJson, loginAndSeed, PILOT, simulate, tag, burstPipe } from "./helpers";

describe("demo scenario", () => {
  it("loads a few days of SAMPLE activity across four buildings, backdated, with work orders across the board", async () => {
    const cookie = await loginAndSeed("Demo Loader");
    // A live rehearsal message is replaced by the scenario.
    const { threadId: rehearsal } = await simulate(cookie, PILOT, burstPipe(tag()));

    const loaded = await callJson<{ buildings: { propertyId: string; threads: number; tickets: number }[] }>("/api/demo/load", {
      cookie,
      json: {},
    });
    expect(loaded.buildings.map((b) => b.propertyId).sort()).toEqual(Object.keys(DEMO_SCENARIO).sort());

    const threads = await callJson<Thread[]>(`/api/properties/${PILOT}/threads`, { cookie });
    expect(threads.map((t) => t.id)).not.toContain(rehearsal);
    expect(threads).toHaveLength(DEMO_SCENARIO[PILOT]!.length);
    expect(threads.every((t) => t.simulated)).toBe(true);
    expect(threads.every((t) => t.triage?.engine === "rules")).toBe(true);
    // Backdated: nothing looks like it arrived this minute.
    expect(threads.every((t) => Date.parse(t.createdAt) < Date.now() - 3 * 3_600_000)).toBe(true);
    expect(threads.filter((t) => t.status === "closed")).toHaveLength(2);

    const tickets = await callJson<Ticket[]>(`/api/properties/${PILOT}/tickets`, { cookie });
    const statuses = new Set(tickets.map((t) => t.status));
    for (const status of ["assigned", "in_progress", "waiting", "done"] as const) expect(statuses).toContain(status);
    expect(tickets.every((t) => t.threadId)).toBe(true);
    expect(tickets.map((t) => t.title)).toContain("Garage roller door won't close");

    // The other buildings show the Chief of Staff working across the portfolio.
    for (const id of Object.keys(DEMO_SCENARIO).filter((id) => id !== PILOT)) {
      expect((await callJson<Thread[]>(`/api/properties/${id}/threads`, { cookie })).length).toBeGreaterThan(0);
    }

    // Loading again replaces rather than duplicates.
    await callJson("/api/demo/load", { cookie, json: {} });
    expect(await callJson<Thread[]>(`/api/properties/${PILOT}/threads`, { cookie })).toHaveLength(DEMO_SCENARIO[PILOT]!.length);

    const cleared = await callJson<{ buildings: { propertyId: string; threads: number }[] }>("/api/demo/clear", { cookie, json: {} });
    expect(cleared.buildings.map((b) => b.propertyId).sort()).toEqual(Object.keys(DEMO_SCENARIO).sort());
    expect(await callJson<Thread[]>(`/api/properties/${PILOT}/threads`, { cookie })).toHaveLength(0);
    expect(await callJson<Ticket[]>(`/api/properties/${PILOT}/tickets`, { cookie })).toHaveLength(0);
  });
});

describe("AI switch", () => {
  it("off swaps in the rules engine and keeps every binding; engines unlock only when set up", () => {
    const before = env.LLM_PROVIDER;
    const deployed = withSetting(env, "LLM_PROVIDER", "workers-ai");
    expect(aiProvider(withAiChoice(deployed, "default")).kind).toBe("workers-ai");
    const off = withAiChoice(deployed, "off");
    expect(aiProvider(off).kind).toBe("off");
    expect(off.VAULT).toBe(env.VAULT);
    expect(off.PropertyAgent).toBe(env.PropertyAgent);
    // The shared env is never changed.
    expect(env.LLM_PROVIDER).toBe(before);
    expect(deployed.LLM_PROVIDER).toBe("workers-ai");

    const info = aiSwitchInfo(deployed, "default");
    expect(info).toMatchObject({ on: true, available: true, choice: "workers-ai" });
    expect(info.engine).toMatch(/Workers AI/);
    expect(info.options.map((o) => [o.id, o.available])).toEqual([["off", true], ["workers-ai", true], ["claude", false]]);
    // Claude without a key or gateway credits falls back to the rules engine, never to another engine.
    expect(aiProvider(withAiChoice(deployed, "claude")).kind).toBe("off");
    expect(engineAvailable(deployed, "claude")).toBe(false);

    const withKey = withSetting(deployed, "ANTHROPIC_API_KEY", "sk-test");
    expect(engineAvailable(withKey, "claude")).toBe(true);
    expect(aiProvider(withAiChoice(withKey, "claude")).kind).toBe("anthropic");
    expect(aiSwitchInfo(withKey, "claude")).toMatchObject({ on: true, choice: "claude" });
    expect(aiSwitchInfo(withKey, "off")).toMatchObject({ on: false, choice: "off", engine: null });

    // The test env has the Workers AI binding but LLM_PROVIDER "auto" with no keys: off until someone picks Llama.
    expect(aiSwitchInfo(env, "default")).toMatchObject({ on: false, available: true, engine: null, choice: "off" });
    // Nothing set up at all: nothing to switch on.
    const bare = withSetting(env, "AI", undefined as unknown as string);
    expect(aiSwitchInfo(bare, "default")).toMatchObject({ on: false, available: false, choice: "off" });
  });

  it("is stored in the Chief of Staff and read by everyone", async () => {
    const cookie = await loginAndSeed("Switch Tester");
    const deployed = withSetting(env, "LLM_PROVIDER", "workers-ai");
    const cos = await getAgentByName(env.ChiefOfStaffAgent, CHIEF_OF_STAFF_NAME);

    const off = await callJson<SessionInfo>("/api/settings/ai", { cookie, json: { on: false } });
    expect(off.aiSwitch).toMatchObject({ on: false, available: true, choice: "off" });
    expect(await cos.getAiChoice()).toBe("off");
    expect(await readAiChoice(deployed)).toBe("off");

    await callJson<SessionInfo>("/api/settings/ai", { cookie, json: { on: true } });
    expect(await cos.getAiChoice()).toBe("default");
    expect(await readAiChoice(deployed)).toBe("default");
    // With no engine set up there is nothing to read: rules.
    expect(await readAiChoice(withSetting(env, "AI", undefined as unknown as string))).toBe("off");

    // An engine this deployment can't run is refused, and the stored choice is unchanged.
    await callJson("/api/settings/ai", { cookie, json: { engine: "claude" }, status: 400 });
    expect(await cos.getAiChoice()).toBe("default");
    const llama = await callJson<SessionInfo>("/api/settings/ai", { cookie, json: { engine: "workers-ai" } });
    expect(llama.aiSwitch).toMatchObject({ on: true, choice: "workers-ai" });
    expect(await cos.getAiChoice()).toBe("workers-ai");
    await callJson<SessionInfo>("/api/settings/ai", { cookie, json: { engine: "off" } });
    expect(await cos.getAiChoice()).toBe("off");
    await callJson("/api/settings/ai", { cookie, json: { on: true } });

    const session = await callJson<SessionInfo>("/api/session", { cookie });
    expect(session.aiSwitch?.options.map((o) => o.id)).toEqual(["off", "workers-ai", "claude"]);
    expect(session.aiOnline).toBe(false);

    await callJson("/api/settings/ai", { cookie, json: { on: "yes" }, status: 400 });
    await callJson("/api/settings/ai", { cookie, json: { engine: "gpt" }, status: 400 });
  });
});

describe("Workers AI polish", () => {
  it("splits a one-paragraph email into greeting, paragraphs and sign-off", () => {
    const body =
      "Hi Jane, thank you for letting us know about the water coming through your ceiling. Please turn off the water at the red lever " +
      "valve in the garage meter box if it is safe to do so. If water is near electrics, switch off the power at the switchboard. " +
      "We are arranging for Sample Plumbing (24/7) to attend. Please take photos of the damage. Reference WO-26707-0001. " +
      "Kind regards, Strata Management Team";
    const out = paragraphs(body);
    expect(out.startsWith("Hi Jane,\n\n")).toBe(true);
    expect(out.split("\n\n").length).toBeGreaterThanOrEqual(4);
    expect(out).toMatch(/\n\nKind regards,\nStrata Management Team$/);
    expect(paragraphs("Hi,\n\nAlready\nformatted.")).toBe("Hi,\n\nAlready\nformatted.");
  });

  it("a model P1 with 'unclear' responsibility takes the rules engine's call, allocation and safety notice", () => {
    const rules = rulesTriage({
      property: { id: PILOT, spNumber: "26707", street: "34 Davies Road", suburb: "Claremont", state: "WA", postcode: "6010", lots: 8, status: "pilot", emailAddress: "sp26707@ikon.example.com", notes: null },
      channel: "email",
      fromName: "Jane",
      fromAddress: "jane@example.com",
      subject: "Water pouring through my ceiling",
      text: "Water is pouring through my bathroom ceiling from the unit upstairs right now, near the light fitting.",
      context: [],
    });
    const merged = mergeWithRules(
      { ...rules, priority: "P1", responsibility: "unclear", allocateTo: ["emergency_services"], safetyNotice: "Evacuate if necessary.", engine: "workers-ai", model: "m", provider: "workers-ai" },
      rules,
    );
    expect(merged.responsibility).toBe(rules.responsibility);
    expect(merged.allocateTo).toEqual(expect.arrayContaining(rules.allocateTo));
    expect(merged.safetyNotice).toMatch(/000/);
  });
});
