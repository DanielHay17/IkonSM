// Matches a file from the outgoing manager (a name, or a path inside a SharePoint or OneDrive zip) to the
// requested handover document it most likely is, and the Master File Structure folder it belongs in.
// Runs in the browser (the portal's review table, before upload) and in the Worker (uploads that arrive
// without an item). Pure TypeScript, no dependencies.
//
// How it scores: each requested item has keywords ("certificate of currency", "coc", "agm minutes"). Paths
// are normalised (case, separators, camelCase, dates and financial years, "by-laws", "s110", plurals and
// common abbreviations) and a keyword counts when its words appear together in one path segment. Phrases
// outweigh single words, words unique to one item outweigh shared ones, and the file name outweighs the
// folders above it. A folder that maps to the item's Master File Structure folder adds a little. The score
// becomes a 0..1 confidence: clear matches land at 0.7 or more, weak guesses below 0.5 (the Worker only
// attaches automatically at HANDOVER_AUTO_ATTACH_CONFIDENCE).

import type { HandoverMatch, HandoverMatchTarget, VaultFolderName } from "./onboarding";
import { VAULT_FOLDERS } from "./types";

/** Uploads without a chosen item are attached to the best match at or above this confidence. */
export const HANDOVER_AUTO_ATTACH_CONFIDENCE = 0.5;

// ===========================================================================
// Junk (never uploaded)
// ===========================================================================

const JUNK_FOLDERS = new Set(["__macosx", ".trashes", ".spotlight-v100", ".fseventsd", ".temporaryitems", "$recycle.bin", "system volume information"]);
const JUNK_NAMES = new Set(["thumbs.db", "ehthumbs.db", "desktop.ini"]);
const JUNK_SUFFIX = /\.(tmp|temp|crdownload|part)$/i;

/** Segments of "a/b/c.pdf" (or "a\b\c.pdf"), without empty, "." or ".." parts. */
export function pathSegments(path: string): string[] {
  return (path ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..");
}

/**
 * System and temporary files that should never be uploaded: macOS metadata (__MACOSX/, .DS_Store, ._ files),
 * Windows Thumbs.db and desktop.ini, Office "~$" lock files, LibreOffice ".~lock." files, .tmp and partial
 * downloads, other dot-files, folder entries (paths ending in "/") and empty names.
 */
export function isJunkPath(path: string): boolean {
  const raw = (path ?? "").replace(/\\/g, "/");
  // A folder entry, an empty name, or the macOS custom-icon file "Icon\r" (trimmed away below).
  if (!raw.trim() || /\/\s*$/.test(raw) || /(^|\/)Icon\r$/.test(raw)) return true;
  const parts = pathSegments(raw);
  const name = parts.at(-1);
  if (!name || !/[\p{L}\p{N}]/u.test(name)) return true;
  if (parts.some((part) => JUNK_FOLDERS.has(part.toLowerCase()))) return true;
  const lower = name.toLowerCase();
  return JUNK_NAMES.has(lower) || lower.startsWith(".") || lower.startsWith("~$") || JUNK_SUFFIX.test(lower);
}

// ===========================================================================
// Normalising names and keywords into comparable words
// ===========================================================================

const STOPWORDS = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "re", "the", "to", "with",
  "copy", "scan", "scanned", "signed", "draft", "rev", "ver", "version", "updated", "current", "latest", "sp", "pty", "ltd",
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december",
]);

/** Abbreviations seen in real file names, expanded before stemming (values may be several words). */
const ABBREVIATIONS: Record<string, string> = {
  mins: "minutes",
  rec: "reconciliation",
  recs: "reconciliation",
  recon: "reconciliation",
  recons: "reconciliation",
  reconcilation: "reconciliation",
  stmt: "statement",
  stmts: "statement",
  stmnt: "statement",
  cert: "certificate",
  certs: "certificate",
  acct: "account",
  accts: "account",
  corro: "correspondence",
  corres: "correspondence",
  corresp: "correspondence",
  maint: "maintenance",
  insur: "insurance",
  fin: "financial",
  ten: "10",
  reg: "register",
  rego: "registration",
  info: "information",
  bal: "balance",
  bals: "balance",
  tb: "trial balance",
  liab: "liability",
  cleaner: "cleaning",
  cleaners: "cleaning",
  gardener: "gardening",
  gardeners: "gardening",
  valn: "valuation",
};

/** Light plural stemming, applied identically to paths and keywords. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("sses")) return word.slice(0, -2);
  if (word.length >= 4 && word.endsWith("s") && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * The comparable words of a file name, folder name or keyword: lower-case, separators and punctuation
 * removed, camelCase split, dates, years and reference numbers dropped, financial years ("FY25",
 * "2024-25") collapsed to "fy", "s.110"/"section 110" to "s110", "AS 1851" to "as1851", "by-laws" to
 * "bylaw", abbreviations expanded and plurals stemmed.
 */
