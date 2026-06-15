"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Briefcase,
  CalendarCheck,
  FileWarning,
  MailOpen,
  PenLine,
  UserX,
} from "lucide-react";
import DashboardHeroActions from "@/components/crm/dashboard/DashboardHeroActions";
import { loadCrewDataset, subscribeToCrewData } from "@/lib/crew-sync";
import { loadAllInvoices, subscribeToInvoiceShares } from "@/lib/invoice-sync";
import { loadProposalRecords, subscribeToProposalRecords } from "@/lib/proposal-sync";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import type { Lead } from "@/types/crm";

type ProposalSnap = { id: string; status: string; sentToEmail?: string; viewedAt?: string; signedAt?: string; deletedAt?: string };
type InvoiceSnap  = { id: string; status: string; dueDate: string; sentAt?: string; viewedAt?: string; emailOpenedAt?: string; payments?: { amount: number }[]; lineItems?: { unitPrice: number; quantity: number; tax?: number }[] };

function invoicePaid(inv: InvoiceSnap): boolean {
  if (inv.status === "Voided") return false;
  const total = (inv.lineItems || []).reduce((s, li) => s + li.unitPrice * li.quantity * (1 + (li.tax ?? 0) / 100), 0);
  const paid  = (inv.payments  || []).reduce((s, p) => s + p.amount, 0);
  return total > 0 && paid >= total;
}

function invoiceOverdue(inv: InvoiceSnap): boolean {
  if (invoicePaid(inv) || inv.status === "Voided" || inv.status === "Draft") return false;
  const due = new Date(`${inv.dueDate}T00:00:00`);
  return due < new Date(new Date().toDateString());
}

const UNACTIONED_STAGES = new Set(["new_lead"]);
const FOLLOWUP_STAGES   = new Set(["inspection_scheduled", "inspection_complete", "estimate_sent", "waiting_approval", "approved"]);


type MetricDef = {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  urgency: "red" | "orange" | "yellow" | "blue" | "slate";
  href: string;
  count: number;
};

function urgencyStyles(u: MetricDef["urgency"]) {
  if (u === "red")    return { card: "border-red-100 bg-red-50 hover:border-red-300",    num: "text-red-700",    icon: "bg-red-100 text-red-600",    dot: "bg-red-500" };
  if (u === "orange") return { card: "border-orange-100 bg-orange-50 hover:border-orange-300", num: "text-orange-700", icon: "bg-orange-100 text-orange-600", dot: "bg-orange-500" };
  if (u === "yellow") return { card: "border-yellow-100 bg-yellow-50 hover:border-yellow-300", num: "text-yellow-700", icon: "bg-yellow-100 text-yellow-600", dot: "bg-yellow-500" };
  if (u === "blue")   return { card: "border-blue-100 bg-blue-50 hover:border-blue-300",   num: "text-blue-700",   icon: "bg-blue-100 text-blue-600",   dot: "bg-blue-500" };
  return { card: "border-slate-200 bg-white hover:border-slate-300", num: "text-slate-800", icon: "bg-slate-100 text-slate-600", dot: "bg-slate-400" };
}

