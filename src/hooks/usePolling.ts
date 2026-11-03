import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Calls `callback` every `intervalMs` while the tab is visible (null pauses it), and once
 * straight away when the tab becomes visible again after being hidden.
 */
export function usePolling(callback: () => void, intervalMs: number | null): void {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (intervalMs === null) return;
    const tick = () => {
      if (!document.hidden) callbackRef.current();
    };
    const onVisible = () => {
      if (!document.hidden) callbackRef.current();
    };
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);
}
