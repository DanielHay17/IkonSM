import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon, type IconName } from "./Icon";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dangerGhost" | "dangerQuiet" | "dark";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  // Solid charcoal with white text, like the website's dark buttons.
  primary: "bg-accent text-white hover:bg-accent-strong disabled:bg-accent/45",
  // White with a thin outline that firms up to charcoal on hover (the website's white button).
  secondary: "border border-line-input bg-surface text-ink hover:border-ink hover:bg-subtle disabled:border-line-strong disabled:text-muted",
  ghost: "text-ink-soft hover:bg-ink/[0.06] hover:text-ink disabled:text-muted",
  danger: "bg-red-700 text-white hover:bg-red-800 disabled:bg-red-700/60",
  dangerGhost: "text-red-700 hover:bg-red-50 disabled:text-red-700/50",
  // Repeated destructive actions (a delete on every row): grey at rest, red only when pointed at or focused.
  dangerQuiet: "text-muted hover:bg-red-50 hover:text-red-700 focus-visible:text-red-700 disabled:text-muted/60",
  dark: "text-charcoal-text hover:bg-white/10 hover:text-white disabled:text-white/50",
};

const SIZES: Record<ButtonSize, string> = {
  xs: "h-7 gap-1.5 rounded-md px-2",
  sm: "h-8 gap-1.5 rounded-lg px-3",
  md: "h-10 gap-2 rounded-lg px-4",
  lg: "h-12 gap-2 rounded-lg px-5",
};

/** Body-face labels (Poppins, sentence case): toolbar buttons (xs, sm) and ghost buttons. */
const TEXT: Record<ButtonSize, string> = {
  xs: "text-xs font-medium",
  sm: "text-[13px] font-medium",
  md: "text-sm font-medium",
  lg: "text-sm font-medium",
};

/**
 * Action buttons (md and up) use the display face in caps, like the website's "REQUEST A QUOTE",
 * whether solid or outlined, so the buttons in a dialog or card footer share one case and cap height.
 */
const DISPLAY_TEXT: Partial<Record<ButtonSize, string>> = {
  md: "heading-display text-xs",
  lg: "heading-display text-[13px]",
};

const DISPLAY_VARIANTS = new Set<ButtonVariant>(["primary", "secondary", "danger", "dangerGhost"]);

export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string): string {
  return cx(
    "inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-colors duration-150",
    // The focus ring comes from the base layer (charcoal, or white on charcoal surfaces).
    "disabled:cursor-not-allowed",
    VARIANTS[variant],
    SIZES[size],
    (DISPLAY_VARIANTS.has(variant) && DISPLAY_TEXT[size]) || TEXT[size],
    extra,
  );
}

interface ButtonProps extends ComponentPropsWithoutRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const iconSize = size === "md" || size === "lg" ? "size-4" : "size-3.5";
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner className={iconSize} label={null} /> : icon ? <Icon name={icon} className={iconSize} /> : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} className={iconSize} /> : null}
    </button>
  );
}

interface IconButtonProps extends ComponentPropsWithoutRef<"button"> {
  icon: IconName;
  /** Required: icon-only buttons need an accessible name. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function IconButton({
  icon,
  label,
  variant = "ghost",
  size = "sm",
  loading = false,
  disabled,
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  const square = size === "lg" ? "w-12 px-0" : size === "md" ? "w-10 px-0" : size === "sm" ? "w-8 px-0" : "w-7 px-0";
  const iconSize = size === "md" || size === "lg" ? "size-[18px]" : "size-4";
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={buttonClasses(variant, size, cx(square, className))}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner className={iconSize} label={null} /> : <Icon name={icon} className={iconSize} />}
    </button>
  );
}
