// Document vault: multipart upload → R2 + text extraction + FTS5 index, search, download, delete.

import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { DocMeta, SearchHit } from "../shared/types";
import { call, callJson, loginAndSeed, PILOT, tag } from "./helpers";

function upload(cookie: string, propertyId: string, file: File | Blob | string | null, folder?: string, filename?: string) {
  const form = new FormData();
  if (file instanceof File) form.set("file", file);
  else if (file instanceof Blob) form.set("file", file, filename ?? "blob.bin");
  else if (typeof file === "string") form.set("file", file);
  if (folder !== undefined) form.set("folder", folder);
  return call(`/api/properties/${propertyId}/docs`, { cookie, body: form });
}

/** A minimal Word document: only word/document.xml matters to the extractor. */
function makeDocx(paragraphs: string[]): Uint8Array {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join("");
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "word/document.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:body>${body}</w:body></w:document>`,
    ),
  });
}

async function search(cookie: string, q: string): Promise<SearchHit[]> {
  return callJson(`/api/properties/${PILOT}/search?q=${encodeURIComponent(q)}`, { cookie });
}

describe("document vault", () => {
  it("uploads a .txt: stored in R2, fully indexed, searchable, downloadable, then deleted everywhere", async () => {
    const cookie = await loginAndSeed("Vault Tester");
    const word = `zephyrine${tag()}`;
    const content = `Pump room inspection notes.\n\nThe ${word} valve in the basement pump room was serviced on 2 November.\n`;
    const res = await upload(cookie, PILOT, new File([content], "pump room notes.txt", { type: "text/plain" }), "05 Maintenance & Contractors");
    expect(res.status).toBe(201);
    const doc = await res.json<DocMeta>();
    expect(doc).toMatchObject({
      folder: "05 Maintenance & Contractors",
      name: "pump room notes.txt",
      indexed: "full",
      scope: "building",
      sample: false,
      uploadedBy: "Vault Tester",
      size: new TextEncoder().encode(content).byteLength,
    });
    expect(doc.mimeType).toMatch(/^text\/plain/);
    expect(doc.chars).toBeGreaterThan(20);
    expect(doc.r2Key.startsWith(`${PILOT}/05 Maintenance & Contractors/`)).toBe(true);

    // R2 holds the bytes.
    const object = await env.VAULT.get(doc.r2Key);
    expect(object).not.toBeNull();
    expect(await object!.text()).toBe(content);

    // Listed and searchable by content and by (prefix of) name.
    const docs = await callJson<DocMeta[]>(`/api/properties/${PILOT}/docs`, { cookie });
    expect(docs.map((d) => d.id)).toContain(doc.id);
    const hits = await search(cookie, word);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.docId).toBe(doc.id);
    expect(hits[0]!.docName).toBe("pump room notes.txt");
    expect(hits[0]!.snippet.toLowerCase()).toContain(word.toLowerCase());
    expect((await search(cookie, word.slice(0, 12))).map((h) => h.docId)).toContain(doc.id);

    // Text view and download.
    const text = await callJson<any>(`/api/properties/${PILOT}/docs/${doc.id}/text`, { cookie });
    expect(text.meta.id).toBe(doc.id);
    expect(text.text).toContain(word);
    const download = await call(`/api/properties/${PILOT}/docs/${doc.id}/download`, { cookie });
    expect(download.status).toBe(200);
    expect(download.headers.get("Content-Disposition")).toBe(
      `attachment; filename="pump room notes.txt"; filename*=UTF-8''pump%20room%20notes.txt`,
    );
    expect(download.headers.get("Content-Type")).toMatch(/^text\/plain/);
    expect(download.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(download.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await download.text()).toBe(content);

    // Delete: index rows, listing and the R2 object all go.
    expect(await callJson(`/api/properties/${PILOT}/docs/${doc.id}`, { cookie, method: "DELETE" })).toEqual({ ok: true });
    expect(await env.VAULT.get(doc.r2Key)).toBeNull();
    // Inside the agent: no chunk or FTS rows are left behind, and the live state counts agree.
    const pilot = env.PropertyAgent.get(env.PropertyAgent.idFromName(PILOT));
    const leftovers = await runInDurableObject(pilot, async (instance, state) => {
      const sql = state.storage.sql;
      const chunks = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM doc_chunks WHERE doc_id = ?", doc.id).one().n;
      const fts = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM doc_fts WHERE name = ?", doc.name).one().n;
      const docs = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM docs").one().n;
      return { chunks, fts, docs, stateDocs: instance.state.counts.docs };
    });
    expect(leftovers.chunks).toBe(0);
    expect(leftovers.fts).toBe(0);
    expect(leftovers.stateDocs).toBe(leftovers.docs);
    expect((await search(cookie, word)).map((h) => h.docId)).not.toContain(doc.id);
    expect((await callJson<DocMeta[]>(`/api/properties/${PILOT}/docs`, { cookie })).map((d) => d.id)).not.toContain(doc.id);
    expect((await call(`/api/properties/${PILOT}/docs/${doc.id}/text`, { cookie })).status).toBe(404);
    expect((await call(`/api/properties/${PILOT}/docs/${doc.id}/download`, { cookie })).status).toBe(404);
    expect((await call(`/api/properties/${PILOT}/docs/${doc.id}`, { cookie, method: "DELETE" })).status).toBe(404);
  });

  it("extracts and indexes the text of a generated .docx", async () => {
    const cookie = await loginAndSeed("Docx Tester");
    const word = `quillwort${tag()}`;
    const bytes = makeDocx(["Council meeting resolution", `The council resolved to repaint the ${word} balustrade in March.`]);
    const file = new File([bytes], "council resolution.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const res = await upload(cookie, PILOT, file, "03 Meetings");
    expect(res.status).toBe(201);
    const doc = await res.json<DocMeta>();
    expect(doc.indexed).toBe("full");
    expect(doc.folder).toBe("03 Meetings");
    expect(doc.size).toBe(bytes.byteLength);

    const text = await callJson<any>(`/api/properties/${PILOT}/docs/${doc.id}/text`, { cookie });
    expect(text.text).toContain("Council meeting resolution");
    expect(text.text).toContain(`repaint the ${word} balustrade`);
    expect(text.text).not.toMatch(/<w:/);

    const hits = await search(cookie, `${word} balustrade`);
    expect(hits.map((h) => h.docId)).toContain(doc.id);

    // The original bytes come back on download.
    const download = await call(`/api/properties/${PILOT}/docs/${doc.id}/download`, { cookie });
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);

    await callJson(`/api/properties/${PILOT}/docs/${doc.id}`, { cookie, method: "DELETE" });
  });

  it("indexes a non-text file by name only, defaults the folder, and keeps non-ASCII names", async () => {
    const cookie = await loginAndSeed("Binary Tester");
    const name = `Plan façade ${tag()}.bin`;
    const res = await upload(cookie, PILOT, new File([new Uint8Array([0, 159, 146, 150, 0, 1, 2, 3])], name, { type: "application/octet-stream" }));
    expect(res.status).toBe(201);
    const doc = await res.json<DocMeta>();
    expect(doc.folder).toBe("07 Correspondence");
    expect(doc.indexed).not.toBe("full");
    expect(doc.name).toBe(name);
    const download = await call(`/api/properties/${PILOT}/docs/${doc.id}/download`, { cookie });
    expect(download.headers.get("Content-Disposition")).toContain(`filename*=UTF-8''${encodeURIComponent(name)}`);
    await callJson(`/api/properties/${PILOT}/docs/${doc.id}`, { cookie, method: "DELETE" });
  });

  it("downloads a seeded sample document from the vault", async () => {
    const cookie = await loginAndSeed("Seed Download Tester");
    const docs = await callJson<DocMeta[]>(`/api/properties/${PILOT}/docs`, { cookie });
    const info = docs.find((d) => /Building information/i.test(d.name))!;
    expect(info).toBeTruthy();
    expect(info.sample).toBe(true);
    const res = await call(`/api/properties/${PILOT}/docs/${info.id}/download`, { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; /);
    const text = await res.text();
    expect(text).toMatch(/^SAMPLE DOCUMENT - replace with the real/);
    expect(text).toMatch(/water main/i);
  });

  it("strips directory components from uploaded file names and keeps the key under the property", async () => {
    const cookie = await loginAndSeed("Path Tester");
    const res = await upload(
      cookie,
      PILOT,
      new File([`traversal ${tag()}`], "../../sp-13183/02 Insurance/evil.txt", { type: "text/plain" }),
      "07 Correspondence",
    );
    expect(res.status).toBe(201);
    const doc = await res.json<DocMeta>();
    expect(doc.name).toBe("evil.txt");
    expect(doc.r2Key.startsWith(`${PILOT}/07 Correspondence/`)).toBe(true);
    expect(doc.r2Key).not.toContain("..");
    await callJson(`/api/properties/${PILOT}/docs/${doc.id}`, { cookie, method: "DELETE" });
  });

  it("rejects an invalid folder (400), a missing or empty file (400) and a JSON upload (415)", async () => {
    const cookie = await loginAndSeed("Upload Validator");
    const bad = await upload(cookie, PILOT, new File(["hello"], "a.txt", { type: "text/plain" }), "99 Secret Folder");
    expect(bad.status).toBe(400);
    expect((await bad.json<any>()).error).toMatch(/^folder must be one of/);

    const traversal = await upload(cookie, PILOT, new File(["hello"], "a.txt", { type: "text/plain" }), "../sp-13183");
    expect(traversal.status).toBe(400);

    const noFile = await upload(cookie, PILOT, null, "03 Meetings");
    expect(noFile.status).toBe(400);
    const stringField = await upload(cookie, PILOT, "just a string", "03 Meetings");
    expect(stringField.status).toBe(400);
    const empty = await upload(cookie, PILOT, new File([], "empty.txt", { type: "text/plain" }), "03 Meetings");
    expect(empty.status).toBe(400);

    const json = await call(`/api/properties/${PILOT}/docs`, { cookie, json: { file: "x" } });
    expect(json.status).toBe(415);
  });

  it("rejects a file over 25 MB with 413", async () => {
    const cookie = await loginAndSeed("Big File Tester");
    const big = new File([new Uint8Array(25 * 1024 * 1024 + 1)], "big.bin", { type: "application/octet-stream" });
    const res = await upload(cookie, PILOT, big, "07 Correspondence");
    expect(res.status).toBe(413);

    const huge = new File([new Uint8Array(26 * 1024 * 1024)], "huge.bin", { type: "application/octet-stream" });
    const res2 = await upload(cookie, PILOT, huge, "07 Correspondence");
    expect(res2.status).toBe(413);

    const docs = await callJson<DocMeta[]>(`/api/properties/${PILOT}/docs`, { cookie });
    expect(docs.some((d) => d.name === "big.bin" || d.name === "huge.bin")).toBe(false);
  });

  it("keeps buildings apart: a document id from one scheme is not found via another", async () => {
    const cookie = await loginAndSeed("Isolation Tester");
    const res = await upload(cookie, PILOT, new File([`private ${tag()}`], "private.txt", { type: "text/plain" }), "07 Correspondence");
    const doc = await res.json<DocMeta>();
    for (const path of [`/docs/${doc.id}/download`, `/docs/${doc.id}/text`]) {
      expect((await call(`/api/properties/sp-87192${path}`, { cookie })).status).toBe(404);
    }
    expect((await call(`/api/properties/sp-87192/docs/${doc.id}`, { cookie, method: "DELETE" })).status).toBe(404);
    expect(await env.VAULT.get(doc.r2Key)).not.toBeNull();
    await callJson(`/api/properties/${PILOT}/docs/${doc.id}`, { cookie, method: "DELETE" });
  });

  it("search never fails on odd FTS input and finds the seeded water main document", async () => {
    const cookie = await loginAndSeed("Search Tester");
    for (const q of ['"', "*", "NEAR(", "a OR", "-", "()", '" OR 1=1 --', "écoulement ✓", "x".repeat(400)]) {
      const res = await call(`/api/properties/${PILOT}/search?q=${encodeURIComponent(q)}`, { cookie });
      expect(res.status, q).toBe(200);
      expect(Array.isArray(await res.json())).toBe(true);
    }
    expect(await search(cookie, "")).toEqual([]);

    const hits = await search(cookie, "water main");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => /Building information/i.test(h.docName))).toBe(true);
    const limited = await callJson<SearchHit[]>(`/api/properties/${PILOT}/search?q=water&limit=2`, { cookie });
    expect(limited.length).toBeLessThanOrEqual(2);
  });
});
