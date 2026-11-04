import type { ReactNode } from "react";
import { errorMessage } from "../api";
import { cx } from "../lib/cx";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

export function EmptyState({ icon = "inbox", title, description, action, compact, className }: EmptyStateProps) {
  return (
    <div className={cx("flex flex-col items-center justify-center text-center", compact ? "px-4 py-8" : "px-6 py-14", className)}>
      <div className="mb-3.5 grid size-11 place-items-center border border-line-strong bg-surface text-taupe">
        <Icon name={icon} className="size-5" />
      </div>
      <p className="heading-display text-[13px] leading-5 text-ink">{title}</p>
      {description ? <div className="mt-1 max-w-sm text-[13px] text-muted">{description}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title = "Couldn't load this",
  compact,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  compact?: boolean;
}) {
  return (
    <div role="alert" className={cx("flex flex-col items-center text-center", compact ? "px-4 py-8" : "px-6 py-14")}>
      <div className="mb-3 grid size-11 place-items-center border border-red-200 bg-red-50 text-red-700">
        <Icon name="alert" className="size-5" />
      </div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 max-w-sm text-[13px] text-muted">{errorMessage(error)}</p>
      {onRetry ? (
        <Button className="mt-4" size="sm" icon="refresh" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Inline error line for forms and dialogs. */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
      <Icon name="alert" className="mt-0.5 size-4" />
      <span>{errorMessage(error)}</span>
    </p>
  );
}
