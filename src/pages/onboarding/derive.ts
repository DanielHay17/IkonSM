// Pure helpers for the onboarding staff screens: labels, counts recomputed after a local change, the Tasks
// filters, grouping, the handover invitations and the project map's milestones. No React and no DOM, so
// test/onboarding-ui.spec.ts can run them against the real demo project in workerd.

import {
  PROJECT_STATUS_LABELS,
  QA_GROUP,
  REVIEW_STATUS_LABELS,
  SECTION_KEYS,
  sectionProgress,
  TASK_STATUS_LABELS,
  staffById,
  type CloseoutStatus,
  type GoLiveCheck,
  type GoLiveStatus,
  type HandoverInvite,
  type HandoverItem,
  type OnboardingProject,
  type OnboardingProjectDetail,
  type OnboardingSection,
  type OnboardingTask,
  type ProjectCounts,
  type SectionCounts,
  type SectionKey,
  type TaskStatus,
  type VaultFolderName,
} from "../../../shared/onboarding";
import { formatLongDate } from "../../../shared/handover-letter";
import { VAULT_FOLDERS } from "../../../shared/types";

export const GO_LIVE_LABELS: Record<GoLiveStatus, string> = { not_reviewed: "Not reviewed", approved: "Approved" };
export const CLOSEOUT_LABELS: Record<CloseoutStatus, string> = { open: "Open", closed: "Closed" };

// The Readiness & closeout group that gates closeout, and the section progress rule, are the Worker's own
// (shared/onboarding.ts), so the screens and the server can't disagree.
export { QA_GROUP, sectionProgress };

// ===========================================================================
// Headline numbers
// ===========================================================================

/**
 * How far through the checklist a project is: done plus excluded tasks over all tasks, rounded down so 100%
 * only shows once nothing is open. Used for the building chip, the dashboard and the project header alike.
 */
export function percentComplete(counts: Pick<ProjectCounts, "tasks" | "tasksDone" | "tasksExcluded">): number {
  if (counts.tasks <= 0) return 0;
  return Math.floor(((counts.tasksDone + counts.tasksExcluded) / counts.tasks) * 100);
}

/** "Project: In progress · Go-live: Not reviewed · Closeout: Open", as on Peter's dashboard. */
export function statusLine(project: Pick<OnboardingProject, "status" | "goLive" | "closeout">): string {
  return `Project: ${PROJECT_STATUS_LABELS[project.status]} · Go-live: ${GO_LIVE_LABELS[project.goLive]} · Closeout: ${CLOSEOUT_LABELS[project.closeout]}`;
}

/** "82 tasks · 30 handover items · 56 go-live checks" */
export function scopeLine(counts: ProjectCounts): string {
  return `${counts.tasks} tasks · ${counts.handoverItems} handover items · ${counts.goLiveChecks} go-live checks`;
}

export function staffName(id: string | null | undefined, fallback = "Unassigned"): string {
  return staffById(id)?.name ?? fallback;
}

// ===========================================================================
// Recomputing counts after a local (optimistic) change
// ===========================================================================

export function countTasks(tasks: readonly OnboardingTask[]): SectionCounts {
  const counts: SectionCounts = { total: tasks.length, done: 0, excluded: 0, open: 0 };
  for (const task of tasks) {
    if (task.status === "done") counts.done++;
    else if (task.status === "open") counts.open++;
    else counts.excluded++;
  }
  return counts;
}

/** The project with one task replaced, its section's counts and progress and the project's task counts redone. */
export function withTask(detail: OnboardingProjectDetail, task: OnboardingTask): OnboardingProjectDetail {
  const tasks = detail.tasks.map((t) => (t.id === task.id ? task : t));
  const sections = detail.sections.map((section) => {
    if (section.key !== task.sectionKey) return section;
    const counts = countTasks(tasks.filter((t) => t.sectionKey === section.key));
    return { ...section, counts, progress: sectionProgress(counts) };
  });
  const all = countTasks(tasks);
  return { ...detail, tasks, sections, counts: { ...detail.counts, tasksDone: all.done, tasksExcluded: all.excluded } };
}

export function handoverCounts(items: readonly HandoverItem[]): Pick<
  ProjectCounts,
  "handoverAwaitingSupply" | "handoverAwaitingVerification" | "handoverVerified" | "handoverNotApplicable" | "handoverRejected"
