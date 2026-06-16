"use client";

import { useEffect, useRef } from "react";

// Detect if user is on a mobile device
function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

const CRM_SYNC_CHANNEL = "xrp-crm-sync";

/**
 * Broadcast a sync signal to all open tabs/windows so they refresh immediately
 * instead of waiting for the next polling cycle.
 */
export function broadcastSync(source?: string) {
  if (typeof window === "undefined") return;
  try {
    const bc = new BroadcastChannel(CRM_SYNC_CHANNEL);
    bc.postMessage({ type: "sync", source: source || "unknown", ts: Date.now() });
    bc.close();
  } catch {
    // BroadcastChannel not supported — fall back to storage event
    try {
      window.localStorage.setItem("xrp-crm-sync-signal", String(Date.now()));
    } catch { /* quota */ }
  }
}

/**
 * Re-run `onRefresh` whenever the user returns to the page so data is reloaded
 * without a manual refresh:
 *  - window `focus` (switching back to the tab/window)
 *  - `visibilitychange` -> visible (returning from another app, esp. on mobile)
 *  - cross-tab `storage` writes on the same device
 *  - BroadcastChannel messages for instant cross-tab sync
 *  - an optional polling interval as a safety net
 *
 * MOBILE: Automatically uses aggressive 3-second polling to ensure data stays fresh
 * on mobile devices where background tab suspension is common.
 *
 * The latest callback is held in a ref so callers can pass an inline function
 * without re-binding listeners on every render.
 */
export function useAutoRefresh(onRefresh: () => void, { intervalMs }: { intervalMs?: number } = {}) {
  const callbackRef = useRef(onRefresh);
  useEffect(() => { callbackRef.current = onRefresh; });

  useEffect(() => {
    if (typeof window === "undefined") return;

    let lastRun = 0;
    const DEBOUNCE_MS = 300;
    const run = () => {
      const now = Date.now();
      if (now - lastRun < DEBOUNCE_MS) return;
      lastRun = now;
      callbackRef.current();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        // Always refresh when becoming visible (critical for mobile)
        run();
      }
    };

    window.addEventListener("focus", run);
    window.addEventListener("storage", run);
    document.addEventListener("visibilitychange", onVisible);

    // BroadcastChannel for instant cross-tab sync
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(CRM_SYNC_CHANNEL);
      bc.onmessage = () => run();
    } catch { /* BroadcastChannel not supported */ }

    // Mobile gets aggressive polling (3 seconds), desktop uses provided interval or none
    const mobileDefault = isMobileDevice() ? 3000 : 0;
    const finalInterval = intervalMs ?? mobileDefault;
    
    const timer = finalInterval > 0 ? window.setInterval(run, finalInterval) : undefined;

    return () => {
      window.removeEventListener("focus", run);
      window.removeEventListener("storage", run);
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) window.clearInterval(timer);
      if (bc) { bc.close(); bc = null; }
    };
  }, [intervalMs]);
}

/**
 * Hook specifically for mobile devices that forces refresh every time
 * the app comes to foreground (most aggressive sync strategy)
 */
export function useMobileAggressiveSync(onRefresh: () => void) {
  const callbackRef = useRef(onRefresh);
  useEffect(() => { callbackRef.current = onRefresh; });

  useEffect(() => {
    if (typeof window === "undefined") return;

    let lastRun = 0;
    const DEBOUNCE_MS = 200;
    const debouncedRun = () => {
      const now = Date.now();
      if (now - lastRun < DEBOUNCE_MS) return;
      lastRun = now;
      callbackRef.current();
    };

    // Force refresh every time app becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Small delay to ensure network is ready
        setTimeout(debouncedRun, 100);
      }
    };

    // Force refresh on page show (when returning from background on mobile)
    const handlePageShow = () => {
      setTimeout(debouncedRun, 100);
    };

    // Refresh immediately on mount
    callbackRef.current();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);

    // BroadcastChannel for instant cross-tab sync
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(CRM_SYNC_CHANNEL);
      bc.onmessage = () => debouncedRun();
    } catch { /* BroadcastChannel not supported */ }

    // Mobile aggressive polling every 3 seconds (reduced from 5s)
    const mobileInterval = window.setInterval(debouncedRun, 3000);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
      window.clearInterval(mobileInterval);
      if (bc) { bc.close(); bc = null; }
    };
  }, []);
}
