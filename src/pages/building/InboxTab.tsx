import { useState } from "react";
import { CATEGORY_LABELS, type Thread } from "../../../shared/types";
import { api, type ThreadFilter } from "../../api";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState, ErrorState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { Link } from "../../components/Link";
import { SkeletonList } from "../../components/Skeleton";
import { ChannelIcon, PriorityBadge, ThreadStatusBadge } from "../../components/StatusBadges";
import { Segmented } from "../../components/Tabs";
import { useNow } from "../../hooks/useNow";
import { useResource } from "../../hooks/useResource";
import { cx } from "../../lib/cx";
import { formatDateTime, timeAgo } from "../../lib/format";
import { paths } from "../../router";
import { useBuilding } from "./BuildingContext";
import { ThreadDetail } from "./ThreadDetail";

type FilterKey = "open" | "awaiting_approval" | "all" | "closed";

const FILTERS: { value: FilterKey; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "awaiting_approval", label: "Needs approval" },
  { value: "all", label: "All" },
  { value: "closed", label: "Closed" },
];

const PRIORITY_EDGE = { P1: "before:bg-red-500", P2: "before:bg-amber-400", P3: "before:bg-transparent" } as const;

function ThreadRow({ thread, selected, now }: { thread: Thread; selected: boolean; now: number }) {
  const { propertyId } = useBuilding();
  const triage = thread.triage;
  return (
    <li>
      <Link
        href={paths.thread(propertyId, thread.id)}
        aria-current={selected ? "true" : undefined}
        className={cx(
          "relative block px-4 py-3.5 transition-colors before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r",
          triage ? PRIORITY_EDGE[triage.priority] : "before:bg-transparent",
          selected ? "bg-accent-soft/70" : "hover:bg-subtle",
        )}
      >
        <div className="flex items-center gap-2">
          {triage ? <PriorityBadge priority={triage.priority} /> : null}
          <span className={cx("min-w-0 flex-1 truncate text-sm", thread.status === "closed" ? "text-muted" : "font-semibold text-ink")}>
            {thread.subject || "(no subject)"}
          </span>
          <time dateTime={thread.updatedAt} title={formatDateTime(thread.updatedAt)} className="shrink-0 text-xs text-muted tabular-nums">
            {timeAgo(thread.updatedAt, now)}
          </time>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[13px] text-ink-soft">
          <ChannelIcon channel={thread.channel} className="size-3.5 text-muted" />
          <span className="truncate">{thread.fromName || thread.fromAddress}</span>
          {thread.simulated ? <span className="shrink-0 text-[11px] text-muted">· simulated</span> : null}
        </div>
        <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted">{triage?.summary || thread.preview}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <ThreadStatusBadge status={thread.status} />
          {triage ? <span className="text-xs text-muted">{CATEGORY_LABELS[triage.category]}</span> : null}
          {triage?.suspectedPromptInjection ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700">
              <Icon name="shield" className="size-3" /> Injection flagged
            </span>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

function ThreadList({ selectedId }: { selectedId: string | null }) {
  const { propertyId, refreshKey, openSimulate } = useBuilding();
  const [filter, setFilter] = useState<FilterKey>("open");
  const status: ThreadFilter | undefined = filter === "all" ? undefined : filter;
  const threads = useResource(`threads:${propertyId}:${filter}`, () => api.threads(propertyId, status), refreshKey);
  const now = useNow();

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="heading-display text-[13px] leading-6 text-ink">Threads</h2>
        <Segmented label="Filter threads" options={FILTERS} value={filter} onChange={setFilter} />
      </div>
      {threads.loading ? (
        <SkeletonList rows={6} />
      ) : threads.error ? (
        <ErrorState error={threads.error} onRetry={threads.reload} compact />
      ) : threads.data?.length ? (
        <ol className="max-h-[calc(100dvh-220px)] divide-y divide-line overflow-y-auto scrollbar-thin lg:min-h-[480px]" aria-label="Threads">
          {threads.data.map((thread) => (
            <ThreadRow key={thread.id} thread={thread} selected={thread.id === selectedId} now={now} />
          ))}
        </ol>
      ) : (
        <EmptyState
          compact
          icon="inbox"
          title={filter === "open" ? "Inbox zero" : "No threads here"}
          description={
            filter === "open"
              ? "New emails, SMS and portal messages to this building's agent will appear here, already triaged."
              : "Try a different filter."
          }
          action={
            filter === "open" ? (
              <Button size="sm" icon="send" onClick={openSimulate}>
                Simulate inbound
              </Button>
            ) : null
          }
        />
      )}
    </Card>
  );
}

export function InboxTab({ threadId }: { threadId: string | null }) {
  const { propertyId } = useBuilding();
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
      <div className={cx(threadId && "hidden lg:block")}>
        <ThreadList selectedId={threadId} />
      </div>
      <div className={cx(!threadId && "hidden lg:block")}>
        {threadId ? (
          <>
            <Link
              href={paths.building(propertyId, "inbox")}
              className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink lg:hidden"
            >
              <Icon name="chevronLeft" className="size-4" /> All threads
            </Link>
            <ThreadDetail key={threadId} threadId={threadId} />
          </>
        ) : (
          <Card>
            <EmptyState icon="mail" title="Select a thread" description="Pick a conversation to see the triage, the messages and any drafts waiting for approval." />
          </Card>
        )}
      </div>
    </div>
  );
}
