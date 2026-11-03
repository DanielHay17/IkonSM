import { useState } from "react";
import type { PortfolioBrief } from "../../shared/types";
import { api } from "../api";
import { formatDateTime, labelFromId, propertyLabel } from "../lib/format";
import { usePortfolio } from "../providers/PortfolioProvider";
import { paths } from "../router";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { ErrorState } from "./EmptyState";
import { Icon } from "./Icon";
import { Link } from "./Link";
import { RichText } from "./RichText";
import { SkeletonText } from "./Skeleton";
import { PriorityBadge } from "./StatusBadges";
import { useToast } from "./Toast";

interface BriefCardProps {
  brief: PortfolioBrief | null | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onRefreshed: (brief: PortfolioBrief) => void;
  /** Show the "Open Chief of Staff" link (portfolio page). */
  linkToChief?: boolean;
}

function Highlights({ brief }: { brief: PortfolioBrief }) {
  const { cardFor } = usePortfolio();
  if (brief.highlights.length === 0) return null;
  return (
    <ul className="mt-4 flex flex-wrap gap-2" aria-label="Highlights">
      {brief.highlights.map((h, i) => {
        const card = cardFor(h.propertyId);
        return (
          <li key={`${h.propertyId}-${i}`}>
            <Link
              href={paths.building(h.propertyId)}
              className="inline-flex max-w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
            >
              {h.priority ? <PriorityBadge priority={h.priority} /> : null}
              <span className="font-medium text-ink">{card ? propertyLabel(card.profile) : labelFromId(h.propertyId)}</span>
              <span className="truncate">{h.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The Chief of Staff's portfolio brief, with a refresh that asks the agent to rewrite it now. */
export function BriefCard({ brief, loading, error, onRetry, onRefreshed, linkToChief }: BriefCardProps) {
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      onRefreshed(await api.refreshBrief());
    } catch (err) {
      toast.error("Couldn't refresh the brief", err);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-gradient-to-b from-accent-soft/60 to-transparent px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-accent text-white shadow-sm">
            <Icon name="sparkles" className="size-[18px]" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Chief of Staff brief</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-muted">
              {brief ? (
                <>
                  <span>Generated {formatDateTime(brief.generatedAt)}</span>
                  {brief.engine === "claude" ? (
                    <Badge tone="accent">Written by Claude</Badge>
                  ) : (
                    <Badge tone="slate">Rules summary (AI offline)</Badge>
                  )}
                </>
              ) : (
                "What happened overnight in every building, and what needs attention."
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {linkToChief ? (
            <Link href={paths.chiefOfStaff()} className="hidden h-8 items-center gap-1 rounded-lg px-3 text-[13px] font-medium text-ink-soft hover:bg-ink/5 hover:text-ink sm:inline-flex">
              Ask the Chief of Staff <Icon name="arrowRight" className="size-3.5" />
            </Link>
          ) : null}
          {brief ? (
            <Button size="sm" icon="refresh" loading={refreshing} onClick={refresh}>
              {refreshing ? "Writing…" : "Refresh"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="px-5 py-4">
        {loading ? (
          <SkeletonText lines={4} />
        ) : error ? (
          <ErrorState error={error} onRetry={onRetry} title="Couldn't load the brief" compact />
        ) : brief ? (
          <>
            <RichText text={brief.text} />
            <Highlights brief={brief} />
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
            <p>No brief yet today. The Chief of Staff writes one every morning at 7:00 am, or you can ask for one now.</p>
            <Button size="sm" variant="primary" icon="sparkles" loading={refreshing} onClick={refresh}>
              Write brief now
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
