import { useMemo } from "react";
import type { Approval } from "../../shared/types";
import { api } from "../api";
import { ApprovalCard } from "../components/ApprovalCard";
import { Badge } from "../components/Badge";
import { Card, PageHeader } from "../components/Card";
import { EmptyState, ErrorState } from "../components/EmptyState";
import { Link } from "../components/Link";
import { Skeleton, SkeletonText } from "../components/Skeleton";
import { usePolling } from "../hooks/usePolling";
import { useResource } from "../hooks/useResource";
import { labelFromId, plural, propertyLabel } from "../lib/format";
import { usePortfolio } from "../providers/PortfolioProvider";
import { paths } from "../router";

const REFRESH_MS = 15_000;

function groupByProperty(approvals: Approval[]): { propertyId: string; items: Approval[] }[] {
  const groups = new Map<string, Approval[]>();
  for (const approval of approvals) {
    const list = groups.get(approval.propertyId) ?? [];
    list.push(approval);
    groups.set(approval.propertyId, list);
  }
  return [...groups.entries()].map(([propertyId, items]) => ({ propertyId, items }));
}

function QueueSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading approvals">
      {[0, 1].map((i) => (
        <Card key={i} className="p-5">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-3 h-5 w-2/3" />
          <SkeletonText lines={4} className="mt-5" />
        </Card>
      ))}
    </div>
  );
}

/** One queue of everything the building agents want to send, across the whole portfolio. */
export function ApprovalsPage() {
  const portfolio = usePortfolio();
  const approvals = useResource("approvals", api.approvals);
  usePolling(() => void approvals.reload(), REFRESH_MS);

  const groups = useMemo(() => groupByProperty(approvals.data ?? []), [approvals.data]);
  const labelFor = (id: string) => {
    const card = portfolio.cardFor(id);
    return card ? propertyLabel(card.profile) : labelFromId(id);
  };

  const onDecided = (decided: Approval | null) => {
    if (decided) approvals.mutate((list = []) => list.filter((a) => a.id !== decided.id));
    void approvals.reload();
    void portfolio.reload();
  };

  const count = approvals.data?.length ?? 0;

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Every outbound email and contractor dispatch waits here for a person. Edit the draft if needed, then approve or reject."
        actions={approvals.data ? <Badge tone={count ? "amber" : "green"}>{count ? `${plural(count, "draft")} waiting` : "All clear"}</Badge> : null}
      />

      {approvals.loading ? (
        <QueueSkeleton />
      ) : approvals.error ? (
        <Card>
          <ErrorState error={approvals.error} onRetry={approvals.reload} title="Couldn't load approvals" />
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            icon="approve"
            title="All clear"
            description="No drafts are waiting. When a building agent wants to send a reply or dispatch a contractor, it will appear here first."
          />
        </Card>
      ) : (
        <div className="space-y-8">
          {groups.map(({ propertyId, items }) => (
            <section key={propertyId} aria-labelledby={`approvals-${propertyId}`}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 id={`approvals-${propertyId}`} className="text-sm font-semibold text-ink">
                  <Link href={paths.building(propertyId)} className="hover:text-accent hover:underline">
                    {labelFor(propertyId)}
                  </Link>
                </h2>
                <span className="text-xs text-muted">{plural(items.length, "draft")}</span>
              </div>
              <div className="space-y-4">
                {items.map((approval) => (
                  <ApprovalCard key={approval.id} approval={approval} onDecided={onDecided} context={{ propertyLabel: labelFor(propertyId) }} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
