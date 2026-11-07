// The outgoing manager's portal, browser side (shared/portal-upload.ts): the link in the address bar,
// how failures are read, the review table built from a SharePoint zip (junk, oversize, empty and
// already-uploaded files, strong and possible matches), what each row sends, the summaries and the
// upload queue (3 at a time, back-off, pause on a dropped connection, stop on a dead link).

import { describe, expect, it } from "vitest";
import type { PortalItem, PortalUploadResult, PortalView } from "../shared/onboarding";
import {
  NO_ITEM,
  PORTAL_UPLOAD_AUTO_RETRIES,
  PORTAL_UPLOAD_MIN_GAP_MS,
  PORTAL_UPLOAD_RATE_LIMIT_RETRIES,
  UploadQueue,
  batchSummary,
  canSend,
  chooseFolder,
  chooseItem,
  classifyPortalFailure,
  confidenceLevel,
  countOf,
  fileKey,
  formatConfidence,
  formatPortalDate,
  formatSize,
  groupByFolder,
  initialChoice,
  isPortalToken,
  itemMatchesFilter,
  matchReason,
  matchTargets,
  planRows,
  portalTokenFromPath,
  progressParts,
  retryDelayMs,
  rowForItem,
  stagedSummary,
  uploadFields,
  uploadedFileKeys,
  type UploadRow,
} from "../shared/portal-upload";
import { VAULT_FOLDERS } from "../shared/types";
import { ONBOARDING_TEMPLATE } from "../worker/seed/onboarding-template";

const MB = 1024 * 1024;
const TOKEN = `87192-${"a".repeat(43)}`;

/** The template's 30 requested documents as the portal sees them (ids are the template keys here). */
const ITEMS: PortalItem[] = ONBOARDING_TEMPLATE.handoverItems.map((item) => ({
  id: item.key,
  key: item.key,
  title: item.title,
  detail: item.detail,
  folder: item.folder,
  required: item.required,
  status: "awaiting_supply",
  files: [],
  supplierNote: null,
  reviewNote: null,
  keywords: item.keywords,
}));
const TARGETS = matchTargets(ITEMS);
const idOf = (title: string) => ITEMS.find((item) => item.title === title)!.id;

function ids() {
  let n = 0;
  return () => `r${++n}`;
}

/** A SharePoint "Download" of a handover folder, as listed from the zip. */
const SHAREPOINT_ZIP = [
  { path: "SP87192 Handover/02 Insurance/Certificate of Currency 2026.pdf", size: 120_000 },
  { path: "SP87192 Handover/Financials/FY2025/Audited Financial Statements.pdf", size: 900_000 },
  { path: "SP87192 Handover/Minutes 2024.pdf", size: 40_000 },
  { path: "SP87192 Handover/Misc/Photos/Car park line marking.jpg", size: 2_000_000 },
  { path: "SP87192 Handover/Drawings/Building drawings (scanned).pdf", size: 26 * MB },
  { path: "SP87192 Handover/Keys/Key Register.csv", size: 0 },
  { path: "SP87192 Handover/.DS_Store", size: 6148 },
  { path: "__MACOSX/SP87192 Handover/02 Insurance/._Certificate of Currency 2026.pdf", size: 220 },
  { path: "SP87192 Handover/Financials/Thumbs.db", size: 1000 },
  { path: "SP87192 Handover/Financials/~$Creditors List.xlsx", size: 165 },
].map((file) => ({ ...file, source: file.path }));

function planZip(uploaded: Set<string> = new Set()) {
  return planRows(SHAREPOINT_ZIP, { targets: TARGETS, maxFileBytes: 25 * MB, uploaded, nextId: ids() });
}

// ===========================================================================
// The link and failures
// ===========================================================================

