"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { clearJobCardReturn, peekJobCardReturn } from "@/lib/crm-board-nav";

/**
 * Shows a "Back to Job" link when the user arrived from a Job Card to the
 * Estimate/Invoice board. Clicking it goes back to the originating job card,
 * preserving its previous state.
 */
export default function BackToJobsLink() {
  const [show, setShow] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const state = peekJobCardReturn();
    setShow(Boolean(state?.jobId));
  }, []);

  if (!show) return null;

  return (
    <button
      type="button"
      onClick={() => {
        clearJobCardReturn();
        try { window.sessionStorage.removeItem("crm-return-to-jobs"); } catch {}
        if (window.history.length > 1) router.back();
        else router.push("/crm/leads");
      }}
      className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700 transition hover:bg-blue-100"
    >
      <ArrowLeft className="h-4 w-4" /> Back to Job
    </button>
  );
}
