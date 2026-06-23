"use client";

import { useEffect, useRef } from "react";

/**
 * Re-run `onRefresh` whenever the user returns to the page so data is reloaded
 * without a manual refresh:
 *  - window `focus` (switching back to the tab/window)
 *  - `visibilitychange` -> visible (returning from another app, esp. on mobile)
 *  - cross-tab `storage` writes on the same device
 *  - BroadcastChannel messages from other tabs on the same device
 *  - a safety-net polling interval (default 30s; callers can override)
 *
 * Refreshes are debounced so rapid events (e.g. focus + visibilitychange firing
 * together) only trigger one callback.
 *
 * The latest callback is held in a ref so callers can pass an inline function
 * without re-binding listeners on every render.
 */
export function useAutoRefresh(onRefresh: () => void, { intervalMs }: { intervalMs?: number } = {}) {
  const callbackRef = useRef(onRefresh);
  callbackRef.current = onRefresh;

  useEffect(() => {
    if (typeof window === "undefined") return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedRun = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => callbackRef.current(), 300);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        debouncedRun();
      }
    };

    window.addEventListener("focus", debouncedRun);
    window.addEventListener("storage", debouncedRun);
    document.addEventListener("visibilitychange", onVisible);

    // BroadcastChannel for instant cross-tab sync on the same device
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("xrp-crm-sync");
      bc.onmessage = () => debouncedRun();
    } catch {
      // BroadcastChannel not supported — fall back to storage events only
    }

    const finalInterval = intervalMs ?? 15_000;
    const timer = finalInterval > 0 ? window.setInterval(debouncedRun, finalInterval) : undefined;

    return () => {
      window.removeEventListener("focus", debouncedRun);
      window.removeEventListener("storage", debouncedRun);
      document.removeEventListener("visibilitychange", onVisible);
      if (bc) { try { bc.close(); } catch { /* ignore */ } }
      if (debounceTimer) clearTimeout(debounceTimer);
      if (timer) window.clearInterval(timer);
    };
  }, [intervalMs]);
}

/** Notify all other open tabs to refresh their data immediately. */
export function broadcastCrmUpdate() {
  if (typeof window === "undefined") return;
  try {
    const bc = new BroadcastChannel("xrp-crm-sync");
    bc.postMessage("update");
    bc.close();
  } catch {
    // BroadcastChannel not supported
  }
}

/**
 * Hook for ensuring data freshness when the app returns to the foreground.
 * Refreshes on visibility change and pageshow events with debouncing.
 */
export function useMobileAggressiveSync(onRefresh: () => void) {
  const callbackRef = useRef(onRefresh);
  callbackRef.current = onRefresh;

  useEffect(() => {
    if (typeof window === "undefined") return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedRun = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => callbackRef.current(), 300);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        debouncedRun();
      }
    };

    const handlePageShow = () => {
      debouncedRun();
    };

    callbackRef.current();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);

    const timer = window.setInterval(debouncedRun, 30_000);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
      if (debounceTimer) clearTimeout(debounceTimer);
      window.clearInterval(timer);
    };
  }, []);
}
