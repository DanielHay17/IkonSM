import { useAgent } from "agents/react";
import { useEffect, useRef, useState } from "react";
import type { PropertyState } from "../../shared/types";
import { usePolling } from "./usePolling";

/** connecting: socket not open yet; live: state streams over the websocket; polling: socket failed, refetch on a timer. */
export type LiveMode = "connecting" | "live" | "polling";

export interface PropertyLive {
  /** Latest state pushed by the building agent (null until the socket delivers it). */
  state: PropertyState | null;
  mode: LiveMode;
  /** Changes whenever views should refetch: the agent's version bumped, or a polling tick. */
  refreshKey: number;
}

export const POLL_INTERVAL_MS = 10_000;
const CONNECT_TIMEOUT_MS = 6_000;
const CLOSES_BEFORE_POLLING = 2;

/**
 * Subscribes to a building agent's read-only live state over `/agents/property-agent/<id>`.
 * If the websocket cannot connect (blocked proxy, auth, outage) it falls back to polling every
 * 10s, and switches back to live as soon as the socket reconnects.
 */
export function usePropertyLive(propertyId: string): PropertyLive {
  const [snapshot, setSnapshot] = useState<{ id: string; state: PropertyState | null }>({ id: propertyId, state: null });
  const [mode, setMode] = useState<LiveMode>("connecting");
  const [refreshKey, setRefreshKey] = useState(0);
  const lastVersion = useRef<number | null>(null);
  const closes = useRef(0);

  useEffect(() => {
    lastVersion.current = null;
    closes.current = 0;
    setMode("connecting");
    const timer = window.setTimeout(() => setMode((m) => (m === "connecting" ? "polling" : m)), CONNECT_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [propertyId]);

  useAgent<PropertyState>({
    agent: "PropertyAgent",
    name: propertyId,
    maxReconnectionDelay: 30_000,
    onStateUpdate: (next) => {
      setSnapshot({ id: propertyId, state: next });
      if (lastVersion.current !== null && next.version !== lastVersion.current) setRefreshKey((k) => k + 1);
      lastVersion.current = next.version;
    },
    onOpen: () => {
      closes.current = 0;
      setMode("live");
    },
    onClose: () => {
      closes.current += 1;
      setMode((m) => (closes.current >= CLOSES_BEFORE_POLLING ? "polling" : m === "live" ? "connecting" : m));
    },
  });

  usePolling(() => setRefreshKey((k) => k + 1), mode === "polling" ? POLL_INTERVAL_MS : null);

  return { state: snapshot.id === propertyId ? snapshot.state : null, mode, refreshKey };
}
