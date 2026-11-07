// The handover invitation: Peter's card (saved drafts, Prepare handover draft, the email-delivery note) plus
// the live link (Copy, Preview letter, Withdraw, access stats and the letter's state in Approvals), drafts
// ready to activate, and the history of requests. The letter preview renders the email exactly as sent.
// A closed project shows all this as history, without the buttons that would change it.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { renderEmailHtml } from "../../../shared/email-html";
import { formatLongDate } from "../../../shared/handover-letter";
import {
  inviteDatesProblem,
  STAFF_DIRECTORY,
  STAFF_ROLE_LABELS,
  staffById,
  type HandoverInvite,
  type OnboardingProject,
} from "../../../shared/onboarding";
import type { Approval } from "../../../shared/types";
import { api, onboardingApi } from "../../api";
import { Button } from "../../components/Button";
import { ErrorState, FormError } from "../../components/EmptyState";
import { SelectField, TextField, inputClasses } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { Link } from "../../components/Link";
import { ConfirmDialog, Modal } from "../../components/Modal";
import { Skeleton } from "../../components/Skeleton";
import { Spinner } from "../../components/Spinner";
import { ApprovalStatusBadge } from "../../components/StatusBadges";
import { useToast } from "../../components/Toast";
import { useNow } from "../../hooks/useNow";
import { useResource } from "../../hooks/useResource";
import { formatDateTime, plural, timeAgo, timeAgoLong } from "../../lib/format";
import { usePortfolio } from "../../providers/PortfolioProvider";
import { useSession } from "../../providers/SessionProvider";
import { paths } from "../../router";
import { inviteBuckets, localDay } from "./derive";
import { InviteStatusBadge, useActingStaff } from "./ui";

/** Copies text, with a fallback for plain-http LAN addresses where the Clipboard API is unavailable. */
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("Copy is not available in this browser");
}

function CopyLinkButton({ url }: { url: string | null }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [state]);
  return (
    <Button
      size="sm"
      variant="secondary"
      icon={state === "copied" ? "check" : "copy"}
      disabled={!url}
      onClick={() => {
        if (!url) return;
        copyText(url).then(
          () => setState("copied"),
          () => setState("failed"),
        );
      }}
    >
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy link"}</span>
    </Button>
  );
}

function outgoingLabel(invite: HandoverInvite): string {
  return `${invite.outgoingManager.name}, ${invite.outgoingManager.company}`;
}

/** "Opened 3 times, last 2 hours ago" */
function accessText(invite: HandoverInvite, now: number): string {
  if (!invite.accessCount) return "Not opened yet";
  const times = invite.accessCount === 1 ? "once" : `${invite.accessCount} times`;
  return `Opened ${times}${invite.lastAccessAt ? `, last ${timeAgoLong(invite.lastAccessAt, now)}` : ""}`;
}

/** The link with the middle of its token hidden (for screen-sharing); Copy link still copies all of it. */
export function maskedLink(url: string): string {
  return url.replace(/(\/handover\/\d{3,6}-)([A-Za-z0-9_-]{4})[A-Za-z0-9_-]+([A-Za-z0-9_-]{4})$/, "$1$2…$3");
}

/** Whether the letter has gone: sent (approved and delivered), still waiting, or stopped (rejected or failed). */
type LetterState = "pending" | "sent" | "stopped" | "unknown";

function letterState(approval: Approval | null): LetterState {
  if (!approval) return "unknown";
  if (approval.status === "pending") return "pending";
  if (approval.status === "approved") return "sent";
  return "stopped";
}

function useLetterApproval(propertyId: string, invite: HandoverInvite) {
  const approvals = useResource<Approval[]>(invite.approvalId ? `approvals:${propertyId}:${invite.approvalId}` : null, () => api.propertyApprovals(propertyId));
  const approval = approvals.data?.find((a) => a.id === invite.approvalId) ?? null;
  return { approval, loading: approvals.loading, state: letterState(approval) };
}