export default function CrmDashboardPage() {
  const router = useRouter();

  const [jobs,      setJobs]      = useState<Lead[]>([]);
  const [proposals, setProposals] = useState<ProposalSnap[]>([]);
  const [invoices,  setInvoices]  = useState<InvoiceSnap[]>([]);
  const [syncDot,   setSyncDot]   = useState(false);

  // Load from Supabase on mount (not localStorage)
  useEffect(() => {
    let mounted = true;
    
    // Load jobs
    void loadCrewDataset().then((d) => { if (mounted) setJobs(d.jobs); }).catch(() => {});
    
    // Load invoices from Supabase
    void loadAllInvoices<InvoiceSnap>().then((data) => { 
      if (mounted) setInvoices(data); 
    }).catch(() => {});
    
    // Load proposals from Supabase
    void loadProposalRecords<ProposalSnap>().then((data) => { 
      if (mounted) setProposals(data.filter((p) => !p.deletedAt)); 
    }).catch(() => {});

    // Real-time subscriptions
    const unsubCrew = subscribeToCrewData(() => {
      setSyncDot(true);
      void loadCrewDataset().then((d) => { if (mounted) { setJobs(d.jobs); setSyncDot(false); } }).catch(() => {});
    });
    
    const unsubInvoices = subscribeToInvoiceShares(() => {
      setSyncDot(true);
      void loadAllInvoices<InvoiceSnap>().then((data) => { 
        if (mounted) { setInvoices(data); setSyncDot(false); }
      }).catch(() => {});
    });
    
    const unsubProposals = subscribeToProposalRecords(() => {
      setSyncDot(true);
      void loadProposalRecords<ProposalSnap>().then((data) => { 
        if (mounted) { setProposals(data.filter((p) => !p.deletedAt)); setSyncDot(false); }
      }).catch(() => {});
    });
    
    return () => {
      mounted = false;
      unsubCrew();
      unsubInvoices();
      unsubProposals();
    };
  }, []);

  useAutoRefresh(() => {
    void loadCrewDataset().then((d) => setJobs(d.jobs)).catch(() => {});
    void loadAllInvoices<InvoiceSnap>().then((data) => setInvoices(data)).catch(() => {});
    void loadProposalRecords<ProposalSnap>().then((data) => setProposals(data.filter((p) => !p.deletedAt))).catch(() => {});
  });

  const metrics: MetricDef[] = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear  = now.getFullYear();

    const unactionedLeads = jobs.filter((j) => UNACTIONED_STAGES.has(j.stage)).length;

    const sentProposals   = proposals.filter((p) => p.status !== "Draft" && p.sentToEmail);
    const unopenedProposals = sentProposals.filter((p) => !p.viewedAt && !p.signedAt).length;
    const unsignedProposals = sentProposals.filter((p) => p.viewedAt && !p.signedAt && !["Won", "Signed", "Approved"].includes(p.status)).length;

    const activeInvoices   = invoices.filter((i) => i.status !== "Draft" && i.status !== "Voided" && !invoicePaid(i));
    const overdueInvoices  = activeInvoices.filter(invoiceOverdue).length;
    const unopenedInvoices = activeInvoices.filter((i) => i.sentAt && !i.viewedAt && !i.emailOpenedAt).length;

    const followUpJobs = jobs.filter((j) => FOLLOWUP_STAGES.has(j.stage)).length;

    const jobsThisMonth = jobs.filter((j) => {
      const d = j.dueDate ? new Date(`${j.dueDate}T00:00:00`) : null;
      if (!d) return false;
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    }).length;

    return [
      {
        id: "unactioned-leads",
        label: "Unactioned Leads",
        description: "New leads with no contact or follow-up assigned",
        icon: UserX,
        urgency: "red",
        href: "/crm/leads",
        count: unactionedLeads,
      },
      {
        id: "unopened-proposals",
        label: "Unopened Proposals",
        description: "Sent to customers but not yet viewed",
        icon: MailOpen,
        urgency: "orange",
        href: "/crm/proposals",
        count: unopenedProposals,
      },
      {
        id: "unsigned-proposals",
        label: "Unsigned Proposals",
        description: "Viewed by customers but not yet signed",
        icon: PenLine,
        urgency: "yellow",
        href: "/crm/proposals",
        count: unsignedProposals,
      },
      {
        id: "overdue-invoices",
        label: "Overdue Invoices",
        description: "Past due date with balance still owed",
        icon: AlertTriangle,
        urgency: "red",
        href: "/crm/invoices",
        count: overdueInvoices,
      },
      {
        id: "unopened-invoices",
        label: "Unopened Invoices",
        description: "Sent but not yet opened by the customer",
        icon: FileWarning,
        urgency: "orange",
        href: "/crm/invoices",
        count: unopenedInvoices,
      },
      {
        id: "followup-jobs",
        label: "Jobs Needing Follow-Up",
        description: "Active jobs requiring attention or status update",
        icon: CalendarCheck,
        urgency: "yellow",
        href: "/crm/leads",
        count: followUpJobs,
      },
      {
        id: "jobs-this-month",
        label: "Total Jobs This Month",
        description: `Jobs active or due in ${now.toLocaleString("en-US", { month: "long" })} ${currentYear}`,
        icon: Briefcase,
        urgency: "blue",
        href: "/crm/leads",
        count: jobsThisMonth,
      },
    ];
  }, [jobs, proposals, invoices]);

  const attentionCount = metrics.filter((m) => m.urgency === "red" || m.urgency === "orange").reduce((s, m) => s + m.count, 0);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#072C6B] via-[#0A3D91] to-[#2B6BC4] p-6 text-white shadow-2xl shadow-blue-950/20 sm:p-8">
        <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-orange-400/20 blur-3xl" />
        <div className="absolute bottom-0 right-10 h-40 w-40 rounded-full bg-blue-300/20 blur-2xl" />
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="relative">
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-orange-300">Operations Command Center</p>
            <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">Good morning, XRP Roofing team.</h1>
            <p className="mt-4 max-w-2xl text-blue-100">Track leads, proposals, invoices, and job progress — all actionable items in one view.</p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <span className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-wider ring-1 ${attentionCount > 0 ? "bg-red-500/20 text-red-200 ring-red-400/30" : "bg-emerald-500/20 text-emerald-200 ring-emerald-400/30"}`}>
                <span className={`h-2 w-2 rounded-full ${attentionCount > 0 ? "bg-red-400 animate-pulse" : "bg-emerald-400"}`} />
                {attentionCount > 0 ? `${attentionCount} items need attention` : "All clear"}
              </span>
              <span className={`flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-blue-50 ring-1 ring-white/15`}>
                <span className={`h-2 w-2 rounded-full ${syncDot ? "bg-yellow-400 animate-pulse" : "bg-emerald-400"}`} />
                {syncDot ? "Syncing…" : "Live"}
              </span>
            </div>
          </div>
          <DashboardHeroActions />
        </div>
      </section>

      {/* 7 Actionable Metric Cards */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-black text-[#0A3D91]">Action Items</h2>
          <p className="text-xs font-semibold text-slate-400">Click a card to open the filtered list</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {metrics.map((m) => {
            const Icon = m.icon;
            const s = urgencyStyles(m.urgency);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => router.push(m.href)}
                className={`group flex flex-col items-start rounded-2xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 ${s.card}`}
              >
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${s.icon}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <p className={`mt-3 text-3xl font-black leading-none ${s.num}`}>{m.count}</p>
                <p className="mt-1.5 text-xs font-black uppercase leading-tight tracking-wide text-slate-700">{m.label}</p>
                <p className="mt-1 text-[10px] leading-tight text-slate-400">{m.description}</p>
                {m.count > 0 && (
                  <span className={`mt-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${s.num} bg-white/60 ring-1 ring-current/20`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                    View →
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Summary strip */}
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wider text-slate-400">Total Jobs in CRM</p>
          <p className="mt-2 text-4xl font-black text-[#0A3D91]">{jobs.length}</p>
          <p className="mt-1 text-xs text-slate-400">All stages including completed</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wider text-slate-400">Total Proposals</p>
          <p className="mt-2 text-4xl font-black text-[#0A3D91]">{proposals.length}</p>
          <p className="mt-1 text-xs text-slate-400">{proposals.filter((p) => ["Won", "Signed", "Approved"].includes(p.status)).length} signed / approved</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wider text-slate-400">Total Invoices</p>
          <p className="mt-2 text-4xl font-black text-[#0A3D91]">{invoices.length}</p>
          <p className="mt-1 text-xs text-slate-400">{invoices.filter(invoicePaid).length} paid</p>
        </div>
      </section>
    </div>
  );
}
