// The outgoing manager's portal: what happens between "a zip, a folder or some files were dropped" and "each
// file is filed against the right requested document". Pure TypeScript with no DOM or React, so the
// browser (src/pages/portal) and the unit tests (test/portal-ui.spec.ts) share it:
//
// - planning the review table: junk skipped and counted, oversize, empty and already-uploaded files
//   flagged, each file matched with matchHandoverFile exactly as the server would;
// - the choices a row sends (the requested document, or "none", and the folder);
// - the upload queue: 3 at a time, automatic back-off on 429 and server errors, a pause (not a loss)
//   when the connection drops, and a full stop when the link stops working (404/410);
// - small formatting helpers (dates in Perth, confidence, the progress bar).

import { HANDOVER_AUTO_ATTACH_CONFIDENCE, isJunkPath, matchHandoverFile, pathSegments, suggestFolder } from "./handover-match";
import { formatLongDate } from "./handover-letter";
import {
  PORTAL_TOKEN,
  type HandoverItemStatus,
  type HandoverMatch,
  type HandoverMatchTarget,
  type PortalItem,
  type PortalUploadResult,
  type PortalView,
  type VaultFolderName,
} from "./onboarding";

/** The spec's "Upload N files sends 3 at a time". */
export const PORTAL_UPLOAD_CONCURRENCY = 3;
/** A file this big uploads on its own (the server holds a few copies of it while indexing). */
export const PORTAL_LARGE_FILE_BYTES = 8 * 1024 * 1024;
/** The server keeps only the end of a longer path (display only), so the portal sends no more than that. */
export const PORTAL_MAX_PATH_CHARS = 500;
/** Automatic retries of one file after a timeout or a server error, before it shows as failed. */
export const PORTAL_UPLOAD_AUTO_RETRIES = 4;
/** Rate-limited (429) retries: more, since the portal's limiter counts a whole minute (about 4.5 min of waiting). */
export const PORTAL_UPLOAD_RATE_LIMIT_RETRIES = 10;
/**
 * The least time between two upload starts. The portal allows 600 requests a minute per link; at 110 ms a
 * stream of tiny files stays near 545 a minute, leaving room for the page's own refreshes.
 */
export const PORTAL_UPLOAD_MIN_GAP_MS = 110;
/** What the select sends when the outgoing manager picks "No requested document". */
export const NO_ITEM = "none";

// ===========================================================================
// The link
// ===========================================================================

export { portalTokenFromPath } from "./portal-link";

export function isPortalToken(token: string): boolean {
  return PORTAL_TOKEN.test(token);
}

/** What a failed portal call means for the page. */
export type PortalFailure = "link" | "retry" | "connection" | "fail";

/**
 * - "link": the link no longer works (404 "not valid", 410 expired or withdrawn): stop and say so.
 * - "connection": the browser couldn't reach the server (status 0): keep everything and offer to retry.
 * - "retry": rate limited, timed out or a server error: try the same request again after a pause.
 * - "fail": this request was refused (a bad file, too large, a verified item): show the reason.
 */
export function classifyPortalFailure(status: number, message = ""): PortalFailure {
  if (status === 0) return "connection";
  if (status === 410) return "link";
  // A 404 from the item routes names the document; any other 404 is the link itself.
  if (status === 404) return /requested document/i.test(message) ? "fail" : "link";
  if (status === 408 || status === 425 || status === 429 || status >= 500) return "retry";
  return "fail";
}

/** Back-off before automatic retry number `attempt` (1-based): 2 s, 4 s, 8 s, 16 s, then 30 s. */
export function retryDelayMs(attempt: number): number {
  return Math.min(30_000, 2000 * 2 ** Math.max(0, attempt - 1));
}

// ===========================================================================
// Matching and the review table
// ===========================================================================

/** The matcher's targets, built once per view (matchHandoverFile caches its preparation per array). */
export function matchTargets(items: readonly PortalItem[]): HandoverMatchTarget[] {
  return items.map((item) => ({ id: item.id, key: item.key, title: item.title, folder: item.folder, keywords: item.keywords }));
}

/** Name plus size: how a file already in the handover is recognised in a fresh SharePoint download. */
export function fileKey(name: string, size: number): string {
  return `${(pathSegments(name).at(-1) ?? name).trim().toLowerCase()}|${size}`;
}

