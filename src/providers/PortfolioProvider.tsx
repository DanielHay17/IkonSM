import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { PropertyCard } from "../../shared/types";
import { api } from "../api";
import { usePolling } from "../hooks/usePolling";
import { useResource } from "../hooks/useResource";

interface PortfolioContextValue {
  cards: PropertyCard[] | undefined;
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
  cardFor: (propertyId: string) => PropertyCard | undefined;
  /** Pending approvals across every building (for the sidebar badge). */
  pendingApprovals: number;
  /** Open P1 threads across every building. */
  p1Open: number;
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

const REFRESH_MS = 30_000;

/** The 16 schemes and their counts, shared by the sidebar, portfolio grid and approvals queue. */
export function PortfolioProvider({ children }: { children: ReactNode }) {
  const resource = useResource("portfolio", api.portfolio);
  usePolling(() => void resource.reload(), REFRESH_MS);

  const { data: cards, loading, error, reload } = resource;
  const value = useMemo<PortfolioContextValue>(() => {
    const byId = new Map((cards ?? []).map((card) => [card.profile.id, card]));
    const sum = (pick: (c: PropertyCard) => number) => (cards ?? []).reduce((total, card) => total + pick(card), 0);
    return {
      cards,
      loading,
      error,
      reload,
      cardFor: (id) => byId.get(id),
      pendingApprovals: sum((c) => c.counts.pendingApprovals),
      p1Open: sum((c) => c.counts.p1Open),
    };
  }, [cards, loading, error, reload]);

  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
}

export function usePortfolio(): PortfolioContextValue {
  const value = useContext(PortfolioContext);
  if (!value) throw new Error("usePortfolio must be used inside <PortfolioProvider>");
  return value;
}