describe("portal link", () => {
  it("reads the token from /handover/:token and nothing else", () => {
    expect(portalTokenFromPath(`/handover/${TOKEN}`)).toBe(TOKEN);
    expect(portalTokenFromPath(`/handover/${TOKEN}/`)).toBe(TOKEN);
    expect(portalTokenFromPath("/handover/")).toBe("");
    expect(portalTokenFromPath("/handover/%E0%A4%A")).toBe("");
    expect(portalTokenFromPath(`/handover/${TOKEN}/extra`)).toBeNull();
    expect(portalTokenFromPath("/buildings/sp-87192/files")).toBeNull();
    expect(portalTokenFromPath("/")).toBeNull();
  });

  it("checks the token's shape before asking the server", () => {
    expect(isPortalToken(TOKEN)).toBe(true);
    expect(isPortalToken("87192-short")).toBe(false);
    expect(isPortalToken(`sp-87192-${"a".repeat(43)}`)).toBe(false);
  });

  it("tells a dead link, a dropped connection, a retryable error and a refused request apart", () => {
    expect(classifyPortalFailure(410, "This link has expired or been withdrawn. Please contact Ikon.")).toBe("link");
    expect(classifyPortalFailure(404, "This link is not valid.")).toBe("link");
    expect(classifyPortalFailure(404, "That requested document is not part of this handover")).toBe("fail");
    expect(classifyPortalFailure(0)).toBe("connection");
    expect(classifyPortalFailure(429)).toBe("retry");
    expect(classifyPortalFailure(503)).toBe("retry");
    expect(classifyPortalFailure(408)).toBe("retry");
    expect(classifyPortalFailure(400, "The file is empty")).toBe("fail");
    expect(classifyPortalFailure(413)).toBe("fail");
    expect(classifyPortalFailure(409)).toBe("fail");
    expect(classifyPortalFailure(-1, "This file couldn't be unpacked")).toBe("fail");
  });

  it("backs off 2 s, 4 s, 8 s, 16 s, then waits 30 s at most", () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
  });
});

// ===========================================================================
// The review table
// ===========================================================================

