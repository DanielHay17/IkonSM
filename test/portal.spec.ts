// The outgoing manager's upload portal (/api/portal/:token): access with the secure link (no session),
// what the portal may show, uploads (item, auto-match, extras, limits, junk, paths), the upload trust model
// (handover uploads stay out of the agents' search until verified), the portal's own actions, and the limiter.

import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { getAgentByName } from "agents";
import { describe, expect, it } from "vitest";
import { matchHandoverFile } from "../shared/handover-match";
import type { PortalItem, PortalView } from "../shared/onboarding";
import { VAULT_FOLDERS, type ActivityEvent, type DocMeta, type PortfolioBrief, type SearchHit } from "../shared/types";
import { app } from "../worker/api";
import { ONBOARDING_TEMPLATE } from "../worker/seed/onboarding-template";
import { sanitiseRelativePath } from "../worker/portal-routes";
import { call, callJson, loginAndSeed, ORIGIN, tag } from "./helpers";
import {
  activateInvite,
  agentExec,
  agentRows,
  getProject,
  openHandover,
  portal,
  portalJson,
  portalUpload,
  portalUploadOk,
  prepareInvite,
  SAM_UPLOADER,
  TEMPLATE_ITEMS,
  textFile,
  tokenOf,
} from "./onboarding-helpers";

const NOT_VALID = { error: "This link is not valid." };
const GONE = { error: "This link has expired or been withdrawn. Please contact Ikon." };
const base = (id: string) => `/api/properties/${id}/onboarding`;

async function docs(cookie: string, id: string): Promise<DocMeta[]> {
  return callJson(`/api/properties/${id}/docs`, { cookie });
}

async function agentSearch(id: string, query: string): Promise<SearchHit[]> {
  return (await getAgentByName(env.PropertyAgent, id)).searchDocs(query, 10);
}

async function staffSearch(cookie: string, id: string, query: string): Promise<SearchHit[]> {
  return callJson(`/api/properties/${id}/search?q=${encodeURIComponent(query)}`, { cookie });
}

// ===========================================================================
// Access
// ===========================================================================

