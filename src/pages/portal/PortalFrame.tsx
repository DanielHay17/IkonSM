// The portal's page frame: the IKON SM charcoal band with the reversed logo, the content column and a
// plain footer. Also the full-page messages (link not valid, expired or withdrawn, couldn't load).

import type { ReactNode } from "react";
import { Button } from "../../components/Button";
import { Icon, type IconName } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";
import { Logo } from "../../components/Wordmark";
import { cx } from "../../lib/cx";

export const CONTAINER = "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8";

/** The charcoal band: logo and the "Secure handover portal" label, with the page's header below them. */
export function PortalBand({ children }: { children?: ReactNode }) {
  return (
    <header data-surface="dark" className="bg-charcoal text-white">
      <div className={cx(CONTAINER, "pt-5 sm:pt-7", children ? "pb-8 sm:pb-10" : "pb-5 sm:pb-7")}>
        <div className="flex items-center justify-between gap-4">
          <Logo className="w-[132px] sm:w-[190px]" />
          <p className="flex items-center gap-2 text-[11px] font-medium tracking-[0.14em] whitespace-nowrap text-charcoal-muted uppercase">
            <Icon name="lock" className="size-3.5 text-taupe" />
            <span>
              Secure <span className="max-[400px]:hidden">handover </span>portal
            </span>
          </p>
        </div>
        {children}
      </div>
    </header>
  );
}

export function PortalFooter({ children }: { children?: ReactNode }) {
  return (
    <footer className="mt-auto border-t border-line bg-surface">
      <div className={cx(CONTAINER, "space-y-2 py-6 text-xs leading-relaxed text-muted")}>
        {children}
        <p>
          Ikon Strata Management · Perth, Western Australia ·{" "}
          <a href="https://www.ikonsm.com.au" target="_blank" rel="noreferrer" className="link-brand text-muted">
            ikonsm.com.au
          </a>
        </p>
      </div>
    </footer>
  );
}

/** A whole page with one message: used before the handover can be shown, or once the link stops working. */
export function PortalMessage({
  icon,
  tone = "neutral",
  title,
  children,
  onRetry,
}: {
  icon: IconName;
  tone?: "neutral" | "red";
  title: string;
  children: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <PortalBand />
      <main className={cx(CONTAINER, "flex flex-1 items-start justify-center py-10 sm:items-center sm:py-16")}>
        <section
          role={tone === "red" ? "alert" : undefined}
          aria-labelledby="portal-message-title"
          className="w-full max-w-xl border border-line bg-surface px-6 py-8 shadow-card sm:px-10 sm:py-10"
        >
          <div
            className={cx(
              "mb-5 grid size-12 place-items-center border",
              tone === "red" ? "border-red-200 bg-red-50 text-red-700" : "border-line-strong bg-subtle text-taupe",
            )}
          >
            <Icon name={icon} className="size-6" />
          </div>
          <h1 id="portal-message-title" className="heading-display text-[22px] leading-tight text-ink sm:text-[26px]">
            {title}
          </h1>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-soft">{children}</div>
          {onRetry ? (
            <Button className="mt-6" variant="primary" icon="refresh" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </section>
      </main>
      <PortalFooter />
    </div>
  );
}

/** While the portal's code or the handover itself loads. */
export function PortalLoading() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <PortalBand />
      <p className="flex flex-1 items-center justify-center gap-3 px-4 py-16 text-sm text-muted" role="status">
        <Spinner className="size-5 text-accent" label={null} />
        Opening your handover…
      </p>
    </div>
  );
}