describe("planning the review table from a SharePoint zip", () => {
  it("skips and counts system files, and flags oversize and empty files", () => {
    const plan = planZip();
    expect(plan.skipped).toBe(4);
    expect(plan.rows.map((r) => r.path)).not.toContain("SP87192 Handover/.DS_Store");
    const drawings = plan.rows.find((r) => r.name === "Building drawings (scanned).pdf")!;
    expect(drawings.flag).toBe("oversize");
    expect(drawings.include).toBe(false);
    expect(canSend(drawings)).toBe(false);
    const empty = plan.rows.find((r) => r.name === "Key Register.csv")!;
    expect(empty.flag).toBe("empty");
    expect(canSend(empty)).toBe(false);
    expect(plan.rows.every((r) => r.status === "staged" && r.origin === "review")).toBe(true);
  });

  it("pre-selects strong matches in their item's folder and only suggests possible ones", () => {
    const rows = planZip().rows;
    const coc = rows.find((r) => r.name === "Certificate of Currency 2026.pdf")!;
    expect(coc.itemId).toBe(idOf("Certificate of currency"));
    expect(coc.folder).toBe("02 Insurance");
    expect(confidenceLevel(coc.match.confidence)).toBe("strong");

    const statements = rows.find((r) => r.name === "Audited Financial Statements.pdf")!;
    expect(statements.itemId).toBe(idOf("Financial statements for the last three years"));
    expect(statements.folder).toBe("04 Financials & Levies");

    // "Minutes 2024.pdf" could be AGM or council minutes: suggested, not chosen.
    const minutes = rows.find((r) => r.name === "Minutes 2024.pdf")!;
    expect(minutes.match.itemId).not.toBeNull();
    expect(minutes.match.confidence).toBeLessThan(0.5);
    expect(minutes.itemId).toBeNull();
    expect(minutes.folder).toBe("03 Meetings");
    expect(confidenceLevel(minutes.match.confidence)).toBe("possible");
    expect(matchReason(minutes.match)).toMatch(/^File name mentions "minutes"; could also be/);

    const photo = rows.find((r) => r.name === "Car park line marking.jpg")!;
    expect(photo.itemId).toBeNull();
    expect(photo.match.itemId).toBeNull();
    expect(uploadFields(photo)).toEqual({ relativePath: "SP87192 Handover/Misc/Photos/Car park line marking.jpg", itemId: NO_ITEM, folder: photo.folder });
  });

  it("flags files already in the handover (same name and size) and leaves them unticked", () => {
    const view: Pick<PortalView, "items" | "extraFiles"> = {
      items: ITEMS.map((item) =>
        item.title === "Certificate of currency" ? { ...item, files: [{ name: "Certificate of Currency 2026.pdf", size: 120_000, uploadedAt: "2026-11-01T00:00:00Z" }] } : item,
      ),
      extraFiles: [{ name: "Car park line marking.jpg", folder: "05 Maintenance & Contractors", size: 2_000_000, uploadedAt: "2026-11-01T00:00:00Z" }],
    };
    const uploaded = uploadedFileKeys(view);
    expect(uploaded.has(fileKey("certificate of currency 2026.pdf", 120_000))).toBe(true);
    const rows = planZip(uploaded).rows;
    for (const name of ["Certificate of Currency 2026.pdf", "Car park line marking.jpg"]) {
      const row = rows.find((r) => r.name === name)!;
      expect(row.flag).toBe("duplicate");
      expect(row.include).toBe(false);
      expect(canSend(row)).toBe(true);
    }
  });

  it("doesn't add the same paths twice when the same zip is dropped again", () => {
    const first = planZip();
    const again = planRows(SHAREPOINT_ZIP, {
      targets: TARGETS,
      maxFileBytes: 25 * MB,
      uploaded: new Set(),
      listed: new Set(first.rows.map((r) => r.path.toLowerCase())),
      nextId: ids(),
    });
    expect(again.rows).toEqual([]);
    expect(again.repeated).toBe(first.rows.length);
    expect(again.skipped).toBe(4);
  });

  it("moves the folder with the chosen document, unless the folder was chosen by hand", () => {
    const photo = planZip().rows.find((r) => r.name === "Car park line marking.jpg")!;
    const keys = idOf("Keys, fobs and remotes register");
    const asKeys = chooseItem(photo, keys, TARGETS);
    expect(asKeys.itemId).toBe(keys);
    expect(asKeys.folder).toBe("05 Maintenance & Contractors");
    expect(uploadFields(asKeys)).toMatchObject({ itemId: keys, folder: "05 Maintenance & Contractors" });

    // Back to "No requested document": the folder the path suggests (or the matcher's).
    expect(chooseItem(asKeys, null, TARGETS).folder).toBe(photo.folder);

    const pinned = chooseFolder(photo, "07 Correspondence");
    expect(pinned.folderChosen).toBe(true);
    expect(chooseItem(pinned, keys, TARGETS).folder).toBe("07 Correspondence");
  });

  it("starts from the matcher's choice", () => {
    expect(initialChoice({ itemId: "x", folder: "02 Insurance", confidence: 0.5, reason: "", skip: false })).toEqual({ itemId: "x", folder: "02 Insurance" });
    expect(initialChoice({ itemId: "x", folder: "03 Meetings", confidence: 0.49, reason: "", skip: false })).toEqual({ itemId: null, folder: "03 Meetings" });
  });

  it("adds a requested document's own uploads straight to the queue, in that document's folder", () => {
    const item = ITEMS.find((i) => i.title === "Asbestos register and safety records")!;
    const ctx = { targets: TARGETS, maxFileBytes: 25 * MB, nextId: ids() };
    const row = rowForItem({ path: "Register 2026.pdf", size: 5000, source: "x" }, item, ctx)!;
    expect(row).toMatchObject({ itemId: item.id, folder: "06 Compliance & Safety", status: "queued", origin: "item", folderChosen: true });
    expect(uploadFields(row)).toEqual({ relativePath: "Register 2026.pdf", itemId: item.id, folder: "06 Compliance & Safety" });
    expect(rowForItem({ path: ".DS_Store", size: 10, source: "x" }, item, ctx)).toBeNull();
    const big = rowForItem({ path: "Scan.pdf", size: 30 * MB, source: "x" }, item, ctx)!;
    expect(big).toMatchObject({ status: "failed", flag: "oversize", error: "Files must be 25 MB or smaller" });
  });
});

