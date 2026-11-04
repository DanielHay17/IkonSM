import darkLogo from "../assets/brand/ikonsm-logo-dark.webp";
import reversedLogo from "../assets/brand/ikonsm-logo-reversed.webp";
import { cx } from "../lib/cx";

// 480px wide (2x the largest display size), bundled so the file names carry a content hash.
// The full-size masters are in docs/brand.
const LOGO_SRC = {
  /** White artwork, for charcoal surfaces. */
  reversed: reversedLogo,
  /** Charcoal artwork, for white and light grey surfaces. */
  dark: darkLogo,
} as const;

/** The official IKON SM logo (bundled from src/assets/brand, never hotlinked). Size it with a width class. */
export function Logo({ tone = "reversed", className }: { tone?: keyof typeof LOGO_SRC; className?: string }) {
  return (
    <img
      src={LOGO_SRC[tone]}
      alt="IKON SM Strata Management"
      width={480}
      height={99}
      decoding="async"
      className={cx("block h-auto max-w-full select-none", className)}
      draggable={false}
    />
  );
}

/** Small product label that sits with the logo. Less tracking than the logo's own "STRATA MANAGEMENT" line, so the two don't compete. */
export function ProductLabel({ tone = "reversed", className }: { tone?: keyof typeof LOGO_SRC; className?: string }) {
  return (
    <span
      className={cx(
        "text-[11px] leading-none font-medium tracking-[0.12em] whitespace-nowrap uppercase",
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
    <span className="flex flex-col gap-4">
      {/* 200px keeps the logo's tagline legible at 1x; the website shows it at about 244px. */}
      <Logo tone={tone} className="w-[200px]" />
      <span className="flex items-center gap-2.5">
        <span aria-hidden="true" className="h-px w-5 bg-taupe" />
        <ProductLabel tone={tone} />
      </span>
    </span>
  );
}
