// Chief of Staff: portfolio approvals, the rules-based morning brief and the offline chat.

import { describe, expect, it } from "vitest";
import type { Approval, ChatMessage, PortfolioBrief } from "../shared/types";
import { burstPipe, call, callJson, levyQuestion, loginAndSeed, PILOT, s110Request, simulate, tag } from "./helpers";

describe("Chief of Staff", () => {
  it("lists pending approvals across buildings, newest first", async () => {
    const cookie = await loginAndSeed("CoS Approvals");
    const pilot = await simulate(cookie, PILOT, burstPipe(tag()));
    const other = await simulate(cookie, "sp-83917", { ...levyQuestion(tag()), fromAddress: "owner.83917@example.org" });

    const approvals = await callJson<Approval[]>("/api/approvals", { cookie });
    expect(approvals.every((a) => a.status === "pending")).toBe(true);
    const sorted = [...approvals].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    expect(approvals.map((a) => a.id)).toEqual(sorted.map((a) => a.id));

    const pilotOnes = approvals.filter((a) => a.threadId === pilot.threadId);
    expect(pilotOnes.map((a) => a.kind).sort()).toEqual(["dispatch_contractor", "send_email"]);
    expect(pilotOnes.every((a) => a.propertyId === PILOT)).toBe(true);
    const otherOnes = approvals.filter((a) => a.threadId === other.threadId);
    expect(otherOnes).toHaveLength(1);
    expect(otherOnes[0]!.propertyId).toBe("sp-83917");
    expect(new Set(approvals.map((a) => a.propertyId)).size).toBeGreaterThanOrEqual(2);

    // A decided approval drops out of the portfolio list.
    const decided = await callJson<Approval>(`/api/properties/sp-83917/approvals/${otherOnes[0]!.id}`, {
      cookie,
      json: { decision: "reject" },
    });
    expect(decided.status).toBe("rejected");
    const after = await callJson<Approval[]>("/api/approvals", { cookie });
    expect(after.map((a) => a.id)).not.toContain(otherOnes[0]!.id);
  });

  it("refreshes a rules-based brief that leads with the P1 and statutory deadlines", async () => {
    const cookie = await loginAndSeed("CoS Brief");
    const p1 = burstPipe(tag());
    await simulate(cookie, PILOT, p1);
    await simulate(cookie, "sp-43464", { ...s110Request(tag()), subject: `s110 certificate for Lot 2 (${tag()})` });

    const brief = await callJson<PortfolioBrief>("/api/brief/refresh", { cookie, json: {} });
    expect(brief.engine).toBe("rules");
    expect(Date.parse(brief.generatedAt)).toBeGreaterThan(Date.now() - 60_000);
    expect(brief.text).toMatch(/^Portfolio brief - /);
    expect(brief.text).toMatch(/16 schemes/);
    expect(brief.text).toMatch(/P1 emergencies - act now\n- SP 26707 \(34 Davies Road, Claremont\): EMERGENCY: active water leak/);
    expect(brief.text).toContain(p1.subject);
    expect(brief.text).toMatch(/Waiting for approval \(\d+\)/);
    expect(brief.text).toMatch(/Statutory deadlines\n(- .*\n)*- SP 43464 .*s110: within 14 days of fee paid/);
    expect(brief.text).toMatch(/Rules-based summary \(AI offline\)\.$/);
    // Onboarding gaps: schemes with only Ikon policy documents.
    expect(brief.text).toMatch(/Onboarding - no building-specific documents yet, only Ikon policies \(15\)/);

    const p1Highlights = brief.highlights.filter((h) => h.priority === "P1");
    expect(p1Highlights.length).toBeGreaterThan(0);
    expect(p1Highlights.every((h) => h.propertyId === PILOT)).toBe(true);
    expect(brief.highlights[0]!.priority).toBe("P1");
    expect(brief.highlights.some((h) => h.propertyId === "sp-43464" && /s110/.test(h.label))).toBe(true);

    const stored = await callJson<PortfolioBrief | null>("/api/brief", { cookie });
    expect(stored).toEqual(brief);
  });

  it("chat without a key answers offline with portfolio facts and building documents", async () => {
    const cookie = await loginAndSeed("CoS Chat");
    await simulate(cookie, PILOT, burstPipe(tag()));

    const p1 = await callJson<ChatMessage>("/api/cos/chat", { cookie, json: { text: "Any P1 emergencies right now?" } });
    expect(p1.role).toBe("assistant");
    expect(p1.text).toMatch(/^AI offline: /);
    expect(p1.text).toContain("P1 emergencies - act now");
    expect(p1.text).toContain("SP 26707");
    expect(p1.toolCalls.map((t) => t.name)).toContain("list_properties");

    // "What needs my attention today?" covers emergencies, approvals and statutory deadlines in one answer.
    await simulate(cookie, "sp-43464", { ...s110Request(tag()), subject: `s110 certificate for Lot 3 (${tag()})` });
    const attention = await callJson<ChatMessage>("/api/cos/chat", { cookie, json: { text: "What needs my attention today?" } });
    expect(attention.text).toContain("P1 emergencies - act now");
    expect(attention.text).toMatch(/Waiting for approval \(\d+\)/);
    expect(attention.text).toMatch(/Statutory deadlines\n(- .*\n)*- SP 43464 .*s110: within 14 days of fee paid/);

    const docs = await callJson<ChatMessage>("/api/cos/chat", { cookie, json: { text: "SP 26707: where is the water main?" } });
    expect(docs.text).toMatch(/^AI offline: /);
    expect(docs.text).toMatch(/water main/i);
    expect(docs.citations.length).toBeGreaterThan(0);
    expect(docs.citations[0]!.docName).toMatch(/\(SP 26707\)$/);
    expect(docs.toolCalls.map((t) => t.name)).toContain("search_property_documents");

    const log = await callJson<ChatMessage[]>("/api/cos/chat", { cookie });
    expect(log.filter((m) => m.role === "user").map((m) => m.author)).toContain("CoS Chat");
    expect(log.map((m) => m.id)).toEqual(expect.arrayContaining([p1.id, docs.id]));

    expect((await call("/api/cos/chat", { cookie, json: { text: "" } })).status).toBe(400);
    expect(await callJson("/api/cos/chat", { cookie, method: "DELETE" })).toEqual({ ok: true });
    expect(await callJson("/api/cos/chat", { cookie })).toEqual([]);
  });
});
