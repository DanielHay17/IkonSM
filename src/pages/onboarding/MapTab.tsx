// The project map: the milestones from appointment to closeout as a flow (horizontal on wide screens,
// vertical on phones), each with its status, counts, owner initials and a link to the tab that moves it.
// Everything is derived from the project detail (derive.ts projectMilestones).

import { useMemo } from "react";
import { Card } from "../../components/Card";
import { Icon, type IconName } from "../../components/Icon";
import { Link } from "../../components/Link";
import { cx } from "../../lib/cx";
import { paths } from "../../router";
import {
  MILESTONE_PHASES,
  MILESTONE_STATUS_LABELS,
  milestoneTally,
  projectMilestones,
  type Milestone,
  type MilestoneLink,
  type MilestoneStatus,
} from "./derive";
import { useProject } from "./ProjectContext";
import { OwnerInitials } from "./ui";

const MARKER: Record<MilestoneStatus, { box: string; icon: IconName | null; text: string; line: string }> = {
  done: { box: "bg-emerald-600 text-white", icon: "check", text: "text-emerald-800", line: "bg-emerald-600" },
  in_progress: { box: "bg-ink text-white", icon: "clock", text: "text-ink", line: "bg-line-strong" },
  not_started: { box: "border-2 border-line-input bg-surface text-muted", icon: null, text: "text-ink-soft", line: "bg-line-strong" },
  blocked: { box: "bg-red-600 text-white", icon: "alert", text: "text-red-700", line: "bg-line-strong" },
};

function Marker({ status, number }: { status: MilestoneStatus; number: number }) {
  const { box, icon } = MARKER[status];
  return (
    <span aria-hidden="true" className={cx("relative z-10 grid size-8 shrink-0 place-items-center text-[11px] font-semibold tabular-nums", box)}>
      {icon ? <Icon name={icon} className="size-4" strokeWidth={2.25} /> : String(number).padStart(2, "0")}
    </span>
  );
}

function hrefFor(propertyId: string, link: MilestoneLink): string {
  return paths.onboardingProject(propertyId, link.tab, link.query) + (link.hash ? `#${link.hash}` : "");
}

function Node({ milestone, number, last }: { milestone: Milestone; number: number; last: boolean }) {
  const { propertyId } = useProject();
  const style = MARKER[milestone.status];
  return (
    <li
      className={cx(
        "relative flex min-w-0 gap-4 pb-6 @3xl:flex-1 @3xl:flex-col @3xl:gap-3 @3xl:pr-4 @3xl:pb-0",
        // The connector: down to the next node on phones, across to it on wide screens.
        !last && "before:absolute before:top-9 before:bottom-1 before:left-[15px] before:w-0.5 @3xl:before:top-[15px] @3xl:before:right-0 @3xl:before:bottom-auto @3xl:before:left-10 @3xl:before:h-0.5 @3xl:before:w-auto",
        !last && (milestone.status === "done" ? "before:bg-emerald-600" : "before:bg-line-strong"),
      )}
    >
      <Marker status={milestone.status} number={number} />
      <div className="min-w-0">
        <h3 className="heading-display text-[12px] leading-5 text-ink">
          <span className="sr-only">Step {number}: </span>
          {milestone.title}
        </h3>
        <p className={cx("mt-0.5 text-xs font-semibold", style.text)}>{MILESTONE_STATUS_LABELS[milestone.status]}</p>
        <p className="mt-1 text-[13px] text-ink tabular-nums">{milestone.counts}</p>
        {milestone.note ? <p className={cx("mt-0.5 text-xs", milestone.status === "blocked" ? "font-medium text-red-700" : "text-muted")}>{milestone.note}</p> : null}
        <div className="mt-2">
          <OwnerInitials ids={milestone.ownerIds} />
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {milestone.links.map((link) => (
            <li key={link.label}>
              <Link href={hrefFor(propertyId, link)} className="inline-flex items-center gap-1 text-xs font-medium link-brand">
                {link.label}
                <Icon name="arrowRight" className="size-3" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

export function MapTab() {
  const { project, propertyId } = useProject();
  const milestones = useMemo(() => projectMilestones(project), [project]);
  const tally = milestoneTally(milestones);
  const next = milestones.find((m) => m.status !== "done") ?? null;
  const numbered = new Map(milestones.map((m, i) => [m.key, i + 1]));

  return (
    <div className="space-y-6">
      <Card className="px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
          <div>
            <p className="text-xl font-semibold text-ink tabular-nums">
              {tally.done} of {milestones.length} milestones done
            </p>
            <p className="mt-1 text-[13px] text-ink-soft">
              {next ? (
                <>
                  Next: <span className="font-medium text-ink">{next.title}</span>
                  {next.note ? ` · ${next.note}` : ""}
                </>
              ) : (
                "Every milestone is done."
              )}
            </p>
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink-soft" aria-label="Key">
            {(Object.keys(MILESTONE_STATUS_LABELS) as MilestoneStatus[]).map((status) => (
              <li key={status} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={cx("grid size-4 place-items-center", MARKER[status].box)}>
                  {MARKER[status].icon ? <Icon name={MARKER[status].icon!} className="size-3" strokeWidth={2.25} /> : null}
                </span>
                {MILESTONE_STATUS_LABELS[status]} <span className="text-muted tabular-nums">({tally[status]})</span>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {MILESTONE_PHASES.map((phase) => {
        const items = milestones.filter((m) => m.phase === phase.key);
        return (
          <section key={phase.key} aria-labelledby={`phase-${phase.key}`} className="@container">
            <h2 id={`phase-${phase.key}`} className="mb-3 text-[11px] font-semibold tracking-[0.18em] text-muted uppercase">
              {phase.title}
            </h2>
            <Card className="px-5 pt-5 pb-5">
              <ol className="flex flex-col @3xl:flex-row">
                {items.map((m, i) => (
                  <Node key={m.key} milestone={m} number={numbered.get(m.key)!} last={i === items.length - 1} />
                ))}
              </ol>
            </Card>
          </section>
        );
      })}

      {project.goLive !== "approved" && project.blockers.length ? (
        <section aria-labelledby="map-blockers" className="border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-900">
          <h2 id="map-blockers" className="font-semibold">
            Blocking go-live
          </h2>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
            {project.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <p className="mt-2">
            <Link href={paths.onboardingProject(propertyId, "approvals")} className="font-medium text-red-900! link-brand decoration-red-300">
              Section reviews and final approval
            </Link>
          </p>
        </section>
      ) : null}
    </div>
  );
}
