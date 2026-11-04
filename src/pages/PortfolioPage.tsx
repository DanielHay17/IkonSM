import type { PropertyCard as PropertyCardData } from "../../shared/types";
import { BriefCard } from "../components/BriefCard";
import { Card, PageHeader } from "../components/Card";
import { CopyButton } from "../components/CopyButton";
import { ErrorState } from "../components/EmptyState";
import { Icon, type IconName } from "../components/Icon";
import { Link } from "../components/Link";
import { SkeletonCard } from "../components/Skeleton";
import { PropertyStatusPill } from "../components/StatusBadges";
import { useBrief } from "../hooks/useBrief";
import { useNow } from "../hooks/useNow";
import { cx } from "../lib/cx";
import { plural, timeAgo } from "../lib/format";
import { usePortfolio } from "../providers/PortfolioProvider";
import { paths } from "../router";

function Metric({ label, value, icon, alert }: { label: string; value: number | string; icon: IconName; alert?: boolean }) {
  return (
    <Card className={cx("flex items-center gap-3.5 px-4 py-3.5", alert && "border-red-200 bg-red-50/60")}>
      <span className={cx("hidden size-9 shrink-0 place-items-center ring-1 sm:grid", alert ? "bg-red-100 text-red-700 ring-red-200" : "bg-surface text-taupe ring-line-strong")}>
        <Icon name={icon} className="size-[18px]" />
      </span>
      <div className="min-w-0">
        <p className={cx("heading-display text-[22px] leading-7 tabular-nums", alert ? "text-red-800" : "text-ink")}>{value}</p>
        <p className="text-xs leading-snug text-muted">{label}</p>
      </div>
    </Card>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <dd className="text-base font-semibold text-ink tabular-nums">
        {value}
      </dd>
      <dt className="truncate text-[11px] text-muted">{label}</dt>
    </div>
  );
}

function PropertyTile({ card, now }: { card: PropertyCardData; now: number }) {
  const { profile, counts, lastActivityAt } = card;
  return (
    <article
      className={cx(
        "group relative flex flex-col rounded-xl border bg-surface shadow-card transition-[border-color,box-shadow] hover:shadow-pop",
        counts.p1Open > 0 ? "border-red-200" : "border-line hover:border-line-strong",
      )}
    >
      <div className="flex flex-1 flex-col px-5 pt-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="heading-display text-[15px] leading-6 text-ink">
            <Link href={paths.building(profile.id)} className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent">
              SP {profile.spNumber}
            </Link>
          </h2>
          <PropertyStatusPill status={profile.status} />
        </div>
        <p className="mt-1.5 truncate text-sm text-ink">{profile.street || "Address to confirm"}</p>
        <p className="text-[13px] text-muted">
          {profile.suburb}
          {profile.lots ? ` · ${plural(profile.lots, "lot")}` : ""}
          {lastActivityAt ? ` · active ${timeAgo(lastActivityAt, now)}` : ""}
        </p>
        {profile.notes ? (
          <p className="mt-1.5 flex gap-1.5 text-xs text-ink-soft" title={profile.notes}>
            <Icon name="alert" className="mt-px size-3.5 shrink-0 text-amber-600" />
            <span className="line-clamp-1">{profile.notes}</span>
          </p>
        ) : null}

        {card.error ? (
          <p
            className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[13px] font-medium text-amber-900 ring-1 ring-amber-200 ring-inset"
            title={card.error}
          >
            <Icon name="alert" className="size-4 text-amber-600" />
            Building agent not responding: counts unknown
          </p>
        ) : null}

        {counts.p1Open > 0 ? (
          <p className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[13px] font-medium text-red-800 ring-1 ring-red-200 ring-inset">
            <Icon name="alert" className="size-4 text-red-600" />
            {counts.p1Open === 1 ? "1 P1 emergency open" : `${counts.p1Open} P1 emergencies open`}
          </p>
        ) : null}

        <div className="min-h-4 flex-1" aria-hidden="true" />
        <dl className="mt-auto grid grid-cols-4 gap-2 border-t border-line pt-3">
          <Count label="Open" value={counts.openThreads} />
          <Count label="Approvals" value={counts.pendingApprovals} />
          <Count label="Work orders" value={counts.openTickets} />
          <Count label="Docs" value={counts.docs} />
        </dl>
      </div>
      <div className="relative z-10 flex items-center gap-1 rounded-b-xl border-t border-line bg-subtle/70 px-5 py-2">
        <Icon name="mail" className="size-3.5 text-muted" />
        <span className="min-w-0 flex-1 truncate text-xs text-ink-soft tabular-nums" title={profile.emailAddress}>
          {profile.emailAddress}
        </span>
        <CopyButton text={profile.emailAddress} label={`Copy SP ${profile.spNumber} agent email address`} />
      </div>
    </article>
  );
}

export function PortfolioPage() {
  const { cards, loading, error, reload, pendingApprovals, p1Open } = usePortfolio();
  const brief = useBrief();
  const now = useNow(60_000);

  const totals = (cards ?? []).reduce(
    (t, c) => ({ open: t.open + c.counts.openThreads, tickets: t.tickets + c.counts.openTickets }),
    { open: 0, tickets: 0 },
  );

  return (
    <>
      <PageHeader
        title="Portfolio"
        description={cards ? `${plural(cards.length, "scheme")} managed by Ikon. Each building has its own agent, inbox, vault and memory.` : "Loading schemes…"}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="P1 emergencies open" value={cards ? p1Open : "–"} icon="alert" alert={p1Open > 0} />
        <Metric label="Approvals waiting" value={cards ? pendingApprovals : "–"} icon="approve" />
        <Metric label="Open threads" value={cards ? totals.open : "–"} icon="inbox" />
        <Metric label="Open work orders" value={cards ? totals.tickets : "–"} icon="board" />
      </div>

      <div className="mb-8">
        <BriefCard
          brief={brief.brief}
          loading={brief.loading}
          error={brief.error}
          onRetry={brief.reload}
          onRefreshed={brief.setBrief}
          linkToChief
        />
      </div>

      <h2 className="sr-only">Schemes</h2>
      {loading && !cards ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading schemes">
          {Array.from({ length: 6 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : error && !cards ? (
        <Card>
          <ErrorState error={error} onRetry={reload} title="Couldn't load the portfolio" />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(cards ?? []).map((card) => (
            <PropertyTile key={card.profile.id} card={card} now={now} />
          ))}
        </div>
      )}
    </>
  );
}
