// A project's overview: what blocks go-live, the handover invitation, the eight section cards and the
// Documents missing card.

import { Link } from "../../components/Link";
import { formatDateTime } from "../../lib/format";
import { paths } from "../../router";
import { scopeLine, withSection } from "./derive";
import { InvitationCard } from "./Invitation";
import { useProject } from "./ProjectContext";
import { SectionGrid } from "./SectionCards";
import { Notice } from "./ui";

function GoLivePanel() {
  const { project, propertyId } = useProject();
  if (project.closeout === "closed") {
    return (
      <Notice tone="green" icon="check" title="Onboarding closed out">
        Go-live was approved{project.finalApproval ? ` by ${project.finalApproval.approvedBy} on ${formatDateTime(project.finalApproval.approvedAt)}` : ""} and
        the project is closed.
      </Notice>
    );
  }
  if (project.goLive === "approved") {
    return (
      <Notice tone="green" icon="check" title="Go-live approved">
        {project.finalApproval ? `Approved by ${project.finalApproval.approvedBy}, ${formatDateTime(project.finalApproval.approvedAt)}. ` : ""}
        Finish the completion and quality assurance tasks, then{" "}
        <Link href={paths.onboardingProject(propertyId, "approvals")} className="font-medium link-brand">
          close out the project
        </Link>
        .
      </Notice>
    );
  }
  if (project.blockers.length === 0) {
    return (
      <Notice tone="green" icon="approve" title="Ready for go-live approval">
        Nothing is blocking go-live.{" "}
        <Link href={paths.onboardingProject(propertyId, "approvals")} className="font-medium link-brand">
          Give the final approval
        </Link>
        .
      </Notice>
    );
  }
  return (
    <section aria-labelledby="before-go-live" className="border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-900">
      <h2 id="before-go-live" className="font-semibold">
        Before go-live:
      </h2>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
        {project.blockers.map((blocker) => (
          <li key={blocker}>{blocker}</li>
        ))}
      </ul>
      <p className="mt-2">
        <Link href={paths.onboardingProject(propertyId, "approvals")} className="font-medium text-red-900! link-brand decoration-red-300">
          Section reviews and final approval
        </Link>
        <span aria-hidden="true"> · </span>
        <Link href={paths.onboardingProject(propertyId, "map")} className="font-medium text-red-900! link-brand decoration-red-300">
          Project map
        </Link>
      </p>
    </section>
  );
}

export function OverviewTab() {
  const { project, propertyId, apply, refresh } = useProject();
  const spNumber = propertyId.replace(/^sp-/i, "");
  return (
    <div className="space-y-6">
      <GoLivePanel />
      <p className="text-sm text-ink-soft">
        {scopeLine(project.counts)} · created by {project.createdBy}, {formatDateTime(project.createdAt)}
      </p>
      <InvitationCard propertyId={propertyId} spNumber={spNumber} project={project} onChanged={refresh} showRequests />
      <section aria-label="Onboarding sections">
        <SectionGrid propertyId={propertyId} project={project} onSectionChanged={(section) => apply((d) => withSection(d, section))} />
      </section>
    </div>
  );
}
