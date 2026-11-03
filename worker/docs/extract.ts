// Extracts searchable plain text from uploaded files and email attachments.
// Supports PDF (unpdf), DOCX (fflate + word/document.xml), HTML, plain-text formats and .eml.
// Never throws: failures come back as { text: null, error }.

import { strFromU8, unzipSync } from "fflate";
import PostalMime from "postal-mime";
import { decodeHtmlEntities, htmlToText } from "../email/inbound";
import { extensionOf } from "./vault";

export type ExtractMethod = "pdf" | "docx" | "text" | "html" | "none";
export interface ExtractResult {
  text: string | null;
  method: ExtractMethod;
  error: string | null;
}

const MAX_TEXT_CHARS = 400_000;
/** Raw text is cut to this before cleaning so whitespace normalising stays cheap. */
const MAX_RAW_CHARS = 1_000_000;
const MAX_PDF_PAGES = 1000;
const PDF_TIMEOUT_MS = 25_000;
const PDF_MAX_IMAGE_PIXELS = 16_777_216;
const MAX_DOCX_XML_BYTES = 30 * 1024 * 1024;

const PDF_TYPES = new Set(["application/pdf", "application/x-pdf"]);
const DOCX_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  "application/vnd.ms-word.document.macroenabled.12",
]);
const DOCX_EXTENSIONS = new Set(["docx", "docm", "dotx", "dotm"]);
const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const HTML_EXTENSIONS = new Set(["html", "htm", "xhtml"]);
const EMAIL_TYPES = new Set(["message/rfc822"]);
const TEXT_TYPES = new Set([
  "application/json", "application/ld+json", "application/x-ndjson", "application/xml",
  "application/csv", "application/yaml", "application/x-yaml", "message/rfc822",
]);
const TEXT_EXTENSIONS = new Set(["txt", "text", "md", "markdown", "csv", "tsv", "json", "xml", "log", "yaml", "yml", "ics", "eml"]);
/** text/* types that are markup or binary-ish rather than readable text. */
const NON_TEXT_TEXT_TYPES = new Set(["text/rtf"]);

export async function extractText(bytes: Uint8Array, mimeType: string, filename: string): Promise<ExtractResult> {
  let method: ExtractMethod = "none";
  try {
    if (!bytes?.byteLength) return { text: null, method, error: null };
    method = detectMethod(bytes, mimeType, filename);
    if (method === "none") return { text: null, method, error: null };
    const raw = await EXTRACTORS[method](bytes, baseType(mimeType), extensionOf(filename));
    return { text: finalise(raw), method, error: null };
  } catch (err) {
    return { text: null, method, error: describeError(err) };
  }
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

function detectMethod(bytes: Uint8Array, mimeType: string, filename: string): ExtractMethod {
  const type = baseType(mimeType);
  const ext = extensionOf(filename);
  if (startsWith(bytes, "%PDF-") || PDF_TYPES.has(type) || ext === "pdf") return "pdf";
  if (DOCX_TYPES.has(type) || DOCX_EXTENSIONS.has(ext)) return "docx";
  if (HTML_TYPES.has(type) || HTML_EXTENSIONS.has(ext)) return "html";
  if (isTextType(type) || TEXT_EXTENSIONS.has(ext)) return "text";
  return "none";
}

function isTextType(type: string): boolean {
  return (type.startsWith("text/") && !NON_TEXT_TEXT_TYPES.has(type)) || TEXT_TYPES.has(type);
}

function baseType(mimeType: string): string {
  return (mimeType ?? "").split(";", 1)[0].trim().toLowerCase();
}

function startsWith(bytes: Uint8Array, signature: string): boolean {
  if (bytes.byteLength < signature.length) return false;
  for (let i = 0; i < signature.length; i++) if (bytes[i] !== signature.charCodeAt(i)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Extractors
// ---------------------------------------------------------------------------

type Extractor = (bytes: Uint8Array, type: string, ext: string) => Promise<string>;

const EXTRACTORS: Record<Exclude<ExtractMethod, "none">, Extractor> = {
  pdf: (bytes) => withTimeout(extractPdf(bytes), PDF_TIMEOUT_MS, "PDF text extraction timed out"),
  docx: async (bytes) => extractDocx(bytes),
  html: async (bytes) => htmlToText(decodeText(bytes)),
  text: async (bytes, type, ext) => (EMAIL_TYPES.has(type) || ext === "eml" ? extractEmail(bytes) : readableText(bytes)),
};

/** pdf.js (unpdf's serverless build) is loaded on first use so it does not slow every agent start. */
async function extractPdf(bytes: Uint8Array): Promise<string> {
  const { extractText: extractPdfText, getDocumentProxy } = await import("unpdf");
  // pdf.js may detach the buffer it is given; hand it a copy so the caller's bytes stay usable.
  const pdf = await getDocumentProxy(bytes.slice(), { verbosity: 0, maxImageSize: PDF_MAX_IMAGE_PIXELS });
  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(`PDF has ${pdf.numPages} pages; only documents up to ${MAX_PDF_PAGES} pages are indexed`);
    }
    const { text } = await extractPdfText(pdf, { mergePages: true });
    return text;
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}

/** Paragraph text of word/document.xml. Deleted revisions and field codes are left out. */
function extractDocx(bytes: Uint8Array): string {
  let oversized = false;
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (file.name !== "word/document.xml") return false;
      oversized = file.originalSize > MAX_DOCX_XML_BYTES;
      return !oversized;
    },
  });
  if (oversized) throw new Error("Word document is too large to index");
  const xml = files["word/document.xml"];
  if (!xml) throw new Error("Not a Word document (word/document.xml is missing)");
  return wordXmlToText(strFromU8(xml));
}

