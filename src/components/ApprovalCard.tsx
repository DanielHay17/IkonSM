import { useEffect, useId, useState } from "react";
import type { Approval, ApprovalDecision, Citation } from "../../shared/types";
import { api, ApiError } from "../api";
import { cx } from "../lib/cx";
import { formatDateTime, timeAgo } from "../lib/format";
import { paths } from "../router";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { inputClasses, textareaClasses } from "./Field";
import { Icon } from "./Icon";
import { Link } from "./Link";
import { ConfirmDialog } from "./Modal";
import { ApprovalStatusBadge, DraftEngineBadge } from "./StatusBadges";
import { useToast } from "./Toast";

interface ApprovalCardProps {
  approval: Approval;
  /** Called with the decided approval (or with nothing when it should be refetched). */
  onDecided: (approval: Approval | null) => void;
  /** Shown on the portfolio queue: which building and thread this belongs to. */
  context?: { propertyLabel: string };
}

const KIND_LABEL: Record<Approval["kind"], string> = {
  send_email: "Reply",
  dispatch_contractor: "Contractor dispatch",
};

/** A pending reply replaced by a newer draft is recorded as "rejected" with this result. */
function isSuperseded(approval: Approval): boolean {
  return approval.status === "rejected" && approval.decidedBy === "agent" && /^Superseded/.test(approval.result ?? "");
}

/** Textarea height that shows the whole draft: wrapped lines at about 90 characters, 8 to 40 rows. */
function draftRows(body: string): number {
  const lines = body.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 90)), 0);
  return Math.min(40, Math.max(8, lines + 1));
}

