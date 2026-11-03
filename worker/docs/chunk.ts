// Splits document text into overlapping chunks for the FTS5 index, and turns free-text
// questions into safe FTS5 MATCH expressions.

const DEFAULT_SIZE = 1200;
const DEFAULT_OVERLAP = 150;
const MIN_SIZE = 100;
/** A chunk may end early (at no less than this fraction of `size`) to land on a natural boundary. */
const MIN_FILL = 0.5;
/** Preferred chunk boundaries, best first. Each is kept with the chunk it ends. */
const BOUNDARIES = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " "];

const MAX_QUERY_INPUT_CHARS = 2000;
const MAX_QUERY_TERMS = 12;
const MAX_QUERY_PHRASES = 4;
const MAX_TERM_CHARS = 64;

/**
 * Deterministic chunking: about `size` characters per chunk (default 1200) with `overlap`
 * characters (default 150) repeated at the start of the next chunk. Chunks end on a paragraph
 * break when there is one in the second half of the window, else a line break, sentence end or
 * space. Never returns empty chunks; returns [] for blank text.
 */
export function chunkText(text: string, opts: { size?: number; overlap?: number } = {}): string[] {
  const size = Math.max(MIN_SIZE, Math.floor(finiteOr(opts.size, DEFAULT_SIZE)));
  const overlap = Math.min(Math.max(0, Math.floor(finiteOr(opts.overlap, DEFAULT_OVERLAP))), Math.floor(size / 3));
  const source = normalise(text);
  if (!source) return [];
  if (source.length <= size) return [source];

  const chunks: string[] = [];
  let start = 0;
  while (start < source.length) {
    const windowEnd = Math.min(start + size, source.length);
    const end = windowEnd < source.length ? boundaryBefore(source, start, windowEnd, size) : windowEnd;
    const chunk = source.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= source.length) break;
    start = overlapStart(source, start, end, overlap);
  }
  return chunks;
}

/** End index for a chunk starting at `start`: the best natural boundary in the window, else a hard cut. */
function boundaryBefore(text: string, start: number, windowEnd: number, size: number): number {
  const earliest = start + Math.floor(size * MIN_FILL);
  for (const boundary of BOUNDARIES) {
    const at = text.lastIndexOf(boundary, windowEnd - boundary.length);
    if (at >= earliest) return at + boundary.length;
  }
  return windowEnd;
}

/** Start of the next chunk: `overlap` characters back from `end`, moved forward to a word start. */
function overlapStart(text: string, start: number, end: number, overlap: number): number {
  if (overlap === 0) return end;
  let next = Math.max(end - overlap, start + 1);
  if (!/\s/.test(text.charAt(next - 1))) {
    const space = text.slice(next, end).search(/\s/);
    next = space === -1 ? end : next + space + 1;
  }
  return Math.min(next, end);
}

function normalise(text: string): string {
  if (typeof text !== "string") return "";
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// ---------------------------------------------------------------------------
// FTS5 query sanitising
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "a", "about", "after", "again", "all", "also", "am", "an", "and", "any", "are", "as", "at", "be",
  "because", "been", "before", "being", "between", "both", "but", "by", "can", "could", "did", "do",
  "does", "doing", "dont", "down", "during", "each", "etc", "few", "for", "from", "further", "get",
  "got", "had", "has", "have", "having", "he", "her", "here", "hers", "him", "his", "hi", "hello",
  "how", "i", "if", "im", "in", "into", "is", "it", "its", "just", "let", "me", "more", "most", "my",
  "no", "nor", "not", "now", "of", "off", "on", "once", "only", "or", "other", "our", "ours", "out",
  "over", "own", "please", "same", "she", "should", "so", "some", "such", "than", "thank", "thanks",
  "that", "the", "their", "theirs", "them", "then", "there", "these", "they", "this", "those",
  "through", "to", "too", "under", "until", "up", "us", "very", "was", "we", "were", "what", "when",
  "where", "which", "while", "who", "whom", "why", "will", "with", "would", "yes", "you", "your",
  "yours", "might", "must", "shall", "tell", "know", "find",
  // contraction fragments left after splitting on apostrophes ("don't" → "don", "t")
  "don", "doesn", "didn", "isn", "aren", "wasn", "weren", "won", "wouldn", "couldn", "shouldn", "ve", "ll", "re",
]);

/**
 * Turns arbitrary user text into an FTS5 MATCH expression: lower-cased letter/number terms,
 * stopwords and one-character tokens dropped, de-duplicated, at most 12, each quoted as a
 * prefix query and OR'd: `"burst"* OR "pipe"*`. Adjacent terms (no stopword between them) are also
 * added first as exact phrases, at most 4, so a passage with the phrase outranks one that merely
 * repeats a word: "Where is the water main?" → `"water main" OR "water"* OR "main"*`.
 * Returns null when nothing usable remains. Terms contain only letters, marks and digits, so the
 * result can never be an FTS5 syntax error.
 */
export function ftsQuery(userQuery: string): string | null {
  if (typeof userQuery !== "string") return null;
  const terms: string[] = [];
  const phrases: string[] = [];
  let previous: string | null = null;
  const tokens = userQuery.slice(0, MAX_QUERY_INPUT_CHARS).normalize("NFC").toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u);
  for (const token of tokens) {
    const term = token.slice(0, MAX_TERM_CHARS);
    if (term.length < 2 || STOPWORDS.has(term)) {
      if (token) previous = null;
      continue;
    }
    if (previous && previous !== term && phrases.length < MAX_QUERY_PHRASES) {
      const phrase = `${previous} ${term}`;
      if (!phrases.includes(phrase)) phrases.push(phrase);
    }
    previous = term;
    if (!terms.includes(term)) terms.push(term);
    if (terms.length === MAX_QUERY_TERMS) break;
  }
  if (terms.length === 0) return null;
  return [...phrases.map((phrase) => `"${phrase}"`), ...terms.map((term) => `"${term}"*`)].join(" OR ");
}
