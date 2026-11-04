import { cx } from "../lib/cx";

const LOGO_SRC = {
  /** White artwork, for charcoal surfaces. */
  reversed: "/brand/ikonsm-logo-reversed.png",
  /** Charcoal artwork, for white and light grey surfaces. */
  dark: "/brand/ikonsm-logo-dark.png",
} as const;

/** The official IKON SM logo (served from public/brand, never hotlinked). Size it with a width class. */
export function Logo({ tone = "reversed", className }: { tone?: keyof typeof LOGO_SRC; className?: string }) {
  return (
    <img
      src={LOGO_SRC[tone]}
      alt="IKON SM Strata Management"
      width={1500}
      height={308}
      decoding="async"
      className={cx("block h-auto max-w-full select-none", className)}
      draggable={false}
    />
  );
}

/** Small letter-spaced product label that sits with the logo, echoing its "STRATA MANAGEMENT" line. */
export function ProductLabel({ tone = "reversed", className }: { tone?: keyof typeof LOGO_SRC; className?: string }) {
  return (
    <span
      className={cx(
        "text-[10px] leading-none font-medium tracking-[0.3em] whitespace-nowrap uppercase",
        tone === "reversed" ? "text-charcoal-muted" : "text-taupe-ink",
        className,
      )}
    >
      Command Hub
    </span>
  );
}

/** Logo plus the "Command Hub" label: stacked in the sidebar, side by side in the mobile bar. */
export function Wordmark({ layout = "stacked", tone = "reversed" }: { layout?: "stacked" | "inline"; tone?: keyof typeof LOGO_SRC }) {
  if (layout === "inline") {
    return (
      <span className="flex min-w-0 items-center gap-3">
        <Logo tone={tone} className="w-[112px] shrink-0" />
        <span aria-hidden="true" className={cx("hidden h-5 w-px min-[360px]:block", tone === "reversed" ? "bg-white/20" : "bg-line-strong")} />
        <span className="hidden min-[360px]:block">
          <ProductLabel tone={tone} />
        </span>
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-3">
      <Logo tone={tone} className="w-[168px]" />
      <span className="flex items-center gap-2.5">
        <span aria-hidden="true" className="h-px w-5 bg-taupe" />
        <ProductLabel tone={tone} />
      </span>
    </span>
  );
}
