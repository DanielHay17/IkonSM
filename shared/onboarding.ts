// Onboarding a new strata scheme, from records transfer to operational readiness.
//
// Mirrors Ikon's own onboarding dashboard (built in Zoho Creator): a project per scheme with eight
// sections of tasks, each with an owner and a nominated approver. The outgoing strata manager supplies
// the handover documents through a secure upload portal, staff verify them, and the scheme goes live
// once the go-live checks pass and a final approval is given. See docs/ONBOARDING_SPEC.md.
//
// This file is the contract shared by the Worker, the staff screens and the outgoing manager's portal.

import { VAULT_FOLDERS } from "./types";

export type VaultFolderName = (typeof VAULT_FOLDERS)[number];

// ===========================================================================
// Staff register (the "mock team"; everyone signs in with the shared passcode)
// ===========================================================================

export type StaffRole = "principal" | "strata_manager" | "accountant" | "onboarding_officer" | "administration";

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  principal: "Principal",
  strata_manager: "Strata manager",
  accountant: "Accountant",
  onboarding_officer: "Onboarding officer",
  administration: "Administration",
};

export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
  /** Job title shown on letters and task cards. */
  title: string;
  /** null when we don't hold a confirmed address; letters then use the building agent's address. */
  email: string | null;
  /** SAMPLE people are made up for the demo and labelled as such in the UI. */
  sample: boolean;
}

/** Peter King is Ikon's principal (real); the others are SAMPLE staff for the demo. */
export const STAFF_DIRECTORY: readonly StaffMember[] = [
  { id: "peter-king", name: "Peter King", role: "principal", title: "Principal", email: null, sample: false },
  { id: "tom-placeholder", name: "Tom Placeholder", role: "strata_manager", title: "Strata Manager", email: "tom.placeholder@example.com", sample: true },
  { id: "priya-sample", name: "Priya Sample", role: "accountant", title: "Strata Accountant", email: "priya.sample@example.com", sample: true },
  { id: "mia-example", name: "Mia Example", role: "onboarding_officer", title: "Onboarding Officer", email: "mia.example@example.com", sample: true },
  { id: "lee-demo", name: "Lee Demo", role: "administration", title: "Administration Officer", email: "lee.demo@example.com", sample: true },
];

export function staffById(id: string | null | undefined): StaffMember | null {
  return STAFF_DIRECTORY.find((s) => s.id === id) ?? null;
}

/**
 * The staff member a signed-in name refers to: the full name, or a first name that only one person has,
 * case-insensitively. null for anyone not in the register (they can still work; actions record their name).
 */
