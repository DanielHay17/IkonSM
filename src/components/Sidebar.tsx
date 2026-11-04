import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { initials, propertyLabel } from "../lib/format";
import { usePortfolio } from "../providers/PortfolioProvider";
import { useSession } from "../providers/SessionProvider";
import { paths, useRoute, type Route } from "../router";
import { CountBubble } from "./Badge";
import { IconButton } from "./Button";
import { Icon, type IconName } from "./Icon";
import { Link } from "./Link";
import { Skeleton } from "./Skeleton";
import { AiStatusPill, AlertDot } from "./StatusBadges";
import { useToast } from "./Toast";
import { Wordmark } from "./Wordmark";

function NavItem({
  href,
  icon,
  label,
  active,
  trailing,
}: {
  href: string;
  icon: IconName;
  label: string;
  active: boolean;
  trailing?: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "group relative flex h-10 items-center gap-3 px-3 text-[13px] font-medium tracking-[0.06em] uppercase transition-colors",
        "before:absolute before:inset-y-1.5 before:left-0 before:w-0.5",
        active ? "bg-white/[0.08] text-white before:bg-white" : "text-charcoal-text before:bg-transparent hover:bg-white/5 hover:text-white",
      )}
    >
      <Icon name={icon} className={cx("size-[18px]", active ? "text-white" : "text-charcoal-muted group-hover:text-charcoal-text")} />
      <span className="flex-1 truncate">{label}</span>
      {trailing}
    </Link>
  );
}

function BuildingList({ route }: { route: Route }) {
  const { cards, loading } = usePortfolio();
  const activeId = route.name === "building" ? route.propertyId : null;

  if (loading && !cards) {
    return (
      <div className="space-y-2 px-3" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-5 bg-white/5!" />
        ))}
      </div>
    );
  }
  if (!cards?.length) return <p className="px-3 text-[13px] text-charcoal-muted">No buildings loaded.</p>;

  return (
    <ul className="space-y-0.5">
      {cards.map(({ profile, counts }) => {
        const active = profile.id === activeId;
        return (
          <li key={profile.id}>
            <Link
              href={paths.building(profile.id)}
              aria-current={active ? "page" : undefined}
              className={cx(
                "relative flex h-9 items-center gap-2 px-3 text-[13px] transition-colors",
                "before:absolute before:inset-y-1.5 before:left-0 before:w-0.5",
                active ? "bg-white/[0.08] font-medium text-white before:bg-white" : "text-charcoal-text before:bg-transparent hover:bg-white/5 hover:text-white",
              )}
            >
              <span className="flex-1 truncate">{propertyLabel(profile)}</span>
              {profile.status === "pilot" ? (
                <span className="px-1.5 py-px text-[10px] font-semibold tracking-[0.12em] text-white uppercase ring-1 ring-white/40 ring-inset">
                  Pilot
                </span>
              ) : null}
              {counts.p1Open > 0 ? <AlertDot label={`${counts.p1Open} P1 open`} /> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function SidebarFooter() {
  const { session, signOut } = useSession();
  const toast = useToast();
  const onSignOut = () => signOut().catch((err: unknown) => toast.error("Couldn't sign out", err));

  return (
    <div className="border-t border-white/10 p-4">
      <div className="mb-3 px-1">
        <AiStatusPill online={session.aiOnline} ai={session.ai} tone="dark" />
      </div>
      <div className="flex items-center gap-3 px-1">
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center bg-white text-xs font-semibold text-charcoal"
        >
          {initials(session.staffName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{session.staffName}</p>
          <p className="truncate text-xs text-charcoal-muted">{session.companyName}</p>
        </div>
        {session.authRequired ? <IconButton icon="logout" label="Sign out" variant="dark" onClick={onSignOut} /> : null}
      </div>
    </div>
  );
}

/** Charcoal sidebar content (the website's dark band); used in the fixed desktop rail and the mobile drawer. */
export function Sidebar({ onClose }: { onClose?: () => void }) {
  const route = useRoute();
  const { pendingApprovals, cards } = usePortfolio();

  return (
    <div data-surface="dark" className="flex h-full flex-col bg-charcoal text-charcoal-text">
      <div className="flex items-start justify-between px-6 pt-7 pb-7">
        <Link href={paths.portfolio()} aria-label="IKON SM Command Hub home">
          <Wordmark />
        </Link>
        {onClose ? <IconButton icon="close" label="Close menu" variant="dark" onClick={onClose} /> : null}
      </div>

      <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 scrollbar-dark">
        <div className="space-y-0.5">
          <NavItem href={paths.portfolio()} icon="grid" label="Portfolio" active={route.name === "portfolio"} />
          <NavItem
            href={paths.approvals()}
            icon="approve"
            label="Approvals"
            active={route.name === "approvals"}
            trailing={<CountBubble count={pendingApprovals} tone="inverse" label="pending" />}
          />
          <NavItem href={paths.chiefOfStaff()} icon="sparkles" label="Chief of Staff" active={route.name === "chief-of-staff"} />
        </div>

        <div className="mt-6 mb-2 flex items-center justify-between px-3">
          <h2 className="text-[11px] font-medium tracking-[0.2em] text-charcoal-muted uppercase">Buildings</h2>
          {cards ? <span className="text-[11px] text-charcoal-muted tabular-nums">{cards.length}</span> : null}
        </div>
        <BuildingList route={route} />
      </nav>

      <SidebarFooter />
    </div>
  );
}
