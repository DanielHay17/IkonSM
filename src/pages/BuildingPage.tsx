import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { PropertyCounts, PropertyProfile } from "../../shared/types";
import { api, isNotFound } from "../api";
import { CountBubble } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { CopyButton } from "../components/CopyButton";
import { EmptyState, ErrorState } from "../components/EmptyState";
import { Link } from "../components/Link";
import { BusyIndicator, LiveModeIndicator } from "../components/LiveStatus";
import { SimulateInboundModal } from "../components/SimulateInboundModal";
import { Skeleton } from "../components/Skeleton";
import { AiStatusPill, AlertDot, PropertyStatusPill } from "../components/StatusBadges";
import { TabNav, type TabItem } from "../components/Tabs";
import { usePropertyLive } from "../hooks/usePropertyLive";
import { useResource } from "../hooks/useResource";
import { plural, propertyAddress, propertyLabel } from "../lib/format";
import { usePortfolio } from "../providers/PortfolioProvider";
import { useSession } from "../providers/SessionProvider";
import { paths, type BuildingTab } from "../router";
import { AgentTab } from "./building/AgentTab";
import { BuildingContext, type BuildingContextValue } from "./building/BuildingContext";
import { ComputerTab } from "./building/ComputerTab";
import { ContactsTab } from "./building/ContactsTab";
import { InboxTab } from "./building/InboxTab";
import { VaultTab } from "./building/VaultTab";
import { WorkOrdersTab } from "./building/WorkOrdersTab";

