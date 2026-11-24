// What the Brain screen draws: the pages of Ikon's shared brain and how they link. Buildings come live from the
// hub's own portfolio. The rest are page titles and one-line descriptions only: the brain's text stays in its own
// private repo, because this repo is public and the app's bundle is served before sign-in.

import type { PropertyCard } from "../../shared/types";
import { propertyAddress } from "./format";

export const BRAIN_KINDS = ["building", "rule", "skill", "doc", "idea"] as const;
export type BrainKind = (typeof BRAIN_KINDS)[number];

export const BRAIN_KIND_LABELS: Record<BrainKind, { one: string; many: string }> = {
  building: { one: "Building", many: "Buildings" },
  rule: { one: "Fact or rule", many: "Facts and rules" },
  skill: { one: "Skill", many: "Skills" },
  doc: { one: "Doc", many: "Docs" },
  idea: { one: "Skill idea", many: "Skill ideas" },
};

export interface BrainNode {
  id: string;
  kind: BrainKind | "core";
  title: string;
  summary: string;
  /** Set on buildings: opens the building in the hub. */
  propertyId?: string;
  pilot?: boolean;
  sample?: boolean;
}

export interface BrainGraphData {
  nodes: BrainNode[];
  edges: [string, string][];
}

export const BRAIN_CORE_ID = "core";

const PAGES: BrainNode[] = [
  { id: "who", kind: "rule", title: "Who we are", summary: "The company, in a few lines, each with its source." },
  { id: "priority", kind: "rule", title: "Current priority", summary: "The one thing that matters most right now." },
  { id: "systems", kind: "rule", title: "Our systems", summary: "Which system is used for what." },
  { id: "skills", kind: "rule", title: "Skills", summary: "How repeat jobs are done." },
  { id: "how", kind: "rule", title: "How we work", summary: "The rules for people and for the assistant." },
  { id: "team", kind: "rule", title: "Team", summary: "Who looks after what." },
  { id: "resolver", kind: "rule", title: "What goes where", summary: "Which system is the home of each fact, and which page new information goes on." },
  { id: "pull", kind: "skill", title: "pull", summary: "Gets everyone's latest before work." },
  { id: "push", kind: "skill", title: "push", summary: "Saves what was learned after work, after asking once." },
  { id: "tidy", kind: "skill", title: "tidy", summary: "A weekly health check. It suggests changes and makes none until someone picks them." },
  { id: "triage", kind: "skill", title: "strata-triage", summary: "Gives a message a priority (P1, P2 or P3), a category and an owner.", sample: true },
  { id: "law", kind: "skill", title: "wa-strata-law", summary: "Looks up WA strata law, and says what is verified and what isn't." },
  { id: "guide", kind: "doc", title: "How to use the brain", summary: "The one-page staff guide." },
  { id: "talks", kind: "doc", title: "How it talks", summary: "How the assistant answers, and what it won't do." },
  { id: "onboarding", kind: "doc", title: "Onboarding sections", summary: "The eight sections of taking on a new building." },
  { id: "idea-disclosure", kind: "idea", title: "Disclosure requests", summary: "An idea for a skill. Not built." },
  { id: "idea-emergency", kind: "idea", title: "Emergency response", summary: "An idea for a skill. Not built." },
  { id: "idea-style", kind: "idea", title: "Writing in Ikon's style", summary: "An idea for a skill. Not built." },
  { id: "idea-approvals", kind: "idea", title: "Approvals and sign-off", summary: "An idea for a skill. Not built." },
  { id: "idea-building", kind: "idea", title: "Taking on a new building", summary: "An idea for a skill. Not built." },
];

const LINKS: [string, string][] = [
  ["push", "resolver"],
  ["tidy", "resolver"],
  ["tidy", "team"],
  ["onboarding", "resolver"],
  ["triage", "law"],
  ["guide", "pull"],
  ["guide", "push"],
  ["guide", "tidy"],
  ["talks", "how"],
];

export function brainGraph(cards: PropertyCard[]): BrainGraphData {
  const buildings = cards.map(({ profile }): BrainNode => ({
    id: profile.id,
    kind: "building",
    title: `SP ${profile.spNumber}`,
    summary: propertyAddress(profile),
    propertyId: profile.id,
    pilot: profile.status === "pilot",
  }));
  const core: BrainNode = { id: BRAIN_CORE_ID, kind: "core", title: "Ikon SM brain", summary: "Decisions, history, how-tos and lessons, in one place." };
  const parentOf = (n: BrainNode) => (n.kind === "skill" || n.kind === "idea" ? "skills" : BRAIN_CORE_ID);
  return {
    nodes: [core, ...buildings, ...PAGES],
    edges: [
      ...[...buildings, ...PAGES].map((n): [string, string] => [parentOf(n), n.id]),
      ...LINKS,
      ...buildings.filter((b) => b.pilot).map((b): [string, string] => ["who", b.id]),
    ],
  };
}