describe("portal access", () => {
  it("shows the PortalView with the link alone, without staff-only data, and counts a visit once", async () => {
    const cookie = await loginAndSeed("Mia Example");
    const id = "sp-10588";
    const { token, invite, detail } = await openHandover(cookie, id);

    const res = await portal(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const view = await res.json<PortalView>();
    expect(Object.keys(view).sort()).toEqual(
      ["building", "companyName", "expiresAt", "extraFiles", "folders", "handoverDate", "incomingManager", "items", "limits", "outgoingManager", "progress", "recordsDueDate", "submittedAt"].sort(),
    );
    expect(view.building).toEqual({ spNumber: "10588", street: "4 Lomatia Way", suburb: "Forrestfield", postcode: "6058" });
    expect(view.incomingManager).toEqual({ name: "Tom Placeholder", title: "Strata Manager", email: "tom.placeholder@example.com" });
    expect(view.outgoingManager).toEqual({ name: "Sam Outgoing", company: "Sample Strata Co Pty Ltd" });
    expect(view).toMatchObject({ handoverDate: invite.handoverDate, recordsDueDate: invite.recordsDueDate, expiresAt: invite.expiresAt, submittedAt: null });
    expect(view.folders).toEqual([...VAULT_FOLDERS]);
    expect(view.limits).toEqual({ maxFileBytes: 25 * 1024 * 1024, maxFilesPerInvite: 3000 });
    expect(view.items).toHaveLength(TEMPLATE_ITEMS);
    expect(view.items.map((i) => i.id)).toEqual(detail.handoverItems.map((i) => i.id));
    for (const item of view.items) {
      expect(Object.keys(item).sort()).toEqual(["detail", "files", "folder", "id", "key", "keywords", "required", "reviewNote", "status", "supplierNote", "title"]);
      // The project's matching words, so the portal can suggest exactly what the server would auto-match.
      expect(item.keywords).toEqual(ONBOARDING_TEMPLATE.handoverItems.find((t) => t.key === item.key)!.keywords);
    }
    expect(view.progress).toEqual({ total: TEMPLATE_ITEMS, supplied: 0, verified: 0, notApplicable: 0, outstanding: TEMPLATE_ITEMS });

    // Nothing internal: no invitation, project or event ids, token hash, approval, creator or staff reviewers.
    const raw = JSON.stringify(view);
    const [row] = await agentRows<{ token_hash: string }>(id, "SELECT token_hash FROM handover_invites WHERE id = ?", invite.id);
    for (const secret of [invite.id, detail.id, row!.token_hash, invite.approvalId!, "Mia Example", ...detail.events.map((e) => e.id)]) {
      expect(raw).not.toContain(secret);
    }

    // One visit counts once (and is logged once), however often the page reloads.
    await portal(token);
    let staff = await getProject(cookie, id);
    expect(staff.invites[0]).toMatchObject({ accessCount: 1 });
    expect(Date.now() - Date.parse(staff.invites[0]!.lastAccessAt!)).toBeLessThan(60_000);
    expect(staff.events.filter((e) => e.kind === "portal")).toHaveLength(1);
    expect(staff.events.find((e) => e.kind === "portal")).toMatchObject({ actor: "Sam Outgoing", summary: "Sam Outgoing opened the handover link" });
    // Ten minutes later it is a new visit.
    await agentExec(id, "UPDATE handover_invites SET last_visit_at = ?", new Date(Date.now() - 11 * 60_000).toISOString());
    await portal(token);
    staff = await getProject(cookie, id);
    expect(staff.invites[0]!.accessCount).toBe(2);
  });

  it("answers 404 with the same body for malformed and unknown tokens and unknown buildings", async () => {
    const cookie = await loginAndSeed("Token Prober");
    const { token } = await openHandover(cookie, "sp-10140");
    const secret = token.slice(token.indexOf("-") + 1);
    const flipped = `${secret.slice(0, -1)}${secret.endsWith("A") ? "B" : "A"}`;
    for (const bad of [
      "not-a-token",
      `10140-${secret.slice(1)}`,
      `10140-${flipped}`,
      `99999-${secret}`,
      `13183-${secret}`,
      `10140-${secret}x`,
      `10140_${secret}`,
    ]) {
      const res = await portal(bad);
      expect(res.status, bad).toBe(404);
      expect(await res.json(), bad).toEqual(NOT_VALID);
    }
    expect((await portal(`99999-${secret}`, "/submit", { json: {} })).status).toBe(404);
    // The real one still works.
    expect((await portal(token)).status).toBe(200);
  });

  it("answers 410 for revoked and expired links, without saying which", async () => {
    const cookie = await loginAndSeed("Link Revoker");
    const id = "sp-4027";
    const { token, invite } = await openHandover(cookie, id);
    await callJson(`${base(id)}/invites/${invite.id}/revoke`, { cookie, json: {} });
    const revoked = await portal(token);
    expect(revoked.status).toBe(410);
    expect(await revoked.json()).toEqual(GONE);

    const draft = await prepareInvite(cookie, id);
    const { url } = await activateInvite(cookie, id, draft.id);
    expect((await portal(tokenOf(url))).status).toBe(200);
    await agentExec(id, "UPDATE handover_invites SET expires_at = ? WHERE id = ?", new Date(Date.now() - 1000).toISOString(), draft.id);
    const expired = await portal(tokenOf(url));
    expect(expired.status).toBe(410);
    expect(await expired.json()).toEqual(GONE);
    expect((await portal(tokenOf(url), "/submit", { json: {} })).status).toBe(410);
    const staff = await getProject(cookie, id);
    expect(staff.invites.find((i) => i.id === draft.id)!.status).toBe("expired");
    expect((await call(`${base(id)}/invites/${draft.id}/link`, { cookie })).status).toBe(409);
  });

  it("needs no session, but mutations need a same-origin Origin header and the right content type", async () => {
    const cookie = await loginAndSeed("Origin Tester");
    const id = "sp-86837";
    const { token, detail } = await openHandover(cookie, id);
    const itemId = detail.handoverItems[0]!.id;

    expect((await portal(token, "/submit", { json: {}, origin: null })).status).toBe(403);
    expect((await portal(token, "/submit", { json: {}, origin: "https://evil.example" })).status).toBe(403);
    expect((await portal(token, `/items/${itemId}/note`, { json: { note: "hi" }, origin: null })).status).toBe(403);
    expect((await portalUpload(token, textFile("a.txt", "x"), {}, { origin: null })).status).toBe(403);
    expect((await portal(token, "/upload", { json: { file: "x" } })).status).toBe(415);
    expect((await portal(token, "/submit", { body: "message=hi", headers: { "Content-Type": "application/x-www-form-urlencoded" } })).status).toBe(415);
    // The staff API stays closed without a session.
    expect((await call(base(id), { cookie: null })).status).toBe(401);
    expect((await portal(token, "/nothing-here")).status).toBe(404);
  });

  it("is rate limited per link and client IP (PORTAL_LIMITER)", async () => {
    const cookie = await loginAndSeed("Limiter Tester");
    const { token } = await openHandover(cookie, "sp-64324");
    const keys: string[] = [];
    const limiter = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: false };
      },
    } as unknown as RateLimit;
    const ctx = createExecutionContext();
    const res = await app.fetch(new Request(`${ORIGIN}/api/portal/${token}`, { headers: { "CF-Connecting-IP": "203.0.113.9" } }), { ...env, PORTAL_LIMITER: limiter } as Env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(429);
    expect(keys).toEqual([`portal:${token}:203.0.113.9`]);
    // The binding is configured, and allows ordinary use.
    expect(typeof env.PORTAL_LIMITER?.limit).toBe("function");
    expect((await portal(token)).status).toBe(200);
  });
});

