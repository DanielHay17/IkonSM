import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PropertyCounts, PropertyProfile } from "../../shared/types";
import { api, isNotFound } from "../api";
import { CountBubble } from "../components/Badge";
import { Button, IconButton } from "../components/Button";
import { Card } from "../components/Card";
import { CopyButton } from "../components/CopyButton";
import { EmptyState, ErrorState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
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
import { BoardSkeleton } from "./building/BoardSkeleton";
import { VaultTab } from "./building/VaultTab";

// The board brings the drag-and-drop library: load it only when the tab opens.
const WorkOrdersTab = lazy(() => import("./building/WorkOrdersTab").then((m) => ({ default: m.WorkOrdersTab })));

const EMPTY_COUNTS: PropertyCounts = { openThreads: 0, p1Open: 0, pendingApprovals: 0, openTickets: 0, docs: 0, contacts: 0 };

function BuildingHeader({
  profile,
  context,
  onSimulate,
}: {
  profile: PropertyProfile;
  context: Pick<BuildingContextValue, "aiOnline" | "ai" | "liveMode" | "live">;
  onSimulate: () => void;
}) {
  // One compact card on every tab: the tabs carry the counts, so there is no stat strip. On a phone
  // it is just the scheme and its address, with Simulate as an icon button.
  return (
    <Card className="mb-6 overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-5 py-4 sm:px-6 sm:py-5">
        <div className="min-w-0 flex-1">
          <nav aria-label="Breadcrumb" className="mb-1 hidden text-[13px] text-muted sm:block">
            <Link href={paths.portfolio()} className="hover:text-ink hover:underline">
              Portfolio
            </Link>
            <span aria-hidden="true" className="mx-1.5">
              /
            </span>
            <span aria-current="page">SP {profile.spNumber}</span>
          </nav>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <h1 className="heading-display text-[26px] leading-[1.05] text-ink sm:text-[32px]">SP {profile.spNumber}</h1>
            <PropertyStatusPill status={profile.status} />
            <AiStatusPill online={context.aiOnline} ai={context.ai} />
            <span className="hidden sm:contents">
              <LiveModeIndicator mode={context.liveMode} />
            </span>
          </div>
          <p className="mt-1 text-[15px] text-ink-soft">
            {propertyAddress(profile)}
            {profile.lots ? <span className="whitespace-nowrap text-muted"> · {plural(profile.lots, "lot")}</span> : null}
            <span className="ml-2.5 hidden items-center gap-1 align-middle text-[13px] text-muted sm:inline-flex">
              <Icon name="mail" className="size-3.5" />
              <span className="sr-only">Agent email </span>
              <span className="text-ink-soft tabular-nums">{profile.emailAddress}</span>
              <CopyButton text={profile.emailAddress} label="Copy agent email address" />
            </span>
          </p>
          {profile.notes ? (
            <p className="mt-1.5 hidden max-w-3xl gap-1.5 text-[13px] text-ink-soft sm:flex">
              <Icon name="alert" className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
              <span className="line-clamp-2">{profile.notes}</span>
            </p>
          ) : null}
        </div>
        {/* Wrappers carry the breakpoint: the buttons set their own display. */}
        <div className="hidden shrink-0 sm:block">
          <Button variant="primary" icon="send" onClick={onSimulate}>
            Simulate inbound
          </Button>
        </div>
        <div className="shrink-0 sm:hidden">
          <IconButton icon="send" label="Simulate inbound message" variant="primary" size="md" onClick={onSimulate} />
        </div>
      </div>

      <BusyIndicator busy={context.live?.busy} className="px-5 pb-4 empty:p-0 sm:px-6" />
    </Card>
  );
}

function HeaderSkeleton() {
  return (
    <Card className="mb-6 px-6 py-5" aria-hidden="true">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="mt-3 h-7 w-48" />
      <Skeleton className="mt-3 h-4 w-72" />
    </Card>
  );
}

/** Drafts waiting for a decision in this building: a charcoal chip with the approvals icon. */
function PendingApprovalsMark({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      title={`${plural(count, "draft")} awaiting approval`}
      className="inline-flex h-5 items-center gap-1 rounded-full bg-accent px-1.5 text-[11px] font-semibold tracking-normal text-white tabular-nums"
    >
      <Icon name="approve" className="size-3" />
      {count}
      <span className="sr-only"> awaiting approval</span>
    </span>
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
          <PendingApprovalsMark count={counts.pendingApprovals} />
          {counts.p1Open > 0 ? <AlertDot label={`${counts.p1Open} P1 open`} /> : null}
        </>
      ),
    },
    { key: "work-orders", label: "Work orders", icon: "board", href: paths.building(propertyId, "work-orders"), adornment: count(counts.openTickets, "open") },
    { key: "files", label: "Files", icon: "folder", href: paths.building(propertyId, "files"), adornment: count(counts.docs, "documents") },
    { key: "agent", label: "Agent", icon: "bot", href: paths.building(propertyId, "agent") },
    { key: "computer", label: "Computer", icon: "terminal", href: paths.building(propertyId, "computer") },
    { key: "contacts", label: "Contacts", icon: "users", href: paths.building(propertyId, "contacts"), adornment: count(counts.contacts, "contacts") },
  ];
}

const TABS: Record<BuildingTab, (props: { threadId: string | null }) => ReactNode> = {
  inbox: ({ threadId }) => <InboxTab threadId={threadId} />,
  "work-orders": () => (
    <Suspense fallback={<BoardSkeleton />}>
      <WorkOrdersTab />
    </Suspense>
  ),
  files: () => <VaultTab />,
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
  // The AI switch is hub-wide, so the session (refreshed when it changes) is the source of truth.
  const { session } = useSession();
  const aiOnline = session.aiOnline;
  const ai = session.ai ?? null;

  // Keep the sidebar's P1 dots and approvals badge in step with this building's live counts.
  const { reload: reloadPortfolio } = portfolio;
  const cardCounts = card?.counts;
  useEffect(() => {
    if (!live.state || !cardCounts) return;
    const { p1Open, pendingApprovals } = live.state.counts;
    if (p1Open !== cardCounts.p1Open || pendingApprovals !== cardCounts.pendingApprovals) void reloadPortfolio();
  }, [live.state, cardCounts, reloadPortfolio]);

  useEffect(() => {
    if (profile) document.title = `${propertyLabel(profile)} · IKON SM Command Hub`;
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
          action={<Link href={paths.portfolio()} className="text-sm font-medium link-brand">Back to portfolio</Link>}
        />
      );
    }
    if (overview.error) return <ErrorState error={overview.error} onRetry={overview.reload} title="Couldn't load this building" />;
    return <HeaderSkeleton />;
  }

  return (
    <BuildingContext.Provider value={context}>
      <BuildingHeader profile={context.profile} context={context} onSimulate={context.openSimulate} />
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
