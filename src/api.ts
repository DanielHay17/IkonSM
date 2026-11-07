// Typed client for the hub's REST API (BUILD_SPEC Module E). Every mutation goes through
// these authenticated routes; the agent websockets are read-only live state.

import type {
  AiEngineChoice,
  ActivityEvent,
  Approval,
  ApprovalDecision,
  ApprovalStatus,
  Channel,
  ChatMessage,
  Contact,
  ContactRole,
  DocMeta,
  MemoryNote,
  Message,
  OneDriveImportResponse,
  OneDriveItemRef,
  OneDriveListing,
  OneDriveSource,
  OneDriveStatus,
  PortfolioBrief,
  PropertyCard,
  PropertyOverview,
  SearchHit,
  SessionInfo,
  Thread,
  ThreadStatus,
  Ticket,
  TicketInput,
  TicketStatus,
  Triage,
} from "../shared/types";
import type {
  CreateInviteInput,
  CreateProjectInput,
  FinalApprovalInput,
  GoLiveCheck,
  GoLiveCheckPatch,
  HandoverInvite,
  HandoverItem,
  HandoverItemPatch,
  ManagementCompany,
  OnboardingProject,
  OnboardingProjectDetail,
  OnboardingSection,
  OnboardingSummary,
  OnboardingTask,
  OutgoingManagerContact,
  SectionKey,
  SectionPatch,
  SectionReviewInput,
  StaffMember,
  TaskPatch,
} from "../shared/onboarding";

export interface ThreadDetail {
  thread: Thread;
  messages: Message[];
  approvals: Approval[];
  ticket: Ticket | null;
}

export interface SimulateInput {
  channel: Channel;
  fromName: string | null;
  fromAddress: string;
  subject: string;
  text: string;
  /** Start a fresh thread instead of joining one with the same sender and subject. */
  newThread?: boolean;
}

/** One level of the Microsoft 365 picker: a source, then optionally a site, a drive and a folder in it. */
export interface OneDriveLocation {
  source: OneDriveSource;
  siteId?: string;
  driveId?: string;
  itemId?: string;
}

export type TicketPatch = Partial<TicketInput> & { status?: TicketStatus };
export type ContactInput = Omit<Contact, "id">;
export type ThreadFilter = ThreadStatus | "open";

export class ApiError extends Error {
  readonly status: number;
  /** The parsed error body, for routes that say more than `error` (a blocked go-live lists its blockers). */
  readonly payload: unknown;

