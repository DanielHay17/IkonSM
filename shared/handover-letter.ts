// The handover request letter Ikon sends the outgoing strata manager, in the style of Peter King's own
// letter: an introduction, the schedule of documents to provide, the transfer arrangements and the funds
// transfer (with a phone-verification warning). The plain text is the approved email body; it is written
// so shared/email-html.ts renders it well: run-in capital headings ("FUNDS TRANSFER: ...") come out bold,
// each folder's documents become a numbered list, the arrangements become bulleted lists with bold
// labels, and it ends with the standard "Kind regards," and signature line.

import type { TemplateHandoverItem, VaultFolderName } from "./onboarding";
import { VAULT_FOLDERS } from "./types";

export interface HandoverLetterInput {
  companyName: string;
  building: { spNumber: string; street: string; suburb: string; postcode: string | null };
  outgoingManager: { name: string; company: string };
  incomingManager: { name: string; title: string; email: string };
  handoverDate: string;
  recordsDueDate: string;
  /** The secure portal link (absolute URL). */
  portalUrl: string;
  linkExpiresAt: string;
  items: Pick<TemplateHandoverItem, "title" | "detail" | "folder" | "required">[];
  folders: readonly VaultFolderName[];
}

export interface HandoverLetter {
  subject: string;
  /** Plain-text email body ending with "Kind regards,\n<signature line>" (see shared/email-html.ts). */
  text: string;
}

/** The portal's per-file limit, quoted in the letter (matches MAX_UPLOAD_BYTES in worker/docs/filing.ts). */
export const HANDOVER_LETTER_MAX_FILE_MB = 25;

// ===========================================================================
// Dates
// ===========================================================================

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Perth is UTC+8 all year (no daylight saving). */
const PERTH_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Australian long form, e.g. "21 November 2026". Takes a calendar date ("2026-11-21", used as is) or a
 * timestamp ("2026-12-06T03:00:00.000Z", shown as the date in Perth). Anything unreadable is returned
 * unchanged.
 */