// ===========================================================================
// Summaries and formatting
// ===========================================================================

describe("summaries and formatting", () => {
  it("counts what Upload N files will send", () => {
    const rows = planZip().rows;
    const s = stagedSummary(rows);
    expect(s).toMatchObject({ total: 6, oversize: 1, empty: 1, duplicate: 0, selected: 4 });
    expect(s.matched).toBe(2);
    expect(s.selectedBytes).toBe(120_000 + 900_000 + 40_000 + 2_000_000);
  });

  it("summarises a batch: done, attached, other files, failed and bytes", () => {
    const base = planZip().rows.slice(0, 4);
    const result = (itemId: string | null): PortalUploadResult => ({ file: { name: "x", folder: "02 Insurance", size: 1 }, itemId, itemTitle: itemId ? "Doc" : null });
    const rows: UploadRow[] = [
      { ...base[0]!, status: "done", result: result("a") },
      { ...base[1]!, status: "done", result: result(null) },
      { ...base[2]!, status: "uploading", progress: 0.5 },
      { ...base[3]!, status: "failed", error: "Too many requests" },
    ];
    expect(batchSummary(rows)).toEqual({
      total: 4,
      queued: 0,
      uploading: 1,
      done: 2,
      failed: 1,
      attached: 1,
      extras: 1,
      bytesTotal: 120_000 + 900_000 + 40_000 + 2_000_000,
      bytesDone: 120_000 + 900_000 + 20_000,
    });
  });

  it("splits the progress bar into whole percentages that add up to 100", () => {
    const parts = progressParts({ total: 30, supplied: 5, verified: 9, notApplicable: 1, outstanding: 15 });
    expect(parts).toEqual({ verified: 30, supplied: 17, notApplicable: 3, outstanding: 50 });
    const thirds = progressParts({ total: 3, supplied: 1, verified: 1, notApplicable: 0, outstanding: 1 });
    expect(thirds.verified + thirds.supplied + thirds.notApplicable + thirds.outstanding).toBe(100);
    expect(progressParts({ total: 0, supplied: 0, verified: 0, notApplicable: 0, outstanding: 0 })).toEqual({ verified: 0, supplied: 0, notApplicable: 0, outstanding: 0 });
  });

  it("groups the requested documents by the 8 folders in order and filters them by status", () => {
    const groups = groupByFolder(ITEMS, VAULT_FOLDERS);
    expect(groups.map((g) => g.folder)).toEqual([...VAULT_FOLDERS]);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(ITEMS.length);
    expect(itemMatchesFilter("rejected", "needed")).toBe(true);
    expect(itemMatchesFilter("awaiting_supply", "needed")).toBe(true);
    expect(itemMatchesFilter("awaiting_verification", "with_ikon")).toBe(true);
    expect(itemMatchesFilter("verified", "needed")).toBe(false);
    expect(itemMatchesFilter("not_applicable", "all")).toBe(true);
  });

  it("formats dates in Perth, sizes, confidence and counts", () => {
    expect(formatPortalDate("2026-11-21")).toBe("21 Nov 2026");
    expect(formatPortalDate("2026-09-03")).toBe("3 Sep 2026");
    // 6 pm UTC on 6 December is 2 am on 7 December in Perth.
    expect(formatPortalDate("2026-12-06T18:00:00.000Z")).toBe("7 Dec 2026");
    expect(formatPortalDate(null)).toBe("");
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(999)).toBe("999 B");
    expect(formatSize(12 * 1024)).toBe("12 KB");
    expect(formatSize(3.44 * MB)).toBe("3.4 MB");
    expect(formatSize(25 * MB)).toBe("25 MB");
    expect(formatSize(1.25 * 1024 * MB)).toBe("1.3 GB");
    expect(formatConfidence(0.866)).toBe("87%");
    expect(formatConfidence(1.4)).toBe("100%");
    expect(countOf(1, "file")).toBe("1 file");
    expect(countOf(1200, "file")).toBe("1,200 files");
    expect(countOf(2, "file is", "files are")).toBe("2 files are");
  });
});

