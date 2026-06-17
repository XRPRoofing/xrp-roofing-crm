"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowUpDown, Check } from "lucide-react";
import { loadAllInvoices } from "@/lib/invoice-sync";
import { requestOpenInvoice } from "@/lib/crm-board-nav";

type PaymentRecord = {
  amount: number;
  date: string;
  method: string;
};

type LoadedInvoice = {
  id: string;
  invoiceNumber?: string;
  clientName?: string;
  phone?: string;
  propertyAddress?: string;
  status?: string;
  total?: number;
  balance?: number;
  payments?: PaymentRecord[];
  paidAt?: string;
  dueDate?: string;
  lineItems?: { unitPrice: number; quantity: number }[];
  discount?: number;
};

type Tab = "unpaid" | "paid";
type SortDir = "desc" | "asc";

const paidStatuses = new Set(["Paid", "Paid Mail Check"]);
const excludedStatuses = new Set(["Voided"]);

function formatMoney(value: number) {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function computeTotal(inv: LoadedInvoice): number {
  if (typeof inv.total === "number" && inv.total > 0) return inv.total;
  const items = inv.lineItems || [];
  const subtotal = items.reduce((sum, item) => sum + (item.unitPrice || 0) * (item.quantity || 0), 0);
  return Math.max(subtotal - (inv.discount || 0), 0);
}

function computePaid(inv: LoadedInvoice): number {
  return (inv.payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
}

function lastPaymentDate(inv: LoadedInvoice): string | undefined {
  if (inv.paidAt) return inv.paidAt;
  const payments = inv.payments || [];
  if (payments.length === 0) return undefined;
  return payments[payments.length - 1]?.date;
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function PaymentsPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<LoadedInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("unpaid");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  function openInvoice(id: string) {
    requestOpenInvoice(id);
    router.push("/crm/invoices");
  }

  useEffect(() => {
    async function load() {
      try {
        const invs = await loadAllInvoices<LoadedInvoice>();
        setInvoices(invs);
      } catch {
        /* leave empty */
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const { paidInvoices, unpaidInvoices, totalPaid, totalUnpaid } = useMemo(() => {
    const paid: LoadedInvoice[] = [];
    const unpaid: LoadedInvoice[] = [];
    let paidSum = 0;
    let unpaidSum = 0;

    for (const inv of invoices) {
      const status = inv.status || "Draft";
      if (excludedStatuses.has(status)) continue;

      const total = computeTotal(inv);
      const paidAmount = computePaid(inv);

      if (paidStatuses.has(status)) {
        paidSum += paidAmount > 0 ? paidAmount : total;
        paid.push(inv);
      } else {
        unpaidSum += Math.max(total - paidAmount, 0);
        unpaid.push(inv);
      }
    }

    return { paidInvoices: paid, unpaidInvoices: unpaid, totalPaid: paidSum, totalUnpaid: unpaidSum };
  }, [invoices]);

  const displayedInvoices = useMemo(() => {
    const list = tab === "paid" ? paidInvoices : unpaidInvoices;

    const filtered = search.trim()
      ? list.filter((inv) => {
          const q = search.toLowerCase();
          const textMatch =
            (inv.clientName || "").toLowerCase().includes(q) ||
            (inv.invoiceNumber || "").toLowerCase().includes(q) ||
            (inv.propertyAddress || "").toLowerCase().includes(q) ||
            (inv.phone || "").toLowerCase().includes(q);
          if (textMatch) return true;
          const qDigits = q.replace(/\D/g, "");
          const qPhone = qDigits.length === 11 && qDigits.startsWith("1") ? qDigits.slice(1) : qDigits;
          if (qPhone.length >= 2 && inv.phone) {
            const invDigits = inv.phone.replace(/\D/g, "");
            const invPhone = invDigits.length === 11 && invDigits.startsWith("1") ? invDigits.slice(1) : invDigits;
            if (invPhone.includes(qPhone)) return true;
          }
          return false;
        })
      : list;

    const sorted = [...filtered].sort((a, b) => {
      const dateA = tab === "paid" ? lastPaymentDate(a) : a.dueDate;
      const dateB = tab === "paid" ? lastPaymentDate(b) : b.dueDate;
      const tA = dateA ? new Date(dateA).getTime() : 0;
      const tB = dateB ? new Date(dateB).getTime() : 0;
      return sortDir === "desc" ? tB - tA : tA - tB;
    });

    return sorted;
  }, [tab, paidInvoices, unpaidInvoices, search, sortDir]);

  const currentYear = new Date().getFullYear();
  const sortLabel = tab === "paid" ? "paid date" : "due date";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-0 pb-8 sm:gap-5">
      {/* Sticky Header */}
      <div className="sticky top-16 z-20 -mx-4 space-y-1.5 border-b border-gray-200 bg-white/95 px-4 pb-2 pt-1 backdrop-blur-sm sm:-mx-8 sm:space-y-3 sm:px-8 sm:pb-3 sm:pt-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600 sm:text-sm">CRM Module</p>
            <h1 className="text-xl font-bold text-blue-700 sm:text-2xl">Payments</h1>
          </div>
          <button
            onClick={() => setShowSearch((v) => !v)}
            className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-gray-100"
            aria-label="Search invoices"
          >
            <Search className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Search */}
        {showSearch && (
          <input
            type="text"
            placeholder="Search by name, invoice #, or address…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            autoFocus
          />
        )}

        {/* Tabs */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => setTab("unpaid")}
            className={`flex-1 rounded-full border-2 px-4 py-2 text-xs font-bold uppercase tracking-wide transition sm:px-6 sm:py-2.5 sm:text-sm ${
              tab === "unpaid"
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-gray-300 bg-white text-gray-600 hover:border-gray-400"
            }`}
          >
            Unpaid
          </button>
          <button
            onClick={() => setTab("paid")}
            className={`flex-1 rounded-full border-2 px-4 py-2 text-xs font-bold uppercase tracking-wide transition sm:px-6 sm:py-2.5 sm:text-sm ${
              tab === "paid"
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-gray-300 bg-white text-gray-600 hover:border-gray-400"
            }`}
          >
            Paid
          </button>
        </div>

        {/* Total banner */}
        <div className={`rounded-md p-2.5 text-center sm:rounded-lg sm:p-4 ${tab === "paid" ? "bg-blue-50" : "bg-orange-50"}`}>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500 sm:text-sm">
            {tab === "paid" ? "Total Revenue" : "Total Outstanding"}
          </p>
          <p className={`mt-0.5 text-2xl font-bold sm:mt-1 sm:text-3xl ${tab === "paid" ? "text-blue-700" : "text-orange-700"}`}>
            {loading ? "—" : formatMoney(tab === "paid" ? totalPaid : totalUnpaid)}
          </p>
        </div>
      </div>

      {/* Sort controls */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span className="font-semibold">
          {currentYear} sorted by {sortLabel}
        </span>
        <button
          onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
          className="flex items-center gap-1 rounded-lg px-2 py-1 font-semibold hover:bg-gray-100"
          aria-label="Toggle sort direction"
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Invoice list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : displayedInvoices.length === 0 ? (
        <p className="py-12 text-center text-sm font-semibold text-gray-400">
          {search.trim() ? "No matching invoices." : `No ${tab} invoices.`}
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {displayedInvoices.map((inv) => {
            const total = computeTotal(inv);
            const paidAmount = computePaid(inv);
            const displayAmount = tab === "paid" ? (paidAmount > 0 ? paidAmount : total) : Math.max(total - paidAmount, 0);
            const dateStr = tab === "paid" ? lastPaymentDate(inv) : inv.dueDate;

            return (
              <article
                key={inv.id}
                className="flex cursor-pointer items-center justify-between py-4 transition hover:bg-gray-50 active:bg-gray-100"
                onClick={() => openInvoice(inv.id)}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-gray-900">
                    {inv.invoiceNumber ? `#${inv.invoiceNumber}` : "No #"}
                    {inv.clientName ? `: ${inv.clientName}` : ""}
                  </p>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-400">
                    {tab === "paid" ? (
                      <>
                        <span>Paid {formatDate(dateStr)}</span>
                        <Check className="h-3.5 w-3.5 text-blue-500" />
                      </>
                    ) : (
                      <span>{dateStr ? `Due ${formatDate(dateStr)}` : "No due date"}</span>
                    )}
                  </div>
                </div>
                <span className="ml-4 whitespace-nowrap text-sm font-bold text-gray-800">
                  {formatMoney(displayAmount)}
                </span>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
