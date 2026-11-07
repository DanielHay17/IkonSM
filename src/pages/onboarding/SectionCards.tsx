// The eight section cards (4 × 2 on desktop) and the Documents missing card, as on Peter's Zoho dashboard,
// plus the Section assignment dialog. Used on the dashboard and on a project's overview.

import { useEffect, useState } from "react";
import {
  REVIEW_STATUS_LABELS,
  STAFF_DIRECTORY,
  STAFF_ROLE_LABELS,
  type OnboardingProject,
  type OnboardingSection,
} from "../../../shared/onboarding";
import { onboardingApi } from "../../api";
import { Button } from "../../components/Button";
import { FormError } from "../../components/EmptyState";
import { SelectField } from "../../components/Field";
import { Link } from "../../components/Link";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { cx } from "../../lib/cx";
import { paths } from "../../router";
import { staffName } from "./derive";
import { ProgressText } from "./ui";

// Links inside a card that is itself a link (the title stretches over it) sit above the stretched area.
const INNER_LINK = "relative z-10 link-brand";

function ReviewText({ section }: { section: OnboardingSection }) {
  const tone = section.review === "reviewed" ? "font-medium text-emerald-800" : section.review === "changes_requested" ? "font-medium text-red-700" : "text-ink-soft";
  return <span className={tone}>{REVIEW_STATUS_LABELS[section.review]}</span>;
}

export function SectionCard({
  propertyId,
  project,
  section,
  onAssign,
}: {
  propertyId: string;
  project: OnboardingProject;
  section: OnboardingSection;
  onAssign: (section: OnboardingSection) => void;
}) {
  const { counts } = section;
  const tasksHref = (group?: string) => paths.onboardingProject(propertyId, "tasks", { section: section.key, group });
  return (
    <article
      className="group/card relative flex min-w-0 flex-col border border-line bg-surface px-4 pt-5 pb-4 shadow-card sm:px-5 transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-pop"
      aria-labelledby={`section-${project.id}-${section.key}`}
    >
      <h3 id={`section-${project.id}-${section.key}`} className="heading-display text-[15px] leading-snug text-ink">
        <Link
          href={tasksHref()}
          title={`Open the ${section.title} tasks`}
          className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ink"
        >
          {section.title}
        </Link>
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">{section.description}</p>

      <p className="mt-4 text-lg leading-7 font-semibold text-ink tabular-nums">
        {counts.done} / {counts.total} tasks complete
      </p>
      <p className="mt-1.5 text-xs text-muted tabular-nums">{counts.excluded} excluded or cancelled</p>

      {section.key === "outgoing_manager" ? (
        <p className="mt-2 text-xs text-ink-soft tabular-nums">
          <Link href={paths.onboardingProject(propertyId, "handover")} className={INNER_LINK}>
            {project.counts.handoverVerified} documents verified · {project.counts.handoverAwaitingVerification} awaiting verification
          </Link>
        </p>
      ) : null}
      {section.key === "readiness_closeout" ? (
        <p className="mt-2 text-xs text-ink-soft tabular-nums">
          <Link href={paths.onboardingProject(propertyId, "golive")} className={INNER_LINK}>
            {project.counts.goLiveVerified} / {project.counts.goLiveChecks} checks verified · {project.counts.goLiveNotApplicable} not applicable
          </Link>
        </p>
      ) : null}

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5" aria-label={`${section.title} areas`}>
        {section.groups.map((group) => (
          <li key={group}>
            <Link
              href={section.key === "readiness_closeout" && group.toLowerCase() === "go-live checks" ? paths.onboardingProject(propertyId, "golive") : tasksHref(group)}
              className={cx(INNER_LINK, "text-[13px] font-semibold")}
            >
              {group}
            </Link>
          </li>
        ))}
      </ul>

      <dl className="mt-4 space-y-0.5 border-t border-line pt-3 text-xs leading-5 text-ink-soft">
        <div>
          <dt className="inline">Progress: </dt>
          <dd className="inline">
            <ProgressText progress={section.progress} />
          </dd>
        </div>
        <div>
          <dt className="inline">Review: </dt>
          <dd className="inline">
            <ReviewText section={section} />
          </dd>
        </div>
        <div>
          <dt className="inline">Owner: </dt>
          <dd className="inline">{staffName(section.ownerId)}</dd>
        </div>
        <div>
          <dt className="inline">Nominated approver: </dt>
          <dd className="inline">{staffName(section.approverId)}</dd>
        </div>
      </dl>

      <div className="mt-auto pt-4">
        <button type="button" onClick={() => onAssign(section)} aria-label={`Section assignment: ${section.title}`} className={cx(INNER_LINK, "text-[13px] font-semibold")}>
          Section assignment
        </button>
      </div>
    </article>
  );
}

