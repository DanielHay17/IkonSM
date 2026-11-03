// Ikon's strata portfolio (from Ikon SharePoint › Operations, 3 Nov 2026) and the seed data
// each building agent starts with.

import type { Contact, PropertyProfile } from "../../shared/types";
import { addressForProperty } from "../email/routing";
import { COMPANY_DOCS } from "./company";
import { SP_26707_SEED } from "./sp26707";

export type PortfolioEntry = Omit<PropertyProfile, "emailAddress">;

/** One markdown document loaded into a building agent's vault by PropertyAgent.seed(). */
export interface SeedDoc {
  folder: string;
  name: string;
  text: string;
  scope: "building" | "company";
  sample: boolean;
}

/** Payload accepted by PropertyAgent.seed(). */
export interface SeedData {
  docs: SeedDoc[];
  contacts: Omit<Contact, "id">[];
  memory: string[];
}

export const PILOT_PROPERTY_ID = "sp-26707";

function scheme(
  spNumber: string,
  street: string,
  suburb: string,
  postcode: string,
  extra: Partial<Pick<PortfolioEntry, "lots" | "status" | "notes">> = {},
): PortfolioEntry {
  return {
    id: `sp-${spNumber}`,
    spNumber,
    street,
    suburb,
    state: "WA",
    postcode,
    lots: extra.lots ?? null,
    status: extra.status ?? "onboarding",
    notes: extra.notes ?? null,
  };
}

export const PORTFOLIO: PortfolioEntry[] = [
  scheme("26707", "34 Davies Road", "Claremont", "6010", {
    status: "pilot",
    lots: 8,
    notes:
      "Pilot building. The lot count (8) and all seeded documents and contacts are SAMPLE data; replace them with the real strata plan and records.",
  }),
  scheme("13183", "4 Wade Court", "Girrawheen", "6064"),
  scheme("87192", "160 Wright Street", "Kewdale", "6105"),
  scheme("86837", "12 Bushlark Turn", "Erskine", "6210", {
    notes: 'SharePoint folder has a "NEW" duplicate to consolidate.',
  }),
  scheme("83917", "15 Thomas Street", "Nedlands", "6009"),
  scheme("83114", "333 Oxford Street", "Leederville", "6007"),
  scheme("82719", "11 Mort Street", "Rivervale", "6103"),
  scheme("64324", "10 Athletes Parade", "Floreat", "6014"),
  scheme("43464", "4 Bellevue Terrace", "West Perth", "6005"),
  scheme("24594", "Bellevue Terrace", "West Perth", "6005", {
    notes: "Street number to confirm (hidden in the SharePoint screenshot).",
  }),
  scheme("23872", "8 Josephson Street", "Fremantle", "6160"),
  scheme("23079", "20 Sixth Avenue", "Maylands", "6051", {
    notes: 'Three SharePoint folders (including "Latest" and "2") to consolidate.',
  }),
  scheme("21343", "Morley Growers Market", "Morley", "6062", {
    notes: "Street address to confirm.",
  }),
  scheme("10588", "4 Lomatia Way", "Forrestfield", "6058"),
  scheme("10140", "10-12 Southbourne Street", "Scarborough", "6019", {
    notes: "Two SharePoint folders to consolidate.",
  }),
  scheme("4027", "216 Cambridge Street", "Wembley", "6014"),
];

export const PORTFOLIO_IDS: string[] = PORTFOLIO.map((p) => p.id);

const BY_ID = new Map(PORTFOLIO.map((p) => [p.id, p]));

export function isKnownPropertyId(id: string): boolean {
  return BY_ID.has(id);
}

export function portfolioEntry(id: string): PortfolioEntry | null {
  return BY_ID.get(id) ?? null;
}

/**
 * Lenient lookup for ids typed by people or models: "sp-26707", "SP 26707", "sp26707" and
 * "26707" all resolve to "sp-26707". Returns null for anything not in the portfolio.
 */
export function resolvePropertyId(input: string): string | null {
  const digits = /(\d{3,6})/.exec(input)?.[1];
  if (!digits) return null;
  const id = `sp-${digits}`;
  return BY_ID.has(id) ? id : null;
}

/** e.g. "SP 26707 (34 Davies Road, Claremont)". */
export function propertyName(p: Pick<PropertyProfile, "spNumber" | "street" | "suburb">): string {
  return `SP ${p.spNumber} (${p.street}, ${p.suburb})`;
}

export function withEmail(env: Env, p: PortfolioEntry): PropertyProfile {
  return { ...p, emailAddress: addressForProperty(env, p.id) };
}

/** Ikon policy docs go to every building; the pilot also gets its SAMPLE building records. */
export function seedFor(propertyId: string): SeedData {
  const building = propertyId === PILOT_PROPERTY_ID ? SP_26707_SEED : { docs: [], contacts: [], memory: [] };
  return {
    docs: [...COMPANY_DOCS, ...building.docs],
    contacts: building.contacts,
    memory: building.memory,
  };
}