export function normaliseWords(text: string, options: { stripExtension?: boolean } = {}): string[] {
  let s = (text ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
  if (options.stripExtension) s = s.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  // camelCase and PascalCase ("CertificateOfCurrency", "AGMMinutes"), but not short forms like "CoC".
  s = s.replace(/([a-z])(?=[A-Z][a-z])/g, "$1 ").replace(/([A-Z])(?=[A-Z][a-z])/g, "$1 ").toLowerCase();
  s = s.replace(/&/g, " and ").replace(/[+_]/g, " ");
  // Dates: 2026-11-07, 07.11.2026, 7/11/26
  s = s.replace(/\b\d{4}[-./ ]\d{1,2}[-./ ]\d{1,2}\b/g, " ").replace(/\b\d{1,2}[-./]\d{1,2}[-./]\d{2,4}\b/g, " ");
  // Split letters from digits ("AGM2024", "fy25", "s110", "SP87192"), then rebuild the forms that matter.
  s = s.replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d)([a-z])/g, "$1 $2");
  s = s.replace(/\bfy\s*\d{2,4}(?:\s*[-/.]\s*\d{2,4})?\b/g, " fy ");
  s = s.replace(/\b(?:19|20)\d{2}\s*[-/]\s*(?:(?:19|20)\d{2}|\d{2})\b/g, " fy ");
  s = s.replace(/\b(?:s|sec|section)\s*\.?\s*(\d{2,3})\b/g, " s$1 ");
  s = s.replace(/\bas\s*(\d{4})\b/g, " as$1 ");
  s = s.replace(/\bby\s*[-.]?\s*laws?\b/g, " bylaw ");
  const words: string[] = [];
  for (const raw of s.split(/[^a-z0-9]+/)) {
    if (!raw) continue;
    for (const word of (ABBREVIATIONS[raw] ?? raw).split(" ")) {
      const stemmed = stem(word);
      if (stemmed.length < 2 || STOPWORDS.has(stemmed) || /^\d{4,}$/.test(stemmed)) continue;
      words.push(stemmed);
    }
  }
  return words;
}

const keywordCache = new Map<string, string[]>();

function keywordWords(keyword: string): string[] {
  let words = keywordCache.get(keyword);
  if (!words) {
    words = normaliseWords(keyword);
    if (keywordCache.size > 4000) keywordCache.clear();
    keywordCache.set(keyword, words);
  }
  return words;
}

function containsRun(haystack: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > haystack.length) return false;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

// ===========================================================================
// Folders: map the outgoing manager's folder names to Ikon's Master File Structure
// ===========================================================================

const FOLDER_WORDS: Record<VaultFolderName, string[]> = {
  "01 Plan & By-laws": ["strata plan", "plan", "by-laws", "scheme", "scheme notice", "management statement", "title", "landgate", "unit entitlement", "survey", "strata roll", "roll", "owner register"],
  "02 Insurance": ["insurance", "coc", "certificate of currency", "claim", "valuation", "insurer", "broker", "policy"],
  "03 Meetings": ["meeting", "minutes", "agm", "egm", "council", "agenda", "proxy", "resolution", "general meeting", "committee", "ballot"],
  "04 Financials & Levies": [
    "financial", "finance", "account", "accounting", "levy", "contribution", "bank", "banking", "budget", "audit", "ledger", "arrears",
    "debtor", "creditor", "invoice", "receipt", "tax", "bas", "gst", "ato", "trust", "reconciliation", "fy", "eofy", "payment", "debt recovery",
  ],
  "05 Maintenance & Contractors": [
    "maintenance", "contractor", "repair", "work order", "works", "quote", "quotation", "service", "cleaning", "garden", "gardening", "pest",
    "lift", "plumbing", "electrical", "roof", "painting", "warranty", "defect", "asset", "key", "fob", "remote", "10 year plan", "maintenance plan", "supplier",
  ],
  "06 Compliance & Safety": [
    "compliance", "safety", "fire", "afss", "as1851", "asbestos", "whs", "ohs", "work health", "risk", "hazard", "pool", "smoke alarm", "emergency",
    "evacuation", "essential", "sprinkler", "extinguisher", "backflow", "rcd", "legionella",
  ],
  "07 Correspondence": ["correspondence", "letter", "email", "legal", "solicitor", "lawyer", "dispute", "sat", "tribunal", "court", "complaint", "breach"],
  "08 Sales & Disclosure": ["sale", "disclosure", "s110", "settlement", "conveyancing", "conveyancer", "purchaser", "buyer", "tenancy", "tenant", "lease", "property manager", "change of ownership"],
};

