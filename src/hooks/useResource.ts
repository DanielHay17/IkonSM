import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface Resource<T> {
  data: T | undefined;
  /** Set when the first load failed (background refresh failures keep the last good data). */
  error: Error | null;
  /** True until the first load for the current key finishes. */
  loading: boolean;
  /** True while a background refresh is in flight. */
  refreshing: boolean;
  reload: () => Promise<void>;
  /**
   * Ignore the responses to requests already in flight (they may predate a change just saved).
   * Cheaper than a reload when a live refresh is on its way anyway. Only for data that has loaded.
   */
  invalidate: () => void;
  /** Replace the data locally (optimistic updates, or applying a mutation's response). */
  mutate: (update: T | ((previous: T | undefined) => T)) => void;
}

interface Snapshot<T> {
  key: string | null;
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  refreshing: boolean;
}

const toError = (err: unknown) => (err instanceof Error ? err : new Error(String(err)));

/**
 * Loads data for `key` (null = don't load) and reloads it silently whenever `refreshKey`
 * changes, e.g. when the building agent's live state version bumps. Stale responses from an
 * older key or an overtaken request are ignored.
 */
export function useResource<T>(key: string | null, load: () => Promise<T>, refreshKey?: unknown): Resource<T> {
  const loadRef = useRef(load);
  useLayoutEffect(() => {
    loadRef.current = load;
  });

  const [snapshot, setSnapshot] = useState<Snapshot<T>>({
    key,
    data: undefined,
    error: null,
    loading: key !== null,
    refreshing: false,
  });
  const requestId = useRef(0);

  const run = useCallback(
    async (background: boolean) => {
      if (key === null) return;
      const id = ++requestId.current;
      setSnapshot((s) =>
        s.key === key && background
          ? { ...s, refreshing: true }
          : { key, data: s.key === key ? s.data : undefined, error: null, loading: s.key !== key || s.data === undefined, refreshing: false },
      );
      try {
        const data = await loadRef.current();
        if (id !== requestId.current) return;
        setSnapshot({ key, data, error: null, loading: false, refreshing: false });
      } catch (err) {
        if (id !== requestId.current) return;
        setSnapshot((s) => {
          const hasData = s.key === key && s.data !== undefined;
          return hasData
            ? { ...s, refreshing: false, loading: false }
            : { key, data: undefined, error: toError(err), loading: false, refreshing: false };
        });
      }
    },
    [key],
  );

  useEffect(() => {
    void run(false);
  }, [run]);

  const lastRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (Object.is(lastRefreshKey.current, refreshKey)) return;
    lastRefreshKey.current = refreshKey;
    void run(true);
  }, [refreshKey, run]);

  const reload = useCallback(() => run(true), [run]);

  const invalidate = useCallback(() => {
    requestId.current++;
    setSnapshot((s) => (s.refreshing ? { ...s, refreshing: false } : s));
  }, []);

  const mutate = useCallback(
    (update: T | ((previous: T | undefined) => T)) => {
      setSnapshot((s) => {
        const previous = s.key === key ? s.data : undefined;
        const data = typeof update === "function" ? (update as (p: T | undefined) => T)(previous) : update;
        return { key, data, error: null, loading: false, refreshing: s.refreshing };
      });
    },
    [key],
  );

  const current = snapshot.key === key;
  return {
    data: current ? snapshot.data : undefined,
    error: current ? snapshot.error : null,
    loading: key !== null && (!current || snapshot.loading),
    refreshing: current && snapshot.refreshing,
    reload,
    invalidate,
    mutate,
  };
}
