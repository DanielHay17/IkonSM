import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon, type IconName } from "./Icon";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dangerGhost" | "dark";
export type ButtonSize = "xs" | "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white shadow-sm hover:bg-accent-strong disabled:bg-accent/60",
  secondary:
    "border border-line-strong bg-surface text-ink shadow-[0_1px_1px_rgb(20_22_26/0.04)] hover:bg-subtle hover:border-[#c6c1b5] disabled:text-muted",
  ghost: "text-ink-soft hover:bg-ink/5 hover:text-ink disabled:text-muted",
  danger: "bg-red-700 text-white shadow-sm hover:bg-red-800 disabled:bg-red-700/60",
  dangerGhost: "text-red-700 hover:bg-red-50 disabled:text-red-700/50",
  dark: "bg-white/10 text-white hover:bg-white/15 disabled:text-white/50",
};

const SIZES: Record<ButtonSize, string> = {
  xs: "h-7 gap-1.5 rounded-md px-2 text-xs",
  sm: "h-8 gap-1.5 rounded-lg px-3 text-[13px]",
  md: "h-10 gap-2 rounded-lg px-4 text-sm",
};

export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string): string {
  return cx(
    "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors duration-150",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed",
    VARIANTS[variant],
    SIZES[size],
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
  const iconSize = size === "md" ? "size-4" : "size-3.5";
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
  const square = size === "md" ? "w-10 px-0" : size === "sm" ? "w-8 px-0" : "w-7 px-0";
  const iconSize = size === "md" ? "size-[18px]" : "size-4";
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
