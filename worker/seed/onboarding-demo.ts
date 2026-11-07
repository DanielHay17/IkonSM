// Onboarding demo data: the SAMPLE management company and outgoing manager directories (seeded into the
// Chief of Staff), and the two demo onboarding projects loaded by POST /api/demo/load:
// - SP 87192 Kewdale, "SP87192 – Pilot onboarding": nine days in, with an active handover link and SAMPLE
//   .txt documents uploaded through the real portal path (filing, matching, indexing), some verified.
// - SP 82719 Rivervale, "SP82719 – Onboarding": a fresh draft with one draft invitation.
// Everything here is SAMPLE data (example.com addresses, 08 5550 numbers reserved for fiction).
// POST /api/demo/clear removes demo projects only; a building's real project is never touched.

import { getAgentByName } from "agents";
import type { ManagementCompany, OutgoingManagerContact, TemplateHandoverItem, VaultFolderName } from "../../shared/onboarding";
import type { DemoProgress, DemoStart } from "../agents/onboarding";
import { deleteVaultObject, fileHandoverDocument } from "../docs/filing";
import { ONBOARDING_TEMPLATE } from "./onboarding-template";
import { PORTFOLIO_IDS } from "./portfolio";

// ===========================================================================
// Directories (SAMPLE)
// ===========================================================================

export const DIRECTORY_COMPANIES: Omit<ManagementCompany, "sample" | "createdAt">[] = [
  {
    id: "co-sample-strata",
    name: "Sample Strata Co Pty Ltd",
    abn: null,
    phone: "08 5550 0110",
    email: "records@samplestrata.example.com",
    website: "https://samplestrata.example.com",
    address: "Level 2, 100 Sample Street, Perth WA 6000",
    notes: "SAMPLE company for the onboarding demo.",
  },
  {
    id: "co-example-strata",
    name: "Example Strata Management Pty Ltd",
    abn: null,
    phone: "08 5550 0120",
    email: "admin@examplestrata.example.com",
    website: "https://examplestrata.example.com",
    address: "12 Placeholder Road, Fremantle WA 6160",
    notes: "SAMPLE company for the onboarding demo.",
  },
  {
    id: "co-placeholder-property",
    name: "Placeholder Property Group Pty Ltd",
    abn: null,
    phone: "08 5550 0130",
    email: "strata@placeholderproperty.example.com",
    website: null,
    address: "5 Example Lane, Joondalup WA 6027",
    notes: "SAMPLE company for the onboarding demo.",
  },
];

export const DIRECTORY_MANAGERS: Omit<OutgoingManagerContact, "sample" | "createdAt">[] = [
  { id: "om-sam-outgoing", companyId: "co-sample-strata", name: "Sam Outgoing", email: "sam.outgoing@samplestrata.example.com", phone: "08 5550 0111" },
  { id: "om-robin-sample", companyId: "co-sample-strata", name: "Robin Sample", email: "robin.sample@samplestrata.example.com", phone: "08 5550 0112" },
  { id: "om-jo-handover", companyId: "co-example-strata", name: "Jo Handover", email: "jo.handover@examplestrata.example.com", phone: "08 5550 0121" },
  { id: "om-kim-placeholder", companyId: "co-placeholder-property", name: "Kim Placeholder", email: "kim.placeholder@placeholderproperty.example.com", phone: "08 5550 0131" },
];

function manager(id: string) {
  const m = DIRECTORY_MANAGERS.find((x) => x.id === id)!;
  const company = DIRECTORY_COMPANIES.find((c) => c.id === m.companyId)!;
  return { company: company.name, name: m.name, email: m.email, phone: m.phone };
}

// ===========================================================================
// The two demo projects
// ===========================================================================

export const DEMO_PILOT_ID = "sp-87192";
export const DEMO_FRESH_ID = "sp-82719";

const PILOT_START: DemoStart = {
  name: "SP87192 – Pilot onboarding",
  createdBy: "Peter King",
  preparedBy: "Mia Example",
  targetGoLiveInDays: 20,
  invite: { incomingManagerId: "tom-placeholder", outgoingManager: manager("om-sam-outgoing"), handoverInDays: 12, recordsDueInDays: 5 },
  activate: true,
};

