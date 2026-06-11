"use client";

import { useEffect, useRef, useCallback } from "react";

// Detect if user is on a mobile device
function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * Re-run `onRefresh` whenever the user returns to the page so data is reloaded
 * without a manual refresh:
 *  - window `focus` (switching back to the tab/window)
 *  - `visibilitychange` -> visible (returning from another app, esp. on mobile)
 *  - cross-tab `storage` writes on the same device
 *  - an optional polling interval as a safety net
 *
 * MOBILE: Automatically uses aggressive 5-second polling to ensure data stays fresh
 * on mobile devices where background tab suspension is common.
 *
 * The latest callback is held in a ref so callers can pass an inline function
 * without re-binding listeners on every render.
 */
export function useAutoRefresh(onRefresh: () => void, { intervalMs }: { intervalMs?: number } = {}) {
  const callbackRef = useRef(onRefresh);
  callbackRef.current = onRefresh;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const run = () => callbackRef.current();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        // Always refresh when becoming visible (critical for mobile)
        run();
      }
    };

    window.addEventListener("focus", run);
    window.addEventListener("storage", run);
    document.addEventListener("visibilitychange", onVisible);

    // Mobile gets aggressive polling (5 seconds), desktop uses provided interval or none
    const mobileDefault = isMobileDevice() ? 5000 : 0;
    const finalInterval = intervalMs ?? mobileDefault;
    
    const timer = finalInterval > 0 ? window.setInterval(run, finalInterval) : undefined;

    return () => {
      window.removeEventListener("focus", run);
      window.removeEventListener("storage", run);
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) window.clearInterval(timer);
    };
  }, [intervalMs]);
}

/**
 * Hook specifically for mobile devices that forces refresh every time
 * the app comes to foreground (most aggressive sync strategy)
 */
export function useMobileAggressiveSync(onRefresh: () => void) {
  const callbackRef = useRef(onRefresh);
  callbackRef.current = onRefresh;

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Force refresh every time app becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Small delay to ensure network is ready
        setTimeout(() => callbackRef.current(), 100);
      }
    };

    // Force refresh on page show (when returning from background on mobile)
    const handlePageShow = () => {
      setTimeout(() => callbackRef.current(), 100);
    };

    // Refresh immediately on mount
    callbackRef.current();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);

    // Mobile aggressive polling every 5 seconds
    const mobileInterval = window.setInterval(() => {
      callbackRef.current();
    }, 5000);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
      window.clearInterval(mobileInterval);
    };
  }, []);
}