/** Every file the handover already holds (requested items and other files). */
export function uploadedFileKeys(view: Pick<PortalView, "items" | "extraFiles">): Set<string> {
  const keys = new Set<string>();
  for (const item of view.items) for (const file of item.files) keys.add(fileKey(file.name, file.size));
  for (const file of view.extraFiles) keys.add(fileKey(file.name, file.size));
  return keys;
}

export type RowFlag = "oversize" | "empty" | "duplicate";
export type RowStatus = "staged" | "queued" | "uploading" | "done" | "failed";

export interface UploadRow<S = unknown> {
  id: string;
  /** The path inside the zip or folder ("SP87192 Handover/02 Insurance/CoC.pdf"), or the file name. */
  path: string;
  name: string;
  size: number;
  /** Where the file comes from (a File, or a zip entry to decompress); opaque to this module. */
  source: S;
  /** The matcher's view of the file. itemId is set for strong and possible matches alike. */
  match: HandoverMatch;
  /** The requested document it is filed against; null is "No requested document". */
  itemId: string | null;
  folder: VaultFolderName;
  /** The folder was chosen by hand, so picking a requested document no longer moves it. */
  folderChosen: boolean;
  include: boolean;
  flag: RowFlag | null;
  status: RowStatus;
  /** 0..1 while uploading. */
  progress: number;
  /** Automatic retries used so far. */
  retries: number;
  error: string | null;
  result: PortalUploadResult | null;
  /** "item": added with a requested document's own Upload button (no review step). */
  origin: "review" | "item";
}

export interface SourceFile<S> {
  path: string;
  size: number;
  source: S;
}

export interface PlanContext {
  targets: HandoverMatchTarget[];
  maxFileBytes: number;
  /** fileKey()s already uploaded to this handover. */
  uploaded: ReadonlySet<string>;
  /** Paths (lower case) already in the review or upload list, so a second drop of the same zip adds nothing. */
  listed?: ReadonlySet<string>;
  /** Makes row ids unique across drops. */
  nextId: () => string;
}

export interface Plan<S> {
  rows: UploadRow<S>[];
  /** System files (.DS_Store, __MACOSX/, Thumbs.db, ~$ lock files) left out. */
  skipped: number;
  /** Files already in the list (the same zip dropped twice). */
  repeated: number;
}

/** The select's starting point: strong matches pre-selected, possible matches only suggested. */
export function initialChoice(match: HandoverMatch): { itemId: string | null; folder: VaultFolderName } {
  const strong = match.itemId !== null && match.confidence >= HANDOVER_AUTO_ATTACH_CONFIDENCE;
  return { itemId: strong ? match.itemId : null, folder: match.folder };
}

/** Rows for the review table, in the order the files were found. */
export function planRows<S>(files: readonly SourceFile<S>[], ctx: PlanContext): Plan<S> {
  const rows: UploadRow<S>[] = [];
  const seen = new Set(ctx.listed ?? []);
  let skipped = 0;
  let repeated = 0;
  for (const file of files) {
    const path = pathSegments(file.path).join("/");
    if (!path || isJunkPath(file.path)) {
      skipped++;
      continue;
    }
    const lower = path.toLowerCase();
    if (seen.has(lower)) {
      repeated++;
      continue;
    }
    seen.add(lower);
    const name = pathSegments(path).at(-1)!;
    const match = matchHandoverFile(path, ctx.targets);
    const flag: RowFlag | null =
      file.size > ctx.maxFileBytes ? "oversize" : file.size === 0 ? "empty" : ctx.uploaded.has(fileKey(name, file.size)) ? "duplicate" : null;
    rows.push({
      id: ctx.nextId(),
      path,
      name,
      size: file.size,
      source: file.source,
      match,
      ...initialChoice(match),
      folderChosen: false,
      include: flag === null,
      flag,
      status: "staged",
      progress: 0,
      retries: 0,
      error: null,
      result: null,
      origin: "review",
    });
  }
  return { rows, skipped, repeated };
}

/**
 * A file chosen with a requested document's own Upload button: no review, straight into the queue,
 * attached to that document in its folder. null for junk; an oversize or empty file is flagged and failed.
 */
