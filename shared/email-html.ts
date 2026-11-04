// Branded HTML version of an approved email, sent alongside the plain-text body (the text stays the
// source of truth: staff edit and approve the text, and this renders it). Used by the Worker when sending
// and by the hub's "Preview email", so the preview is exactly what the recipient gets.
// Email-client rules: table layout, inline styles, no scripts, no web fonts, images optional.

export interface EmailHtmlInput {
  subject: string;
  /** The approved plain-text body, including the "Kind regards," sign-off. */
  body: string;
  companyName: string;
  property: { spNumber: string; street: string; suburb: string; postcode?: string | null };
  fromAddress: string;
  /** Absolute URL of the white (reversed) logo; null shows a text wordmark. */
  logoUrl: string | null;
  websiteUrl?: string;
}

const INK = "#292929";
const TAUPE = "#848079";
const LINE = "#d2d4d5";
const CANVAS = "#f5f5f5";
const FONT = "Poppins, 'Segoe UI', Helvetica, Arial, sans-serif";
const WEBSITE = "https://www.ikonsm.com.au";

const SIGN_OFF = /\n\n((?:kind|warm|best) regards|regards|many thanks|sincerely),?\n([^\n]+)\s*$/i;
const NUMBERED = /^(\d{1,2})[.)]\s+(.*)$/;
const BULLET = /^[-*•]\s+(.*)$/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Escapes, then links email addresses. */
function inline(text: string): string {
  return escapeHtml(text).replace(EMAIL, (address) => `<a href="mailto:${address}" style="color:${INK};">${address}</a>`);
}

/** A short leading label ("Insurance:", "Safety first:") reads as a heading in the paragraph. */
function labelled(line: string): string {
  const match = line.match(/^([A-Z][A-Za-z ]{2,30}):\s+(.*)$/);
  return match ? `<strong>${escapeHtml(match[1]!)}:</strong> ${inline(match[2]!)}` : inline(line);
}

const P = `margin:0 0 16px;`;
const LIST = `margin:0 0 16px;padding-left:22px;`;
const LI = `margin:0 0 6px;`;

/** One blank-line-separated block: paragraphs with line breaks, and numbered or bulleted lists. */
function blockHtml(block: string): string {
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  // Held in an object so the flush helpers can reset it (TypeScript doesn't track closure writes to a let).
  const open: { paragraph: string[]; list: { kind: "ol" | "ul"; items: string[] } | null } = { paragraph: [], list: null };
  const flushParagraph = () => {
    if (open.paragraph.length) out.push(`<p style="${P}">${open.paragraph.join("<br>")}</p>`);
    open.paragraph = [];
  };
  const flushList = () => {
    const list = open.list;
    if (list) out.push(`<${list.kind} style="${LIST}">${list.items.map((item) => `<li style="${LI}">${item}</li>`).join("")}</${list.kind}>`);
    open.list = null;
  };
  for (const line of lines) {
    const numbered = line.match(NUMBERED);
    const bullet = numbered ? null : line.match(BULLET);
    const kind = numbered ? "ol" : bullet ? "ul" : null;
    if (kind) {
      flushParagraph();
      if (open.list?.kind !== kind) flushList();
      open.list ??= { kind, items: [] };
      open.list.items.push(labelled((numbered ? numbered[2] : bullet![1])!));
    } else {
      flushList();
      open.paragraph.push(labelled(line));
    }
  }
  flushParagraph();
  flushList();
  return out.join("");
}

function signatureHtml(closing: string, line: string, input: EmailHtmlInput): string {
  // "Strata Management Team | Ikon Strata Management, on behalf of the strata company for SP 26707"
  const [team, rest] = line.includes(" | ") ? (line.split(" | ", 2) as [string, string]) : [line, ""];
  const behalf = rest.match(/,\s*(on behalf of .*)$/i)?.[1] ?? null;
  const company = behalf ? rest.slice(0, rest.length - behalf.length).replace(/,\s*$/, "") : rest || input.companyName;
  const { spNumber, street, suburb, postcode } = input.property;
  const address = `${street}, ${suburb} WA${postcode ? ` ${postcode}` : ""}`;
  const website = input.websiteUrl ?? WEBSITE;
  return [
    `<p style="margin:24px 0 4px;">${escapeHtml(closing)},</p>`,
    `<p style="margin:0;font-weight:600;">${escapeHtml(team)}</p>`,
    `<p style="margin:0;">${escapeHtml(company)}</p>`,
    `<p style="margin:0;color:${TAUPE};font-size:13px;">${behalf ? `${escapeHtml(behalf.charAt(0).toUpperCase() + behalf.slice(1))}, ` : `SP ${escapeHtml(spNumber)}, `}${escapeHtml(address)}</p>`,
    `<p style="margin:8px 0 0;font-size:13px;"><a href="mailto:${escapeHtml(input.fromAddress)}" style="color:${INK};">${escapeHtml(input.fromAddress)}</a>` +
      ` &nbsp;·&nbsp; <a href="${escapeHtml(website)}" style="color:${INK};">${escapeHtml(website.replace(/^https?:\/\/(www\.)?/, ""))}</a></p>`,
  ].join("");
}

function header(input: EmailHtmlInput): string {
  const wordmark = `<span style="font-family:${FONT};font-size:22px;font-weight:800;letter-spacing:0.04em;color:#ffffff;">IKON<span style="font-weight:300;">SM</span></span>`;
  const logo = input.logoUrl
    ? `<img src="${escapeHtml(input.logoUrl)}" width="150" alt="IKON SM Strata Management" style="display:block;border:0;outline:none;width:150px;height:auto;">`
    : wordmark;
  return `<td style="background:${INK};padding:22px 28px;">${logo}</td>`;
}

/** The full HTML document for an approved email. All text is escaped. */
export function renderEmailHtml(input: EmailHtmlInput): string {
  const text = input.body.replace(/\r\n?/g, "\n").trim();
  const signOff = text.match(SIGN_OFF);
  const main = signOff ? text.slice(0, signOff.index) : text;
  const blocks = main.split(/\n{2,}/).map(blockHtml).join("");
  const signature = signOff ? signatureHtml(signOff[1]!, signOff[2]!.trim(), input) : "";
  const preheader = escapeHtml(main.split("\n").find((l) => l.trim() && !/^(hi|hello|dear)\b/i.test(l.trim()))?.trim().slice(0, 140) ?? "");
  const { spNumber, street, suburb } = input.property;
  return `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${escapeHtml(input.subject)}</title></head>
<body style="margin:0;padding:0;background:${CANVAS};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CANVAS};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid ${LINE};">
<tr>${header(input)}</tr>
<tr><td style="padding:28px 28px 8px;font-family:${FONT};font-size:15px;line-height:1.6;color:${INK};">${blocks}${signature}</td></tr>
<tr><td style="padding:16px 28px 20px;border-top:1px solid #ececec;font-family:${FONT};font-size:12px;line-height:1.5;color:${TAUPE};">
${escapeHtml(input.companyName)} · Perth, Western Australia<br>
This email is about SP ${escapeHtml(spNumber)}, ${escapeHtml(street)}, ${escapeHtml(suburb)}. Reply to this email to reach the building's team.
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