  constructor(status: number, message: string, payload: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

/** Human-readable message for anything thrown by an API call or elsewhere. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return "Something went wrong";
}

export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/** Paths whose 401 means "wrong passcode" or "not signed in yet", not "session expired". */
const AUTH_PATHS = new Set(["/api/login", "/api/session"]);

let unauthorizedHandler: (() => void) | null = null;

/** Called whenever a request fails with 401 because the session expired. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = { method, credentials: "include", headers };

  if (body instanceof FormData) {
    init.body = body; // the browser sets the multipart boundary
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, "Could not reach the hub. Check your connection and try again.");
  }

  const payload = await readPayload(res);
  if (!res.ok) {
    if (res.status === 401 && !AUTH_PATHS.has(path)) unauthorizedHandler?.();
    throw new ApiError(res.status, failureMessage(res, payload), payload);
  }
  return payload as T;
}

async function readPayload(res: Response): Promise<unknown> {
  const type = res.headers.get("Content-Type") ?? "";
  try {
    return type.includes("application/json") ? await res.json() : await res.text();
  } catch {
    return null;
  }
}

function failureMessage(res: Response, payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error: unknown }).error;
    if (typeof error === "string" && error) return error;
  }
  if (res.status === 413) return "That file is too large to upload.";
  if (res.status >= 500) return "The hub hit an error. Please try again in a moment.";
  return `Request failed (${res.status})`;
}

const get = <T>(path: string) => request<T>("GET", path);
/** Mutations always send a JSON body: the API rejects bodiless POSTs as a CSRF guard. */
const post = <T>(path: string, body: unknown = {}) => request<T>("POST", path, body);
const put = <T>(path: string, body: unknown) => request<T>("PUT", path, body);
const patch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);
const del = <T>(path: string) => request<T>("DELETE", path);

function withQuery(path: string, params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

const seg = encodeURIComponent;
const prop = (id: string) => `/api/properties/${seg(id)}`;

// ---------------------------------------------------------------------------
// Onboarding a new scheme (staff screens; docs/ONBOARDING_SPEC.md "API")
// ---------------------------------------------------------------------------

export type CompanyInput = Partial<Omit<ManagementCompany, "id" | "name" | "sample" | "createdAt">> & { name: string };
export type OutgoingManagerInput = { companyId?: string | null; name: string; email: string; phone?: string | null };

/** The reasons a go-live approval was refused (409 `{ error, blockers }`), or null for any other error. */
export function goLiveBlockers(err: unknown): string[] | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const payload = err.payload as { blockers?: unknown } | null;
  return Array.isArray(payload?.blockers) ? payload.blockers.filter((b): b is string => typeof b === "string") : null;
}

const onboarding = (id: string) => `${prop(id)}/onboarding`;

export const onboardingApi = {
  // Hub-wide
  staff: () => get<StaffMember[]>("/api/staff"),
  list: () => get<OnboardingSummary[]>("/api/onboarding"),
  companies: () => get<ManagementCompany[]>("/api/directory/companies"),
  addCompany: (input: CompanyInput) => post<ManagementCompany>("/api/directory/companies", input),
  outgoingManagers: () => get<OutgoingManagerContact[]>("/api/directory/outgoing-managers"),
  addOutgoingManager: (input: OutgoingManagerInput) => post<OutgoingManagerContact>("/api/directory/outgoing-managers", input),

  // One building's project
  project: (id: string) => get<OnboardingProjectDetail>(onboarding(id)),
  /** The project without its detail, or null: for the building header's "Onboarding N%" chip. */
  summary: (id: string) => get<OnboardingProject | null>(`${onboarding(id)}/summary`),
  create: (id: string, input: CreateProjectInput = {}) => post<OnboardingProjectDetail>(onboarding(id), input),
  updateTask: (id: string, taskId: string, patch: TaskPatch) => post<OnboardingTask>(`${onboarding(id)}/tasks/${seg(taskId)}`, patch),
  updateSection: (id: string, key: SectionKey, patch: SectionPatch) => post<OnboardingSection>(`${onboarding(id)}/sections/${seg(key)}`, patch),
  reviewSection: (id: string, key: SectionKey, input: SectionReviewInput) =>
    post<OnboardingSection>(`${onboarding(id)}/sections/${seg(key)}/review`, input),
  updateHandoverItem: (id: string, itemId: string, patch: HandoverItemPatch) => post<HandoverItem>(`${onboarding(id)}/handover/${seg(itemId)}`, patch),
  updateGoLiveCheck: (id: string, checkId: string, patch: GoLiveCheckPatch) => post<GoLiveCheck>(`${onboarding(id)}/golive/${seg(checkId)}`, patch),
  /** 409 with `blockers` when go-live can't be approved yet: read them with goLiveBlockers(err). */
  approve: (id: string, input: FinalApprovalInput = {}) => post<OnboardingProjectDetail>(`${onboarding(id)}/approve`, input),
  closeout: (id: string) => post<OnboardingProjectDetail>(`${onboarding(id)}/closeout`),

  // Handover invitations
  createInvite: (id: string, input: CreateInviteInput) => post<HandoverInvite>(`${onboarding(id)}/invites`, input),
  activateInvite: (id: string, inviteId: string, expiresInDays?: number) =>
    post<{ invite: HandoverInvite; url: string }>(`${onboarding(id)}/invites/${seg(inviteId)}/activate`, expiresInDays ? { expiresInDays } : {}),
  inviteLink: (id: string, inviteId: string) => get<{ url: string }>(`${onboarding(id)}/invites/${seg(inviteId)}/link`),
  inviteLetter: (id: string, inviteId: string) => get<{ subject: string; text: string }>(`${onboarding(id)}/invites/${seg(inviteId)}/letter`),
  revokeInvite: (id: string, inviteId: string) => post<HandoverInvite>(`${onboarding(id)}/invites/${seg(inviteId)}/revoke`),
};

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const api = {
  // Session
  session: () => get<SessionInfo>("/api/session"),
  login: (passcode: string, name: string) => post<SessionInfo>("/api/login", { passcode, name }),
  logout: () => post<SessionInfo>("/api/logout"),

  // Portfolio and Chief of Staff
  portfolio: () => get<PropertyCard[]>("/api/portfolio"),
  brief: () => get<PortfolioBrief | null>("/api/brief"),
  refreshBrief: () => post<PortfolioBrief>("/api/brief/refresh"),
  setAiEngine: (engine: AiEngineChoice) => post<SessionInfo>("/api/settings/ai", { engine }),
  loadDemo: () => post<{ buildings: { propertyId: string; threads: number; tickets: number }[] }>("/api/demo/load"),
  clearDemo: () => post<{ buildings: { propertyId: string; threads: number }[] }>("/api/demo/clear"),
  cosChat: () => get<ChatMessage[]>("/api/cos/chat"),
  sendCosChat: (text: string) => post<ChatMessage>("/api/cos/chat", { text }),
  resetCosChat: () => del<{ ok: true }>("/api/cos/chat"),
  approvals: () => get<Approval[]>("/api/approvals"),

  // Microsoft 365 (OneDrive and SharePoint). Connecting is a top-level navigation, never a fetch.
  onedriveStatus: () => get<OneDriveStatus>("/api/integrations/onedrive/status"),
  onedriveConnectUrl: (returnTo?: string) => withQuery("/api/integrations/onedrive/connect", { return: returnTo }),
  onedriveBrowse: (location: OneDriveLocation) => get<OneDriveListing>(withQuery("/api/integrations/onedrive/browse", { ...location })),
  onedriveDisconnect: () => post<OneDriveStatus>("/api/integrations/onedrive/disconnect"),

  // Building
  overview: (id: string) => get<PropertyOverview>(prop(id)),
  threads: (id: string, status?: ThreadFilter) => get<Thread[]>(withQuery(`${prop(id)}/threads`, { status })),
  thread: (id: string, threadId: string) => get<ThreadDetail>(`${prop(id)}/threads/${seg(threadId)}`),
  retriage: (id: string, threadId: string) => post<Triage>(`${prop(id)}/threads/${seg(threadId)}/retriage`),
  draftReply: (id: string, threadId: string, instructions: string | null) =>
    post<Approval>(`${prop(id)}/threads/${seg(threadId)}/draft`, { instructions }),
  closeThread: (id: string, threadId: string) => post<{ ok: true }>(`${prop(id)}/threads/${seg(threadId)}/close`),
  simulate: (id: string, input: SimulateInput) =>
    post<{ threadId: string; messageId: string }>(`${prop(id)}/simulate`, input),
  resetSimulated: (id: string) =>
    post<{ threads: number; approvals: number; tickets: number }>(`${prop(id)}/simulated/reset`),

  propertyApprovals: (id: string, status?: ApprovalStatus) =>
    get<Approval[]>(withQuery(`${prop(id)}/approvals`, { status })),
  decideApproval: (id: string, approvalId: string, decision: ApprovalDecision) =>
    post<Approval>(`${prop(id)}/approvals/${seg(approvalId)}`, decision),

  tickets: (id: string) => get<Ticket[]>(`${prop(id)}/tickets`),
  createTicket: (id: string, input: TicketInput) => post<Ticket>(`${prop(id)}/tickets`, input),
  updateTicket: (id: string, ticketId: string, changes: TicketPatch) =>
    patch<Ticket>(`${prop(id)}/tickets/${seg(ticketId)}`, changes),

  docs: (id: string) => get<DocMeta[]>(`${prop(id)}/docs`),
  uploadDoc: (id: string, file: File, folder: string) => {
    const form = new FormData();
    form.set("file", file);
    form.set("folder", folder);
    return post<DocMeta>(`${prop(id)}/docs`, form);
  },
  docText: (id: string, docId: string) =>
    get<{ meta: DocMeta; text: string | null }>(`${prop(id)}/docs/${seg(docId)}/text`),
  docDownloadUrl: (id: string, docId: string) => `${prop(id)}/docs/${seg(docId)}/download`,
  deleteDoc: (id: string, docId: string) => del<{ ok: true }>(`${prop(id)}/docs/${seg(docId)}`),
  search: (id: string, q: string) => get<SearchHit[]>(withQuery(`${prop(id)}/search`, { q })),
  importFromOneDrive: (id: string, items: OneDriveItemRef[], folder: string) =>
    post<OneDriveImportResponse>(`${prop(id)}/integrations/onedrive/import`, { items, folder }),

  contacts: (id: string, role?: ContactRole) => get<Contact[]>(withQuery(`${prop(id)}/contacts`, { role })),
  createContact: (id: string, input: ContactInput) => post<Contact>(`${prop(id)}/contacts`, input),
  updateContact: (id: string, contactId: string, input: ContactInput) =>
    put<Contact>(`${prop(id)}/contacts/${seg(contactId)}`, input),
  deleteContact: (id: string, contactId: string) => del<{ ok: true }>(`${prop(id)}/contacts/${seg(contactId)}`),

  chat: (id: string) => get<ChatMessage[]>(`${prop(id)}/chat`),
  sendChat: (id: string, text: string) => post<ChatMessage>(`${prop(id)}/chat`, { text }),
  resetChat: (id: string) => del<{ ok: true }>(`${prop(id)}/chat`),

  activity: (id: string, limit?: number) => get<ActivityEvent[]>(withQuery(`${prop(id)}/activity`, { limit })),
  memory: (id: string) => get<MemoryNote[]>(`${prop(id)}/memory`),
  addMemory: (id: string, text: string) => post<MemoryNote>(`${prop(id)}/memory`, { text }),
  deleteMemory: (id: string, memoryId: string) => del<{ ok: true }>(`${prop(id)}/memory/${seg(memoryId)}`),
};

// ---------------------------------------------------------------------------
// The outgoing manager's handover portal (public: the token in the path is the credential)
// ---------------------------------------------------------------------------
// Separate from `api` on purpose: no session cookie is sent or needed, and a failure never calls the
// staff sign-out handler. The browser adds the same-origin Origin header the portal's mutations require.
// Contract types are imported inline, so this block never collides with the import list at the top.

/** The multipart fields of a portal upload besides the file (see shared/portal-upload.ts uploadFields). */
export interface PortalUploadFields {
  /** The path inside the zip or folder; the server matches on it. */
  relativePath: string | null;
  /** A requested item's id, "none" for an extra file, or "" to let the server match. */
  itemId: string;
  folder: string | null;
}

const PORTAL_OFFLINE = "Couldn't reach Ikon. Check your internet connection and try again.";

const portalBase = (token: string) => `/api/portal/${seg(token)}`;

function portalFailure(status: number, payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error: unknown }).error;
    if (typeof error === "string" && error) return error;
  }
  if (status === 413) return "That file is too large to upload.";
  if (status === 429) return "Too many requests. Please wait a minute and try again.";
  if (status >= 500) return "Ikon's server hit an error. Please try again in a moment.";
  return `Request failed (${status})`;
}