const VAULT_NAME_WORDS = VAULT_FOLDERS.map((folder) => ({
  folder,
  full: normaliseWords(folder).join(" "),
  bare: normaliseWords(folder.replace(/^\d+\s+/, "")).join(" "),
}));

/** The Master File Structure folder one name (a folder or a file name) points to, or null if unclear. */
function folderForWords(words: string[]): VaultFolderName | null {
  if (!words.length) return null;
  const joined = words.join(" ");
  const exact = VAULT_NAME_WORDS.find((v) => v.full === joined || v.bare === joined);
  if (exact) return exact.folder;
  let best: VaultFolderName | null = null;
  let bestScore = 0;
  let tie = false;
  for (const folder of VAULT_FOLDERS) {
    let score = 0;
    for (const phrase of FOLDER_WORDS[folder]) {
      const needle = keywordWords(phrase);
      if (containsRun(words, needle)) score += needle.length > 1 ? 2 : 1;
    }
    if (score > bestScore) {
      best = folder;
      bestScore = score;
      tie = false;
    } else if (score > 0 && score === bestScore) {
      tie = true;
    }
  }
  return tie ? null : best;
}

/** The folder suggested by the path's folders (deepest first), ignoring the file name. */
function folderFromParents(parents: string[]): { folder: VaultFolderName; from: string } | null {
  for (let i = parents.length - 1; i >= 0; i--) {
    const folder = folderForWords(normaliseWords(parents[i]!));
    if (folder) return { folder, from: parents[i]! };
  }
  return null;
}

/**
 * The Master File Structure folder a file most likely belongs in, from its folders (deepest first) and then
 * its file name; null when nothing points anywhere. Used for files that match no requested document.
 */
export function suggestFolder(path: string): VaultFolderName | null {
  const parts = pathSegments(path);
  const name = parts.pop();
  return folderFromParents(parts)?.folder ?? (name ? folderForWords(normaliseWords(name, { stripExtension: true })) : null);
}

// ===========================================================================
// Matching
// ===========================================================================

/** A multi-word keyword found in the file name. */
const PHRASE_WEIGHT = 5;
/** A single-word keyword found in the file name, by how many requested items share it. */
const WORD_WEIGHT_UNIQUE = 2.4;
const WORD_WEIGHT_SHARED = 1.7;
const WORD_WEIGHT_COMMON = 1.2;
/** Keywords found only in a folder count for less: the nearest folder, then folders further up. */
const NEAREST_FOLDER_FACTOR = 0.45;
const OUTER_FOLDER_FACTOR = 0.35;
/** Added when the path's folders point to the item's own Master File Structure folder. */
const FOLDER_AGREES_BONUS = 1.2;
/** Score at which confidence is 1 - 1/e (about 0.63). */
const SCORE_SCALE = 3;
/** Below this no item is suggested at all. */
const MIN_SUGGEST_CONFIDENCE = 0.25;

interface PreparedKeyword {
  raw: string;
  words: string[];
  key: string;
}

interface PreparedTarget {
  target: HandoverMatchTarget;
  keywords: PreparedKeyword[];
}

interface Prepared {
  targets: PreparedTarget[];
  /** How many targets share each keyword (by its normalised words). */
  shared: Map<string, number>;
}

const preparedCache = new WeakMap<HandoverMatchTarget[], Prepared>();

function prepare(targets: HandoverMatchTarget[]): Prepared {
  const cached = preparedCache.get(targets);
  if (cached) return cached;
  const shared = new Map<string, number>();
  const prepared = targets.map((target): PreparedTarget => {
    // Items without keywords fall back to their title.
    const sources = target.keywords?.length ? target.keywords : [target.title];
    // Keywords that normalise alike ("claims", "claim") count once, shown in their shortest form.
    const byKey = new Map<string, PreparedKeyword>();
    for (const raw of sources) {
      const words = keywordWords(raw);
      const key = words.join(" ");
      if (!key) continue;
      const existing = byKey.get(key);
      if (!existing || raw.length < existing.raw.length) byKey.set(key, { raw, words, key });
    }
    for (const key of byKey.keys()) shared.set(key, (shared.get(key) ?? 0) + 1);
    return { target, keywords: [...byKey.values()] };
  });
  const result = { targets: prepared, shared };
  preparedCache.set(targets, result);
  return result;
}

interface Hit {
  keyword: string;
  weight: number;
  /** null = the file name; otherwise the folder name it was found in. */
  folder: string | null;
}

