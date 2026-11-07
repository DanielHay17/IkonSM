// Section reviews (each section's nominated approver, review status, Reviewed / Changes requested with a
// note), then the final go-live approval (its blockers, or Approve go-live) and the closeout.

import { useEffect, useId, useState } from "react";
import { REVIEW_STATUS_LABELS, sectionTaskLine, staffById, type OnboardingSection, type ReviewStatus } from "../../../shared/onboarding";
import { goLiveBlockers, onboardingApi } from "../../api";
import { Button } from "../../components/Button";
import { Card, CardBody, CardHeader } from "../../components/Card";
import { FormError } from "../../components/EmptyState";
import { textareaClasses } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { Link } from "../../components/Link";
import { ConfirmDialog } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { cx } from "../../lib/cx";
import { formatDateTime } from "../../lib/format";
import { paths } from "../../router";
import { QA_GROUP, staffName, withSection } from "./derive";
import { useProject } from "./ProjectContext";
import { SectionAssignmentModal } from "./SectionCards";
import { Notice, ProgressText, ReviewBadge, TaskStatusBadge } from "./ui";

function NotApproverHint({ approverId }: { approverId: string | null }) {
  const { acting } = useProject();
  if (!approverId || acting?.id === approverId) return null;
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted">
      <Icon name="alert" className="mt-px size-3.5 shrink-0 text-taupe" />
      You're not the nominated approver ({staffName(approverId)}). You can still decide: the activity log records who did.
    </p>
  );
}

