import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SessionInfo } from "../../shared/types";
import { api, setUnauthorizedHandler } from "../api";

type SessionStatus =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; session: SessionInfo };

interface SessionContextValue {
  session: SessionInfo;
  setSession: (session: SessionInfo) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Loads /api/session and exposes it; renders `renderGate` until a session exists. */
export function SessionProvider({
  children,
  renderGate,
}: {
  children: ReactNode;
  renderGate: (state: SessionStatus, controls: { retry: () => void; setSession: (s: SessionInfo) => void }) => ReactNode;
}) {
  const [state, setState] = useState<SessionStatus>({ status: "loading" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    api.session().then(
      (session) => setState({ status: "ready", session }),
      (error: unknown) => setState({ status: "error", error }),
    );
  }, []);

  useEffect(load, [load]);

  const setSession = useCallback((session: SessionInfo) => setState({ status: "ready", session }), []);

  useEffect(() => {
    setUnauthorizedHandler(() =>
      setState((s) => (s.status === "ready" ? { status: "ready", session: { ...s.session, authenticated: false, staffName: null } } : s)),
    );
    return () => setUnauthorizedHandler(null);
  }, []);

  // Someone else may flip the hub-wide AI switch: pick it up when this tab comes back into view.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      api.session().then(
        (session) => setState((s) => (s.status === "ready" && s.session.authenticated && session.authenticated ? { status: "ready", session } : s)),
        () => {},
      );
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);

  const signOut = useCallback(async () => {
    const session = await api.logout();
    setState({ status: "ready", session });
  }, []);

  const value = useMemo<SessionContextValue | null>(
    () => (state.status === "ready" && state.session.authenticated ? { session: state.session, setSession, signOut } : null),
    [state, setSession, signOut],
  );

  if (!value) return <>{renderGate(state, { retry: load, setSession })}</>;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export type { SessionStatus };

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside an authenticated <SessionProvider>");
  return value;
}
