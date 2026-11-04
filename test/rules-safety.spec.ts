// Safety rails in the deterministic engines (rules triage and template drafts), which decide the
// outcome whenever no LLM is configured or the model call fails. Regression tests for the review.

import { describe, expect, it } from "vitest";
import type { Message, PropertyProfile, Thread, Triage } from "../shared/types";
import { isReservedTestAddress, needsTicket, ownerToArrange, plainPassage } from "../worker/agents/property-helpers";
import type { ToolHost } from "../worker/ai/agent-loop";
import { templateDraft } from "../worker/ai/drafting";
import { enforceWaTerminology } from "../worker/ai/prompts";
import { mergeWithRules, rulesTriage } from "../worker/ai/triage";

const PROFILE: PropertyProfile = {
  id: "sp-26707",
  spNumber: "26707",
  street: "34 Davies Road",
  suburb: "Claremont",
  state: "WA",
  postcode: "6010",
  lots: 8,
  status: "pilot",
  emailAddress: "sp26707@ikon.example.com",
  notes: null,
};

function triage(text: string, subject = "Message"): Triage {
  return rulesTriage({ property: PROFILE, channel: "email", fromName: null, fromAddress: "x@example.com", subject, text, context: [] });
}

/** A host with no documents or contacts: the template must stand on its own. */
const EMPTY_HOST: ToolHost = {
  searchDocs: async () => [],
  getDocument: async () => null,
  listContacts: async () => [],
  listTickets: async () => [],
  listThreads: async () => [],
  createTicket: async () => {
    throw new Error("not used");
  },
  addMemory: async () => {
    throw new Error("not used");
  },
  listMemory: async () => [],
  draftReply: async () => {
    throw new Error("not used");
  },
};

async function draftFor(text: string, subject = "Message", purpose: "reply" | "dispatch" = "reply", fromName = "Pat Example") {
  const t = triage(text, subject);
  const now = new Date().toISOString();
  const thread: Thread = {
    id: crypto.randomUUID(),
    subject,
    channel: "email",
    fromName: "Pat Example",
    fromAddress: "pat@example.com",
    status: "triaged",
    triage: t,
    ticketId: null,
    preview: text.slice(0, 200),
    simulated: false,
    createdAt: now,
    updatedAt: now,
  };
  const message: Message = {
    id: crypto.randomUUID(),
    threadId: thread.id,
    direction: "inbound",
    channel: "email",
    from: "Pat Example <pat@example.com>",
    to: PROFILE.emailAddress,
    subject,
    text,
    messageId: null,
    inReplyTo: null,
    references: null,
    attachments: [],
    createdAt: now,
    author: null,
  };
  const draft = await templateDraft({
    property: PROFILE,
    companyName: "Ikon Strata Management",
    thread,
    messages: [message],
    triage: t,
    host: EMPTY_HOST,
    instructions: null,
    to: { address: "pat@example.com", name: fromName },
    purpose,
    ticket: null,
    contractor: null,
  });
  return { triage: t, draft };
}