> {
  const count = (status: HandoverItem["status"]) => items.filter((item) => item.status === status).length;
  return {
    handoverAwaitingSupply: count("awaiting_supply"),
    handoverAwaitingVerification: count("awaiting_verification"),
    handoverVerified: count("verified"),
    handoverNotApplicable: count("not_applicable"),
    handoverRejected: count("rejected"),
  };
}

export function withHandoverItem(detail: OnboardingProjectDetail, item: HandoverItem): OnboardingProjectDetail {
  const handoverItems = detail.handoverItems.map((i) => (i.id === item.id ? item : i));
  return { ...detail, handoverItems, counts: { ...detail.counts, ...handoverCounts(handoverItems) } };
}

export function withGoLiveCheck(detail: OnboardingProjectDetail, check: GoLiveCheck): OnboardingProjectDetail {
  const goLiveChecks = detail.goLiveChecks.map((c) => (c.id === check.id ? check : c));
  return {
    ...detail,
    goLiveChecks,
    counts: {
      ...detail.counts,
      goLiveVerified: goLiveChecks.filter((c) => c.status === "verified").length,
      goLiveNotApplicable: goLiveChecks.filter((c) => c.status === "not_applicable").length,
    },
  };
}

/** Works on a summary (dashboard) or a detail (project page): the section's counts come from the server. */
export function withSection<P extends OnboardingProject>(project: P, section: OnboardingSection): P {
  return { ...project, sections: project.sections.map((s) => (s.key === section.key ? section : s)) };
}


// ===========================================================================
// Tasks: filters (kept in the URL) and grouping
// ===========================================================================

export type TaskStatusFilter = TaskStatus | "not_done";

export interface TaskFilters {
  section: SectionKey | null;
  /** One of the section's groups (the sub-area links on a section card). */
  group: string | null;
  /** A staff id, or "unassigned". */
  owner: string | null;
  status: TaskStatusFilter | null;
  /** Only the acting staff member's tasks. */
  mine: boolean;
}

export const NO_TASK_FILTERS: TaskFilters = { section: null, group: null, owner: null, status: null, mine: false };

export const TASK_STATUS_FILTER_LABELS: Record<TaskStatusFilter, string> = { not_done: "Not done", ...TASK_STATUS_LABELS };

const TASK_STATUS_FILTERS = Object.keys(TASK_STATUS_FILTER_LABELS) as TaskStatusFilter[];

export function parseTaskFilters(search: string): TaskFilters {
  const params = new URLSearchParams(search);
  const section = params.get("section");
  const status = params.get("status");
  return {
    section: section && (SECTION_KEYS as readonly string[]).includes(section) ? (section as SectionKey) : null,
    group: params.get("group")?.trim() || null,
    owner: params.get("owner")?.trim() || null,
    status: status && (TASK_STATUS_FILTERS as string[]).includes(status) ? (status as TaskStatusFilter) : null,
    mine: params.get("mine") === "1",
  };
}

export function taskFilterQuery(filters: TaskFilters): Record<string, string | null> {
  return {
    section: filters.section,
    group: filters.group,
    owner: filters.owner,
    status: filters.status,
    mine: filters.mine ? "1" : null,
  };
}

export function hasTaskFilters(filters: TaskFilters): boolean {
  return !!(filters.section || filters.group || filters.owner || filters.status || filters.mine);
}

export function filterTasks(tasks: readonly OnboardingTask[], filters: TaskFilters, actingStaffId: string | null): OnboardingTask[] {
  const group = filters.group?.toLowerCase() ?? null;
  return tasks.filter((task) => {
    if (filters.section && task.sectionKey !== filters.section) return false;
    if (group && task.group.toLowerCase() !== group) return false;
    if (filters.owner === "unassigned" ? task.ownerId !== null : filters.owner && task.ownerId !== filters.owner) return false;
    if (filters.status === "not_done" ? task.status !== "open" : filters.status && task.status !== filters.status) return false;
    if (filters.mine && (!actingStaffId || task.ownerId !== actingStaffId)) return false;
    return true;
  });
}

export interface TaskSectionBlock {
  section: OnboardingSection;
  groups: { group: string; tasks: OnboardingTask[] }[];
  /** Tasks shown in this block. */
  count: number;
}

