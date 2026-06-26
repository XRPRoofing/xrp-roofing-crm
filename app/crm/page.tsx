"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Briefcase,
  CalendarCheck,
  DollarSign,
  ExternalLink,
  MailOpen,
  PenLine,
  TrendingUp,
  UserX,
} from "lucide-react";

const DashboardCalendar = dynamic(() => import("@/components/crm/dashboard/DashboardCalendar"), { ssr: false });
const DashboardHeroActions = dynamic(() => import("@/components/crm/dashboard/DashboardHeroActions"), { ssr: false });
import { subscribeToCrewData } from "@/lib/crew-sync";
import { subscribeToInvoiceShares } from "@/lib/invoice-sync";
import { subscribeToProposalRecords } from "@/lib/proposal-sync";
import { getCachedCrewData, getCachedInvoices, getCachedProposals, refreshCrewData, refreshInvoices, refreshProposals, CACHE_EVENTS } from "@/lib/data-cache";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import type { Lead } from "@/types/crm";

const COMPLETED_STAGES = new Set(["completed", "paid"]);

type ProposalSnap = { id: string; status: string; sentToEmail?: string; viewedAt?: string; signedAt?: string; deletedAt?: string; total?: number };
type InvoiceSnap  = { id: string; status: string; dueDate: string; sentAt?: string; viewedAt?: string; emailOpenedAt?: string; payments?: { amount: number }[]; lineItems?: { unitPrice: number; quantity: number; tax?: number }[] };

function invoiceTotal(inv: InvoiceSnap): number {
  return (inv.lineItems || []).reduce((s, li) => s + li.unitPrice * li.quantity * (1 + (li.tax ?? 0) / 100), 0);
}

function invoicePaid(inv: InvoiceSnap): boolean {
  if (inv.status === "Voided") return false;
  const total = invoiceTotal(inv);
  const paid  = (inv.payments || []).reduce((s, p) => s + p.amount, 0);
  return total > 0 && paid >= total;
}

function invoiceOverdue(inv: InvoiceSnap): boolean {
  if (invoicePaid(inv) || inv.status === "Voided" || inv.status === "Draft") return false;
  const due = new Date(`${inv.dueDate}T00:00:00`);
  return due < new Date(new Date().toDateString());
}

const UNACTIONED_STAGES = new Set(["new_lead"]);
const FOLLOWUP_STAGES   = new Set(["inspection_scheduled", "inspection_complete", "estimate_sent", "follow_up", "waiting_approval", "approved"]);

type MetricDef = {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  urgency: "red" | "orange" | "yellow" | "blue" | "slate";
  href: string;
  count: number;
  dollar?: number;
};