interface Scored {
  target: HandoverMatchTarget;
  score: number;
  hits: Hit[];
}

function scoreTarget(item: PreparedTarget, shared: Map<string, number>, name: string[], parents: { name: string; words: string[] }[]): Scored {
  const hits: Hit[] = [];
  for (const keyword of item.keywords) {
    const sharedBy = shared.get(keyword.key) ?? 1;
    const base =
      keyword.words.length > 1
        ? (PHRASE_WEIGHT + 0.5 * Math.min(keyword.words.length - 2, 3)) * (sharedBy > 1 ? 0.8 : 1)
        : sharedBy <= 1
          ? WORD_WEIGHT_UNIQUE
          : sharedBy === 2
            ? WORD_WEIGHT_SHARED
            : WORD_WEIGHT_COMMON;
    if (containsRun(name, keyword.words)) {
      hits.push({ keyword: keyword.raw, weight: base, folder: null });
      continue;
    }
    // Parents are nearest first.
    const at = parents.findIndex((parent) => containsRun(parent.words, keyword.words));
    if (at >= 0) hits.push({ keyword: keyword.raw, weight: base * (at === 0 ? NEAREST_FOLDER_FACTOR : OUTER_FOLDER_FACTOR), folder: parents[at]!.name });
  }
  hits.sort((a, b) => b.weight - a.weight);
  // Diminishing returns: the strongest hit counts in full, each further one half as much as the last.
  const score = hits.reduce((sum, hit, i) => sum + hit.weight * 0.5 ** i, 0);
  return { target: item.target, score, hits };
}

function describe(hit: Hit): string {
  return hit.folder === null ? `file name mentions "${hit.keyword}"` : `folder "${hit.folder}" mentions "${hit.keyword}"`;
}

/**
 * The requested handover item a file most likely is, with the folder to file it in. `path` is a file
 * name or a path inside a zip or dropped folder ("SP87192 Handover/02 Insurance/CoC 2026-27.pdf").
 * Junk comes back with skip=true. With no good match, itemId is null and the folder comes from the path
 * (see suggestFolder), else `fallbackFolder`.
 */
export function matchHandoverFile(path: string, targets: HandoverMatchTarget[], fallbackFolder: VaultFolderName = "07 Correspondence"): HandoverMatch {
  if (isJunkPath(path)) {
    const folderEntry = /[/\\]\s*$/.test(path ?? "") && pathSegments(path).length > 0;
    return { itemId: null, folder: fallbackFolder, confidence: 0, reason: folderEntry ? "folder, not a file" : "system file, not uploaded", skip: true };
  }
  const folders = pathSegments(path);
  const fileName = folders.pop()!;
  const name = normaliseWords(fileName, { stripExtension: true });
  // Nearest folder first.
  const parents = [...folders].reverse().map((part) => ({ name: part, words: normaliseWords(part) }));
  const hint = folderFromParents(folders);

  const { targets: prepared, shared } = prepare(targets);
  const ranked = prepared
    .map((item) => scoreTarget(item, shared, name, parents))
    .filter((scored) => scored.score > 0)
    .map((scored) => (hint && scored.target.folder === hint.folder ? { ...scored, score: scored.score + FOLDER_AGREES_BONUS } : scored))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const runnerUp = ranked[1];
  let confidence = best ? 1 - Math.exp(-best.score / SCORE_SCALE) : 0;
  const ambiguous = !!(best && runnerUp && runnerUp.score >= best.score * 0.85);
  if (ambiguous) confidence *= 0.8;
  confidence = Math.round(Math.min(confidence, 0.97) * 100) / 100;

  if (!best || confidence < MIN_SUGGEST_CONFIDENCE) {
    const fromName = folderForWords(name);
    const reason = hint
      ? `no requested document matched; folder "${hint.from}" suggests ${hint.folder}`
      : fromName
        ? `no requested document matched; file name suggests ${fromName}`
        : "no requested document matched";
    return { itemId: null, folder: hint?.folder ?? fromName ?? fallbackFolder, confidence: 0, reason, skip: false };
  }

  const strong = confidence >= HANDOVER_AUTO_ATTACH_CONFIDENCE;
  const folder = strong ? best.target.folder : (hint?.folder ?? best.target.folder);
  let reason = describe(best.hits[0]!);
  if (best.hits[0]!.folder === null && hint && hint.folder === best.target.folder) reason += ` (folder "${hint.from}")`;
  if (!strong) reason = `possible match: ${reason}`;
  if (ambiguous) reason += `; could also be "${runnerUp!.target.title}"`;
  return { itemId: best.target.id, folder, confidence, reason, skip: false };
}
