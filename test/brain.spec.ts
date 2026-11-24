// The AI Brain map (src/lib/brain.ts): every building is on it, every link joins two pages that exist, and nothing from the
// brain's private pages is in this public repo beyond a title and one line.

import { describe, expect, it } from "vitest";
import type { PropertyCard } from "../shared/types";
import { BRAIN_CORE_ID, brainGraph } from "../src/lib/brain";
import { PORTFOLIO } from "../worker/seed/portfolio";

const cards: PropertyCard[] = PORTFOLIO.map((p) => ({
  profile: { ...p, emailAddress: "" },
  counts: { openThreads: 0, p1Open: 0, pendingApprovals: 0, openTickets: 0, docs: 0, contacts: 0 },
  lastActivityAt: null,
}));

describe("AI Brain map", () => {
  const { nodes, edges } = brainGraph(cards);
  const ids = new Set(nodes.map((n) => n.id));

  it("shows all 16 buildings once, with the pilot marked", () => {
    const buildings = nodes.filter((n) => n.kind === "building");
    expect(buildings.map((b) => b.propertyId).sort()).toEqual(PORTFOLIO.map((p) => p.id).sort());
    expect(buildings.filter((b) => b.pilot).map((b) => b.title)).toEqual(["SP 26707"]);
  });

  it("links only pages that exist, and leaves none unreachable", () => {
    expect(ids.size).toBe(nodes.length);
    for (const [a, b] of edges) expect([ids.has(a), ids.has(b), a !== b]).toEqual([true, true, true]);
    const reached = new Set([BRAIN_CORE_ID]);
    for (let grew = true; grew; ) {
      const before = reached.size;
      for (const [a, b] of edges) {
        if (reached.has(a)) reached.add(b);
        if (reached.has(b)) reached.add(a);
      }
      grew = reached.size > before;
    }
    expect(reached.size).toBe(nodes.length);
  });

  it("keeps each page to a title and one short line", () => {
    for (const n of nodes) expect([n.title.length < 40, n.summary.length < 100, /SAMPLE/.test(n.summary)]).toEqual([true, true, false]);
    expect(nodes.find((n) => n.id === "triage")?.sample).toBe(true);
  });

  it("works with no buildings loaded", () => {
    expect(brainGraph([]).edges.every(([a, b]) => a !== b)).toBe(true);
  });
});
