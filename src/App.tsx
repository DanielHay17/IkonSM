import { useEffect } from "react";
import { AppShell } from "./components/AppShell";
import { ErrorState } from "./components/EmptyState";
import { PageSpinner } from "./components/Spinner";
import { ToastProvider } from "./components/Toast";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { BuildingPage } from "./pages/BuildingPage";
import { ChiefOfStaffPage } from "./pages/ChiefOfStaffPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { PortfolioProvider } from "./providers/PortfolioProvider";
import { SessionProvider, type SessionStatus } from "./providers/SessionProvider";
import { useRoute, type Route } from "./router";
import type { SessionInfo } from "../shared/types";

const APP_TITLE = "Ikon Command Hub";
const PAGE_TITLES: Partial<Record<Route["name"], string>> = {
  portfolio: "Portfolio",
  approvals: "Approvals",
  "chief-of-staff": "Chief of Staff",
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
    case "building":
      return <BuildingPage key={route.propertyId} propertyId={route.propertyId} tab={route.tab} threadId={route.threadId} />;
    case "not-found":
      return <NotFoundPage path={route.path} />;
  }
}

function Hub() {
  const route = useRoute();
  const routeName = route.name;
  const pageKey = route.name === "building" ? `building:${route.propertyId}` : route.name;

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
      <div className="grid min-h-dvh place-items-center">
        <PageSpinner label="Opening the command hub" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="grid min-h-dvh place-items-center px-4">
        <ErrorState error={state.error} onRetry={controls.retry} title="Couldn't reach the command hub" />
      </div>
    );
  }
  return <LoginPage companyName={state.session.companyName} onSignedIn={controls.setSession} />;
}

export function App() {
  return (
    <ToastProvider>
      <SessionProvider renderGate={SessionGate}>
        <Hub />
      </SessionProvider>
    </ToastProvider>
  );
}
