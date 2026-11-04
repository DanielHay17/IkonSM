// A tiny history-API router: typed routes, path builders and a hook that re-renders on navigation.

import { useEffect, useMemo, useSyncExternalStore } from "react";

export const BUILDING_TABS = ["inbox", "work-orders", "files", "agent", "computer", "contacts"] as const;
export type BuildingTab = (typeof BUILDING_TABS)[number];

export type Route =
  | { name: "portfolio" }
  | { name: "approvals" }
  | { name: "chief-of-staff" }
  | { name: "building"; propertyId: string; tab: BuildingTab; threadId: string | null }
  | { name: "not-found"; path: string };

const NAVIGATE_EVENT = "ikon:navigate";

function isBuildingTab(value: string): value is BuildingTab {
  return (BUILDING_TABS as readonly string[]).includes(value);
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Paths that moved: the building's Vault tab is now Files. Old links and bookmarks still work. */
export function redirectFor(pathname: string): string | null {
  const match = /^\/buildings\/([^/]+)\/vault\/?$/.exec(pathname);
  return match ? `/buildings/${match[1]}/files` : null;
}

export function parseRoute(pathname: string): Route {
  const raw = pathname.split("/").filter(Boolean);
  const parts = raw.map(decodeSegment);
  if (parts.some((p) => p === null)) return { name: "not-found", path: pathname };
  const [first, second, third, fourth, ...rest] = parts as string[];

  if (!first) return { name: "portfolio" };
  if (first === "approvals" && !second) return { name: "approvals" };
  if (first === "chief-of-staff" && !second) return { name: "chief-of-staff" };

  if (first === "buildings" && second && rest.length === 0) {
    const tab = third ?? "inbox";
    if (isBuildingTab(tab) && (tab === "inbox" || !fourth)) {
      return { name: "building", propertyId: second, tab, threadId: fourth ?? null };
    }
  }
  return { name: "not-found", path: pathname };
}

const enc = encodeURIComponent;

export const paths = {
  portfolio: () => "/",
  approvals: () => "/approvals",
  chiefOfStaff: () => "/chief-of-staff",
  building: (propertyId: string, tab: BuildingTab = "inbox") => `/buildings/${enc(propertyId)}/${tab}`,
  thread: (propertyId: string, threadId: string) => `/buildings/${enc(propertyId)}/inbox/${enc(threadId)}`,
  /** Opens the Files tab with a document's text panel showing. */
  vaultDoc: (propertyId: string, docId: string) => `/buildings/${enc(propertyId)}/files?doc=${enc(docId)}`,
};

function currentLocation(): string {
  return window.location.pathname + window.location.search;
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (to === currentLocation()) return;
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

export function useLocationPath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

/** The current query string, so components can react to ?doc= style parameters. */
export function useLocationSearch(): string {
  return useSyncExternalStore(subscribe, () => window.location.search);
}

/** The current route. A moved path renders its new route straight away and the address bar catches up. */
export function useRoute(): Route {
  const pathname = useLocationPath();
  const moved = redirectFor(pathname);
  useEffect(() => {
    if (moved) navigate(moved + window.location.search + window.location.hash, { replace: true });
  }, [moved]);
  return useMemo(() => parseRoute(moved ?? pathname), [moved, pathname]);
}
