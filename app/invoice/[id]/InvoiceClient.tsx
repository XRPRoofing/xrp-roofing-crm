"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import InvoicePaymentButtons from "./InvoicePaymentButtons";

type Invoice = {
  id: string;
  invoiceNumber?: string;
  clientName?: string;
  email?: string;
  phone?: string;
  jobName?: string;
  propertyAddress?: string;
  issueDate?: string;
  dueDate?: string;
  roofType?: string;
  proposalReference?: string;
  paymentTerms?: string;
  warrantyNotes?: string;
  discount?: number;
  status?: string;
  viewedAt?: string;
  sentAt?: string;
  paidAt?: string;
  lineItems?: { description: string; quantity: number; unitPrice: number; tax: number }[];
  payments?: { amount: number }[];
};

function currency(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function calculateTotals(invoice: Invoice) {
  const lineItems = invoice.lineItems || [];
  const subtotal = lineItems.reduce((total, item) => total + item.quantity * item.unitPrice, 0);
  const tax = lineItems.reduce((total, item) => total + item.quantity * item.unitPrice * (item.tax / 100), 0);
  const paid = (invoice.payments || []).reduce((total, payment) => total + payment.amount, 0);
  const finalTotal = Math.max(subtotal + tax - (invoice.discount || 0), 0);
  const balance = Math.max(finalTotal - paid, 0);
  return { subtotal, tax, finalTotal, paid, balance };
}

type DerivedStatus = "Draft" | "Sent" | "Viewed" | "Paid" | "Overdue";

function deriveStatus(invoice: Invoice, balance: number, paid: number): DerivedStatus {
  if (balance <= 0 && (paid > 0 || invoice.status === "Paid" || invoice.paidAt)) return "Paid";
  if (invoice.dueDate) {
    const due = new Date(invoice.dueDate);
    if (!Number.isNaN(due.getTime()) && due.getTime() < Date.now()) return "Overdue";
  }
  if (invoice.viewedAt || invoice.status === "Viewed") return "Viewed";
  if (invoice.sentAt || invoice.status === "Sent") return "Sent";
  if (invoice.status === "Draft") return "Draft";
  return "Sent";
}

const statusBadgeClass: Record<DerivedStatus, string> = {
  Draft: "bg-slate-100 text-slate-700",
  Sent: "bg-blue-100 text-blue-700",
  Viewed: "bg-indigo-100 text-indigo-700",
  Paid: "bg-emerald-100 text-emerald-700",
  Overdue: "bg-red-100 text-red-700",
};

const POLL_INTERVAL_MS = 10000;

export default function InvoiceClient({ invoiceId }: { invoiceId: string }) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const tracked = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/invoices/share?id=${encodeURIComponent(invoiceId)}`, { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as { invoice?: Invoice } | null;
      if (!response.ok || !data?.invoice) {
        setStatus((prev) => (prev === "ready" ? "ready" : "error"));
        return;
      }
      setInvoice(data.invoice);
      setStatus("ready");
    } catch {
      setStatus((prev) => (prev === "ready" ? "ready" : "error"));
    }
  }, [invoiceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();

    if (!tracked.current && invoiceId) {
      tracked.current = true;
      void fetch("/api/invoices/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: invoiceId }),
        keepalive: true,
      }).catch(() => {});
    }

    const interval = setInterval(() => void load(), POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, invoiceId]);

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12 text-slate-950">
        <div className="flex flex-col items-center gap-4">
          <span className="h-10 w-10 animate-spin rounded-full border-4 border-slate-300 border-t-blue-600" aria-hidden="true" />
          <p className="text-sm font-bold text-slate-500">Loading your invoice…</p>
        </div>
      </main>
    );
  }

  if (status === "error" || !invoice) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-12 text-slate-950">
        <section className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-blue-600">XRP Roofing Invoice</p>
          <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">Invoice link unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">This invoice has not been published yet or invoice sharing storage is not configured. Please contact XRP Roofing for a fresh invoice link.</p>
        </section>
      </main>
    );
  }

  const totals = calculateTotals(invoice);
  const derived = deriveStatus(invoice, totals.balance, totals.paid);
  const isPaid = derived === "Paid";

  return (
    <main className="min-h-screen overflow-x-hidden bg-slate-100 px-3 py-6 text-slate-950 sm:px-4 sm:py-8">
      <section className="mx-auto max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm sm:rounded-[2rem]">
        <div className="bg-[#07183f] p-5 text-white sm:p-8">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-300">XRP Roofing Invoice</p>
            <span className={`rounded-full px-3 py-1 text-xs font-black ${statusBadgeClass[derived]}`}>{derived}</span>
          </div>
          <div className="mt-4 flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div className="min-w-0">
              <h1 className="break-words text-3xl font-black tracking-tight sm:text-4xl">{invoice.invoiceNumber || invoice.id}</h1>
              <p className="mt-2 break-words text-blue-100">{invoice.clientName}</p>
              <p className="break-words text-blue-100">{invoice.propertyAddress}</p>
            </div>
            <div className="rounded-2xl bg-white/10 p-4 text-left md:text-right">
              <p className="text-xs font-black uppercase tracking-wider text-blue-100">Balance Due</p>
              <p className="mt-1 text-3xl font-black text-orange-300">{currency(totals.balance)}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 p-4 sm:p-5">
              <h2 className="text-lg font-black text-[#07183f] sm:text-xl">Scope of Work</h2>
              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                {(invoice.lineItems || []).map((item, index) => (
                  <div key={index} className="grid gap-1 border-b border-slate-100 p-4 last:border-b-0 sm:grid-cols-[1fr_120px] sm:gap-3">
                    <div className="min-w-0">
                      <p className="whitespace-pre-line break-words text-sm font-normal leading-relaxed text-slate-700">{item.description}</p>
                      <p className="mt-1 text-xs font-medium text-slate-400">Qty {item.quantity} · Tax {item.tax}%</p>
                    </div>
                    <p className="text-sm font-semibold text-slate-700 sm:text-right">{currency(item.quantity * item.unitPrice * (1 + item.tax / 100))}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 p-4 sm:p-5">
              <h2 className="text-lg font-black text-[#07183f] sm:text-xl">Project Details</h2>
              <div className="mt-4 grid gap-3 text-sm font-semibold text-slate-600 sm:grid-cols-2">
                <p className="break-words"><span className="font-black text-slate-900">Job:</span> {invoice.jobName}</p>
                <p className="break-words"><span className="font-black text-slate-900">Roof Type:</span> {invoice.roofType}</p>
                <p className="break-words"><span className="font-black text-slate-900">Proposal:</span> {invoice.proposalReference || "N/A"}</p>
                <p className="break-words"><span className="font-black text-slate-900">Due Date:</span> {invoice.dueDate}</p>
              </div>
            </section>
          </div>

          <aside className="space-y-4">
            <section className="rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
              <h2 className="text-lg font-black text-[#07183f]">Payment Summary</h2>
              <div className="mt-4 space-y-2 text-sm font-bold text-slate-700">
                <div className="flex justify-between gap-3"><span>Subtotal</span><span>{currency(totals.subtotal)}</span></div>
                <div className="flex justify-between gap-3"><span>Tax</span><span>{currency(totals.tax)}</span></div>
                <div className="flex justify-between gap-3"><span>Discount</span><span>{currency(invoice.discount || 0)}</span></div>
                <div className="flex justify-between gap-3"><span>Paid</span><span>{currency(totals.paid)}</span></div>
                <div className="border-t border-slate-200 pt-3 text-lg font-black text-[#07183f]"><div className="flex justify-between gap-3"><span>Total Due</span><span>{currency(totals.balance)}</span></div></div>
              </div>
            </section>

            <section id="pay" className="rounded-3xl border border-blue-100 bg-blue-50 p-4 scroll-mt-6 sm:p-5">
              {isPaid ? (
                <div className="text-center">
                  <h2 className="text-lg font-black text-emerald-700">Paid in full</h2>
                  <p className="mt-2 text-sm font-semibold leading-5 text-emerald-800">Thank you — this invoice has been paid. No further action is needed.</p>
                </div>
              ) : (
                <>
                  <h2 className="text-lg font-black text-[#07183f]">Choose Payment Method</h2>
                  <InvoicePaymentButtons invoiceId={invoice.id} invoiceNumber={invoice.invoiceNumber || invoice.id} amount={totals.balance} customerEmail={invoice.email || ""} />
                  <p className="mt-3 text-xs font-semibold leading-5 text-blue-800">Online payment supports card and ACH when Stripe is configured. You may also contact XRP Roofing for offline payment options.</p>
                </>
              )}
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
