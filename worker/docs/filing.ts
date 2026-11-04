// Filing a staff member's document into a building: R2, text extraction and the agent's FTS index.
// The upload form and the Microsoft 365 import both come through here, so a file is stored, named and
// indexed the same way whichever door it came in by.

import type { DocMeta, VAULT_FOLDERS } from "../../shared/types";
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