async function portalRequest<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = { method, credentials: "omit", cache: "no-store", headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, PORTAL_OFFLINE);
  }
  const payload = await readPayload(res);
  if (!res.ok) throw new ApiError(res.status, portalFailure(res.status, payload));
  return payload as T;
}

/** One multipart upload with progress (XMLHttpRequest: fetch can't report upload progress yet). */
function portalUpload(
  token: string,
  file: Blob,
  fileName: string,
  fields: PortalUploadFields,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<import("../shared/onboarding").PortalUploadResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.set("file", file, fileName);
    if (fields.relativePath) form.set("relativePath", fields.relativePath);
    form.set("itemId", fields.itemId);
    if (fields.folder) form.set("folder", fields.folder);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${portalBase(token)}/upload`);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      let payload: unknown = null;
      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        payload = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(payload as import("../shared/onboarding").PortalUploadResult);
      else reject(new ApiError(xhr.status, portalFailure(xhr.status, payload)));
    };
    xhr.onerror = () => reject(new ApiError(0, PORTAL_OFFLINE));
    xhr.ontimeout = () => reject(new ApiError(408, "The upload timed out."));
    xhr.onabort = () => reject(new ApiError(0, "The upload was cancelled."));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

export const portalApi = {
  view: (token: string) => portalRequest<import("../shared/onboarding").PortalView>("GET", portalBase(token)),
  upload: portalUpload,
  notApplicable: (token: string, itemId: string, note: string) =>
    portalRequest<import("../shared/onboarding").PortalItem>("POST", `${portalBase(token)}/items/${seg(itemId)}/not-applicable`, { note }),
  note: (token: string, itemId: string, note: string) => portalRequest<import("../shared/onboarding").PortalItem>("POST", `${portalBase(token)}/items/${seg(itemId)}/note`, { note }),
  submit: (token: string, message: string | null) => portalRequest<import("../shared/onboarding").PortalView>("POST", `${portalBase(token)}/submit`, { message }),
};
