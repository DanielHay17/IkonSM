// The handover request letter Ikon sends the outgoing strata manager (in the style of Peter's own letter:
// introduction, the schedule of documents, transfer arrangements, funds transfer). Rendered as plain text
// (the approved email body) and branded HTML. STUB: the content agent replaces this; keep the signatures.

import type { TemplateHandoverItem, VaultFolderName } from "./onboarding";

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

export function renderHandoverLetter(input: HandoverLetterInput): HandoverLetter {
  const subject = `Strata management handover: SP ${input.building.spNumber}, ${input.building.street}, ${input.building.suburb}`;
  const text = [
    `Dear ${input.outgoingManager.name},`,
    "",
    `${input.companyName} has been appointed to manage SP ${input.building.spNumber} from ${input.handoverDate}. Please upload the strata company's records by ${input.recordsDueDate} using this secure link: ${input.portalUrl}`,
    "",
    "Kind regards,",
    `${input.incomingManager.name} | ${input.companyName}`,
  ].join("\n");
  return { subject, text };
}
