"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarCheck,
  ChevronDown,
  ExternalLink,
  MailOpen,
  MessageSquare,
  PenLine,
  PhoneMissed,
  UserPlus,
  UserX,
  Zap,
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
  const [, setCustomers] = useState<{ id: string; createdAt?: string }[]>(() => getCachedCustomers<{ id: string; createdAt?: string }>() ?? []);
  const [events,    setEvents]    = useState<TwilioConversationEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(
    () => getCachedCrewData() === null && getCachedInvoices() === null && getCachedProposals() === null,
  );
  const [syncDot,   setSyncDot]   = useState(false);

  useEffect(() => {
    let mounted = true;
    let initialDone = false;

    Promise.all([
      refreshCrewData().then((d) => { if (mounted) setJobs(d.jobs); }).catch(() => {}),
      refreshInvoices<InvoiceSnap>().then((data) => { if (mounted) setInvoices(data); }).catch(() => {}),
      refreshProposals<ProposalSnap>().then((data) => { if (mounted) setProposals(data.filter((p) => !p.deletedAt)); }).catch(() => {}),
      refreshCustomers<{ id: string; createdAt?: string }>().then((data) => { if (mounted) setCustomers(data); }).catch(() => {}),
    ]).finally(() => { if (mounted) { setInitialLoading(false); initialDone = true; } });
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

    // Cache-event listeners — skip until initial load completes to prevent stale flash.
    function onCrewCache() { if (!initialDone) return; const c = getCachedCrewData(); if (c && mounted) setJobs(c.jobs); }
    function onInvoiceCache() { if (!initialDone) return; const c = getCachedInvoices<InvoiceSnap>(); if (c && mounted) setInvoices(c); }
    function onProposalCache() { if (!initialDone) return; const c = getCachedProposals<ProposalSnap>(); if (c && mounted) setProposals(c.filter((p) => !p.deletedAt)); }
    function onCustomerCache() { if (!initialDone) return; const c = getCachedCustomers<{ id: string; createdAt?: string }>(); if (c && mounted) setCustomers(c); }
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

  const todayStr = useMemo(() => new Date().toLocaleDateString("en-CA", { timeZone: "America/Phoenix" }), []);
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

  const todayPriorities = useMemo(() => {
    const newLeads = jobs.filter((j) => UNACTIONED_STAGES.has(j.stage)).length;
    const inspectionsToday = jobs.filter((j) => j.inspectionDate && j.inspectionDate === todayStr).length;
    const missedCalls = callMetrics.missed;
    const sentProps = proposals.filter((p) => p.status !== "Draft" && p.sentToEmail);
    const unsignedProps = sentProps.filter((p) => !p.signedAt && !["Won", "Signed", "Approved"].includes(p.status)).length;
    const overdueInvs = invoices.filter(invoiceOverdue).length;
    return { newLeads, inspectionsToday, missedCalls, unsignedProps, overdueInvs };
  }, [jobs, todayStr, callMetrics.missed, proposals, invoices]);

  /* ── Computed metrics ────────────────────────────────────────────── */

  const metrics: MetricDef[] = useMemo(() => {
    const unactionedLeads = jobs.filter((j) => UNACTIONED_STAGES.has(j.stage)).length;

    const sentProposals     = proposals.filter((p) => p.status !== "Draft" && p.sentToEmail);
    const unsignedProposals = sentProposals.filter((p) => !p.signedAt && !["Won", "Signed", "Approved"].includes(p.status));

    const activeInvoices   = invoices.filter((i) => i.status !== "Draft" && i.status !== "Voided" && !invoicePaid(i));
    const overdueInvoices  = activeInvoices.filter(invoiceOverdue);

    const followUpJobs = jobs.filter((j) => FOLLOWUP_STAGES.has(j.stage)).length;

    const unsignedProposalValue = unsignedProposals.reduce((s, p) => s + (p.total || 0), 0);
    const overdueInvoiceValue   = overdueInvoices.reduce((s, i) => s + invoiceTotal(i), 0);

    return [
      {
        id: "unactioned-leads",
        label: "New Leads Not Contacted",
        description: "Awaiting first contact",
        icon: UserX,
        urgency: "red" as const,
        href: "/crm/leads",
        count: unactionedLeads,
      },
      {
        id: "unsigned-proposals",
        label: "Unsigned Proposals",
        description: "Awaiting signature",
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
    ];
  }, [jobs, proposals, invoices]);

  const attentionCount = metrics.filter((m) => m.urgency === "red" || m.urgency === "orange").reduce((s, m) => s + m.count, 0);

  /* Summary stats for KPI row */
  const totalRevenue = revenueMetrics.monthRevenue;
  const outstandingBalance = revenueMetrics.outstanding;
  const signedProposals = proposals.filter((p) => ["Won", "Signed", "Approved"].includes(p.status)).length;
  const activeLeads = jobs.filter((j) => !COMPLETED_STAGES.has(j.stage)).length;
  const sentProposalCount = proposals.filter((p) => p.status !== "Draft").length;

  /* ── Collapsible section state (localStorage-persisted) ──────── */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem("crm-dash-collapsed") || "{}"); } catch { return {}; }
  });

  const toggleSection = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem("crm-dash-collapsed", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 sm:gap-4">
      {/* ── Welcome Header ──────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur-sm sm:px-5 sm:py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-base font-bold text-gray-900 sm:text-lg">
              Good morning, XRP Roofing team
            </h1>
            <p className="mt-0.5 text-xs text-gray-500">
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

      {/* ── Today Priorities ─────────────────────────────────────────── */}
      <section className="rounded-xl border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 px-4 py-3 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-orange-100 text-orange-600"><Zap className="h-3.5 w-3.5" /></span>
          <h2 className="text-sm font-bold text-gray-900">Today&apos;s Priorities</h2>
        </div>
        {initialLoading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[1,2,3,4,5].map((i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-orange-200/60 bg-white/80 px-3 py-2">
                <div className="h-4 w-4 animate-pulse rounded bg-gray-200" />
                <div className="flex-1"><div className="h-5 w-8 animate-pulse rounded bg-gray-200" /><div className="mt-1 h-2.5 w-14 animate-pulse rounded bg-gray-100" /></div>
              </div>
            ))}
          </div>
        ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <button type="button" onClick={() => router.push("/crm/leads")} className="flex items-center gap-2 rounded-lg border border-orange-200/60 bg-white/80 px-3 py-2 text-left transition hover:bg-white hover:shadow-sm">
            <UserPlus className="h-4 w-4 shrink-0 text-red-500" />
            <div className="min-w-0">
              <p className={`text-lg font-bold leading-none ${todayPriorities.newLeads > 0 ? "text-red-600" : "text-gray-800"}`}>{todayPriorities.newLeads}</p>
              <p className="text-[10px] text-gray-500">New Leads</p>
            </div>
          </button>
          <button type="button" onClick={() => router.push("/crm/calendar")} className="flex items-center gap-2 rounded-lg border border-orange-200/60 bg-white/80 px-3 py-2 text-left transition hover:bg-white hover:shadow-sm">
            <CalendarCheck className="h-4 w-4 shrink-0 text-blue-500" />
            <div className="min-w-0">
              <p className="text-lg font-bold leading-none text-gray-800">{todayPriorities.inspectionsToday}</p>
              <p className="text-[10px] text-gray-500">Inspections</p>
            </div>
          </button>
          <button type="button" onClick={() => router.push("/crm/phone")} className="flex items-center gap-2 rounded-lg border border-orange-200/60 bg-white/80 px-3 py-2 text-left transition hover:bg-white hover:shadow-sm">
            <PhoneMissed className="h-4 w-4 shrink-0 text-red-500" />
            <div className="min-w-0">
              <p className={`text-lg font-bold leading-none ${todayPriorities.missedCalls > 0 ? "text-red-600" : "text-gray-800"}`}>{todayPriorities.missedCalls}</p>
              <p className="text-[10px] text-gray-500">Missed Calls</p>
            </div>
          </button>
          <button type="button" onClick={() => router.push("/crm/proposals")} className="flex items-center gap-2 rounded-lg border border-orange-200/60 bg-white/80 px-3 py-2 text-left transition hover:bg-white hover:shadow-sm">
            <PenLine className="h-4 w-4 shrink-0 text-amber-500" />
            <div className="min-w-0">
              <p className={`text-lg font-bold leading-none ${todayPriorities.unsignedProps > 0 ? "text-amber-600" : "text-gray-800"}`}>{todayPriorities.unsignedProps}</p>
              <p className="text-[10px] text-gray-500">Unsigned</p>
            </div>
          </button>
          <button type="button" onClick={() => router.push("/crm/invoices")} className="flex items-center gap-2 rounded-lg border border-orange-200/60 bg-white/80 px-3 py-2 text-left transition hover:bg-white hover:shadow-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
            <div className="min-w-0">
              <p className={`text-lg font-bold leading-none ${todayPriorities.overdueInvs > 0 ? "text-red-600" : "text-gray-800"}`}>{todayPriorities.overdueInvs}</p>
              <p className="text-[10px] text-gray-500">Overdue</p>
            </div>
          </button>
        </div>
        )}
      </section>

      {/* ── KPI Row (6 cards) ────────────────────────────────────────── */}
      {initialLoading ? (
        <section className="grid grid-cols-3 gap-2 sm:grid-cols-6 sm:gap-3">
          {[1,2,3,4,5,6].map((i) => (
            <div key={i} className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <div className="h-2.5 w-14 animate-pulse rounded bg-gray-100" />
              <div className="mt-2 h-6 w-10 animate-pulse rounded bg-gray-200" />
            </div>
          ))}
        </section>
      ) : (
      <section className="grid grid-cols-3 gap-2 sm:grid-cols-6 sm:gap-3">
        <div className="min-w-0 rounded-lg border border-gray-200 bg-white px-2 py-2 sm:px-3 sm:py-2.5">
          <p className="truncate text-[10px] font-medium uppercase tracking-wide text-gray-400">Total Jobs</p>
          <p className="mt-0.5 truncate text-lg font-bold text-gray-900 sm:text-xl">{jobs.length}</p>
        </div>
        <div className="min-w-0 rounded-lg border border-gray-200 bg-white px-2 py-2 sm:px-3 sm:py-2.5">
          <p className="truncate text-[10px] font-medium uppercase tracking-wide text-gray-400">Active Leads</p>
          <p className="mt-0.5 truncate text-lg font-bold text-gray-900 sm:text-xl">{activeLeads}</p>
        </div>
        <div className="min-w-0 rounded-lg border border-gray-200 bg-white px-2 py-2 sm:px-3 sm:py-2.5">
          <p className="truncate text-[10px] font-medium uppercase tracking-wide text-gray-400">Proposals</p>
          <p className="mt-0.5 truncate text-lg font-bold text-gray-900 sm:text-xl">{sentProposalCount}</p>
        </div>
        <div className="min-w-0 rounded-lg border border-gray-200 bg-white px-2 py-2 sm:px-3 sm:py-2.5">
          <p className="truncate text-[10px] font-medium uppercase tracking-wide text-gray-400">Signed</p>
          <p className="mt-0.5 truncate text-lg font-bold text-green-600 sm:text-xl">{signedProposals}</p>
        </div>
        <div className="min-w-0 rounded-lg border border-gray-200 bg-white px-2 py-2 sm:px-3 sm:py-2.5">
          <p className="truncate text-[10px] font-medium uppercase tracking-wide text-gray-400">Revenue</p>
          <p className="mt-0.5 truncate text-lg font-bold text-gray-900 sm:text-xl">{totalRevenue > 0 ? formatUsd(totalRevenue) : "$0"}</p>
        </div>
        <div className="min-w-0 rounded-lg border border-gray-200 bg-white px-2 py-2 sm:px-3 sm:py-2.5">
          <p className="truncate text-[10px] font-medium uppercase tracking-wide text-gray-400">Outstanding</p>
          <p className={`mt-0.5 truncate text-lg font-bold sm:text-xl ${outstandingBalance > 0 ? "text-orange-600" : "text-gray-900"}`}>{outstandingBalance > 0 ? formatUsd(outstandingBalance) : "$0"}</p>
        </div>
      </section>
      )}

      {/* ── Messages (SMS/MMS) — voice activity lives on the Phone page ─── */}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => toggleSection("comms")}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50 text-indigo-600"><MessageSquare className="h-3.5 w-3.5" /></span>
            <h2 className="text-sm font-bold text-gray-900">Messages</h2>
          </div>
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${collapsed["comms"] ? "-rotate-90" : ""}`} />
        </button>
        {!collapsed["comms"] && (
          <div className="border-t border-gray-100 px-4 pb-3 pt-2">
            {eventsLoading ? (
              <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-gray-100" />)}</div>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:gap-x-6">
                <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-xs text-gray-500"><MessageSquare className="h-3 w-3" />SMS Today</span><span className={`text-sm font-semibold ${messageMetrics.unreadSms > 0 ? "text-purple-600" : "text-gray-800"}`}>{messageMetrics.unreadSms}</span></div>
                <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-xs text-gray-500"><MailOpen className="h-3 w-3" />Active Convos</span><span className="text-sm font-semibold text-gray-800">{messageMetrics.recentConversations}</span></div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Calendar ─────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => toggleSection("calendar")}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-600"><CalendarCheck className="h-3.5 w-3.5" /></span>
            <h2 className="text-sm font-bold text-gray-900">Calendar</h2>
          </div>
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${collapsed["calendar"] ? "-rotate-90" : ""}`} />
        </button>
        {!collapsed["calendar"] && (
          <div className="border-t border-gray-100">
            <DashboardCalendar />
          </div>
        )}
      </section>

      {/* ── Action Items ────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => toggleSection("actions")}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-red-50 text-red-600"><AlertTriangle className="h-3.5 w-3.5" /></span>
            <h2 className="text-sm font-bold text-gray-900">Action Items</h2>
            {attentionCount > 0 && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">{attentionCount}</span>
            )}
          </div>
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${collapsed["actions"] ? "-rotate-90" : ""}`} />
        </button>
        {!collapsed["actions"] && (
          <div className="border-t border-gray-100 px-4 pb-3 pt-2">
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
              {metrics.map((m) => {
                const Icon = m.icon;
                const c = urgencyColor(m.urgency);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => router.push(m.href)}
                    className={`group flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition hover:shadow-sm active:scale-[0.98] ${c.border} ${c.bg}`}
                  >
                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${c.icon}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className={`text-lg font-bold leading-none ${c.text}`}>{m.count}</p>
                        {m.dollar !== undefined && m.dollar > 0 && (
                          <span className="text-[10px] font-medium text-gray-500">{formatUsd(m.dollar)}</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs font-medium text-gray-700">{m.label}</p>
                    </div>
                    <ExternalLink className="h-3 w-3 shrink-0 text-gray-300 transition group-hover:text-gray-500" />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