export function staffForName(name: string | null | undefined): StaffMember | null {
  const clean = (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!clean) return null;
  const full = STAFF_DIRECTORY.find((s) => s.name.toLowerCase() === clean);
  if (full) return full;
  const first = STAFF_DIRECTORY.filter((s) => s.name.toLowerCase().split(" ")[0] === clean);
  return first.length === 1 ? first[0]! : null;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

// ===========================================================================
// Template (worker/seed/onboarding-template.ts holds the content)
// ===========================================================================

export const SECTION_KEYS = [
  "outgoing_manager",
  "stratafy",
  "xero",
  "appointment",
  "finance_compliance",
  "facilities_site",
  "readiness_closeout",
  "communications",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export interface TemplateTask {
  /** Stable within the template, e.g. "stratafy.lot-entitlements". */
  key: string;
  title: string;
  /** One or two sentences: what "done" means. */
  detail: string;
  /** One of the section's groups, e.g. "Financial setup". */
  group: string;
  /** Who normally does it. */
  role: StaffRole;
}

export interface TemplateSection {
  key: SectionKey;
  title: string;
  description: string;
  /** Sub-areas shown as links on the section card, e.g. ["Financial setup", "Insurance", ...]. */
  groups: string[];
  defaultOwnerRole: StaffRole;
  defaultApproverRole: StaffRole;
  tasks: TemplateTask[];
}

export interface TemplateHandoverItem {
  key: string;
  title: string;
  /** What exactly to supply, in the outgoing manager's terms. */
  detail: string;
  /** Where it is filed in Ikon's Master File Structure. */
  folder: VaultFolderName;
  /** Optional items can be marked "not applicable" without a staff waiver. */
  required: boolean;
  /** Lower-case words or phrases that identify the document in a file name or path (for auto-matching). */
  keywords: string[];
}

export interface TemplateGoLiveCheck {
  key: string;
  title: string;
  /** e.g. "Records", "Finance", "Stratafy", "Xero", "Insurance", "Compliance", "Site", "Communications". */
  group: string;
}

export interface OnboardingTemplate {
  version: string;
  sections: TemplateSection[];
  handoverItems: TemplateHandoverItem[];
  goLiveChecks: TemplateGoLiveCheck[];
}

// ===========================================================================
// A project (one per scheme being onboarded, stored in that building's agent)
// ===========================================================================

export type ProjectStatus = "draft" | "active" | "go_live_approved" | "closed";
export type GoLiveStatus = "not_reviewed" | "approved";
export type CloseoutStatus = "open" | "closed";
export type TaskStatus = "open" | "done" | "excluded" | "cancelled";
export type SectionProgress = "not_started" | "in_progress" | "complete";
export type ReviewStatus = "not_reviewed" | "reviewed" | "changes_requested";
export type HandoverItemStatus = "awaiting_supply" | "awaiting_verification" | "verified" | "rejected" | "not_applicable";
export type GoLiveCheckStatus = "open" | "verified" | "not_applicable";
export type InviteStatus = "draft" | "active" | "submitted" | "revoked" | "expired";

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "Draft",
  active: "In progress",
  go_live_approved: "Go-live approved",
  closed: "Closed",
};
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = { open: "Open", done: "Done", excluded: "Excluded", cancelled: "Cancelled" };
export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  not_reviewed: "Not reviewed",
  reviewed: "Reviewed",
  changes_requested: "Changes requested",
};
export const HANDOVER_STATUS_LABELS: Record<HandoverItemStatus, string> = {
  awaiting_supply: "Awaiting supply",
  awaiting_verification: "Awaiting verification",
  verified: "Verified",
  rejected: "Needs replacing",
  not_applicable: "Not applicable",
};
export const PROGRESS_LABELS: Record<SectionProgress, string> = { not_started: "Not started", in_progress: "In progress", complete: "Complete" };

/** The Readiness & closeout group whose tasks gate closeout (they come after go-live, so they don't block it). */
export const QA_GROUP = "Completion & quality assurance";

export function isQaGroup(group: string): boolean {
  return group.trim().toLowerCase() === QA_GROUP.toLowerCase();
}

/** not_started when nothing is done or excluded; complete when nothing is open; else in_progress. */
export function sectionProgress(c: SectionCounts): SectionProgress {
  if (c.done === 0 && c.excluded === 0) return "not_started";
  if (c.open === 0) return "complete";
  return "in_progress";
}

/** "4 / 13 tasks complete" style counts read the same everywhere: done (never done + excluded) of total. */
export function sectionTaskLine(c: SectionCounts): string {
  return `${c.done} / ${c.total} done${c.excluded ? ` · ${c.excluded} excluded` : ""}`;
}

/** YYYY-MM-DD */
export const YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
/** The address check used for outgoing managers and directory contacts. */
export const EMAIL_PATTERN = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

/** A real calendar date as YYYY-MM-DD. */
export function isCalendarDate(value: string): boolean {
  const m = YMD_PATTERN.exec(value);
  if (!m) return false;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.getUTCFullYear() === Number(m[1]) && date.getUTCMonth() === Number(m[2]) - 1 && date.getUTCDate() === Number(m[3]);
}

/**
 * Invitation dates that make sense together, or the reason they don't: the records are due on or before the
 * handover date, and the handover is not in the past. `today` is YYYY-MM-DD (Perth).
 */
