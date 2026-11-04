// R2 key naming and MIME detection for the document vault.

const MAX_NAME_CHARS = 120;
const MAX_FOLDER_CHARS = 80;
const GENERIC_MIME_TYPES = new Set([
  "application/octet-stream",
  "binary/octet-stream",
  "application/binary",
  "application/x-download",
  "application/force-download",
  "application/unknown",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  docm: "application/vnd.ms-word.document.macroenabled.12",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  rtf: "application/rtf",
  txt: "text/plain",
  text: "text/plain",
  log: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
  htm: "text/html",
  ics: "text/calendar",
  eml: "message/rfc822",
  msg: "application/vnd.ms-outlook",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  zip: "application/zip",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

/** `${propertyId}/${folder}/${uuid8}-${safeName}`: unique per upload, safe to use as an R2 key. */
export function r2KeyFor(propertyId: string, folder: string, filename: string): string {
  const id = crypto.randomUUID().slice(0, 8);
  return `${keySegment(propertyId, 40, "unknown")}/${keySegment(folder, MAX_FOLDER_CHARS, "Unfiled")}/${id}-${safeFileName(filename)}`;
}

/**
 * The provided MIME type unless it is missing or generic (application/octet-stream and friends),
 * otherwise a guess from the file extension. Always returns a lower-case type without parameters.
 */
export function guessMime(filename: string, provided?: string | null): string {
  const given = (provided ?? "").split(";", 1)[0].trim().toLowerCase();
  if (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(given) && !GENERIC_MIME_TYPES.has(given)) return given;
  return MIME_BY_EXTENSION[extensionOf(filename)] ?? "application/octet-stream";
}

/** The name shown on the Files tab: the original file name without any path or control characters. */
export function displayFileName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? "";
  const clean = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.slice(0, 200) || "upload";
}

/** Lower-case extension without the dot, or "" when there is none. */
export function extensionOf(filename: string): string {
  const base = (filename ?? "").split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** A readable file name without path separators, control or URL-hostile characters, extension kept. */
function safeFileName(filename: string): string {
  const base = (filename ?? "").split(/[/\\]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[:*?"<>|#%{}^~[\]`]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  if (!cleaned) return "file";
  if (cleaned.length <= MAX_NAME_CHARS) return cleaned;
  const ext = extensionOf(cleaned);
  const keepExt = ext && ext.length <= 10 ? `.${ext}` : "";
  return cleaned.slice(0, MAX_NAME_CHARS - keepExt.length).trimEnd() + keepExt;
}

/** One path segment: no separators, no "." / ".." traversal, bounded length. */
function keySegment(value: string, max: number, fallback: string): string {
  const segment = (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[/\\]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  return segment && segment !== "." && segment !== ".." ? segment : fallback;
}