const FRESH_START: DemoStart = {
  name: "SP82719 – Onboarding",
  createdBy: "Peter King",
  preparedBy: "Mia Example",
  targetGoLiveInDays: 45,
  invite: { incomingManagerId: "tom-placeholder", outgoingManager: manager("om-jo-handover"), handoverInDays: 30, recordsDueInDays: 21 },
  activate: false,
};

const NOMINAL_ITEMS = 30;
const REJECT_NOTE = "This copy is out of date (it covers 2024–25). Please upload the current version.";
const NOT_APPLICABLE_NOTE = "Not held for this scheme (SAMPLE).";

/**
 * Which requested documents the pilot shows in which state: with the full checklist (30 items) 9 verified,
 * 5 awaiting verification, 1 needing replacement and 1 not applicable; scaled down for a shorter checklist,
 * always leaving at least one awaiting supply. The first optional item is the "not applicable" one.
 */
export function demoHandoverPlan(items: readonly TemplateHandoverItem[]) {
  const notApplicable = items.find((i) => !i.required) ?? null;
  const rest = items.filter((i) => i !== notApplicable);
  const scale = (n: number) => (items.length >= NOMINAL_ITEMS ? n : Math.max(1, Math.round((n * items.length) / NOMINAL_ITEMS)));
  const counts = [scale(9), scale(5), scale(1)];
  // Trim the smallest states first so a short checklist keeps something verified and something outstanding.
  for (let i = counts.length - 1; counts.reduce((a, b) => a + b, 0) > rest.length - 1 && i >= 0; ) {
    if (counts[i]! > 0) counts[i]!--;
    else i--;
  }
  const [verified, awaiting, rejected] = counts as [number, number, number];
  return {
    verified: rest.slice(0, verified),
    awaiting: rest.slice(verified, verified + awaiting),
    rejected: rest.slice(verified + awaiting, verified + awaiting + rejected),
    notApplicable: notApplicable ? [notApplicable] : [],
  };
}

const PILOT_PROGRESS: Omit<DemoProgress, "verify" | "reject" | "notApplicable"> = {
  tasks: {
    outgoing_manager: { done: 5, of: 8 },
    stratafy: { done: 6, of: 17 },
    xero: { done: 3, of: 3 },
    appointment: { done: 12, of: 17 },
    finance_compliance: {
      done: 4,
      excluded: 1,
      of: 13,
      excludePattern: "\\bbas\\b|\\bgst\\b|business activity",
      excludedNote: "The strata company is not registered for GST (turnover under the threshold), so there is no BAS to lodge (SAMPLE).",
    },
    facilities_site: { done: 3, of: 12 },
    readiness_closeout: { done: 0, of: 6 },
    communications: { done: 2, of: 6 },
  },
  reviews: { xero: "priya-sample" },
  checks: { done: 14, of: 56 },
  visits: 3,
  lastVisitHoursAgo: 2,
  createdDaysAgo: 9,
};

// ===========================================================================
// SAMPLE documents (small .txt files named like the real thing)
// ===========================================================================

