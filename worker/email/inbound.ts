// Parses raw inbound email (RFC 5322 / MIME) into the hub's InboundInput shape.
// Everything in an inbound email is untrusted data: this module only extracts it, it never acts on it.

import PostalMime from "postal-mime";
import type { Address, Attachment, Email, Mailbox } from "postal-mime";
import { isAutoReplyEmail } from "agents/email";
import type { InboundInput } from "../../shared/types";

const MAX_TEXT_CHARS = 50_000;
const MAX_HTML_INPUT_CHARS = 2_000_000;
const MAX_ATTACHMENT_NAME_CHARS = 200;

export interface InboundAttachmentFile {
  name: string;
  mimeType: string;
  content: Uint8Array;
}

export interface ParsedInbound {
  input: InboundInput;
  attachments: InboundAttachmentFile[];
  isAutoReply: boolean;
}

/** The domain of an address ("Jane <jane@Mail.Example.com>" → "mail.example.com"), or "". */
function domainOf(address: string): string {
  const bare = address.trim().toLowerCase().replace(/^.*<([^<>]+)>.*$/, "$1").replace(/^<|>$/g, "");
  return bare.includes("@") ? (bare.split("@").pop() ?? "") : "";
}

/** Relaxed DMARC-style alignment: the same domain, or one a subdomain of the other. */
function aligned(a: string, b: string): boolean {
  return !!a && !!b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));
}

/**
 * Whether the From address is backed by the receiving server's checks. Cloudflare Email Routing adds
 * Authentication-Results (and ARC-Authentication-Results): DMARC pass, DKIM pass for the From domain, or SPF
 * pass for an aligned envelope sender verifies it. Without those headers the From domain must at least
 * match the envelope sender's (MAIL FROM) domain. The From header alone is trivially forged.
 */
function senderVerified(email: Email, fromAddress: string, envelopeFrom: string): boolean {
  const fromDomain = domainOf(fromAddress);
  const envelopeDomain = domainOf(envelopeFrom);
  const results = email.headers
    .filter((h) => h.key === "authentication-results" || h.key === "arc-authentication-results")
    .map((h) => h.value.toLowerCase());
  if (results.length === 0) return aligned(fromDomain, envelopeDomain);
  for (const result of results) {
    if (/\bdmarc=pass\b/.test(result)) return true;
    for (const dkim of result.matchAll(/\bdkim=pass\b[^;]*?\bheader\.[di]=@?([a-z0-9.-]+)/g)) {
      if (aligned(dkim[1] ?? "", fromDomain)) return true;
    }
    if (/\bspf=pass\b/.test(result) && aligned(envelopeDomain, fromDomain)) return true;
  }
  return false;
}

/**
 * Parses a raw email. `envelope` is the SMTP envelope (MAIL FROM / RCPT TO) and is used as the
 * sender when the From header is missing or unusable. Throws only if the MIME cannot be parsed.
 */
export async function parseInbound(
  raw: Uint8Array | ReadableStream | ArrayBuffer,
  envelope: { from: string; to: string },
): Promise<ParsedInbound> {
  const email = await PostalMime.parse(raw);
  const sender = senderOf(email, envelope.from);
  const attachments = attachmentFiles(email.attachments);

  const input: InboundInput = {
    channel: "email",
    fromName: sender.name,
    fromAddress: sender.address,
    subject: oneLine(email.subject ?? ""),
    text: bodyText(email),
    messageId: headerValue(email.messageId),
    inReplyTo: headerValue(email.inReplyTo),
    references: headerValue(email.references),
    attachments: attachments.map((a) => ({ name: a.name, docId: null })),
    senderVerified: senderVerified(email, sender.address, envelope.from),
  };
  return { input, attachments, isAutoReply: isAutomated(email, envelope.from) };
}

// ---------------------------------------------------------------------------
// Sender, body, headers
// ---------------------------------------------------------------------------

function senderOf(email: Email, envelopeFrom: string): { name: string | null; address: string } {
  const mailbox = firstMailbox(email.from) ?? firstMailbox(email.sender);
  if (mailbox && isPlausibleAddress(mailbox.address)) {
    return { name: oneLine(mailbox.name) || null, address: mailbox.address.trim().toLowerCase() };
  }
  const fallback = envelopeFrom.trim().replace(/^<|>$/g, "").toLowerCase();
  return { name: mailbox ? oneLine(mailbox.name) || null : null, address: fallback || "unknown-sender" };
}

function firstMailbox(address: Address | undefined): Mailbox | null {
  if (!address) return null;
  if (address.group) return address.group.find((m) => m.address) ?? null;
  return address.address ? address : null;
}

function isPlausibleAddress(address: string | undefined): address is string {
  return typeof address === "string" && /^[^\s@<>]+@[^\s@<>]+$/.test(address.trim());
}

