// Onboarding a new scheme, staff side: projects, tasks, sections and reviews, handover items, go-live checks,
// final approval and closeout, invitations, the directories, the Chief of Staff, the agents and the demo data.
// Counts come from ONBOARDING_TEMPLATE, so the tests hold whatever the checklist's final content is.
// Each test works in its own building, so the tests also hold when storage persists across a file.

import { env } from "cloudflare:workers";
import { getAgentByName } from "agents";
import { describe, expect, it } from "vitest";
import {
  PORTAL_TOKEN,
  SECTION_KEYS,
  STAFF_DIRECTORY,
  staffById,
  staffForName,
  type GoLiveCheck,
  type HandoverInvite,
  type HandoverItem,
  type ManagementCompany,
  type OnboardingProjectDetail,
  type OnboardingSection,
  type OnboardingSummary,
  type OnboardingTask,
  type OutgoingManagerContact,
} from "../shared/onboarding";
import { VAULT_FOLDERS, type Approval, type ChatMessage, type Contact, type DocMeta, type PortfolioBrief, type PropertyCard, type PropertyOverview } from "../shared/types";
import { FINAL_APPROVAL_TASK_KEY, formatDay, newPortalToken, openToken, sealToken, sectionProgress, tokenHash } from "../worker/agents/onboarding";
import { HANDOVER_LETTER_MAX_FILE_MB } from "../shared/handover-letter";
import { HANDOVER_AUTO_ATTACH_CONFIDENCE } from "../shared/handover-match";
import { MAX_UPLOAD_BYTES } from "../worker/docs/filing";
import { ONBOARDING_TEMPLATE } from "../worker/seed/onboarding-template";
import { DEMO_FRESH_ID, DEMO_PILOT_ID, demoHandoverPlan } from "../worker/seed/onboarding-demo";
import { call, callJson, decide, listContacts, login, loginAndSeed, ORIGIN } from "./helpers";
import {
  activateInvite,
  agentRows,
  createProject,
  getProject,
  GO_LIVE_TASKS,
  openHandover,
  portal,
  prepareInvite,
  SAM,
  sha256Hex,
  TEMPLATE_CHECKS,
  TEMPLATE_ITEMS,
  TEMPLATE_TASKS,
  tokenOf,
  ymd,
} from "./onboarding-helpers";

const base = (id: string) => `/api/properties/${id}/onboarding`;
const VAULT_FOLDERS_LIST = [...VAULT_FOLDERS];
const pl = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function patchTask(cookie: string, id: string, taskId: string, body: Record<string, unknown>, status = 200): Promise<OnboardingTask> {
  return callJson(`${base(id)}/tasks/${taskId}`, { cookie, json: body, status });
}

function review(cookie: string, id: string, key: string, body: Record<string, unknown>, status = 200): Promise<OnboardingSection> {
  return callJson(`${base(id)}/sections/${key}/review`, { cookie, json: body, status });
}

function patchItem(cookie: string, id: string, itemId: string, body: Record<string, unknown>, status = 200): Promise<HandoverItem> {
  return callJson(`${base(id)}/handover/${itemId}`, { cookie, json: body, status });
}

function patchCheck(cookie: string, id: string, checkId: string, body: Record<string, unknown>, status = 200): Promise<GoLiveCheck> {
  return callJson(`${base(id)}/golive/${checkId}`, { cookie, json: body, status });
}

/** Everything go-live needs: tasks done, items verified, checks verified, sections reviewed and a link sent. */
async function completeProject(cookie: string, id: string): Promise<OnboardingProjectDetail> {
  const detail = await getProject(cookie, id);
  for (const t of detail.tasks) await patchTask(cookie, id, t.id, { status: "done" });
  // No files were uploaded in these tests: each document is recorded as received on paper (a note is required).
  for (const i of detail.handoverItems) await patchItem(cookie, id, i.id, { status: "verified", reviewNote: "Originals received on paper" });
  for (const c of detail.goLiveChecks) await patchCheck(cookie, id, c.id, { status: "verified" });
  for (const s of detail.sections) await review(cookie, id, s.key, { decision: "reviewed" });
  if (!detail.invites.some((i) => i.activatedAt)) {
    const invite = await prepareInvite(cookie, id);
    await activateInvite(cookie, id, invite.id);
  }
  return getProject(cookie, id);
}

// ===========================================================================
// Demo data, the dashboard list and the Chief of Staff (first: the demo projects are the only ones yet)
// ===========================================================================

