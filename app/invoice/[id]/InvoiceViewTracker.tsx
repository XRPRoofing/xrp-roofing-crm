"use client";

import { useEffect, useRef } from "react";

/**
 * Records a customer "viewed" event for the invoice exactly once per page load.
 * The actual de-duplication (first view only) and office notification happen
 * server-side in /api/invoices/track. Renders nothing.
 */
export default function InvoiceViewTracker({ invoiceId }: { invoiceId: string }) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current || !invoiceId) return;
    sent.current = true;

    void fetch("/api/invoices/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: invoiceId }),
      keepalive: true,
    }).catch(() => {});
  }, [invoiceId]);

  return null;
}