export function rowForItem<S>(
  file: SourceFile<S>,
  item: Pick<PortalItem, "id" | "folder">,
  ctx: Pick<PlanContext, "targets" | "maxFileBytes" | "nextId">,
): UploadRow<S> | null {
  const path = pathSegments(file.path).join("/");
  if (!path || isJunkPath(file.path)) return null;
  const flag: RowFlag | null = file.size > ctx.maxFileBytes ? "oversize" : file.size === 0 ? "empty" : null;
  return {
    id: ctx.nextId(),
    path,
    name: pathSegments(path).at(-1)!,
    size: file.size,
    source: file.source,
    match: matchHandoverFile(path, ctx.targets),
    itemId: item.id,
    folder: item.folder,
    folderChosen: true,
    include: flag === null,
    flag,
    status: flag ? "failed" : "queued",
    progress: 0,
    retries: 0,
    error: flag === "oversize" ? `Files must be ${formatSize(ctx.maxFileBytes)} or smaller` : flag === "empty" ? "The file is empty" : null,
    result: null,
    origin: "item",
  };
}

/** Rows can only be sent when they are not oversize or empty (a duplicate can be sent on purpose). */
export function canSend(row: Pick<UploadRow, "flag">): boolean {
  return row.flag !== "oversize" && row.flag !== "empty";
}

/**
 * The row after choosing a requested document (null: none). The folder follows the document, or for
 * "none" the folder the path suggests, unless it was chosen by hand.
 */
export function chooseItem<S>(row: UploadRow<S>, itemId: string | null, targets: readonly HandoverMatchTarget[]): UploadRow<S> {
  if (row.folderChosen) return { ...row, itemId };
  const target = itemId ? targets.find((t) => t.id === itemId) : undefined;
  const folder = target?.folder ?? suggestFolder(row.path) ?? row.match.folder;
  return { ...row, itemId, folder };
}

export function chooseFolder<S>(row: UploadRow<S>, folder: VaultFolderName): UploadRow<S> {
  return { ...row, folder, folderChosen: true };
}

/** The multipart fields the server reads: always the path (it matches on it), the choice and the folder. */
export function uploadFields(row: Pick<UploadRow, "path" | "itemId" | "folder">): { relativePath: string; itemId: string; folder: VaultFolderName } {
  const path = row.path.length <= PORTAL_MAX_PATH_CHARS ? row.path : `…${row.path.slice(row.path.length - (PORTAL_MAX_PATH_CHARS - 1))}`;
  return { relativePath: path, itemId: row.itemId ?? NO_ITEM, folder: row.folder };
}

export type ConfidenceLevel = "strong" | "likely" | "possible";

export function confidenceLevel(confidence: number): ConfidenceLevel {
  return confidence >= 0.7 ? "strong" : confidence >= HANDOVER_AUTO_ATTACH_CONFIDENCE ? "likely" : "possible";
}

/** "86%": confidence as a whole percentage. */
export function formatConfidence(confidence: number): string {
  return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;
}

/** The matcher's reason without its "possible match: " prefix and with a capital letter. */
export function matchReason(match: Pick<HandoverMatch, "reason">): string {
  const text = match.reason.replace(/^possible match:\s*/i, "").trim();
  return text ? text[0]!.toUpperCase() + text.slice(1) : "";
}

// ===========================================================================
// Batch summaries
// ===========================================================================

export interface BatchSummary {
  /** Rows in the upload list (queued, uploading, done or failed). */
  total: number;
  queued: number;
  uploading: number;
  done: number;
  failed: number;
  /** Done rows attached to a requested document. */
  attached: number;
  /** Done rows filed as other files. */
  extras: number;
  bytesTotal: number;
  bytesDone: number;
}

export function batchSummary(rows: readonly UploadRow[]): BatchSummary {
  const s: BatchSummary = { total: 0, queued: 0, uploading: 0, done: 0, failed: 0, attached: 0, extras: 0, bytesTotal: 0, bytesDone: 0 };
  for (const row of rows) {
    if (row.status === "staged") continue;
    s.total++;
    s.bytesTotal += row.size;
    if (row.status === "queued") s.queued++;
    else if (row.status === "uploading") {
      s.uploading++;
      s.bytesDone += row.size * row.progress;
    } else if (row.status === "failed") s.failed++;
    else {
      s.done++;
      s.bytesDone += row.size;
      if (row.result?.itemId) s.attached++;
      else s.extras++;
    }
  }
  return s;
}

export interface StagedSummary {
  total: number;
  /** Ticked and sendable: what "Upload N files" sends. */
  selected: number;
  selectedBytes: number;
  /** Ticked rows with a requested document chosen. */
  matched: number;
  oversize: number;
  empty: number;
  duplicate: number;
}