// ===========================================================================
// The upload queue
// ===========================================================================

interface Deferred {
  resolve: (value: PortalUploadResult) => void;
  reject: (err: unknown) => void;
}

/** A fake server: each send waits until the test settles it. */
function fakeServer() {
  const pending = new Map<string, Deferred[]>();
  const calls: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const send = (row: UploadRow<string>, onProgress: (f: number) => void) =>
    new Promise<PortalUploadResult>((resolve, reject) => {
      calls.push(row.name);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      onProgress(0.5);
      const done = () => inFlight--;
      pending.set(row.name, [
        ...(pending.get(row.name) ?? []),
        {
          resolve: (v) => {
            done();
            resolve(v);
          },
          reject: (e) => {
            done();
            reject(e);
          },
        },
      ]);
    });
  const take = (name: string): Deferred => {
    const list = pending.get(name);
    if (!list?.length) throw new Error(`${name} is not being sent`);
    return list.shift()!;
  };
  return {
    send,
    calls,
    sending: () => [...pending.entries()].filter(([, list]) => list.length).map(([name]) => name),
    ok: (name: string, itemId: string | null = null) => take(name).resolve({ file: { name, folder: "02 Insurance", size: 1 }, itemId, itemTitle: itemId ? "Doc" : null }),
    fail: (name: string, status: number, message = `HTTP ${status}`) => take(name).reject({ status, message }),
    maxInFlight: () => maxInFlight,
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function stagedRows(count: number): UploadRow<string>[] {
  const files = Array.from({ length: count }, (_, i) => ({ path: `SP87192 Handover/Misc/File ${i + 1}.pdf`, size: 1000 + i, source: `f${i + 1}` }));
  return planRows(files, { targets: TARGETS, maxFileBytes: 25 * MB, uploaded: new Set(), nextId: ids() }).rows;
}

describe("upload queue", () => {
  it("sends only the ticked rows, 3 at a time, and ends idle with every file done", async () => {
    const server = fakeServer();
    const settled: string[] = [];
    const queue = new UploadQueue<string>({ send: server.send, minGapMs: 0, wait: async () => undefined, onSettled: (row) => settled.push(row.name) });
    const rows = stagedRows(8);
    queue.add(rows);
    queue.update(rows[7]!.id, (r) => ({ ...r, include: false }));
    expect(queue.getSnapshot().state).toBe("idle");

    expect(queue.start()).toBe(7);
    expect(queue.rows).toHaveLength(7); // the unticked row left with the review list
    expect(queue.getSnapshot().state).toBe("running");
    expect(server.sending()).toEqual(["File 1.pdf", "File 2.pdf", "File 3.pdf"]);
    expect(queue.rows[0]!.progress).toBe(0.5);

    for (let i = 1; i <= 7; i++) {
      server.ok(`File ${i}.pdf`, i % 2 ? "item" : null);
      await flush();
    }
    expect(server.maxInFlight()).toBe(3);
    expect(queue.getSnapshot().state).toBe("idle");
    expect(settled).toHaveLength(7);
    const s = batchSummary(queue.rows);
    expect(s).toMatchObject({ total: 7, done: 7, attached: 4, extras: 3, failed: 0 });
  });

  it("backs off and retries a rate-limited file, then fails it after the automatic retries", async () => {
    const server = fakeServer();
    const waits: number[] = [];
    const queue = new UploadQueue<string>({ send: server.send, minGapMs: 0, wait: async (ms) => void waits.push(ms) });
    queue.add(stagedRows(1));
    queue.start();
    server.fail("File 1.pdf", 429, "Too many requests. Please wait a minute and try again.");
    await flush();
    expect(waits).toEqual([2000]);
    expect(server.sending()).toEqual(["File 1.pdf"]);
    server.ok("File 1.pdf");
    await flush();
    expect(queue.rows[0]).toMatchObject({ status: "done", error: null });

    // A server that keeps failing: the file shows as failed with the reason, and Retry sends it again.
    const queue2 = new UploadQueue<string>({ send: server.send, minGapMs: 0, wait: async () => undefined });
    const [row] = stagedRows(1);
    queue2.add([{ ...row!, name: "Stubborn.pdf" }]);
    queue2.start();
    for (let i = 0; i <= PORTAL_UPLOAD_AUTO_RETRIES; i++) {
      server.fail("Stubborn.pdf", 503, "Ikon's server hit an error.");
      await flush();
    }
    expect(queue2.rows[0]).toMatchObject({ status: "failed", error: "Ikon's server hit an error.", retries: PORTAL_UPLOAD_AUTO_RETRIES });
    expect(queue2.getSnapshot().state).toBe("idle");
    queue2.retry(queue2.rows[0]!.id);
    server.ok("Stubborn.pdf");
    await flush();
    expect(queue2.rows[0]).toMatchObject({ status: "done", retries: 0 });
  });

  it("fails a refused file at once and carries on with the rest", async () => {
    const server = fakeServer();
    const queue = new UploadQueue<string>({ send: server.send, minGapMs: 0, wait: async () => undefined });
    queue.add(stagedRows(2));
    queue.start();
    server.fail("File 1.pdf", 400, "System files (such as .DS_Store, Thumbs.db or __MACOSX) are not uploaded");
    // A file that couldn't be read (no HTTP status) fails alone too.
    server.fail("File 2.pdf", -1, "This file couldn't be unpacked from the zip.");
    await flush();
    expect(queue.rows.map((r) => r.status)).toEqual(["failed", "failed"]);
    expect(queue.getSnapshot().state).toBe("idle");
  });

  it("keeps the queue when the connection drops, and carries on when it comes back", async () => {
    const server = fakeServer();
    const queue = new UploadQueue<string>({ send: server.send, minGapMs: 0, wait: async () => undefined });
    queue.add(stagedRows(5));
    queue.start();
    server.fail("File 1.pdf", 0, "Couldn't reach Ikon.");
    await flush();
    expect(queue.getSnapshot()).toMatchObject({ state: "paused", message: "Couldn't reach Ikon." });
    expect(queue.rows[0]!.status).toBe("queued");
    // The two already on their way finish; nothing new starts while paused.
    server.ok("File 2.pdf");
    server.ok("File 3.pdf");
    await flush();
    expect(server.sending()).toEqual([]);
    expect(queue.rows.map((r) => r.status)).toEqual(["queued", "done", "done", "queued", "queued"]);

    queue.resume();
    expect(queue.getSnapshot().state).toBe("running");
    expect(server.sending().sort()).toEqual(["File 1.pdf", "File 4.pdf", "File 5.pdf"]);
    for (const name of ["File 1.pdf", "File 4.pdf", "File 5.pdf"]) server.ok(name);
    await flush();
    expect(queue.rows.every((r) => r.status === "done")).toBe(true);
    expect(queue.getSnapshot().state).toBe("idle");
  });

  it("stops (keeping the list) when the link expires mid-upload", async () => {
    const server = fakeServer();
    const queue = new UploadQueue<string>({ send: server.send, minGapMs: 0, wait: async () => undefined });
    queue.add(stagedRows(4));
    queue.start();
    server.fail("File 1.pdf", 410, "This link has expired or been withdrawn. Please contact Ikon.");
    await flush();
    expect(queue.getSnapshot()).toMatchObject({ state: "stopped", message: "This link has expired or been withdrawn. Please contact Ikon." });
    server.ok("File 2.pdf");
    server.ok("File 3.pdf");
    await flush();
    expect(server.sending()).toEqual([]);
    expect(queue.rows.map((r) => r.status)).toEqual(["queued", "done", "done", "queued"]);
    queue.resume();
    queue.retryFailed();
    expect(server.sending()).toEqual([]);
    expect(queue.getSnapshot().state).toBe("stopped");
  });

  it("changes, clears and restarts only what it should", async () => {
    const server = fakeServer();
    const queue = new UploadQueue<string>({ send: server.send, minGapMs: 0, wait: async () => undefined });
    const rows = stagedRows(3);
    queue.add(rows);
    queue.updateStaged((r) => ({ ...r, include: false }));
    expect(stagedSummary(queue.rows).selected).toBe(0);
    queue.update(rows[0]!.id, (r) => ({ ...r, include: true }));
    queue.start();
    // A staged-only change no longer applies once the row is queued.
    queue.update(rows[0]!.id, (r) => ({ ...r, folder: "08 Sales & Disclosure" }));
    expect(queue.rows[0]!.folder).not.toBe("08 Sales & Disclosure");
    server.ok("File 1.pdf");
    await flush();
    queue.add(stagedRows(2).map((r) => ({ ...r, id: `${r.id}-b` })));
    queue.clearFinished();
    expect(queue.rows.map((r) => r.status)).toEqual(["staged", "staged"]);
    queue.clearStaged();
    expect(queue.rows).toEqual([]);
  });

  it("sends a requested document's own uploads without review, and never retries an oversize one", async () => {
    const server = fakeServer();
    const queue = new UploadQueue<string>({ send: server.send, minGapMs: 0, wait: async () => undefined });
    const item = ITEMS[0]!;
    const ctx = { targets: TARGETS, maxFileBytes: 25 * MB, nextId: ids() };
    const good = rowForItem({ path: "Plan.pdf", size: 10, source: "p" }, item, ctx)!;
    const big = rowForItem({ path: "Scan.pdf", size: 26 * MB, source: "s" }, item, ctx)!;
    queue.add([good, big]);
    expect(server.sending()).toEqual(["Plan.pdf"]);
    queue.retry(big.id);
    queue.retryFailed();
    expect(server.sending()).toEqual(["Plan.pdf"]);
    server.ok("Plan.pdf", item.id);
    await flush();
    expect(queue.rows.map((r) => r.status)).toEqual(["done", "failed"]);
  });
  it("spaces upload starts to stay under the portal's rate limit", async () => {
    const server = fakeServer();
    const waits: number[] = [];
    let clock = 1_000_000;
    const queue = new UploadQueue<string>({ send: server.send, now: () => clock, wait: async (ms) => void waits.push(ms) });
    queue.add(stagedRows(3));
    queue.start();
    await flush();
    // The first starts at once; the next two wait one and two gaps (the clock stands still here).
    expect(waits).toEqual([PORTAL_UPLOAD_MIN_GAP_MS, 2 * PORTAL_UPLOAD_MIN_GAP_MS]);
    expect(server.sending()).toEqual(["File 1.pdf", "File 2.pdf", "File 3.pdf"]);
    // Long after the last start, the next one doesn't wait.
    clock += 60_000;
    server.ok("File 1.pdf");
    await flush();
    queue.add(stagedRows(1).map((r) => ({ ...r, id: "late", name: "Late.pdf" })));
    queue.start();
    await flush();
    expect(waits).toHaveLength(2);
    expect(server.sending()).toContain("Late.pdf");
  });

  it("keeps retrying a rate-limited file for longer than a server error", async () => {
    const server = fakeServer();
    const queue = new UploadQueue<string>({ send: server.send, minGapMs: 0, wait: async () => undefined });
    queue.add(stagedRows(1));
    queue.start();
    for (let i = 0; i < PORTAL_UPLOAD_RATE_LIMIT_RETRIES; i++) {
      server.fail("File 1.pdf", 429, "Too many requests. Please wait a minute and try again.");
      await flush();
      expect(queue.rows[0]!.status).toBe("uploading");
    }
    expect(PORTAL_UPLOAD_RATE_LIMIT_RETRIES).toBeGreaterThan(PORTAL_UPLOAD_AUTO_RETRIES);
    server.fail("File 1.pdf", 429, "Too many requests. Please wait a minute and try again.");
    await flush();
    expect(queue.rows[0]).toMatchObject({ status: "failed", retries: PORTAL_UPLOAD_RATE_LIMIT_RETRIES });
  });
});