function urgencyColor(u: MetricDef["urgency"]) {
  if (u === "red")    return { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", icon: "bg-red-100 text-red-600" };
  if (u === "orange") return { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", icon: "bg-orange-100 text-orange-600" };
  if (u === "yellow") return { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", icon: "bg-amber-100 text-amber-600" };
  if (u === "blue")   return { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", icon: "bg-blue-100 text-blue-600" };
  return { bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-700", icon: "bg-gray-100 text-gray-600" };
}

function formatUsd(v: number) {
  return v >= 1000 ? `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `$${v.toLocaleString()}`;
}

export default function CrmDashboardPage() {
  const router = useRouter();

  const [jobs,      setJobs]      = useState<Lead[]>(() => getCachedCrewData()?.jobs ?? []);
  const [proposals, setProposals] = useState<ProposalSnap[]>(() => (getCachedProposals<ProposalSnap>() ?? []).filter((p) => !p.deletedAt));
  const [invoices,  setInvoices]  = useState<InvoiceSnap[]>(() => getCachedInvoices<InvoiceSnap>() ?? []);
  const [syncDot,   setSyncDot]   = useState(false);

  useEffect(() => {
    let mounted = true;

    void refreshCrewData().then((d) => { if (mounted) setJobs(d.jobs); }).catch(() => {});
    void refreshInvoices<InvoiceSnap>().then((data) => {
      if (mounted) setInvoices(data);
    }).catch(() => {});
    void refreshProposals<ProposalSnap>().then((data) => {
      if (mounted) setProposals(data.filter((p) => !p.deletedAt));
    }).catch(() => {});

    const unsubCrew = subscribeToCrewData(() => {
      setSyncDot(true);
      void refreshCrewData().then((d) => { if (mounted) { setJobs(d.jobs); setSyncDot(false); } }).catch(() => {});
    });

    const unsubInvoices = subscribeToInvoiceShares(() => {
      setSyncDot(true);
      void refreshInvoices<InvoiceSnap>().then((data) => {
        if (mounted) { setInvoices(data); setSyncDot(false); }
      }).catch(() => {});
    });

    const unsubProposals = subscribeToProposalRecords(() => {
      setSyncDot(true);
      void refreshProposals<ProposalSnap>().then((data) => {
        if (mounted) { setProposals(data.filter((p) => !p.deletedAt)); setSyncDot(false); }
      }).catch(() => {});
    });

    // Cache-event listeners read already-updated cache — no re-fetch needed.
    function onCrewCache() { const c = getCachedCrewData(); if (c && mounted) setJobs(c.jobs); }
    function onInvoiceCache() { const c = getCachedInvoices<InvoiceSnap>(); if (c && mounted) setInvoices(c); }
    function onProposalCache() { const c = getCachedProposals<ProposalSnap>(); if (c && mounted) setProposals(c.filter((p) => !p.deletedAt)); }
    window.addEventListener(CACHE_EVENTS.crew, onCrewCache);
    window.addEventListener(CACHE_EVENTS.invoices, onInvoiceCache);
    window.addEventListener(CACHE_EVENTS.proposals, onProposalCache);

    return () => {
      mounted = false;
      unsubCrew();
      unsubInvoices();
      unsubProposals();
      window.removeEventListener(CACHE_EVENTS.crew, onCrewCache);
      window.removeEventListener(CACHE_EVENTS.invoices, onInvoiceCache);
      window.removeEventListener(CACHE_EVENTS.proposals, onProposalCache);
    };
  }, []);

  useAutoRefresh(() => {
    void refreshCrewData().then((d) => setJobs(d.jobs)).catch(() => {});
    void refreshInvoices<InvoiceSnap>().then((data) => setInvoices(data)).catch(() => {});
    void refreshProposals<ProposalSnap>().then((data) => setProposals(data.filter((p) => !p.deletedAt))).catch(() => {});
  });

  /* ── Computed metrics ────────────────────────────────────────────── */

  const metrics: MetricDef[] = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear  = now.getFullYear();

    const unactionedLeads = jobs.filter((j) => UNACTIONED_STAGES.has(j.stage)).length;

    const sentProposals     = proposals.filter((p) => p.status !== "Draft" && p.sentToEmail);
    const unopenedProposals = sentProposals.filter((p) => !p.viewedAt && !p.signedAt);
    const unsignedProposals = sentProposals.filter((p) => p.viewedAt && !p.signedAt && !["Won", "Signed", "Approved"].includes(p.status));

    const activeInvoices   = invoices.filter((i) => i.status !== "Draft" && i.status !== "Voided" && !invoicePaid(i));
    const overdueInvoices  = activeInvoices.filter(invoiceOverdue);

    const followUpJobs = jobs.filter((j) => FOLLOWUP_STAGES.has(j.stage)).length;

    const jobsThisMonth = jobs.filter((j) => {
      const d = j.dueDate ? new Date(`${j.dueDate}T00:00:00`) : null;
      if (!d) return false;
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    }).length;

    const unopenedProposalValue = unopenedProposals.reduce((s, p) => s + (p.total || 0), 0);
    const unsignedProposalValue = unsignedProposals.reduce((s, p) => s + (p.total || 0), 0);
    const overdueInvoiceValue   = overdueInvoices.reduce((s, i) => s + invoiceTotal(i), 0);

    return [
      {
        id: "unactioned-leads",
        label: "Unactioned Leads",
        description: "New leads awaiting first contact",
        icon: UserX,
        urgency: "red" as const,
        href: "/crm/leads",
        count: unactionedLeads,
      },
      {
        id: "unopened-proposals",
        label: "Unopened Proposals",
        description: "Sent but not yet viewed",
        icon: MailOpen,
        urgency: "orange" as const,
        href: "/crm/proposals",
        count: unopenedProposals.length,
        dollar: unopenedProposalValue,
      },
      {
        id: "unsigned-proposals",
        label: "Unsigned Proposals",
        description: "Viewed but not yet signed",
        icon: PenLine,
        urgency: "yellow" as const,
        href: "/crm/proposals",
        count: unsignedProposals.length,
        dollar: unsignedProposalValue,
      },
      {
        id: "overdue-invoices",
        label: "Overdue Invoices",
        description: "Past due with balance owed",
        icon: AlertTriangle,
        urgency: "red" as const,
        href: "/crm/invoices",
        count: overdueInvoices.length,
        dollar: overdueInvoiceValue,
      },
      {
        id: "followup-jobs",
        label: "Follow-Up Needed",
        description: "Active jobs needing attention",
        icon: CalendarCheck,
        urgency: "yellow" as const,
        href: "/crm/leads",
        count: followUpJobs,
      },
      {
        id: "jobs-this-month",
        label: "Jobs This Month",
        description: `Active in ${now.toLocaleString("en-US", { month: "long" })} ${currentYear}`,
        icon: Briefcase,
        urgency: "blue" as const,
        href: "/crm/leads",
        count: jobsThisMonth,
      },
    ];
  }, [jobs, proposals, invoices]);

  const attentionCount = metrics.filter((m) => m.urgency === "red" || m.urgency === "orange").reduce((s, m) => s + m.count, 0);

  /* Summary stats */
  const totalRevenue = invoices.filter(invoicePaid).reduce((s, i) => s + invoiceTotal(i), 0);
  const signedProposals = proposals.filter((p) => ["Won", "Signed", "Approved"].includes(p.status)).length;
  const activeJobs = jobs.filter((j) => !COMPLETED_STAGES.has(j.stage)).length;
  const paidInvoiceCount = invoices.filter(invoicePaid).length;
  const sentProposalCount = proposals.filter((p) => p.status !== "Draft").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 sm:gap-6">
      {/* ── Welcome Header ──────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white/95 px-5 py-5 shadow-sm backdrop-blur-sm sm:px-7 sm:py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-gray-900 sm:text-xl">
              Good morning, XRP Roofing team
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {attentionCount > 0 ? `${attentionCount} items need attention` : "All caught up — no urgent items"}
              {syncDot && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs text-blue-600">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />Syncing
                </span>
              )}
            </p>
          </div>
          <DashboardHeroActions />
        </div>
      </section>

      {/* ── Summary Stats Row ───────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Briefcase className="h-4 w-4" /></span>
            <span className="text-xs font-medium text-gray-500">Total Jobs</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-gray-900">{jobs.length}</p>
          <p className="text-xs text-gray-400">{activeJobs} active</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-600"><PenLine className="h-4 w-4" /></span>
            <span className="text-xs font-medium text-gray-500">Proposals</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-gray-900">{proposals.length}</p>
          <p className="text-xs text-gray-400">{signedProposals} signed &middot; {sentProposalCount} sent</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-50 text-green-600"><DollarSign className="h-4 w-4" /></span>
            <span className="text-xs font-medium text-gray-500">Invoices</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-gray-900">{invoices.length}</p>
          <p className="text-xs text-gray-400">{paidInvoiceCount} paid</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><TrendingUp className="h-4 w-4" /></span>
            <span className="text-xs font-medium text-gray-500">Revenue</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-gray-900">{totalRevenue > 0 ? formatUsd(totalRevenue) : "$0"}</p>
          <p className="text-xs text-gray-400">from paid invoices</p>
        </div>
      </section>

      {/* ── Calendar Shortcut ──────────────────────────────────────── */}
      <DashboardCalendar />

      {/* ── Action Items ────────────────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Action Items</h2>
          <p className="text-xs text-gray-400">Click to view</p>
        </div>
        <div className="grid gap-3.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.map((m) => {
            const Icon = m.icon;
            const c = urgencyColor(m.urgency);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => router.push(m.href)}
                className={`group flex items-start gap-4 rounded-lg border p-4 text-left transition hover:shadow-md active:scale-[0.98] ${c.border} ${c.bg}`}
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${c.icon}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={`text-2xl font-bold leading-none ${c.text}`}>{m.count}</p>
                    {m.dollar !== undefined && m.dollar > 0 && (
                      <span className="text-xs font-medium text-gray-500">{formatUsd(m.dollar)}</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm font-medium text-gray-800">{m.label}</p>
                  <p className="text-xs text-gray-500">{m.description}</p>
                </div>
                <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-300 transition group-hover:text-gray-500" />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
