import type { ReactNode } from "react";
import { ASSIGNEE_LABELS, type Triage } from "../../shared/types";
import { formatDateTime } from "../lib/format";
import { Badge } from "./Badge";
import { Card } from "./Card";
import { Icon } from "./Icon";
import { CategoryBadge, PriorityBadge, RESPONSIBILITY_LABELS, TriageEngineBadge } from "./StatusBadges";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[150px_1fr] sm:gap-4">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0 text-[13px] text-ink">{children}</dd>
    </div>
  );
}

/** Prominent banner shown when the inbound message looks like it tries to instruct the AI. */
export function PromptInjectionBanner() {
  return (
    <div role="alert" className="flex gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3.5 text-red-900">
      <Icon name="shield" className="mt-0.5 size-5 text-red-700" />
      <div className="text-[13px] leading-relaxed">
        <p className="font-semibold">Possible prompt-injection attempt</p>
        <p className="mt-0.5">
          This message contains instructions aimed at the AI (for example, to ignore its rules or send data elsewhere). The agent treated it as
          untrusted data, drafted no reply and will not act on it. Verify the sender before responding, and never send owner or lot details to
          an address that is not on file.
        </p>
      </div>
    </div>
  );
}

export function SafetyNotice({ text }: { text: string }) {
  return (
    <div role="note" className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3.5 text-amber-950">
      <Icon name="alert" className="mt-0.5 size-5 text-amber-600" />
      <div className="text-[13px] leading-relaxed">
        <p className="font-semibold">Safety first</p>
        <p className="mt-0.5 whitespace-pre-line">{text}</p>
      </div>
    </div>
  );
}

export function TriagePanel({ triage }: { triage: Triage }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon name="bolt" className="size-4 text-accent" />
          Triage
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <TriageEngineBadge triage={triage} />
          {triage.engine !== "rules" ? (
            <span className="text-xs text-muted tabular-nums" title="Model confidence">
              {Math.round(triage.confidence * 100)}% confident
            </span>
          ) : null}
        </div>
      </div>

      <div className="px-5 pt-3">
        {triage.summary ? <p className="text-sm leading-relaxed text-ink">{triage.summary}</p> : null}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {triage.needsHuman ? (
            <Badge tone="amber" icon="users">
              Needs a human
            </Badge>
          ) : null}
          {!triage.replyNeeded ? <Badge tone="neutral">No reply needed</Badge> : null}
        </div>
      </div>

      <dl className="divide-y divide-line px-5 pb-2">
        <Row label="Category">
          <CategoryBadge category={triage.category} />
        </Row>
        <Row label="Priority">
          <PriorityBadge priority={triage.priority} withLabel />
        </Row>
        <Row label="Responsibility">
          <span className="font-medium">{RESPONSIBILITY_LABELS[triage.responsibility]}</span>
          {triage.responsibilityReason ? <p className="mt-0.5 leading-relaxed text-ink-soft">{triage.responsibilityReason}</p> : null}
        </Row>
        <Row label="Allocate to">
          {triage.allocateTo.length ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="Allocate to">
              {triage.allocateTo.map((role) => (
                <li key={role}>
                  <span className="inline-flex items-center rounded-full border border-line-strong bg-surface px-2.5 py-0.5 text-xs font-medium text-ink-soft">
                    {ASSIGNEE_LABELS[role]}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-muted">Nobody yet</span>
          )}
        </Row>
        {triage.contractorTrade ? (
          <Row label="Contractor trade">
            <span className="inline-flex items-center gap-1.5 capitalize">
              <Icon name="wrench" className="size-3.5 text-muted" />
              {triage.contractorTrade}
            </span>
          </Row>
        ) : null}
        {triage.statutoryDeadline ? (
          <Row label="Statutory deadline">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-900 ring-1 ring-amber-200 ring-inset">
              <Icon name="clock" className="size-3.5" />
              {triage.statutoryDeadline}
            </span>
          </Row>
        ) : null}
        <Row label="Triaged">
          <span className="text-ink-soft">{formatDateTime(triage.triagedAt)}</span>
        </Row>
      </dl>
    </Card>
  );
}
