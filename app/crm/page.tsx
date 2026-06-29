"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Briefcase,
  CalendarCheck,
  DollarSign,
  ExternalLink,
  FileText,
  MailOpen,
  MessageSquare,
  PenLine,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  TrendingUp,
  UserCheck,
  UserPlus,
  UserX,
} from "lucide-react";

const DashboardCalendar = dynamic(() => import("@/components/crm/dashboard/DashboardCalendar"), { ssr: false });
const DashboardHeroActions = dynamic(() => import("@/components/crm/dashboard/DashboardHeroActions"), { ssr: false });
import { subscribeToCrewData } from "@/lib/crew-sync";
import { subscribeToInvoiceShares } from "@/lib/invoice-sync";
import { subscribeToProposalRecords } from "@/lib/proposal-sync";
import { getCachedCrewData, getCachedCustomers, getCachedInvoices, getCachedProposals, refreshCrewData, refreshCustomers, refreshInvoices, refreshProposals, CACHE_EVENTS } from "@/lib/data-cache";
import { listConversationEvents, subscribeToConversationEvents } from "@/lib/twilio/client";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import type { Lead } from "@/types/crm";
import type { TwilioConversationEvent } from "@/types/twilio-conversations";

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
  const [customers, setCustomers] = useState<{ id: string; createdAt?: string }[]>(() => getCachedCustomers<{ id: string; createdAt?: string }>() ?? []);
  const [events,    setEvents]    = useState<TwilioConversationEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
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
    void refreshCustomers<{ id: string; createdAt?: string }>().then((data) => {
      if (mounted) setCustomers(data);
    }).catch(() => {});
    void listConversationEvents(2000).then((data) => {
      if (mounted) { setEvents(data); setEventsLoading(false); }
    }).catch(() => { if (mounted) setEventsLoading(false); });

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

    const unsubEvents = subscribeToConversationEvents((evt) => {
      if (mounted) setEvents((prev) => {
        const exists = prev.find((e) => e.id === evt.id);
        if (exists) return prev.map((e) => e.id === evt.id ? evt : e);
        return [evt, ...prev];
      });
    });

    // Cache-event listeners read already-updated cache — no re-fetch needed.
    function onCrewCache() { const c = getCachedCrewData(); if (c && mounted) setJobs(c.jobs); }
    function onInvoiceCache() { const c = getCachedInvoices<InvoiceSnap>(); if (c && mounted) setInvoices(c); }
    function onProposalCache() { const c = getCachedProposals<ProposalSnap>(); if (c && mounted) setProposals(c.filter((p) => !p.deletedAt)); }
    function onCustomerCache() { const c = getCachedCustomers<{ id: string; createdAt?: string }>(); if (c && mounted) setCustomers(c); }
    window.addEventListener(CACHE_EVENTS.crew, onCrewCache);
    window.addEventListener(CACHE_EVENTS.invoices, onInvoiceCache);
    window.addEventListener(CACHE_EVENTS.proposals, onProposalCache);
    window.addEventListener(CACHE_EVENTS.customers, onCustomerCache);

    return () => {
      mounted = false;
      unsubCrew();
      unsubInvoices();
      unsubProposals();
      unsubEvents();
      window.removeEventListener(CACHE_EVENTS.crew, onCrewCache);
      window.removeEventListener(CACHE_EVENTS.invoices, onInvoiceCache);
      window.removeEventListener(CACHE_EVENTS.proposals, onProposalCache);
      window.removeEventListener(CACHE_EVENTS.customers, onCustomerCache);
    };
  }, []);

  useAutoRefresh(() => {
    void refreshCrewData().then((d) => setJobs(d.jobs)).catch(() => {});
    void refreshInvoices<InvoiceSnap>().then((data) => setInvoices(data)).catch(() => {});
    void refreshProposals<ProposalSnap>().then((data) => setProposals(data.filter((p) => !p.deletedAt))).catch(() => {});
    void refreshCustomers<{ id: string; createdAt?: string }>().then((data) => setCustomers(data)).catch(() => {});
  });

  /* ── Widget computed data ────────────────────────────────────────── */

  const todayStr = useMemo(() => new Date().toLocaleDateString("en-CA"), []);
  const isToday = useCallback((dateStr?: string) => {
    if (!dateStr) return false;
    return dateStr.startsWith(todayStr);
  }, [todayStr]);

  const callMetrics = useMemo(() => {
    const todayEvents = events.filter((e) => (e.type === "incoming_call" || e.type === "call_status") && isToday(e.createdAt));
    const callEvents = todayEvents.filter((e) => e.type === "incoming_call" || (e.type === "call_status" && e.direction));
    const uniqueCalls = new Map<string, TwilioConversationEvent>();
    for (const e of callEvents) {
      const key = e.callSid || e.id;
      if (!uniqueCalls.has(key) || e.createdAt > (uniqueCalls.get(key)!.createdAt)) {
        uniqueCalls.set(key, e);
      }
    }
    const calls = Array.from(uniqueCalls.values());
    const incoming = calls.filter((e) => e.direction === "inbound").length;
    const outgoing = calls.filter((e) => e.direction === "outbound").length;
    const missed = calls.filter((e) => e.direction === "inbound" && (e.status === "no-answer" || e.status === "busy" || e.status === "missed")).length;
    return { total: calls.length, incoming, outgoing, missed };
  }, [events, isToday]);

  const messageMetrics = useMemo(() => {
    const smsEvents = events.filter((e) => e.type === "incoming_sms");
    const todaySms = smsEvents.filter((e) => isToday(e.createdAt));
    const recentConversations = new Set(smsEvents.slice(0, 50).map((e) => e.conversationId).filter(Boolean));
    return { unreadSms: todaySms.length, recentConversations: recentConversations.size };
  }, [events, isToday]);

  const jobMetrics = useMemo(() => {
    const todayJobs = jobs.filter((j) => j.dueDate && j.dueDate === todayStr);
    const scheduled = jobs.filter((j) => j.stage === "scheduled").length;
    const inProgress = jobs.filter((j) => j.stage === "in_progress").length;
    const completed = jobs.filter((j) => COMPLETED_STAGES.has(j.stage)).length;
    const overdue = jobs.filter((j) => {
      if (COMPLETED_STAGES.has(j.stage)) return false;
      if (!j.dueDate) return false;
      return j.dueDate < todayStr;
    }).length;
    return { today: todayJobs.length, scheduled, inProgress, completed, overdue };
  }, [jobs, todayStr]);

  const revenueMetrics = useMemo(() => {
    const paidInvs = invoices.filter(invoicePaid);
    const monthRevenue = paidInvs.reduce((s, i) => s + invoiceTotal(i), 0);
    const outstanding = invoices.filter((i) => i.status !== "Draft" && i.status !== "Voided" && !invoicePaid(i)).reduce((s, i) => {
      const total = invoiceTotal(i);
      const paid = (i.payments || []).reduce((ps, p) => ps + p.amount, 0);
      return s + (total - paid);
    }, 0);
    const paidCount = paidInvs.length;
    const pendingCount = invoices.filter((i) => i.status !== "Draft" && i.status !== "Voided" && !invoicePaid(i)).length;
    return { monthRevenue, outstanding, paidCount, pendingCount };
  }, [invoices]);

  const proposalMetrics = useMemo(() => {
    const draft = proposals.filter((p) => p.status === "Draft").length;
    const viewed = proposals.filter((p) => p.viewedAt && !p.signedAt && p.status !== "Declined").length;
    const declined = proposals.filter((p) => p.status === "Declined").length;
    const won = proposals.filter((p) => ["Won", "Signed", "Approved"].includes(p.status)).length;
    return { draft, viewed, declined, won };
  }, [proposals]);

  const quickOverview = useMemo(() => {
    const newLeads = jobs.filter((j) => j.stage === "new_lead").length;
    const activeCustomers = customers.length;
    const upcomingAppointments = jobs.filter((j) => j.inspectionDate && j.inspectionDate >= todayStr).length;
    return { newLeads, activeCustomers, upcomingAppointments };
  }, [jobs, customers, todayStr]);

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

      {/* ── Detailed Widgets ─────────────────────────────────────────── */}
      <section className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {/* Calls Widget */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"><Phone className="h-4 w-4" /></span>
            <h3 className="text-sm font-semibold text-gray-800">Calls Today</h3>
          </div>
          {eventsLoading ? (
            <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-gray-100" />)}</div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-sm text-gray-500"><Phone className="h-3.5 w-3.5" />Total Calls</span><span className="text-sm font-semibold text-gray-800">{callMetrics.total}</span></div>
              <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-sm text-gray-500"><PhoneIncoming className="h-3.5 w-3.5" />Incoming</span><span className="text-sm font-semibold text-gray-800">{callMetrics.incoming}</span></div>
              <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-sm text-gray-500"><PhoneOutgoing className="h-3.5 w-3.5" />Outgoing</span><span className="text-sm font-semibold text-gray-800">{callMetrics.outgoing}</span></div>
              <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-sm text-gray-500"><PhoneMissed className="h-3.5 w-3.5 text-red-400" />Missed</span><span className={`text-sm font-semibold ${callMetrics.missed > 0 ? "text-red-600" : "text-gray-800"}`}>{callMetrics.missed}</span></div>
            </div>
          )}
        </div>

        {/* Jobs Widget */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Briefcase className="h-4 w-4" /></span>
            <h3 className="text-sm font-semibold text-gray-800">Jobs</h3>
          </div>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Today&apos;s Jobs</span><span className="text-sm font-semibold text-gray-800">{jobMetrics.today}</span></div>
            <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Scheduled</span><span className="text-sm font-semibold text-gray-800">{jobMetrics.scheduled}</span></div>
            <div className="flex items-center justify-between"><span className="text-sm text-gray-500">In Progress</span><span className="text-sm font-semibold text-blue-600">{jobMetrics.inProgress}</span></div>
            <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Completed</span><span className="text-sm font-semibold text-green-600">{jobMetrics.completed}</span></div>
            <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Overdue</span><span className={`text-sm font-semibold ${jobMetrics.overdue > 0 ? "text-red-600" : "text-gray-800"}`}>{jobMetrics.overdue}</span></div>
          </div>
        </div>

        {/* Revenue Widget */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-50 text-green-600"><DollarSign className="h-4 w-4" /></span>
            <h3 className="text-sm font-semibold text-gray-800">Revenue</h3>
          </div>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Total Collected</span><span className="text-sm font-semibold text-green-600">{formatUsd(revenueMetrics.monthRevenue)}</span></div>
            <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Outstanding</span><span className={`text-sm font-semibold ${revenueMetrics.outstanding > 0 ? "text-orange-600" : "text-gray-800"}`}>{formatUsd(revenueMetrics.outstanding)}</span></div>
            <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Paid Invoices</span><span className="text-sm font-semibold text-gray-800">{revenueMetrics.paidCount}</span></div>
            <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Pending Invoices</span><span className={`text-sm font-semibold ${revenueMetrics.pendingCount > 0 ? "text-orange-600" : "text-gray-800"}`}>{revenueMetrics.pendingCount}</span></div>
          </div>
        </div>

        {/* Messages Widget */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-600"><MessageSquare className="h-4 w-4" /></span>
            <h3 className="text-sm font-semibold text-gray-800">Messages</h3>
          </div>
          {eventsLoading ? (
            <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-gray-100" />)}</div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between"><span className="text-sm text-gray-500">SMS Today</span><span className={`text-sm font-semibold ${messageMetrics.unreadSms > 0 ? "text-purple-600" : "text-gray-800"}`}>{messageMetrics.unreadSms}</span></div>
              <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Active Conversations</span><span className="text-sm font-semibold text-gray-800">{messageMetrics.recentConversations}</span></div>
            </div>
          )}
        </div>

        {/* Proposals Widget */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><FileText className="h-4 w-4" /></span>
            <h3 className="text-sm font-semibold text-gray-800">Proposals</h3>
          </div>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Draft</span><span className="text-sm font-semibold text-gray-800">{proposalMetrics.draft}</span></div>
            <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Viewed</span><span className="text-sm font-semibold text-blue-600">{proposalMetrics.viewed}</span></div>
            <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Declined</span><span className={`text-sm font-semibold ${proposalMetrics.declined > 0 ? "text-red-600" : "text-gray-800"}`}>{proposalMetrics.declined}</span></div>
            <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Won (Signed)</span><span className="text-sm font-semibold text-green-600">{proposalMetrics.won}</span></div>
          </div>
        </div>

        {/* Quick Overview Widget */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-600"><TrendingUp className="h-4 w-4" /></span>
            <h3 className="text-sm font-semibold text-gray-800">Quick Overview</h3>
          </div>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-sm text-gray-500"><UserPlus className="h-3.5 w-3.5" />New Leads</span><span className={`text-sm font-semibold ${quickOverview.newLeads > 0 ? "text-orange-600" : "text-gray-800"}`}>{quickOverview.newLeads}</span></div>
            <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-sm text-gray-500"><UserCheck className="h-3.5 w-3.5" />Active Customers</span><span className="text-sm font-semibold text-gray-800">{quickOverview.activeCustomers}</span></div>
            <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-sm text-gray-500"><CalendarCheck className="h-3.5 w-3.5" />Upcoming Inspections</span><span className="text-sm font-semibold text-gray-800">{quickOverview.upcomingAppointments}</span></div>
          </div>
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
