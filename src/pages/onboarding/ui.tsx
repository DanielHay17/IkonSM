// Small presentational pieces shared by the onboarding screens: staff avatars, the "Acting as" chip, status
// badges in the brand's colour rules (amber only for awaiting or SAMPLE, red for blockers and rejections,
// green for verified or done) and a progress bar.

import type { ReactNode } from "react";
import {
  HANDOVER_STATUS_LABELS,
  PROGRESS_LABELS,
  PROJECT_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  STAFF_ROLE_LABELS,
  TASK_STATUS_LABELS,
  staffById,
  staffForName,
  type HandoverItemStatus,
  type InviteStatus,
  type ProjectStatus,
  type ReviewStatus,
  type SectionProgress,
  type StaffMember,
  type TaskStatus,
} from "../../../shared/onboarding";
import { Badge, type BadgeTone } from "../../components/Badge";
import { Icon, type IconName } from "../../components/Icon";
import { Link } from "../../components/Link";
import { cx } from "../../lib/cx";
import { initials } from "../../lib/format";
import { useSession } from "../../providers/SessionProvider";

/** The staff member the signed-in name maps to (null for a name not in the register). */
export function useActingStaff(): { name: string; staff: StaffMember | null } {
  const { session } = useSession();
  const name = session.staffName ?? "";
  return { name, staff: staffForName(name) };
}

/** "Acting as Peter King · Principal": who every action on these screens is recorded against. */
export function ActingAs({ className }: { className?: string }) {
  const { name, staff } = useActingStaff();
  return (
    <p
      className={cx("inline-flex max-w-full items-center gap-2 border border-line bg-surface py-1 pr-2.5 pl-1 text-xs text-ink-soft", className)}
      title="Actions on these screens are recorded with your name"
    >
      <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center bg-charcoal text-[10px] font-semibold text-white">
        {initials(staff?.name ?? name)}
      </span>
      <span className="min-w-0 truncate">
        Acting as <span className="font-medium text-ink">{staff?.name ?? (name || "unknown")}</span>
        {" · "}
        {staff ? STAFF_ROLE_LABELS[staff.role] : "Not in the staff register"}
      </span>
    </p>
  );
}

/** A staff member's initials in a small charcoal square; a dashed outline when nobody is assigned. */
export function StaffAvatar({ staffId, size = "sm", className }: { staffId: string | null | undefined; size?: "xs" | "sm"; className?: string }) {
  const staff = staffById(staffId);
  const box = size === "xs" ? "size-5 text-[9px]" : "size-6 text-[10px]";
  if (!staff) {
    return (
      <span aria-hidden="true" title="Unassigned" className={cx("grid shrink-0 place-items-center border border-dashed border-line-input text-muted", box, className)}>
        –
      </span>
    );
  }
  return (
    <span aria-hidden="true" title={staff.name} className={cx("grid shrink-0 place-items-center bg-charcoal font-semibold text-white", box, className)}>
      {initials(staff.name)}
    </span>
  );
}

/** Owner initials for a milestone or a section, with the names for screen readers. */
export function OwnerInitials({ ids, label = "Owner" }: { ids: string[]; label?: string }) {
  if (ids.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
        <StaffAvatar staffId={null} size="xs" />
        Unassigned
      </span>
    );
  }
  const names = ids.map((id) => staffById(id)?.name ?? id);
  return (
    <span className="inline-flex items-center gap-1">
      {ids.map((id) => (
        <StaffAvatar key={id} staffId={id} size="xs" />
      ))}
      <span className="sr-only">
        {label}: {names.join(", ")}
      </span>
    </span>
  );
}

export function SampleChecklistBadge() {
  return (
    <Badge tone="amber" className="font-semibold tracking-wide" title="The checklist content is a SAMPLE until Ikon supplies its exact list">
      SAMPLE checklist
    </Badge>
  );
}

const PROJECT_TONES: Record<ProjectStatus, BadgeTone> = { draft: "neutral", active: "accent", go_live_approved: "green", closed: "green" };

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge tone={PROJECT_TONES[status]} dot>
      {PROJECT_STATUS_LABELS[status]}
    </Badge>
  );
}

const HANDOVER_TONES: Record<HandoverItemStatus, { tone: BadgeTone; icon: IconName }> = {
  awaiting_supply: { tone: "amber", icon: "clock" },
  awaiting_verification: { tone: "amber", icon: "eye" },
  verified: { tone: "green", icon: "check" },
  rejected: { tone: "red", icon: "alert" },
  not_applicable: { tone: "neutral", icon: "close" },
};

