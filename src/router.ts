// A tiny history-API router: typed routes, path builders and a hook that re-renders on navigation.

import { useEffect, useMemo, useSyncExternalStore } from "react";

export const BUILDING_TABS = ["inbox", "work-orders", "files", "agent", "computer", "contacts"] as const;
export type BuildingTab = (typeof BUILDING_TABS)[number];

/** The tabs of an onboarding project (docs/ONBOARDING_SPEC.md, "Staff UI"). */
export const ONBOARDING_TABS = ["overview", "tasks", "handover", "golive", "approvals", "map", "activity"] as const;
export type OnboardingTab = (typeof ONBOARDING_TABS)[number];

/** The hub-wide directories behind the onboarding dashboard. */
export const ONBOARDING_DIRECTORIES = ["companies", "outgoing-managers"] as const;
export type OnboardingDirectory = (typeof ONBOARDING_DIRECTORIES)[number];

export type Route =
  | { name: "portfolio" }
  | { name: "approvals" }
  | { name: "chief-of-staff" }
  | { name: "building"; propertyId: string; tab: BuildingTab; threadId: string | null }
  | { name: "onboarding" }
  | { name: "onboarding-project"; propertyId: string; tab: OnboardingTab }
  | { name: "onboarding-directory"; directory: OnboardingDirectory }
  /** The outgoing manager's upload portal: public, reached with the secure link (no session). */
  | { name: "portal"; token: string }
  | { name: "not-found"; path: string };

const NAVIGATE_EVENT = "ikon:navigate";

function isBuildingTab(value: string): value is BuildingTab {
  return (BUILDING_TABS as readonly string[]).includes(value);
}

function isOnboardingTab(value: string): value is OnboardingTab {
  return (ONBOARDING_TABS as readonly string[]).includes(value);
}

function isOnboardingDirectory(value: string): value is OnboardingDirectory {
  return (ONBOARDING_DIRECTORIES as readonly string[]).includes(value);
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

  if (first === "handover" && second && !third) return { name: "portal", token: second };

  if (first === "onboarding" && rest.length === 0 && !fourth) {
    if (!second) return { name: "onboarding" };
    if (second === "directory") {
      if (third && isOnboardingDirectory(third)) return { name: "onboarding-directory", directory: third };
    } else {
      const tab = third ?? "overview";
      if (isOnboardingTab(tab)) return { name: "onboarding-project", propertyId: second, tab };
    }
  }

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
  onboarding: () => "/onboarding",
  /** A project tab, optionally with a query (the Tasks filters, the Handover status filter). */
  onboardingProject: (propertyId: string, tab: OnboardingTab = "overview", query?: Record<string, string | null | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) if (value) params.set(key, value);
    const qs = params.toString();
    return `/onboarding/${enc(propertyId)}/${tab}${qs ? `?${qs}` : ""}`;
  },
  onboardingDirectory: (directory: OnboardingDirectory) => `/onboarding/directory/${directory}`,
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
