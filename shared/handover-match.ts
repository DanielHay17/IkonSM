// Matches a file from the outgoing manager (a name, or a path inside a SharePoint zip) to the requested
// handover document it most likely is, and the Master File Structure folder it belongs in. Runs in the
// browser (portal preview, before upload) and in the Worker (uploads that arrive without an item).
// STUB: the content agent replaces this with the full matcher; keep the signatures.

import type { HandoverMatch, HandoverMatchTarget, VaultFolderName } from "./onboarding";

const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$|~\$)/i;

export function isJunkPath(path: string): boolean {
  return JUNK.test(path);
}

export function matchHandoverFile(path: string, targets: HandoverMatchTarget[], fallbackFolder: VaultFolderName = "07 Correspondence"): HandoverMatch {
  if (isJunkPath(path)) return { itemId: null, folder: fallbackFolder, confidence: 0, reason: "system file", skip: true };
  const lower = path.toLowerCase();
  for (const target of targets) {
    const hit = target.keywords.find((k) => lower.includes(k));
    if (hit) return { itemId: target.id, folder: target.folder, confidence: 0.6, reason: `mentions "${hit}"`, skip: false };
  }
  return { itemId: null, folder: fallbackFolder, confidence: 0, reason: "no match", skip: false };
}