/** Plain-text body: the text part (postal-mime renders it from HTML when absent), else our own HTML conversion. */
function bodyText(email: Email): string {
  const text = email.text?.trim() ? email.text : email.html ? htmlToText(email.html) : "";
  return text.replace(/\r\n?/g, "\n").trim().slice(0, MAX_TEXT_CHARS);
}

function headerValue(value: string | undefined): string | null {
  const clean = value ? oneLine(value) : "";
  return clean || null;
}

function oneLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * Auto-replies (RFC 3834 Auto-Submitted, Precedence bulk/junk/list, X-Auto-Response-Suppress, via
 * agents' isAutoReplyEmail), plus delivery reports and other machine-generated mail that must
 * never get a reply.
 */
function isAutomated(email: Email, envelopeFrom: string): boolean {
  if (isAutoReplyEmail(email.headers)) return true;
  const returnPath = envelopeFrom.trim().replace(/^<|>$/g, "").toLowerCase();
  if (!returnPath || /^(mailer-daemon|postmaster)@/.test(returnPath)) return true;
  return email.headers.some(
    (h) =>
      h.key === "x-autoreply" ||
      h.key === "x-autorespond" ||
      (h.key === "content-type" && h.value.toLowerCase().startsWith("multipart/report")),
  );
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/** Real attachments only: inline images referenced from the HTML (logos, signatures) are skipped. */
function attachmentFiles(attachments: Attachment[]): InboundAttachmentFile[] {
  const files: InboundAttachmentFile[] = [];
  for (const attachment of attachments) {
    if (attachment.related) continue;
    const content = attachmentBytes(attachment);
    if (content.byteLength === 0) continue;
    const mimeType = (attachment.mimeType || "application/octet-stream").toLowerCase();
    files.push({ name: attachmentName(attachment.filename, files.length + 1, mimeType), mimeType, content });
  }
  return files;
}

function attachmentBytes(attachment: Attachment): Uint8Array {
  const { content } = attachment;
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (attachment.encoding === "base64") return Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
  return new TextEncoder().encode(content);
}

function attachmentName(filename: string | null, position: number, mimeType: string): string {
  const clean = (filename ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .split(/[/\\]/)
    .pop()!
    .trim()
    .slice(0, MAX_ATTACHMENT_NAME_CHARS);
  if (clean && clean !== "." && clean !== "..") return clean;
  return `attachment-${position}${FALLBACK_EXTENSIONS[mimeType] ?? ""}`;
}

const FALLBACK_EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/msword": ".doc",
  "text/plain": ".txt",
  "text/html": ".html",
  "text/csv": ".csv",
  "text/calendar": ".ics",
  "message/rfc822": ".eml",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/heic": ".heic",
};

// ---------------------------------------------------------------------------
// HTML → plain text (also used by docs/extract)
// ---------------------------------------------------------------------------

/** Elements whose content is never visible text; skipped up to their closing tag. */
const SKIPPED_ELEMENTS = new Set(["script", "style", "title", "template", "noscript", "xml", "svg", "object"]);
/** Of those, the ones a browser treats as running to the end of the document when unclosed. */
const RAW_TEXT_ELEMENTS = new Set(["script", "style"]);
const BLOCK_ELEMENTS = new Set([
  "address", "article", "aside", "blockquote", "center", "dd", "div", "dl", "dt", "fieldset",
  "figcaption", "figure", "footer", "form", "header", "main", "nav", "ol", "pre", "section", "table", "ul",
]);
const PARAGRAPH_ELEMENTS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6"]);

/**
 * Converts an HTML document or fragment to readable plain text: drops scripts, styles and comments,
 * turns block elements into line breaks, list items into "- " bullets and table cells into tabs,
 * appends http(s) link targets in brackets, and decodes entities. Linear in the input size, so
 * hostile markup cannot make it slow.
 */
export function htmlToText(html: string): string {
  const source = typeof html === "string" ? html.slice(0, MAX_HTML_INPUT_CHARS) : "";
  const out = new TextBuffer();
  const links: OpenLink[] = [];
  const unclosed = new Set<string>();
  let i = 0;

  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt === -1) {
      out.text(collapseSpaces(source.slice(i)));
      break;
    }
    out.text(collapseSpaces(source.slice(i, lt)));

    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (!/[a-zA-Z/!?]/.test(source.charAt(lt + 1))) {
      out.text("<");
      i = lt + 1;
      continue;
    }
    const gt = source.indexOf(">", lt + 1);
    if (gt === -1) break; // an unterminated tag at the end is not text
    const tag = source.slice(lt + 1, gt);
    i = gt + 1;

    const parsed = /^(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(tag);
    if (!parsed) continue; // <!DOCTYPE>, <?xml?> and similar
    const closing = parsed[1] === "/";
    const name = parsed[2].toLowerCase();

    if (!closing && !tag.endsWith("/") && SKIPPED_ELEMENTS.has(name)) {
      i = skipElement(source, i, name, unclosed);
    } else if (name === "a") {
      handleLink(tag, closing, out, links);
    } else {
      renderTag(name, closing, out);
    }
  }

  return tidyText(decodeHtmlEntities(out.toString()));
}

/** Accumulates text, merging adjacent block breaks the way a browser collapses margins. */
class TextBuffer {
  private readonly parts: string[] = [];
  private pendingBreaks = 0;

  text(value: string): void {
    if (!value) return;
    if (this.pendingBreaks > 0) {
      if (!value.trim()) return; // whitespace between blocks
      this.parts.push("\n".repeat(this.pendingBreaks));
      this.pendingBreaks = 0;
    }
    this.parts.push(value);
  }

  /** At least `count` line breaks before the next text (1 = new line, 2 = blank line). */
  block(count: 1 | 2): void {
    this.pendingBreaks = Math.max(this.pendingBreaks, count);
  }

  /** A forced <br>: adds to any pending break, up to one blank line. */
  lineBreak(): void {
    this.pendingBreaks = Math.min(this.pendingBreaks + 1, 2);
  }

  get mark(): number {
    return this.parts.length;
  }

  since(mark: number): string {
    return this.parts.slice(mark).join("");
  }

  toString(): string {
    return this.parts.join("");
  }
}

/**
 * Index just past the closing tag of `name`, searching from `from`. `unclosed` remembers elements
 * with no closing tag left in the document, so repeated unclosed tags cost one scan in total.
 */
function skipElement(source: string, from: number, name: string, unclosed: Set<string>): number {
  if (!unclosed.has(name)) {
    const close = new RegExp(`</${name}\\s*>`, "gi");
    close.lastIndex = from;
    const match = close.exec(source);
    if (match) return match.index + match[0].length;
    unclosed.add(name);
  }
  return RAW_TEXT_ELEMENTS.has(name) ? source.length : from;
}

type OpenLink = { href: string; start: number };
/** Only this many nested links get their target appended, which keeps label lookups linear. */
const MAX_TRACKED_LINKS = 20;

/** Link text is kept; an http(s) target is appended in brackets unless the text already shows it. */
function handleLink(tag: string, closing: boolean, out: TextBuffer, links: OpenLink[]): void {
  if (!closing) {
    const href = links.length < MAX_TRACKED_LINKS ? /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag) : null;
    const url = decodeHtmlEntities(href?.[1] ?? href?.[2] ?? href?.[3] ?? "").trim();
    links.push({ href: /^https?:\/\//i.test(url) ? url : "", start: out.mark });
    return;
  }
  const link = links.pop();
  if (!link?.href) return;
  const label = out.since(link.start).trim();
  if (label && !label.includes(link.href)) out.text(` (${link.href})`);
}

function renderTag(name: string, closing: boolean, out: TextBuffer): void {
  if (name === "br") {
    out.lineBreak();
  } else if (name === "hr") {
    out.block(1);
    out.text("---");
    out.block(1);
  } else if (name === "li") {
    out.block(1);
    if (!closing) out.text("- ");
  } else if (name === "td" || name === "th") {
    if (closing) out.text("\t");
  } else if (name === "tr") {
    out.block(1);
  } else if (PARAGRAPH_ELEMENTS.has(name)) {
    out.block(closing ? 2 : 1);
  } else if (BLOCK_ELEMENTS.has(name)) {
    out.block(1);
  }
}

/** HTML treats any run of whitespace (including source newlines) as a single space. */
function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, " ");
}

/** Trims every line, removes invisible characters and keeps at most one blank line in a row. */
function tidyText(text: string): string {
  return text
    .replace(/[­​-‍⁠﻿]/g, "")
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, (run) => (run.includes("\t") ? "\t" : " ")).trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", sbquo: "‚",
  ldquo: "“", rdquo: "”", bdquo: "„", bull: "•", middot: "·", laquo: "«",
  raquo: "»", copy: "©", reg: "®", trade: "™", deg: "°", times: "×",
  divide: "÷", plusmn: "±", frac12: "½", frac14: "¼", frac34: "¾",
  euro: "€", pound: "£", cent: "¢", yen: "¥", sect: "§", para: "¶",
  dagger: "†", larr: "←", rarr: "→", uarr: "↑", darr: "↓", check: "✓",
  shy: "­", zwj: "‍", zwnj: "‌", eacute: "é", egrave: "è", aacute: "á",
  agrave: "à", ouml: "ö", uuml: "ü", auml: "ä", ccedil: "ç", ntilde: "ñ",
};

/** Decodes named (common subset), decimal and hex character references. Unknown names are kept as-is. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (entity, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
      return valid ? String.fromCodePoint(code) : "�";
    }
    return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}
