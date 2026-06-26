"use client";

import { useEffect, useInsertionEffect, useRef } from "react";

/**
 * Minimum elapsed time (ms) between two refresh callbacks.  When the user
 * returns to the tab (focus / visibilitychange) we only re-fetch if more
 * than this many milliseconds have passed since the last refresh, preventing
 * the rapid-fire reloads that previously made the CRM feel unstable.
 */
const FOCUS_COOLDOWN_MS = 5_000;

/**
 * Re-run `onRefresh` when the user returns to the page **and** the data is
 * stale (more than FOCUS_COOLDOWN_MS since the last refresh):
 *
 *  - window `focus` (switching back to the tab/window)
 *  - `visibilitychange` → visible (returning from another app, mobile)
 *  - cross-tab `storage` writes on the same device
 *  - BroadcastChannel messages from other tabs on the same device
 *
 * **No polling interval** — data freshness comes from Supabase realtime
 * subscriptions. The hook only fires on user-initiated navigation events,
 * keeping pages stable and free of random refreshes.
 *
 * The latest callback is held in a ref so callers can pass an inline
 * function without re-binding listeners on every render.
 */
export function useAutoRefresh(onRefresh: () => void) {
  const callbackRef = useRef(onRefresh);
  useInsertionEffect(() => { callbackRef.current = onRefresh; });

  useEffect(() => {
    if (typeof window === "undefined") return;

    let lastRun = Date.now();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const debouncedRun = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const now = Date.now();
        if (now - lastRun < FOCUS_COOLDOWN_MS) return;
        lastRun = now;
        callbackRef.current();
      }, 300);
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

    return () => {
      window.removeEventListener("focus", debouncedRun);
      window.removeEventListener("storage", debouncedRun);
      document.removeEventListener("visibilitychange", onVisible);
      if (bc) { try { bc.close(); } catch { /* ignore */ } }
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, []);
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
