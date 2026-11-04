import { useState } from "react";
import type { Approval, Message } from "../../../shared/types";
import { api, isNotFound } from "../../api";
import { ApprovalCard } from "../../components/ApprovalCard";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState, ErrorState } from "../../components/EmptyState";
import { TextAreaField } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { Link } from "../../components/Link";
import { Skeleton, SkeletonText } from "../../components/Skeleton";
import {
  CHANNEL_META,
  PriorityBadge,
  TICKET_STATUS_LABELS,
  ThreadStatusBadge,
  triageEngineText,
} from "../../components/StatusBadges";
import { useToast } from "../../components/Toast";
import { PromptInjectionBanner, SafetyNotice, TriagePanel } from "../../components/TriagePanel";
import { useResource } from "../../hooks/useResource";
import { cx } from "../../lib/cx";
import { formatDateTime } from "../../lib/format";
import { paths } from "../../router";
import { useBuilding } from "./BuildingContext";

const DIRECTION: Record<Message["direction"], { label: string; className: string }> = {
  inbound: { label: "Received", className: "border-line bg-surface" },
  outbound: { label: "Sent", className: "border-line-strong bg-canvas" },
  internal: { label: "Internal note", className: "border-dashed border-line-strong bg-subtle" },
};

function MessageCard({ message }: { message: Message }) {
  const meta = DIRECTION[message.direction];
  return (
    <li className={cx("rounded-xl border px-4 py-3.5", meta.className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-[13px] text-ink-soft">
          <span className="font-semibold text-ink">{message.direction === "outbound" && message.author ? message.author : message.from}</span>
          <span className="text-muted"> to {message.to}</span>
          {message.senderVerified === false ? (
            <span
              className="ml-2 inline-flex items-center bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900 ring-1 ring-amber-200 ring-inset"
              title="This email did not pass SPF/DKIM/DMARC checks: the From address may be forged"
            >
              Unverified sender
            </span>
          ) : null}
        </p>
        <p className="text-xs text-muted">
          {meta.label} · {CHANNEL_META[message.channel].label} · <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
        </p>
      </div>
      {message.subject ? <p className="mt-1 text-[13px] font-medium text-ink">{message.subject}</p> : null}
      <div className="mt-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-ink-soft">{message.text}</div>
      {message.attachments.length ? (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Attachments">
          {message.attachments.map((a, i) => (
            <li key={`${a.name}-${i}`} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-soft">
              <Icon name="file" className="size-3.5 text-muted" />
              {a.name}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function DraftComposer({ threadId, onDrafted, onCancel }: { threadId: string; onDrafted: () => void; onCancel: () => void }) {
  const { propertyId } = useBuilding();
  const toast = useToast();
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);

  const draft = async () => {
    setBusy(true);
    try {
      await api.draftReply(propertyId, threadId, instructions.trim() || null);
      toast.success("Draft ready for approval", "Review it below before anything is sent.");
      onDrafted();
    } catch (err) {
      toast.error("Couldn't draft a reply", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="animate-rise-in p-4">
      <TextAreaField
        label="Instructions for the agent (optional)"
        hint="The agent drafts from the building's documents and contacts. The draft goes to the approval queue; nothing is sent."
        rows={3}
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        maxLength={4000}
        placeholder="e.g. Confirm the plumber is booked for this afternoon and ask for photos for the insurer."
        autoFocus
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" icon="sparkles" loading={busy} onClick={draft}>
          {busy ? "Drafting…" : "Draft reply"}
        </Button>
      </div>
    </Card>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading thread">
      <Card className="p-5">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="mt-3 h-3.5 w-1/3" />
      </Card>
      <Card className="p-5">
        <SkeletonText lines={5} />
      </Card>
    </div>
  );
}

/** Pending drafts: the reply to the sender first, then contractor dispatches, oldest first; decided ones newest first. */
function sortApprovals(approvals: Approval[]): { pending: Approval[]; decided: Approval[] } {
  const oldestFirst = [...approvals].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const kindRank = (a: Approval) => (a.kind === "send_email" ? 0 : 1);
  return {
    pending: oldestFirst.filter((a) => a.status === "pending").sort((a, b) => kindRank(a) - kindRank(b)),
    decided: oldestFirst.filter((a) => a.status !== "pending").reverse(),
  };
}

export function ThreadDetail({ threadId }: { threadId: string }) {
  const { propertyId, refreshKey, reloadOverview } = useBuilding();
  const toast = useToast();
  const detail = useResource(`thread:${propertyId}:${threadId}`, () => api.thread(propertyId, threadId), refreshKey);
  const [composing, setComposing] = useState(false);
  const [action, setAction] = useState<"retriage" | "close" | null>(null);

  const refresh = () => {
    void detail.reload();
    void reloadOverview();
  };

  const run = async (kind: "retriage" | "close") => {
    setAction(kind);
    try {
      if (kind === "retriage") {
        const triage = await api.retriage(propertyId, threadId);
        toast.success("Re-triaged", `${triage.priority} · ${triageEngineText(triage)}`);
      } else {
        await api.closeThread(propertyId, threadId);
        toast.success("Thread closed");
      }
      refresh();
    } catch (err) {
      toast.error(kind === "retriage" ? "Couldn't re-triage" : "Couldn't close the thread", err);
    } finally {
      setAction(null);
    }
  };

  if (detail.loading) return <DetailSkeleton />;
  if (detail.error) {
    return isNotFound(detail.error) ? (
      <Card>
        <EmptyState icon="inbox" title="Thread not found" description="It may have been removed, or the link is from another building." />
      </Card>
    ) : (
      <Card>
        <ErrorState error={detail.error} onRetry={detail.reload} title="Couldn't load this thread" />
      </Card>
    );
  }
  if (!detail.data) return null;

  const { thread, messages, approvals, ticket } = detail.data;
  const { triage } = thread;
  const { pending, decided } = sortApprovals(approvals);
  const closed = thread.status === "closed";

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              {triage ? <PriorityBadge priority={triage.priority} withLabel /> : null}
              <ThreadStatusBadge status={thread.status} />
              {thread.simulated ? <span className="text-xs text-muted">Simulated</span> : null}
            </div>
            <h2 className="text-lg leading-snug font-semibold text-ink">{thread.subject || "(no subject)"}</h2>
            <p className="mt-1 text-[13px] text-muted">
              From <span className="font-medium text-ink-soft">{thread.fromName ? `${thread.fromName} <${thread.fromAddress}>` : thread.fromAddress}</span> via{" "}
              {CHANNEL_META[thread.channel].label} · {formatDateTime(thread.createdAt)}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {!closed ? (
            <Button size="sm" variant={pending.length || triage?.suspectedPromptInjection ? "secondary" : "primary"} icon="sparkles" onClick={() => setComposing((c) => !c)} aria-expanded={composing}>
              Draft reply
            </Button>
          ) : null}
          <Button size="sm" icon="refresh" loading={action === "retriage"} disabled={action !== null} onClick={() => run("retriage")}>
            Re-triage
          </Button>
          {!closed ? (
            <Button size="sm" variant="ghost" icon="check" loading={action === "close"} disabled={action !== null} onClick={() => run("close")}>
              Close
            </Button>
          ) : null}
          {pending.length ? (
            <a href="#approvals" className="ml-auto inline-flex h-8 items-center gap-1.5 px-2 text-[13px] font-medium link-brand">
              <Icon name="clock" className="size-3.5 text-taupe" />
              {pending.length === 1 ? "1 draft awaiting approval" : `${pending.length} drafts awaiting approval`}
            </a>
          ) : null}
        </div>
      </Card>

      {composing ? (
        <DraftComposer
          threadId={threadId}
          onCancel={() => setComposing(false)}
          onDrafted={() => {
            setComposing(false);
            refresh();
          }}
        />
      ) : null}

      {triage?.suspectedPromptInjection ? <PromptInjectionBanner /> : null}
      {triage?.safetyNotice ? <SafetyNotice text={triage.safetyNotice} /> : null}

      {/* The decision is the main action, so the drafts come before the triage detail and the conversation. */}
      {pending.length ? (
        <section id="approvals" aria-labelledby="approvals-heading" className="scroll-mt-20 space-y-3">
          <h3 id="approvals-heading" className="heading-display text-xs text-ink-soft">
            Awaiting your approval
          </h3>
          {pending.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} onDecided={refresh} />
          ))}
        </section>
      ) : null}

      {triage ? (
        <TriagePanel triage={triage} />
      ) : (
        <Card>
          <EmptyState compact icon="bolt" title="Not triaged yet" description="The agent is still working on this message, or triage failed. Re-triage to try again." />
        </Card>
      )}

      {ticket ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-8 place-items-center rounded-lg bg-subtle text-muted ring-1 ring-line">
              <Icon name="board" className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">
                <span className="text-[13px] font-medium tracking-[0.02em] text-muted tabular-nums">{ticket.number}</span> {ticket.title}
              </p>
              <p className="text-xs text-muted">Work order · {TICKET_STATUS_LABELS[ticket.status]}</p>
            </div>
          </div>
          <Link href={paths.building(propertyId, "work-orders")} className="inline-flex items-center gap-1 text-[13px] font-medium link-brand">
            View work orders <Icon name="arrowRight" className="size-3.5" />
          </Link>
        </Card>
      ) : null}

      <section aria-labelledby="conversation-heading">
        <h3 id="conversation-heading" className="heading-display mb-2 text-xs text-ink-soft">
          Conversation ({messages.length})
        </h3>
        <ol className="space-y-3">
          {messages.map((message) => (
            <MessageCard key={message.id} message={message} />
          ))}
        </ol>
      </section>

      {decided.length ? (
        <section aria-labelledby="history-heading" className="space-y-3">
          <h3 id="history-heading" className="heading-display text-xs text-ink-soft">
            Decided
          </h3>
          {decided.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} onDecided={refresh} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
