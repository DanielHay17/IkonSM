// Shared bits of the portal's visual language: status chips, Perth dates and the hidden file inputs.

import { forwardRef, type ComponentPropsWithoutRef } from "react";
import type { HandoverItemStatus } from "../../../shared/onboarding";
import { Badge, type BadgeTone } from "../../components/Badge";

// Amber only for "awaiting" (with Ikon to verify), red for "needs replacing", green for verified. A
// document still to supply is the outgoing manager's normal to-do, so it is a calm charcoal outline.
const ITEM_TONES: Record<HandoverItemStatus, BadgeTone> = {
  awaiting_supply: "accent",
  awaiting_verification: "amber",
  verified: "green",
  rejected: "red",
  not_applicable: "slate",
};

/** The outgoing manager's words for each state: the same as the progress legend and the filters. */
export const PORTAL_STATUS_LABELS: Record<HandoverItemStatus, string> = {
  awaiting_supply: "Still needed",
  awaiting_verification: "With Ikon to verify",
  verified: "Verified by Ikon",
  rejected: "Needs replacing",
  not_applicable: "Not applicable",
};

export function ItemStatusBadge({ status }: { status: HandoverItemStatus }) {
  return (
    <Badge tone={ITEM_TONES[status]} dot>
      {PORTAL_STATUS_LABELS[status]}
    </Badge>
  );
}

const perthDateTime = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Perth",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "7 Nov 2026, 2:15 pm" in Perth time. */
export function formatPerthDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : perthDateTime.format(date);
}

/** A visually hidden file input, opened by a visible button. */
export const HiddenFileInput = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<"input"> & { directory?: boolean }>(function HiddenFileInput(
  { directory, ...rest },
  ref,
) {
  const folderProps = directory ? ({ webkitdirectory: "", directory: "" } as Record<string, string>) : {};
  return <input ref={ref} type="file" tabIndex={-1} aria-hidden="true" className="sr-only" {...folderProps} {...rest} />;
});