describe("fire, gas and alarms", () => {
  it.each([
    "The bin store at the back is on fire, flames are up the wall. I think someone dropped a cigarette in there.",
    "There are flames coming from the BBQ on the unit 7 balcony and it has caught the awning.",
    "A cigarette butt set the neighbour's balcony on fire, flames are spreading to my blinds.",
  ])("a real fire is P1 even when a cigarette or BBQ is mentioned: %s", (text) => {
    const t = triage(text);
    expect(t).toMatchObject({ category: "maintenance", priority: "P1", needsHuman: true });
    expect(t.allocateTo[0]).toBe("emergency_services");
    expect(t.safetyNotice).toMatch(/leave the building now and call 000/);
  });

  it("a neighbour's cigarette smoke is still not an emergency", () => {
    expect(triage("Smoke is coming into my unit from the neighbour smoking cigarettes on the balcony every night").priority).not.toBe("P1");
  });

  it("a building fire alarm that keeps sounding is P1, not a meetings enquiry, even if it might be cooking", () => {
    const t = triage(
      "The fire alarm in the east stairwell has been going off for 20 minutes and won't stop. Might be someone cooking. Should we get out?",
    );
    expect(t).toMatchObject({ category: "maintenance", priority: "P1" });
    expect(t.safetyNotice).toMatch(/leave the building/);
    const toast = triage("The building fire alarm is going off, everyone is outside, firies are on the way, probably someone's toast");
    expect(toast.priority).toBe("P1");
  });

  it("an in-unit smoke alarm set off by cooking stays routine", () => {
    const t = triage("My smoke alarm keeps going off whenever I cook, can someone check it?");
    expect(t.priority).toBe("P3");
  });

  it("'minutes' only means meeting minutes in a meetings context", () => {
    expect(triage("Could you send me the minutes of the last AGM?").category).toBe("governance");
    expect(triage("The lights in the car park have been out for 30 minutes").category).not.toBe("governance");
  });

  it("a gas leak reply says to leave and never sends people to the meter box or water main", async () => {
    const { triage: t, draft } = await draftFor("Strong smell of gas in the west stairwell near unit 5");
    expect(t).toMatchObject({ priority: "P1", contractorTrade: "gas fitter" });
    expect(draft.body).toMatch(/Leave the area/);
    expect(draft.body).toMatch(/Don't go to the meter box/);
    expect(draft.body).not.toMatch(/water main|switchboard|Insurance:/i);
    const dispatch = await draftFor("Strong smell of gas in the west stairwell near unit 5", "Gas smell", "dispatch");
    expect(dispatch.draft.body).not.toMatch(/Water isolation/);
  });
});

describe("people at risk", () => {
  it("a threat with a knife is a P1 police matter, and the reply never suggests a friendly word", async () => {
    const { triage: t, draft } = await draftFor(
      "The man from unit 3 threatened me with a knife in the car park tonight. I'm scared to leave my unit.",
      "Neighbour threatened me",
    );
    expect(t).toMatchObject({ category: "bylaws_conduct", priority: "P1", needsHuman: true });
    expect(t.allocateTo).toEqual(expect.arrayContaining(["emergency_services", "senior_manager"]));
    expect(draft.body).not.toMatch(/friendly word|parking/i);
    expect(draft.body).toMatch(/000/);
  });

  it("someone waving a knife outside right now is P1 with 000, whatever tense the message uses", async () => {
    const { triage: t, draft } = await draftFor(
      "There is a man in the rear car park waving a knife and shouting. He threatened my partner about five minutes ago and he is still out there.",
      "Man with a knife in the car park",
    );
    expect(t.priority).toBe("P1");
    expect(t.safetyNotice).toMatch(/000/);
    expect(draft.body).toMatch(/000/);
  });

  it("a non-urgent threat still escalates (P2) and the conduct reply drops mediation", async () => {
    const { triage: t, draft } = await draftFor("My neighbour has been harassing me and threatened to hurt me last month.", "Harassment");
    expect(t.priority).toBe("P2");
    expect(t.needsHuman).toBe(true);
    expect(draft.body).not.toMatch(/friendly word/i);
  });

  it("someone inside a lift whose doors won't open is a P1 entrapment", () => {
    const t = triage("The lift doors won't open and my elderly neighbour is inside, it's been 10 minutes and she's not answering");
    expect(t).toMatchObject({ priority: "P1", contractorTrade: "lift technician" });
    expect(t.safetyNotice).toMatch(/lift alarm/);
  });

  it("a loose balcony balustrade with children around is a P1 fall hazard with a builder", () => {
    const t = triage("The glass balustrade on my first floor balcony has come loose at the bottom bracket and wobbles. My kids play out there.");
    expect(t).toMatchObject({ category: "maintenance", priority: "P1", contractorTrade: "builder", responsibility: "strata_company" });
    expect(needsTicket(t)).toBe(true);
  });

  it("disturbed asbestos is urgent, needs a human and never names a regular trade", () => {
    const t = triage(
      "A contractor for unit 6 is drilling and cutting the eaves lining and there's white dust everywhere. Isn't that asbestos? Kids are playing nearby.",
    );
    expect(t).toMatchObject({ category: "maintenance", priority: "P1", needsHuman: true, contractorTrade: null });
    expect(t.safetyNotice).toMatch(/stop now/);
  });

  it("an injury on common property gets an injury reply (no insurance talk) and a make-safe trade", async () => {
    const { triage: t, draft } = await draftFor(
      "I slipped on the wet stairs in the west stairwell yesterday and hurt my back. The stair nosing is broken.",
      "Fell on the stairs",
    );
    expect(t).toMatchObject({ category: "insurance", priority: "P2", contractorTrade: "builder" });
    expect(needsTicket(t)).toBe(true);
    expect(draft.body).toMatch(/sorry to hear you were hurt/);
    expect(draft.body).not.toMatch(/insur|liabilit|excess/i);
  });
});

describe("scams, privacy and other routing", () => {
  it("a bank-detail change request gets no drafted reply and goes to a human", () => {
    const t = triage(
      "Please update our bank account details for all future invoices. Our new account is BSB 062-000 acct 1234 5678. Please pay INV-2219 today to the new account.",
      "New bank details",
    );
    expect(t.summary).toMatch(/^Possible payment-redirection scam/);
    expect(t).toMatchObject({ replyNeeded: false, needsHuman: true });
    expect(t.category).not.toBe("levies");
    expect(t.allocateTo[0]).toBe("senior_manager");
  });

  it("a request for another owner's contact details needs a human", () => {
    const t = triage("Can you give me the phone number and email of the owner of unit 2?");
    expect(t.needsHuman).toBe(true);
    expect(t.summary).toMatch(/contact details/);
  });

  it("a flood in the past or a flood-cover question is not an emergency", () => {
    const t = triage("My unit was flooded last year. Does the strata insurance include flood cover?");
    expect(t.priority).not.toBe("P1");
    expect(t.category).toBe("insurance");
    expect(triage("My unit is flooded, water everywhere").priority).toBe("P1");
    expect(triage("A pipe burst and flooded my bedroom. Who do I contact about insurance?").priority).toBe("P1");
  });

  it("old WA form names are disclosure requests", () => {
    expect(triage("Could you please send through the Form 29 for unit 4").category).toBe("sales_disclosure");
  });

  it("a tenant's fault in an owner's fixture: no strata contractor, the owner or PM arranges it", async () => {
    const { triage: t, draft } = await draftFor(
      "I'm a tenant in unit 3. There's no hot water since this morning, it's the hot water system in the laundry.",
      "No hot water",
    );
    expect(t).toMatchObject({ category: "maintenance", priority: "P2", responsibility: "lot_owner" });
    expect(ownerToArrange(t)).toBe(true);
    expect(draft.body).toMatch(/property manager or landlord/);
    expect(draft.body).not.toMatch(/arrange for a plumber/);
  });
});

describe("model output safety rails", () => {
  const rules = triage("Water is pouring through my bathroom ceiling from upstairs");

  function model(partial: Partial<Triage>): Triage {
    return {
      ...rules,
      category: "tenant_or_pm",
      priority: "P2",
      contractorTrade: null,
      engine: "claude",
      model: "claude-test",
      provider: "anthropic",
      ...partial,
    };
  }

  it("a rules P1 keeps a work category, so the emergency still gets a work order", () => {
    const merged = mergeWithRules(model({}), rules);
    expect(merged).toMatchObject({ priority: "P1", category: "maintenance", contractorTrade: "plumber" });
    expect(needsTicket(merged)).toBe(true);
  });

  it("a model that calls a gas leak P1 spam still gets the rules hazard category, trade, reply and work order", () => {
    const gas = triage("There is a really strong smell of gas in the common stairwell outside Lot 8. It's getting stronger.", "Strong gas smell");
    const merged = mergeWithRules(model({ priority: "P1", category: "spam", contractorTrade: null, replyNeeded: false }), gas);
    expect(merged.category).not.toBe("spam");
    expect(merged.category).toBe(gas.category);
    expect(merged.contractorTrade).toBe(gas.contractorTrade);
    expect(merged.replyNeeded).toBe(true);
    expect(needsTicket(merged)).toBe(true);
  });

  it("a hazard the model files as sales or general keeps the rules category and trade (balustrade is not a locksmith job)", () => {
    const rail = triage("The balustrade on the first floor walkway is loose and moves when you lean on it. Someone could fall.", "Loose balustrade");
    const merged = mergeWithRules(model({ priority: "P2", category: "sales_disclosure", contractorTrade: "locksmith" }), rail);
    expect(merged).toMatchObject({ category: "maintenance", contractorTrade: "builder" });
  });

  it("a payment-redirection scam keeps the scam summary and goes to accounts", () => {
    const scam = triage("Please tell all owners to pay contributions to our new bank account, BSB 012-345 account 9876 5432.", "Change to bank account");
    const merged = mergeWithRules(model({ priority: "P2", category: "general", allocateTo: ["senior_manager"], summary: "Bank change" }), scam, {
      paymentChange: true,
    });
    expect(merged.allocateTo).toContain("accounts");
    expect(merged.summary).toMatch(/payment-redirection/i);
  });

  it("any P1 that needs a trade gets a work order, whatever the category", () => {
    expect(needsTicket(model({ priority: "P1", category: "general", contractorTrade: "electrician" }))).toBe(true);
    expect(needsTicket(model({ priority: "P2", category: "general", contractorTrade: "electrician" }))).toBe(false);
  });

  it("a payment-change request never gets a reply drafted, even if the model says so", () => {
    const merged = mergeWithRules(model({ priority: "P3", category: "levies", replyNeeded: true, needsHuman: false }), triage("Hello"), {
      paymentChange: true,
    });
    expect(merged).toMatchObject({ replyNeeded: false, needsHuman: true });
  });
});

describe("helpers", () => {
  it("recognises reserved test domains only", () => {
    expect(isReservedTestAddress("jane.sample@example.com")).toBe(true);
    expect(isReservedTestAddress("Owner <owner@example.org>")).toBe(true);
    expect(isReservedTestAddress("x@notikon.example")).toBe(true);
    expect(isReservedTestAddress("a@b.test")).toBe(true);
    expect(isReservedTestAddress("victim@unrelated-company.com.au")).toBe(false);
    expect(isReservedTestAddress("someone@myexample.com")).toBe(false);
  });

  it("plainPassage reads markdown tables as text", () => {
    const text = "| Trade | Company | Phone |\n|---|---|---|\n| Plumber | Sample Plumbing (24/7) | 0400 000 021 |";
    expect(plainPassage(text)).toBe("Trade · Company · Phone Plumber · Sample Plumbing (24/7) · 0400 000 021");
  });

  it("WA terminology fixes leave 'is a body corporate' alone and fix other interstate terms", () => {
    expect(enforceWaTerminology("The strata company is a body corporate.")).toBe("The strata company is a body corporate.");
    expect(enforceWaTerminology("The body corporate will meet.")).toBe("The strata company will meet.");
    expect(enforceWaTerminology("Your strata fees and the s184 certificate; ask the executive committee.")).toBe(
      "Your contributions and the s110 certificate; ask the council.",
    );
  });
});

describe("template wording", () => {
  it("a ceiling leak from the lot above tells the owner to warn the lot above", async () => {
    const { draft } = await draftFor(
      "Water is pouring through my bathroom ceiling from the unit upstairs. It's coming through the light fitting.",
      "Water through ceiling",
    );
    expect(draft.body).toMatch(/especially the lot above/);
  });

  it("an s110 request from a firm greets the firm, keeps the lot it gave and does not ask for a fee already paid", async () => {
    const { triage: t, draft } = await draftFor(
      "We act for the buyer of Lot 6. Please provide a certificate under section 110. The prescribed fee has been paid by EFT today; remittance attached.",
      "Request for s110 certificate: Lot 6, SP 26707",
      "reply",
      "Sample Settlements Pty Ltd",
    );
    expect(t.category).toBe("sales_disclosure");
    expect(draft.body.startsWith("Hello,")).toBe(true);
    expect(draft.body).toMatch(/Lot 6/);
    expect(draft.body).not.toMatch(/The lot number and/);
    expect(draft.body).not.toMatch(/send you payment details/);
    expect(draft.body).toMatch(/14 days/);
  });

  it("a noise complaint after a polite word drops the friendly-word step and the '(noise)' artefact", async () => {
    const { draft } = await draftFor(
      "The tenants in Lot 2 play loud music every night until 1am. I've spoken to them politely but nothing has changed. What do the by-laws say?",
      "Noise from Lot 2",
    );
    expect(draft.body).not.toMatch(/friendly word/);
    expect(draft.body).not.toMatch(/\(noise\)/);
    expect(draft.body).not.toMatch(/the lot involved/);
    expect(draft.body).toMatch(/^1\. Please send us the details/m);
  });
});