export function inviteDatesProblem(handoverDate: string, recordsDueDate: string, today: string): string | null {
  if (handoverDate < today) return "The handover date can't be in the past";
  if (recordsDueDate > handoverDate) return "The records must be due on or before the handover date";
  return null;
}

/** Characters that can disguise text (bidi overrides, zero-width marks, C0/C1 controls); never shown or stored. */
export const INVISIBLE_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** Removes INVISIBLE_CHARS (keeps tabs and line breaks for notes). */
export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE_CHARS, "");
}

export interface OnboardingTask {
  id: string;
  sectionKey: SectionKey;
  key: string;
  title: string;
  detail: string;
  group: string;
  status: TaskStatus;
  ownerId: string | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  note: string | null;
  completedBy: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface SectionCounts {
  total: number;
  done: number;
  /** excluded + cancelled ("0 excluded or cancelled" on the card) */
  excluded: number;
  open: number;
}

export interface OnboardingSection {
  key: SectionKey;
  title: string;
  description: string;
  groups: string[];
  ownerId: string | null;
  approverId: string | null;
  review: ReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  /** Derived: not_started (nothing done), complete (no open tasks), else in_progress. */
  progress: SectionProgress;
  counts: SectionCounts;
}

export interface HandoverFile {
  docId: string;
  name: string;
  folder: VaultFolderName;
  size: number;
  uploadedAt: string;
  /** The outgoing manager's name (portal uploads) or a staff name. */
  uploadedBy: string;
  /** Path inside the zip or folder it came from, if any (e.g. "SP87192/Insurance/Policy 2026.pdf"). */
  sourcePath: string | null;
  /** The invitation (secure link) it was uploaded through; staff label uploads from a withdrawn or expired link. */
  inviteId: string | null;
  /**
   * Set once the document is a trusted building record: its item was verified, or staff verified it on its own
   * (an extra file). null while it is still an unverified upload from the outgoing manager.
   */
  verifiedBy: string | null;
  verifiedAt: string | null;
}

export interface HandoverItem {
  id: string;
  key: string;
  title: string;
  detail: string;
  folder: VaultFolderName;
  required: boolean;
  status: HandoverItemStatus;
  files: HandoverFile[];
  /** From the outgoing manager (e.g. why it is not applicable). */
  supplierNote: string | null;
  /** The invitation whose holder wrote supplierNote (staff label notes from a withdrawn or expired link). */
  supplierNoteInviteId: string | null;
  /**
   * The outgoing manager says this required document does not apply (status awaiting_verification, usually with
   * no files). Staff accept it (status not_applicable) or send it back; it is never "verified" without a document.
   */
  notApplicableClaimed: boolean;
  /** From Ikon staff; shown to the outgoing manager when a document is rejected. */
  reviewNote: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  updatedAt: string;
}

export interface GoLiveCheck {
  id: string;
  key: string;
  title: string;
  group: string;
  status: GoLiveCheckStatus;
  checkedBy: string | null;
  checkedAt: string | null;
  note: string | null;
}

export interface OutgoingManagerDetails {
  company: string;
  name: string;
  email: string;
  phone: string | null;
}

export interface HandoverInvite {
  id: string;
  status: InviteStatus;
  /** Ikon's incoming manager, from the staff register. */
  incomingManagerId: string;
  outgoingManager: OutgoingManagerDetails;
  /** YYYY-MM-DD: the day Ikon takes over management. */
  handoverDate: string;
  /** YYYY-MM-DD: the day the records are due. */
  recordsDueDate: string;
  createdBy: string;
  createdAt: string;
  activatedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  submittedAt: string | null;
  lastAccessAt: string | null;
  accessCount: number;
  /** The email draft (in Approvals) that carries the letter and the link. */
  approvalId: string | null;
}

export interface FinalApproval {
  approvedBy: string;
  approvedAt: string;
  note: string | null;
}

export interface ProjectCounts {
  tasks: number;
  tasksDone: number;
  tasksExcluded: number;
  handoverItems: number;
  handoverAwaitingSupply: number;
  handoverAwaitingVerification: number;
  handoverVerified: number;
  handoverNotApplicable: number;
  handoverRejected: number;
  goLiveChecks: number;
  goLiveVerified: number;
  goLiveNotApplicable: number;
  /** Files the outgoing manager uploaded that are not attached to a requested item. */
  extraFiles: number;
}

export interface OnboardingProject {
  id: string;
  propertyId: string;
  /** e.g. "SP87192 – Pilot onboarding" */
  name: string;
  status: ProjectStatus;
  goLive: GoLiveStatus;
  closeout: CloseoutStatus;
  /** YYYY-MM-DD */
  targetGoLiveDate: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  templateVersion: string;
  /** Loaded by the demo scenario (cleared by "Clear simulated messages"). */
  demo: boolean;
  sections: OnboardingSection[];
  counts: ProjectCounts;
  invites: HandoverInvite[];
  finalApproval: FinalApproval | null;
  /** Why go-live can't be approved yet, in plain English; empty when it can. */
  blockers: string[];
}

export type OnboardingEventKind = "project" | "task" | "section" | "handover" | "upload" | "invite" | "portal" | "golive" | "approval";

/** Who caused an event: Ikon staff (and the hub itself), or the outgoing manager through the portal. */
export type OnboardingEventOrigin = "staff" | "portal";

export interface OnboardingEvent {
  id: string;
  at: string;
  kind: OnboardingEventKind;
  /** A staff name, the outgoing manager's name, or "agent". */
  actor: string;
  summary: string;
  detail: string | null;
  /** Portal events are kept and listed apart, so the outgoing manager's traffic never pushes staff actions out. */
  origin: OnboardingEventOrigin;
}

/** Events returned with a project: the newest of each origin, so neither can crowd the other out. */
export const ONBOARDING_EVENT_LIMIT = 200;

export interface OnboardingProjectDetail extends OnboardingProject {
  tasks: OnboardingTask[];
  handoverItems: HandoverItem[];
  /** Uploaded files that were not matched to a requested item (still filed in the building's Files). */
  extraFiles: HandoverFile[];
  goLiveChecks: GoLiveCheck[];
  /**
   * Newest first: at most ONBOARDING_EVENT_LIMIT staff events plus at most ONBOARDING_EVENT_LIMIT portal events
   * (uploads are recorded once per upload session, not once per file).
   */
  events: OnboardingEvent[];
}

/** One row of the portfolio onboarding dashboard. */
export interface OnboardingSummary {
  propertyId: string;
  spNumber: string;
  street: string;
  suburb: string;
  buildingStatus: "pilot" | "active" | "onboarding";
  project: OnboardingProject | null;
  /** The building's agent did not answer: its project (if any) is unknown, so it is not offered for a new one. */
  unavailable: boolean;
}

// ===========================================================================
// Directories (hub-wide; stored in the Chief of Staff agent)
// ===========================================================================

export interface ManagementCompany {
  id: string;
  name: string;
  abn: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  notes: string | null;
  sample: boolean;
  createdAt: string;
}

export interface OutgoingManagerContact {
  id: string;
  companyId: string | null;
  name: string;
  email: string;
  phone: string | null;
  sample: boolean;
  createdAt: string;
}

// ===========================================================================
// The outgoing manager's portal (public, reached with the secure link)
// ===========================================================================

export interface PortalItem {
  id: string;
  key: string;
  title: string;
  detail: string;
  folder: VaultFolderName;
  required: boolean;
  status: HandoverItemStatus;
  files: { name: string; size: number; uploadedAt: string }[];
  supplierNote: string | null;
  /** Only when Ikon rejected a document: what to supply instead. */
  reviewNote: string | null;
  /**
   * The words the server matches uploads on (this project's checklist). The portal builds its
   * HandoverMatchTarget[] from the items ({ id, key, title, folder, keywords }) so its suggestions agree
   * with the server's auto-match.
   */
  keywords: string[];
}

export interface PortalView {
  building: { spNumber: string; street: string; suburb: string; postcode: string | null };
  companyName: string;
  incomingManager: { name: string; title: string; email: string };
  outgoingManager: { name: string; company: string };
  handoverDate: string;
  recordsDueDate: string;
  expiresAt: string;
  submittedAt: string | null;
  folders: VaultFolderName[];
  items: PortalItem[];
  extraFiles: { name: string; folder: VaultFolderName; size: number; uploadedAt: string }[];
  progress: { total: number; supplied: number; verified: number; notApplicable: number; outstanding: number };
  /** Upload limits the portal enforces before sending. */
  limits: { maxFileBytes: number; maxFilesPerInvite: number };
}

export interface PortalUploadResult {
  file: { name: string; folder: VaultFolderName; size: number };
  /** The requested item it was attached to, if any. */
  itemId: string | null;
  itemTitle: string | null;
}

/** Secure links look like "<sp number>-<43 base64url chars>", so the Worker can route to the building. */
export const PORTAL_TOKEN = /^(\d{3,6})-([A-Za-z0-9_-]{43})$/;

/** Uploads from the portal are untrusted until staff verify them (like emailed attachments). */
export const HANDOVER_UPLOAD_PREFIX = "handover:";

export function handoverUploadedBy(uploadedBy: string | null | undefined): string | null {
  return uploadedBy?.startsWith(HANDOVER_UPLOAD_PREFIX) ? uploadedBy.slice(HANDOVER_UPLOAD_PREFIX.length) || "outgoing manager" : null;
}

// ===========================================================================
// Matching uploaded files to requested documents (shared/handover-match.ts)
// ===========================================================================

export interface HandoverMatchTarget {
  id: string;
  key: string;
  title: string;
  folder: VaultFolderName;
  keywords: string[];
}

export interface HandoverMatch {
  /** The best requested item, or null when nothing fits well enough. */
  itemId: string | null;
  folder: VaultFolderName;
  /** 0..1 */
  confidence: number;
  /** Short, human: "file name mentions 'insurance policy'". */
  reason: string;
  /** Junk that should not be uploaded at all (.DS_Store, __MACOSX/, Thumbs.db, ~$ lock files, empty). */
  skip: boolean;
}

// ===========================================================================
// API request bodies (validated with zod in the Worker)
// ===========================================================================

export interface CreateProjectInput {
  name?: string;
  targetGoLiveDate?: string | null;
}
export interface TaskPatch {
  status?: TaskStatus;
  ownerId?: string | null;
  dueDate?: string | null;
  note?: string | null;
}
export interface SectionPatch {
  ownerId?: string | null;
  approverId?: string | null;
}
export interface SectionReviewInput {
  decision: "reviewed" | "changes_requested" | "not_reviewed";
  note?: string | null;
}
export interface HandoverItemPatch {
  /**
   * "awaiting_supply" is Reopen: an item that still has files goes back to awaiting_verification instead.
   * "verified" needs a file, or a reviewNote saying how it was received (e.g. originals handed over on paper);
   * an item the outgoing manager claimed not applicable is accepted with "not_applicable", never "verified".
   */
  status: "verified" | "rejected" | "not_applicable" | "awaiting_supply";
  reviewNote?: string | null;
}
/** A staff action on one uploaded file: verify it as a building record, or attach it to a requested document. */
export type HandoverFileAction = { action: "verify" } | { action: "attach"; itemId: string };
export interface GoLiveCheckPatch {
  status: GoLiveCheckStatus;
  note?: string | null;
}
export interface CreateInviteInput {
  incomingManagerId: string;
  outgoingManager: OutgoingManagerDetails;
  handoverDate: string;
  recordsDueDate: string;
}
export interface FinalApprovalInput {
  note?: string | null;
}
