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

function urgencyColor(u: MetricDef["urgency"]) {
  if (u === "red")    return { bg: "bg-red-50", border: "border-red-100", text: "text-red-700", icon: "bg-red-100 text-red-600" };
  if (u === "orange") return { bg: "bg-orange-50", border: "border-orange-100", text: "text-orange-700", icon: "bg-orange-100 text-orange-600" };
  if (u === "yellow") return { bg: "bg-amber-50", border: "border-amber-100", text: "text-amber-700", icon: "bg-amber-100 text-amber-600" };
  if (u === "blue")   return { bg: "bg-blue-50", border: "border-blue-100", text: "text-blue-700", icon: "bg-blue-100 text-blue-600" };
  return { bg: "bg-gray-50", border: "border-gray-100", text: "text-gray-700", icon: "bg-gray-100 text-gray-600" };
}

export default function CrmDashboardPage() {
  const router = useRouter();

  const [jobs,      setJobs]      = useState<Lead[]>([]);
  const [proposals, setProposals] = useState<ProposalSnap[]>([]);
  const [invoices,  setInvoices]  = useState<InvoiceSnap[]>([]);
  const [syncDot,   setSyncDot]   = useState(false);

  useEffect(() => {
    let mounted = true;
    
    void loadCrewDataset().then((d) => { if (mounted) setJobs(d.jobs); }).catch(() => {});
    void loadAllInvoices<InvoiceSnap>().then((data) => { 
      if (mounted) setInvoices(data); 
    }).catch(() => {});
    void loadProposalRecords<ProposalSnap>().then((data) => { 
      if (mounted) setProposals(data.filter((p) => !p.deletedAt)); 
    }).catch(() => {});

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
      {/* Welcome Header */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Good morning, XRP Roofing team</h1>
            <p className="mt-1 text-sm text-gray-500">
              {attentionCount > 0 ? `${attentionCount} items need your attention` : "All caught up — no urgent items"}
              {syncDot && <span className="ml-2 inline-flex items-center gap-1 text-xs text-blue-600"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />Syncing</span>}
            </p>
          </div>
          <DashboardHeroActions />
        </div>
      </section>

      {/* Action Items Grid */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Action Items</h2>
          <p className="text-xs text-gray-400">Click a card to view details</p>
        </div>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {metrics.map((m) => {
            const Icon = m.icon;
            const c = urgencyColor(m.urgency);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => router.push(m.href)}
                className={`flex items-start gap-3 rounded-lg border p-4 text-left transition hover:shadow-sm active:scale-[0.98] ${c.border} ${c.bg}`}
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${c.icon}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-2xl font-bold ${c.text}`}>{m.count}</p>
                  <p className="mt-0.5 text-sm font-medium text-gray-700">{m.label}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{m.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Summary Stats */}
      <section className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">Total Jobs</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{jobs.length}</p>
          <p className="mt-0.5 text-xs text-gray-400">All stages including completed</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">Total Proposals</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{proposals.length}</p>
          <p className="mt-0.5 text-xs text-gray-400">{proposals.filter((p) => ["Won", "Signed", "Approved"].includes(p.status)).length} signed / approved</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">Total Invoices</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{invoices.length}</p>
          <p className="mt-0.5 text-xs text-gray-400">{invoices.filter(invoicePaid).length} paid</p>
        </div>
      </section>
    </div>
  );
}
