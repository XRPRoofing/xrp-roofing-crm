"use client";

import { useState } from "react";

type PaymentMethod = "card" | "ach";

type InvoicePaymentButtonsProps = {
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  customerEmail: string;
};

export default function InvoicePaymentButtons({ invoiceId, invoiceNumber, amount, customerEmail }: InvoicePaymentButtonsProps) {
  const [loadingMethod, setLoadingMethod] = useState<PaymentMethod | null>(null);
  const [error, setError] = useState("");

  async function startCheckout(paymentMethod: PaymentMethod) {
    setLoadingMethod(paymentMethod);
    setError("");

    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId,
          invoiceNumber,
          amount,
          paymentMethod,
          customerEmail,
          successUrl: `${window.location.origin}/invoice/${encodeURIComponent(invoiceId)}/thank-you`,
          cancelUrl: `${window.location.origin}/invoice/${encodeURIComponent(invoiceId)}?payment=cancelled`,
        }),
      });

      const data = await response.json().catch(() => null) as { checkoutUrl?: string; error?: string } | null;

      if (!response.ok || !data?.checkoutUrl) {
        throw new Error(data?.error || "Unable to start payment. Please contact XRP Roofing.");
      }

      window.location.assign(data.checkoutUrl);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Unable to start payment. Please contact XRP Roofing.");
      setLoadingMethod(null);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <button type="button" onClick={() => startCheckout("card")} disabled={Boolean(loadingMethod) || amount <= 0 || !customerEmail} className="block w-full rounded-2xl bg-blue-600 px-4 py-3 text-center text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
        {loadingMethod === "card" ? "Opening secure checkout..." : "Pay by Card"}
      </button>
      <button type="button" onClick={() => startCheckout("ach")} disabled={Boolean(loadingMethod) || amount <= 0 || !customerEmail} className="block w-full rounded-2xl bg-blue-600 px-4 py-3 text-center text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
        {loadingMethod === "ach" ? "Opening secure checkout..." : "Pay by ACH Bank Transfer"}
      </button>
      {!customerEmail && <p className="text-xs font-bold text-red-700">Customer email is required before online payment can start.</p>}
      {error && <p className="rounded-2xl bg-red-50 p-3 text-xs font-bold leading-5 text-red-700">{error}</p>}
    </div>
  );
}
