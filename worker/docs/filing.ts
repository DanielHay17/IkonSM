// Filing a staff member's document into a building: R2, text extraction and the agent's FTS index.
// The upload form and the Microsoft 365 import both come through here, so a file is stored, named and
// indexed the same way whichever door it came in by.

import type { PortalUploadResult } from "../../shared/onboarding";
import type { DocMeta, VAULT_FOLDERS } from "../../shared/types";
import type { OnboardingResult } from "../agents/onboarding";
import type { PropertyStub } from "../http";
import { extractText } from "./extract";
import { displayFileName, guessMime, r2KeyFor } from "./vault";

/** The largest file the hub accepts, from the upload form or an import. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type VaultFolder = (typeof VAULT_FOLDERS)[number];

export interface StaffDocument {
  folder: VaultFolder;
  /** The name as the source gave it; path parts and control characters are stripped here. */
  name: string;
  /** The type the source reported, if any; generic types fall back to a guess from the extension. */
  mimeType: string | null;
  bytes: Uint8Array;
  /** Shown on the Files tab: the staff member's name, with a note when it came from elsewhere. */
  uploadedBy: string;
}

/**
 * Stores the bytes in R2 under the building's prefix and indexes the extracted text in its agent.
 * Staff documents are trusted building records (unlike emailed attachments). If indexing fails the
 * R2 object is removed again, so nothing is left in storage that the Files tab can't show.
 */
export async function fileStaffDocument(env: Env, propertyId: string, agent: PropertyStub, input: StaffDocument): Promise<DocMeta> {
  const name = displayFileName(input.name);
  const mimeType = guessMime(name, input.mimeType);
  const extracted = await extractText(input.bytes, mimeType, name);
  if (extracted.error) console.warn(`Text extraction failed for "${name}" (${extracted.method}): ${extracted.error}`);

  const r2Key = r2KeyFor(propertyId, input.folder, name);
  await env.VAULT.put(r2Key, input.bytes, { httpMetadata: { contentType: mimeType }, customMetadata: { propertyId } });
  try {
    return await agent.addDocument(
      {
        folder: input.folder,
        name,
        mimeType,
        size: input.bytes.byteLength,
        r2Key,
        scope: "building",
        sample: false,
        uploadedBy: input.uploadedBy,
      },
      extracted.text,
    );
  } catch (err) {
    await deleteVaultObject(env, r2Key);
    throw err;
  }
}

/** The index entry is already gone; an orphaned object only costs storage, so log instead of failing. */
export async function deleteVaultObject(env: Env, r2Key: string): Promise<void> {
  try {
    await env.VAULT.delete(r2Key);
  } catch (err) {
    console.error(`Could not delete vault object ${r2Key}:`, err);
  }
}

export interface HandoverUpload {
  /** The name as the browser gave it; cleaned with displayFileName. */
  name: string;
  mimeType: string | null;
  bytes: Uint8Array;
  /** A VAULT_FOLDERS value, or null for the item's (or the matched) folder. */
  folder: string | null;
  /** A requested item; null to auto-match the file to one; "none" to file it as an extra. */
  itemId: string | null;
  /** Sanitised path inside the zip or folder it came from (display only). */
  sourcePath: string | null;
}

/**
 * Files an upload from the outgoing manager's portal. The building agent checks the token and decides the
 * item and folder before any bytes are stored, then indexes the document with the untrusted "handover:"
 * uploader (left out of the agents' search until staff verify it). The token is checked again when the
 * upload is recorded; if that fails, the R2 object is removed again.
 */
export async function fileHandoverDocument(
  env: Env,
  propertyId: string,
  agent: PropertyStub,
  token: string,
  input: HandoverUpload,
): Promise<OnboardingResult<PortalUploadResult & { docId: string }>> {
  const name = displayFileName(input.name);
  const plan = await agent.portalPlanUpload(token, {
    name,
    size: input.bytes.byteLength,
    folder: input.folder,
    itemId: input.itemId,
    sourcePath: input.sourcePath,
  });
  if (!plan.ok) return plan;

  // The type comes from the file's extension, never from what the uploader's browser claims: an ".exe" sent as
  // "application/pdf" is stored (and later downloaded) as application/octet-stream.
  const mimeType = guessMime(name, null);
  const r2Key = r2KeyFor(propertyId, plan.value.folder, name);
  // Stored first, so text extraction may consume the bytes (no extra copy of a large PDF in memory).
  await env.VAULT.put(r2Key, input.bytes, { httpMetadata: { contentType: mimeType }, customMetadata: { propertyId, source: "handover" } });
  try {
    const extracted = await extractText(input.bytes, mimeType, name, { consume: true });
    if (extracted.error) console.warn(`Text extraction failed for handover upload "${name}" (${extracted.method}): ${extracted.error}`);
    const result = await agent.portalCommitUpload(token, plan.value, { mimeType, r2Key }, extracted.text, extracted.error != null);
    if (!result.ok) await deleteVaultObject(env, r2Key);
    return result;
  } catch (err) {
    await deleteVaultObject(env, r2Key);
    throw err;
  }
}
