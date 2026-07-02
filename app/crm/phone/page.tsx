"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Clock,
  ExternalLink,
  Headphones,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  PhoneOutgoing,
  Search,
  ShieldBan,
  Voicemail,
  X,
} from "lucide-react";
import { listConversationEvents, subscribeToConversationEvents } from "@/lib/twilio/client";
import { loadLiveCustomers, buildPhoneLookup, matchCustomerByPhone } from "@/lib/conversation-contact-sync";
import { azDateTime } from "@/lib/arizona-time";
import { getTwilioLines } from "@/lib/twilio/numbers";
import type { TwilioConversationEvent } from "@/types/twilio-conversations";
import type { Customer } from "@/types/crm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CallRecord {
  id: string;
  customerName: string;
  phone: string;
  from: string;
  to: string;
  direction: "inbound" | "outbound";
  status: string;
  statusColor: string;
  duration: string;
  durationSec: number;
  dateTime: string;
  rawDate: string;
  callSid: string;
  disposition?: string;
  customerId?: string;
  tag?: "Forwarded" | "Unknown Caller";
  twilioLine?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TABS = ["Calls", "Phone Numbers", "Call Analytics", "Blocked Numbers", "Voicemail"] as const;
type Tab = (typeof TABS)[number];

const CALL_FILTERS = ["All", "Inbound", "Outbound", "Missed", "Forwarded"] as const;
type CallFilter = (typeof CALL_FILTERS)[number];