function DatesLine({ invite }: { invite: HandoverInvite }) {
  const incoming = staffById(invite.incomingManagerId);
  return (
    <p className="text-[13px] text-ink-soft">
      Incoming manager {incoming ? `${incoming.name}, ${incoming.title}` : invite.incomingManagerId} · Records due {formatLongDate(invite.recordsDueDate)} · Handover{" "}
      {formatLongDate(invite.handoverDate)}
    </p>
  );
}

/** The letter's approval in this building's Approvals: its status, so staff know whether it has gone. */
function LetterApprovalLine({
  invite,
  approval,
  loading,
  onWithdraw,
}: {
  invite: HandoverInvite;
  approval: Approval | null;
  loading: boolean;
  /** Offered when the letter was rejected but the link still works. */
  onWithdraw: (() => void) | null;
}) {
  if (!invite.approvalId) return null;
  const state = letterState(approval);
  const live = invite.status === "active" || invite.status === "submitted";
  return (
    <div className="flex flex-wrap items-start gap-2 border-t border-line pt-3 text-[13px] text-ink-soft">
      <Icon name="mail" className="mt-0.5 size-4 text-taupe" />
      <div className="min-w-0 flex-1">
        {state === "sent" ? (
          <p>
            The handover letter was sent to {invite.outgoingManager.name}
            {approval?.decidedAt ? ` (${formatDateTime(approval.decidedAt, true)})` : ""}
            {approval?.decidedBy ? `, approved by ${approval.decidedBy}` : ""}.
          </p>
        ) : state === "stopped" ? (
          <>
            <p>
              The handover letter to {invite.outgoingManager.name} was {approval?.status === "failed" ? "not delivered" : "rejected"} in{" "}
              <Link href={paths.approvals()} className="font-medium link-brand">
                Approvals
              </Link>
              , so nothing was sent.{live ? " The link itself still works." : ""}
            </p>
            {live && onWithdraw ? (
              <Button size="sm" variant="dangerGhost" icon="close" className="mt-2" onClick={onWithdraw}>
                Withdraw the link
              </Button>
            ) : null}
          </>
        ) : (
          <p>
            The handover letter to {invite.outgoingManager.name} is a draft in{" "}
            <Link href={paths.approvals()} className="font-medium link-brand">
              Approvals
            </Link>
            . Nothing is sent until someone approves it. Before approving, confirm the email address and the new trust account details with the
            outgoing manager by phone.
          </p>
        )}
      </div>
      {approval ? <ApprovalStatusBadge status={approval.status} /> : loading ? <Spinner className="size-3.5 text-muted" /> : null}
    </div>
  );
}

