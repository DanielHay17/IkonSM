// Demo scenario: a few days of everyday activity, so the pilot (and three other buildings) look lived-in
// before the live burst-pipe moment. Every message is SAMPLE data and is filed as a simulated message, so
// "Clear simulated messages" removes it. The live presets (burst pipe, prompt injection, s110 at SP 26707)
// are left out so they can still be shown fresh in the demo.

import type { Channel, TicketStatus } from "../../shared/types";

export interface DemoItem {
  input: { channel: Channel; fromName: string; fromAddress: string; subject: string; text: string };
  /** How long ago the message arrived. */
  hoursAgo: number;
  /** Where its work order sits on the board. A work order is raised if the triage didn't raise one. */
  workOrder?: TicketStatus;
  /** Resolved and closed (its pending reply drafts are withdrawn). */
  close?: boolean;
}

const PILOT: DemoItem[] = [
  {
    hoursAgo: 4,
    input: {
      channel: "email",
      fromName: "Chris Placeholder (Lot 2)",
      fromAddress: "chris.placeholder@example.com",
      subject: "Question about my contributions notice",
      text:
        "Hello,\n\nI received the latest contributions notice for Lot 2. Can you explain why the administrative fund amount went up this " +
        "quarter, and whether I can pay the overdue amount in instalments? I'd also like a copy of the current budget.\n\nThanks,\nChris",
    },
  },
  {
    hoursAgo: 9,
    input: {
      channel: "portal",
      fromName: "Alex Example (Lot 1)",
      fromAddress: "alex.example@example.com",
      subject: "Ongoing late-night noise from Lot 2",
      text:
        "This is the third weekend in a row with loud music and people on the balcony of Lot 2 until after 1am. I've spoken to them " +
        "politely but nothing has changed. What do the by-laws say, and can the strata company do something about it?\n\nAlex, Lot 1",
    },
  },
  {
    hoursAgo: 20,
    workOrder: "assigned",
    input: {
      channel: "email",
      fromName: "Sam Specimen (Lot 5)",
      fromAddress: "sam.specimen@example.com",
      subject: "Garage roller door won't close",
      text:
        "Hi,\n\nThe garage roller door has been stuck half open since this morning. It won't close with the remote or the wall button. " +
        "Our cars are exposed and anyone can walk into the car park. Can someone come and fix it today?\n\nSam\nLot 5",
    },
  },
  {
    hoursAgo: 30,
    input: {
      channel: "email",
      fromName: "Jordan Mockup (Lot 7)",
      fromAddress: "jordan.mockup@example.com",
      subject: "Approval for split-system air-con and new flooring",
      text:
        "Hi,\n\nI'd like to install a split-system air conditioner with the outdoor unit on my balcony wall, and replace the carpet in " +
        "Lot 7 with timber-look flooring. Do I need council approval for either of these, and is there a form or anything I need to " +
        "submit (e.g. acoustic underlay specs)?\n\nCheers,\nJordan",
    },
  },
  {
    hoursAgo: 44,
    workOrder: "in_progress",
    input: {
      channel: "sms",
      fromName: "Riley Template (Lot 8)",
      fromAddress: "riley.template@example.com",
      subject: "Stairwell light out",
      text: "Hi, the light in the west stairwell on the first floor landing has been out for two nights. It's pitch black coming home. Riley, Lot 8",
    },
  },
  {
    hoursAgo: 68,
    workOrder: "waiting",
    input: {
      channel: "email",
      fromName: "Morgan Demo (Lot 3)",
      fromAddress: "morgan.demo@example.com",
      subject: "Gutters overflowing at the back of the building",
      text:
        "Hello,\n\nDuring Sunday's storm the gutters at the back of the building overflowed and water poured down the wall next to the " +
        "bin store. They look full of leaves. Could we get a quote to clean them, and maybe gutter guards?\n\nMorgan (Lot 3, treasurer)",
    },
  },
  {
    hoursAgo: 96,
    workOrder: "done",
    close: true,
    input: {
      channel: "email",
      fromName: "Taylor Fictional (Lot 6)",
      fromAddress: "taylor.fictional@example.com",
      subject: "Smoke alarm chirping in the common hallway",
      text:
        "Hi,\n\nMy tenant tells me the smoke alarm in the common hallway outside Lot 6 has been chirping every minute or so, probably a " +
        "flat battery. Can the strata company's electrician replace it?\n\nThanks,\nTaylor",
    },
  },
  {
    hoursAgo: 130,
    workOrder: "done",
    close: true,
    input: {
      channel: "email",
      fromName: "Alex Example (Lot 1)",
      fromAddress: "alex.example@example.com",
      subject: "Broken reticulation sprinkler in the front garden",
      text:
        "Hi,\n\nOne of the reticulation sprinklers in the front garden is broken and sprays straight onto the footpath every morning. " +
        "It's wasting a lot of water. Could the gardener fix it?\n\nAlex, Lot 1",
    },
  },
];

/** Demo activity by building id. The pilot first; the others show the Chief of Staff working across the portfolio. */
export const DEMO_SCENARIO: Record<string, DemoItem[]> = {
  "sp-26707": PILOT,
  "sp-43464": [
    {
      hoursAgo: 26,
      input: {
        channel: "email",
        fromName: "Sample Conveyancing",
        fromAddress: "certificates@example.net",
        subject: "s110 certificate request: Lot 12",
        text:
          "Dear Strata Manager,\n\nWe act for the seller of Lot 12. Please issue a certificate under section 110 of the Strata Titles " +
          "Act 1985 (WA), including contributions, arrears and interest. Please send payment details for the fee.\n\n" +
          "Regards,\nSample Conveyancing",
      },
    },
  ],
  "sp-13183": [
    {
      hoursAgo: 6,
      workOrder: "assigned",
      input: {
        channel: "email",
        fromName: "Casey Example (Lot 3)",
        fromAddress: "casey.example@example.com",
        subject: "Water stain spreading on my ceiling",
        text:
          "Hi,\n\nThere's a brown water stain on my bedroom ceiling that has grown over the last week. It's damp to touch but not " +
          "dripping. I think it might be coming from the roof or the unit above. Can someone take a look?\n\nCasey, Lot 3",
      },
    },
  ],
  "sp-23872": [
    {
      hoursAgo: 50,
      workOrder: "in_progress",
      input: {
        channel: "email",
        fromName: "Drew Placeholder (Lot 9)",
        fromAddress: "drew.placeholder@example.com",
        subject: "Pool gate not closing by itself",
        text:
          "Hello,\n\nThe pool gate no longer swings shut and latches on its own. You have to pull it closed. With kids in the complex " +
          "that's a worry. Can it be repaired?\n\nDrew, Lot 9",
      },
    },
  ],
};
