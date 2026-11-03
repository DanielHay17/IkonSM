import { createContext, useContext } from "react";
import type { AiInfo, PropertyOverview, PropertyProfile, PropertyState } from "../../../shared/types";
import type { LiveMode } from "../../hooks/usePropertyLive";

export interface BuildingContextValue {
  propertyId: string;
  profile: PropertyProfile;
  overview: PropertyOverview | undefined;
  /** Live state from the agent's websocket (null while connecting or when polling). */
  live: PropertyState | null;
  liveMode: LiveMode;
  /** Changes whenever the current view should silently refetch. */
  refreshKey: number;
  aiOnline: boolean;
  /** LLM provider and model in use (live agent state, else the session's view of the Worker config). */
  ai: AiInfo | null;
  reloadOverview: () => Promise<void>;
  openSimulate: () => void;
}

export const BuildingContext = createContext<BuildingContextValue | null>(null);

export function useBuilding(): BuildingContextValue {
  const value = useContext(BuildingContext);
  if (!value) throw new Error("useBuilding must be used inside a building page");
  return value;
}
