import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon, type IconName } from "./Icon";
import { Link } from "./Link";

export interface TabItem<K extends string> {
  key: K;
  label: string;
  href: string;
  icon?: IconName;
  /** Small trailing element: a count or an alert dot. */
  adornment?: ReactNode;
}

/** Route-backed tab bar: each tab is a link, so tabs are deep-linkable and work with back/forward. */
export function TabNav<K extends string>({ items, active, label }: { items: TabItem<K>[]; active: K; label: string }) {
  const navRef = useRef<HTMLElement>(null);
  // On a narrow screen the strip scrolls sideways: keep the current tab in view (deep links, reloads).
  // Scroll the strip itself, not scrollIntoView: that would also move the browser's starting point
  // for Tab, so the first Tab press would skip the skip link, the sidebar and the header.
  useEffect(() => {
    const nav = navRef.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    const strip = nav.getBoundingClientRect();
    const tab = current.getBoundingClientRect();
    if (tab.left < strip.left) nav.scrollLeft += tab.left - strip.left - 16;
    else if (tab.right > strip.right) nav.scrollLeft += tab.right - strip.right + 16;
  }, [active]);
  return (
    <nav ref={navRef} aria-label={label} className="-mx-4 overflow-x-auto px-4 scrollbar-thin sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {items.map((item) => {
          const selected = item.key === active;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={selected ? "page" : undefined}
                className={cx(
                  "relative -mb-px inline-flex h-11 items-center gap-2 border-b-2 px-3 text-[13px] font-medium tracking-[0.06em] uppercase transition-colors",
                  selected
                    ? "border-accent text-ink"
                    : "border-transparent text-muted hover:border-line-input hover:text-ink",
                )}
              >
                {item.icon ? <Icon name={item.icon} className={cx("size-4", selected ? "text-ink" : "text-taupe")} /> : null}
                {item.label}
                {item.adornment}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

interface SegmentOption<V extends string> {
  value: V;
  label: string;
}

/** Small in-page toggle group (filters): plain buttons with aria-pressed, so Tab and Enter work as expected. */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: SegmentOption<V>[];
  value: V;
  onChange: (value: V) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5">
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={checked}
            onClick={() => onChange(option.value)}
            className={cx(
              "h-7 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors",
              checked ? "bg-accent text-white" : "text-ink-soft hover:bg-ink/[0.05] hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
