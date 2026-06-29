"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Lightweight save confirmation toast.
 * Usage:
 *   const { showSaveToast, SaveToastUI } = useSaveToast();
 *   showSaveToast("Proposal saved");
 *   // Render <SaveToastUI /> in the component tree
 */
export function useSaveToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSaveToast = useCallback((msg = "Saved") => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setMessage(msg);
    timerRef.current = setTimeout(() => setMessage(null), 2500);
  }, []);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  function SaveToastUI() {
    if (!message) return null;
    return (
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 animate-[fadeInUp_0.2s_ease-out]">
        <div className="pointer-events-auto flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-3 text-sm font-bold text-white shadow-lg">
          <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 fill-emerald-400" aria-hidden="true"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 0 1 0 1.414l-8 8a1 1 0 0 1-1.414 0l-4-4a1 1 0 1 1 1.414-1.414L8 12.586l7.293-7.293a1 1 0 0 1 1.414 0z" clipRule="evenodd" /></svg>
          {message}
        </div>
      </div>
    );
  }

  return { showSaveToast, SaveToastUI };
}