const LEAD_DISPOSITIONS = [
  "No Answer",
  "Left Voicemail",
  "Follow Up Required",
  "Appointment Scheduled",
  "Estimate Scheduled",
  "Proposal Sent",
  "Won",
  "Lost",
  "Do Not Contact",
  "Spam",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number | undefined | null): string {
  if (!seconds || seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDurationLong(seconds: number): string {
  if (!seconds || seconds <= 0) return "0 sec";
  if (seconds < 60) return `${seconds} sec`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function getCallStatusLabel(event: TwilioConversationEvent): string {
  const s = event.status?.toLowerCase() || "";
  if (s === "completed") return "Answered";
  if (s === "no-answer" || s === "no_answer") return "No Answer";
  if (s === "busy") return "Busy";
  if (s === "failed") return "Failed";
  if (s === "canceled" || s === "cancelled") return "Canceled";
  if (s === "ringing" || s === "queued" || s === "initiated") return "Ringing";
  if (s === "forwarded" || s === "forward") return "Forwarded";
  if (event.type === "incoming_call" && !event.status) return "Answered";
  return event.status || "Unknown";
}

function getStatusColor(status: string, direction: string): string {
  if (status === "Answered") return direction === "outbound" ? "blue" : "green";
  if (status === "No Answer" || status === "Busy" || status === "Canceled" || status === "Failed") return "red";
  if (status === "Forwarded") return "orange";
  if (status === "Ringing") return "yellow";
  if (status === "Voicemail") return "gray";
  return direction === "outbound" ? "blue" : "green";
}

function isForwardedCall(event: TwilioConversationEvent): boolean {
  const s = event.status?.toLowerCase() || "";
  if (s === "forwarded" || s === "forward") return true;
  const payload = event.payload || {};
  if (typeof payload.ForwardedFrom === "string" && payload.ForwardedFrom) return true;
  if (typeof payload.forwardedFrom === "string" && payload.forwardedFrom) return true;
  if (typeof payload.Direction === "string" && payload.Direction.toLowerCase().includes("forward")) return true;
  return false;
}

function formatPhoneDisplay(phone: string): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone.startsWith("+") ? phone : `+${phone}`;
}

function getDispositionColor(d: string): string {
  switch (d) {
    case "Appointment Scheduled":
    case "Estimate Scheduled":
    case "Won":
      return "bg-green-50 text-green-700 ring-green-200";
    case "Follow Up Required":
    case "Proposal Sent":
      return "bg-amber-50 text-amber-700 ring-amber-200";
    case "No Answer":
    case "Left Voicemail":
      return "bg-yellow-50 text-yellow-700 ring-yellow-200";
    case "Lost":
    case "Do Not Contact":
    case "Spam":
      return "bg-red-50 text-red-700 ring-red-200";
    default:
      return "bg-gray-50 text-gray-600 ring-gray-200";
  }
}

function loadDispositions(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem("xrp-phone-dispositions") || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function saveDisposition(phone: string, disposition: string) {
  const d = loadDispositions();
  d[phone] = disposition;
  localStorage.setItem("xrp-phone-dispositions", JSON.stringify(d));
}

function loadBlockedNumbers(): string[] {
  try {
    return JSON.parse(localStorage.getItem("xrp-phone-blocked") || "[]") as string[];
  } catch {
    return [];
  }
}

function saveBlockedNumbers(numbers: string[]) {
  localStorage.setItem("xrp-phone-blocked", JSON.stringify(numbers));
}

// ---------------------------------------------------------------------------
// Status dot component
// ---------------------------------------------------------------------------

function StatusDot({ color }: { color: string }) {
  const colorMap: Record<string, string> = {
    green: "bg-green-500",
    red: "bg-red-500",
    blue: "bg-blue-500",
    orange: "bg-orange-500",
    yellow: "bg-yellow-500",
    gray: "bg-gray-400",
  };
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${colorMap[color] || "bg-gray-400"}`} />;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PhonePage() {
  const [events, setEvents] = useState<TwilioConversationEvent[]>([]);
  const [phoneLookup, setPhoneLookup] = useState<Map<string, Customer>>(new Map());
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("Calls");
  const [callFilter, setCallFilter] = useState<CallFilter>("All");
  const [search, setSearch] = useState("");
  const [dispositions, setDispositions] = useState<Record<string, string>>(() => loadDispositions());
  const [showDispositionPicker, setShowDispositionPicker] = useState<string | null>(null);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [blockedNumbers, setBlockedNumbers] = useState<string[]>(() => loadBlockedNumbers());
  const [blockInput, setBlockInput] = useState("");
  const [perPage, setPerPage] = useState(25);

  const twilioLines = useMemo(() => getTwilioLines(), []);

  // Load data
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const [evts, custs] = await Promise.all([listConversationEvents(2000), loadLiveCustomers()]);
        if (!mounted) return;
        setEvents(evts);
        setPhoneLookup(buildPhoneLookup(custs));
      } catch {
        /* silently handle */
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  // Real-time subscription
  useEffect(() => {
    const unsub = subscribeToConversationEvents((event) => {
      setEvents((prev) => [event, ...prev]);
    });
    return unsub;
  }, []);

  // Build call records from events
  const callRecords: CallRecord[] = useMemo(() => {
    const callEvents = events.filter((e) => e.type === "incoming_call" || e.type === "call_status");
    const callMap = new Map<string, TwilioConversationEvent>();
    for (const e of callEvents) {
      if (!e.callSid) continue;
      const existing = callMap.get(e.callSid);
      if (!existing || new Date(e.createdAt) > new Date(existing.createdAt)) {
        callMap.set(e.callSid, e);
      }
    }

    const records: CallRecord[] = [];
    for (const [, event] of callMap) {
      const phone = event.direction === "inbound" ? event.from || "" : event.to || "";
      const customer = matchCustomerByPhone(phone, phoneLookup);
      const payload = event.payload || {};
      const duration =
        typeof payload.CallDuration === "number"
          ? payload.CallDuration
          : typeof payload.Duration === "number"
            ? payload.Duration
            : typeof payload.duration === "number"
              ? payload.duration
              : 0;

      const forwarded = isForwardedCall(event);
      let displayName: string;
      let tag: CallRecord["tag"];

      if (forwarded && !customer && !phone) {
        displayName = "Forwarded Call";
        tag = "Forwarded";
      } else if (forwarded) {
        displayName = customer?.name || (phone ? formatPhoneDisplay(phone) : "Forwarded Call");
        tag = "Forwarded";
      } else if (customer?.name) {
        displayName = customer.name;
      } else if (phone) {
        displayName = formatPhoneDisplay(phone);
      } else {
        displayName = "Unknown Caller";
        tag = "Unknown Caller";
      }

      const status = getCallStatusLabel(event);
      const dir = event.direction || "inbound";

      records.push({
        id: event.id,
        customerName: displayName,
        phone,
        from: event.from || "",
        to: event.to || "",
        direction: dir,
        status,
        statusColor: getStatusColor(status, dir),
        duration: formatDuration(duration as number),
        durationSec: (duration as number) || 0,
        dateTime: azDateTime(event.createdAt),
        rawDate: event.createdAt,
        callSid: event.callSid || "",
        disposition: dispositions[phone] || undefined,
        customerId: customer?.id,
        tag,
        twilioLine: event.to && dir === "inbound" ? formatPhoneDisplay(event.to) : event.from && dir === "outbound" ? formatPhoneDisplay(event.from) : undefined,
      });
    }

    records.sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime());
    return records;
  }, [events, dispositions, phoneLookup]);

  // Stats
  const stats = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayCalls = callRecords.filter((c) => c.rawDate.slice(0, 10) === todayStr);
    const missed = callRecords.filter(
      (c) => c.status === "No Answer" || c.status === "Busy" || c.status === "Canceled"
    );
    const inbound = callRecords.filter((c) => c.direction === "inbound");
    const outbound = callRecords.filter((c) => c.direction === "outbound");
    const answered = callRecords.filter((c) => c.status === "Answered");
    const totalDuration = answered.reduce((sum, c) => sum + c.durationSec, 0);
    const avgDuration = answered.length > 0 ? Math.round(totalDuration / answered.length) : 0;

    return {
      missed: missed.length,
      inbound: inbound.length,
      outbound: outbound.length,
      total: callRecords.length,
      todayTotal: todayCalls.length,
      avgDuration,
      activeCalls: callRecords.filter((c) => c.status === "Ringing").length,
    };
  }, [callRecords]);

  // Filtered calls
  const filteredCalls = useMemo(() => {
    let filtered = callRecords;

    if (callFilter === "Inbound") filtered = filtered.filter((c) => c.direction === "inbound");
    else if (callFilter === "Outbound") filtered = filtered.filter((c) => c.direction === "outbound");
    else if (callFilter === "Missed") filtered = filtered.filter((c) => c.status === "No Answer" || c.status === "Busy" || c.status === "Canceled");
    else if (callFilter === "Forwarded") filtered = filtered.filter((c) => c.tag === "Forwarded");

    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (c) => c.customerName.toLowerCase().includes(q) || c.phone.includes(q) || (c.disposition && c.disposition.toLowerCase().includes(q))
      );
    }

    return filtered;
  }, [callRecords, callFilter, search]);

  const paginatedCalls = useMemo(() => filteredCalls.slice(0, perPage), [filteredCalls, perPage]);

  // Handle disposition change
  const handleDisposition = useCallback((phone: string, disposition: string) => {
    saveDisposition(phone, disposition);
    setDispositions(loadDispositions());
    setShowDispositionPicker(null);
  }, []);

  // Block number
  const handleBlockNumber = useCallback(
    (phone: string) => {
      if (!phone || blockedNumbers.includes(phone)) return;
      const updated = [...blockedNumbers, phone];
      setBlockedNumbers(updated);
      saveBlockedNumbers(updated);
    },
    [blockedNumbers]
  );

  const handleUnblockNumber = useCallback(
    (phone: string) => {
      const updated = blockedNumbers.filter((n) => n !== phone);
      setBlockedNumbers(updated);
      saveBlockedNumbers(updated);
    },
    [blockedNumbers]
  );

  // Call back via global dialer
  const handleCallBack = useCallback((phone: string) => {
    window.dispatchEvent(new CustomEvent("crm:open-dialer", { detail: { phone } }));
  }, []);

  // Selected call detail
  const selectedCall = useMemo(() => {
    if (!selectedCallId) return null;
    return callRecords.find((c) => c.id === selectedCallId) || null;
  }, [selectedCallId, callRecords]);

  // ---------------------------------------------------------------------------
  // Analytics data
  // ---------------------------------------------------------------------------
  const analyticsData = useMemo(() => {
    const byDay = new Map<string, { inbound: number; outbound: number; missed: number }>();
    for (const c of callRecords) {
      const day = c.rawDate.slice(0, 10);
      const entry = byDay.get(day) || { inbound: 0, outbound: 0, missed: 0 };
      if (c.status === "No Answer" || c.status === "Busy" || c.status === "Canceled") entry.missed++;
      else if (c.direction === "inbound") entry.inbound++;
      else entry.outbound++;
      byDay.set(day, entry);
    }
    const days = Array.from(byDay.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 14)
      .reverse();

    const topCallers = new Map<string, { name: string; phone: string; count: number }>();
    for (const c of callRecords) {
      if (!c.phone) continue;
      const existing = topCallers.get(c.phone);
      if (existing) {
        existing.count++;
      } else {
        topCallers.set(c.phone, { name: c.customerName, phone: c.phone, count: 1 });
      }
    }
    const topCallersList = Array.from(topCallers.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return { days, topCallers: topCallersList };
  }, [callRecords]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-4 p-4 lg:p-6">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 animate-pulse rounded-lg bg-gray-200" />
          <div className="h-6 w-48 animate-pulse rounded bg-gray-200" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-white shadow-sm" />
          ))}
        </div>
        <div className="flex-1 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gray-50">
      {/* ----------------------------------------------------------------- */}
      {/* Top bar — phone numbers + title                                    */}
      {/* ----------------------------------------------------------------- */}
      <div className="border-b border-gray-200 bg-white px-4 py-3 lg:px-6">
        {/* Desktop header */}
        <div className="hidden items-center gap-3 lg:flex">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white">
            <Phone className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Phone</h1>
            <div className="flex items-center gap-3">
              {twilioLines.map((line) => (
                <span key={line.key} className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
                  {line.label}{" "}
                  <span className="font-mono text-gray-400">{formatPhoneDisplay(line.number)}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Mobile header — compact with swipeable number pills */}
        <div className="lg:hidden">
          <h1 className="text-base font-bold text-gray-900">Phone</h1>
          <div className="mt-1.5 flex items-center gap-2 overflow-x-auto scrollbar-hide">
            {twilioLines.map((line) => (
              <div key={line.key} className="flex shrink-0 items-center gap-2 rounded-full bg-gray-50 px-3 py-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                <span className="text-xs font-semibold text-gray-700">{line.label}</span>
                <span className="font-mono text-[11px] text-gray-400">{formatPhoneDisplay(line.number)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="-mb-3 mt-3 flex items-center gap-0.5 overflow-x-auto scrollbar-hide">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-xs font-semibold transition lg:px-4 lg:text-sm ${
                activeTab === tab
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
              }`}
            >
              {tab === "Calls" && <PhoneCall className="mr-1 inline h-3.5 w-3.5" />}
              {tab === "Phone Numbers" && <Phone className="mr-1 inline h-3.5 w-3.5" />}
              {tab === "Call Analytics" && <BarChart3 className="mr-1 inline h-3.5 w-3.5" />}
              {tab === "Blocked Numbers" && <ShieldBan className="mr-1 inline h-3.5 w-3.5" />}
              {tab === "Voicemail" && <Voicemail className="mr-1 inline h-3.5 w-3.5" />}
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Tab content                                                        */}
      {/* ----------------------------------------------------------------- */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "Calls" && (
          <div className="flex flex-col">
            {/* ========== Mobile compact stats ========== */}
            <div className="grid grid-cols-3 gap-2 p-3 lg:hidden">
              <div className="rounded-lg bg-white px-3 py-2 text-center shadow-sm">
                <p className="text-lg font-bold text-red-600">{stats.missed}</p>
                <p className="text-[10px] font-semibold text-gray-500">Missed</p>
              </div>
              <div className="rounded-lg bg-white px-3 py-2 text-center shadow-sm">
                <p className="text-lg font-bold text-green-600">{stats.inbound}</p>
                <p className="text-[10px] font-semibold text-gray-500">Inbound</p>
              </div>
              <div className="rounded-lg bg-white px-3 py-2 text-center shadow-sm">
                <p className="text-lg font-bold text-blue-600">{stats.outbound}</p>
                <p className="text-[10px] font-semibold text-gray-500">Outbound</p>
              </div>
            </div>

            {/* ========== Desktop stats cards ========== */}
            <div className="hidden grid-cols-6 gap-3 p-4 lg:grid lg:px-6">
              <StatCard icon={PhoneMissed} iconColor="text-red-600" iconBg="bg-red-50" label="Missed Calls" value={stats.missed} />
              <StatCard icon={PhoneIncoming} iconColor="text-green-600" iconBg="bg-green-50" label="Inbound Calls" value={stats.inbound} />
              <StatCard icon={PhoneOutgoing} iconColor="text-blue-600" iconBg="bg-blue-50" label="Outbound Calls" value={stats.outbound} />
              <StatCard icon={Headphones} iconColor="text-purple-600" iconBg="bg-purple-50" label="Active Calls" value={stats.activeCalls} />
              <StatCard icon={Clock} iconColor="text-amber-600" iconBg="bg-amber-50" label="Avg Duration" value={formatDurationLong(stats.avgDuration)} />
              <StatCard icon={PhoneCall} iconColor="text-gray-600" iconBg="bg-gray-100" label="Total Calls" value={stats.total} />
            </div>

            {/* ========== Mobile search (always visible) ========== */}
            <div className="px-3 pb-2 lg:hidden">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search customer or phone..."
                  className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm outline-none placeholder:text-gray-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                />
                {search && (
                  <button type="button" onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* ========== Filter bar ========== */}
            <div className="flex flex-col gap-2 border-b border-gray-200 bg-white px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between lg:gap-3 lg:px-6 lg:py-3">
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide lg:gap-2">
                {CALL_FILTERS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setCallFilter(f)}
                    className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition lg:px-3.5 ${
                      callFilter === f ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              {/* Desktop search + pagination */}
              <div className="hidden items-center gap-3 lg:flex">
                <div className="relative w-64">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search phone or customer..."
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-4 text-sm outline-none transition placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
                  />
                  {search && (
                    <button type="button" onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <select
                  value={perPage}
                  onChange={(e) => setPerPage(Number(e.target.value))}
                  className="rounded-lg border border-gray-200 px-2 py-2 text-xs font-semibold text-gray-600 outline-none"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>

            {/* ========== Mobile call cards ========== */}
            <div className="divide-y divide-gray-100 lg:hidden">
              {paginatedCalls.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <PhoneOff className="h-10 w-10" />
                  <p className="mt-2 text-sm font-semibold">No calls yet</p>
                  <p className="text-xs">Start making or receiving calls.</p>
                </div>
              )}
              {paginatedCalls.map((call) => (
                <div key={call.id} className="bg-white px-4 py-3 active:bg-gray-50">
                  <div className="flex items-start gap-3">
                    {/* Direction icon */}
                    <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                      call.statusColor === "red" ? "bg-red-50" : call.statusColor === "blue" ? "bg-blue-50" : call.statusColor === "orange" ? "bg-orange-50" : "bg-green-50"
                    }`}>
                      {call.statusColor === "red" ? (
                        <PhoneMissed className={`h-5 w-5 text-red-500`} />
                      ) : call.direction === "inbound" ? (
                        <ArrowDownLeft className="h-5 w-5 text-green-600" />
                      ) : (
                        <ArrowUpRight className="h-5 w-5 text-blue-600" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-bold text-gray-900">{call.customerName}</p>
                        {call.tag === "Forwarded" && (
                          <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-orange-50 text-orange-600">Fwd</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">
                        {call.direction === "inbound" ? "Incoming Call" : "Outgoing Call"}
                        {call.twilioLine ? ` · ${call.twilioLine}` : ""}
                      </p>
                      <div className="mt-1 flex items-center gap-3 text-[11px] text-gray-400">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {call.duration}
                        </span>
                        <span>{call.dateTime}</span>
                      </div>
                      {call.disposition && (
                        <span className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${getDispositionColor(call.disposition)}`}>
                          {call.disposition}
                        </span>
                      )}
                    </div>

                    {/* Status dot */}
                    <StatusDot color={call.statusColor} />
                  </div>

                  {/* Quick action buttons */}
                  <div className="mt-2.5 flex items-center gap-2 pl-[52px]">
                    {call.phone && (
                      <button
                        type="button"
                        onClick={() => handleCallBack(call.phone)}
                        className="flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-2 text-xs font-semibold text-green-700 active:bg-green-100"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        Call Back
                      </button>
                    )}
                    {call.customerId && (
                      <a
                        href={`/crm/customers?id=${call.customerId}`}
                        className="flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 active:bg-blue-100"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Customer
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowDispositionPicker(showDispositionPicker === call.id ? null : call.id)}
                      className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-600 active:bg-gray-200"
                    >
                      + Tag
                    </button>
                  </div>

                  {/* Mobile disposition picker */}
                  {showDispositionPicker === call.id && (
                    <div className="mt-2 ml-[52px] flex flex-wrap gap-1.5">
                      {LEAD_DISPOSITIONS.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => handleDisposition(call.phone, d)}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${getDispositionColor(d)} active:opacity-70`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* ========== Desktop call history table ========== */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-6 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">Status</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">From</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">To</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">Time</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">Duration</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">Disposition</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">Line</th>
                    <th className="pr-6 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-gray-500">Quick Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {paginatedCalls.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-16 text-center">
                        <PhoneOff className="mx-auto h-10 w-10 text-gray-300" />
                        <p className="mt-2 text-sm font-semibold text-gray-400">No calls yet</p>
                        <p className="text-xs text-gray-400">Your call history is empty. Start making or receiving calls.</p>
                      </td>
                    </tr>
                  )}
                  {paginatedCalls.map((call) => (
                    <tr
                      key={call.id}
                      onClick={() => setSelectedCallId(selectedCallId === call.id ? null : call.id)}
                      className={`cursor-pointer transition hover:bg-blue-50/50 ${selectedCallId === call.id ? "bg-blue-50/60" : ""}`}
                    >
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <StatusDot color={call.statusColor} />
                          <span className="text-sm font-semibold text-gray-800">{call.status}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          {call.direction === "inbound" ? (
                            <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-green-500" />
                          ) : (
                            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-gray-900">{call.customerName}</p>
                            <p className="truncate text-xs text-gray-400">{call.from ? formatPhoneDisplay(call.from) : "-"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <p className="text-sm text-gray-600">{call.to ? formatPhoneDisplay(call.to) : "-"}</p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="text-sm text-gray-600">{call.dateTime}</p>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1 text-sm text-gray-600">
                          <Clock className="h-3 w-3 text-gray-400" />
                          {call.duration}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="relative">
                          {call.disposition ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowDispositionPicker(showDispositionPicker === call.id ? null : call.id);
                              }}
                              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${getDispositionColor(call.disposition)}`}
                            >
                              {call.disposition}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowDispositionPicker(showDispositionPicker === call.id ? null : call.id);
                              }}
                              className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-semibold text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                            >
                              + Tag
                            </button>
                          )}
                          {showDispositionPicker === call.id && (
                            <div className="absolute left-0 top-7 z-50 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-xl">
                              {LEAD_DISPOSITIONS.map((d) => (
                                <button
                                  key={d}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDisposition(call.phone, d);
                                  }}
                                  className="w-full px-3 py-1.5 text-left text-xs font-semibold text-gray-700 hover:bg-blue-50 hover:text-blue-700"
                                >
                                  {d}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <p className="text-xs text-gray-400">{call.twilioLine || "-"}</p>
                      </td>
                      <td className="pr-6 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {call.phone && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCallBack(call.phone);
                              }}
                              title="Call Back"
                              className="rounded-lg p-1.5 text-gray-400 transition hover:bg-green-50 hover:text-green-600"
                            >
                              <Phone className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {call.customerId && (
                            <a
                              href={`/crm/customers?id=${call.customerId}`}
                              onClick={(e) => e.stopPropagation()}
                              title="View Customer"
                              className="rounded-lg p-1.5 text-gray-400 transition hover:bg-blue-50 hover:text-blue-600"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Load more */}
            {filteredCalls.length > perPage && (
              <div className="border-t border-gray-200 bg-white px-6 py-3 text-center">
                <button
                  type="button"
                  onClick={() => setPerPage((p) => p + 25)}
                  className="text-sm font-semibold text-blue-600 hover:text-blue-700"
                >
                  Show more ({filteredCalls.length - perPage} remaining)
                </button>
              </div>
            )}

            {/* Desktop expanded call detail */}
            {selectedCall && (
              <div className="hidden border-t border-blue-200 bg-blue-50/30 px-6 py-4 lg:block">
                <div className="flex flex-wrap items-start gap-6">
                  <div>
                    <p className="text-xs font-bold uppercase text-gray-400">Customer</p>
                    <p className="text-sm font-semibold text-gray-900">{selectedCall.customerName}</p>
                    <p className="text-xs text-gray-500">{selectedCall.phone ? formatPhoneDisplay(selectedCall.phone) : "No number"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase text-gray-400">Direction</p>
                    <p className="text-sm font-semibold text-gray-900">{selectedCall.direction === "inbound" ? "Inbound" : "Outbound"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase text-gray-400">Status</p>
                    <div className="flex items-center gap-1.5">
                      <StatusDot color={selectedCall.statusColor} />
                      <p className="text-sm font-semibold text-gray-900">{selectedCall.status}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase text-gray-400">Duration</p>
                    <p className="text-sm font-semibold text-gray-900">{selectedCall.duration}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase text-gray-400">Date / Time</p>
                    <p className="text-sm font-semibold text-gray-900">{selectedCall.dateTime}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase text-gray-400">Call SID</p>
                    <p className="font-mono text-xs text-gray-500">{selectedCall.callSid || "-"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedCall.phone && (
                      <button type="button" onClick={() => handleCallBack(selectedCall.phone)} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700">
                        Call Back
                      </button>
                    )}
                    {selectedCall.customerId && (
                      <a href={`/crm/customers?id=${selectedCall.customerId}`} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700">
                        Open Customer
                      </a>
                    )}
                    <a href={`/crm/leads?newLead=1&phone=${encodeURIComponent(selectedCall.phone)}&name=${encodeURIComponent(selectedCall.customerName)}`} className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-200">
                      Create Job
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---- Phone Numbers Tab ---- */}
        {activeTab === "Phone Numbers" && (
          <div className="p-4 lg:p-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {twilioLines.map((line) => {
                const lineCalls = callRecords.filter((c) => {
                  const lineNum = line.number.replace(/\D/g, "");
                  const fromDigits = (c.from || "").replace(/\D/g, "");
                  const toDigits = (c.to || "").replace(/\D/g, "");
                  return fromDigits.endsWith(lineNum.slice(-10)) || toDigits.endsWith(lineNum.slice(-10));
                });
                const missed = lineCalls.filter((c) => c.status === "No Answer" || c.status === "Busy" || c.status === "Canceled").length;
                return (
                  <div key={line.key} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                        <Phone className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900">{line.label}</p>
                        <p className="font-mono text-sm text-gray-500">{formatPhoneDisplay(line.number)}</p>
                      </div>
                      <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Active
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="rounded-lg bg-gray-50 px-2 py-2">
                        <p className="text-lg font-bold text-gray-900">{lineCalls.length}</p>
                        <p className="text-[11px] text-gray-500">Total</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 px-2 py-2">
                        <p className="text-lg font-bold text-red-600">{missed}</p>
                        <p className="text-[11px] text-gray-500">Missed</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 px-2 py-2">
                        <p className="text-lg font-bold text-green-600">{lineCalls.length - missed}</p>
                        <p className="text-[11px] text-gray-500">Answered</p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-gray-400">Source: {line.leadSource}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ---- Call Analytics Tab ---- */}
        {activeTab === "Call Analytics" && (
          <div className="p-4 lg:p-6">
            {/* Stats summary */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm text-center">
                <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                <p className="text-xs text-gray-500">Total Calls</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm text-center">
                <p className="text-2xl font-bold text-green-600">{stats.inbound}</p>
                <p className="text-xs text-gray-500">Inbound</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm text-center">
                <p className="text-2xl font-bold text-blue-600">{stats.outbound}</p>
                <p className="text-xs text-gray-500">Outbound</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm text-center">
                <p className="text-2xl font-bold text-red-600">{stats.missed}</p>
                <p className="text-xs text-gray-500">Missed</p>
              </div>
            </div>

            {/* Daily breakdown */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm mb-6">
              <h3 className="text-sm font-bold text-gray-900 mb-4">Daily Call Volume (Last 14 Days)</h3>
              {analyticsData.days.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">No call data available</p>
              ) : (
                <div className="space-y-2">
                  {analyticsData.days.map(([day, data]) => {
                    const total = data.inbound + data.outbound + data.missed;
                    const maxBar = Math.max(...analyticsData.days.map(([, d]) => d.inbound + d.outbound + d.missed), 1);
                    return (
                      <div key={day} className="flex items-center gap-3">
                        <span className="w-24 shrink-0 text-xs font-semibold text-gray-500">{day}</span>
                        <div className="flex-1 flex items-center gap-0.5 h-5">
                          {data.inbound > 0 && (
                            <div className="h-full rounded-l bg-green-500" style={{ width: `${(data.inbound / maxBar) * 100}%` }} title={`${data.inbound} inbound`} />
                          )}
                          {data.outbound > 0 && (
                            <div className="h-full bg-blue-500" style={{ width: `${(data.outbound / maxBar) * 100}%` }} title={`${data.outbound} outbound`} />
                          )}
                          {data.missed > 0 && (
                            <div className="h-full rounded-r bg-red-400" style={{ width: `${(data.missed / maxBar) * 100}%` }} title={`${data.missed} missed`} />
                          )}
                        </div>
                        <span className="w-8 shrink-0 text-right text-xs font-bold text-gray-600">{total}</span>
                      </div>
                    );
                  })}
                  <div className="mt-3 flex items-center gap-4 text-[11px] text-gray-400">
                    <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-green-500" /> Inbound</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-blue-500" /> Outbound</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-red-400" /> Missed</span>
                  </div>
                </div>
              )}
            </div>

            {/* Top callers */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-bold text-gray-900 mb-4">Top Callers</h3>
              {analyticsData.topCallers.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">No callers yet</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {analyticsData.topCallers.map((caller, i) => (
                    <div key={caller.phone} className="flex items-center gap-3 py-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-500">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900">{caller.name}</p>
                        <p className="text-xs text-gray-400">{formatPhoneDisplay(caller.phone)}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-bold text-gray-600">{caller.count} calls</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---- Blocked Numbers Tab ---- */}
        {activeTab === "Blocked Numbers" && (
          <div className="p-4 lg:p-6">
            <div className="mb-4 flex items-center gap-3">
              <input
                type="text"
                value={blockInput}
                onChange={(e) => setBlockInput(e.target.value)}
                placeholder="Enter phone number to block..."
                className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none placeholder:text-gray-400 focus:border-red-300 focus:ring-2 focus:ring-red-100 sm:max-w-sm"
              />
              <button
                type="button"
                onClick={() => {
                  if (blockInput.trim()) {
                    handleBlockNumber(blockInput.trim());
                    setBlockInput("");
                  }
                }}
                className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700"
              >
                Block Number
              </button>
            </div>
            {blockedNumbers.length === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-white px-6 py-16 text-center shadow-sm">
                <ShieldBan className="mx-auto h-10 w-10 text-gray-300" />
                <p className="mt-2 text-sm font-semibold text-gray-400">No blocked numbers</p>
                <p className="text-xs text-gray-400">Add numbers above to block unwanted callers.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm">
                {blockedNumbers.map((num) => (
                  <div key={num} className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-3">
                      <ShieldBan className="h-4 w-4 text-red-400" />
                      <span className="text-sm font-semibold text-gray-900">{formatPhoneDisplay(num)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUnblockNumber(num)}
                      className="rounded-lg px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                    >
                      Unblock
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---- Voicemail Tab ---- */}
        {activeTab === "Voicemail" && (
          <div className="p-4 lg:p-6">
            <div className="rounded-xl border border-gray-200 bg-white px-6 py-16 text-center shadow-sm">
              <Voicemail className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-2 text-sm font-semibold text-gray-400">No voicemails</p>
              <p className="text-xs text-gray-400">Voicemail messages will appear here when received.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card sub-component
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  iconColor,
  iconBg,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  iconBg: string;
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg} ${iconColor}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xl font-bold text-gray-900">{value}</p>
          <p className="truncate text-[11px] text-gray-500">{label}</p>
        </div>
      </div>
    </div>
  );
}
