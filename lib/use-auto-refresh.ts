"use client";

import { useEffect, useRef } from "react";

/**
 * Re-run `onRefresh` whenever the user returns to the page so data is reloaded
 * without a manual refresh:
 *  - window `focus` (switching back to the tab/window)
 *  - `visibilitychange` -> visible (returning from another app, esp. on mobile)
 *  - cross-tab `storage` writes on the same device
 *  - an optional polling interval as a safety net
 *
 * The latest callback is held in a ref so callers can pass an inline function
 * without re-binding listeners on every render.
 */
export function useAutoRefresh(onRefresh: () => void, { intervalMs = 0 }: { intervalMs?: number } = {}) {
  const callbackRef = useRef(onRefresh);
  callbackRef.current = onRefresh;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const run = () => callbackRef.current();
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };

    window.addEventListener("focus", run);
    window.addEventListener("storage", run);
    document.addEventListener("visibilitychange", onVisible);
    const timer = intervalMs > 0 ? window.setInterval(run, intervalMs) : undefined;

    return () => {
      window.removeEventListener("focus", run);
      window.removeEventListener("storage", run);
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) window.clearInterval(timer);
    };
  }, [intervalMs]);
}
