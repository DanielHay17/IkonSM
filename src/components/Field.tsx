import { useId, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cx } from "../lib/cx";

const CONTROL =
  "block w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink shadow-[inset_0_1px_1px_rgb(20_22_26/0.03)] " +
  "placeholder:text-[#9a9da3] transition-colors hover:border-[#c6c1b5] " +
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 " +
  "disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted";

/** `height` is separate so callers can resize controls without conflicting utilities. */
export const inputClasses = (extra?: string, height = "h-10") => cx(CONTROL, height, extra);
export const textareaClasses = (extra?: string) => cx(CONTROL, "py-2 leading-relaxed", extra);
export const selectClasses = (extra?: string, height = "h-10") => cx(CONTROL, height, "appearance-auto", extra);

interface FieldShellProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  /** Visually hide the label (it stays available to screen readers). */
  hideLabel?: boolean;
  className?: string;
  children: ReactNode;
}

function FieldShell({ id, label, hint, required, hideLabel, className, children }: FieldShellProps) {
  return (
    <div className={className}>
      <label htmlFor={id} className={cx("mb-1.5 block text-[13px] font-medium text-ink-soft", hideLabel && "sr-only")}>
        {label}
        {required ? (
          <span className="ml-0.5 text-red-700" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type Shared = { label: ReactNode; hint?: ReactNode; hideLabel?: boolean; fieldClassName?: string };

export function TextField({ label, hint, hideLabel, fieldClassName, className, id, ...rest }: Shared & ComponentPropsWithoutRef<"input">) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <FieldShell id={inputId} label={label} hint={hint} required={rest.required} hideLabel={hideLabel} className={fieldClassName}>
      <input id={inputId} aria-describedby={hint ? `${inputId}-hint` : undefined} className={inputClasses(className)} {...rest} />
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  hint,
  hideLabel,
  fieldClassName,
  className,
  id,
  ...rest
}: Shared & ComponentPropsWithoutRef<"textarea">) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <FieldShell id={inputId} label={label} hint={hint} required={rest.required} hideLabel={hideLabel} className={fieldClassName}>
      <textarea id={inputId} aria-describedby={hint ? `${inputId}-hint` : undefined} className={textareaClasses(className)} {...rest} />
    </FieldShell>
  );
}

export function SelectField({
  label,
  hint,
  hideLabel,
  fieldClassName,
  className,
  id,
  children,
  ...rest
}: Shared & ComponentPropsWithoutRef<"select">) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <FieldShell id={inputId} label={label} hint={hint} required={rest.required} hideLabel={hideLabel} className={fieldClassName}>
      <select id={inputId} aria-describedby={hint ? `${inputId}-hint` : undefined} className={selectClasses(className)} {...rest}>
        {children}
      </select>
    </FieldShell>
  );
}

export function CheckboxField({ label, hint, className, id, ...rest }: { label: ReactNode; hint?: ReactNode } & ComponentPropsWithoutRef<"input">) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={cx("flex items-start gap-2.5", className)}>
      <input
        id={inputId}
        type="checkbox"
        className="mt-0.5 size-4 rounded border-line-strong accent-[#0f766e] focus-visible:outline-2 focus-visible:outline-accent"
        {...rest}
      />
      <div>
        <label htmlFor={inputId} className="text-sm text-ink">
          {label}
        </label>
        {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      </div>
    </div>
  );
}
