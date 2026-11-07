// The top of the portal: who is asking for what by when (in the charcoal band), and the progress bar.

import type { PortalView } from "../../../shared/onboarding";
import { countOf, formatPortalDate, progressParts } from "../../../shared/portal-upload";
import { Card } from "../../components/Card";
import { cx } from "../../lib/cx";

export function buildingLine(view: PortalView): string {
  const tail = [view.building.suburb, "WA", view.building.postcode].filter(Boolean).join(" ");
  return `${view.building.street}, ${tail}`;
}

/** The band's header: "Handover of SP 87192, 160 Wright Street, Kewdale" and the key dates. */
export function PortalHeading({ view }: { view: PortalView }) {
  const facts: { label: string; value: string }[] = [
    { label: "Outgoing manager", value: `${view.outgoingManager.name}, ${view.outgoingManager.company}` },
    { label: "Records due", value: formatPortalDate(view.recordsDueDate) },
    { label: "Handover date", value: formatPortalDate(view.handoverDate) },
    { label: "Link expires", value: formatPortalDate(view.expiresAt) },
  ];
  return (
    <div className="mt-8 sm:mt-12">
      <p className="mb-3 flex items-center gap-3 text-[11px] font-medium tracking-[0.3em] text-charcoal-muted uppercase">
        <span aria-hidden="true" className="h-px w-8 bg-taupe" />
        Strata management handover
      </p>
      <h1 className="heading-display text-[28px] leading-[1.02] text-white sm:text-[44px] lg:text-[52px]">
        Handover of <span className="whitespace-nowrap">SP {view.building.spNumber}</span>
        <span className="sr-only">, </span>
        <span className="mt-2 block font-sans text-lg leading-snug font-normal tracking-normal text-white/90 normal-case sm:mt-3 sm:text-[22px]">
          {buildingLine(view)}
        </span>
      </h1>
      <p className="mt-4 max-w-3xl text-sm leading-relaxed text-charcoal-text sm:text-[15px]">
        Requested by {view.incomingManager.name}, {view.incomingManager.title}, {view.companyName}. Records due {formatPortalDate(view.recordsDueDate)}. This secure
        link expires {formatPortalDate(view.expiresAt)}.
      </p>
      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-white/15 pt-5 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
        {facts.map((fact) => (
          <div key={fact.label} className={cx("min-w-0", fact.label === "Outgoing manager" && "col-span-2 lg:col-span-1")}>
            <dt className="text-[11px] font-medium tracking-[0.12em] text-charcoal-muted uppercase">{fact.label}</dt>
            <dd className="mt-1 text-sm font-medium break-words text-white">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const PARTS = [
  { key: "verified", label: "Verified by Ikon", swatch: "bg-emerald-600" },
  { key: "supplied", label: "With Ikon to verify", swatch: "bg-amber-400" },
  { key: "notApplicable", label: "Not applicable", swatch: "bg-taupe" },
  { key: "outstanding", label: "Still needed", swatch: "bg-sunken ring-1 ring-inset ring-line-input" },
] as const;

/** Supplied, verified, not applicable and outstanding, as one bar with a legend. */
export function ProgressCard({ view }: { view: PortalView }) {
  const { progress } = view;
  const widths = progressParts(progress);
  const handled = progress.total - progress.outstanding;
  const rejected = view.items.filter((item) => item.status === "rejected").length;
  return (
    <Card>
      <section aria-labelledby="portal-progress-title" className="px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h2 id="portal-progress-title" className="heading-display text-[13px] leading-6 text-ink">
              Your progress
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              <span className="heading-display mr-1.5 align-[-2px] text-[26px] leading-none text-ink">
                {handled} of {progress.total}
              </span>{" "}
              requested documents supplied or marked not applicable
            </p>
          </div>
          <p className="text-sm text-muted">
            {progress.outstanding ? (
              <>
                <span className="font-semibold text-ink">{progress.outstanding}</span> still needed
                {rejected ? `, including ${countOf(rejected, "to replace", "to replace")}` : ""}
              </>
            ) : (
              <span className="font-medium text-emerald-800">Nothing outstanding</span>
            )}
          </p>
        </div>
        <div aria-hidden="true" className="mt-4 flex h-3 w-full overflow-hidden bg-sunken">
          {PARTS.map((part) =>
            widths[part.key] > 0 ? <div key={part.key} className={cx("h-full", part.swatch)} style={{ width: `${widths[part.key]}%` }} /> : null,
          )}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-soft">
          {PARTS.map((part) => (
            <li key={part.key} className="flex items-center gap-2">
              <span aria-hidden="true" className={cx("size-2.5", part.swatch)} />
              {part.label}
              <span className="font-semibold text-ink tabular-nums">{progress[part.key]}</span>
            </li>
          ))}
        </ul>
      </section>
    </Card>
  );
}
