// The onboarding staff screens' pure logic (src/pages/onboarding/derive.ts), run against the real demo
// projects: the optimistic recounts agree with the Worker's, the Tasks filters round-trip through the URL,
// invitations sort into drafts / live link / history, and the project map's milestones read correctly.

import { describe, expect, it } from "vitest";
import type { OnboardingProjectDetail, OnboardingTask } from "../shared/onboarding";
import {
  NO_TASK_FILTERS,
  filterTasks,
  groupTasks,
  inviteBuckets,
  itemsByFolder,
  milestoneTally,
  parseTaskFilters,
  percentComplete,
  projectMilestones,
  statusLine,
  taskFilterQuery,
  withGoLiveCheck,
  withHandoverItem,
  withTask,
} from "../src/pages/onboarding/derive";
import { callJson, loginAndSeed } from "./helpers";
import { createProject, getProject } from "./onboarding-helpers";

const PILOT = "sp-87192";
const FRESH = "sp-82719";

async function loadDemo(): Promise<string> {
  const cookie = await loginAndSeed("Peter King");
  await callJson("/api/demo/load", { cookie, json: {} });
  return cookie;
}

describe("onboarding staff screens: derived values", () => {
  it("recounts sections, tasks, handover and go-live locally exactly as the Worker does after a save", async () => {
    const cookie = await loadDemo();
    const before = await getProject(cookie, PILOT);
    expect(percentComplete(before.counts)).toBe(Math.floor(((before.counts.tasksDone + before.counts.tasksExcluded) / before.counts.tasks) * 100));
    expect(statusLine(before)).toBe("Project: In progress · Go-live: Not reviewed · Closeout: Open");

    // A task: done, then the optimistic copy is compared with the server's recount.
    const task = before.tasks.find((t) => t.sectionKey === "stratafy" && t.status === "open")!;
    const saved = await callJson<OnboardingTask>(`/api/properties/${PILOT}/onboarding/tasks/${task.id}`, { cookie, json: { status: "done" } });
    const local = withTask(before, saved);
    const server = await getProject(cookie, PILOT);
    expect(local.sections.find((s) => s.key === "stratafy")).toMatchObject({
      counts: server.sections.find((s) => s.key === "stratafy")!.counts,
      progress: server.sections.find((s) => s.key === "stratafy")!.progress,
    });
    expect(local.counts).toMatchObject({ tasksDone: server.counts.tasksDone, tasksExcluded: server.counts.tasksExcluded });

    // A handover item: verified.
    const item = server.handoverItems.find((i) => i.status === "awaiting_verification")!;
    const verified = await callJson(`/api/properties/${PILOT}/onboarding/handover/${item.id}`, { cookie, json: { status: "verified" } });
    const afterItem = await getProject(cookie, PILOT);
    const localItem = withHandoverItem(server, verified);
    for (const key of ["handoverAwaitingSupply", "handoverAwaitingVerification", "handoverVerified", "handoverNotApplicable", "handoverRejected"] as const) {
      expect(localItem.counts[key]).toBe(afterItem.counts[key]);
    }

    // A go-live check: not applicable.
    const check = afterItem.goLiveChecks.find((c) => c.status === "open")!;
    const na = await callJson(`/api/properties/${PILOT}/onboarding/golive/${check.id}`, { cookie, json: { status: "not_applicable" } });
    const afterCheck = await getProject(cookie, PILOT);
    const localCheck = withGoLiveCheck(afterItem, na);
    expect(localCheck.counts.goLiveVerified).toBe(afterCheck.counts.goLiveVerified);
    expect(localCheck.counts.goLiveNotApplicable).toBe(afterCheck.counts.goLiveNotApplicable);
  });

  it("filters and groups tasks, with the filters round-tripping through the URL", async () => {
    const cookie = await loadDemo();
    const project = await getProject(cookie, PILOT);

    const filters = parseTaskFilters("?section=finance_compliance&group=Insurance&owner=priya-sample&status=not_done&mine=1&junk=1");
    expect(filters).toEqual({ section: "finance_compliance", group: "Insurance", owner: "priya-sample", status: "not_done", mine: true });
    expect(parseTaskFilters(new URLSearchParams(taskFilterQuery(filters) as Record<string, string>).toString())).toEqual(filters);
    expect(parseTaskFilters("?section=nope&status=nope")).toEqual(NO_TASK_FILTERS);

    expect(filterTasks(project.tasks, NO_TASK_FILTERS, null)).toHaveLength(project.counts.tasks);
    const finance = filterTasks(project.tasks, { ...NO_TASK_FILTERS, section: "finance_compliance" }, null);
    expect(finance).toHaveLength(project.sections.find((s) => s.key === "finance_compliance")!.counts.total);
    // Group match ignores case (the section cards link with the card's spelling).
    const insurance = filterTasks(project.tasks, { ...NO_TASK_FILTERS, section: "finance_compliance", group: "INSURANCE" }, null);
    expect(insurance.length).toBeGreaterThan(0);
    expect(insurance.every((t) => t.group === "Insurance")).toBe(true);

    const mine = filterTasks(project.tasks, { ...NO_TASK_FILTERS, mine: true }, "peter-king");
    expect(mine.length).toBe(project.tasks.filter((t) => t.ownerId === "peter-king").length);
    expect(filterTasks(project.tasks, { ...NO_TASK_FILTERS, mine: true }, null)).toHaveLength(0);
    const notDone = filterTasks(project.tasks, { ...NO_TASK_FILTERS, status: "not_done" }, null);
    expect(notDone).toHaveLength(project.counts.tasks - project.counts.tasksDone - project.counts.tasksExcluded);

    const blocks = groupTasks(project.sections, project.tasks);
    expect(blocks.map((b) => b.section.key)).toEqual(project.sections.map((s) => s.key));
    for (const block of blocks) {
      expect(block.groups.map((g) => g.group)).toEqual(block.section.groups.filter((g) => block.groups.some((x) => x.group === g)));
      expect(block.groups.reduce((n, g) => n + g.tasks.length, 0)).toBe(block.section.counts.total);
    }

    const folders = itemsByFolder(project.handoverItems);
    expect(folders.reduce((n, f) => n + f.items.length, 0)).toBe(project.counts.handoverItems);
    expect(folders[0]!.folder).toBe("01 Plan & By-laws");
  });

  it("sorts invitations into drafts and the live link", async () => {
    const cookie = await loadDemo();
    const pilot = await getProject(cookie, PILOT);
    const fresh = await getProject(cookie, FRESH);
    expect(inviteBuckets(pilot.invites)).toMatchObject({ drafts: [], current: { status: "active", accessCount: 3 } });
    expect(inviteBuckets(fresh.invites)).toMatchObject({ drafts: [{ status: "draft" }], current: null });

    // Activating the draft makes it the live link; withdrawing it leaves no live link.
    const draft = fresh.invites[0]!;
    await callJson(`/api/properties/${FRESH}/onboarding/invites/${draft.id}/activate`, { cookie, json: {} });
    const active = inviteBuckets((await getProject(cookie, FRESH)).invites);
    expect(active.current?.id).toBe(draft.id);
    await callJson(`/api/properties/${FRESH}/onboarding/invites/${draft.id}/revoke`, { cookie, json: {} });
    const revoked = inviteBuckets((await getProject(cookie, FRESH)).invites);
    expect(revoked).toMatchObject({ drafts: [], current: null });
  });

  it("derives the project map: the pilot part-way through, a fresh draft not started", async () => {
    const cookie = await loadDemo();
    const pilot: OnboardingProjectDetail = await getProject(cookie, PILOT);
    const map = projectMilestones(pilot);
    expect(map.map((m) => m.key)).toEqual([
      "appointed",
      "requested",
      "received",
      "verified",
      "systems",
      "finance",
      "facilities",
      "communications",
      "checks",
      "approved",
      "closed",
    ]);
    const byKey = Object.fromEntries(map.map((m) => [m.key, m]));
    expect(byKey.requested).toMatchObject({ status: "done", counts: "Opened 3 times", ownerIds: ["tom-placeholder"] });
    expect(byKey.received).toMatchObject({ status: "in_progress", counts: `${pilot.counts.handoverItems - pilot.counts.handoverAwaitingSupply - pilot.counts.handoverRejected} / 30 received` });
    // One document was sent back to be replaced: verification is blocked on the outgoing manager.
    expect(byKey.verified).toMatchObject({ status: "blocked", note: "1 needs replacing" });
    expect(byKey.systems!.ownerIds.sort()).toEqual(["mia-example", "priya-sample"]);
    expect(byKey.checks).toMatchObject({ status: "in_progress", counts: "14 / 56 checks" });
    expect(byKey.approved).toMatchObject({ status: "blocked", counts: `${pilot.blockers.length} blockers` });
    expect(byKey.closed).toMatchObject({ status: "not_started", counts: "0 / 3 QA tasks" });
    expect(Object.values(milestoneTally(map)).reduce((a, b) => a + b, 0)).toBe(11);

    const fresh = projectMilestones(await getProject(cookie, FRESH));
    const freshByKey = Object.fromEntries(fresh.map((m) => [m.key, m]));
    expect(freshByKey.requested).toMatchObject({ status: "in_progress", counts: "1 draft saved" });
    expect(freshByKey.received!.status).toBe("not_started");
    expect(freshByKey.appointed!.status).toBe("not_started");
    expect(freshByKey.approved!.status).toBe("blocked");

    // A brand-new project with no invitation: nothing requested yet.
    const created = await createProject(cookie, "sp-13183");
    const blank = Object.fromEntries(projectMilestones(created).map((m) => [m.key, m]));
    expect(blank.requested).toMatchObject({ status: "not_started", counts: "No invitation yet" });
    expect(percentComplete(created.counts)).toBe(0);
  });
});
