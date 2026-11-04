// Microsoft Graph v1.0 for the Files import: the signed-in account, browsing OneDrive and SharePoint
// document libraries, and downloading a file. Every call takes the fetch to use, so the mapping from
// Graph's JSON to the hub's trimmed shapes can be tested against canned responses.

import type { OneDriveAccount, OneDriveItem, OneDriveItemRef, OneDriveListing, OneDriveSource } from "../../shared/types";
import { formatBytes } from "../http";
import type { FetchFn } from "./onedrive-oauth";

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
/** The picker lists at most this many entries per folder; more sets `truncated`. */
export const MAX_LISTED_ITEMS = 500;
const PAGE_SIZE = 200;
/** A backstop against a nextLink chain that never ends. */
const MAX_PAGES = 20;
const ITEM_FIELDS = "id,name,size,file,folder,package,lastModifiedDateTime,webUrl,parentReference";
const DRIVE_FIELDS = "id,name,driveType,webUrl,lastModifiedDateTime";
const DEFAULT_ACCOUNT_NAME = "Microsoft 365 account";

type Json = Record<string, unknown>;

/** A Graph response that was not a success. `code` is Graph's error code, kept for the logs. */
export class GraphError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null) {
    super(`Microsoft Graph returned HTTP ${status}${code ? ` (${code})` : ""}`);
    this.name = "GraphError";
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * Only Graph's own URLs carry the access token: paths are joined onto GRAPH_BASE, and a nextLink
 * from a response is followed only when it points back at Graph.
 */
function graphUrl(pathOrUrl: string): string | null {
  if (pathOrUrl.startsWith("/")) return `${GRAPH_BASE}${pathOrUrl}`;
  return pathOrUrl.startsWith(`${GRAPH_BASE}/`) ? pathOrUrl : null;
}

async function graphFetch(fetchFn: FetchFn, token: string, pathOrUrl: string, init: RequestInit = {}): Promise<Response> {
  const url = graphUrl(pathOrUrl);
  if (!url) throw new GraphError(502, "untrusted_link");
  try {
    return await fetchFn(url, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  } catch {
    throw new GraphError(503, "network_error");
  }
}

async function graphJson(fetchFn: FetchFn, token: string, pathOrUrl: string): Promise<Json> {
  const res = await graphFetch(fetchFn, token, pathOrUrl);
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw new GraphError(res.status, graphErrorCode(body));
  if (!isObject(body)) throw new GraphError(502, "unexpected_response");
  return body;
}

function graphErrorCode(body: unknown): string | null {
  const error = isObject(body) ? body.error : null;
  return isObject(error) && typeof error.code === "string" ? error.code.slice(0, 80) : null;
}

/** Follows @odata.nextLink until `cap` values are in hand. A link that leaves Graph ends the list there. */
async function collect(fetchFn: FetchFn, token: string, firstPath: string, cap: number): Promise<{ values: Json[]; truncated: boolean }> {
  const values: Json[] = [];
  let next: string | null = firstPath;
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const body = await graphJson(fetchFn, token, next);
    if (Array.isArray(body.value)) values.push(...body.value.filter(isObject));
    next = str(body["@odata.nextLink"]);
    if (next && !graphUrl(next)) {
      console.warn("Microsoft Graph: a nextLink pointed outside Graph and was not followed");
      break;
    }
    if (values.length >= cap) break;
  }
  // Anything left unread (another page, or the page that went past the cap) means the list is partial.
  return { values: values.slice(0, cap), truncated: values.length > cap || next !== null };
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

/** The signed-in account's name and email, shown in the picker. A failure here never blocks connecting. */
export async function fetchAccount(fetchFn: FetchFn, token: string): Promise<OneDriveAccount> {
  try {
    const me = await graphJson(fetchFn, token, "/me?$select=displayName,mail,userPrincipalName");
    const email = str(me.mail) ?? str(me.userPrincipalName);
    return { name: str(me.displayName) ?? email ?? DEFAULT_ACCOUNT_NAME, email };
  } catch (err) {
    console.warn("Microsoft 365: could not read the signed-in account:", err instanceof Error ? err.message : err);
    return { name: DEFAULT_ACCOUNT_NAME, email: null };
  }
}

// ---------------------------------------------------------------------------
// Browsing
// ---------------------------------------------------------------------------

export interface BrowseQuery {
  source: OneDriveSource;
  siteId?: string;
  driveId?: string;
  itemId?: string;
}

/**
 * One level of the picker. "me": the account's OneDrive root, then folders by drive and item id.
 * "sites": the SharePoint sites the account can see, a site's document libraries, then folders.
 */
export async function browse(fetchFn: FetchFn, token: string, query: BrowseQuery, cap = MAX_LISTED_ITEMS): Promise<OneDriveListing> {
  const siteId = query.source === "sites" ? query.siteId : undefined;

  if (query.source === "sites" && !query.driveId) {
    if (!siteId) {
      const { values, truncated } = await collect(fetchFn, token, "/sites?search=*", cap);
      return { items: sortByName(values.map(toSite).filter(isPresent)), truncated };
    }
    const { values, truncated } = await collect(fetchFn, token, `/sites/${enc(siteId)}/drives?$select=${DRIVE_FIELDS}`, cap);
    return { items: sortByName(values.map((raw) => toDrive(raw, siteId)).filter(isPresent)), truncated };
  }

  const { values, truncated } = await collect(fetchFn, token, childrenPath(query), cap);
  const items = values.map((raw) => toDriveItem(raw, query.driveId ?? null, siteId)).filter(isPresent);
  return { items: sortFoldersFirst(items), truncated };
}

function childrenPath(query: BrowseQuery): string {
  const select = `?$select=${ITEM_FIELDS}&$top=${PAGE_SIZE}`;
  if (!query.driveId) return `/me/drive/root/children${select}`;
  const folder = query.itemId ? `items/${enc(query.itemId)}` : "root";
  return `/drives/${enc(query.driveId)}/${folder}/children${select}`;
}

function toSite(raw: Json): OneDriveItem | null {
  const id = str(raw.id);
  if (!id) return null;
  return {
    id,
    driveId: null,
    siteId: id,
    name: str(raw.displayName) ?? str(raw.name) ?? str(raw.webUrl) ?? "SharePoint site",
    kind: "site",
    size: null,
    mimeType: null,
    modified: str(raw.lastModifiedDateTime),
    webUrl: str(raw.webUrl),
    childCount: null,
  };
}

function toDrive(raw: Json, siteId: string): OneDriveItem | null {
  const id = str(raw.id);
  if (!id) return null;
  return {
    id,
    driveId: id,
    siteId,
    name: str(raw.name) ?? "Documents",
    kind: "drive",
    size: null,
    mimeType: null,
    modified: str(raw.lastModifiedDateTime),
    webUrl: str(raw.webUrl),
    childCount: null,
  };
}

/** Folders and files only: OneNote notebooks and other packages can't be filed as documents, so they're left out. */
export function toDriveItem(raw: Json, fallbackDriveId: string | null, siteId?: string): OneDriveItem | null {
  const id = str(raw.id);
  const name = str(raw.name);
  const parent = isObject(raw.parentReference) ? raw.parentReference : {};
  const driveId = str(parent.driveId) ?? fallbackDriveId;
  if (!id || !name || !driveId) return null;

  const folder = isObject(raw.folder) ? raw.folder : null;
  const file = isObject(raw.file) ? raw.file : null;
  if (!folder && !file) return null;
  return {
    id,
    driveId,
    ...(siteId ? { siteId } : {}),
    name,
    kind: folder ? "folder" : "file",
    size: num(raw.size),
    mimeType: file ? str(file.mimeType) : null,
    modified: str(raw.lastModifiedDateTime),
    webUrl: str(raw.webUrl),
    childCount: folder ? num(folder.childCount) : null,
  };
}

const collator = new Intl.Collator("en-AU", { numeric: true, sensitivity: "base" });

function sortByName(items: OneDriveItem[]): OneDriveItem[] {
  return items.sort((a, b) => collator.compare(a.name, b.name));
}

function sortFoldersFirst(items: OneDriveItem[]): OneDriveItem[] {
  return items.sort((a, b) => Number(a.kind === "file") - Number(b.kind === "file") || collator.compare(a.name, b.name));
}

// ---------------------------------------------------------------------------
// Downloading one file for import
// ---------------------------------------------------------------------------

export type ImportDownload =
  | { kind: "file"; name: string; mimeType: string | null; bytes: Uint8Array }
  | { kind: "skipped"; name: string | null; reason: string };

/** Checks what the item is first, so folders and oversized files are skipped without downloading anything. */
export async function downloadForImport(fetchFn: FetchFn, token: string, ref: OneDriveItemRef, maxBytes: number): Promise<ImportDownload> {
  const meta = await graphJson(fetchFn, token, `${itemPath(ref)}?$select=id,name,size,file,folder,package`);
  const name = str(meta.name);
  const file = isObject(meta.file) ? meta.file : null;
  const tooLarge = `Larger than ${formatBytes(maxBytes)}`;
  if (isObject(meta.folder)) return { kind: "skipped", name, reason: "Folder: open it and choose the files inside" };
  if (!file) return { kind: "skipped", name, reason: "Not a file that can be imported" };
  if ((num(meta.size) ?? 0) > maxBytes) return { kind: "skipped", name, reason: tooLarge };

  const bytes = await readCapped(await downloadContent(fetchFn, token, ref), maxBytes);
  if (!bytes) return { kind: "skipped", name, reason: tooLarge };
  if (bytes.byteLength === 0) return { kind: "skipped", name, reason: "The file is empty" };
  return { kind: "file", name: name ?? "OneDrive file", mimeType: str(file.mimeType), bytes };
}

function itemPath(ref: OneDriveItemRef): string {
  return `/drives/${enc(ref.driveId)}/items/${enc(ref.itemId)}`;
}

/**
 * /content answers with a redirect to a short-lived, pre-authenticated download URL. The redirect is
 * followed by hand so the Graph access token is not forwarded to the download host, which doesn't need it.
 */
async function downloadContent(fetchFn: FetchFn, token: string, ref: OneDriveItemRef): Promise<Response> {
  const res = await graphFetch(fetchFn, token, `${itemPath(ref)}/content`, { redirect: "manual" });
  if (res.status >= 300 && res.status < 400) {
    const target = httpsUrl(res.headers.get("Location"));
    await res.body?.cancel();
    if (!target) throw new GraphError(502, "bad_redirect");
    let file: Response;
    try {
      file = await fetchFn(target, { redirect: "follow" });
    } catch {
      throw new GraphError(503, "network_error");
    }
    if (!file.ok) throw new GraphError(file.status, null);
    return file;
  }
  if (!res.ok) throw new GraphError(res.status, graphErrorCode(await res.json().catch(() => null)));
  return res;
}

function httpsUrl(location: string | null): string | null {
  if (!location) return null;
  try {
    const url = new URL(location, GRAPH_BASE);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The body, or null as soon as it passes `maxBytes` (a size in the metadata can be stale). */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("Content-Length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel();
    return null;
  }
  if (!res.body) return new Uint8Array(0);

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Small helpers for untyped JSON
// ---------------------------------------------------------------------------

const enc = encodeURIComponent;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