function CurrentLink({
  propertyId,
  invite,
  freshUrl,
  onPreview,
  onRevoke,
  readOnly,
}: {
  propertyId: string;
  invite: HandoverInvite;
  /** The URL returned on activation, shown straight away. */
  freshUrl: string | null;
  onPreview: () => void;
  onRevoke: () => void;
  readOnly: boolean;
}) {
  const now = useNow(60_000);
  const linkable = invite.status === "active" || invite.status === "submitted";
  const link = useResource(linkable && !freshUrl ? `invite-link:${propertyId}:${invite.id}` : null, () => onboardingApi.inviteLink(propertyId, invite.id));
  const url = freshUrl ?? link.data?.url ?? null;
  const urlId = `invite-url-${invite.id}`;
  const [shown, setShown] = useState(false);
  const letter = useLetterApproval(propertyId, invite);

  return (
    <div className="mt-5 space-y-3 border border-line bg-subtle px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <InviteStatusBadge status={invite.status} />
        <p className="min-w-0 text-sm font-medium text-ink [overflow-wrap:anywhere]">
          {/* "Sent to" only once the letter has actually gone; until then the link is just prepared for them. */}
          {letter.state === "sent" ? "Letter sent to" : "Link for"} {outgoingLabel(invite)} <span className="font-normal text-muted">({invite.outgoingManager.email})</span>
        </p>
      </div>
      <DatesLine invite={invite} />
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-soft">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="eye" className="size-3.5 text-taupe" />
          {accessText(invite, now)}
        </span>
        {invite.submittedAt ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-emerald-800">
            <Icon name="check" className="size-3.5" />
            Pack submitted {formatDateTime(invite.submittedAt)}
          </span>
        ) : null}
        {invite.expiresAt ? <span className="text-muted">Link expires {formatLongDate(invite.expiresAt)}</span> : null}
      </p>
      {linkable ? (
        <div>
          <label htmlFor={urlId} className="mb-1 block text-xs font-medium text-muted">
            Secure upload link for the outgoing manager
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {url ? (
              <input
                id={urlId}
                readOnly
                value={shown ? url : maskedLink(url)}
                onFocus={(e) => e.currentTarget.select()}
                className={inputClasses("min-w-0 flex-1 text-[13px]", "h-9")}
              />
            ) : link.error ? (
              <p id={urlId} className="flex-1 text-[13px] text-red-700">
                Couldn't load the link. {link.error.message}
              </p>
            ) : (
              <Skeleton className="h-9 flex-1" />
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" icon="eye" disabled={!url} onClick={() => setShown((s) => !s)} aria-pressed={shown}>
                {shown ? "Hide" : "Show"}
                <span className="sr-only"> the full link</span>
              </Button>
              <CopyLinkButton url={url} />
            </div>
          </div>
          {shown ? null : <p className="mt-1 text-xs text-muted">Part of the link is hidden on screen. Copy link copies all of it.</p>}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon="eye" onClick={onPreview}>
          Preview letter
        </Button>
        {(invite.status === "active" || invite.status === "submitted") && !readOnly ? (
          <Button size="sm" variant="dangerGhost" icon="close" onClick={onRevoke}>
            Withdraw link
          </Button>
        ) : null}
      </div>
      <LetterApprovalLine invite={invite} approval={letter.approval} loading={letter.loading} onWithdraw={readOnly ? null : onRevoke} />
    </div>
  );
}

function DraftRow({
  invite,
  onPreview,
  onActivate,
  onDiscard,
  readOnly,
}: {
  invite: HandoverInvite;
  onPreview: () => void;
  onActivate: () => void;
  onDiscard: () => void;
  readOnly: boolean;
}) {
  return (
    <li className="space-y-2 border border-line px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <InviteStatusBadge status="draft" />
        <p className="min-w-0 text-sm font-medium text-ink [overflow-wrap:anywhere]">
          {outgoingLabel(invite)} <span className="font-normal text-muted">({invite.outgoingManager.email})</span>
        </p>
      </div>
      <DatesLine invite={invite} />
      <p className="text-xs text-muted">
        Prepared by {invite.createdBy} · <span title={formatDateTime(invite.createdAt)}>{timeAgo(invite.createdAt)}</span>
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        {readOnly ? null : (
          <Button size="sm" variant="primary" icon="link" onClick={onActivate}>
            Activate link
          </Button>
        )}
        <Button size="sm" variant="secondary" icon="eye" onClick={onPreview}>
          Preview letter
        </Button>
        {readOnly ? null : (
          <Button size="sm" variant="dangerQuiet" icon="trash" onClick={onDiscard}>
            Discard draft
          </Button>
        )}
      </div>
    </li>
  );
}

/** Every invitation for the project, newest first ("View handover requests"). */
function RequestsList({ id, invites, onPreview }: { id: string; invites: HandoverInvite[]; onPreview: (invite: HandoverInvite) => void }) {
  return (
    <div id={id} className="mt-5 scroll-mt-24">
      <h4 className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">Handover requests ({invites.length})</h4>
      {invites.length === 0 ? (
        <p className="text-[13px] text-muted">No handover requests yet. Prepare a draft to start one.</p>
      ) : (
        <ul className="divide-y divide-line border border-line">
          {invites.map((invite) => (
            <li key={invite.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[13px]">
              <InviteStatusBadge status={invite.status} />
              <span className="min-w-0 flex-1 text-ink [overflow-wrap:anywhere]">{outgoingLabel(invite)}</span>
              <span className="text-xs text-muted">
                {invite.activatedAt ? `Activated ${formatLongDate(invite.activatedAt)}` : `Prepared ${formatLongDate(invite.createdAt)}`}
                {invite.revokedAt ? ` · withdrawn ${formatLongDate(invite.revokedAt)}` : ""}
                {invite.accessCount ? ` · opened ${plural(invite.accessCount, "time")}` : ""}
              </span>
              <button type="button" onClick={() => onPreview(invite)} className="min-h-6 px-1 text-xs font-medium link-brand">
                Letter<span className="sr-only"> to {invite.outgoingManager.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function InvitationCard({
  propertyId,
  spNumber,
  project,
  onChanged,
  showRequests = false,
  anchorId = "handover-invitation",
}: {
  propertyId: string;
  spNumber: string;
  project: OnboardingProject;
  /** Called after any change (draft saved, link activated or revoked) so the caller refetches. */
  onChanged: () => void;
  /** The project overview lists every request; the dashboard links to it. */
  showRequests?: boolean;
  /** The section's id (the map links to "handover-invitation" on the overview; the dashboard has one per project). */
  anchorId?: string;
}) {
  const toast = useToast();
  const { drafts, current } = inviteBuckets(project.invites);
  const [prepareOpen, setPrepareOpen] = useState(false);
  const [activating, setActivating] = useState<HandoverInvite | null>(null);
  const [preview, setPreview] = useState<HandoverInvite | null>(null);
  const [revoking, setRevoking] = useState<HandoverInvite | null>(null);
  const [fresh, setFresh] = useState<{ inviteId: string; url: string } | null>(null);
  const requestsId = `handover-requests-${propertyId}`;
  const all = useMemo(() => [...project.invites].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [project.invites]);
  const headingId = `invitation-${project.id}`;
  const readOnly = project.status === "closed";

  const revoke = async (invite: HandoverInvite) => {
    await onboardingApi.revokeInvite(propertyId, invite.id);
    toast.success(invite.status === "draft" ? "Draft discarded" : "Link withdrawn", invite.status === "draft" ? undefined : `${invite.outgoingManager.name} can no longer open the portal.`);
    if (fresh?.inviteId === invite.id) setFresh(null);
    onChanged();
  };

  return (
    <section id={anchorId} aria-labelledby={headingId} className="scroll-mt-24 border border-line border-t-2 border-t-ink bg-surface px-5 py-5 shadow-card sm:px-6">
      <h3 id={headingId} tabIndex={-1} className="heading-display text-[15px] leading-6 text-ink focus:outline-none">
        Handover invitation
      </h3>
      <p className="mt-2 text-[13px] text-ink-soft">
        Select the incoming Ikon manager from the staff register, enter the outgoing manager and confirm the two dates.
      </p>
      <p className="mt-4 text-xl leading-7 font-semibold text-ink tabular-nums">{plural(drafts.length, "saved draft")}</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        {readOnly ? null : (
          <Button variant="primary" icon="plus" onClick={() => setPrepareOpen(true)}>
            Prepare handover draft
          </Button>
        )}
        {showRequests ? (
          <a href={`#${requestsId}`} className="text-[13px] font-semibold link-brand">
            View handover requests
          </a>
        ) : (
          <Link href={`${paths.onboardingProject(propertyId, "overview")}#${requestsId}`} className="text-[13px] font-semibold link-brand">
            View handover requests
          </Link>
        )}
      </div>
      {readOnly ? (
        <p className="mt-3 text-xs text-muted">The project is closed out: its handover links are withdrawn and no new one can be prepared.</p>
      ) : current ? null : (
        <p className="mt-3 text-xs text-muted">
          Email delivery: not connected. Saving prepares a draft; it does not send an invitation. Activating a draft creates the secure link and puts
          the letter in Approvals; nothing is sent until someone approves it.
        </p>
      )}

      {current ? (
        <CurrentLink
          propertyId={propertyId}
          invite={current}
          freshUrl={fresh?.inviteId === current.id ? fresh.url : null}
          onPreview={() => setPreview(current)}
          onRevoke={() => setRevoking(current)}
          readOnly={readOnly}
        />
      ) : null}

      {drafts.length ? (
        <ul className="mt-5 space-y-3" aria-label="Saved drafts">
          {drafts.map((invite) => (
            <DraftRow
              key={invite.id}
              readOnly={readOnly}
              invite={invite}
              onPreview={() => setPreview(invite)}
              onActivate={() => setActivating(invite)}
              onDiscard={() => setRevoking(invite)}
            />
          ))}
        </ul>
      ) : null}

      {showRequests ? <RequestsList id={requestsId} invites={all} onPreview={setPreview} /> : null}

      <PrepareHandoverModal
        open={prepareOpen}
        onClose={() => setPrepareOpen(false)}
        propertyId={propertyId}
        spNumber={spNumber}
        onSaved={() => {
          setPrepareOpen(false);
          onChanged();
        }}
      />
      <ActivateInviteModal
        propertyId={propertyId}
        invite={activating}
        current={current}
        onClose={() => setActivating(null)}
        onActivated={(invite, url) => {
          setActivating(null);
          setFresh({ inviteId: invite.id, url });
          onChanged();
        }}
      />
      <LetterPreviewModal propertyId={propertyId} invite={preview} onClose={() => setPreview(null)} />
      <ConfirmDialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        onConfirm={() => (revoking ? revoke(revoking) : undefined)}
        title={revoking?.status === "draft" ? "Discard this draft?" : "Withdraw this link?"}
        returnFocus={() => document.getElementById(headingId)}
        description={
          revoking?.status === "draft"
            ? `The draft invitation for ${revoking.outgoingManager.name} is set aside. Nothing was sent.`
            : `${revoking?.outgoingManager.name ?? "The outgoing manager"} will no longer be able to open the portal or upload. Files already uploaded stay in the building's Files, and a letter still waiting in Approvals is withdrawn.`
        }
        confirmLabel={revoking?.status === "draft" ? "Discard draft" : "Withdraw link"}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Prepare a draft
// ---------------------------------------------------------------------------

function addDays(days: number): string {
  return localDay(Date.now() + days * 86_400_000);
}

const MANUAL = "";

export function PrepareHandoverModal({
  open,
  onClose,
  propertyId,
  spNumber,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  propertyId: string;
  spNumber: string;
  onSaved: (invite: HandoverInvite) => void;
}) {
  const toast = useToast();
  const { staff: acting } = useActingStaff();
  const managers = useResource(open ? "directory:outgoing-managers" : null, onboardingApi.outgoingManagers);
  const companies = useResource(open ? "directory:companies" : null, onboardingApi.companies);
  const defaultIncoming = (acting?.role === "strata_manager" ? acting : STAFF_DIRECTORY.find((s) => s.role === "strata_manager"))?.id ?? STAFF_DIRECTORY[0]!.id;

  const [incomingId, setIncomingId] = useState(defaultIncoming);
  const [pick, setPick] = useState(MANUAL);
  const [company, setCompany] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [recordsDue, setRecordsDue] = useState(() => addDays(14));
  const [handoverDate, setHandoverDate] = useState(() => addDays(21));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setIncomingId(defaultIncoming);
    setPick(MANUAL);
    setCompany("");
    setName("");
    setEmail("");
    setPhone("");
    setRecordsDue(addDays(14));
    setHandoverDate(addDays(21));
    setError(null);
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const companyName = (id: string | null) => companies.data?.find((c) => c.id === id)?.name ?? "";

  const choose = (id: string) => {
    setPick(id);
    const manager = managers.data?.find((m) => m.id === id);
    if (!manager) return;
    setName(manager.name);
    setEmail(manager.email);
    setPhone(manager.phone ?? "");
    setCompany(companyName(manager.companyId));
  };

  // The server refuses these too; saying so here saves a round trip.
  const datesProblem = recordsDue && handoverDate ? inviteDatesProblem(handoverDate, recordsDue, localDay()) : null;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (datesProblem) {
      setError(new Error(datesProblem));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const invite = await onboardingApi.createInvite(propertyId, {
        incomingManagerId: incomingId,
        outgoingManager: { company: company.trim(), name: name.trim(), email: email.trim(), phone: phone.trim() || null },
        handoverDate,
        recordsDueDate: recordsDue,
      });
      toast.success("Handover draft saved", `For ${invite.outgoingManager.name}. Activate the link when you're ready to send it.`);
      onSaved(invite);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const formId = `prepare-handover-${propertyId}`;
  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Prepare handover draft"
      description={`SP ${spNumber}: the letter and secure link for the outgoing strata manager.`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={busy}>
            Save draft
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={save} className="space-y-6">
        <fieldset className="space-y-3">
          <legend className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">Incoming Ikon manager</legend>
          <SelectField label="Incoming manager (staff register)" value={incomingId} onChange={(e) => setIncomingId(e.target.value)} required>
            {STAFF_DIRECTORY.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {STAFF_ROLE_LABELS[s.role]}
                {s.sample ? " (SAMPLE)" : ""}
              </option>
            ))}
          </SelectField>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">Outgoing strata manager</legend>
          {managers.error ? (
            <p className="text-[13px] text-red-700">Couldn't load the directory: type their details below.</p>
          ) : (
            <SelectField
              label="From the outgoing manager directory"
              hint="Or type their details below."
              value={pick}
              onChange={(e) => choose(e.target.value)}
              disabled={managers.loading}
            >
              <option value={MANUAL}>{managers.loading ? "Loading the directory…" : "Someone else: type their details"}</option>
              {(managers.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.companyId ? ` · ${companyName(m.companyId)}` : ""}
                  {m.sample ? " (SAMPLE)" : ""}
                </option>
              ))}
            </SelectField>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" />
            <TextField
              label="Company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              required
              list={`${formId}-companies`}
              autoComplete="off"
            />
            <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
            <TextField label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" hint="For confirming the funds transfer by phone." />
          </div>
          <datalist id={`${formId}-companies`}>
            {(companies.data ?? []).map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">Dates</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Records due" type="date" value={recordsDue} onChange={(e) => setRecordsDue(e.target.value)} required hint="When the outgoing manager should have supplied the documents." />
            <TextField label="Handover date" type="date" value={handoverDate} onChange={(e) => setHandoverDate(e.target.value)} required hint="The day Ikon takes over management." />
          </div>
          {datesProblem ? (
            <p role="alert" className="flex items-start gap-2 text-[13px] text-red-800">
              <Icon name="alert" className="mt-0.5 size-3.5 shrink-0 text-red-700" />
              {datesProblem}.
            </p>
          ) : null}
        </fieldset>

        <FormError error={error} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Activate
// ---------------------------------------------------------------------------

const EXPIRY_OPTIONS = [14, 30, 60, 90];
/** The link should stay open at least a week past the records due date, for late documents. */
const LATE_DOCUMENT_DAYS = 7;

/** Whole days from today (local) to a YYYY-MM-DD date. */
function daysUntil(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const today = localDay();
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
}

function ActivateInviteModal({
  propertyId,
  invite,
  current,
  onClose,
  onActivated,
}: {
  propertyId: string;
  invite: HandoverInvite | null;
  current: HandoverInvite | null;
  onClose: () => void;
  onActivated: (invite: HandoverInvite, url: string) => void;
}) {
  const toast = useToast();
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const dueIn = invite ? daysUntil(invite.recordsDueDate) : 0;
  // The shortest option that keeps the link open a week past the records due date (or the longest there is).
  const suggested = EXPIRY_OPTIONS.find((d) => d >= Math.max(30, dueIn + LATE_DOCUMENT_DAYS)) ?? EXPIRY_OPTIONS.at(-1)!;

  useEffect(() => {
    if (invite) {
      setDays(suggested);
      setError(null);
    }
    // Only when a (new) invitation is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invite]);

  const activate = async () => {
    if (!invite) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onboardingApi.activateInvite(propertyId, invite.id, days);
      toast.success("Link activated", "The handover letter is waiting in Approvals.");
      onActivated(result.invite, result.url);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!invite}
      onClose={busy ? () => undefined : onClose}
      title="Activate the secure link"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" icon="link" loading={busy} onClick={activate}>
            Activate link
          </Button>
        </>
      }
    >
      {invite ? (
        <div className="space-y-4 text-sm text-ink-soft">
          <p>
            This creates {invite.outgoingManager.name}'s secure upload link and puts the handover letter in Approvals as a draft email to{" "}
            <span className="font-medium text-ink [overflow-wrap:anywhere]">{invite.outgoingManager.email}</span>. Nothing is sent until someone approves it.
          </p>
          {current && current.id !== invite.id ? (
            <p className="flex gap-2 border border-line bg-subtle px-3 py-2 text-[13px]">
              <Icon name="alert" className="mt-0.5 size-4 shrink-0 text-taupe" />
              <span>
                The current link for {current.outgoingManager.name} will be withdrawn. Only one link is active at a time.
              </span>
            </p>
          ) : null}
          <SelectField label="The link expires after" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
            {EXPIRY_OPTIONS.map((d) => (
              <option key={d} value={d} disabled={d < dueIn}>
                {d} days{d < dueIn ? " (before the records are due)" : ""}
              </option>
            ))}
          </SelectField>
          {days < dueIn + LATE_DOCUMENT_DAYS ? (
            <p className="flex items-start gap-2 text-[13px] text-amber-900">
              <Icon name="alert" className="mt-0.5 size-3.5 shrink-0 text-amber-700" />
              The records are due on {formatLongDate(invite.recordsDueDate)}, so this link closes less than a week after that, with little time for
              late documents.
            </p>
          ) : null}
          <FormError error={error} />
        </div>
      ) : null}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// The letter, exactly as it will be sent
// ---------------------------------------------------------------------------

export function LetterPreviewModal({ propertyId, invite, onClose }: { propertyId: string; invite: HandoverInvite | null; onClose: () => void }) {
  const { session } = useSession();
  const profile = usePortfolio().cardFor(propertyId)?.profile ?? null;
  const letter = useResource(invite ? `letter:${propertyId}:${invite.id}:${invite.status}` : null, () => onboardingApi.inviteLetter(propertyId, invite!.id));
  const fromAddress = profile?.emailAddress ?? null;
  const from = profile && fromAddress ? `${session.companyName} - SP ${profile.spNumber} <${fromAddress}>` : (fromAddress ?? "");
  const to = invite ? `${invite.outgoingManager.name} <${invite.outgoingManager.email}>` : "";

  const srcDoc = useMemo(
    () =>
      letter.data && profile && fromAddress
        ? renderEmailHtml({
            subject: letter.data.subject,
            body: letter.data.text,
            companyName: session.companyName,
            property: profile,
            fromAddress,
            logoUrl: `${window.location.origin}/brand/email-logo.png`,
          })
        : "",
    [letter.data, profile, fromAddress, session.companyName],
  );

  return (
    <Modal
      open={!!invite}
      onClose={onClose}
      title="Handover letter preview"
      description={
        invite?.status === "draft"
          ? "How the outgoing manager will see it. The secure link is added when you activate the draft; nothing is sent from here."
          : "How the outgoing manager sees it. Nothing is sent from here: the letter is approved in Approvals."
      }
      size="lg"
      plainTitle
    >
      {letter.error ? (
        <ErrorState error={letter.error} onRetry={letter.reload} title="Couldn't load the letter" compact />
      ) : !letter.data ? (
        <div className="space-y-3" role="status" aria-label="Loading the letter">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-[50vh] w-full" />
        </div>
      ) : (
        <>
          <dl className="mb-3 grid grid-cols-[4rem_1fr] gap-x-2 gap-y-1 text-[13px]">
            <dt className="text-muted">From</dt>
            <dd className="text-ink [overflow-wrap:anywhere]">{from}</dd>
            <dt className="text-muted">To</dt>
            <dd className="text-ink [overflow-wrap:anywhere]">{to}</dd>
            <dt className="text-muted">Subject</dt>
            <dd className="font-medium text-ink [overflow-wrap:anywhere]">{letter.data.subject}</dd>
          </dl>
          {srcDoc ? (
            // No scripts can run (sandbox without allow-scripts); same origin only so the logo resolves.
            <iframe title={`Preview: ${letter.data.subject}`} srcDoc={srcDoc} sandbox="allow-same-origin" className="h-[65vh] w-full border border-line bg-canvas" />
          ) : (
            <pre className="max-h-[65vh] overflow-y-auto border border-line bg-subtle p-4 font-sans text-[13px] leading-relaxed whitespace-pre-wrap text-ink-soft">
              {letter.data.text}
            </pre>
          )}
        </>
      )}
    </Modal>
  );
}