// ===========================================================================
// Uploads
// ===========================================================================

describe("portal uploads", () => {
  it("files an upload for an item: awaiting verification, in the building's Files with the handover uploader", async () => {
    const cookie = await loginAndSeed("Upload Checker");
    const id = "sp-21343";
    const { token, detail } = await openHandover(cookie, id);
    const item = detail.handoverItems[0]!;
    const marker = `quokka${tag()}`;

    const result = await portalUploadOk(token, textFile("Policy schedule.txt", `Policy schedule ${marker}`), {
      folder: item.folder,
      itemId: item.id,
      relativePath: "SP21343 Handover/Insurance/Policy schedule.txt",
    });
    expect(result).toEqual({ file: { name: "Policy schedule.txt", folder: item.folder, size: `Policy schedule ${marker}`.length }, itemId: item.id, itemTitle: item.title });

    const view = await portalJson<PortalView>(token);
    const portalItem = view.items.find((i) => i.id === item.id)!;
    expect(portalItem.status).toBe("awaiting_verification");
    expect(portalItem.files).toEqual([{ name: "Policy schedule.txt", size: result.file.size, uploadedAt: expect.any(String) }]);
    expect(view.progress).toMatchObject({ supplied: 1, outstanding: TEMPLATE_ITEMS - 1 });

    const staff = await getProject(cookie, id);
    const staffItem = staff.handoverItems.find((i) => i.id === item.id)!;
    expect(staffItem.status).toBe("awaiting_verification");
    expect(staffItem.files[0]).toMatchObject({ name: "Policy schedule.txt", folder: item.folder, uploadedBy: "Sam Outgoing (Sample Strata Co Pty Ltd)", sourcePath: "SP21343 Handover/Insurance/Policy schedule.txt" });
    expect(staff.counts.handoverAwaitingVerification).toBe(1);
    expect(staff.events.find((e) => e.kind === "upload")).toMatchObject({ actor: "Sam Outgoing", summary: `Sam Outgoing uploaded "Policy schedule.txt" for ${item.title}` });

    const doc = (await docs(cookie, id)).find((d) => d.id === staffItem.files[0]!.docId)!;
    expect(doc).toMatchObject({ folder: item.folder, name: "Policy schedule.txt", uploadedBy: SAM_UPLOADER, scope: "building", sample: false, indexed: "full" });
    expect(doc.r2Key.startsWith(`${id}/${item.folder}/`)).toBe(true);
    expect(await (await env.VAULT.get(doc.r2Key))!.text()).toBe(`Policy schedule ${marker}`);
    const activity = await callJson<ActivityEvent[]>(`/api/properties/${id}/activity`, { cookie });
    expect(activity.some((a) => a.summary === `Outgoing manager Sam Outgoing uploaded "Policy schedule.txt" to ${item.folder} (awaiting verification)`)).toBe(true);
  });

  it("matches an upload without an item automatically, or files it as an extra file", async () => {
    const cookie = await loginAndSeed("Matcher");
    const id = "sp-13183";
    const { token, detail } = await openHandover(cookie, id);
    // Match exactly as the portal page does: targets built from the PortalView's items and their keywords.
    const portalView = await portalJson<PortalView>(token);
    const targets = portalView.items.map((i) => ({ id: i.id, key: i.key, title: i.title, folder: i.folder, keywords: i.keywords }));
    expect(targets.map((t) => t.id)).toEqual(detail.handoverItems.map((i) => i.id));
    const template = ONBOARDING_TEMPLATE.handoverItems[1] ?? ONBOARDING_TEMPLATE.handoverItems[0]!;
    const path = `Shared Documents/SP13183/${template.folder}/${template.keywords[0]} 2026.txt`;
    const expected = matchHandoverFile(path, targets, "07 Correspondence");
    const matched = await portalUploadOk(token, textFile(`${template.keywords[0]} 2026.txt`, "Matched by name"), { relativePath: path });
    expect(matched.itemId).toBe(expected.confidence >= 0.5 ? expected.itemId : null);
    expect(matched.itemId).not.toBeNull();
    expect(matched.file.folder).toBe(expected.folder);

    const strayPath = "Shared Documents/SP13183/Misc/zzqv blorptangle.txt";
    const stray = matchHandoverFile(strayPath, targets, "07 Correspondence");
    const unmatched = await portalUploadOk(token, textFile("zzqv blorptangle.txt", "No match"), { relativePath: strayPath });
    expect(unmatched).toMatchObject({ itemId: stray.confidence >= 0.5 ? stray.itemId : null, itemTitle: stray.confidence >= 0.5 ? expect.any(String) : null });

    // "none" files it as an extra without matching, whatever its name says.
    const extra = await portalUploadOk(token, textFile(`${template.keywords[0]} copy.txt`, "Extra"), { itemId: "none", folder: "05 Maintenance & Contractors" });
    expect(extra).toEqual({ file: { name: `${template.keywords[0]} copy.txt`, folder: "05 Maintenance & Contractors", size: 5 }, itemId: null, itemTitle: null });

    const view = await portalJson<PortalView>(token);
    expect(view.extraFiles.map((f) => f.name)).toContain(`${template.keywords[0]} copy.txt`);
    const staff = await getProject(cookie, id);
    expect(staff.extraFiles.map((f) => f.name)).toContain(`${template.keywords[0]} copy.txt`);
    expect(staff.counts.extraFiles).toBe(staff.extraFiles.length);
    expect(staff.events.find((e) => e.kind === "upload")!.summary).toBe(`Sam Outgoing uploaded "${template.keywords[0]} copy.txt" to 05 Maintenance & Contractors (extra file)`);
  });

  it("rejects junk files, empty or oversize files, bad folders, unknown items and over-long paths", async () => {
    const cookie = await loginAndSeed("Upload Rejecter");
    const id = "sp-24594";
    const { token } = await openHandover(cookie, id);
    const before = (await docs(cookie, id)).length;

    expect((await portalUpload(token, textFile(".DS_Store", "junk"))).status).toBe(400);
    expect((await portalUpload(token, textFile("Thumbs.db", "junk"))).status).toBe(400);
    expect((await portalUpload(token, textFile("minutes.pdf", "x"), { relativePath: "__MACOSX/SP/._minutes.pdf" })).status).toBe(400);
    expect((await portalUpload(token, textFile("~$budget.xlsx", "lock"))).status).toBe(400);
    expect((await portalUpload(token, new File([], "empty.txt", { type: "text/plain" }))).status).toBe(400);
    expect((await portalUpload(token, textFile("a.txt", "x"), { folder: "09 Elsewhere" })).status).toBe(400);
    expect((await portalUpload(token, textFile("a.txt", "x"), { itemId: "no-such-item" })).status).toBe(400);
    expect((await portalUpload(token, textFile("a.txt", "x"), { itemId: "bad id!" })).status).toBe(400);
    expect((await portalUpload(token, textFile("a.txt", "x"), { relativePath: `${"a/".repeat(250)}a.txt` })).status).toBe(400);
    const noFile = new FormData();
    noFile.set("folder", "02 Insurance");
    expect((await portal(token, "/upload", { body: noFile })).status).toBe(400);

    const big = new File([new Uint8Array(25 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" });
    const res = await portalUpload(token, big, { folder: "02 Insurance" });
    expect(res.status).toBe(413);

    expect((await docs(cookie, id)).length).toBe(before);
    expect((await getProject(cookie, id)).counts.handoverAwaitingVerification).toBe(0);
  });

  it("sanitises the path a file came from (display only) and keeps storage inside the building", async () => {
    expect(sanitiseRelativePath("../../etc/passwd")).toBe("etc/passwd");
    expect(sanitiseRelativePath("/SP1/../Insurance/./x.pdf")).toBe("SP1/Insurance/x.pdf");
    expect(sanitiseRelativePath("C:\\Users\\sam\\Handover\\a.pdf")).toBe("Users/sam/Handover/a.pdf");
    expect(sanitiseRelativePath("a\u0000b/\u001fc.txt")).toBe("ab/c.txt");
    expect(sanitiseRelativePath("//")).toBeNull();
    expect(sanitiseRelativePath(null)).toBeNull();

    const cookie = await loginAndSeed("Path Tester");
    const id = "sp-83114";
    const { token, detail } = await openHandover(cookie, id);
    const item = detail.handoverItems[0]!;
    const result = await portalUploadOk(token, textFile("../../evil.txt", "traversal"), { itemId: item.id, relativePath: "/../../sp-26707/../../SP83114/Records/evil.txt" });
    expect(result.file.name).toBe("evil.txt");
    const file = (await getProject(cookie, id)).handoverItems.find((i) => i.id === item.id)!.files[0]!;
    expect(file.sourcePath).toBe("sp-26707/SP83114/Records/evil.txt");
    expect(file.sourcePath).not.toContain("..");
    const doc = (await docs(cookie, id)).find((d) => d.id === file.docId)!;
    expect(doc.r2Key.startsWith(`${id}/${item.folder}/`)).toBe(true);
    expect(doc.r2Key).not.toContain("..");
  });

  it("keeps handover uploads out of the agents' search until staff verify them, then promotes them", async () => {
    const cookie = await loginAndSeed("Priya Sample");
    const id = "sp-83917";
    const { token, detail } = await openHandover(cookie, id);
    const item = detail.handoverItems[0]!;
    const marker = `wombatfig${tag()}`;
    await portalUploadOk(token, textFile("Levy register.txt", `The ${marker} levy register for the administrative fund.`), { itemId: item.id });

    // The Files screen sees it (labelled); the agents don't.
    expect((await staffSearch(cookie, id, marker)).map((h) => h.uploadedBy)).toEqual([SAM_UPLOADER]);
    expect(await agentSearch(id, marker)).toEqual([]);
    const chat = await callJson<{ text: string }>(`/api/properties/${id}/chat`, { cookie, json: { text: `What does the ${marker} register say?` } });
    expect(chat.text).not.toContain(marker);

    // Verified: an ordinary building record, attributed to the supplier and the verifier.
    await callJson(`${base(id)}/handover/${item.id}`, { cookie, json: { status: "verified" } });
    const hits = await agentSearch(id, marker);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.uploadedBy).toBe("Sam Outgoing (Sample Strata Co Pty Ltd), verified by Priya Sample");
    const verified = await getProject(cookie, id);
    expect(verified.events[0]!.detail).toMatch(/1 document now part of the building's records/);

    // Sent back: untrusted again.
    await callJson(`${base(id)}/handover/${item.id}`, { cookie, json: { status: "rejected", reviewNote: "Wrong building" } });
    expect(await agentSearch(id, marker)).toEqual([]);
    expect((await staffSearch(cookie, id, marker))[0]!.uploadedBy).toBe(SAM_UPLOADER);
  });

  it("an upload to a verified item sets it back to awaiting verification; the earlier file stays verified", async () => {
    const cookie = await loginAndSeed("Lee Demo");
    const id = "sp-43464";
    const { token, detail } = await openHandover(cookie, id);
    const item = detail.handoverItems[0]!;
    const first = `kookaburra${tag()}`;
    const second = `galahbird${tag()}`;
    await portalUploadOk(token, textFile("Plan part 1.txt", `Part one ${first}`), { itemId: item.id });
    await callJson(`${base(id)}/handover/${item.id}`, { cookie, json: { status: "verified" } });
    expect((await portalJson<PortalView>(token)).items.find((i) => i.id === item.id)!.status).toBe("verified");

    await portalUploadOk(token, textFile("Plan part 2.txt", `Part two ${second}`), { itemId: item.id });
    const view = await portalJson<PortalView>(token);
    const after = view.items.find((i) => i.id === item.id)!;
    expect(after.status).toBe("awaiting_verification");
    expect(after.files.map((f) => f.name)).toEqual(["Plan part 1.txt", "Plan part 2.txt"]);
    expect(await agentSearch(id, first)).toHaveLength(1);
    expect(await agentSearch(id, second)).toEqual([]);
  });

  it("refuses uploads on a withdrawn link and stores nothing", async () => {
    const cookie = await loginAndSeed("Withdrawn Tester");
    const id = "sp-23079";
    const { token, invite } = await openHandover(cookie, id);
    await callJson(`${base(id)}/invites/${invite.id}/revoke`, { cookie, json: {} });
    const before = await docs(cookie, id);
    const res = await portalUpload(token, textFile("Late.txt", "late"), { folder: "07 Correspondence" });
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual(GONE);
    expect(await docs(cookie, id)).toEqual(before);
    const listed = await env.VAULT.list({ prefix: `${id}/07 Correspondence/` });
    expect(listed.objects.some((o) => o.key.endsWith("-Late.txt"))).toBe(false);
  });

  it("enforces the per-invitation file and byte limits", async () => {
    const cookie = await loginAndSeed("Quota Tester");
    const id = "sp-23872";
    const { token, invite } = await openHandover(cookie, id);
    await agentExec(id, "UPDATE handover_invites SET files_count = 3000 WHERE id = ?", invite.id);
    const full = await portalUpload(token, textFile("one more.txt", "x"), { folder: "07 Correspondence" });
    expect(full.status).toBe(413);
    expect((await full.json<{ error: string }>()).error).toMatch(/limit of 3,000 files/);

    await agentExec(id, "UPDATE handover_invites SET files_count = 0, bytes_total = ? WHERE id = ?", 5 * 1024 * 1024 * 1024 - 2, invite.id);
    expect((await portalUpload(token, textFile("three bytes.txt", "abc"), { folder: "07 Correspondence" })).status).toBe(413);
    expect((await portalUpload(token, textFile("two.txt", "ab"), { folder: "07 Correspondence" })).status).toBe(201);
    const [row] = await agentRows<{ files_count: number; bytes_total: number }>(id, "SELECT files_count, bytes_total FROM handover_invites WHERE id = ?", invite.id);
    expect(row).toEqual({ files_count: 1, bytes_total: 5 * 1024 * 1024 * 1024 });
  });
});

// ===========================================================================
// The portal's own actions
// ===========================================================================

describe("portal actions", () => {
  it("marks items not applicable (a required one still needs staff) and adds notes", async () => {
    const cookie = await loginAndSeed("Action Tester");
    const id = "sp-82719";
    const { token, detail } = await openHandover(cookie, id);
    const required = detail.handoverItems.find((i) => i.required)!;

    expect((await portal(token, `/items/${required.id}/not-applicable`, { json: {} })).status).toBe(400);
    expect((await portal(token, `/items/${required.id}/not-applicable`, { json: { note: "   " } })).status).toBe(400);
    expect((await portal(token, "/items/no-such-item/not-applicable", { json: { note: "x" } })).status).toBe(404);

    const waived = await portalJson<PortalItem>(token, `/items/${required.id}/not-applicable`, { json: { note: "The scheme has no lift" } });
    expect(waived).toMatchObject({ id: required.id, status: "awaiting_verification", supplierNote: "The scheme has no lift", reviewNote: null });
    const staff = await getProject(cookie, id);
    expect(staff.handoverItems.find((i) => i.id === required.id)).toMatchObject({ status: "awaiting_verification", supplierNote: "The scheme has no lift" });
    expect(staff.events[0]).toMatchObject({ kind: "handover", actor: "Sam Outgoing", detail: "The scheme has no lift" });
    expect(staff.events[0]!.summary).toContain("needs staff verification");
    // Staff agree: not applicable, and no longer a go-live blocker.
    await callJson(`${base(id)}/handover/${required.id}`, { cookie, json: { status: "not_applicable" } });

    const optional = detail.handoverItems.find((i) => !i.required);
    if (optional) {
      const skipped = await portalJson<PortalItem>(token, `/items/${optional.id}/not-applicable`, { json: { note: "Not held" } });
      expect(skipped.status).toBe("not_applicable");
    }

    const other = detail.handoverItems.find((i) => i.id !== required.id && i.required) ?? required;
    const noted = await portalJson<PortalItem>(token, `/items/${other.id}/note`, { json: { note: "Coming next week from the archive" } });
    expect(noted.supplierNote).toBe("Coming next week from the archive");
    expect((await getProject(cookie, id)).events[0]!.summary).toBe(`Sam Outgoing added a note to "${other.title}"`);

    // A verified item can't be waived from the portal; a rejected one shows Ikon's note.
    await callJson(`${base(id)}/handover/${other.id}`, { cookie, json: { status: "verified" } });
    expect((await portal(token, `/items/${other.id}/not-applicable`, { json: { note: "x" } })).status).toBe(409);
    await callJson(`${base(id)}/handover/${other.id}`, { cookie, json: { status: "rejected", reviewNote: "Please send the signed copy" } });
    const view = await portalJson<PortalView>(token);
    expect(view.items.find((i) => i.id === other.id)).toMatchObject({ status: "rejected", reviewNote: "Please send the signed copy" });
    await callJson(`${base(id)}/handover/${other.id}`, { cookie, json: { status: "verified", reviewNote: "Internal: checked against Landgate" } });
    expect((await portalJson<PortalView>(token)).items.find((i) => i.id === other.id)!.reviewNote).toBeNull();
  });

  it("submits the pack: recorded, logged, highlighted in the brief, and still open for late documents", async () => {
    const cookie = await loginAndSeed("Submit Tester");
    const id = "sp-26707";
    const { token, detail } = await openHandover(cookie, id);
    await portalUploadOk(token, textFile("Strata plan.txt", "Plan"), { itemId: detail.handoverItems[0]!.id });

    const view = await portalJson<PortalView>(token, "/submit", { json: { message: "Remaining files to follow by courier." } });
    expect(Date.now() - Date.parse(view.submittedAt!)).toBeLessThan(60_000);
    const staff = await getProject(cookie, id);
    expect(staff.invites[0]!.status).toBe("submitted");
    expect(staff.events[0]).toMatchObject({
      kind: "portal",
      actor: "Sam Outgoing",
      summary: `Sam Outgoing submitted the handover pack: 1 of ${TEMPLATE_ITEMS} documents supplied`,
      detail: "Remaining files to follow by courier.",
    });
    const activity = await callJson<ActivityEvent[]>(`/api/properties/${id}/activity`, { cookie });
    expect(activity[0]!.summary).toBe(`Outgoing manager submitted the handover pack: 1 of ${TEMPLATE_ITEMS} documents supplied`);

    const brief = await callJson<PortfolioBrief>("/api/brief/refresh", { cookie, json: {} });
    expect(brief.highlights.some((h) => h.propertyId === id && /handover pack submitted by Sam Outgoing/.test(h.label))).toBe(true);
    expect(brief.text).toMatch(/- SP 26707 Claremont: .*handover pack submitted by Sam Outgoing on /);

    // Late documents are still welcome.
    expect((await portalUpload(token, textFile("Late minutes.txt", "Minutes"), { folder: "03 Meetings" })).status).toBe(201);
    expect((await portalJson<PortalView>(token)).submittedAt).toBe(view.submittedAt);
  });
});

// ===========================================================================
// A re-issued link, downloads and the progress bar
// ===========================================================================

describe("portal state across links", () => {
  it("a new link shows what was supplied through the earlier one; only staff can download the files", async () => {
    const cookie = await loginAndSeed("Reissue Tester");
    const id = "sp-87192";
    const { token, detail } = await openHandover(cookie, id);
    const item = detail.handoverItems[0]!;
    await portalUploadOk(token, textFile("By-laws.txt", "Schedule 1 and Schedule 2 by-laws"), { itemId: item.id });

    const second = await prepareInvite(cookie, id);
    const { url } = await activateInvite(cookie, id, second.id);
    expect((await portal(token)).status).toBe(410);
    const view = await portalJson<PortalView>(tokenOf(url));
    expect(view.items.find((i) => i.id === item.id)).toMatchObject({ status: "awaiting_verification", files: [{ name: "By-laws.txt" }] });

    // No download route on the portal; staff download it from the Files tab.
    expect((await portal(tokenOf(url), `/files/${item.id}`)).status).toBe(404);
    const file = (await getProject(cookie, id)).handoverItems.find((i) => i.id === item.id)!.files[0]!;
    const download = await call(`/api/properties/${id}/docs/${file.docId}/download`, { cookie });
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("Schedule 1 and Schedule 2 by-laws");
    expect((await call(`/api/properties/${id}/docs/${file.docId}/download`)).status).toBe(401);
  });

  it("the progress bar splits the items into supplied, verified, not applicable and outstanding", async () => {
    const cookie = await loginAndSeed("Progress Bar Tester");
    // Shares sp-82719 with the actions test above (storage persists within a file): reuse its project, fresh link.
    const id = "sp-82719";
    const detail = (await getProject(cookie, id).catch(() => null)) ?? (await openHandover(cookie, id)).detail;
    const link = tokenOf((await activateInvite(cookie, id, (await prepareInvite(cookie, id)).id)).url);
    const items = detail.handoverItems;
    expect(items.length).toBeGreaterThanOrEqual(3);
    for (const item of items) await callJson(`${base(id)}/handover/${item.id}`, { cookie, json: { status: "awaiting_supply" } });
    await portalUploadOk(link, textFile("Supplied.txt", "supplied"), { itemId: items[0]!.id });
    await callJson(`${base(id)}/handover/${items[1]!.id}`, { cookie, json: { status: "verified" } });
    await callJson(`${base(id)}/handover/${items[2]!.id}`, { cookie, json: { status: "not_applicable" } });
    const view = await portalJson<PortalView>(link);
    expect(view.progress).toEqual({ total: items.length, supplied: 1, verified: 1, notApplicable: 1, outstanding: items.length - 3 });
  });
});
