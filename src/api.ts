// Typed client for the hub's REST API (BUILD_SPEC Module E). Every mutation goes through
// these authenticated routes; the agent websockets are read-only live state.

import type {
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

export type TicketPatch = Partial<TicketInput> & { status?: TicketStatus };
export type ContactInput = Omit<Contact, "id">;
export type ThreadFilter = ThreadStatus | "open";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
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
    throw new ApiError(res.status, failureMessage(res, payload));
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
  setAiSwitch: (on: boolean) => post<SessionInfo>("/api/settings/ai", { on }),
  loadDemo: () => post<{ buildings: { propertyId: string; threads: number; tickets: number }[] }>("/api/demo/load"),
  clearDemo: () => post<{ buildings: { propertyId: string; threads: number }[] }>("/api/demo/clear"),
  cosChat: () => get<ChatMessage[]>("/api/cos/chat"),
  sendCosChat: (text: string) => post<ChatMessage>("/api/cos/chat", { text }),
  resetCosChat: () => del<{ ok: true }>("/api/cos/chat"),
  approvals: () => get<Approval[]>("/api/approvals"),

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