const FOLDER_SAMPLES: Record<VaultFolderName, string[]> = {
  "01 Plan & By-laws": [
    "Registered with Landgate. The strata company is governed by the Schedule 1 governance by-laws and the Schedule 2 conduct by-laws under the Strata Titles Act 1985 (WA), with one additional conduct by-law (keeping of pets) registered in 2019.",
    "Unit entitlements are as shown on the registered plan.",
  ],
  "02 Insurance": [
    "Insurer: Sample Mutual Insurance Ltd (SAMPLE). Policy number: SMP-0000-0000.",
    "Building sum insured: $12,400,000. Public liability: $20,000,000. Office bearers' liability: $1,000,000.",
    "Period of cover: 30 June 2026 to 30 June 2027 (4 pm). Insured: The Owners of Strata Plan 87192.",
  ],
  "03 Meetings": [
    "Annual general meeting held 14 March 2026. Quorum present. Council of three elected.",
    "Resolutions: budget adopted for the administrative fund and the reserve fund; contributions to be levied quarterly; ten-year plan noted.",
  ],
  "04 Financials & Levies": [
    "Administrative fund balance at 31 October 2026: $18,450.00. Reserve fund balance: $96,210.00.",
    "Contributions in arrears: two lots, $1,284.00 in total (SAMPLE).",
    "Funds are held in the outgoing manager's trust account for the strata company and are to be transferred to Ikon's new trust accounts for the scheme at handover. Confirm the account details by phone before any transfer.",
    "GST: the strata company is not registered for GST, so no BAS is lodged.",
  ],
  "05 Maintenance & Contractors": [
    "Current contractors: Sample Gardens (monthly garden maintenance), Example Fire Services (six-monthly fire equipment inspection), Placeholder Cleaning (fortnightly common property clean).",
    "Open maintenance: stairwell repaint quoted, awaiting council approval.",
  ],
  "06 Compliance & Safety": [
    "Fire equipment inspected 2 September 2026 (AS 1851); next inspection due March 2027.",
    "Asbestos register: no asbestos-containing material recorded. Pool: none.",
  ],
  "07 Correspondence": [
    "Open correspondence: Lot 4 owner's query about a balcony leak (awaiting a plumber's report); council request for repainting quotes.",
  ],
  "08 Sales & Disclosure": [
    "Section 110 certificates issued in the last 12 months: Lot 6 (May 2026) and Lot 11 (August 2026). No disputes recorded.",
  ],
};

const SP = "87192";
const SUPPLIER = "Sam Outgoing, Sample Strata Co Pty Ltd";