export function DocumentsMissingCard({ propertyId, project }: { propertyId: string; project: OnboardingProject }) {
  const { handoverAwaitingSupply, handoverRejected } = project.counts;
  return (
    <article className="relative flex min-w-0 flex-col border border-line bg-sunken/60 px-4 pt-5 pb-4 shadow-card hover:border-line-strong sm:px-5" aria-labelledby={`missing-${project.id}`}>
      <h3 id={`missing-${project.id}`} className="heading-display text-[15px] leading-snug text-ink">
        <Link
          href={paths.onboardingProject(propertyId, "handover", { status: "awaiting_supply" })}
          className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ink"
        >
          Documents missing
        </Link>
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">Outstanding handover documents across the same project.</p>
      <p className="mt-4 text-lg leading-7 font-semibold text-ink tabular-nums">{handoverAwaitingSupply} awaiting supply</p>
      {handoverRejected > 0 ? (
        <p className="mt-1.5 text-xs font-medium text-red-700 tabular-nums">
          <Link href={paths.onboardingProject(propertyId, "handover", { status: "rejected" })} className={cx(INNER_LINK, "text-red-700! decoration-red-300")}>
            {handoverRejected} {handoverRejected === 1 ? "needs" : "need"} replacing
          </Link>
        </p>
      ) : null}
    </article>
  );
}

/** Four columns once the block is wide enough (a container query, so the sidebar and padding are allowed for). */
export function SectionGrid({
  propertyId,
  project,
  onSectionChanged,
}: {
  propertyId: string;
  project: OnboardingProject;
  onSectionChanged: (section: OnboardingSection) => void;
}) {
  const [assigning, setAssigning] = useState<OnboardingSection | null>(null);
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @4xl:grid-cols-4">
        {project.sections.map((section) => (
          <SectionCard key={section.key} propertyId={propertyId} project={project} section={section} onAssign={setAssigning} />
        ))}
        <DocumentsMissingCard propertyId={propertyId} project={project} />
      </div>
      <SectionAssignmentModal
        propertyId={propertyId}
        section={assigning}
        onClose={() => setAssigning(null)}
        onSaved={(section) => {
          setAssigning(null);
          onSectionChanged(section);
        }}
      />
    </div>
  );
}

const staffOptions = STAFF_DIRECTORY.map((s) => ({ id: s.id, label: `${s.name} · ${STAFF_ROLE_LABELS[s.role]}${s.sample ? " (SAMPLE)" : ""}` }));

/** Owner and nominated approver for one section, from the staff register. */
export function SectionAssignmentModal({
  propertyId,
  section,
  onClose,
  onSaved,
}: {
  propertyId: string;
  section: OnboardingSection | null;
  onClose: () => void;
  onSaved: (section: OnboardingSection) => void;
}) {
  const toast = useToast();
  const [ownerId, setOwnerId] = useState("");
  const [approverId, setApproverId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!section) return;
    setOwnerId(section.ownerId ?? "");
    setApproverId(section.approverId ?? "");
    setError(null);
  }, [section]);

  const save = async () => {
    if (!section) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await onboardingApi.updateSection(propertyId, section.key, { ownerId: ownerId || null, approverId: approverId || null });
      toast.success("Section assignment saved", `${saved.title}: owner ${staffName(saved.ownerId)}, approver ${staffName(saved.approverId)}`);
      onSaved(saved);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!section}
      onClose={busy ? () => undefined : onClose}
      title="Section assignment"
      description={section ? section.title : undefined}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <SelectField label="Owner" hint="Does the work and keeps the tasks moving." value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          <option value="">Unassigned</option>
          {staffOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Nominated approver"
          hint="Reviews the section before go-live. Anyone can review; the activity log notes when it isn't the nominated approver."
          value={approverId}
          onChange={(e) => setApproverId(e.target.value)}
        >
          <option value="">Unassigned</option>
          {staffOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </SelectField>
        <FormError error={error} />
      </div>
    </Modal>
  );
}
