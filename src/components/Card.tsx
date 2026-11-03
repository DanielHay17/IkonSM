import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cx } from "../lib/cx";

export function Card({ className, ...rest }: ComponentPropsWithoutRef<"div">) {
  return <div className={cx("rounded-xl border border-line bg-surface shadow-card", className)} {...rest} />;
}

interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Small element before the title (an icon). */
  leading?: ReactNode;
  as?: "h2" | "h3";
  className?: string;
}

export function CardHeader({ title, description, actions, leading, as: Heading = "h2", className }: CardHeaderProps) {
  return (
    <div className={cx("flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {leading}
        <div className="min-w-0">
          <Heading className="text-[15px] leading-6 font-semibold text-ink">{title}</Heading>
          {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...rest }: ComponentPropsWithoutRef<"div">) {
  return <div className={cx("px-5 py-4", className)} {...rest} />;
}

/** Page title block used at the top of every screen. */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1.5 text-[13px] text-muted">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px] sm:leading-9">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
