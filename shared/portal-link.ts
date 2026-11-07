// The outgoing manager's portal link in the address bar. Kept apart from shared/portal-upload.ts (and with no
// imports) so the hub's main bundle can recognise a /handover/ link without loading the portal's code.

/**
 * The token of a portal path ("/handover/<token>"), or null when the path is not the portal at all. A
 * malformed token comes back as is (the page then says the link is not valid without asking the server).
 */
export function portalTokenFromPath(pathname: string): string | null {
  const match = /^\/handover\/([^/]*)\/?$/.exec(pathname ?? "");
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return "";
  }
}
