// Domain-specific badges: priority, statuses, engines and document flags, so every screen
// shows the same signal the same way.

import {
  CATEGORY_LABELS,
  type ApprovalStatus,
  type Category,
  type Channel,
  type DocMeta,
  type Priority,
  type PropertyProfile,
  type Responsibility,
  type ThreadStatus,
  type TicketStatus,
  type Triage,
} from "../../shared/types";
import { Badge, type BadgeTone } from "./Badge";
import { cx } from "../lib/cx";
import { Icon, type IconName } from "./Icon";

export const PRIORITY_LABELS: Record<Priority, string> = {
  P1: "Emergency",
  P2: "Urgent",
  P3: "Routine",
};

export function PriorityBadge({ priority, withLabel = false }: { priority: Priority; withLabel?: boolean }) {
  const tone: BadgeTone = priority === "P1" ? "red" : priority === "P2" ? "amber" : "slate";
  return (
    <Badge tone={tone} solid={priority === "P1"} title={`${priority}: ${PRIORITY_LABELS[priority]}`} className="font-semibold">
      {priority}
      {withLabel ? ` · ${PRIORITY_LABELS[priority]}` : ""}
    </Badge>
  );
}

export function CategoryBadge({ category }: { category: Category }) {
  return <Badge tone="neutral">{CATEGORY_LABELS[category]}</Badge>;
}

const THREAD_STATUS: Record<ThreadStatus, { label: string; tone: BadgeTone }> = {
  new: { label: "New", tone: "sky" },
  triaged: { label: "Triaged", tone: "slate" },
  awaiting_approval: { label: "Awaiting approval", tone: "amber" },
  replied: { label: "Replied", tone: "green" },
  closed: { label: "Closed", tone: "neutral" },
};

export function ThreadStatusBadge({ status }: { status: ThreadStatus }) {
  const { label, tone } = THREAD_STATUS[status];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  new: "New",
  assigned: "Assigned",
  in_progress: "In progress",
  waiting: "Waiting",
  done: "Done",
};

const APPROVAL_STATUS: Record<ApprovalStatus, { label: string; tone: BadgeTone; icon: IconName }> = {
  pending: { label: "Awaiting approval", tone: "amber", icon: "clock" },
  approved: { label: "Approved & sent", tone: "green", icon: "check" },
  rejected: { label: "Rejected", tone: "neutral", icon: "close" },
  failed: { label: "Send failed", tone: "red", icon: "alert" },
};

export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  const { label, tone, icon } = APPROVAL_STATUS[status];
  return (
    <Badge tone={tone} icon={icon}>
      {label}
    </Badge>
  );
}

const PROPERTY_STATUS: Record<PropertyProfile["status"], { label: string; tone: BadgeTone }> = {
  pilot: { label: "Pilot", tone: "accent" },
  active: { label: "Active", tone: "green" },
  onboarding: { label: "Onboarding", tone: "neutral" },
};

export function PropertyStatusPill({ status }: { status: PropertyProfile["status"] }) {
  const { label, tone } = PROPERTY_STATUS[status];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

export const RESPONSIBILITY_LABELS: Record<Responsibility, string> = {
  strata_company: "Strata company",
  lot_owner: "Lot owner",
  unclear: "Unclear: needs checking",
  not_applicable: "Not applicable",
};

export const CHANNEL_META: Record<Channel, { label: string; icon: IconName }> = {
  email: { label: "Email", icon: "mail" },
  sms: { label: "SMS", icon: "message" },
  portal: { label: "Owner portal", icon: "globe" },
  phone: { label: "Phone", icon: "phone" },
  staff: { label: "Staff note", icon: "pencil" },
};

/** "Claude <model>" when Claude triaged it, "Rules engine (AI offline)" otherwise. Never blurs the two. */
export function TriageEngineBadge({ triage }: { triage: Pick<Triage, "engine" | "model"> }) {
  if (triage.engine === "claude") {
    return (
      <Badge tone="accent" icon="sparkles" title="Triaged by Claude">
        Claude {triage.model ?? ""}
      </Badge>
    );
  }
  return (
    <Badge tone="slate" icon="cpu" title="Deterministic keyword rules; no AI was used">
      Rules engine (AI offline)
    </Badge>
  );
}

export function DraftEngineBadge({ engine }: { engine: "claude" | "template" }) {
  return engine === "claude" ? (
    <Badge tone="accent" icon="sparkles">
      Drafted by Claude
    </Badge>
  ) : (
    <Badge tone="slate" icon="file" title="Safe template; no AI was used">
      Template draft (AI offline)
    </Badge>
  );
}

const INDEXED: Record<DocMeta["indexed"], { label: string; tone: BadgeTone; title: string }> = {
  full: { label: "Indexed", tone: "green", title: "Full text extracted and searchable" },
  metadata: { label: "Name only", tone: "slate", title: "Only the name and folder are searchable" },
  failed: { label: "Extraction failed", tone: "red", title: "Text could not be extracted; only the name is searchable" },
};

export function IndexedBadge({ indexed }: { indexed: DocMeta["indexed"] }) {
  const { label, tone, title } = INDEXED[indexed];
  return (
    <Badge tone={tone} dot title={title}>
      {label}
    </Badge>
  );
}

export function SampleBadge() {
  return (
    <Badge tone="amber" title="Sample/demo content: replace with the real record" className="font-semibold tracking-wide">
      SAMPLE
    </Badge>
  );
}

export function CompanyPolicyBadge() {
  return (
    <Badge tone="violet" icon="bookmark" title="Ikon-wide policy, copied into every building agent">
      Company policy
    </Badge>
  );
}

export function AiStatusPill({ online, tone = "light" }: { online: boolean; tone?: "light" | "dark" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        tone === "dark"
          ? online
            ? "bg-emerald-400/10 text-emerald-200 ring-emerald-300/20"
            : "bg-white/5 text-navy-text ring-white/10"
          : online
            ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
            : "bg-slate-100 text-slate-700 ring-slate-200",
      )}
      title={online ? "Claude is connected" : "No API key configured: rules and templates only"}
    >
      <span aria-hidden="true" className={cx("size-1.5 rounded-full", online ? "bg-emerald-500" : "bg-slate-400")} />
      {online ? "AI online" : "AI offline"}
    </span>
  );
}

/** Small "P1 open" alert dot used in lists and the sidebar. */
export function AlertDot({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cx("relative inline-flex size-2", className)} title={label}>
      <span aria-hidden="true" className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-50 motion-reduce:hidden" />
      <span aria-hidden="true" className="relative inline-flex size-2 rounded-full bg-red-500" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function ChannelIcon({ channel, className = "size-3.5" }: { channel: Channel; className?: string }) {
  const meta = CHANNEL_META[channel];
  return <Icon name={meta.icon} className={className} label={meta.label} />;
}
