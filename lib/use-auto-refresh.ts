"use client";

import { useEffect, useInsertionEffect, useRef } from "react";

/**
 * Minimum elapsed time (ms) between two refresh callbacks.  When the user
 * returns to the tab (focus / visibilitychange) we only re-fetch if the data
 * was marked dirty while the tab was in the background, preventing the
 * rapid-fire reloads that previously made the CRM feel unstable.
 */
const FOCUS_COOLDOWN_MS = 30_000;

/**
 * Re-run `onRefresh` only when the data is known to be stale:
 *
 *  - cross-tab BroadcastChannel / storage write sets a dirty flag
 *  - returning to the tab (focus / visibilitychange) triggers a refresh
 *    ONLY if dirty OR more than FOCUS_COOLDOWN_MS have elapsed
 *
 * **No polling interval** — data freshness comes from Supabase realtime
 * subscriptions. The hook only fires on genuine staleness, keeping pages
 * stable and free of random refreshes.
 */
export function useAutoRefresh(onRefresh: () => void) {
  const callbackRef = useRef(onRefresh);
  useInsertionEffect(() => { callbackRef.current = onRefresh; });

  useEffect(() => {
    if (typeof window === "undefined") return;

    let lastRun = Date.now();
    let dirty = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const runIfNeeded = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const now = Date.now();
        const stale = now - lastRun >= FOCUS_COOLDOWN_MS;
        if (!dirty && !stale) return;
        dirty = false;
        lastRun = now;
        callbackRef.current();
      }, 300);
    };

    const markDirty = () => { dirty = true; };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        runIfNeeded();
      }
    };

    window.addEventListener("focus", runIfNeeded);
    window.addEventListener("storage", markDirty);
    document.addEventListener("visibilitychange", onVisible);

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("xrp-crm-sync");
      bc.onmessage = () => { dirty = true; runIfNeeded(); };
    } catch {
      // BroadcastChannel not supported — fall back to storage events only
    }

    return () => {
      window.removeEventListener("focus", runIfNeeded);
      window.removeEventListener("storage", markDirty);
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
