// Portfolio listing, property overview and property/record id validation.

import { describe, expect, it } from "vitest";
import type { PropertyCard, PropertyOverview } from "../shared/types";
import { call, callJson, EMAIL_DOMAIN, login, PILOT } from "./helpers";

describe("portfolio", () => {
  it("lists all 16 schemes with the pilot first and per-building agent addresses", async () => {
    const cookie = await login("Portfolio Tester");
    const cards = await callJson<PropertyCard[]>("/api/portfolio", { cookie });

    expect(cards).toHaveLength(16);
    const ids = cards.map((c) => c.profile.id);
    expect(new Set(ids).size).toBe(16);
    expect(ids[0]).toBe(PILOT);
    expect(cards[0]!.profile.status).toBe("pilot");
    expect(cards.filter((c) => c.profile.status === "pilot")).toHaveLength(1);

    for (const { profile } of cards) {
      expect(profile.id).toMatch(/^sp-\d{3,6}$/);
      expect(profile.id).toBe(`sp-${profile.spNumber}`);
      expect(profile.state).toBe("WA");
      expect(profile.emailAddress).toBe(`sp${profile.spNumber}@${EMAIL_DOMAIN}`);
    }
    expect(ids).toEqual(
      expect.arrayContaining(["sp-13183", "sp-87192", "sp-86837", "sp-21343", "sp-10140", "sp-4027"]),
    );

    const pilot = cards[0]!;
    expect(pilot.profile).toMatchObject({ street: "34 Davies Road", suburb: "Claremont", lots: 8 });
    // Pilot: Ikon policy docs + SAMPLE building records and contacts. Others: policy docs only.
    expect(pilot.counts.docs).toBeGreaterThan(5);
    expect(pilot.counts.contacts).toBeGreaterThan(10);
    for (const card of cards.slice(1)) {
      expect(card.counts.docs, card.profile.id).toBeGreaterThanOrEqual(1);
      expect(card.counts.contacts, card.profile.id).toBe(0);
    }
  });

  it("is idempotent: seeding twice does not duplicate documents or contacts", async () => {
    const cookie = await login("Seed Tester");
    const first = await callJson<PropertyCard[]>("/api/portfolio", { cookie });
    const second = await callJson<PropertyCard[]>("/api/portfolio", { cookie });
    expect(second.map((c) => [c.profile.id, c.counts.docs, c.counts.contacts])).toEqual(
      first.map((c) => [c.profile.id, c.counts.docs, c.counts.contacts]),
    );
  });

  it("returns the pilot's overview with the profile and counts", async () => {
    const cookie = await login("Overview Tester");
    const overview = await callJson<PropertyOverview>(`/api/properties/${PILOT}`, { cookie });
    expect(overview.profile.id).toBe(PILOT);
    expect(overview.profile.emailAddress).toBe(`sp26707@${EMAIL_DOMAIN}`);
    expect(overview.aiOnline).toBe(false);
    expect(overview.counts.docs).toBeGreaterThan(5);
    expect(Array.isArray(overview.p1Threads)).toBe(true);
    expect(Array.isArray(overview.pendingApprovals)).toBe(true);
  });

  it("every seeded document and contact is labelled as a sample", async () => {
    const cookie = await login("Sample Label Tester");
    await callJson("/api/portfolio", { cookie });
    const docs = await callJson<any[]>(`/api/properties/${PILOT}/docs`, { cookie });
    const seeded = docs.filter((d) => d.uploadedBy === "seed");
    expect(seeded.filter((d) => d.scope === "building").length).toBeGreaterThan(0);
    expect(seeded.filter((d) => d.scope === "company").length).toBeGreaterThan(0);
    for (const doc of seeded) {
      expect(doc.sample, doc.name).toBe(true);
      expect(doc.indexed, doc.name).toBe("full");
      const text = await callJson<any>(`/api/properties/${PILOT}/docs/${doc.id}/text`, { cookie });
      expect(text.text, doc.name).toMatch(/^SAMPLE DOCUMENT - replace with the real /);
    }
    const contacts = await callJson<any[]>(`/api/properties/${PILOT}/contacts`, { cookie });
    const seededContacts = contacts.filter((c) => /example\.com$/.test(c.email ?? "") || c.sample);
    expect(seededContacts.length).toBeGreaterThan(10);
    for (const c of seededContacts.filter((c) => c.sample)) expect(c.email ?? "x@example.com", c.name).toMatch(/@example\.com$/);
    // Company policy documents are in every building, building records only in the pilot.
    const other = await callJson<any[]>(`/api/properties/sp-4027/docs`, { cookie });
    expect(other.filter((d) => d.uploadedBy === "seed").every((d) => d.scope === "company")).toBe(true);
  });

  it.each([
    ["unknown scheme", "/api/properties/sp-99999"],
    ["unknown scheme sub-route", "/api/properties/sp-99999/threads"],
    ["malformed id", "/api/properties/foo"],
    ["too few digits", "/api/properties/sp-12"],
    ["upper case", "/api/properties/SP-26707"],
    ["no dash", "/api/properties/sp26707"],
    ["trailing junk", "/api/properties/sp-26707x/threads"],
    ["encoded traversal", "/api/properties/..%2Fsp-26707/threads"],
  ])("%s → 404", async (_label, path) => {
    const cookie = await login("Id Tester");
    const res = await call(path, { cookie });
    expect(res.status).toBe(404);
    expect(await res.json()).toHaveProperty("error");
  });

  it("unknown or malformed record ids → 404, and bad query values → 400", async () => {
    const cookie = await login("Record Tester");
    const base = `/api/properties/${PILOT}`;
    expect((await call(`${base}/threads/${crypto.randomUUID()}`, { cookie })).status).toBe(404);
    expect((await call(`${base}/threads/bad%20id%3B`, { cookie })).status).toBe(404);
    expect((await call(`${base}/docs/${crypto.randomUUID()}/text`, { cookie })).status).toBe(404);
    expect((await call(`${base}/docs/${crypto.randomUUID()}/download`, { cookie })).status).toBe(404);
    expect((await call(`${base}/approvals/${crypto.randomUUID()}`, { cookie, json: { decision: "approve" } })).status).toBe(404);
    expect((await call(`${base}/tickets/${crypto.randomUUID()}`, { cookie, method: "PATCH", json: { status: "done" } })).status).toBe(404);
    expect((await call(`${base}/threads?status=bogus`, { cookie })).status).toBe(400);
    expect((await call(`${base}/approvals?status=bogus`, { cookie })).status).toBe(400);
    expect((await call(`${base}/activity?limit=0`, { cookie })).status).toBe(400);
    expect((await call("/api/nope", { cookie })).status).toBe(404);
  });
});
