// Domain-specific badges: priority, statuses, engines and document flags, so every screen
// shows the same signal the same way.

import { engineLabel, providerLabel } from "../../shared/engines";
import {
  CATEGORY_LABELS,
  type AiInfo,
  type Approval,
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

/** Short text for a triage result's engine, e.g. "Claude claude-haiku-5-5" or "Workers AI @cf/…". */
export function triageEngineText(triage: Pick<Triage, "engine" | "model" | "provider">): string {
  return triage.engine === "rules" ? "Rules engine (AI offline)" : engineLabel(triage.engine, triage.model, triage.provider);
}

/**
 * Which engine triaged it: "Claude <model>", "Claude via Cloudflare AI Gateway (<model>)",
 * "Workers AI <model>", or "Rules engine (AI offline)". Never blurs AI and rules output.
 */
export function TriageEngineBadge({ triage }: { triage: Pick<Triage, "engine" | "model" | "provider"> }) {
  if (triage.engine === "claude") {
    return (
      <Badge tone="accent" icon="sparkles" title={triage.provider === "gateway" ? "Triaged by Claude through Cloudflare AI Gateway" : "Triaged by Claude"}>
        {triageEngineText(triage)}
      </Badge>
    );
  }
  if (triage.engine === "workers-ai") {
    return (
      <Badge tone="sky" icon="sparkles" title="Triaged by a Workers AI model (lighter than Claude), checked against the rules engine">
        {triageEngineText(triage)}
      </Badge>
    );
  }
  return (
    <Badge tone="slate" icon="cpu" title="Deterministic keyword rules; no AI was used">
      Rules engine (AI offline)
    </Badge>
  );
}

export function DraftEngineBadge({ approval }: { approval: Pick<Approval, "engine" | "model" | "provider"> }) {
  if (approval.engine === "template") {
    return (
      <Badge tone="slate" icon="file" title="Safe template; no AI was used">
        Template draft (no AI)
      </Badge>
    );
  }
  const label = engineLabel(approval.engine, approval.model, approval.provider);
  return (
    <Badge tone={approval.engine === "workers-ai" ? "sky" : "accent"} icon="sparkles" title={`Drafted by ${label}`}>
      Drafted by {label}
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
    <Badge tone="charcoal" icon="bookmark" title="Ikon-wide policy, copied into every building agent">
      Company policy
    </Badge>
  );
}

const PILL_TEXT: Record<AiInfo["provider"], string> = {
  anthropic: "Claude online",
  gateway: "Claude via AI Gateway",
  "workers-ai": "Workers AI (light)",
  off: "AI offline",
};

/** Online/offline pill that also names the provider, so a lighter model is never shown as plain "AI online". */
export function AiStatusPill({ online, ai, tone = "light" }: { online: boolean; ai?: AiInfo | null; tone?: "light" | "dark" }) {
  const text = online ? (ai && ai.provider !== "off" ? PILL_TEXT[ai.provider] : "AI online") : "AI offline";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] leading-4 font-medium ring-1 ring-inset",
        tone === "dark"
          ? online
            ? "bg-emerald-400/10 text-emerald-200 ring-emerald-300/25"
            : "bg-white/5 text-charcoal-text ring-white/15"
          : online
            ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
            : "bg-canvas text-ink-soft ring-line-strong",
      )}
      title={
        online
          ? ai
            ? providerLabel(ai)
            : "AI connected"
          : `No LLM in use: rules and templates only${ai?.note ? ` (${ai.note})` : ""}`
      }
    >
      <span aria-hidden="true" className={cx("size-1.5 rounded-full", online ? "bg-emerald-500" : "bg-taupe")} />
      {text}
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
