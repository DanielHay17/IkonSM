import { Suspense, lazy, useEffect } from "react";
import { AppShell } from "./components/AppShell";
import { ErrorState } from "./components/EmptyState";
import { Spinner } from "./components/Spinner";
import { ToastProvider } from "./components/Toast";
import { Logo } from "./components/Wordmark";
import { useOneDriveReturn } from "./hooks/useOneDriveReturn";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { BuildingPage } from "./pages/BuildingPage";
import { ChiefOfStaffPage } from "./pages/ChiefOfStaffPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { PortalRoute, portalTokenFromPath } from "./pages/portal/PortalRoute";
import { PortfolioProvider } from "./providers/PortfolioProvider";
import { SessionProvider, type SessionStatus } from "./providers/SessionProvider";
import { useLocationPath, useRoute, type Route } from "./router";
import type { SessionInfo } from "../shared/types";

// The onboarding screens and the brain load when first opened, keeping them out of the main bundle.
const BrainPage = lazy(() => import("./pages/BrainPage").then((m) => ({ default: m.BrainPage })));
const OnboardingDashboard = lazy(() => import("./pages/onboarding/OnboardingDashboard").then((m) => ({ default: m.OnboardingDashboard })));
const OnboardingProjectPage = lazy(() => import("./pages/onboarding/ProjectPage").then((m) => ({ default: m.ProjectPage })));
const OnboardingDirectoryPage = lazy(() => import("./pages/onboarding/Directory").then((m) => ({ default: m.DirectoryPage })));

function ScreenLoading() {
  return (
    <p className="flex items-center gap-3 py-10 text-sm text-muted">
      <Spinner className="size-5 text-accent" label={null} />
      Loading…
    </p>
  );
}

const APP_TITLE = "IKON SM Command Hub";
const PAGE_TITLES: Partial<Record<Route["name"], string>> = {
  portfolio: "Portfolio",
  approvals: "Approvals",
  "chief-of-staff": "Chief of Staff",
  brain: "AI Brain",
  onboarding: "Onboarding",
  "not-found": "Not found",
};

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case "portfolio":
      return <PortfolioPage />;
    case "approvals":
      return <ApprovalsPage />;
    case "chief-of-staff":
      return <ChiefOfStaffPage />;
    case "brain":
      return (
        <Suspense fallback={<ScreenLoading />}>
          <BrainPage />
        </Suspense>
      );
    case "building":
      return <BuildingPage key={route.propertyId} propertyId={route.propertyId} tab={route.tab} threadId={route.threadId} />;
    case "onboarding":
      return (
        <Suspense fallback={<ScreenLoading />}>
          <OnboardingDashboard />
        </Suspense>
      );
    case "onboarding-project":
      return (
        <Suspense fallback={<ScreenLoading />}>
          <OnboardingProjectPage key={route.propertyId} propertyId={route.propertyId} tab={route.tab} />
        </Suspense>
      );
    case "onboarding-directory":
      return (
        <Suspense fallback={<ScreenLoading />}>
          <OnboardingDirectoryPage directory={route.directory} />
        </Suspense>
      );
    case "portal":
      // The outgoing manager's portal is public: App renders it outside the session gate and the hub shell.
      // Only an odd spelling of the path (such as a doubled slash) gets here.
      return <NotFoundPage path={window.location.pathname} />;
    case "not-found":
      return <NotFoundPage path={route.path} />;
  }
}

function Hub() {
  const route = useRoute();
  const routeName = route.name;
  const pageKey =
    route.name === "building" ? `building:${route.propertyId}` : route.name === "onboarding-project" ? `onboarding:${route.propertyId}` : route.name;
  // Back from the Microsoft 365 sign-in (?onedrive=connected or ?onedrive=error).
  useOneDriveReturn();

  // New page (not a tab or thread switch): start at the top and set the tab title.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    const title = PAGE_TITLES[routeName];
    if (title) document.title = `${title} · ${APP_TITLE}`;
  }, [pageKey, routeName]);

  return (
    <PortfolioProvider>
      <AppShell>
        <Screen route={route} />
      </AppShell>
    </PortfolioProvider>
  );
}

function SessionGate(state: SessionStatus, controls: { retry: () => void; setSession: (s: SessionInfo) => void }) {
  if (state.status === "loading") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4">
        <Logo tone="dark" className="w-[180px]" />
        <p className="flex items-center gap-3 text-sm text-muted">
          <Spinner className="size-5 text-accent" label={null} />
          Opening the command hub…
        </p>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-4">
        <Logo tone="dark" className="w-[180px]" />
        <ErrorState error={state.error} onRetry={controls.retry} title="Couldn't reach the command hub" />
      </div>
    );
  }
  return <LoginPage companyName={state.session.companyName} onSignedIn={controls.setSession} />;
}

export function App() {
  // The outgoing manager's handover portal (/handover/:token) is public: no session gate, no hub shell.
  // Read through the router so an in-app navigation to a portal path switches over too.
  const portalToken = portalTokenFromPath(useLocationPath());
  if (portalToken !== null) return <PortalRoute token={portalToken} />;
  return (
    <ToastProvider>
      <SessionProvider renderGate={SessionGate}>
        <Hub />
      </SessionProvider>
    </ToastProvider>
  );
}