function SectionReviewRow({ section, onAssign }: { section: OnboardingSection; onAssign: () => void }) {
  const { propertyId, apply, acting, readOnly } = useProject();
  const toast = useToast();
  const noteId = useId();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<ReviewStatus | null>(null);

  const decide = async (decision: ReviewStatus) => {
    setBusy(decision);
    try {
      const saved = await onboardingApi.reviewSection(propertyId, section.key, { decision, note: note.trim() || null });
      apply((d) => withSection(d, saved));
      setNote("");
      toast.success(decision === "not_reviewed" ? "Review cleared" : `${saved.title}: ${REVIEW_STATUS_LABELS[decision].toLowerCase()}`);
    } catch (err) {
      toast.error("Couldn't record the review", err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="heading-display text-[13px] leading-6 text-ink">
          <Link href={paths.onboardingProject(propertyId, "tasks", { section: section.key })} className="hover:underline">
            {section.title}
          </Link>
        </h3>
        <ReviewBadge review={section.review} />
      </div>
      <p className="mt-1 text-xs text-ink-soft tabular-nums">
        {sectionTaskLine(section.counts)} · <ProgressText progress={section.progress} /> · Owner: {staffName(section.ownerId)} · Nominated approver:{" "}
        {staffName(section.approverId)}
        {acting && acting.id === section.approverId ? <span className="font-medium text-ink"> (you)</span> : null}{" "}
        {readOnly ? null : (
          <button type="button" onClick={onAssign} aria-label={`Section assignment: ${section.title}`} className="ml-1 inline-flex min-h-6 items-center font-medium link-brand">
            Section assignment
          </button>
        )}
      </p>
      {section.reviewedBy ? (
        <p
          className={cx(
            "mt-2 border-l-2 px-3 py-1.5 text-xs",
            section.review === "changes_requested" ? "border-red-300 bg-red-50 text-red-900" : "border-line-strong bg-subtle text-ink-soft",
          )}
        >
          {REVIEW_STATUS_LABELS[section.review]} by {section.reviewedBy}
          {section.reviewedAt ? `, ${formatDateTime(section.reviewedAt, true)}` : ""}
          {section.reviewNote ? `: “${section.reviewNote}”` : ""}
        </p>
      ) : null}
      {readOnly ? null : (
        <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor={noteId} className="mb-1 block text-xs font-medium text-muted">
              Review note (optional)<span className="sr-only"> for {section.title}</span>
            </label>
            <textarea
              id={noteId}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={1}
              maxLength={2000}
              className={textareaClasses("min-h-9 text-[13px]! py-1.5!")}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Only the clicked button shows it is busy (and keeps focus); the others wait. */}
            <Button
              size="sm"
              variant="secondary"
              icon="refresh"
              loading={busy === "changes_requested"}
              disabled={busy !== null && busy !== "changes_requested"}
              onClick={() => decide("changes_requested")}
            >
              Changes requested<span className="sr-only">: {section.title}</span>
            </Button>
            <Button size="sm" variant="primary" icon="check" loading={busy === "reviewed"} disabled={busy !== null && busy !== "reviewed"} onClick={() => decide("reviewed")}>
              Reviewed<span className="sr-only">: {section.title}</span>
            </Button>
            {section.review !== "not_reviewed" ? (
              <Button
                size="sm"
                variant="ghost"
                loading={busy === "not_reviewed"}
                disabled={busy !== null && busy !== "not_reviewed"}
                onClick={() => decide("not_reviewed")}
              >
                Clear<span className="sr-only"> the review of {section.title}</span>
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </li>
  );
}

function FinalApproval() {
  const { project, propertyId, apply, refresh } = useProject();
  const toast = useToast();
  const noteId = useId();
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [refused, setRefused] = useState<string[] | null>(null);
  // A refusal shows the blockers the server gave until the next refresh brings the project's own list.
  const blockerKey = project.blockers.join("\n");
  useEffect(() => setRefused(null), [blockerKey]);
  const readiness = project.sections.find((s) => s.key === "readiness_closeout");
  const approverId = readiness?.approverId ?? null;

  const approve = async () => {
    try {
      const detail = await onboardingApi.approve(propertyId, { note: note.trim() || null });
      apply(() => detail);
      setRefused(null);
      toast.success("Go-live approved", "The building is now active in the portfolio.");
    } catch (err) {
      const blockers = goLiveBlockers(err);
      if (blockers) {
        setRefused(blockers);
        refresh();
        return;
      }
      throw err;
    }
  };

  let body;
  if (project.goLive === "approved") {
    body = (
      <Notice tone="green" icon="check" title="Go-live approved">
        {project.finalApproval ? (
          <>
            By {project.finalApproval.approvedBy}, {formatDateTime(project.finalApproval.approvedAt, true)}
            {project.finalApproval.note ? `: “${project.finalApproval.note}”` : "."}
          </>
        ) : null}{" "}
        The building shows as active in the portfolio.
      </Notice>
    );
  } else if (project.blockers.length || refused?.length) {
    const blockers = refused?.length ? refused : project.blockers;
    body = (
      <div className="space-y-3">
        <div role={refused ? "alert" : undefined} className="border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-900">
          <p className="font-semibold">Go-live can't be approved yet:</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted">
          Clear these and the <span className="font-medium text-ink">Approve go-live</span> button appears here. The{" "}
          <Link href={paths.onboardingProject(propertyId, "map")} className="font-medium link-brand">
            project map
          </Link>{" "}
          shows where each part stands.
        </p>
      </div>
    );
  } else {
    body = (
      <div className="space-y-3">
        <Notice tone="green" icon="approve" title="Nothing is blocking go-live" />
        <div>
          <label htmlFor={noteId} className="mb-1 block text-xs font-medium text-muted">
            Approval note (optional)
          </label>
          <textarea id={noteId} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} className={textareaClasses("text-[13px]!")} />
        </div>
        <NotApproverHint approverId={approverId} />
        <Button variant="primary" icon="flag" onClick={() => setConfirming(true)}>
          Approve go-live
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Final approval"
        description={`Go-live approval makes the building active in the portfolio. Nominated approver: ${staffName(approverId)}.`}
      />
      <CardBody>{body}</CardBody>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={approve}
        title="Approve go-live?"
        description={`SP ${propertyId.replace(/^sp-/i, "")} becomes an active building in the portfolio, managed by Ikon. This is recorded against your name.`}
        confirmLabel="Approve go-live"
        destructive={false}
      />
    </Card>
  );
}

function Closeout() {
  const { project, propertyId, apply } = useProject();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const qa = project.tasks.filter((t) => t.sectionKey === "readiness_closeout" && t.group.toLowerCase() === QA_GROUP.toLowerCase());
  const qaOpen = qa.filter((t) => t.status === "open").length;

  const closeOut = async () => {
    setError(null);
    try {
      const detail = await onboardingApi.closeout(propertyId);
      apply(() => detail);
      toast.success("Project closed out", "The handover link is withdrawn.");
    } catch (err) {
      setError(err);
      throw err;
    }
  };

  return (
    <Card>
      <CardHeader title="Closeout" description="After go-live, once the completion and quality assurance tasks are done or excluded. Closing withdraws the handover link." />
      <CardBody className="space-y-3">
        {project.closeout === "closed" ? (
          <Notice tone="green" icon="check" title="Project closed out" />
        ) : (
          <>
            <ul className="divide-y divide-line border border-line">
              {qa.map((task) => (
                <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
                  <span className="min-w-0 text-ink">{task.title}</span>
                  <span className="flex items-center gap-2">
                    {task.ownerId ? <span className="text-xs text-muted">{staffById(task.ownerId)?.name}</span> : null}
                    <TaskStatusBadge status={task.status} />
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">
              <Link href={paths.onboardingProject(propertyId, "tasks", { section: "readiness_closeout", group: QA_GROUP })} className="font-medium link-brand">
                Open the quality assurance tasks
              </Link>
            </p>
            <FormError error={error} />
            {project.goLive !== "approved" ? (
              <p className="text-[13px] text-ink-soft">Available once go-live is approved.</p>
            ) : (
              <Button variant="primary" onClick={() => setConfirming(true)} disabled={qaOpen > 0} title={qaOpen ? "Finish the quality assurance tasks first" : undefined}>
                Close out project
              </Button>
            )}
            {project.goLive === "approved" && qaOpen > 0 ? (
              <p className="text-xs text-muted">
                {qaOpen} quality assurance {qaOpen === 1 ? "task is" : "tasks are"} still open.
              </p>
            ) : null}
          </>
        )}
      </CardBody>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={closeOut}
        title="Close out this project?"
        description="The onboarding is finished: the outgoing manager's link is withdrawn and the project becomes read-only history."
        confirmLabel="Close out project"
        destructive={false}
      />
    </Card>
  );
}

export function ApprovalsTab() {
  const { project, propertyId, apply, acting } = useProject();
  const [assigning, setAssigning] = useState<OnboardingSection | null>(null);
  const reviewed = project.sections.filter((s) => s.review === "reviewed").length;
  const mine = acting ? project.sections.filter((s) => s.approverId === acting.id).length : 0;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] xl:items-start">
      <Card>
        <CardHeader
          title="Section reviews"
          description={
            <>
              {reviewed} of {project.sections.length} reviewed. Each section's nominated approver checks the work before go-live
              {mine ? `; you are the nominated approver for ${mine === 1 ? "1 section" : `${mine} sections`}` : ""}. Anyone can review: when it isn't
              the nominated approver, the activity log says so.
            </>
          }
        />
        <ul className="divide-y divide-line">
          {project.sections.map((section) => (
            <SectionReviewRow key={section.key} section={section} onAssign={() => setAssigning(section)} />
          ))}
        </ul>
      </Card>
      <div className="space-y-6">
        <FinalApproval />
        <Closeout />
      </div>
      <SectionAssignmentModal
        propertyId={propertyId}
        section={assigning}
        onClose={() => setAssigning(null)}
        onSaved={(section) => {
          setAssigning(null);
          apply((d) => withSection(d, section));
        }}
      />
    </div>
  );
}
