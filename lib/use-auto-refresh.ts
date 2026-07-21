"use client";

import { useEffect, useInsertionEffect, useRef } from "react";

const isMobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

/**
 * Minimum elapsed time (ms) between two refresh callbacks.  When the user
 * returns to the tab (focus / visibilitychange) we only re-fetch if the data
 * was marked dirty while the tab was in the background, preventing the
 * rapid-fire reloads that previously made the CRM feel unstable.
 *
 * Mobile gets a longer cooldown to reduce CPU/network churn on constrained
 * devices.
 */
const FOCUS_COOLDOWN_MS = isMobile ? 20_000 : 10_000;

/**
 * Background polling interval (ms) — safety net for when Supabase realtime
 * disconnects or cross-device sync misses an event. Keeps data fresh without
 * waiting for a tab-focus event.
 *
 * Mobile polls less aggressively to save battery and bandwidth.
 */
const POLL_INTERVAL_MS = isMobile ? 45_000 : 15_000;

/**
 * Re-run `onRefresh` when the data is known to be stale:
 *
 *  - cross-tab BroadcastChannel / storage write sets a dirty flag
 *  - returning to the tab (focus / visibilitychange) triggers a refresh
 *    ONLY if dirty OR more than FOCUS_COOLDOWN_MS have elapsed
 *  - background polling every POLL_INTERVAL_MS as a safety net for
 *    cross-device sync (catches missed realtime events)
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

    // Force an immediate refresh regardless of the cooldown. Used for strong
    // staleness signals — regaining network connectivity, or the page being
    // restored from the back/forward (bfcache) — which are extremely common on
    // phones that roam between Wi-Fi and cellular or switch between apps. In
    // those cases realtime WebSocket events may have been missed while the
    // socket was down, so we always re-fetch rather than trust the cooldown.
    const runNow = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      dirty = false;
      lastRun = Date.now();
      callbackRef.current();
    };

    const markDirty = () => { dirty = true; };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        runIfNeeded();
      }
    };

    // The device came back online (e.g. cellular reconnected, roamed networks).
    const onOnline = () => { runNow(); };

    // Page restored from bfcache (mobile app-switch / back navigation). The
    // `persisted` flag means the JS timers were frozen, so data is stale.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) runNow();
    };

    window.addEventListener("focus", runIfNeeded);
    window.addEventListener("storage", markDirty);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("xrp-crm-sync");
      bc.onmessage = () => { dirty = true; runIfNeeded(); };
    } catch {
      // BroadcastChannel not supported — fall back to storage events only
    }

    // Background polling — safety net for cross-device sync
    const pollId = setInterval(() => {
      if (document.visibilityState === "visible") {
        dirty = true;
        runIfNeeded();
      }
    }, POLL_INTERVAL_MS);

    return () => {
      window.removeEventListener("focus", runIfNeeded);
      window.removeEventListener("storage", markDirty);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
      if (bc) { try { bc.close(); } catch { /* ignore */ } }
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(pollId);
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
