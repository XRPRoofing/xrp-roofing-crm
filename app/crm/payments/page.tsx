"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DollarSign, TrendingUp, Clock, CheckCircle2, Briefcase, BarChart3, FileEdit, Pencil } from "lucide-react";
import { loadAllInvoices } from "@/lib/invoice-sync";
import { loadCrewDataset } from "@/lib/crew-sync";
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
  propertyAddress?: string;
  status?: string;
  total?: number;
  balance?: number;
  payments?: PaymentRecord[];
  paidAt?: string;
  lineItems?: { unitPrice: number; quantity: number }[];
  discount?: number;
};

function formatMoney(value: number) {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
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

export default function PaymentsPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<LoadedInvoice[]>([]);
  const [jobCount, setJobCount] = useState(0);
  const [loading, setLoading] = useState(true);

  function openInvoice(id: string) {
    requestOpenInvoice(id);
    router.push("/crm/invoices");
  }

  useEffect(() => {
    async function load() {
      try {
        const [invs, dataset] = await Promise.all([
          loadAllInvoices<LoadedInvoice>(),
          loadCrewDataset(),
        ]);
        setInvoices(invs);
        setJobCount(dataset.jobs.length);
      } catch {
        /* leave empty */
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const stats = useMemo(() => {
    const paidStatuses = new Set(["Paid", "Paid Mail Check"]);
    const draftStatuses = new Set(["Draft"]);
    const pendingStatuses = new Set(["Sent", "Viewed", "Pending", "Due Soon", "Overdue"]);
    const processingStatuses = new Set(["Partially Paid"]);

    let totalRevenue = 0;
    let draftsAmount = 0;
    let pendingAmount = 0;
    let processingAmount = 0;
    let completedAmount = 0;
    let completedCount = 0;

    const drafts: LoadedInvoice[] = [];
    const pending: LoadedInvoice[] = [];
    const processing: LoadedInvoice[] = [];
    const completed: LoadedInvoice[] = [];

    for (const inv of invoices) {
      const total = computeTotal(inv);
      const paid = computePaid(inv);
      const status = inv.status || "Draft";

      totalRevenue += paid;

      if (paidStatuses.has(status)) {
        completedAmount += total;
        completedCount += 1;
        completed.push(inv);
      } else if (processingStatuses.has(status) || (paid > 0 && !paidStatuses.has(status))) {
        processingAmount += total - paid;
        processing.push(inv);
      } else if (draftStatuses.has(status)) {
        draftsAmount += total;
        drafts.push(inv);
      } else if (pendingStatuses.has(status)) {
        pendingAmount += total;
        pending.push(inv);
      }
    }

    const avgJobValue = completedCount > 0 ? totalRevenue / completedCount : 0;

    return { totalRevenue, draftsAmount, pendingAmount, processingAmount, completedAmount, completedCount, avgJobValue, drafts, pending, processing, completed };
  }, [invoices]);

  const summaryCards = [
    { label: "Total Revenue", value: formatMoney(stats.totalRevenue), icon: DollarSign, color: "bg-emerald-50 text-emerald-700", iconBg: "bg-emerald-100" },
    { label: "Drafts", value: formatMoney(stats.draftsAmount), icon: FileEdit, color: "bg-slate-50 text-slate-700", iconBg: "bg-slate-200" },
    { label: "Pending", value: formatMoney(stats.pendingAmount), icon: Clock, color: "bg-amber-50 text-amber-700", iconBg: "bg-amber-100" },
    { label: "Processing", value: formatMoney(stats.processingAmount), icon: TrendingUp, color: "bg-blue-50 text-blue-700", iconBg: "bg-blue-100" },
    { label: "Completed", value: formatMoney(stats.completedAmount), icon: CheckCircle2, color: "bg-emerald-50 text-emerald-700", iconBg: "bg-emerald-100" },
    { label: "Total Jobs", value: String(jobCount), icon: Briefcase, color: "bg-indigo-50 text-indigo-700", iconBg: "bg-indigo-100" },
    { label: "Avg Job Value", value: formatMoney(stats.avgJobValue), icon: BarChart3, color: "bg-purple-50 text-purple-700", iconBg: "bg-purple-100" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-orange-600">CRM Module</p>
          <h1 className="mt-2 text-3xl font-black text-[#07183f]">Payments</h1>
          <p className="crm-board-subtitle mt-2 text-slate-600">Track deposits, progress payments, balances, and completed customer payments.</p>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {summaryCards.map((card) => (
          <div key={card.label} className={`rounded-2xl border border-slate-200 p-4 ${card.color}`}>
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.iconBg}`}>
                <card.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide opacity-70">{card.label}</p>
                <p className="text-lg font-black">{loading ? "—" : card.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Payment columns */}
      {loading ? (
        <div className="grid gap-4 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-60 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-4">
          <PaymentColumn title="Drafts" subtitle="Unsent invoices" items={stats.drafts} badgeColor="bg-slate-100 text-slate-700" onClickItem={openInvoice} />
          <PaymentColumn title="Pending" subtitle="Sent & awaiting payment" items={stats.pending} badgeColor="bg-amber-50 text-amber-700" />
          <PaymentColumn title="Processing" subtitle="Partially paid" items={stats.processing} badgeColor="bg-blue-50 text-blue-700" />
          <PaymentColumn title="Completed" subtitle="Fully paid" items={stats.completed} badgeColor="bg-emerald-50 text-emerald-700" />
        </div>
      )}
    </div>
  );
}

function PaymentColumn({ title, subtitle, items, badgeColor, onClickItem }: { title: string; subtitle?: string; items: LoadedInvoice[]; badgeColor: string; onClickItem?: (id: string) => void }) {
  const total = items.reduce((sum, inv) => sum + computeTotal(inv), 0);
  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-lg font-black text-[#07183f]">{title}</h2>
          <p className="text-sm font-semibold text-slate-500">{subtitle || `${items.length} payment${items.length !== 1 ? "s" : ""}`}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-black ${badgeColor}`}>{formatMoney(total)}</span>
      </div>
      <div className="mt-4 space-y-3">
        {items.length === 0 && <p className="text-sm font-semibold text-slate-400">No payments in this category.</p>}
        {items.map((inv) => {
          const invTotal = computeTotal(inv);
          const paid = computePaid(inv);
          const balance = invTotal - paid;
          return (
            <article key={inv.id} className={`rounded-2xl bg-slate-50 p-4${onClickItem ? " cursor-pointer transition hover:bg-slate-100 hover:ring-1 hover:ring-blue-200" : ""}`} onClick={onClickItem ? () => onClickItem(inv.id) : undefined}>
              <div className="flex items-center justify-between">
                <p className="font-black text-slate-900">{inv.clientName || "Unnamed"}</p>
                <span className="text-sm font-black text-slate-700">{formatMoney(invTotal)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500">
                  {inv.invoiceNumber ? `#${inv.invoiceNumber}` : "No invoice #"}{inv.propertyAddress ? ` • ${inv.propertyAddress}` : ""}
                </p>
                {onClickItem && <Pencil className="h-3.5 w-3.5 text-blue-500" />}
              </div>
              {paid > 0 && balance > 0 && (
                <div className="mt-2">
                  <div className="flex justify-between text-[11px] font-bold text-slate-500">
                    <span>Paid {formatMoney(paid)}</span>
                    <span>Balance {formatMoney(balance)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min((paid / invTotal) * 100, 100)}%` }} />
                  </div>
                </div>
              )}
              {inv.payments && inv.payments.length > 0 && (
                <div className="mt-2 space-y-1">
                  {inv.payments.slice(-2).map((p, i) => (
                    <p key={i} className="text-[11px] font-semibold text-slate-400">
                      {p.method} — {formatMoney(p.amount)} on {new Date(p.date).toLocaleDateString()}
                    </p>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