export function formatLongDate(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return "";
  const calendar = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  let year: number;
  let month: number;
  let day: number;
  if (calendar) {
    year = Number(calendar[1]);
    month = Number(calendar[2]);
    day = Number(calendar[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return text;
  } else {
    const time = Date.parse(text);
    if (Number.isNaN(time)) return text;
    const perth = new Date(time + PERTH_OFFSET_MS);
    year = perth.getUTCFullYear();
    month = perth.getUTCMonth() + 1;
    day = perth.getUTCDate();
  }
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

// ===========================================================================
// The schedule of documents
// ===========================================================================

export type HandoverScheduleItem = Pick<TemplateHandoverItem, "title" | "detail" | "folder" | "required">;

export interface HandoverScheduleGroup {
  folder: VaultFolderName;
  items: HandoverScheduleItem[];
  /** How many of the group's items are required. */
  required: number;
}

/**
 * The requested documents grouped by Master File Structure folder, in `folders` order (empty folders left
 * out; items in a folder not listed come last). Used by the letter and the staff UI's letter preview.
 */
export function handoverSchedule(items: readonly HandoverScheduleItem[], folders: readonly VaultFolderName[] = VAULT_FOLDERS): HandoverScheduleGroup[] {
  const order = [...folders];
  for (const item of items) if (!order.includes(item.folder)) order.push(item.folder);
  return order
    .map((folder) => {
      const inFolder = items.filter((item) => item.folder === folder);
      return { folder, items: inFolder, required: inFolder.filter((item) => item.required).length };
    })
    .filter((group) => group.items.length > 0);
}

/**
 * The schedule as plain text: each folder's name on its own line, then its documents numbered from 1 with
 * a (required) or (optional) marker, folders separated by a blank line. In shared/email-html.ts each
 * folder renders as a paragraph followed by a numbered list.
 */
export function renderHandoverSchedule(
  items: readonly HandoverScheduleItem[],
  folders: readonly VaultFolderName[] = VAULT_FOLDERS,
  options: { details?: boolean } = {},
): string {
  const details = options.details ?? true;
  return handoverSchedule(items, folders)
    .map((group) =>
      [
        group.folder,
        ...group.items.map((item, i) => {
          const line = `${i + 1}. ${oneLine(item.title)} (${item.required ? "required" : "optional"})`;
          return details && item.detail.trim() ? `${line}: ${oneLine(item.detail)}` : line;
        }),
      ].join("\n"),
    )
    .join("\n\n");
}

/** Line breaks inside a title or detail would break the list in the email. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// ===========================================================================
// The letter
// ===========================================================================

export function renderHandoverLetter(input: HandoverLetterInput): HandoverLetter {
  const { building, companyName, incomingManager: incoming, outgoingManager: outgoing } = input;
  const sp = `SP ${building.spNumber}`;
  const address = `${building.street}, ${building.suburb} WA${building.postcode ? ` ${building.postcode}` : ""}`;
  const handoverDate = formatLongDate(input.handoverDate);
  const dueDate = formatLongDate(input.recordsDueDate);
  const expires = formatLongDate(input.linkExpiresAt);
  const total = input.items.length;
  const required = input.items.filter((item) => item.required).length;

  const subject = `Strata management handover: ${sp}, ${building.street}, ${building.suburb}`;

  const schedule = total
    ? [
        `SCHEDULE OF DOCUMENTS: The schedule below lists ${total} ${total === 1 ? "document" : "documents"} (${required} required), grouped by the folder of our Master File Structure each will be filed in. If a required document does not exist for this scheme, please mark it "Not applicable" in the portal with a short note rather than leaving it out.`,
        renderHandoverSchedule(input.items, input.folders),
      ]
    : [`SCHEDULE OF DOCUMENTS: Please provide all of the strata company's records, including its plan and by-laws, insurance, meeting minutes, financial records, contracts, compliance records, correspondence and sales records.`];

  const blocks = [
    `Dear ${outgoing.name},`,
    `STRATA MANAGEMENT HANDOVER: ${sp}, ${address}`,
    `We are pleased to introduce ${companyName}. The strata company for ${sp} has appointed ${companyName} as its strata manager from ${handoverDate}, taking over from ${outgoing.company}. ${incoming.name}, ${incoming.title}, will be the incoming manager for the scheme and your contact for the handover.`,
    `To make the change as smooth as possible for the owners and the council, please provide the strata company's records listed below by ${dueDate}, and transfer the strata company's funds as set out under Funds transfer.`,
    ...schedule,
    [
      `TRANSFER ARRANGEMENTS: Please upload the records through our secure handover portal:`,
      input.portalUrl,
      `The link is for you and your team only and expires on ${expires}. Please do not forward it.`,
    ].join("\n"),
    [
      `- SharePoint or OneDrive: select the scheme's folder, choose Download to get a single zip file, and drop the zip onto the portal page. The zip is opened in your browser and nothing is uploaded until you confirm.`,
      `- Folders and files: you can also drag whole folders or individual files onto the page. Each file is matched to the schedule and filed in the right folder, and you can change any match before uploading.`,
      `- Large handovers: each file can be up to ${HANDOVER_LETTER_MAX_FILE_MB} MB, and you can return to the link as often as you need until it expires.`,
      `- Original documents: original paper records, the common seal (if any), keys, fobs and remotes are to be handed over by arrangement with ${incoming.name}.`,
      `- When you are done: please upload everything by ${dueDate} and press "Submit handover pack". The link stays open for late documents until it expires.`,
    ].join("\n"),
    `FUNDS TRANSFER: Please transfer the balances of the strata company's administrative fund and reserve fund to the strata company's new trust accounts with ${companyName} at the handover date, once we have confirmed the account details with you by phone.`,
    [
      `- Account details by phone: ${incoming.name} will phone you with the account names, BSBs and account numbers. We will never ask you to pay into an account given only by email, so please do not act on bank details received by email, even if they appear to come from us. If in doubt, call ${companyName} on a number you have checked independently, not one taken from an email.`,
      `- Final reconciliation: please send the final reconciliation of each fund at the handover date with the transfer, together with the closing bank statements and the levy register showing each lot's balance.`,
      `- Confirmation: please email us a remittance advice when the funds are sent, and we will confirm by phone when they arrive.`,
    ].join("\n"),
    `Thank you for your help with the handover. If you have any questions, please contact ${incoming.name} at ${incoming.email}.`,
    `Kind regards,\n${incoming.name} | ${companyName}, on behalf of the strata company for ${sp}`,
  ];

  return { subject, text: blocks.join("\n\n") };
}
