import { useEffect, useState, type ReactNode } from "react";
import { usePortfolio } from "../providers/PortfolioProvider";
import { paths, useLocationPath } from "../router";
import { CountBubble } from "./Badge";
import { IconButton } from "./Button";
import { Icon } from "./Icon";
import { Link } from "./Link";
import { Modal } from "./Modal";
import { Sidebar } from "./Sidebar";
import { Wordmark } from "./Wordmark";

/**
 * Fixed charcoal sidebar on large screens; on phones and tablets it collapses into a top bar with
 * a slide-in drawer.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = useLocationPath();
  const { pendingApprovals } = usePortfolio();

  useEffect(() => setDrawerOpen(false), [pathname]);

  return (
    <div className="min-h-dvh lg:pl-72">
      <a
        href="#main"
        className="sr-only z-[70] bg-surface px-4 py-2 text-sm font-medium text-ink shadow-pop focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 lg:block">
        <Sidebar />
      </aside>

      <header
        data-surface="dark"
        className="sticky top-0 z-30 flex h-14 items-center gap-3 bg-charcoal px-3 text-white shadow-[0_1px_0_rgb(255_255_255/0.06)] lg:hidden"
      >
        <IconButton icon="menu" label="Open menu" variant="dark" size="md" onClick={() => setDrawerOpen(true)} />
        <Link href={paths.portfolio()} className="flex min-w-0 flex-1 py-2" aria-label="IKON SM Command Hub home">
          <Wordmark layout="inline" />
        </Link>
        <Link
          href={paths.approvals()}
          className="flex h-10 items-center gap-1.5 px-2.5 text-sm text-charcoal-text hover:bg-white/10 hover:text-white"
          aria-label={`Approvals, ${pendingApprovals} pending`}
        >
          <Icon name="approve" className="size-[18px]" />
          <CountBubble count={pendingApprovals} tone="inverse" />
        </Link>
      </header>

      <Modal open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Menu" placement="left" bare>
        <Sidebar onClose={() => setDrawerOpen(false)} />
      </Modal>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1440px] px-4 py-6 outline-none sm:px-6 lg:px-10 lg:py-8">
        {children}
      </main>
    </div>
  );
}