/** Tasks by section (in the project's order), then by group (the section's own order, then any others). */
export function groupTasks(sections: readonly OnboardingSection[], tasks: readonly OnboardingTask[]): TaskSectionBlock[] {
  return sections
    .map((section) => {
      const inSection = tasks.filter((t) => t.sectionKey === section.key);
      const order = [...section.groups];
      for (const task of inSection) if (!order.some((g) => g.toLowerCase() === task.group.toLowerCase())) order.push(task.group);
      const groups = order
        .map((group) => ({ group, tasks: inSection.filter((t) => t.group.toLowerCase() === group.toLowerCase()) }))
        .filter((g) => g.tasks.length > 0);
      return { section, groups, count: inSection.length };
    })
    .filter((block) => block.count > 0);
}

/** "2026-11-07" in the viewer's local day, for comparing with YYYY-MM-DD due dates. */
export function localDay(now: number = Date.now()): string {
  const date = new Date(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isOverdue(task: Pick<OnboardingTask, "status" | "dueDate">, today: string): boolean {
  return task.status === "open" && !!task.dueDate && task.dueDate < today;
}

// ===========================================================================
// Handover items and invitations
// ===========================================================================

/** Requested documents by Master File Structure folder, in folder order; empty folders left out. */
export function itemsByFolder(items: readonly HandoverItem[]): { folder: VaultFolderName; items: HandoverItem[] }[] {
  const order: VaultFolderName[] = [...VAULT_FOLDERS];
  for (const item of items) if (!order.includes(item.folder)) order.push(item.folder);
  return order.map((folder) => ({ folder, items: items.filter((i) => i.folder === folder) })).filter((g) => g.items.length > 0);
}

/** Items that still need the outgoing manager: awaiting supply, or sent back to be replaced. */
export function outstandingCount(counts: ProjectCounts): number {
  return counts.handoverAwaitingSupply + counts.handoverRejected;
}

export interface InviteBuckets {
  /** Saved but not activated ("N saved drafts"). */
  drafts: HandoverInvite[];
  /** The live link: active, or submitted and still open for late documents. */
  current: HandoverInvite | null;
}

export function inviteBuckets(invites: readonly HandoverInvite[]): InviteBuckets {
  const sorted = [...invites].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const current = sorted.find((i) => i.status === "active") ?? sorted.find((i) => i.status === "submitted") ?? null;
  return {
    drafts: sorted.filter((i) => i.status === "draft"),
    current,
  };
}

// ===========================================================================
// The project map
// ===========================================================================

export type MilestoneStatus = "done" | "in_progress" | "not_started" | "blocked";
export type MilestonePhase = "handover" | "setup" | "golive";
/** The project tabs a milestone links to (a subset of the router's OnboardingTab). */
export type MilestoneTab = "overview" | "tasks" | "handover" | "golive" | "approvals";

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  done: "Done",
  in_progress: "In progress",
  not_started: "Not started",
  blocked: "Blocked",
};

export const MILESTONE_PHASES: { key: MilestonePhase; title: string }[] = [
  { key: "handover", title: "Records handover" },
  { key: "setup", title: "Set-up" },
  { key: "golive", title: "Go-live" },
];

export interface MilestoneLink {
  label: string;
  tab: MilestoneTab;
  query?: Record<string, string>;
  hash?: string;
}

export interface Milestone {
  key: string;
  title: string;
  phase: MilestonePhase;
  status: MilestoneStatus;
  /** The counts, e.g. "12 / 17 tasks". */
  counts: string;
  /** A short line on why it has that status, e.g. "Changes requested" or "Opened 3 times". */
  note: string | null;
  /** Staff register ids of who owns this part (initials on the map). */
  ownerIds: string[];
  links: MilestoneLink[];
}

const unique = <T>(values: T[]) => [...new Set(values)];

function sectionStatus(...sections: OnboardingSection[]): MilestoneStatus {
  if (sections.some((s) => s.review === "changes_requested")) return "blocked";
  if (sections.every((s) => s.progress === "complete")) return "done";
  if (sections.every((s) => s.progress === "not_started")) return "not_started";
  return "in_progress";
}

function reviewNote(...sections: OnboardingSection[]): string {
  if (sections.some((s) => s.review === "changes_requested")) return "Changes requested";
  if (sections.every((s) => s.review === "reviewed")) return REVIEW_STATUS_LABELS.reviewed;
  if (sections.some((s) => s.review === "reviewed")) return "Partly reviewed";
  return REVIEW_STATUS_LABELS.not_reviewed;
}

/** "4 / 13 done · 1 excluded": the same convention as the section cards and the Approvals tab. */
function taskCounts(...sections: OnboardingSection[]): string {
  const done = sections.reduce((n, s) => n + s.counts.done, 0);
  const excluded = sections.reduce((n, s) => n + s.counts.excluded, 0);
  const total = sections.reduce((n, s) => n + s.counts.total, 0);
  return `${done} / ${total} done${excluded ? ` · ${excluded} excluded` : ""}`;
}

function sectionMilestone(key: string, title: string, phase: MilestonePhase, section: OnboardingSection): Milestone {
  return {
    key,
    title,
    phase,
    status: sectionStatus(section),
    counts: taskCounts(section),
    note: reviewNote(section),
    ownerIds: section.ownerId ? [section.ownerId] : [],
    links: [{ label: section.title, tab: "tasks", query: { section: section.key } }],
  };
}

/**
 * The milestones from appointment to closeout, all derived from the project detail: Appointed → Handover
 * requested → Records received → Records verified → Systems set up (Stratafy + Xero) → Finance & compliance →
 * Facilities & site → Communications → Go-live checks → Go-live approved → Closed out.
 */
export function projectMilestones(detail: OnboardingProjectDetail, now: number = Date.now()): Milestone[] {
  const section = (key: SectionKey) => detail.sections.find((s) => s.key === key)!;
  const { counts } = detail;
  const { drafts, current } = inviteBuckets(detail.invites);
  const latest = current ?? [...detail.invites].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const everActivated = detail.invites.some((i) => i.activatedAt);
  const closed = detail.closeout === "closed";
  const outstanding = outstandingCount(counts);
  const received = counts.handoverItems - outstanding;
  const today = localDay(now);

  // Handover requested
  let requested: Pick<Milestone, "status" | "note" | "counts">;
  if (everActivated) {
    const live = current !== null;
    requested = {
      status: live || closed || outstanding === 0 ? "done" : "blocked",
      counts: current?.submittedAt ? "Pack submitted" : current ? (current.accessCount ? `Opened ${current.accessCount === 1 ? "once" : `${current.accessCount} times`}` : "Not opened yet") : "Link sent",
      note: live || closed || outstanding === 0 ? (current?.outgoingManager.name ?? null) : "No live link: prepare a new one",
    };
  } else if (drafts.length) {
    requested = { status: "in_progress", counts: drafts.length === 1 ? "1 draft saved" : `${drafts.length} drafts saved`, note: "Activate the link to send it" };
  } else {
    requested = { status: "not_started", counts: "No invitation yet", note: null };
  }

  // Records received: every item supplied (or marked not applicable).
  const dueDate = current?.recordsDueDate ?? latest?.recordsDueDate ?? null;
  const overdue = !!dueDate && dueDate < today && outstanding > 0 && !closed;
  const receivedStatus: MilestoneStatus = outstanding === 0 ? "done" : overdue ? "blocked" : received > 0 || everActivated ? "in_progress" : "not_started";
  const receivedNote = overdue
    ? `Overdue: records were due ${formatLongDate(dueDate)}`
    : current?.submittedAt
      ? "Outgoing manager submitted the pack"
      : outstanding > 0
        ? `${outstanding} still to come`
        : null;

  // Records verified: every required item verified or not applicable (what go-live needs).
  const requiredOpen = detail.handoverItems.filter((i) => i.required && i.status !== "verified" && i.status !== "not_applicable").length;
  const settled = counts.handoverVerified + counts.handoverNotApplicable;
  const verifiedStatus: MilestoneStatus =
    requiredOpen === 0 ? "done" : counts.handoverRejected > 0 ? "blocked" : settled > 0 || counts.handoverAwaitingVerification > 0 ? "in_progress" : "not_started";
  const verifiedNote =
    counts.handoverRejected > 0
      ? `${counts.handoverRejected} ${counts.handoverRejected === 1 ? "needs" : "need"} replacing`
      : counts.handoverAwaitingVerification > 0
        ? `${counts.handoverAwaitingVerification} awaiting verification`
        : requiredOpen > 0
          ? `${requiredOpen} required still open`
          : null;

  const outgoing = section("outgoing_manager");
  const stratafy = section("stratafy");
  const xero = section("xero");
  const readiness = section("readiness_closeout");

  // Go-live checks
  const checksSettled = counts.goLiveVerified + counts.goLiveNotApplicable;
  const checksStatus: MilestoneStatus =
    checksSettled >= counts.goLiveChecks ? "done" : checksSettled > 0 ? "in_progress" : "not_started";

  // Go-live approved
  const approved = detail.goLive === "approved";
  const blockers = detail.blockers.length;
  const approvalStatus: MilestoneStatus = approved ? "done" : blockers === 0 ? "in_progress" : "blocked";
  const approvalNote = approved
    ? detail.finalApproval
      ? `Approved by ${detail.finalApproval.approvedBy}`
      : "Approved"
    : blockers === 0
      ? "Ready for final approval"
      : `Blocked by ${blockers} ${blockers === 1 ? "item" : "items"}`;

  // Closed out: after go-live, once the completion and quality assurance tasks are done.
  const qa = detail.tasks.filter((t) => t.sectionKey === "readiness_closeout" && t.group.toLowerCase() === QA_GROUP.toLowerCase());
  const qaSettled = qa.filter((t) => t.status !== "open").length;
  const closeStatus: MilestoneStatus = closed ? "done" : approved ? "in_progress" : "not_started";

  return [
    sectionMilestone("appointed", "Appointed", "handover", section("appointment")),
    {
      key: "requested",
      title: "Handover requested",
      phase: "handover",
      ...requested,
      ownerIds: latest ? [latest.incomingManagerId] : [],
      links: [{ label: "Handover invitation", tab: "overview", hash: "handover-invitation" }],
    },
    {
      key: "received",
      title: "Records received",
      phase: "handover",
      status: receivedStatus,
      counts: `${received} / ${counts.handoverItems} received`,
      note: receivedNote,
      ownerIds: outgoing.ownerId ? [outgoing.ownerId] : [],
      links: [{ label: "Handover records", tab: "handover" }],
    },
    {
      key: "verified",
      title: "Records verified",
      phase: "handover",
      status: verifiedStatus,
      counts: `${settled} / ${counts.handoverItems} verified or N/A`,
      note: verifiedNote,
      ownerIds: outgoing.ownerId ? [outgoing.ownerId] : [],
      links: [{ label: "Awaiting verification", tab: "handover", query: { status: "awaiting_verification" } }],
    },
    {
      key: "systems",
      title: "Systems set up",
      phase: "setup",
      status: sectionStatus(stratafy, xero),
      counts: taskCounts(stratafy, xero),
      note: `Stratafy + Xero · ${reviewNote(stratafy, xero)}`,
      ownerIds: unique([stratafy.ownerId, xero.ownerId].filter((id): id is string => !!id)),
      links: [
        { label: "Stratafy", tab: "tasks", query: { section: "stratafy" } },
        { label: "Xero", tab: "tasks", query: { section: "xero" } },
      ],
    },
    sectionMilestone("finance", "Finance & compliance", "setup", section("finance_compliance")),
    sectionMilestone("facilities", "Facilities & site", "setup", section("facilities_site")),
    sectionMilestone("communications", "Communications", "setup", section("communications")),
    {
      key: "checks",
      title: "Go-live checks",
      phase: "golive",
      status: checksStatus,
      counts: `${checksSettled} / ${counts.goLiveChecks} checks`,
      note: checksSettled < counts.goLiveChecks ? `${counts.goLiveChecks - checksSettled} to do` : null,
      ownerIds: readiness.ownerId ? [readiness.ownerId] : [],
      links: [{ label: "Go-live checks", tab: "golive" }],
    },
    {
      key: "approved",
      title: "Go-live approved",
      phase: "golive",
      status: approvalStatus,
      counts: approved ? "Approved" : blockers === 0 ? "No blockers" : `${blockers} ${blockers === 1 ? "blocker" : "blockers"}`,
      note: approvalNote,
      ownerIds: readiness.approverId ? [readiness.approverId] : [],
      links: [{ label: "Final approval", tab: "approvals" }],
    },
    {
      key: "closed",
      title: "Closed out",
      phase: "golive",
      status: closeStatus,
      counts: `${qaSettled} / ${qa.length} QA tasks`,
      note: closed ? "Project closed" : approved ? "Finish the quality assurance tasks" : "After go-live approval",
      ownerIds: readiness.ownerId ? [readiness.ownerId] : [],
      links: [{ label: "Closeout", tab: "approvals" }],
    },
  ];
}

export function milestoneTally(milestones: readonly Milestone[]): Record<MilestoneStatus, number> {
  const tally: Record<MilestoneStatus, number> = { done: 0, in_progress: 0, not_started: 0, blocked: 0 };
  for (const m of milestones) tally[m.status]++;
  return tally;
}
