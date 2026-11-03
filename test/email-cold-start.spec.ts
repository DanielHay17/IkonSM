// Cold start: the very first event a fresh deployment sees is an inbound email (nobody has opened
// the hub yet). The email handler must set the portfolio up first so the building agent has its
// profile, documents and contacts. Kept in its own file so it gets fresh storage.

import { describe, expect, it } from "vitest";
import type { Thread } from "../shared/types";
import { callJson, deliverEmail, getThread, login, PILOT, rawEmail, waitFor } from "./helpers";

describe("email on a fresh deployment", () => {
  it("seeds the portfolio before routing, so the first email is triaged with the building's documents", async () => {
    const subject = "Water pouring through the ceiling (first ever email)";
    const fake = await deliverEmail(
      { from: "jane.sample@example.com", to: "sp26707@ikon.example.com" },
      rawEmail({ from: "Jane Sample <jane.sample@example.com>", to: "sp26707@ikon.example.com", subject, text: "Water is pouring through my bathroom ceiling!" }),
    );
    expect(fake.rejected()).toBeNull();

    const cookie = await login("Cold Start Tester");
    const thread = await waitFor(async () => {
      const threads = await callJson<Thread[]>(`/api/properties/${PILOT}/threads`, { cookie });
      return threads.find((t) => t.subject === subject && t.status === "awaiting_approval");
    }, "the first email to be processed");
    const detail = await waitFor(async () => {
      const d = await getThread(cookie, PILOT, thread.id);
      return d.approvals.length === 2 ? d : null;
    }, "reply and dispatch approvals");

    expect(detail.messages[0]!.to).toBe("sp26707@ikon.example.com");
    expect(detail.ticket!.number).toBe("WO-26707-0001");
    const reply = detail.approvals.find((a) => a.kind === "send_email")!;
    expect(reply.draft.body).toMatch(/water main/i);
    expect(reply.citations.length).toBeGreaterThan(0);
    expect(detail.approvals.find((a) => a.kind === "dispatch_contractor")!.draft.to).toBe("plumbing.dispatch@example.com");

    const overview = await callJson<any>(`/api/properties/${PILOT}`, { cookie });
    expect(overview.profile).toMatchObject({ id: PILOT, street: "34 Davies Road", status: "pilot" });
  });
});