function sampleName(title: string): string {
  const clean = title.replace(/[\\/:*?"<>|#%]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
  return `SP${SP} ${clean} (SAMPLE).txt`;
}

function sampleText(title: string, detail: string, folder: VaultFolderName, extra: string[] = []): string {
  return [
    "SAMPLE DOCUMENT: demonstration data for the IKON SM Command Hub. Not a real record.",
    "",
    `Strata Plan ${SP}, 160 Wright Street, Kewdale WA 6105`,
    `Document: ${title}`,
    `Supplied by: ${SUPPLIER} (outgoing strata manager)`,
    `Filed in: ${folder}`,
    "",
    detail,
    "",
    ...FOLDER_SAMPLES[folder],
    ...extra,
    "",
  ].join("\n");
}

interface DemoFile {
  name: string;
  folder: VaultFolderName;
  /** The item's key, or null for an extra file. */
  itemKey: string | null;
  text: string;
}

function pilotFiles(plan: ReturnType<typeof demoHandoverPlan>): DemoFile[] {
  const forItem = (item: TemplateHandoverItem, extra: string[] = []): DemoFile => ({
    name: sampleName(item.title),
    folder: item.folder,
    itemKey: item.key,
    text: sampleText(item.title, item.detail, item.folder, extra),
  });
  return [
    ...plan.verified.map((i) => forItem(i)),
    ...plan.awaiting.map((i) => forItem(i)),
    ...plan.rejected.map((i) => forItem(i, ["", "Note: this copy covers the 2024–25 year."])),
    {
      name: sampleName("Garden maintenance schedule 2026"),
      folder: "05 Maintenance & Contractors",
      itemKey: null,
      text: sampleText("Garden maintenance schedule 2026", "Monthly visits by Sample Gardens: mowing, pruning and reticulation checks.", "05 Maintenance & Contractors"),
    },
    {
      name: sampleName("Owner correspondence 2025"),
      folder: "07 Correspondence",
      itemKey: null,
      text: sampleText("Owner correspondence 2025", "Letters and emails exchanged with owners during 2025, in date order.", "07 Correspondence"),
    },
  ];
}

// ===========================================================================
// Loading and clearing
// ===========================================================================

export interface OnboardingDemoResult {
  propertyId: string;
  project: string | null;
  /** Why the building was left alone (it has a real project of its own). */
  skipped: string | null;
  files: number;
}

/** Replaces the demo projects (idempotent). `baseUrl` is the hub's public origin, for the handover link. */
export async function loadOnboardingDemo(env: Env, actor: string, baseUrl: string): Promise<OnboardingDemoResult[]> {
  return [await loadPilot(env, actor, baseUrl), await loadFresh(env, actor, baseUrl)];
}

async function loadPilot(env: Env, actor: string, baseUrl: string): Promise<OnboardingDemoResult> {
  const agent = await getAgentByName(env.PropertyAgent, DEMO_PILOT_ID);
  const started = await agent.startOnboardingDemo(PILOT_START, actor, baseUrl);
  if (!started.ok) throw new Error(`Could not start the demo onboarding at ${DEMO_PILOT_ID}: ${started.error}`);
  await Promise.all(started.value.r2Keys.map((key) => deleteVaultObject(env, key)));
  if (started.value.skipped || !started.value.token) return { propertyId: DEMO_PILOT_ID, project: null, skipped: started.value.skipped, files: 0 };

  const token = started.value.token;
  const detail = await agent.getOnboarding();
  const idByKey = new Map((detail?.handoverItems ?? []).map((i) => [i.key, i.id]));
  const plan = demoHandoverPlan(ONBOARDING_TEMPLATE.handoverItems);
  let files = 0;
  // Through the portal's own path: the token is checked, the file is stored in R2, indexed as an untrusted
  // handover upload and attached to its item, exactly as when the outgoing manager uploads it.
  for (const file of pilotFiles(plan)) {
    const result = await fileHandoverDocument(env, DEMO_PILOT_ID, agent, token, {
      name: file.name,
      mimeType: "text/plain",
      bytes: new TextEncoder().encode(file.text),
      folder: file.folder,
      itemId: file.itemKey ? (idByKey.get(file.itemKey) ?? "none") : "none",
      sourcePath: `SP${SP} Handover/${file.folder}/${file.name}`,
    });
    if (!result.ok) throw new Error(`Could not upload the demo file "${file.name}": ${result.error}`);
    files++;
  }
  const finished = await agent.finishOnboardingDemo(
    {
      ...PILOT_PROGRESS,
      verify: plan.verified.map((i) => i.key),
      reject: plan.rejected.map((i) => ({ key: i.key, note: REJECT_NOTE })),
      notApplicable: plan.notApplicable.map((i) => ({ key: i.key, note: NOT_APPLICABLE_NOTE })),
    },
    actor,
  );
  if (!finished.ok) throw new Error(`Could not finish the demo onboarding at ${DEMO_PILOT_ID}: ${finished.error}`);
  return { propertyId: DEMO_PILOT_ID, project: PILOT_START.name, skipped: null, files };
}

async function loadFresh(env: Env, actor: string, baseUrl: string): Promise<OnboardingDemoResult> {
  const agent = await getAgentByName(env.PropertyAgent, DEMO_FRESH_ID);
  const started = await agent.startOnboardingDemo(FRESH_START, actor, baseUrl);
  if (!started.ok) throw new Error(`Could not start the demo onboarding at ${DEMO_FRESH_ID}: ${started.error}`);
  await Promise.all(started.value.r2Keys.map((key) => deleteVaultObject(env, key)));
  return { propertyId: DEMO_FRESH_ID, project: started.value.skipped ? null : FRESH_START.name, skipped: started.value.skipped, files: 0 };
}

/** Removes every building's demo project with its uploads, invitations and letters. Real projects stay. */
export async function clearOnboardingDemo(env: Env, actor: string): Promise<{ propertyId: string; files: number }[]> {
  const results = await Promise.all(
    PORTFOLIO_IDS.map(async (id) => {
      const cleared = await (await getAgentByName(env.PropertyAgent, id)).clearOnboardingDemo(actor);
      await Promise.all(cleared.r2Keys.filter((key) => key.startsWith(`${id}/`)).map((key) => deleteVaultObject(env, key)));
      return { propertyId: id, removed: cleared.removed, files: cleared.r2Keys.length };
    }),
  );
  return results.filter((r) => r.removed).map(({ propertyId, files }) => ({ propertyId, files }));
}