export function stagedSummary(rows: readonly UploadRow[]): StagedSummary {
  const s: StagedSummary = { total: 0, selected: 0, selectedBytes: 0, matched: 0, oversize: 0, empty: 0, duplicate: 0 };
  for (const row of rows) {
    if (row.status !== "staged") continue;
    s.total++;
    if (row.flag === "oversize") s.oversize++;
    if (row.flag === "empty") s.empty++;
    if (row.flag === "duplicate") s.duplicate++;
    if (row.include && canSend(row)) {
      s.selected++;
      s.selectedBytes += row.size;
      if (row.itemId) s.matched++;
    }
  }
  return s;
}

// ===========================================================================
// Requested documents
// ===========================================================================

/** The 8 Master File Structure folders in order, each with its requested documents (empty folders kept). */
export function groupByFolder(items: readonly PortalItem[], folders: readonly VaultFolderName[]): { folder: VaultFolderName; items: PortalItem[] }[] {
  return folders.map((folder) => ({ folder, items: items.filter((item) => item.folder === folder) }));
}

export type ItemFilter = "all" | "needed" | "with_ikon" | "verified" | "not_applicable";

/** "Still needed" is awaiting supply or needs replacing; "with Ikon" is awaiting verification. */
export function itemMatchesFilter(status: HandoverItemStatus, filter: ItemFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "needed":
      return status === "awaiting_supply" || status === "rejected";
    case "with_ikon":
      return status === "awaiting_verification";
    case "verified":
      return status === "verified";
    case "not_applicable":
      return status === "not_applicable";
  }
}

/** Widths (whole percentages adding up to 100 when total > 0) for the progress bar's four parts. */
export function progressParts(progress: PortalView["progress"]): { verified: number; supplied: number; notApplicable: number; outstanding: number } {
  const total = Math.max(0, progress.total);
  if (!total) return { verified: 0, supplied: 0, notApplicable: 0, outstanding: 0 };
  const raw = [progress.verified, progress.supplied, progress.notApplicable, progress.outstanding].map((n) => (Math.max(0, n) / total) * 100);
  // Largest-remainder rounding, so the parts always add up to exactly 100.
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index]!++;
    left--;
  }
  const [verified, supplied, notApplicable, outstanding] = floors as [number, number, number, number];
  return { verified, supplied, notApplicable, outstanding };
}

// ===========================================================================
// Formatting
// ===========================================================================

/** "21 Nov 2026" from "2026-11-21", or from a timestamp as the day in Perth. */
export function formatPortalDate(value: string | null | undefined): string {
  return formatLongDate(value).replace(/^(\d{1,2}) ([A-Z][a-z]{2})[a-z]* (\d{4})$/, "$1 $2 $3");
}

/** "999 B", "12 KB", "3.4 MB", "25 MB", "1.2 GB". */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const oneDecimal = (n: number) => n.toFixed(1).replace(/\.0$/, "");
  if (bytes < 1024 ** 3) return `${oneDecimal(bytes / 1024 ** 2)} MB`;
  return `${oneDecimal(bytes / 1024 ** 3)} GB`;
}

