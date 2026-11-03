// Work orders, contacts, memory notes, activity and the building agent's (offline) chat.

import { describe, expect, it } from "vitest";
import type { ChatMessage, Contact, MemoryNote, Ticket } from "../shared/types";
import { call, callJson, loginAndSeed, PILOT, simulate, tag } from "./helpers";

describe("work orders (tickets)", () => {
  it("creates tickets numbered WO-<sp>-<4 digits> in sequence and updates them", async () => {
    const property = "sp-10588";
    const cookie = await loginAndSeed("Ticket Tester");
    const existing = await callJson<Ticket[]>(`/api/properties/${property}/tickets`, { cookie });

    const first = await callJson<Ticket>(`/api/properties/${property}/tickets`, {
      cookie,
      json: { title: "Replace stairwell globe", category: "maintenance", priority: "P3", assigneeRole: "strata_manager" },
      status: 201,
    });
    expect(first.number).toMatch(/^WO-10588-\d{4}$/);
    if (existing.length === 0) expect(first.number).toBe("WO-10588-0001");
    expect(first).toMatchObject({
      title: "Replace stairwell globe",
      description: "",
      category: "maintenance",
      priority: "P3",
      status: "new",
      assigneeRole: "strata_manager",
      assigneeName: null,
      contractorId: null,
      threadId: null,
    });
    // Due date defaults from the priority SLA (P3: 5 days).
    expect(Date.parse(first.dueAt!) - Date.parse(first.createdAt)).toBeGreaterThan(4 * 24 * 3_600_000);

    const second = await callJson<Ticket>(`/api/properties/${property}/tickets`, {
      cookie,
      json: {
        title: "Gutter clean",
        description: "Front gutters overflowing",
        category: "maintenance",
        priority: "P2",
        assigneeRole: "contractor",
        assigneeName: "Gutter Co",
        dueAt: "2026-12-01T09:00:00+08:00",
      },
      status: 201,
    });
    const seq = (t: Ticket) => Number(t.number.slice(-4));
    expect(seq(second)).toBe(seq(first) + 1);
    expect(second.dueAt).toBe("2026-12-01T01:00:00.000Z");

    const updated = await callJson<Ticket>(`/api/properties/${property}/tickets/${first.id}`, {
      cookie,
      method: "PATCH",
      json: { status: "in_progress", priority: "P2", assigneeName: "Sam Sparky" },
    });
    expect(updated).toMatchObject({ id: first.id, number: first.number, status: "in_progress", priority: "P2", assigneeName: "Sam Sparky", title: first.title });

    const cleared = await callJson<Ticket>(`/api/properties/${property}/tickets/${first.id}`, {
      cookie,
      method: "PATCH",
      json: { assigneeName: null, status: "done" },
    });
    expect(cleared.assigneeName).toBeNull();
    expect(cleared.status).toBe("done");

    const list = await callJson<Ticket[]>(`/api/properties/${property}/tickets`, { cookie });
    expect(list.map((t) => t.id)).toEqual(expect.arrayContaining([first.id, second.id]));

    const activity = await callJson<any[]>(`/api/properties/${property}/activity`, { cookie });
    expect(activity.some((e) => e.kind === "ticket" && e.summary.includes(`Ticket Tester updated ${first.number}`))).toBe(true);
  });

  it("links a ticket to a thread and validates references and enums", async () => {
    const cookie = await loginAndSeed("Ticket Validator");
    const base = `/api/properties/${PILOT}/tickets`;
    const { threadId } = await simulate(cookie, PILOT, {
      fromAddress: "morgan.demo@example.com",
      subject: `When is the AGM? (${tag()})`,
      text: "When is the next AGM and where are the minutes?",
    });
    const linked = await callJson<Ticket>(base, {
      cookie,
      json: { title: "Send AGM minutes", category: "governance", priority: "P3", assigneeRole: "strata_manager", threadId },
      status: 201,
    });
    expect(linked.threadId).toBe(threadId);
    const detail = await callJson<any>(`/api/properties/${PILOT}/threads/${threadId}`, { cookie });
    expect(detail.ticket.id).toBe(linked.id);

    const valid = { title: "x", category: "maintenance", priority: "P3", assigneeRole: "strata_manager" };
    for (const bad of [
      { ...valid, title: "" },
      { ...valid, priority: "P0" },
      { ...valid, category: "plumbing" },
      { ...valid, assigneeRole: "ceo" },
      { ...valid, dueAt: "next tuesday-ish" },
      { ...valid, contractorId: "no-such-contact" },
      { ...valid, threadId: "no-such-thread" },
    ]) {
      const res = await call(base, { cookie, json: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await call(`${base}/${linked.id}`, { cookie, method: "PATCH", json: { status: "closed" } })).status).toBe(400);
    expect((await call(`${base}/${crypto.randomUUID()}`, { cookie, method: "PATCH", json: { status: "done" } })).status).toBe(404);
  });
});

describe("contacts", () => {
  it("creates, lists, filters, updates and deletes a contact", async () => {
    const property = "sp-64324";
    const cookie = await loginAndSeed("Contacts Tester");
    const base = `/api/properties/${property}/contacts`;
    const name = `Pat Contractor ${tag()}`;

    const created = await callJson<Contact>(base, {
      cookie,
      json: { role: "contractor", name, email: "Pat.Contractor@Example.org", phone: "0400 999 000", trade: "electrician", afterHours: true },
      status: 201,
    });
    expect(created).toMatchObject({
      role: "contractor",
      name,
      email: "pat.contractor@example.org",
      phone: "0400 999 000",
      trade: "electrician",
      afterHours: true,
      lot: null,
      notes: null,
      sample: false,
    });
    expect(created.id).toBeTruthy();

    expect((await callJson<Contact[]>(base, { cookie })).map((c) => c.id)).toContain(created.id);
    expect((await callJson<Contact[]>(`${base}?role=contractor`, { cookie })).map((c) => c.id)).toContain(created.id);
    expect((await callJson<Contact[]>(`${base}?role=owner`, { cookie })).map((c) => c.id)).not.toContain(created.id);

    const updated = await callJson<Contact>(`${base}/${created.id}`, {
      cookie,
      method: "PUT",
      json: { role: "contractor", name: `${name} Pty Ltd`, email: "pat@example.org", trade: "electrician", notes: "Prefers SMS" },
    });
    expect(updated).toMatchObject({ id: created.id, name: `${name} Pty Ltd`, email: "pat@example.org", notes: "Prefers SMS", afterHours: false });
    const listed = (await callJson<Contact[]>(base, { cookie })).filter((c) => c.id === created.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.name).toBe(`${name} Pty Ltd`);

    expect(await callJson(`${base}/${created.id}`, { cookie, method: "DELETE" })).toEqual({ ok: true });
    expect((await callJson<Contact[]>(base, { cookie })).map((c) => c.id)).not.toContain(created.id);
    // Deleting again is harmless.
    expect((await call(`${base}/${created.id}`, { cookie, method: "DELETE" })).status).toBe(200);
  });

  it("validates contacts", async () => {
    const cookie = await loginAndSeed("Contact Validator");
    const base = `/api/properties/sp-64324/contacts`;
    for (const bad of [
      { role: "owner", name: "" },
      { role: "landlord", name: "X" },
      { role: "owner", name: "X", email: "not an email" },
      { role: "owner", name: "X", email: "x@example.com\r\nBcc: victim@example.com" },
      { role: "owner", name: "X", afterHours: "yes" },
    ]) {
      expect((await call(base, { cookie, json: bad })).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await call(`${base}?role=landlord`, { cookie })).status).toBe(400);
  });
});

describe("memory", () => {
  it("adds and deletes a memory note attributed to the staff member", async () => {
    const cookie = await loginAndSeed("Memory Tester");
    const base = `/api/properties/${PILOT}/memory`;
    const text = `Lot 4 owner prefers a phone call for urgent matters (${tag()})`;
    const note = await callJson<MemoryNote>(base, { cookie, json: { text: `  ${text}  ` }, status: 201 });
    expect(note).toMatchObject({ text, source: "staff:Memory Tester" });

    const notes = await callJson<MemoryNote[]>(base, { cookie });
    expect(notes[0]!.id).toBe(note.id); // newest first
    expect(notes.some((n) => n.source === "seed")).toBe(true);

    expect(await callJson(`${base}/${note.id}`, { cookie, method: "DELETE" })).toEqual({ ok: true });
    expect((await callJson<MemoryNote[]>(base, { cookie })).map((n) => n.id)).not.toContain(note.id);

    expect((await call(base, { cookie, json: { text: "   " } })).status).toBe(400);
    expect((await call(base, { cookie, json: { text: "x".repeat(2001) } })).status).toBe(400);
  });
});

describe("building chat (AI offline)", () => {
  it("answers with an AI offline notice plus document hits for the water main", async () => {
    const property = PILOT;
    const cookie = await loginAndSeed("Chat Tester");
    const answer = await callJson<ChatMessage>(`/api/properties/${property}/chat`, {
      cookie,
      json: { text: "Where is the water main?" },
    });
    expect(answer.role).toBe("assistant");
    expect(answer.text).toMatch(/^AI offline/);
    expect(answer.text).toMatch(/water main/i);
    // The passage that actually answers the question (the phrase "water main" ranks it, the cap keeps it).
    expect(answer.text).toMatch(/red lever valve/i);
    // ...and it comes first: the passage whose line starts with "water main" leads, quoted from that line.
    const firstPassage = answer.text.split("\n").find((line) => line.startsWith("- "));
    expect(firstPassage).toMatch(/Water main \(stop-cock\).*red lever valve/);
    // The technical reason (env var names) stays in the activity log, not in the answer.
    expect(answer.text).not.toMatch(/ANTHROPIC_API_KEY|CF_AIG_TOKEN/);
    // Tables read as plain text, not "| a | b |" rows.
    expect(answer.text).not.toMatch(/\|\s*[-:]{3,}/);
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.citations.some((c) => /Building information/i.test(c.docName))).toBe(true);
    expect(answer.toolCalls.map((t) => t.name)).toEqual(["search_documents"]);

    const plumber = await callJson<ChatMessage>(`/api/properties/${property}/chat`, {
      cookie,
      json: { text: "Who is the after-hours plumber?" },
    });
    expect(plumber.text).toMatch(/From this building's contacts:\n- After-hours plumber: Sample Plumbing/);

    const log = await callJson<ChatMessage[]>(`/api/properties/${property}/chat`, { cookie });
    const userIndex = log.findIndex((m) => m.role === "user" && m.text === "Where is the water main?");
    expect(userIndex).toBeGreaterThanOrEqual(0);
    expect(log[userIndex]!.author).toBe("Chat Tester");
    expect(log.map((m) => m.id)).toContain(answer.id);

    expect((await call(`/api/properties/${property}/chat`, { cookie, json: { text: " " } })).status).toBe(400);

    expect(await callJson(`/api/properties/${property}/chat`, { cookie, method: "DELETE" })).toEqual({ ok: true });
    expect(await callJson(`/api/properties/${property}/chat`, { cookie })).toEqual([]);
  });

  it("says plainly when nothing matches", async () => {
    const cookie = await loginAndSeed("Chat Miss Tester");
    const answer = await callJson<ChatMessage>(`/api/properties/sp-87192/chat`, { cookie, json: { text: "xylophonist quasars" } });
    expect(answer.text).toMatch(/^AI offline/);
    expect(answer.text).toMatch(/found nothing/);
    expect(answer.citations).toEqual([]);
  });
});