export function HandoverStatusBadge({ status }: { status: HandoverItemStatus }) {
  const { tone, icon } = HANDOVER_TONES[status];
  return (
    <Badge tone={tone} icon={icon}>
      {HANDOVER_STATUS_LABELS[status]}
    </Badge>
  );
}

const REVIEW_TONES: Record<ReviewStatus, BadgeTone> = { not_reviewed: "neutral", reviewed: "green", changes_requested: "red" };

export function ReviewBadge({ review }: { review: ReviewStatus }) {
  return (
    <Badge tone={REVIEW_TONES[review]} dot>
      {REVIEW_STATUS_LABELS[review]}
    </Badge>
  );
}

const TASK_TONES: Record<TaskStatus, BadgeTone> = { open: "neutral", done: "green", excluded: "slate", cancelled: "slate" };

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge tone={TASK_TONES[status]}>{TASK_STATUS_LABELS[status]}</Badge>;
}

/** "In progress" in charcoal, "Complete" in green, "Not started" muted. */
export function ProgressText({ progress }: { progress: SectionProgress }) {
  return (
    <span className={cx(progress === "complete" ? "font-medium text-emerald-800" : progress === "in_progress" ? "text-ink" : "text-ink-soft")}>
      {PROGRESS_LABELS[progress]}
    </span>
  );
}

const INVITE_STATUS: Record<InviteStatus, { label: string; tone: BadgeTone; icon: IconName }> = {
  draft: { label: "Draft", tone: "neutral", icon: "pencil" },
  active: { label: "Link active", tone: "accent", icon: "link" },
  submitted: { label: "Pack submitted", tone: "green", icon: "check" },
  revoked: { label: "Withdrawn", tone: "neutral", icon: "close" },
  expired: { label: "Expired", tone: "neutral", icon: "clock" },
};

export function InviteStatusBadge({ status }: { status: InviteStatus }) {
  const { label, tone, icon } = INVITE_STATUS[status];
  return (
    <Badge tone={tone} icon={icon}>
      {label}
    </Badge>
  );
}

/** A thin bar: charcoal fill, green when complete. */
export function ProgressBar({ value, label, className }: { value: number; label: string; className?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cx("h-1.5 w-full overflow-hidden bg-sunken", className)}
    >
      <div className={cx("h-full transition-[width] duration-300", pct >= 100 ? "bg-emerald-600" : "bg-ink")} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** The small "PORTFOLIO / ONBOARDING" trail above a page title. */
export function Crumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2 text-[11px] font-medium tracking-[0.18em] text-muted uppercase">
      {items.map((item, i) => (
        <span key={item.label}>
          {i > 0 ? (
            <span aria-hidden="true" className="mx-1.5">
              /
            </span>
          ) : null}
          {item.href ? (
            <Link href={item.href} className="hover:text-ink hover:underline">
              {item.label}
            </Link>
          ) : (
            <span aria-current={i === items.length - 1 ? "page" : undefined} className="text-ink-soft">
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** A labelled block for "Before go-live" and similar lists: red for blockers, green when clear. */
export function Notice({ tone, icon, title, children }: { tone: "red" | "green" | "amber" | "neutral"; icon: IconName; title: ReactNode; children?: ReactNode }) {
  const tones = {
    red: "border-red-200 bg-red-50 text-red-900",
    green: "border-emerald-200 bg-emerald-50 text-emerald-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    neutral: "border-line bg-subtle text-ink-soft",
  } as const;
  const iconTones = { red: "text-red-700", green: "text-emerald-700", amber: "text-amber-700", neutral: "text-taupe" } as const;
  return (
    <div className={cx("flex gap-3 border px-4 py-3 text-[13px]", tones[tone])}>
      <Icon name={icon} className={cx("mt-0.5 size-4 shrink-0", iconTones[tone])} />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{title}</div>
        {children ? <div className="mt-1">{children}</div> : null}
      </div>
    </div>
  );
}

/** The amber SAMPLE tag for made-up directory entries and staff. */
export function SampleLabel({ sample }: { sample: boolean }) {
  return sample ? (
    <Badge tone="amber" className="font-semibold tracking-wide" title="Made up for the demo: replace with the real record">
      SAMPLE
    </Badge>
  ) : null;
}
