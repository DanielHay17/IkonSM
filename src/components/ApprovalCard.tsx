import { useEffect, useId, useMemo, useState } from "react";
import { renderEmailHtml } from "../../shared/email-html";
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
import { ConfirmDialog, Modal } from "./Modal";
import { usePortfolio } from "../providers/PortfolioProvider";
import { useSession } from "../providers/SessionProvider";
import { ApprovalStatusBadge, draftEngineText } from "./StatusBadges";
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
                <Link href={paths.vaultDoc(propertyId, citation.docId)} className="truncate link-brand">
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const { session } = useSession();
  const profile = usePortfolio().cardFor(approval.propertyId)?.profile ?? null;
  // The building's own address, as the recipient sees it.
  const fromAddress = profile?.emailAddress ?? null;
  const fromLabel = profile && fromAddress ? `${session.companyName} - SP ${profile.spNumber} <${fromAddress}>` : null;

  // A fresh draft for the same card (re-draft) replaces local edits.
  useEffect(() => {
    setSubject(approval.draft.subject);
    setBody(approval.draft.body);
  }, [approval.id, approval.draft.subject, approval.draft.body]);

  const pending = approval.status === "pending";
  const superseded = isSuperseded(approval);
  const edited = subject !== approval.draft.subject || body !== approval.draft.body;
  const recipient = approval.draft.toName ? `${approval.draft.toName} <${approval.draft.to}>` : approval.draft.to;
  // One notice for everything to check before approving (amber is for SAMPLE-data warnings).
  const usesSample = pending && /\bSAMPLE\b/.test(approval.rationale);
  // Template rationales already open with "Template draft (AI offline)": don't say it twice.
  const engineSaid = approval.engine === "template" && /^template draft/i.test(approval.rationale);
  const checks = [
    usesSample ? "uses SAMPLE records" : null,
    pending && approval.simulated ? "replies to a simulated message (approving still sends a real email)" : null,
  ].filter(Boolean);

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
    // A pending draft carries a charcoal rule down its left edge; the heading above already says it awaits approval.
    <Card className={cx("overflow-hidden", pending && "border-l-2 border-l-ink")}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          {context ? (
            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <Link href={paths.building(approval.propertyId)} className="font-medium text-ink-soft link-brand">
                {context.propertyLabel}
              </Link>
              {approval.threadId ? (
                <>
                  <span aria-hidden="true">·</span>
                  <Link href={paths.thread(approval.propertyId, approval.threadId)} className="inline-flex items-center gap-1 text-ink-soft link-brand">
                    Open thread <Icon name="arrowRight" className="size-3" />
                  </Link>
                </>
              ) : null}
            </div>
          ) : null}
          <h3 className="text-[15px] leading-snug font-semibold text-ink">{approval.title}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={approval.kind === "dispatch_contractor" ? "charcoal" : "accent"} icon={approval.kind === "dispatch_contractor" ? "wrench" : "mail"}>
              {KIND_LABEL[approval.kind]}
            </Badge>
            {superseded ? <Badge tone="neutral">Replaced</Badge> : !pending ? <ApprovalStatusBadge status={approval.status} /> : null}
            <span className="text-xs text-muted" title={formatDateTime(approval.createdAt)}>
              {approval.createdBy === "agent" ? "Agent" : approval.createdBy} · {timeAgo(approval.createdAt)}
              {!pending && approval.simulated ? " · simulated" : ""}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        {checks.length ? (
          <p
            className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900 ring-1 ring-amber-200 ring-inset"
            title={usesSample ? "The draft relies on SAMPLE documents or contacts: check every fact before sending" : undefined}
          >
            <Icon name="alert" className="mt-0.5 size-3.5 shrink-0 text-amber-700" />
            <span>
              <span className="font-medium">Check before sending: </span>
              {checks.join(" · ")}.
            </span>
          </p>
        ) : null}
        {/* The engine sits with the reason, so AI and template drafts are never confused, without another badge. */}
        <p className="flex gap-2 text-[13px] text-ink-soft">
          <Icon name={approval.engine === "template" ? "file" : "sparkles"} className="mt-0.5 size-3.5 shrink-0 text-taupe" />
          <span>
            {approval.rationale ? (
              <>
                <span className="font-medium text-ink">Why: </span>
                {approval.rationale}
              </>
            ) : null}
            {engineSaid ? null : (
              <span className="text-muted">
                {approval.rationale ? " · " : ""}
                {draftEngineText(approval)}
              </span>
            )}
          </span>
        </p>

        <div className="rounded-lg border border-line">
          {fromLabel ? (
            <div className="flex items-center gap-2 border-b border-line bg-subtle px-3 py-2 text-[13px]">
              <span className="w-14 shrink-0 text-muted">From</span>
              <span className="min-w-0 text-ink-soft [overflow-wrap:anywhere]">{fromLabel}</span>
            </div>
          ) : null}
          <div className="flex items-center gap-2 border-b border-line bg-subtle px-3 py-2 text-[13px]">
            <span className="w-14 shrink-0 text-muted">To</span>
            <span className="min-w-0 flex-1 font-medium text-ink [overflow-wrap:anywhere]">{recipient}</span>
            {profile && fromAddress ? (
              <button type="button" onClick={() => setPreviewOpen(true)} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium link-brand">
                <Icon name="eye" className="size-3.5" />
                Preview email
              </button>
            ) : null}
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
                <span className="font-medium text-ink">Edited: your changes will be sent.</span>
                <button
                  type="button"
                  className="font-medium link-brand"
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
      {profile && fromAddress ? (
        <EmailPreview
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          subject={pending ? subject : approval.draft.subject}
          body={pending ? body : approval.draft.body}
          from={fromLabel ?? fromAddress}
          to={recipient}
          html={{ companyName: session.companyName, property: profile, fromAddress }}
        />
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

/** The email exactly as it will arrive: the branded HTML the Worker sends, rendered from the current text. */
function EmailPreview({
  open,
  onClose,
  subject,
  body,
  from,
  to,
  html,
}: {
  open: boolean;
  onClose: () => void;
  subject: string;
  body: string;
  from: string;
  to: string;
  html: { companyName: string; property: { spNumber: string; street: string; suburb: string; postcode?: string | null }; fromAddress: string };
}) {
  const srcDoc = useMemo(
    () =>
      open
        ? renderEmailHtml({ subject, body, companyName: html.companyName, property: html.property, fromAddress: html.fromAddress, logoUrl: `${window.location.origin}/brand/email-logo.png` })
        : "",
    [open, subject, body, html.companyName, html.property, html.fromAddress],
  );
  return (
    <Modal open={open} onClose={onClose} title="Email preview" description="How the recipient sees it. Your edits are included; nothing is sent from here." size="lg" plainTitle>
      <dl className="mb-3 grid grid-cols-[4rem_1fr] gap-x-2 gap-y-1 text-[13px]">
        <dt className="text-muted">From</dt>
        <dd className="text-ink [overflow-wrap:anywhere]">{from}</dd>
        <dt className="text-muted">To</dt>
        <dd className="text-ink [overflow-wrap:anywhere]">{to}</dd>
        <dt className="text-muted">Subject</dt>
        <dd className="font-medium text-ink [overflow-wrap:anywhere]">{subject}</dd>
      </dl>
      {/* No scripts can run (sandbox without allow-scripts); same origin only so the logo and CSP resolve. */}
      <iframe title={`Preview: ${subject}`} srcDoc={srcDoc} sandbox="allow-same-origin" className="h-[65vh] w-full border border-line bg-canvas" />
    </Modal>
  );
}
