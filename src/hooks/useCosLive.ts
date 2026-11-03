import { useAgent } from "agents/react";
import { useRef, useState } from "react";
import type { PortfolioBrief } from "../../shared/types";

/** Live state of the ChiefOfStaffAgent (BUILD_SPEC Module D). */
interface CosState {
  brief: PortfolioBrief | null;
  version: number;
}

export interface CosLive {
  /** Latest brief pushed by the agent; undefined until the socket delivers state. */
  brief: PortfolioBrief | null | undefined;
  /** Changes whenever the Chief of Staff's state version bumps after the first update. */
  refreshKey: number;
}

/** Read-only subscription to the Chief of Staff agent ("main"); views fall back to plain fetches if it never connects. */
export function useCosLive(): CosLive {
  const [brief, setBrief] = useState<PortfolioBrief | null | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);
  const lastVersion = useRef<number | null>(null);

  useAgent<CosState>({
    agent: "ChiefOfStaffAgent",
    name: "main",
    maxReconnectionDelay: 60_000,
    onStateUpdate: (next) => {
      setBrief(next.brief);
      if (lastVersion.current !== null && next.version !== lastVersion.current) setRefreshKey((k) => k + 1);
      lastVersion.current = next.version;
    },
  });

  return { brief, refreshKey };
}
