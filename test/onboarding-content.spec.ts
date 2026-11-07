// The onboarding content: the SAMPLE template (sections, tasks, handover documents, go-live checks), the
// matcher that files the outgoing manager's uploads against the requested documents, and the handover
// letter (plain text and its branded HTML rendering).

import { describe, expect, it } from "vitest";
import { renderEmailHtml } from "../shared/email-html";
import { HANDOVER_AUTO_ATTACH_CONFIDENCE, isJunkPath, matchHandoverFile, normaliseWords, suggestFolder } from "../shared/handover-match";
import { formatLongDate, handoverSchedule, renderHandoverLetter, renderHandoverSchedule, type HandoverLetterInput } from "../shared/handover-letter";
import { SECTION_KEYS, STAFF_DIRECTORY, STAFF_ROLE_LABELS, type HandoverMatchTarget, type StaffRole } from "../shared/onboarding";
import { VAULT_FOLDERS } from "../shared/types";
import { GO_LIVE_CHECK_GROUPS, ONBOARDING_TEMPLATE } from "../worker/seed/onboarding-template";

const T = ONBOARDING_TEMPLATE;
const ROLES = Object.keys(STAFF_ROLE_LABELS) as StaffRole[];
const allTasks = T.sections.flatMap((section) => section.tasks.map((task) => ({ ...task, section })));

