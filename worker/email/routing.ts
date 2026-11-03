// Maps inbound email addresses to agents, and agents to their public addresses.
//
//   sp26707@<domain>, sp-26707@<domain>, SP26707+anything@<domain>  → PropertyAgent "sp-26707"
//   hub@<domain>, cos@<domain>                                      → ChiefOfStaffAgent "main"
//   anything else (including unknown scheme numbers)                → null (caller rejects)
//
// Routing uses only the envelope recipient (RCPT TO), never message headers, so a
// sender cannot steer mail into another building's agent.

import type { EmailResolver } from "agents/email";

/** Env binding keys; routeAgentEmail looks the Durable Object namespace up by this name. */
const PROPERTY_AGENT = "PropertyAgent";
const CHIEF_OF_STAFF_AGENT = "ChiefOfStaffAgent";
const CHIEF_OF_STAFF_ID = "main";
const CHIEF_OF_STAFF_LOCAL_PARTS = new Set(["hub", "cos"]);

const DEFAULT_EMAIL_DOMAIN = "ikon.example.com";
const PROPERTY_LOCAL_PART = /^sp[-_]?(\d{3,6})$/;

/**
 * Property id for an agent address: "sp26707@x" | "sp-26707@x" | "SP26707@x" → "sp-26707".
 * Accepts a bare address or "Name <address>"; plus-tags are ignored. Returns null otherwise.
 */
export function propertyIdFromAddress(address: string): string | null {
  const localPart = localPartOf(address);
  const match = localPart ? PROPERTY_LOCAL_PART.exec(localPart) : null;
  return match ? `sp-${match[1]}` : null;
}

/** The building agent's inbound address: "sp-26707" → "sp26707@<EMAIL_DOMAIN>". */
export function addressForProperty(env: Env, propertyId: string): string {
  const local = propertyId.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${local}@${emailDomain(env)}`;
}

/**
 * Email resolver for routeAgentEmail. `knownIds` lists the property ids in the portfolio;
 * mail for a well-formed but unknown scheme number is not routed (no agent is created for it).
 */
export function createIkonEmailResolver(knownIds: () => string[] | Promise<string[]>): EmailResolver<Env> {
  return async (email) => {
    const localPart = localPartOf(email.to);
    if (!localPart) return null;

    if (CHIEF_OF_STAFF_LOCAL_PARTS.has(localPart)) {
      return { agentName: CHIEF_OF_STAFF_AGENT, agentId: CHIEF_OF_STAFF_ID };
    }

    const propertyId = propertyIdFromAddress(email.to);
    if (!propertyId) return null;
    const known = await knownIds();
    return known.includes(propertyId) ? { agentName: PROPERTY_AGENT, agentId: propertyId } : null;
  };
}

/** Lower-cased local part without any "+tag", or null if the input is not an address. */
function localPartOf(address: string): string | null {
  if (typeof address !== "string") return null;
  const bracketed = /<([^<>]*)>/.exec(address);
  const bare = (bracketed ? bracketed[1] : address).trim().toLowerCase();
  const match = /^([^\s@]{1,64})@[^\s@]{1,253}$/.exec(bare);
  if (!match) return null;
  const local = match[1].split("+", 1)[0];
  return local || null;
}

function emailDomain(env: Env): string {
  const configured = (env.EMAIL_DOMAIN ?? "").trim().replace(/^@+/, "").toLowerCase();
  return configured || DEFAULT_EMAIL_DOMAIN;
}
