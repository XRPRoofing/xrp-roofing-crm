"use client";

import { type ChangeEvent, useRef, useState } from "react";

type OfflineMethod = "Check" | "Cash" | "Bank Transfer";

type Props = {
  invoiceId: string;
  balance: number;
  totalAmount: number;
  totalPaid: number;
  onSuccess: () => void;
};

function currency(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function OfflinePaymentPanel({ invoiceId, balance, totalAmount, totalPaid, onSuccess }: Props) {
  const [selectedMethod, setSelectedMethod] = useState<OfflineMethod | null>(null);
  const [amount, setAmount] = useState(balance > 0 ? String(balance.toFixed(2)) : "");
  const [checkNumber, setCheckNumber] = useState("");
  const [checkAmount, setCheckAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [checkImageBase64, setCheckImageBase64] = useState<string | null>(null);
  const [checkImageMimeType, setCheckImageMimeType] = useState<string | null>(null);
  const [checkFileName, setCheckFileName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const methods: { id: OfflineMethod; label: string; icon: string; desc: string }[] = [
    { id: "Check", label: "Pay by Check", icon: "✉️", desc: "Payable to XRP Roofing" },
    { id: "Cash", label: "Pay by Cash", icon: "💵", desc: "In-person cash payment" },
    { id: "Bank Transfer", label: "Pay by Bank Transfer", icon: "🏦", desc: "ACH / wire to XRP Roofing" },
  ];

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setCheckFileName(file.name);
    setCheckImageMimeType(file.type);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? "";
      setCheckImageBase64(base64);
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmit() {
    setError("");
    const parsedAmount = Number(amount);
    if (!selectedMethod) { setError("Please select a payment method."); return; }
    if (!parsedAmount || parsedAmount <= 0) { setError("Enter a valid payment amount."); return; }
    if (selectedMethod === "Check" && !checkNumber.trim()) { setError("Please enter the check number."); return; }

    setSubmitting(true);
    try {
      const response = await fetch("/api/invoices/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId,
          method: selectedMethod,
          amount: parsedAmount,
          checkNumber: checkNumber.trim() || undefined,
          checkAmount: checkAmount ? Number(checkAmount) : undefined,
          checkImageBase64: checkImageBase64 ?? undefined,
          checkImageMimeType: checkImageMimeType ?? undefined,
          notes: notes.trim() || undefined,
        }),
      });

      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Unable to submit payment. Please try again.");
      }

      setSubmitted(true);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit payment.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
        <p className="text-2xl">✅</p>
        <p className="mt-2 text-base font-black text-emerald-700">Payment Submitted!</p>
        <p className="mt-1 text-sm font-semibold leading-5 text-emerald-800">
          XRP Roofing has been notified and will verify your payment shortly. Your invoice status will update once confirmed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-500">Invoice Summary</p>
        <div className="space-y-1.5 text-sm font-bold text-slate-700">
          <div className="flex justify-between gap-3"><span>Total Invoice</span><span>{currency(totalAmount)}</span></div>
          <div className="flex justify-between gap-3"><span>Deposits Paid</span><span className="text-emerald-700">{currency(totalPaid)}</span></div>
          <div className="flex justify-between gap-3 border-t border-slate-200 pt-2 text-base font-black text-[#0A3D91]">
            <span>Remaining Balance</span><span className="text-orange-600">{currency(balance)}</span>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-black text-slate-800">How are you paying?</p>
        <div className="space-y-2">
          {methods.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => { setSelectedMethod(m.id); setError(""); }}
              className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                selectedMethod === m.id
                  ? "border-blue-400 bg-blue-50 ring-2 ring-blue-200"
                  : "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50"
              }`}
            >
              <span className="text-xl">{m.icon}</span>
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-900">{m.label}</p>
                <p className="text-xs font-semibold text-slate-500">{m.desc}</p>
              </div>
              <span className={`ml-auto h-4 w-4 shrink-0 rounded-full border-2 ${selectedMethod === m.id ? "border-blue-500 bg-blue-500" : "border-slate-300"}`} />
            </button>
          ))}
        </div>
      </div>

      {selectedMethod && (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-600">
              Amount You Are Paying
            </label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-500">$</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-7 pr-3 text-sm font-bold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
                placeholder={balance.toFixed(2)}
              />
            </div>
            <p className="mt-1 text-[11px] font-semibold text-slate-500">You may pay a deposit or the full balance.</p>
          </div>

          {selectedMethod === "Check" && (
            <>
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-slate-600">Check Number <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={checkNumber}
                  onChange={(e) => setCheckNumber(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
                  placeholder="e.g. 1042"
                />
              </div>
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-slate-600">Check Written For (optional)</label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-500">$</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={checkAmount}
                    onChange={(e) => setCheckAmount(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-7 pr-3 text-sm font-bold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
                    placeholder={amount || "0.00"}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-slate-600">Upload Check Photo / PDF (optional)</label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white py-3 text-sm font-bold text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                >
                  📎 {checkFileName ? checkFileName : "Choose file"}
                </button>
                {checkFileName && (
                  <p className="mt-1 text-[11px] font-semibold text-emerald-700">✓ {checkFileName} attached</p>
                )}
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-600">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
              placeholder="Any notes for XRP Roofing..."
            />
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-2xl bg-red-50 p-3 text-xs font-bold leading-5 text-red-700">{error}</p>
      )}

      {selectedMethod && (
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
          className="block w-full rounded-2xl bg-[#0A3D91] px-4 py-3.5 text-center text-sm font-black text-white shadow-sm transition hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Submitting..." : `Submit ${selectedMethod} Payment`}
        </button>
      )}

      <p className="text-center text-[11px] font-semibold leading-5 text-slate-500">
        Offline payments are reviewed and verified by XRP Roofing. Your invoice balance will update once approved.
      </p>
    </div>
  );
}