/**
 * Word text lives in <w:t> runs; whitespace between elements is not content. Deleted revisions
 * (<w:delText>) and field codes (<w:instrText>) are not <w:t>, so they are left out. Tab stops in
 * paragraph properties carry attributes, unlike the bare <w:tab/> run element matched here.
 * Every alternative starts at "<" and cannot cross another tag, so matching stays linear.
 */
const WORD_TOKEN = /<w:t(?:\s[^<>]*)?>([^<]*)<\/w:t>|<w:(tab|noBreakHyphen)\/>|<w:(?:br|cr)\b[^<>]*\/>|<\/w:(p|tc|tr)>/g;

function wordXmlToText(xml: string): string {
  const parts: string[] = [];
  for (const [, text, inline, close] of xml.matchAll(WORD_TOKEN)) {
    if (text !== undefined) parts.push(text);
    else if (inline) parts.push(inline === "tab" ? "\t" : "-");
    else parts.push(close === "tc" ? "\t" : "\n");
  }
  // A table cell ends its last paragraph and then the cell: keep cells of a row on one line.
  return decodeHtmlEntities(parts.join("").replace(/\n\t/g, "\t"));
}

async function extractEmail(bytes: Uint8Array): Promise<string> {
  const email = await PostalMime.parse(bytes);
  const from = email.from?.address ? `${email.from.name ? `${email.from.name} ` : ""}<${email.from.address}>` : null;
  const header = [
    email.subject ? `Subject: ${email.subject}` : null,
    from ? `From: ${from}` : null,
    email.date ? `Date: ${email.date}` : null,
  ].filter(Boolean);
  const body = email.text?.trim() ? email.text : email.html ? htmlToText(email.html) : "";
  return [header.join("\n"), body].filter(Boolean).join("\n\n");
}

function readableText(bytes: Uint8Array): string {
  const text = decodeText(bytes);
  if (looksBinary(text)) throw new Error("File content is not readable text");
  return text;
}

/** UTF-8 (BOM stripped) unless a UTF-16 byte-order mark says otherwise. */
function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decodeUtf16(bytes.subarray(2), true);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16(bytes.subarray(2), false);
  return new TextDecoder("utf-8").decode(bytes);
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const units = new Uint16Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < units.length; i++) units[i] = view.getUint16(i * 2, littleEndian);
  const parts: string[] = [];
  for (let i = 0; i < units.length; i += 8192) parts.push(String.fromCharCode(...units.subarray(i, i + 8192)));
  return parts.join("");
}

/** Several NUL bytes, or a high share of invalid UTF-8, in the first 8 KB mean the "text" is really binary. */
function looksBinary(text: string): boolean {
  const sample = text.slice(0, 8192);
  let nul = 0;
  let invalid = 0;
  for (const char of sample) {
    if (char === "\u0000") nul++;
    else if (char === "\ufffd") invalid++;
  }
  return (nul >= 4 && nul / sample.length > 0.01) || invalid / Math.max(sample.length, 1) > 0.1;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalises line endings and whitespace, drops control characters, caps length; null when blank. */
function finalise(raw: string): string | null {
  const text = raw
    .slice(0, MAX_RAW_CHARS)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text ? text.slice(0, MAX_TEXT_CHARS) : null;
}

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function describeError(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "PasswordException") return "PDF is password-protected";
  if (name === "InvalidPDFException") return "Not a valid PDF file";
  const message = err instanceof Error ? err.message : String(err);
  return message.slice(0, 500) || "Text extraction failed";
}
