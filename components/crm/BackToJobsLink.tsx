"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * Shows a "Back to Jobs" link only when the user arrived from the Jobs board
 * (a job card opened this board). The flag is set in sessionStorage by the
 * Jobs page and cleared once the user navigates back.
 */
export default function BackToJobsLink() {
  const [show, setShow] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    setShow(window.sessionStorage.getItem("crm-return-to-jobs") === "1");
  }, []);

  if (!show) return null;

  return (
    <button
      type="button"
      onClick={() => {
        window.sessionStorage.removeItem("crm-return-to-jobs");
        router.push("/crm/leads");
      }}
      className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-black text-blue-700 transition hover:bg-blue-100"
    >
      <ArrowLeft className="h-4 w-4" /> Back to Jobs
    </button>
  );
}