const EMPTY_COUNTS: PropertyCounts = { openThreads: 0, p1Open: 0, pendingApprovals: 0, openTickets: 0, docs: 0, contacts: 0 };

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${alert && value > 0 ? "text-red-700" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

function BuildingHeader({
  profile,
  counts,
  context,
  onSimulate,
}: {
  profile: PropertyProfile;
  counts: PropertyCounts;
  context: Pick<BuildingContextValue, "aiOnline" | "ai" | "liveMode" | "live">;
  onSimulate: () => void;
}) {
  return (
    <Card className="mb-6 overflow-hidden">
      <div className="flex flex-col gap-4 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="min-w-0 flex-1">
          <nav aria-label="Breadcrumb" className="mb-1.5 text-[13px] text-muted">
            <Link href={paths.portfolio()} className="hover:text-ink hover:underline">
              Portfolio
            </Link>
            <span aria-hidden="true" className="mx-1.5">
              /
            </span>
            <span aria-current="page">SP {profile.spNumber}</span>
          </nav>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[26px]">SP {profile.spNumber}</h1>
            <PropertyStatusPill status={profile.status} />
            <AiStatusPill online={context.aiOnline} ai={context.ai} />
          </div>
          <p className="mt-1 text-[15px] text-ink-soft">
            {propertyAddress(profile)}
            {profile.lots ? <span className="text-muted"> · {plural(profile.lots, "lot")}</span> : null}
          </p>
          {profile.notes ? <p className="mt-1 hidden text-[13px] text-amber-800 sm:block">{profile.notes}</p> : null}
          <div className="mt-2.5 hidden flex-wrap items-center gap-x-1 gap-y-1 sm:flex">
            <span className="text-[13px] text-muted">Agent email</span>
            <span className="rounded-md bg-subtle px-2 py-0.5 font-mono text-[13px] text-ink ring-1 ring-line ring-inset">{profile.emailAddress}</span>
            <CopyButton text={profile.emailAddress} label="Copy agent email address" />
          </div>
        </div>
        <div className="flex flex-col items-start gap-2.5 sm:items-end">
          <Button variant="primary" icon="send" onClick={onSimulate}>
            Simulate inbound
          </Button>
          <LiveModeIndicator mode={context.liveMode} />
        </div>
      </div>

      <BusyIndicator busy={context.live?.busy} className="px-5 pt-3 empty:p-0 sm:px-6" />

      {/* On a phone the tab bubbles already show these counts, so the header stays short. */}
      <dl className="mt-4 hidden grid-cols-2 gap-4 border-t border-line bg-subtle/70 px-5 py-3.5 sm:grid sm:grid-cols-5 sm:px-6">
        <Stat label="Open threads" value={counts.openThreads} />
        <Stat label="P1 open" value={counts.p1Open} alert />
        <Stat label="Pending approvals" value={counts.pendingApprovals} />
        <Stat label="Open work orders" value={counts.openTickets} />
        <Stat label="Documents" value={counts.docs} />
      </dl>
    </Card>
  );
}

function HeaderSkeleton() {
  return (
    <Card className="mb-6 p-6" aria-hidden="true">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="mt-3 h-7 w-48" />
      <Skeleton className="mt-3 h-4 w-72" />
      <Skeleton className="mt-3 h-5 w-64" />
    </Card>
  );
}

function tabItems(propertyId: string, counts: PropertyCounts): TabItem<BuildingTab>[] {
  const count = (n: number, label: string) => <CountBubble count={n} label={label} />;
  return [
    {
      key: "inbox",
      label: "Inbox",
      icon: "inbox",
      href: paths.building(propertyId, "inbox"),
      adornment: (
        <>
          {count(counts.openThreads, "open threads")}
          {counts.p1Open > 0 ? <AlertDot label={`${counts.p1Open} P1 open`} /> : null}
        </>
      ),
    },
    { key: "work-orders", label: "Work orders", icon: "board", href: paths.building(propertyId, "work-orders"), adornment: count(counts.openTickets, "open") },
    { key: "vault", label: "Vault", icon: "folder", href: paths.building(propertyId, "vault"), adornment: count(counts.docs, "documents") },
    { key: "agent", label: "Agent", icon: "bot", href: paths.building(propertyId, "agent") },
    { key: "computer", label: "Computer", icon: "terminal", href: paths.building(propertyId, "computer") },
    { key: "contacts", label: "Contacts", icon: "users", href: paths.building(propertyId, "contacts"), adornment: count(counts.contacts, "contacts") },
  ];
}

const TABS: Record<BuildingTab, (props: { threadId: string | null }) => ReactNode> = {
  inbox: ({ threadId }) => <InboxTab threadId={threadId} />,
  "work-orders": () => <WorkOrdersTab />,
  vault: () => <VaultTab />,
  agent: () => <AgentTab />,
  computer: () => <ComputerTab />,
  contacts: () => <ContactsTab />,
};

/** A building's workspace: header with live agent status, then the tabbed views. */
export function BuildingPage({ propertyId, tab, threadId }: { propertyId: string; tab: BuildingTab; threadId: string | null }) {
  const portfolio = usePortfolio();
  const live = usePropertyLive(propertyId);
  const overview = useResource(`overview:${propertyId}`, () => api.overview(propertyId), live.refreshKey);
  const [simulateOpen, setSimulateOpen] = useState(false);

  const card = portfolio.cardFor(propertyId);
  const profile = overview.data?.profile ?? live.state?.profile ?? card?.profile ?? null;
  const counts = live.state?.counts ?? overview.data?.counts ?? card?.counts ?? EMPTY_COUNTS;
  const aiOnline = live.state?.aiOnline ?? overview.data?.aiOnline ?? false;
  const { session } = useSession();
  const ai = live.state?.ai ?? session.ai ?? null;

  // Keep the sidebar's P1 dots and approvals badge in step with this building's live counts.
  const { reload: reloadPortfolio } = portfolio;
  const cardCounts = card?.counts;
  useEffect(() => {
    if (!live.state || !cardCounts) return;
    const { p1Open, pendingApprovals } = live.state.counts;
    if (p1Open !== cardCounts.p1Open || pendingApprovals !== cardCounts.pendingApprovals) void reloadPortfolio();
  }, [live.state, cardCounts, reloadPortfolio]);

  useEffect(() => {
    if (profile) document.title = `${propertyLabel(profile)} · Ikon Command Hub`;
  }, [profile]);

  const context = useMemo<BuildingContextValue | null>(
    () =>
      profile
        ? {
            propertyId,
            profile,
            overview: overview.data,
            live: live.state,
            liveMode: live.mode,
            refreshKey: live.refreshKey,
            aiOnline,
            ai,
            reloadOverview: overview.reload,
            openSimulate: () => setSimulateOpen(true),
          }
        : null,
    [propertyId, profile, overview.data, overview.reload, live.state, live.mode, live.refreshKey, aiOnline, ai],
  );

  if (!context) {
    if (overview.error && isNotFound(overview.error)) {
      return (
        <EmptyState
          icon="building"
          title="Building not found"
          description={`There's no scheme "${propertyId}" in the portfolio.`}
          action={<Link href={paths.portfolio()} className="text-sm font-medium text-accent hover:underline">Back to portfolio</Link>}
        />
      );
    }
    if (overview.error) return <ErrorState error={overview.error} onRetry={overview.reload} title="Couldn't load this building" />;
    return <HeaderSkeleton />;
  }

  return (
    <BuildingContext.Provider value={context}>
      <BuildingHeader profile={context.profile} counts={counts} context={context} onSimulate={context.openSimulate} />
      <div className="mb-6">
        <TabNav label="Building sections" items={tabItems(propertyId, counts)} active={tab} />
      </div>
      {TABS[tab]({ threadId })}
      <SimulateInboundModal
        open={simulateOpen}
        onClose={() => setSimulateOpen(false)}
        propertyId={propertyId}
        propertyLabel={`SP ${context.profile.spNumber}`}
        agentEmail={context.profile.emailAddress}
      />
    </BuildingContext.Provider>
  );
}