export function CitationList({ citations, propertyId }: { citations: Citation[]; propertyId?: string }) {
  if (citations.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Sources ({citations.length})</p>
      <ul className="space-y-2">
        {citations.map((citation, i) => (
          <li key={`${citation.docId}-${i}`} className="rounded-lg border border-line bg-subtle px-3 py-2.5">
            <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
              <Icon name="file" className="size-3.5 text-muted" />
              {propertyId ? (
                <Link href={paths.vaultDoc(propertyId, citation.docId)} className="truncate hover:text-accent hover:underline">
                  {citation.docName}
                </Link>
              ) : (
                <span className="truncate">{citation.docName}</span>
              )}
            </div>
            {citation.snippet ? <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted">{citation.snippet}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Asks before it acts": one outbound email the agent wants to send, editable until a human decides. */
export function ApprovalCard({ approval, onDecided, context }: ApprovalCardProps) {
  const toast = useToast();
  const subjectId = useId();
  const bodyId = useId();
  const [subject, setSubject] = useState(approval.draft.subject);
  const [body, setBody] = useState(approval.draft.body);
  const [busy, setBusy] = useState<ApprovalDecision["decision"] | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);

  // A fresh draft for the same card (re-draft) replaces local edits.
  useEffect(() => {
    setSubject(approval.draft.subject);
    setBody(approval.draft.body);
  }, [approval.id, approval.draft.subject, approval.draft.body]);

  const pending = approval.status === "pending";
  const superseded = isSuperseded(approval);
  const edited = subject !== approval.draft.subject || body !== approval.draft.body;
  const recipient = approval.draft.toName ? `${approval.draft.toName} <${approval.draft.to}>` : approval.draft.to;

  const decide = async (decision: ApprovalDecision["decision"]) => {
    setBusy(decision);
    try {
      const payload: ApprovalDecision =
        decision === "approve" && edited ? { decision, edits: { subject, body } } : { decision };
      const result = await api.decideApproval(approval.propertyId, approval.id, payload);
      if (result.status === "failed") toast.error("The email could not be sent", result.result ?? undefined);
      else if (result.status === "approved") toast.success("Approved and sent", `To ${recipient}`);
      else toast.info("Draft rejected", "Nothing was sent.");
      onDecided(result);
    } catch (err) {
      toast.error(decision === "approve" ? "Couldn't approve" : "Couldn't reject", err);
      if (err instanceof ApiError && err.status === 409) onDecided(null);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className={cx("overflow-hidden", pending && "border-amber-200 ring-1 ring-amber-100")}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          {context ? (
            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <Link href={paths.building(approval.propertyId)} className="font-medium text-ink-soft hover:text-accent hover:underline">
                {context.propertyLabel}
              </Link>
              {approval.threadId ? (
                <>
                  <span aria-hidden="true">·</span>
                  <Link href={paths.thread(approval.propertyId, approval.threadId)} className="inline-flex items-center gap-1 hover:text-accent hover:underline">
                    Open thread <Icon name="arrowRight" className="size-3" />
                  </Link>
                </>
              ) : null}
            </div>
          ) : null}
          <h3 className="text-[15px] leading-snug font-semibold text-ink">{approval.title}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={approval.kind === "dispatch_contractor" ? "violet" : "sky"} icon={approval.kind === "dispatch_contractor" ? "wrench" : "mail"}>
              {KIND_LABEL[approval.kind]}
            </Badge>
            <DraftEngineBadge approval={approval} />
            {pending && /\bSAMPLE\b/.test(approval.rationale) ? (
              <Badge tone="amber" icon="alert" title="The draft relies on SAMPLE documents or contacts: check every fact before sending">
                Uses SAMPLE records
              </Badge>
            ) : null}
            {approval.simulated ? (
              <Badge tone="amber" icon="alert" title="This came from the Simulate panel, but approving still sends a real email">
                Simulated message
              </Badge>
            ) : null}
            {superseded ? <Badge tone="neutral">Replaced</Badge> : !pending ? <ApprovalStatusBadge status={approval.status} /> : null}
            <span className="text-xs text-muted" title={formatDateTime(approval.createdAt)}>
              {approval.createdBy === "agent" ? "Agent" : approval.createdBy} · {timeAgo(approval.createdAt)}
            </span>
          </div>
        </div>
        {pending ? <ApprovalStatusBadge status="pending" /> : null}
      </div>

      <div className="space-y-4 px-5 py-4">
        {approval.rationale ? (
          <p className="flex gap-2 text-[13px] text-ink-soft">
            <Icon name="sparkles" className="mt-0.5 size-3.5 text-accent" />
            <span>
              <span className="font-medium text-ink">Why: </span>
              {approval.rationale}
            </span>
          </p>
        ) : null}

        <div className="rounded-lg border border-line">
          <div className="flex items-center gap-2 border-b border-line bg-subtle px-3 py-2 text-[13px]">
            <span className="w-14 shrink-0 text-muted">To</span>
            <span className="min-w-0 font-medium text-ink [overflow-wrap:anywhere]">{recipient}</span>
          </div>
          {pending ? (
            <div className="space-y-3 p-3">
              <div>
                <label htmlFor={subjectId} className="mb-1 block text-xs font-medium text-muted">
                  Subject
                </label>
                <input id={subjectId} value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClasses(undefined, "h-9")} />
              </div>
              <div>
                <label htmlFor={bodyId} className="mb-1 block text-xs font-medium text-muted">
                  Message
                </label>
                <textarea
                  id={bodyId}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={draftRows(body)}
                  className={textareaClasses("max-h-[70vh] text-[13px]!")}
                />
              </div>
            </div>
          ) : (
            <details className="group">
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px] text-ink-soft hover:text-ink">
                <Icon name="chevronRight" className="size-3.5 transition-transform group-open:rotate-90" />
                <span className="truncate font-medium">{approval.draft.subject}</span>
              </summary>
              <pre className="border-t border-line px-3 py-3 font-sans text-[13px] leading-relaxed whitespace-pre-wrap text-ink-soft">
                {approval.draft.body}
              </pre>
            </details>
          )}
        </div>

        <CitationList citations={approval.citations} propertyId={approval.propertyId} />

        {superseded ? (
          <div className="rounded-lg bg-subtle px-3 py-2 text-[13px] text-ink-soft">
            Replaced by a newer draft{approval.decidedAt ? ` · ${formatDateTime(approval.decidedAt)}` : ""}
          </div>
        ) : !pending && (approval.decidedBy || approval.result) ? (
          <div
            className={cx(
              "rounded-lg px-3 py-2 text-[13px]",
              approval.status === "failed" ? "bg-red-50 text-red-800" : "bg-subtle text-ink-soft",
            )}
          >
            {approval.decidedBy ? (
              <p>
                {approval.status === "rejected" ? "Rejected" : "Approved"} by <span className="font-medium">{approval.decidedBy}</span>
                {approval.decidedAt ? ` · ${formatDateTime(approval.decidedAt)}` : ""}
              </p>
            ) : null}
            {approval.result ? <p className="mt-0.5 break-words">{approval.result}</p> : null}
          </div>
        ) : null}
      </div>

      {pending ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-subtle px-5 py-3">
          <p className="text-xs text-muted">
            {edited ? (
              <span className="inline-flex items-center gap-2">
                <span className="font-medium text-amber-800">Edited: your changes will be sent.</span>
                <button
                  type="button"
                  className="font-medium text-accent hover:underline"
                  onClick={() => {
                    setSubject(approval.draft.subject);
                    setBody(approval.draft.body);
                  }}
                >
                  Undo edits
                </button>
              </span>
            ) : (
              "Nothing is sent until you approve."
            )}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" icon="close" loading={busy === "reject"} disabled={busy !== null} onClick={() => setConfirmReject(true)}>
              Reject
            </Button>
            <Button
              variant="primary"
              icon="send"
              loading={busy === "approve"}
              disabled={busy !== null || !subject.trim() || !body.trim()}
              onClick={() => decide("approve")}
            >
              Approve &amp; send
            </Button>
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmReject}
        onClose={() => setConfirmReject(false)}
        onConfirm={() => decide("reject")}
        title="Reject this draft?"
        description="Nothing will be sent. You can draft a new reply from the thread later."
        confirmLabel="Reject draft"
      />
    </Card>
  );
}