export function countOf(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString("en-AU")} ${count === 1 ? singular : plural}`;
}

// ===========================================================================
// The upload queue
// ===========================================================================

export interface QueueError {
  status: number;
  message: string;
}

export interface QueueDeps<S> {
  /**
   * Sends one file; rejects with something carrying `status` (0 for no connection) and `message`. A
   * rejection without a status (the file couldn't be read) fails that file alone.
   */
  send: (row: UploadRow<S>, onProgress: (fraction: number) => void) => Promise<PortalUploadResult>;
  /** Waits before an automatic retry (injectable for tests). */
  wait?: (ms: number) => Promise<void>;
  concurrency?: number;
  autoRetries?: number;
  rateLimitRetries?: number;
  /** Least time between upload starts (0 in tests that don't look at pacing). */
  minGapMs?: number;
  now?: () => number;
  /** After each file finishes, either way. */
  onSettled?: (row: UploadRow<S>) => void;
}

export type QueueState =
  /** Nothing queued or uploading. */
  | "idle"
  | "running"
  /** The connection dropped: queued files wait for resume(). */
  | "paused"
  /** The link stopped working (expired, withdrawn or not valid): nothing more is sent. */
  | "stopped";

export interface QueueSnapshot<S> {
  rows: readonly UploadRow<S>[];
  state: QueueState;
  /** Why the queue paused or stopped, in plain English. */
  message: string | null;
}

/** An error without an HTTP status (a file that couldn't be read) fails that file only: status -1. */
function errorParts(err: unknown): QueueError {
  if (err && typeof err === "object") {
    const status = "status" in err && typeof err.status === "number" ? err.status : -1;
    const message = "message" in err && typeof err.message === "string" && err.message ? err.message : "The upload failed";
    return { status, message };
  }
  return { status: -1, message: typeof err === "string" && err ? err : "The upload failed" };
}

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The review and upload list as one store (for useSyncExternalStore): staged rows wait for review, start()
 * queues the ticked ones, and at most `concurrency` upload at once.
 */
export class UploadQueue<S> {
  private snapshot: QueueSnapshot<S> = { rows: [], state: "idle", message: null };
  private readonly listeners = new Set<() => void>();
  private readonly inFlight = new Set<string>();
  private nextStartAt = 0;
  private readonly deps: Required<Omit<QueueDeps<S>, "onSettled">> & Pick<QueueDeps<S>, "onSettled">;

  constructor(deps: QueueDeps<S>) {
    this.deps = {
      wait: defaultWait,
      concurrency: PORTAL_UPLOAD_CONCURRENCY,
      autoRetries: PORTAL_UPLOAD_AUTO_RETRIES,
      rateLimitRetries: PORTAL_UPLOAD_RATE_LIMIT_RETRIES,
      minGapMs: PORTAL_UPLOAD_MIN_GAP_MS,
      now: Date.now,
      ...deps,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): QueueSnapshot<S> => this.snapshot;

  get rows(): readonly UploadRow<S>[] {
    return this.snapshot.rows;
  }

  private set(next: Partial<QueueSnapshot<S>>): void {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener();
  }

  private patch(id: string, change: Partial<UploadRow<S>> | ((row: UploadRow<S>) => UploadRow<S>)): void {
    const rows = this.snapshot.rows.map((row) => (row.id === id ? (typeof change === "function" ? change(row) : { ...row, ...change }) : row));
    this.set({ rows });
  }

  /** Adds rows for review (or, for an item's own Upload button, straight to the queue). */
  add(rows: readonly UploadRow<S>[]): void {
    if (!rows.length) return;
    this.set({ rows: [...this.snapshot.rows, ...rows] });
    if (rows.some((row) => row.status === "queued")) this.pump();
  }

  /** Changes a staged row (the review table's selects and tick boxes). */
  update(id: string, change: (row: UploadRow<S>) => UploadRow<S>): void {
    this.patch(id, (row) => (row.status === "staged" ? change(row) : row));
  }

  /** Every staged row at once (tick all, untick all). */
  updateStaged(change: (row: UploadRow<S>) => UploadRow<S>): void {
    this.set({ rows: this.snapshot.rows.map((row) => (row.status === "staged" ? change(row) : row)) });
  }

  /** Drops the review list (rows not yet sent). */
  clearStaged(): void {
    this.set({ rows: this.snapshot.rows.filter((row) => row.status !== "staged") });
  }

  /** Drops finished rows from the upload list, keeping anything queued, uploading or failed. */
  clearFinished(): void {
    this.set({ rows: this.snapshot.rows.filter((row) => row.status !== "done") });
  }

  /** Forgets failed rows the user gave up on. */
  clearFailed(): void {
    this.set({ rows: this.snapshot.rows.filter((row) => row.status !== "failed") });
  }

  /**
   * "Upload N files": the ticked, sendable staged rows join the queue and the rest of the review list goes.
   * Pressing it while paused is also a "try again".
   */
  start(): number {
    let count = 0;
    const rows: UploadRow<S>[] = [];
    for (const row of this.snapshot.rows) {
      if (row.status !== "staged") rows.push(row);
      else if (row.include && canSend(row)) {
        rows.push({ ...row, status: "queued", progress: 0, error: null });
        count++;
      }
    }
    this.set(this.snapshot.state === "paused" ? { rows, state: "running", message: null } : { rows });
    this.pump();
    return count;
  }

  /** Sends one failed file again. */
  retry(id: string): void {
    this.patch(id, (row) => (row.status === "failed" && canSend(row) ? { ...row, status: "queued", retries: 0, error: null, progress: 0 } : row));
    if (this.snapshot.state === "paused") this.set({ state: "running", message: null });
    this.pump();
  }

  /** Sends every failed file again. */
  retryFailed(): void {
    this.set({
      rows: this.snapshot.rows.map((row) => (row.status === "failed" && canSend(row) ? { ...row, status: "queued", retries: 0, error: null, progress: 0 } : row)),
    });
    this.resume();
  }

  /** After the connection comes back. */
  resume(): void {
    if (this.snapshot.state === "stopped") return;
    if (this.snapshot.state === "paused") this.set({ state: "running", message: null });
    this.pump();
  }

  /** The link stopped working: nothing more is sent, but the list stays (for when Ikon sends a new link). */
  stop(message: string): void {
    this.set({ state: "stopped", message });
  }

  private pump(): void {
    const { state } = this.snapshot;
    if (state === "stopped" || state === "paused") return;
    const waiting = this.snapshot.rows.filter((row) => row.status === "queued" && !this.inFlight.has(row.id));
    const large = (row: UploadRow<S>) => row.size > PORTAL_LARGE_FILE_BYTES;
    // A large file goes up on its own: nothing starts beside it, and it waits for the others to finish.
    const largeInFlight = this.snapshot.rows.some((row) => this.inFlight.has(row.id) && large(row));
    let free = largeInFlight ? 0 : this.deps.concurrency - this.inFlight.size;
    for (const row of waiting) {
      if (free <= 0) break;
      if (large(row)) {
        if (this.inFlight.size === 0) void this.run(row.id);
        break;
      }
      void this.run(row.id);
      free--;
    }
    this.settleState();
  }

  private settleState(): void {
    const { state } = this.snapshot;
    if (state === "stopped" || state === "paused") return;
    const busy = this.inFlight.size > 0 || this.snapshot.rows.some((row) => row.status === "queued");
    const next: QueueState = busy ? "running" : "idle";
    if (next !== state) this.set({ state: next, message: null });
  }

  private async run(id: string): Promise<void> {
    const start = this.snapshot.rows.find((row) => row.id === id);
    if (!start || start.status !== "queued") return;
    this.inFlight.add(id);
    this.patch(id, { status: "uploading", progress: 0, error: null });
    let lastShown = 0;
    try {
      const delay = this.paceDelay();
      if (delay > 0) await this.deps.wait(delay);
      const result = await this.deps.send(this.snapshot.rows.find((row) => row.id === id)!, (fraction) => {
        // Progress events arrive many times a second: repaint in 2% steps.
        if (fraction - lastShown < 0.02 && fraction < 1) return;
        lastShown = fraction;
        this.patch(id, (row) => (row.status === "uploading" ? { ...row, progress: Math.min(1, Math.max(0, fraction)) } : row));
      });
      this.inFlight.delete(id);
      this.patch(id, { status: "done", progress: 1, result, error: null });
    } catch (err) {
      this.inFlight.delete(id);
      await this.handleFailure(id, errorParts(err));
    }
    const settled = this.snapshot.rows.find((row) => row.id === id);
    if (settled && settled.status !== "queued") this.deps.onSettled?.(settled);
    this.pump();
  }

  /** How long this start must wait so starts are at least minGapMs apart (0: go now, without yielding). */
  private paceDelay(): number {
    if (this.deps.minGapMs <= 0) return 0;
    const now = this.deps.now();
    const at = Math.max(now, this.nextStartAt);
    this.nextStartAt = at + this.deps.minGapMs;
    return at - now;
  }

  private async handleFailure(id: string, error: QueueError): Promise<void> {
    const row = this.snapshot.rows.find((r) => r.id === id);
    if (!row) return;
    const kind = classifyPortalFailure(error.status, error.message);
    if (kind === "link") {
      this.patch(id, { status: "queued", progress: 0 });
      this.stop(error.message);
      return;
    }
    if (kind === "connection") {
      // Keep the file in the queue and wait for the connection rather than failing everything.
      this.patch(id, { status: "queued", progress: 0 });
      if (this.snapshot.state !== "stopped") this.set({ state: "paused", message: error.message });
      return;
    }
    const budget = error.status === 429 ? this.deps.rateLimitRetries : this.deps.autoRetries;
    if (kind === "retry" && row.retries < budget) {
      const retries = row.retries + 1;
      // Hold the slot while waiting, so a rate limit slows the whole queue down.
      this.inFlight.add(id);
      this.patch(id, { status: "uploading", progress: 0, retries, error: `Retrying (${error.message})` });
      await this.deps.wait(retryDelayMs(retries));
      this.inFlight.delete(id);
      this.patch(id, (r) => (r.status === "uploading" ? { ...r, status: "queued", error: null } : r));
      return;
    }
    this.patch(id, { status: "failed", progress: 0, error: error.message });
  }
}
