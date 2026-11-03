import type { PortfolioBrief } from "../../shared/types";
import { api } from "../api";
import { useCosLive } from "./useCosLive";
import { useResource } from "./useResource";

export interface BriefState {
  brief: PortfolioBrief | null | undefined;
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
  setBrief: (brief: PortfolioBrief) => void;
  /** Bumps when the Chief of Staff's live state changes. */
  refreshKey: number;
}

function newer(a: PortfolioBrief | null | undefined, b: PortfolioBrief | null | undefined): PortfolioBrief | null | undefined {
  if (!a) return b ?? a;
  if (!b) return a;
  return a.generatedAt >= b.generatedAt ? a : b;
}

/** The portfolio brief: fetched over REST, kept current by the Chief of Staff's live state when its socket is up. */
export function useBrief(): BriefState {
  const cos = useCosLive();
  const fetched = useResource("brief", api.brief, cos.refreshKey);

  return {
    brief: newer(cos.brief, fetched.data),
    loading: fetched.loading && cos.brief === undefined,
    error: cos.brief ? null : fetched.error,
    reload: fetched.reload,
    setBrief: fetched.mutate,
    refreshKey: cos.refreshKey,
  };
}