describe("onboarding demo data and the Chief of Staff", () => {
  it("loads the two demo projects: SP 87192 nine days in with SAMPLE uploads, SP 82719 a fresh draft", async () => {
    const cookie = await loginAndSeed("Demo Onboarder");
    const loaded = await callJson<{ onboarding: { propertyId: string; project: string | null; files: number }[] }>("/api/demo/load", { cookie, json: {} });
    expect(loaded.onboarding.map((o) => [o.propertyId, o.project])).toEqual([
      [DEMO_PILOT_ID, "SP87192 – Pilot onboarding"],
      [DEMO_FRESH_ID, "SP82719 – Onboarding"],
    ]);

    // The dashboard: all 16 buildings, the projects first (newest first), then the rest.
    const list = await callJson<OnboardingSummary[]>("/api/onboarding", { cookie });
    expect(list).toHaveLength(16);
    expect(list.slice(0, 2).map((s) => s.propertyId)).toEqual([DEMO_FRESH_ID, DEMO_PILOT_ID]);
    expect(list.slice(2).every((s) => s.project === null)).toBe(true);
    expect(list[1]).toMatchObject({ spNumber: "87192", street: "160 Wright Street", suburb: "Kewdale", buildingStatus: "onboarding" });
    expect(list[1]!.project).toMatchObject({ name: "SP87192 – Pilot onboarding", demo: true, status: "active" });
    expect((list[1]!.project as unknown as Record<string, unknown>).tasks).toBeUndefined();

    const pilot = await getProject(cookie, DEMO_PILOT_ID);
    // Created nine days ago; the dates hang off today.
    // Started at 9:15 am (Perth) on the day nine days ago.
    const ageDays = (Date.now() - Date.parse(pilot.createdAt)) / 86_400_000;
    expect(ageDays).toBeGreaterThan(8.5);
    expect(ageDays).toBeLessThan(9.7);
    expect(new Date(Date.parse(pilot.createdAt) + 8 * 3_600_000).toISOString().slice(11, 16)).toBe("09:15");
    expect(Math.abs(Date.parse(pilot.targetGoLiveDate!) - (Date.now() + 20 * 86_400_000))).toBeLessThan(2 * 86_400_000);

    // An active link opened three times, the last about two hours ago.
    const invite = pilot.invites.find((i) => i.status === "active")!;
    expect(invite).toMatchObject({ incomingManagerId: "tom-placeholder", accessCount: 3, outgoingManager: { name: "Sam Outgoing", company: "Sample Strata Co Pty Ltd" } });
    expect(Math.abs(Date.now() - Date.parse(invite.lastAccessAt!) - 2 * 3_600_000)).toBeLessThan(15 * 60_000);
    expect(Math.abs(Date.parse(invite.recordsDueDate) - (Date.now() + 5 * 86_400_000))).toBeLessThan(2 * 86_400_000);
    expect(Math.abs(Date.parse(invite.handoverDate) - (Date.now() + 12 * 86_400_000))).toBeLessThan(2 * 86_400_000);

    // Handover: the planned mix of statuses, SAMPLE files on the supplied ones, and two extra files.
    const plan = demoHandoverPlan(ONBOARDING_TEMPLATE.handoverItems);
    expect(pilot.counts).toMatchObject({
      handoverVerified: plan.verified.length,
      handoverAwaitingVerification: plan.awaiting.length,
      handoverRejected: plan.rejected.length,
      handoverNotApplicable: plan.notApplicable.length,
      handoverAwaitingSupply: TEMPLATE_ITEMS - plan.verified.length - plan.awaiting.length - plan.rejected.length - plan.notApplicable.length,
      extraFiles: 2,
    });
    if (TEMPLATE_ITEMS >= 30) expect([pilot.counts.handoverVerified, pilot.counts.handoverAwaitingVerification, pilot.counts.handoverRejected]).toEqual([9, 5, 1]);
    const supplied = pilot.handoverItems.filter((i) => ["verified", "awaiting_verification", "rejected"].includes(i.status));
    expect(supplied.every((i) => i.files.length === 1 && /^SP87192 .+ \(SAMPLE\)\.txt$/.test(i.files[0]!.name))).toBe(true);
    expect(pilot.handoverItems.filter((i) => i.status === "rejected").every((i) => i.reviewNote)).toBe(true);
    expect(pilot.extraFiles.map((f) => f.name)).toEqual(["SP87192 Garden maintenance schedule 2026 (SAMPLE).txt", "SP87192 Owner correspondence 2025 (SAMPLE).txt"]);

    // The files are real building documents: SAMPLE, in their folders, untrusted until verified.
    const docs = await callJson<DocMeta[]>(`/api/properties/${DEMO_PILOT_ID}/docs`, { cookie });
    const handoverDocs = docs.filter((d) => d.name.startsWith("SP87192 "));
    expect(handoverDocs).toHaveLength(supplied.length + 2);
    expect(handoverDocs.every((d) => d.sample && d.indexed === "full")).toBe(true);
    for (const item of pilot.handoverItems.filter((i) => i.files.length > 0)) {
      const doc = docs.find((d) => d.id === item.files[0]!.docId)!;
      if (item.status === "verified") expect(doc.uploadedBy).toMatch(/^Sam Outgoing \(Sample Strata Co Pty Ltd\), verified by /);
      else expect(doc.uploadedBy).toBe("handover:Sam Outgoing (Sample Strata Co Pty Ltd)");
      expect(await env.VAULT.get(doc.r2Key)).not.toBeNull();
    }

    // Task progress per section (as in the spec for the full checklist, scaled for a shorter one).
    const nominal: Record<string, [number, number]> = {
      outgoing_manager: [5, 8], stratafy: [6, 17], xero: [3, 3], appointment: [12, 17],
      finance_compliance: [4, 13], facilities_site: [3, 12], readiness_closeout: [0, 6], communications: [2, 6],
    };
    for (const section of pilot.sections) {
      const [done, of] = nominal[section.key]!;
      const expected = section.counts.total === of ? done : Math.min(section.counts.total, Math.round((done / of) * section.counts.total));
      expect(section.counts.done, section.key).toBe(Math.min(expected, section.counts.total - (section.key === "finance_compliance" ? 1 : 0)));
    }
    expect(pilot.sections.find((s) => s.key === "finance_compliance")!.counts.excluded).toBe(1);
    const xero = pilot.sections.find((s) => s.key === "xero")!;
    expect(xero).toMatchObject({ review: "reviewed", reviewedBy: "Priya Sample", progress: "complete" });
    const checksDone = TEMPLATE_CHECKS === 56 ? 14 : Math.round((14 / 56) * TEMPLATE_CHECKS);
    expect(pilot.counts.goLiveVerified).toBe(checksDone);

    // Events: backdated across the nine days, newest first, attributed to the people who did the work.
    const times = pilot.events.map((e) => Date.parse(e.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(Math.min(...times)).toBeLessThan(Date.now() - 8.5 * 86_400_000);
    expect(Math.max(...times)).toBeLessThan(Date.now() - 30 * 60_000);
    expect(pilot.events.some((e) => e.kind === "upload" && e.actor === "Sam Outgoing")).toBe(true);
    expect(pilot.events.some((e) => e.summary === "Priya Sample reviewed Xero setup" || e.summary.startsWith("Priya Sample reviewed Xero setup (nominated approver"))).toBe(true);

    // SP 82719: a fresh draft, created today, with one draft invitation.
    const fresh = await getProject(cookie, DEMO_FRESH_ID);
    expect(fresh).toMatchObject({ name: "SP82719 – Onboarding", status: "draft", demo: true });
    expect(Date.now() - Date.parse(fresh.createdAt)).toBeLessThan(60_000);
    expect(fresh.invites).toHaveLength(1);
    expect(fresh.invites[0]).toMatchObject({ status: "draft", activatedAt: null, outgoingManager: { name: "Jo Handover" } });
    expect(fresh.counts.tasksDone).toBe(0);
  });

  it("puts an Onboarding section in the rules brief and the attention answer, and answers the outgoing-manager question offline", async () => {
    const cookie = await loginAndSeed("Brief Onboarder");
    await callJson("/api/demo/load", { cookie, json: {} });
    const pilot = await getProject(cookie, DEMO_PILOT_ID);
    const c = pilot.counts;

    const brief = await callJson<PortfolioBrief>("/api/brief/refresh", { cookie, json: {} });
    expect(brief.text).toContain(`Onboarding\n- SP 82719 Rivervale: 0/${TEMPLATE_TASKS} tasks, ${pl(c.handoverItems, "handover document")} awaiting supply`);
    expect(brief.text).toContain(
      `- SP 87192 Kewdale: ${c.tasksDone}/${c.tasks} tasks, ${pl(c.handoverAwaitingSupply + c.handoverRejected, "handover document")} awaiting supply, ` +
        `${c.handoverAwaitingVerification} awaiting verification, go-live blocked by ${pl(pilot.blockers.length, "item")}`,
    );

    const answer = await callJson<ChatMessage>("/api/cos/chat", { cookie, json: { text: "What needs my attention today?" } });
    expect(answer.text).toContain("Onboarding\n- SP 82719 Rivervale");
    const handover = await callJson<ChatMessage>("/api/cos/chat", { cookie, json: { text: "Where are we with the handovers?" } });
    expect(handover.text).toContain("SP 87192 Kewdale:");

    // The building agent, AI off: the onboarding summary leads the answer.
    const chat = await callJson<ChatMessage>(`/api/properties/${DEMO_PILOT_ID}/chat`, {
      cookie,
      json: { text: "What are we still waiting for from the outgoing manager?" },
    });
    expect(chat.text).toMatch(/^AI offline: /);
    expect(chat.text).toContain("Onboarding: SP87192 – Pilot onboarding (In progress)");
    expect(chat.text).toContain("Still to come from the outgoing manager: ");
    const outstanding = pilot.handoverItems.filter((i) => i.status === "awaiting_supply");
    if (outstanding[0]) expect(chat.text).toContain(outstanding[0].title);
    expect(chat.toolCalls.map((t) => t.name)).toContain("onboarding_status");
    // Other questions are answered as before.
    const other = await callJson<ChatMessage>(`/api/properties/${DEMO_PILOT_ID}/chat`, { cookie, json: { text: "Who is our plumber?" } });
    expect(other.text).not.toContain("Onboarding:");

    // The chat tool's data: outstanding documents and the go-live blockers.
    const agent = await getAgentByName(env.PropertyAgent, DEMO_PILOT_ID);
    const report = (await agent.onboardingStatus())!;
    expect(report.outstanding_documents.length).toBe(c.handoverAwaitingSupply + c.handoverRejected);
    expect(report.awaiting_verification.length).toBe(c.handoverAwaitingVerification);
    expect(report.go_live_blockers).toEqual(pilot.blockers);
    expect(report.outgoing_manager).toMatchObject({ name: "Sam Outgoing", invite: "active" });
    expect(await (await getAgentByName(env.PropertyAgent, "sp-4027")).onboardingStatus()).toBeNull();
  });

  it("loads idempotently and clears only demo projects, with their files, letters and contacts", async () => {
    const cookie = await loginAndSeed("Demo Clearer");
    await callJson("/api/demo/load", { cookie, json: {} });
    const first = await getProject(cookie, DEMO_PILOT_ID);
    const firstKeys = (await callJson<DocMeta[]>(`/api/properties/${DEMO_PILOT_ID}/docs`, { cookie })).filter((d) => d.name.startsWith("SP87192 ")).map((d) => d.r2Key);

    // A real project elsewhere is never touched.
    await createProject(cookie, "sp-64324", { name: "Real takeover" });

    await callJson("/api/demo/load", { cookie, json: {} });
    const second = await getProject(cookie, DEMO_PILOT_ID);
    expect(second.id).not.toBe(first.id);
    const docs = (await callJson<DocMeta[]>(`/api/properties/${DEMO_PILOT_ID}/docs`, { cookie })).filter((d) => d.name.startsWith("SP87192 "));
    expect(docs).toHaveLength(firstKeys.length);
    for (const key of firstKeys) expect(await env.VAULT.get(key)).toBeNull();
    const letters = (await callJson<Approval[]>(`/api/properties/${DEMO_PILOT_ID}/approvals`, { cookie })).filter((a) => a.title.startsWith("Handover request to "));
    expect(letters).toHaveLength(1);
    expect((await listContacts(cookie, DEMO_PILOT_ID)).filter((c) => c.email === SAM.email)).toHaveLength(1);

    const cleared = await callJson<{ onboarding: { propertyId: string; files: number }[] }>("/api/demo/clear", { cookie, json: {} });
    expect(cleared.onboarding.map((o) => o.propertyId).sort()).toEqual([DEMO_FRESH_ID, DEMO_PILOT_ID].sort());
    expect(cleared.onboarding.find((o) => o.propertyId === DEMO_PILOT_ID)!.files).toBe(docs.length);
    expect((await call(base(DEMO_PILOT_ID), { cookie })).status).toBe(404);
    expect((await call(base(DEMO_FRESH_ID), { cookie })).status).toBe(404);
    expect((await callJson<DocMeta[]>(`/api/properties/${DEMO_PILOT_ID}/docs`, { cookie })).filter((d) => d.name.startsWith("SP87192 "))).toHaveLength(0);
    for (const d of docs) expect(await env.VAULT.get(d.r2Key)).toBeNull();
    expect((await callJson<Approval[]>(`/api/properties/${DEMO_PILOT_ID}/approvals`, { cookie })).filter((a) => a.title.startsWith("Handover request to "))).toHaveLength(0);
    expect((await listContacts(cookie, DEMO_PILOT_ID)).filter((c) => c.email === SAM.email)).toHaveLength(0);
    expect((await getProject(cookie, "sp-64324")).name).toBe("Real takeover");

    // A building with a real project of its own is skipped by the demo, and clearing leaves it alone.
    await createProject(cookie, DEMO_FRESH_ID, { name: "Real Rivervale takeover" });
    const reload = await callJson<{ onboarding: { propertyId: string; project: string | null; skipped: string | null }[] }>("/api/demo/load", { cookie, json: {} });
    expect(reload.onboarding.find((o) => o.propertyId === DEMO_FRESH_ID)).toMatchObject({ project: null, skipped: expect.stringContaining("already has") });
    await callJson("/api/demo/clear", { cookie, json: {} });
    expect((await getProject(cookie, DEMO_FRESH_ID)).name).toBe("Real Rivervale takeover");
    expect((await call(base(DEMO_PILOT_ID), { cookie })).status).toBe(404);
  });
});

// ===========================================================================
// Projects
// ===========================================================================

describe("onboarding projects", () => {
  it("creates a project from the template and reads it back; a second create is a conflict", async () => {
    const cookie = await loginAndSeed("Peter King");
    const id = "sp-13183";
    expect((await call(base(id), { cookie })).status).toBe(404);

    const project = await createProject(cookie, id);
    expect(project).toMatchObject({
      propertyId: id,
      name: "SP13183 – Onboarding",
      status: "draft",
      goLive: "not_reviewed",
      closeout: "open",
      targetGoLiveDate: null,
      createdBy: "Peter King",
      demo: false,
      templateVersion: ONBOARDING_TEMPLATE.version,
      finalApproval: null,
      invites: [],
      extraFiles: [],
    });
    expect(project.sections.map((s) => s.key)).toEqual(SECTION_KEYS.filter((k) => ONBOARDING_TEMPLATE.sections.some((s) => s.key === k)));
    expect(project.counts).toEqual({
      tasks: TEMPLATE_TASKS,
      tasksDone: 0,
      tasksExcluded: 0,
      handoverItems: TEMPLATE_ITEMS,
      handoverAwaitingSupply: TEMPLATE_ITEMS,
      handoverAwaitingVerification: 0,
      handoverVerified: 0,
      handoverNotApplicable: 0,
      handoverRejected: 0,
      goLiveChecks: TEMPLATE_CHECKS,
      goLiveVerified: 0,
      goLiveNotApplicable: 0,
      extraFiles: 0,
    });
    expect(project.tasks).toHaveLength(TEMPLATE_TASKS);
    expect(project.handoverItems).toHaveLength(TEMPLATE_ITEMS);
    expect(project.goLiveChecks).toHaveLength(TEMPLATE_CHECKS);
    for (const template of ONBOARDING_TEMPLATE.sections) {
      const section = project.sections.find((s) => s.key === template.key)!;
      expect(section).toMatchObject({ title: template.title, groups: template.groups, review: "not_reviewed", progress: "not_started" });
      expect(section.counts).toEqual({ total: template.tasks.length, done: 0, excluded: 0, open: template.tasks.length });
      // Default owner and approver: the first staff member with the template's role.
      expect(section.ownerId).toBe(STAFF_DIRECTORY.find((s) => s.role === template.defaultOwnerRole)!.id);
      expect(section.approverId).toBe(STAFF_DIRECTORY.find((s) => s.role === template.defaultApproverRole)!.id);
    }
    expect(project.tasks.every((t) => t.status === "open" && staffById(t.ownerId))).toBe(true);
    expect(project.handoverItems.every((i) => i.status === "awaiting_supply" && i.files.length === 0)).toBe(true);
    expect(project.goLiveChecks.every((c) => c.status === "open")).toBe(true);
    expect(project.blockers).toContain("No handover invitation sent");
    expect(project.blockers).toContain(`${GO_LIVE_TASKS} task${GO_LIVE_TASKS === 1 ? "" : "s"} still open`);
    expect(project.events).toHaveLength(1);
    expect(project.events[0]).toMatchObject({ kind: "project", actor: "Peter King" });

    expect(await getProject(cookie, id)).toEqual(project);
    const again = await call(base(id), { cookie, json: {} });
    expect(again.status).toBe(409);
    expect((await again.json<{ error: string }>()).error).toBe("SP 13183 already has an onboarding project");
  });

  it("takes a name and target go-live date, validates them, and needs a session and a real building", async () => {
    const cookie = await loginAndSeed("Name Tester");
    expect((await call(base("sp-24594"), { cookie, json: { targetGoLiveDate: "2026-02-30" } })).status).toBe(400);
    expect((await call(base("sp-24594"), { cookie, json: { name: "x".repeat(201) } })).status).toBe(400);
    const project = await createProject(cookie, "sp-24594", { name: "  Bellevue takeover  ", targetGoLiveDate: "2026-12-01" });
    expect(project).toMatchObject({ name: "Bellevue takeover", targetGoLiveDate: "2026-12-01" });
    expect((await call(base("sp-99999"), { cookie })).status).toBe(404);
    expect((await call(base("sp-24594"), { cookie: null })).status).toBe(401);
    expect((await call(base("sp-24594"), { cookie: null, json: {} })).status).toBe(401);
  });

  it("derives section progress: not started, in progress, complete (excluded and cancelled count as excluded)", async () => {
    expect(sectionProgress({ total: 3, done: 0, excluded: 0, open: 3 })).toBe("not_started");
    expect(sectionProgress({ total: 3, done: 1, excluded: 0, open: 2 })).toBe("in_progress");
    expect(sectionProgress({ total: 3, done: 0, excluded: 1, open: 2 })).toBe("in_progress");
    expect(sectionProgress({ total: 3, done: 2, excluded: 1, open: 0 })).toBe("complete");
    expect(sectionProgress({ total: 3, done: 0, excluded: 3, open: 0 })).toBe("complete");

    const cookie = await loginAndSeed("Progress Tester");
    const id = "sp-86837";
    const project = await createProject(cookie, id);
    const section = [...project.sections].sort((a, b) => b.counts.total - a.counts.total)[0]!;
    const tasks = project.tasks.filter((t) => t.sectionKey === section.key);
    await patchTask(cookie, id, tasks[0]!.id, { status: "done" });
    let after = (await getProject(cookie, id)).sections.find((s) => s.key === section.key)!;
    expect(after.counts).toMatchObject({ done: 1, excluded: 0, open: tasks.length - 1 });
    expect(after.progress).toBe(tasks.length === 1 ? "complete" : "in_progress");
    for (const [i, t] of tasks.slice(1).entries()) await patchTask(cookie, id, t.id, { status: i % 2 ? "cancelled" : "excluded" });
    after = (await getProject(cookie, id)).sections.find((s) => s.key === section.key)!;
    expect(after.counts).toEqual({ total: tasks.length, done: 1, excluded: tasks.length - 1, open: 0 });
    expect(after.progress).toBe("complete");
    const detail = await getProject(cookie, id);
    expect(detail.counts).toMatchObject({ tasksDone: 1, tasksExcluded: tasks.length - 1 });
    // The first completed task moves the project from draft to in progress.
    expect(detail.status).toBe("active");
  });

  it("patches tasks: owner from the register or null, real dates, known statuses, and records the actor", async () => {
    const cookie = await loginAndSeed("Mia Example");
    const id = "sp-10140";
    const project = await createProject(cookie, id);
    const task = project.tasks[0]!;

    expect((await call(`${base(id)}/tasks/${task.id}`, { cookie, json: { ownerId: "nobody" } })).status).toBe(400);
    expect((await call(`${base(id)}/tasks/${task.id}`, { cookie, json: { status: "finished" } })).status).toBe(400);
    expect((await call(`${base(id)}/tasks/${task.id}`, { cookie, json: { dueDate: "2026-02-30" } })).status).toBe(400);
    expect((await call(`${base(id)}/tasks/${task.id}`, { cookie, json: { note: "x".repeat(2001) } })).status).toBe(400);
    expect((await call(`${base(id)}/tasks/not-a-task`, { cookie, json: { status: "done" } })).status).toBe(404);
    expect((await call(`${base(id)}/tasks/bad id!`, { cookie, json: { status: "done" } })).status).toBe(404);

    const assigned = await patchTask(cookie, id, task.id, { ownerId: "priya-sample", dueDate: "2026-11-20", note: "Waiting on the bank" });
    expect(assigned).toMatchObject({ ownerId: "priya-sample", dueDate: "2026-11-20", note: "Waiting on the bank", status: "open" });
    const cleared = await patchTask(cookie, id, task.id, { ownerId: null, dueDate: null, note: null });
    expect(cleared).toMatchObject({ ownerId: null, dueDate: null, note: null });

    const done = await patchTask(cookie, id, task.id, { status: "done" });
    expect(done).toMatchObject({ status: "done", completedBy: "Mia Example" });
    expect(Date.now() - Date.parse(done.completedAt!)).toBeLessThan(60_000);
    const reopened = await patchTask(cookie, id, task.id, { status: "open" });
    expect(reopened).toMatchObject({ status: "open", completedBy: null, completedAt: null });

    const events = (await getProject(cookie, id)).events;
    expect(events.every((e) => e.actor === "Mia Example")).toBe(true);
    expect(events[0]!.summary).toBe(`Mia Example reopened "${task.title}"`);
    expect(events.some((e) => e.summary === `Mia Example completed "${task.title}"`)).toBe(true);
    expect(events.some((e) => e.summary === `Mia Example updated "${task.title}": assigned to Priya Sample, due ${formatDay("2026-11-20")}, note updated`)).toBe(true);
    expect(events.some((e) => e.kind === "project" && e.summary.startsWith("Project is now in progress"))).toBe(true);
  });

  it("assigns sections and records reviews, saying when the reviewer is not the nominated approver", async () => {
    const id = "sp-43464";
    const daniel = await loginAndSeed("Daniel");
    const project = await createProject(daniel, id);
    const key = project.sections[1]!.key;
    const title = project.sections[1]!.title;

    expect((await call(`${base(id)}/sections/${key}`, { cookie: daniel, json: { approverId: "nobody" } })).status).toBe(400);
    expect((await call(`${base(id)}/sections/not_a_section`, { cookie: daniel, json: { ownerId: null } })).status).toBe(404);
    const assigned = await callJson<OnboardingSection>(`${base(id)}/sections/${key}`, { cookie: daniel, json: { ownerId: "lee-demo", approverId: "priya-sample" } });
    expect(assigned).toMatchObject({ ownerId: "lee-demo", approverId: "priya-sample" });

    const reviewed = await review(daniel, id, key, { decision: "reviewed", note: "Looks right" });
    expect(reviewed).toMatchObject({ review: "reviewed", reviewedBy: "Daniel", reviewNote: "Looks right" });
    let events = (await getProject(daniel, id)).events;
    expect(events[0]).toMatchObject({ kind: "section", actor: "Daniel", summary: `Daniel reviewed ${title} (nominated approver: Priya Sample)`, detail: "Looks right" });

    // The nominated approver (signed in by first name) is not flagged.
    const priya = await login("priya");
    expect(staffForName("priya")?.id).toBe("priya-sample");
    await review(priya, id, key, { decision: "changes_requested", note: "Add the bank letter" });
    events = (await getProject(priya, id)).events;
    expect(events[0]!.summary).toBe(`priya requested changes to ${title}`);

    const reset = await review(priya, id, key, { decision: "not_reviewed" });
    expect(reset).toMatchObject({ review: "not_reviewed", reviewedBy: null, reviewedAt: null });
    expect((await call(`${base(id)}/sections/${key}/review`, { cookie: priya, json: { decision: "approved" } })).status).toBe(400);
  });

  it("lets staff verify, send back, waive and reopen handover items, and tick go-live checks", async () => {
    const cookie = await loginAndSeed("Lee Demo");
    const id = "sp-23079";
    const project = await createProject(cookie, id);
    const item = project.handoverItems[0]!;

    expect((await call(`${base(id)}/handover/${item.id}`, { cookie, json: { status: "rejected" } })).status).toBe(400);
    expect((await call(`${base(id)}/handover/${item.id}`, { cookie, json: { status: "awaiting_verification" } })).status).toBe(400);
    expect((await call(`${base(id)}/handover/no-such-item`, { cookie, json: { status: "verified" } })).status).toBe(404);

    expect(await patchItem(cookie, id, item.id, { status: "rejected", reviewNote: "Wrong year" })).toMatchObject({ status: "rejected", reviewNote: "Wrong year", verifiedBy: null });
    // No file: "verified" needs a note saying how the document was received (e.g. originals on paper).
    expect((await call(`${base(id)}/handover/${item.id}`, { cookie, json: { status: "verified" } })).status).toBe(400);
    expect(await patchItem(cookie, id, item.id, { status: "verified", reviewNote: "Original handed over on paper" })).toMatchObject({
      status: "verified",
      verifiedBy: "Lee Demo",
      reviewNote: "Original handed over on paper",
    });
    expect(await patchItem(cookie, id, item.id, { status: "not_applicable", reviewNote: "No pool" })).toMatchObject({ status: "not_applicable", verifiedBy: "Lee Demo" });
    expect(await patchItem(cookie, id, item.id, { status: "awaiting_supply" })).toMatchObject({ status: "awaiting_supply", verifiedBy: null, verifiedAt: null });
    const events = (await getProject(cookie, id)).events.filter((e) => e.kind === "handover").map((e) => e.summary);
    expect(events).toEqual([
      `Lee Demo reopened "${item.title}" (awaiting supply)`,
      `Lee Demo marked "${item.title}" not applicable`,
      `Lee Demo recorded "${item.title}" as received`,
      `Lee Demo asked for "${item.title}" to be replaced`,
    ]);

    const check = project.goLiveChecks[0]!;
    expect((await call(`${base(id)}/golive/${check.id}`, { cookie, json: { status: "done" } })).status).toBe(400);
    expect(await patchCheck(cookie, id, check.id, { status: "verified", note: "Checked in Stratafy" })).toMatchObject({ status: "verified", checkedBy: "Lee Demo", note: "Checked in Stratafy" });
    expect(await patchCheck(cookie, id, check.id, { status: "not_applicable" })).toMatchObject({ status: "not_applicable", checkedBy: "Lee Demo" });
    expect(await patchCheck(cookie, id, check.id, { status: "open" })).toMatchObject({ status: "open", checkedBy: null, checkedAt: null, note: "Checked in Stratafy" });
    const after = await getProject(cookie, id);
    expect(after.counts.goLiveVerified + after.counts.goLiveNotApplicable).toBe(0);
    expect(after.events.filter((e) => e.kind === "golive")).toHaveLength(3);
  });
});

// ===========================================================================
// Final approval and closeout
// ===========================================================================

describe("go-live approval and closeout", () => {
  it("refuses go-live with the blockers until everything is done, then approves and makes the building active", async () => {
    const cookie = await loginAndSeed("Daniel");
    const id = "sp-83917";
    await createProject(cookie, id);

    const blocked = await call(`${base(id)}/approve`, { cookie, json: {} });
    expect(blocked.status).toBe(409);
    const body = await blocked.json<{ error: string; blockers: string[] }>();
    expect(body.error).toBe("Go-live can't be approved yet");
    expect(body.blockers).toHaveLength(5);
    expect(body.blockers[0]).toMatch(/^\d+ sections? not reviewed: /);
    expect(body.blockers.slice(1)).toEqual([
      `${GO_LIVE_TASKS} task${GO_LIVE_TASKS === 1 ? "" : "s"} still open`,
      expect.stringMatching(/^\d+ required handover documents? not verified$/),
      `${TEMPLATE_CHECKS} go-live check${TEMPLATE_CHECKS === 1 ? "" : "s"} not done`,
      "No handover invitation sent",
    ]);
    expect((await getProject(cookie, id)).status).toBe("draft");

    const ready = await completeProject(cookie, id);
    expect(ready.blockers).toEqual([]);
    // Closeout needs go-live first.
    expect((await call(`${base(id)}/closeout`, { cookie, json: {} })).status).toBe(409);

    const approved = await callJson<OnboardingProjectDetail>(`${base(id)}/approve`, { cookie, json: { note: "All good" } });
    expect(approved).toMatchObject({ status: "go_live_approved", goLive: "approved", closeout: "open", finalApproval: { approvedBy: "Daniel", note: "All good" } });
    const approver = staffById(approved.sections.find((s) => s.key === "readiness_closeout")!.approverId)!;
    expect(approved.events[0]).toMatchObject({ kind: "approval", summary: `Daniel approved go-live (nominated approver: ${approver.name})` });
    expect((await call(`${base(id)}/approve`, { cookie, json: {} })).status).toBe(409);

    // The building is now active, on its own page and on the portfolio, and re-seeding doesn't undo it.
    expect((await callJson<PropertyOverview>(`/api/properties/${id}`, { cookie })).profile.status).toBe("active");
    const card = (await callJson<PropertyCard[]>("/api/portfolio", { cookie })).find((p) => p.profile.id === id)!;
    expect(card.profile.status).toBe("active");
    const agent = await getAgentByName(env.PropertyAgent, id);
    await agent.init({ ...card.profile, status: "onboarding", notes: "re-seeded" });
    expect((await agent.getProfile())!.status).toBe("active");
    expect((await callJson<OnboardingSummary[]>("/api/onboarding", { cookie })).find((s) => s.propertyId === id)!.buildingStatus).toBe("active");
  });

  it("closes out only after go-live, once the completion and quality assurance tasks are finished", async () => {
    const cookie = await loginAndSeed("Peter King");
    const id = "sp-23872";
    await createProject(cookie, id);
    const ready = await completeProject(cookie, id);

    // Go-live doesn't wait for the closeout work, or for the final-approval task (approving completes it).
    const qaTasks = ready.tasks.filter((t) => t.sectionKey === "readiness_closeout" && t.group.toLowerCase() === "completion & quality assurance");
    const finalTask = ready.tasks.find((t) => t.key === FINAL_APPROVAL_TASK_KEY);
    for (const t of [...qaTasks, ...(finalTask ? [finalTask] : [])]) await patchTask(cookie, id, t.id, { status: "open" });
    expect((await getProject(cookie, id)).blockers).toEqual([]);
    // Any other open task still blocks.
    const other = ready.tasks.find((t) => t.sectionKey === "stratafy")!;
    await patchTask(cookie, id, other.id, { status: "open" });
    expect((await getProject(cookie, id)).blockers).toEqual(["1 task still open"]);
    await patchTask(cookie, id, other.id, { status: "done" });

    const approved = await callJson<OnboardingProjectDetail>(`${base(id)}/approve`, { cookie, json: {} });
    expect(approved.events[0]!.summary).toBe("Peter King approved go-live");
    if (finalTask) {
      expect(approved.tasks.find((t) => t.id === finalTask.id)).toMatchObject({ status: "done", completedBy: "Peter King" });
      expect(approved.events[1]).toMatchObject({ kind: "task", summary: `Peter King completed "${finalTask.title}"` });
    }
    if (qaTasks.length > 1) {
      // Closeout needs the QA tasks: finish all but one, which the checks below reopen and exclude.
      expect((await call(`${base(id)}/closeout`, { cookie, json: {} })).status).toBe(409);
      for (const t of qaTasks.slice(1)) await patchTask(cookie, id, t.id, { status: "done" });
    }

    const qa = approved.tasks.filter((t) => t.sectionKey === "readiness_closeout" && t.group.toLowerCase() === "completion & quality assurance");
    const reopen = (qa.length ? qa : approved.tasks.filter((t) => t.sectionKey === "readiness_closeout"))[0]!;
    await patchTask(cookie, id, reopen.id, { status: "open" });
    const refused = await call(`${base(id)}/closeout`, { cookie, json: {} });
    expect(refused.status).toBe(409);
    expect((await refused.json<{ error: string }>()).error).toMatch(/Completion & quality assurance tasks done or excluded: 1 task still open$/);

    await patchTask(cookie, id, reopen.id, { status: "excluded" });
    const live = approved.invites.find((i) => i.status === "active")!;
    const { url } = await callJson<{ url: string }>(`${base(id)}/invites/${live.id}/link`, { cookie });
    const closed = await callJson<OnboardingProjectDetail>(`${base(id)}/closeout`, { cookie, json: {} });
    expect(closed).toMatchObject({ status: "closed", closeout: "closed" });
    // The outgoing manager's link has done its job.
    expect(closed.invites.find((i) => i.id === live.id)!.status).toBe("revoked");
    expect((await portal(tokenOf(url))).status).toBe(410);
    expect((await call(`${base(id)}/closeout`, { cookie, json: {} })).status).toBe(409);
    expect((await call(`${base(id)}/approve`, { cookie, json: {} })).status).toBe(409);
  });
});

// ===========================================================================
// Handover invitations
// ===========================================================================

describe("handover invitations", () => {
  it("prepares a draft and adds the outgoing manager to the building's contacts once", async () => {
    const cookie = await loginAndSeed("Mia Example");
    const id = "sp-83114";
    await createProject(cookie, id);

    const bad = (json: Record<string, unknown>) => call(`${base(id)}/invites`, { cookie, json: { incomingManagerId: "tom-placeholder", outgoingManager: SAM, handoverDate: ymd(12), recordsDueDate: ymd(5), ...json } });
    expect((await bad({ incomingManagerId: "nobody" })).status).toBe(400);
    expect((await bad({ outgoingManager: { ...SAM, email: "not-an-email" } })).status).toBe(400);
    expect((await bad({ outgoingManager: { ...SAM, name: "" } })).status).toBe(400);
    expect((await bad({ handoverDate: "next week" })).status).toBe(400);

    const invite = await prepareInvite(cookie, id, { outgoingManager: { ...SAM, email: "Sam.Outgoing@SampleStrata.example.com" } });
    expect(invite).toMatchObject({
      status: "draft",
      incomingManagerId: "tom-placeholder",
      outgoingManager: { ...SAM, email: SAM.email },
      createdBy: "Mia Example",
      activatedAt: null,
      expiresAt: null,
      accessCount: 0,
      approvalId: null,
    });
    await prepareInvite(cookie, id);
    const contacts = (await listContacts(cookie, id)).filter((c) => c.email === SAM.email);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject<Partial<Contact>>({ role: "other", name: "Sam Outgoing", phone: SAM.phone, notes: "Outgoing strata manager (handover)" });
    const project = await getProject(cookie, id);
    expect(project.invites).toHaveLength(2);
    expect(project.status).toBe("draft");
    expect(project.events[0]).toMatchObject({ kind: "invite", actor: "Mia Example", summary: "Mia Example prepared a handover request for Sam Outgoing (Sample Strata Co Pty Ltd)" });
  });

  it("activates: a secure token, its hash stored, the link, and the handover letter waiting in Approvals", async () => {
    const cookie = await loginAndSeed("Mia Example");
    const id = "sp-21343";
    await createProject(cookie, id);
    const draft = await prepareInvite(cookie, id);
    expect((await call(`${base(id)}/invites/${draft.id}/activate`, { cookie, json: { expiresInDays: 91 } })).status).toBe(400);
    expect((await call(`${base(id)}/invites/no-such-invite/activate`, { cookie, json: {} })).status).toBe(404);

    const { invite, url } = await activateInvite(cookie, id, draft.id);
    const token = tokenOf(url);
    expect(token).toMatch(PORTAL_TOKEN);
    expect(PORTAL_TOKEN.exec(token)![1]).toBe("21343");
    expect(url).toBe(`${env.PUBLIC_URL?.trim() ? env.PUBLIC_URL.trim().replace(/\/+$/, "") : ORIGIN}/handover/${token}`);
    expect(invite).toMatchObject({ status: "active", accessCount: 0 });
    expect(Math.abs(Date.parse(invite.expiresAt!) - Date.parse(invite.activatedAt!) - 30 * 86_400_000)).toBeLessThan(1000);

    // Only the hash and a sealed copy are stored, never the token itself.
    const [row] = await agentRows<{ token_hash: string; token_enc: string }>(id, "SELECT token_hash, token_enc FROM handover_invites WHERE id = ?", draft.id);
    expect(row!.token_hash).toBe(await sha256Hex(token));
    expect(row!.token_enc).not.toContain(token.slice(6));
    const dump = await agentRows<{ n: number }>(id, "SELECT COUNT(*) AS n FROM handover_invites WHERE instr(token_enc, ?) > 0 OR instr(token_hash, ?) > 0", token.slice(6, 20), token.slice(6, 20));
    expect(dump[0]!.n).toBe(0);

    // The letter: a send_email approval with no thread, to the outgoing manager, carrying the link.
    const approvals = await callJson<Approval[]>(`/api/properties/${id}/approvals`, { cookie });
    const letter = approvals.find((a) => a.id === invite.approvalId)!;
    expect(letter).toMatchObject({ kind: "send_email", status: "pending", threadId: null, ticketId: null, createdBy: "Mia Example", engine: "template" });
    expect(letter.draft).toMatchObject({ to: SAM.email, toName: "Sam Outgoing", inReplyTo: null });
    expect(letter.draft.body).toContain(url);
    expect(letter.draft.body).toContain("Sam");
    expect(letter.draft.subject).toContain("21343");
    expect(letter.rationale).toMatch(/by phone/);
    expect((await callJson<Approval[]>("/api/approvals", { cookie })).some((a) => a.id === letter.id)).toBe(true);

    const project = await getProject(cookie, id);
    expect(project.status).toBe("active");
    expect(project.blockers).not.toContain("No handover invitation sent");
    expect(project.events.slice(0, 2).map((e) => e.summary).sort()).toEqual([
      "Mia Example activated the handover link for Sam Outgoing (Sample Strata Co Pty Ltd)",
      "Project is now in progress (handover link activated)",
    ]);
    const activity = await callJson<{ summary: string }[]>(`/api/properties/${id}/activity`, { cookie });
    expect(activity.some((a) => a.summary === "Mia Example activated the handover link for Sam Outgoing (Sample Strata Co Pty Ltd)")).toBe(true);

    // Copy link: the same URL again. A draft can't be activated twice.
    expect(await callJson(`${base(id)}/invites/${draft.id}/link`, { cookie })).toEqual({ url });
    expect((await call(`${base(id)}/invites/${draft.id}/activate`, { cookie, json: {} })).status).toBe(409);
    const preview = await callJson<{ subject: string; text: string }>(`${base(id)}/invites/${draft.id}/letter`, { cookie });
    expect(preview.subject).toBe(letter.draft.subject);
    expect(preview.text).toContain(url);

    // Approving the letter sends it: the outgoing manager is a stored contact, so the recipient check passes.
    const sent = await decide(cookie, id, letter.id, { decision: "approve" });
    expect(sent).toMatchObject({ status: "approved", threadId: null });
    expect(sent.result).toMatch(/^Sent to /);
  });

  it("activating another invitation revokes the previous one and withdraws its letter; revoke works", async () => {
    const cookie = await loginAndSeed("Tom");
    const id = "sp-10588";
    await createProject(cookie, id);
    const first = await prepareInvite(cookie, id);
    const firstLink = await activateInvite(cookie, id, first.id);
    const second = await prepareInvite(cookie, id, { outgoingManager: { ...SAM, name: "Robin Sample", email: "robin.sample@samplestrata.example.com" } });
    const draftLetter = await callJson<{ text: string }>(`${base(id)}/invites/${second.id}/letter`, { cookie });
    expect(draftLetter.text).toContain("[secure link created when the invitation is activated]");

    const secondLink = await activateInvite(cookie, id, second.id);
    expect(secondLink.url).not.toBe(firstLink.url);
    const invites = (await getProject(cookie, id)).invites;
    expect(invites.find((i) => i.id === first.id)).toMatchObject({ status: "revoked" });
    expect(invites.find((i) => i.id === second.id)).toMatchObject({ status: "active" });
    const approvals = await callJson<Approval[]>(`/api/properties/${id}/approvals`, { cookie });
    expect(approvals.find((a) => a.id === firstLink.invite.approvalId)).toMatchObject({ status: "rejected", result: expect.stringMatching(/^Withdrawn: handover link withdrawn/) });
    // The withdrawn letter's stored copy no longer holds the token.
    expect(approvals.find((a) => a.id === firstLink.invite.approvalId)!.draft.body).not.toContain(tokenOf(firstLink.url));
    expect(approvals.find((a) => a.id === secondLink.invite.approvalId)).toMatchObject({ status: "pending" });
    expect((await portal(tokenOf(firstLink.url))).status).toBe(410);
    expect((await portal(tokenOf(secondLink.url))).status).toBe(200);
    expect((await call(`${base(id)}/invites/${first.id}/link`, { cookie })).status).toBe(409);

    const revoked = await callJson<HandoverInvite>(`${base(id)}/invites/${second.id}/revoke`, { cookie, json: {} });
    expect(revoked.status).toBe("revoked");
    expect(Date.now() - Date.parse(revoked.revokedAt!)).toBeLessThan(60_000);
    expect((await portal(tokenOf(secondLink.url))).status).toBe(410);
    expect((await callJson<Approval[]>(`/api/properties/${id}/approvals?status=pending`, { cookie })).filter((a) => a.title.startsWith("Handover request"))).toHaveLength(0);
    expect((await getProject(cookie, id)).events[0]!.summary).toBe("Tom withdrew the handover link for Robin Sample (Sample Strata Co Pty Ltd)");
  });

  it("seals the token for its own invitation only, and issues tokens that route to the building", async () => {
    const token = newPortalToken("87192");
    expect(token).toMatch(PORTAL_TOKEN);
    expect(newPortalToken("87192")).not.toBe(token);
    const sealed = await sealToken("secret-a", "invite-1", token);
    expect(sealed).not.toContain(token.slice(6));
    expect(await openToken("secret-a", "invite-1", sealed)).toBe(token);
    expect(await openToken("secret-a", "invite-2", sealed)).toBeNull();
    expect(await openToken("secret-b", "invite-1", sealed)).toBeNull();
    expect(await openToken("secret-a", "invite-1", "garbage")).toBeNull();
    expect(await tokenHash(token)).toBe(await sha256Hex(token));
  });
});

// ===========================================================================
// Directories and the staff register
// ===========================================================================

describe("directories and the staff register", () => {
  it("lists the SAMPLE companies and outgoing managers, and the staff register", async () => {
    const cookie = await login("Directory Reader");
    const companies = await callJson<ManagementCompany[]>("/api/directory/companies", { cookie });
    expect(companies.filter((c) => c.sample)).toHaveLength(3);
    expect(companies.map((c) => c.name)).toContain("Sample Strata Co Pty Ltd");
    const managers = await callJson<OutgoingManagerContact[]>("/api/directory/outgoing-managers", { cookie });
    expect(managers.filter((m) => m.sample)).toHaveLength(4);
    const sam = managers.find((m) => m.name === "Sam Outgoing")!;
    expect(companies.find((c) => c.id === sam.companyId)!.name).toBe("Sample Strata Co Pty Ltd");
    expect(await callJson("/api/staff", { cookie })).toEqual(STAFF_DIRECTORY);
    expect((await call("/api/staff")).status).toBe(401);
    expect((await call("/api/directory/companies")).status).toBe(401);
  });

  it("adds companies and outgoing managers with validation and no duplicates", async () => {
    const cookie = await login("Directory Writer");
    expect((await call("/api/directory/companies", { cookie, json: { name: "" } })).status).toBe(400);
    expect((await call("/api/directory/companies", { cookie, json: { name: "Bad ABN Pty Ltd", abn: "123" } })).status).toBe(400);
    expect((await call("/api/directory/companies", { cookie, json: { name: "Bad Email Pty Ltd", email: "nope" } })).status).toBe(400);
    const company = await callJson<ManagementCompany>("/api/directory/companies", {
      cookie,
      json: { name: "Harbour Strata Pty Ltd", abn: "53004085616", phone: "08 5550 0140", email: "Info@Harbour.example.com", website: null, address: "1 Example Quay, Fremantle WA 6160" },
      status: 201,
    });
    expect(company).toMatchObject({ name: "Harbour Strata Pty Ltd", abn: "53 004 085 616", email: "info@harbour.example.com", sample: false, notes: null, website: null });
    expect((await call("/api/directory/companies", { cookie, json: { name: "harbour strata pty ltd" } })).status).toBe(409);
    expect((await callJson<ManagementCompany[]>("/api/directory/companies", { cookie })).map((c) => c.id)).toContain(company.id);

    expect((await call("/api/directory/outgoing-managers", { cookie, json: { name: "No Email" } })).status).toBe(400);
    expect((await call("/api/directory/outgoing-managers", { cookie, json: { name: "Ghost", email: "ghost@example.com", companyId: "no-such-company" } })).status).toBe(400);
    const manager = await callJson<OutgoingManagerContact>("/api/directory/outgoing-managers", {
      cookie,
      json: { companyId: company.id, name: "Alex Harbour", email: "Alex@Harbour.example.com" },
      status: 201,
    });
    expect(manager).toMatchObject({ companyId: company.id, name: "Alex Harbour", email: "alex@harbour.example.com", phone: null, sample: false });
    expect((await call("/api/directory/outgoing-managers", { cookie, json: { name: "Alex Again", email: "alex@harbour.example.com" } })).status).toBe(409);
    const unattached = await callJson<OutgoingManagerContact>("/api/directory/outgoing-managers", { cookie, json: { name: "Solo Manager", email: "solo@example.com" }, status: 201 });
    expect(unattached.companyId).toBeNull();
  });
});

// ===========================================================================
// Edges: no project, unknown records, sessions
// ===========================================================================

describe("onboarding edges", () => {
  it("answers 404 for every project route on a building without a project, and for unknown records", async () => {
    const cookie = await loginAndSeed("Edge Tester");
    const id = "sp-4027";
    const routes: [string, Record<string, unknown> | undefined][] = [
      [`${base(id)}`, undefined],
      [`${base(id)}/tasks/some-task`, { status: "done" }],
      [`${base(id)}/sections/stratafy`, { ownerId: null }],
      [`${base(id)}/sections/stratafy/review`, { decision: "reviewed" }],
      [`${base(id)}/handover/some-item`, { status: "verified" }],
      [`${base(id)}/golive/some-check`, { status: "verified" }],
      [`${base(id)}/approve`, {}],
      [`${base(id)}/closeout`, {}],
      [`${base(id)}/invites`, { incomingManagerId: "tom-placeholder", outgoingManager: SAM, handoverDate: ymd(1), recordsDueDate: ymd(1) }],
      [`${base(id)}/invites/some-invite/activate`, {}],
      [`${base(id)}/invites/some-invite/link`, undefined],
      [`${base(id)}/invites/some-invite/letter`, undefined],
      [`${base(id)}/invites/some-invite/revoke`, {}],
    ];
    for (const [path, json] of routes) {
      const res = await call(path, { cookie, ...(json ? { json } : {}) });
      expect(res.status, path).toBe(404);
    }

    await createProject(cookie, id);
    for (const path of [`${base(id)}/invites/nope/link`, `${base(id)}/invites/nope/letter`]) expect((await call(path, { cookie })).status, path).toBe(404);
    expect((await call(`${base(id)}/invites/nope/revoke`, { cookie, json: {} })).status).toBe(404);
    expect((await call(`${base(id)}/golive/nope`, { cookie, json: { status: "verified" } })).status).toBe(404);
    const draft = await prepareInvite(cookie, id);
    expect((await call(`${base(id)}/invites/${draft.id}/link`, { cookie })).status).toBe(409);
    const revoked = await callJson<HandoverInvite>(`${base(id)}/invites/${draft.id}/revoke`, { cookie, json: {} });
    expect(revoked.status).toBe("revoked");
    expect((await call(`${base(id)}/invites/${draft.id}/activate`, { cookie, json: {} })).status).toBe(409);
  });

  it("keeps the hub-wide onboarding routes behind the session and validates JSON", async () => {
    expect((await call("/api/onboarding")).status).toBe(401);
    expect((await call("/api/directory/outgoing-managers")).status).toBe(401);
    expect((await call("/api/directory/companies", { json: { name: "Sneaky Pty Ltd" } })).status).toBe(401);
    const cookie = await login("JSON Tester");
    const res = await call("/api/directory/companies", { cookie, body: "{not json", headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(400);
    expect((await call("/api/directory/companies", { cookie, json: { name: "Cross Pty Ltd" }, origin: "https://evil.example" })).status).toBe(403);
  });

  it("serves a light summary for the building header, and the rules brief follows onboarding progress", async () => {
    const cookie = await loginAndSeed("Summary Tester");
    const id = "sp-13183";
    const project = await getProject(cookie, id).catch(() => createProject(cookie, id));
    const summary = await callJson<Record<string, unknown>>(`${base(id)}/summary`, { cookie });
    expect(summary).toMatchObject({ id: project.id, name: project.name, propertyId: id });
    expect(summary.tasks).toBeUndefined();
    expect(summary.events).toBeUndefined();
    // The pilot is the one building this file never gives a project.
    expect(await callJson(`${base("sp-26707")}/summary`, { cookie })).toBeNull();

    // AI off: the brief is rewritten when a building's onboarding changes, though a task edit logs no activity.
    const before = await callJson<PortfolioBrief>("/api/brief/refresh", { cookie, json: {} });
    const open = (await getProject(cookie, id)).tasks.find((t) => t.status === "open")!;
    await patchTask(cookie, id, open.id, { status: "done" });
    const after = await callJson<PortfolioBrief>("/api/brief", { cookie });
    expect(after.generatedAt > before.generatedAt).toBe(true);
    const done = (await getProject(cookie, id)).counts.tasksDone;
    expect(after.text).toContain(`SP 13183 Girrawheen: ${done}/${TEMPLATE_TASKS} tasks`);
  });

  it("answers about one building's onboarding in the Chief of Staff's offline chat", async () => {
    const cookie = await loginAndSeed("CoS Asker");
    const id = "sp-83114";
    const project = await getProject(cookie, id).catch(() => createProject(cookie, id));
    const answer = await callJson<ChatMessage>("/api/cos/chat", { cookie, json: { text: "How is SP 83114 going?" } });
    expect(answer.text).toContain(`Onboarding (${project.name}): SP 83114 Leederville: `);
    expect(answer.text).toMatch(/Before go-live: \d+ sections? not reviewed/);
  });
});

// ===========================================================================
// Shared functions (contract-level: they hold for the final checklist and matcher too)
// ===========================================================================

describe("shared onboarding functions", () => {
  it("keeps the shared constants in step with the Worker's limits", () => {
    // The letter quotes the per-file limit and the matcher sets the auto-attach threshold; shared code can't import the Worker's.
    expect(HANDOVER_LETTER_MAX_FILE_MB * 1024 * 1024).toBe(MAX_UPLOAD_BYTES);
    expect(HANDOVER_AUTO_ATTACH_CONFIDENCE).toBe(0.5);
  });

  it("staffForName maps a signed-in name to the register: full name or a unique first name, any case", () => {
    expect(staffForName("Peter King")?.id).toBe("peter-king");
    expect(staffForName("  PETER   king ")?.id).toBe("peter-king");
    expect(staffForName("peter")?.id).toBe("peter-king");
    expect(staffForName("Tom")?.id).toBe("tom-placeholder");
    expect(staffForName("Priya Sample")?.role).toBe("accountant");
    expect(staffForName("Daniel")).toBeNull();
    expect(staffForName("Peter Kingston")).toBeNull();
    expect(staffForName("")).toBeNull();
    expect(staffForName(null)).toBeNull();
    expect(staffById("lee-demo")?.name).toBe("Lee Demo");
    expect(staffById("nobody")).toBeNull();
    expect(STAFF_DIRECTORY.filter((s) => !s.sample).map((s) => s.name)).toEqual(["Peter King"]);
  });

  it("matchHandoverFile skips junk and matches realistic SharePoint paths to requested documents", async () => {
    const { isJunkPath, matchHandoverFile } = await import("../shared/handover-match");
    const targets = ONBOARDING_TEMPLATE.handoverItems.map((t, i) => ({ id: `item-${i}`, key: t.key, title: t.title, folder: t.folder, keywords: t.keywords }));
    for (const junk of ["__MACOSX/SP87192/._Policy.pdf", "SP87192/Insurance/.DS_Store", "SP87192/Photos/Thumbs.db", "SP87192/Finance/~$Budget 2026.xlsx"]) {
      expect(isJunkPath(junk), junk).toBe(true);
      expect(matchHandoverFile(junk, targets).skip, junk).toBe(true);
    }
    expect(isJunkPath("SP87192/02 Insurance/Certificate of Currency 2026.pdf")).toBe(false);
    let own = 0;
    for (const [i, item] of ONBOARDING_TEMPLATE.handoverItems.entries()) {
      const path = `Shared Documents/Strata Schemes/SP87192 - 160 Wright St/${item.folder}/${item.keywords[0]} 2026.pdf`;
      const match = matchHandoverFile(path, targets);
      expect(match.skip).toBe(false);
      expect(match.confidence).toBeGreaterThanOrEqual(0);
      expect(match.confidence).toBeLessThanOrEqual(1);
      expect([null, ...targets.map((t) => t.id)]).toContain(match.itemId);
      expect(VAULT_FOLDERS_LIST).toContain(match.folder);
      if (match.itemId === `item-${i}` && match.confidence >= 0.5) own++;
    }
    expect(own).toBeGreaterThan(ONBOARDING_TEMPLATE.handoverItems.length / 2);
    const nothing = matchHandoverFile("Shared Documents/zzqv/blorptangle.bin", targets);
    expect(nothing.confidence).toBeLessThan(0.5);
  });

  it("renderHandoverLetter names the scheme, the outgoing manager and the secure link", async () => {
    const { renderHandoverLetter } = await import("../shared/handover-letter");
    const url = "https://hub.ikon.test/handover/87192-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
    const letter = renderHandoverLetter({
      companyName: "Ikon Strata Management",
      building: { spNumber: "87192", street: "160 Wright Street", suburb: "Kewdale", postcode: "6105" },
      outgoingManager: { name: "Sam Outgoing", company: "Sample Strata Co Pty Ltd" },
      incomingManager: { name: "Tom Placeholder", title: "Strata Manager", email: "tom.placeholder@example.com" },
      handoverDate: "2026-11-19",
      recordsDueDate: "2026-11-12",
      portalUrl: url,
      linkExpiresAt: "2026-12-07T00:00:00.000Z",
      items: ONBOARDING_TEMPLATE.handoverItems,
      folders: VAULT_FOLDERS_LIST,
    });
    expect(letter.subject).toContain("87192");
    expect(letter.text).toContain("Dear Sam");
    expect(letter.text).toContain(url);
    expect(letter.text).toContain("Tom Placeholder");
    expect(letter.text).not.toMatch(/owners corporation|sinking fund/i);
  });

  it("formats dates the Australian way and labels the new chat tool", async () => {
    const { toolLabel } = await import("../worker/agents/property-helpers");
    expect(formatDay("2026-11-21")).toBe("21 Nov 2026");
    expect(formatDay("2026-11-20T18:30:00.000Z")).toBe("21 Nov 2026");
    expect(formatDay(null)).toBe("not set");
    expect(toolLabel("onboarding_status")).toBe("Checking the onboarding …");
  });
});