/** WA strata terms only: these come from other states' legislation (or are simply wrong in WA). */
const NOT_WA = [/owners['’]? corporation/i, /sinking fund/i, /body corporate/i, /strata committee/i, /executive committee/i, /council of owners/i, /licensed strata manager/i, /\bs\.?\s?184\b/i];

function allTemplateText(): string[] {
  return [
    ...T.sections.flatMap((s) => [s.title, s.description, ...s.groups, ...s.tasks.flatMap((t) => [t.title, t.detail, t.group])]),
    ...T.handoverItems.flatMap((i) => [i.title, i.detail, ...i.keywords]),
    ...T.goLiveChecks.flatMap((c) => [c.title, c.group]),
  ];
}

// ===========================================================================
// Template
// ===========================================================================

describe("onboarding template", () => {
  it("is the SAMPLE version", () => {
    expect(T.version).toBe("2026-11-sample-1");
  });

  it("has the eight sections in the spec's order, with the spec's titles, descriptions and groups", () => {
    expect(T.sections.map((s) => s.key)).toEqual([...SECTION_KEYS]);
    expect(T.sections.map((s) => [s.title, s.description, s.groups])).toEqual([
      ["Outgoing manager", "Request, receive and verify the handover pack.", ["Document checklist & evidence", "Records transfer"]],
      ["Stratafy", "Prepare and configure the scheme in Stratafy.", ["Stratafy / Systems"]],
      ["Xero setup", "Customer, invoice and item-code setup.", ["Xero set up"]],
      ["Appointment & owners", "Authority to act, council and owner records, by-laws.", ["Appointment", "Council", "Owners", "By-laws"]],
      [
        "Finance & compliance",
        "Opening finances, insurance, taxation and statutory records.",
        ["Financial setup", "Insurance", "Tax & statutory returns", "Legal & compliance"],
      ],
      ["Facilities & site", "Site, utilities, access, contractors and services.", ["Property & site setup", "Utilities", "Keys & security", "Contractors & services"]],
      ["Readiness & closeout", "Quality review, operational readiness and final closeout.", ["Go-live checks", "Completion & quality assurance"]],
      [
        "Communications and introductions",
        "Owner welcome, app rollout, council and agent correspondence, contractor handover and registration.",
        ["Communications"],
      ],
    ]);
  });

  it("has exactly 82 tasks (8, 17, 3, 17, 13, 12, 6, 6), 30 handover items and 56 go-live checks", () => {
    expect(T.sections.map((s) => s.tasks.length)).toEqual([8, 17, 3, 17, 13, 12, 6, 6]);
    expect(allTasks).toHaveLength(82);
    expect(T.handoverItems).toHaveLength(30);
    expect(T.goLiveChecks).toHaveLength(56);
  });

  it("uses unique, stable keys everywhere", () => {
    const taskKeys = allTasks.map((t) => t.key);
    const itemKeys = T.handoverItems.map((i) => i.key);
    const checkKeys = T.goLiveChecks.map((c) => c.key);
    for (const keys of [taskKeys, itemKeys, checkKeys]) expect(new Set(keys).size).toBe(keys.length);
    const everything = [...taskKeys, ...itemKeys, ...checkKeys];
    expect(new Set(everything).size).toBe(everything.length);
    for (const key of everything) expect(key).toMatch(/^[a-z0-9_]+([.-][a-z0-9_]+)*$/);
    for (const task of allTasks) expect(task.key.startsWith(`${task.section.key}.`)).toBe(true);
    for (const key of checkKeys) expect(key.startsWith("golive.")).toBe(true);
  });

  it("puts every task in one of its section's groups, and every group has tasks", () => {
    for (const section of T.sections) {
      expect(new Set(section.groups).size).toBe(section.groups.length);
      for (const task of section.tasks) expect(section.groups).toContain(task.group);
      for (const group of section.groups) expect(section.tasks.some((t) => t.group === group)).toBe(true);
    }
  });

  it("gives every task and section a valid role that someone in the staff register holds", () => {
    const held = new Set(STAFF_DIRECTORY.map((s) => s.role));
    for (const section of T.sections) {
      expect(ROLES).toContain(section.defaultOwnerRole);
      expect(ROLES).toContain(section.defaultApproverRole);
      expect(held.has(section.defaultOwnerRole) && held.has(section.defaultApproverRole)).toBe(true);
    }
    for (const task of allTasks) expect(ROLES).toContain(task.role);
    // Every role does some of the work.
    for (const role of ROLES) expect(allTasks.some((t) => t.role === role)).toBe(true);
  });

  it("defines done for every task in one or two sentences", () => {
    for (const task of allTasks) {
      expect(task.title.trim()).toBe(task.title);
      expect(task.title).not.toMatch(/\.$/);
      expect(task.detail).toMatch(/^[A-Z0-9].*\.$/);
      expect(task.detail.length).toBeGreaterThan(40);
      expect(task.detail.split(/(?<=\.)\s+(?=[A-Z])/).length).toBeLessThanOrEqual(2);
    }
  });

  it("covers the handover and set-up steps from Peter's call", () => {
    const has = (pattern: RegExp) => allTasks.some((t) => pattern.test(`${t.title} ${t.detail}`));
    for (const pattern of [
      /handover letter/i, /secure (upload )?link/i, /records due date/i, /chase/i, /verify the handover pack/i, /reconcile the records transfer/i,
      /keys, fobs, remotes/i, /unit entitlement/i, /addresses for service/i, /levy\) schedule/i, /administrative and reserve fund budgets/i,
      /arrears/i, /fee schedule/i, /additional-work charges/i, /Amendment of Scheme Notice/, /resolution appointing Ikon/i, /by-laws/i,
      /trust accounts/i, /by phone/i, /GST/, /BAS/, /income tax/i, /SAT/, /AS 1851/, /Synergy/, /Water Corporation/, /lift/i,
      /owner app/i, /property managers/i, /contractor handover/i, /lessons learned/i,
    ]) {
      expect(has(pattern), String(pattern)).toBe(true);
    }
  });

  it("requests 30 documents across all eight folders, most of them required", () => {
    const folders = new Set(T.handoverItems.map((i) => i.folder));
    expect([...folders].sort()).toEqual([...VAULT_FOLDERS].sort());
    const required = T.handoverItems.filter((i) => i.required).length;
    expect(required).toBeGreaterThanOrEqual(24);
    expect(required).toBeLessThan(30);
    for (const item of T.handoverItems) {
      expect(VAULT_FOLDERS).toContain(item.folder);
      expect(item.title.length).toBeGreaterThan(5);
      expect(item.detail).toMatch(/^[A-Z0-9s].*\.$/);
    }
  });

  it("gives every handover item lower-case, distinct matching keywords", () => {
    for (const item of T.handoverItems) {
      expect(item.keywords.length, item.key).toBeGreaterThanOrEqual(4);
      expect(new Set(item.keywords).size).toBe(item.keywords.length);
      for (const keyword of item.keywords) {
        expect(keyword).toBe(keyword.toLowerCase());
        expect(keyword).toBe(keyword.trim());
        expect(keyword.length).toBeGreaterThan(1);
        expect(normaliseWords(keyword).length, `${item.key}: "${keyword}"`).toBeGreaterThan(0);
      }
    }
    // The short forms outgoing managers use in file names.
    const keywords = new Set(T.handoverItems.flatMap((i) => i.keywords));
    for (const form of ["coc", "certificate of currency", "agm minutes", "bank rec", "levy register", "afss", "s110", "bas", "strata roll"]) expect(keywords.has(form), form).toBe(true);
  });

  it("groups the go-live checks under the eight check groups", () => {
    const counts = Object.fromEntries(GO_LIVE_CHECK_GROUPS.map((g) => [g, T.goLiveChecks.filter((c) => c.group === g).length]));
    expect(counts).toEqual({ Records: 8, Stratafy: 8, Xero: 4, Finance: 10, Insurance: 6, Compliance: 8, Site: 6, Communications: 6 });
    for (const check of T.goLiveChecks) {
      expect(GO_LIVE_CHECK_GROUPS as readonly string[]).toContain(check.group);
      expect(check.title).not.toMatch(/\.$/);
      expect(check.title.length).toBeGreaterThan(15);
    }
  });

  it("uses WA strata terms only", () => {
    for (const text of allTemplateText()) for (const pattern of NOT_WA) expect(text, text).not.toMatch(pattern);
  });

  it("matches each requested document by its own title", () => {
    const targets = targetsFromTemplate();
    for (const item of T.handoverItems) {
      const match = matchHandoverFile(`${item.title}.pdf`, targets);
      expect(match.itemId, item.title).toBe(`item-${item.key}`);
      expect(match.confidence, item.title).toBeGreaterThanOrEqual(HANDOVER_AUTO_ATTACH_CONFIDENCE);
    }
  });
});

// ===========================================================================
// Matcher
// ===========================================================================

function targetsFromTemplate(): HandoverMatchTarget[] {
  return T.handoverItems.map((item) => ({ id: `item-${item.key}`, key: item.key, title: item.title, folder: item.folder, keywords: item.keywords }));
}

type Band = "high" | "medium" | "low";

function band(confidence: number): Band {
  return confidence >= 0.7 ? "high" : confidence >= 0.5 ? "medium" : "low";
}

describe("matchHandoverFile", () => {
  const targets = targetsFromTemplate();

  // [path, expected item key, expected folder, confidence band]
  const CASES: [string, string, string, Band][] = [
    ["SP87192 Handover/02 Insurance/CoC 2026-27.pdf", "certificate-of-currency", "02 Insurance", "high"],
    ["Financials/FY2025/Audited Financial Statements FY25.pdf", "financial-statements", "04 Financials & Levies", "high"],
    ["Minutes/AGM 2024 signed.docx", "general-meeting-minutes", "03 Meetings", "high"],
    ["SP87192 Handover/01 Plan & By-laws/Strata Plan 87192.pdf", "strata-plan", "01 Plan & By-laws", "high"],
    ["SP87192 Handover/01 Plan & By-laws/Consolidated By-Laws (registered 2021).pdf", "by-laws", "01 Plan & By-laws", "high"],
    ["Owners/Strata Roll SP87192 Oct 2026.xlsx", "strata-roll", "01 Plan & By-laws", "high"],
    ["Insurance/Policy Schedule CHU 2026.pdf", "insurance-schedule", "02 Insurance", "high"],
    ["Insurance/Valuations/Replacement Cost Valuation 2023.pdf", "insurance-valuation", "02 Insurance", "high"],
    ["Insurance/Claims/Claim 12345 water damage lot 4.pdf", "insurance-claims", "02 Insurance", "high"],
    ["Documents/Strata Plan 87192/Insurance/Certificate of Currency - CHU - 2026.pdf", "certificate-of-currency", "02 Insurance", "high"],
    ["CertificateOfCurrency.pdf", "certificate-of-currency", "02 Insurance", "high"],
    ["Meetings/Council/Council Meeting Minutes 14-03-2025.pdf", "council-minutes", "03 Meetings", "high"],
    ["Meetings/EGM 2025/EGM Minutes.pdf", "general-meeting-minutes", "03 Meetings", "high"],
    ["SP87192 Handover/03 Meetings/AGM/2025 AGM Notice and Agenda.pdf", "general-meeting-minutes", "03 Meetings", "high"],
    ["AGMMinutes2023.pdf", "general-meeting-minutes", "03 Meetings", "high"],
    ["Council/Council Contact List.xlsx", "council-members", "03 Meetings", "high"],
    ["Financials/Budgets/Admin Fund Budget 2026-27.pdf", "budgets", "04 Financials & Levies", "high"],
    ["Financials/Levy Register as at 31.10.2026.xlsx", "levy-register", "04 Financials & Levies", "high"],
    ["Levies/Levy Notices Q2.pdf", "levy-register", "04 Financials & Levies", "high"],
    ["Owner Ledgers.pdf", "levy-register", "04 Financials & Levies", "high"],
    ["Financials/Arrears Report Oct 2026.pdf", "arrears", "04 Financials & Levies", "high"],
    ["Banking/Trust Account Statement Sep 2026.pdf", "bank-statements", "04 Financials & Levies", "high"],
    ["Financials/Bank Rec 31 Oct 2026.pdf", "final-reconciliation", "04 Financials & Levies", "high"],
    ["Accounts/Trial Balance 31-10-2026.xlsx", "final-reconciliation", "04 Financials & Levies", "high"],
    ["Tax/BAS Q1 FY2026.pdf", "tax-records", "04 Financials & Levies", "high"],
    ["Finance/Audit/Audit Report FY2025.pdf", "financial-statements", "04 Financials & Levies", "high"],
    ["Contractors/Service Agreements/Cleaning Contract - Sparkle Cleaning.pdf", "contractors", "05 Maintenance & Contractors", "high"],
    ["Maintenance/Work Orders open.xlsx", "maintenance-records", "05 Maintenance & Contractors", "high"],
    ["Maintenance/10 Year Plan 2024-2034.pdf", "ten-year-plan", "05 Maintenance & Contractors", "high"],
    ["Reserve fund forecast.xlsx", "ten-year-plan", "05 Maintenance & Contractors", "high"],
    ["Keys and fobs register.xlsx", "keys-register", "05 Maintenance & Contractors", "high"],
    ["Compliance/Fire/AS1851 Annual Report 2026.pdf", "fire-services", "06 Compliance & Safety", "high"],
    ["Fire Safety/Fire Logbook.pdf", "fire-services", "06 Compliance & Safety", "high"],
    ["Compliance/Asbestos Register 2019.pdf", "asbestos-whs", "06 Compliance & Safety", "high"],
    ["Compliance/Pool Barrier Inspection Certificate.pdf", "other-compliance", "06 Compliance & Safety", "high"],
    ["Correspondence/2026/Letter to Lot 7 re noise.pdf", "correspondence", "07 Correspondence", "high"],
    ["General/Correspondence/Owners/Email re parking Lot 2.msg", "correspondence", "07 Correspondence", "high"],
    ["Legal/SAT Orders CC 123 of 2025.pdf", "legal-matters", "07 Correspondence", "high"],
    ["Sales/s110 Certificate Lot 3.pdf", "s110-certificates", "08 Sales & Disclosure", "high"],
    ["Section 110 cert - Lot 4.pdf", "s110-certificates", "08 Sales & Disclosure", "high"],
    ["Sales/Notice of change of ownership Lot 9.pdf", "ownership-tenancies", "08 Sales & Disclosure", "high"],
    ["Tenancies/Property managers list.xlsx", "ownership-tenancies", "08 Sales & Disclosure", "high"],
    // Folder-only and single-word evidence: a fair guess, not certain.
    ["OneDrive_1_15-10-2026/SP 87192 - 160 Wright St/Financial/Bank Statements/Admin Fund June 2026.pdf", "bank-statements", "04 Financials & Levies", "medium"],
    ["Plans/Strata Plan/SP87192.pdf", "strata-plan", "01 Plan & By-laws", "medium"],
    ["SAT/Application.pdf", "legal-matters", "07 Correspondence", "medium"],
    ["Synergy account 1234.pdf", "creditors", "04 Financials & Levies", "medium"],
    ["Warranty - Hot water system.pdf", "warranties-drawings", "05 Maintenance & Contractors", "medium"],
  ];

  it.each(CASES)("%s → %s", (path, key, folder, expected) => {
    const match = matchHandoverFile(path, targets);
    expect(match.skip).toBe(false);
    expect(match.itemId).toBe(`item-${key}`);
    expect(match.folder).toBe(folder);
    expect(band(match.confidence)).toBe(expected);
    expect(match.reason.length).toBeGreaterThan(5);
    expect(match.reason.length).toBeLessThan(140);
  });

  it("explains a clear match in plain words", () => {
    const match = matchHandoverFile("SP87192 Handover/02 Insurance/CoC 2026-27.pdf", targets);
    expect(match.reason).toBe('file name mentions "coc" (folder "02 Insurance")');
    expect(matchHandoverFile("Insurance/Policy Schedule CHU 2026.pdf", targets).reason).toContain('"policy schedule"');
  });

  it("keeps ambiguous names below the auto-attach line and says what else they could be", () => {
    const minutes = matchHandoverFile("Minutes 2024.pdf", targets);
    expect(minutes.confidence).toBeLessThan(HANDOVER_AUTO_ATTACH_CONFIDENCE);
    expect(minutes.reason).toMatch(/^possible match/);
    expect(minutes.reason).toMatch(/could also be/);
    const levyLetter = matchHandoverFile("Letter to owners re levy increase.pdf", targets);
    expect(levyLetter.confidence).toBeLessThan(HANDOVER_AUTO_ATTACH_CONFIDENCE);
  });

  it("suggests no item for unrelated files, filing them by their folder or the fallback", () => {
    const inInsurance = matchHandoverFile("SP87192 Handover/02 Insurance/Some random document.pdf", targets);
    expect(inInsurance).toMatchObject({ itemId: null, folder: "02 Insurance", confidence: 0, skip: false });
    expect(inInsurance.reason).toContain("02 Insurance");
    expect(matchHandoverFile("Insurance/2026.pdf", targets)).toMatchObject({ itemId: null, folder: "02 Insurance" });
    expect(matchHandoverFile("FY2025.pdf", targets)).toMatchObject({ itemId: null, folder: "04 Financials & Levies" });
    expect(matchHandoverFile("SP87192 Handover/Misc/Scan0001.pdf", targets)).toMatchObject({ itemId: null, folder: "07 Correspondence", confidence: 0 });
    expect(matchHandoverFile("IMG_2034.JPG", targets, "05 Maintenance & Contractors")).toMatchObject({ itemId: null, folder: "05 Maintenance & Contractors" });
    expect(matchHandoverFile("Handover Checklist.xlsx", targets).itemId).toBeNull();
  });

  it("skips system files, folder entries and empty names", () => {
    const junk = [
      "__MACOSX/Insurance/._CoC.pdf",
      "SP87192/__MACOSX/Minutes/AGM.pdf",
      "Insurance/.DS_Store",
      "Thumbs.db",
      "Meetings/desktop.ini",
      "Financials/~$Budget.xlsx",
      "Minutes/.~lock.AGM 2024.docx#",
      "Downloads/Strata plan.pdf.crdownload",
      "Correspondence/~WRL0001.tmp",
      "SP87192 Handover/Insurance/",
      "",
      "   ",
      "Folder/Icon\r",
    ];
    for (const path of junk) {
      expect(isJunkPath(path), JSON.stringify(path)).toBe(true);
      const match = matchHandoverFile(path, targets);
      expect(match).toMatchObject({ skip: true, itemId: null, confidence: 0 });
    }
    expect(matchHandoverFile("SP87192 Handover/Insurance/", targets).reason).toBe("folder, not a file");
    for (const path of ["Insurance/CoC.pdf", "Thumbs up from council.pdf", "Minutes/AGM 2024.docx", "temp/Strata roll.xlsx", "Icon.png"]) {
      expect(isJunkPath(path), path).toBe(false);
    }
  });

  it("returns a 0..1 confidence and the same answer every time", () => {
    for (const [path] of CASES) {
      const first = matchHandoverFile(path, targets);
      expect(first.confidence).toBeGreaterThanOrEqual(0);
      expect(first.confidence).toBeLessThanOrEqual(1);
      expect(matchHandoverFile(path, [...targets])).toEqual(first);
    }
  });

  it("uses the title when an item has no keywords", () => {
    const bare = [{ id: "x", key: "x", title: "Lift maintenance logbook", folder: "05 Maintenance & Contractors" as const, keywords: [] }];
    expect(matchHandoverFile("Plant/Lift Maintenance Logbook.pdf", bare)).toMatchObject({ itemId: "x", folder: "05 Maintenance & Contractors" });
    expect(matchHandoverFile("anything.pdf", []).itemId).toBeNull();
  });

  it("normalises separators, case, abbreviations, years and plurals", () => {
    expect(normaliseWords("Audited_Financial-Statements.FY2024-25.pdf", { stripExtension: true })).toEqual(["audited", "financial", "statement", "fy"]);
    expect(normaliseWords("S.110 Certs")).toEqual(["s110", "certificate"]);
    expect(normaliseWords("By-Laws & Bylaws")).toEqual(["bylaw", "bylaw"]);
    expect(normaliseWords("Bank Rec 30-06-2026")).toEqual(["bank", "reconciliation"]);
    expect(normaliseWords("AS 1851 Levies")).toEqual(["as1851", "levy"]);
    expect(normaliseWords("CoC SP87192")).toEqual(["coc"]);
  });
});

describe("suggestFolder", () => {
  it("maps the outgoing manager's folder names to the Master File Structure", () => {
    const cases: [string, string | null][] = [
      ["SP87192 Handover/02 Insurance/anything.pdf", "02 Insurance"],
      ["Plan & By-laws/x.pdf", "01 Plan & By-laws"],
      ["Minutes/x.pdf", "03 Meetings"],
      ["Meetings/2024/x.pdf", "03 Meetings"],
      ["Financials/x.pdf", "04 Financials & Levies"],
      ["Levies/x.pdf", "04 Financials & Levies"],
      ["Bank/x.pdf", "04 Financials & Levies"],
      ["Accounts/FY2025/x.pdf", "04 Financials & Levies"],
      ["Maintenance/x.pdf", "05 Maintenance & Contractors"],
      ["Contractors/x.pdf", "05 Maintenance & Contractors"],
      ["Compliance/x.pdf", "06 Compliance & Safety"],
      ["Fire Safety/x.pdf", "06 Compliance & Safety"],
      ["Asbestos/x.pdf", "06 Compliance & Safety"],
      ["Correspondence/x.pdf", "07 Correspondence"],
      ["Letters/x.pdf", "07 Correspondence"],
      ["Legal/x.pdf", "07 Correspondence"],
      ["Sales/x.pdf", "08 Sales & Disclosure"],
      ["Disclosure/x.pdf", "08 Sales & Disclosure"],
      ["s110 certificates/x.pdf", "08 Sales & Disclosure"],
      ["By-laws/x.pdf", "01 Plan & By-laws"],
      ["Insurance Claims 2024/x.pdf", "02 Insurance"],
      // Deepest folder wins; then the file name; else nothing.
      ["Financials/Insurance/x.pdf", "02 Insurance"],
      ["Misc/Fire report.pdf", "06 Compliance & Safety"],
      ["Misc/Scan0001.pdf", null],
    ];
    for (const [path, folder] of cases) expect(suggestFolder(path), path).toBe(folder);
  });
});

// ===========================================================================
// Handover letter
// ===========================================================================

const BUILDING = { spNumber: "87192", street: "160 Wright Street", suburb: "Kewdale", postcode: "6105" };
const PORTAL_URL = "https://hub.ikon.test/handover/87192-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";

function letterInput(overrides: Partial<HandoverLetterInput> = {}): HandoverLetterInput {
  return {
    companyName: "Ikon Strata Management",
    building: BUILDING,
    outgoingManager: { name: "Sam Outgoing", company: "Sample Strata Co Pty Ltd" },
    incomingManager: { name: "Tom Placeholder", title: "Strata Manager", email: "tom.placeholder@example.com" },
    handoverDate: "2026-11-19",
    recordsDueDate: "2026-11-12",
    portalUrl: PORTAL_URL,
    linkExpiresAt: "2026-12-05T20:00:00.000Z",
    items: T.handoverItems,
    folders: VAULT_FOLDERS,
    ...overrides,
  };
}

describe("renderHandoverLetter", () => {
  const letter = renderHandoverLetter(letterInput());

  it("is addressed to the outgoing manager about the scheme", () => {
    expect(letter.subject).toBe("Strata management handover: SP 87192, 160 Wright Street, Kewdale");
    expect(letter.text.startsWith("Dear Sam Outgoing,\n\nSTRATA MANAGEMENT HANDOVER: SP 87192, 160 Wright Street, Kewdale WA 6105\n\n")).toBe(true);
    expect(letter.text).toContain("We are pleased to introduce Ikon Strata Management");
    expect(letter.text).toContain("taking over from Sample Strata Co Pty Ltd");
    expect(letter.text).toContain("Tom Placeholder, Strata Manager, will be the incoming manager");
  });

  it("gives the dates in Australian long form and the secure link with its expiry", () => {
    expect(letter.text).toContain("as its strata manager from 19 November 2026");
    expect(letter.text).toContain("listed below by 12 November 2026");
    expect(letter.text).toContain(`\n${PORTAL_URL}\n`);
    // 20:00 UTC on 5 December is 6 December in Perth.
    expect(letter.text).toContain("expires on 6 December 2026");
    expect(letter.text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("schedules every document by folder, numbered, with required and optional markers", () => {
    for (const item of T.handoverItems) {
      expect(letter.text).toContain(`${item.title} (${item.required ? "required" : "optional"}): ${item.detail}`);
    }
    const positions = VAULT_FOLDERS.map((folder) => letter.text.indexOf(`\n\n${folder}\n1. `));
    for (const position of positions) expect(position).toBeGreaterThan(0);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    const required = T.handoverItems.filter((i) => i.required).length;
    expect(letter.text).toContain(`lists 30 documents (${required} required)`);
  });

  it("explains the transfer arrangements", () => {
    expect(letter.text).toContain("TRANSFER ARRANGEMENTS:");
    expect(letter.text).toMatch(/SharePoint or OneDrive: .*zip/);
    expect(letter.text).toMatch(/drag whole folders/);
    expect(letter.text).toMatch(/keys, fobs and remotes are to be handed over by arrangement with Tom Placeholder/);
    expect(letter.text).toContain("Submit handover pack");
  });

  it("asks for the funds transfer with a phone-verification warning", () => {
    expect(letter.text).toContain(
      "FUNDS TRANSFER: Please transfer the balances of the strata company's administrative fund and reserve fund to the strata company's new trust accounts",
    );
    expect(letter.text).toContain("once we have confirmed the account details with you by phone");
    expect(letter.text).toContain("please do not act on bank details received by email, even if they appear to come from us");
    expect(letter.text).toContain("final reconciliation of each fund");
  });

  it("ends with the standard sign-off and signature line", () => {
    expect(letter.text.endsWith("\n\nKind regards,\nTom Placeholder | Ikon Strata Management, on behalf of the strata company for SP 87192")).toBe(true);
  });

  it("uses WA strata terms only", () => {
    for (const pattern of NOT_WA) expect(letter.text).not.toMatch(pattern);
  });

  it("copes with a missing postcode and an empty schedule", () => {
    const bare = renderHandoverLetter(letterInput({ building: { ...BUILDING, postcode: null }, items: [] }));
    expect(bare.text).toContain("SP 87192, 160 Wright Street, Kewdale WA\n");
    expect(bare.text).not.toMatch(/null|undefined/);
    expect(bare.text).toContain("Please provide all of the strata company's records");
  });

  it("renders through the branded email HTML without losing the schedule", () => {
    const html = renderEmailHtml({
      subject: letter.subject,
      body: letter.text,
      companyName: "Ikon Strata Management",
      property: BUILDING,
      fromAddress: "sp87192@agent.ikonsm.com.au",
      logoUrl: null,
    });
    // One numbered list per folder, each starting from 1, with every document in it.
    const lists = html.match(/<ol [^>]*>.*?<\/ol>/g) ?? [];
    expect(lists).toHaveLength(VAULT_FOLDERS.length);
    const listed = lists.join("");
    for (const item of T.handoverItems) expect(listed).toContain(item.title.replace(/'/g, "&#39;"));
    expect((listed.match(/<li /g) ?? []).length).toBe(30);
    for (const folder of VAULT_FOLDERS) expect(html).toContain(`>${folder.replace("&", "&amp;")}</p>`);
    // Run-in headings and bullet labels come out bold.
    for (const label of ["STRATA MANAGEMENT HANDOVER:", "SCHEDULE OF DOCUMENTS:", "TRANSFER ARRANGEMENTS:", "FUNDS TRANSFER:", "Account details by phone:", "SharePoint or OneDrive:"]) {
      expect(html).toContain(`<strong>${label}</strong>`);
    }
    expect(html).toContain(PORTAL_URL);
    // The signature line is recognised and split into the branded block.
    expect(html).toContain(">Tom Placeholder</p>");
    expect(html).toContain("On behalf of the strata company for SP 87192, 160 Wright Street, Kewdale WA 6105");
    expect(html).not.toContain("Kind regards,<br>");
  });
});

describe("handover schedule and dates", () => {
  it("formats dates in Australian long form", () => {
    expect(formatLongDate("2026-11-21")).toBe("21 November 2026");
    expect(formatLongDate("2027-01-05")).toBe("5 January 2027");
    expect(formatLongDate("2026-12-05T20:00:00.000Z")).toBe("6 December 2026");
    expect(formatLongDate("2026-12-06T03:00:00Z")).toBe("6 December 2026");
    expect(formatLongDate("")).toBe("");
    expect(formatLongDate(null)).toBe("");
    expect(formatLongDate("not a date")).toBe("not a date");
    expect(formatLongDate("2026-13-01")).toBe("2026-13-01");
  });

  it("groups the schedule by folder in order, counting required items", () => {
    const groups = handoverSchedule(T.handoverItems, VAULT_FOLDERS);
    expect(groups.map((g) => g.folder)).toEqual([...VAULT_FOLDERS]);
    expect(groups.reduce((sum, g) => sum + g.items.length, 0)).toBe(30);
    for (const group of groups) expect(group.required).toBe(group.items.filter((i) => i.required).length);
    // Folders not listed come last; empty folders are left out.
    const partial = handoverSchedule(T.handoverItems.filter((i) => i.folder !== "03 Meetings"), ["08 Sales & Disclosure"]);
    expect(partial[0]!.folder).toBe("08 Sales & Disclosure");
    expect(partial.map((g) => g.folder)).not.toContain("03 Meetings");
    expect(partial).toHaveLength(7);
  });

  it("renders a short schedule for previews", () => {
    const short = renderHandoverSchedule(T.handoverItems, VAULT_FOLDERS, { details: false });
    expect(short.startsWith("01 Plan & By-laws\n1. Registered strata plan (required)\n")).toBe(true);
    expect(short).not.toContain(T.handoverItems[0]!.detail);
    expect(short.split("\n\n")).toHaveLength(8);
  });
});
