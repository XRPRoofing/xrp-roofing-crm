"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Clock, Filter, Phone, PhoneIncoming, PhoneMissed, PhoneOff, PhoneOutgoing, Search, User, Users, X } from "lucide-react";
import { listConversationEvents, subscribeToConversationEvents } from "@/lib/twilio/client";
import { loadLiveCustomers, buildPhoneLookup, matchCustomerByPhone } from "@/lib/conversation-contact-sync";
import { getCachedCrewData } from "@/lib/data-cache";
import { azDateTime } from "@/lib/arizona-time";
import type { TwilioConversationEvent } from "@/types/twilio-conversations";
import type { Customer } from "@/types/crm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CallRecord {
  id: string;
  customerName: string;
  phone: string;
  direction: "inbound" | "outbound";
  status: string;
  duration: string;
  dateTime: string;
  rawDate: string;
  callSid: string;
  disposition?: string;
  customerId?: string;
  tag?: "Forwarded" | "Unknown Caller";
}

interface ContactRecord {
  id: string;
  name: string;
  phone: string;
  email?: string;
  totalCalls: number;
  lastCallDate: string;
  jobs: { id: string; name: string; stage: string }[];
  disposition?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TABS = ["All Calls", "Inbound", "Outbound", "Missed", "Contacts", "Leads"] as const;
type Tab = typeof TABS[number];

const LEAD_DISPOSITIONS = [
  "New Lead",
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
  // Strip country code and format as (XXX) XXX-XXXX for US numbers
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  // Return original with + prefix for international
  return phone.startsWith("+") ? phone : `+${phone}`;
}

function getStatusColor(status: string): string {
  switch (status) {
    case "Answered": return "text-green-600 bg-green-50";
    case "No Answer": case "Busy": case "Canceled": return "text-orange-600 bg-orange-50";
    case "Failed": return "text-red-600 bg-red-50";
    case "Ringing": return "text-blue-600 bg-blue-50";
    default: return "text-gray-600 bg-gray-50";
  }
}

function getDispositionColor(d: string): string {
  switch (d) {
    case "New Lead": return "bg-blue-50 text-blue-700 ring-blue-200";
    case "Appointment Scheduled": case "Estimate Scheduled": case "Won": return "bg-green-50 text-green-700 ring-green-200";
    case "Follow Up Required": case "Proposal Sent": return "bg-amber-50 text-amber-700 ring-amber-200";
    case "No Answer": case "Left Voicemail": return "bg-yellow-50 text-yellow-700 ring-yellow-200";
    case "Lost": case "Do Not Contact": case "Spam": return "bg-red-50 text-red-700 ring-red-200";
    default: return "bg-gray-50 text-gray-600 ring-gray-200";
  }
}

// Disposition storage in localStorage
function loadDispositions(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem("xrp-phone-dispositions") || "{}") as Record<string, string>;
  } catch { return {}; }
}

function saveDisposition(phone: string, disposition: string) {
  const d = loadDispositions();
  d[phone] = disposition;
  localStorage.setItem("xrp-phone-dispositions", JSON.stringify(d));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PhonePage() {
  const [events, setEvents] = useState<TwilioConversationEvent[]>([]);
  const [phoneLookup, setPhoneLookup] = useState<Map<string, Customer>>(new Map());
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("All Calls");
  const [search, setSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<ContactRecord | null>(null);
  const [dispositions, setDispositions] = useState<Record<string, string>>(() => loadDispositions());
  const [dispositionFilter, setDispositionFilter] = useState<string>("All");
  const [showDispositionPicker, setShowDispositionPicker] = useState<string | null>(null);

  // Load data
  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const [evts, custs] = await Promise.all([
          listConversationEvents(2000),
          loadLiveCustomers(),
        ]);
        if (!mounted) return;
        setEvents(evts);
        setPhoneLookup(buildPhoneLookup(custs));
      } catch {
        // silently handle
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void load();
    return () => { mounted = false; };
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
    const callEvents = events.filter((e) =>
      e.type === "incoming_call" || e.type === "call_status"
    );

    // Group by callSid to get final status
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
      const phone = event.direction === "inbound" ? (event.from || "") : (event.to || "");
      const customer = matchCustomerByPhone(phone, phoneLookup);
      const payload = event.payload || {};
      const duration = typeof payload.CallDuration === "number"
        ? payload.CallDuration
        : typeof payload.Duration === "number"
          ? payload.Duration
          : typeof payload.duration === "number"
            ? payload.duration
            : 0;

      // Determine display name and tag
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

      records.push({
        id: event.id,
        customerName: displayName,
        phone,
        direction: event.direction || "inbound",
        status: getCallStatusLabel(event),
        duration: formatDuration(duration as number),
        dateTime: azDateTime(event.createdAt),
        rawDate: event.createdAt,
        callSid: event.callSid || "",
        disposition: dispositions[phone] || undefined,
        customerId: customer?.id,
        tag,
      });
    }

    // Sort by most recent first
    records.sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime());
    return records;
  }, [events, dispositions, phoneLookup]);

  // Build contacts
  const contacts: ContactRecord[] = useMemo(() => {
    const phoneMap = new Map<string, { calls: CallRecord[]; customer?: Customer }>();

    for (const call of callRecords) {
      if (!call.phone) continue;
      const existing = phoneMap.get(call.phone);
      if (existing) {
        existing.calls.push(call);
      } else {
        const customer = matchCustomerByPhone(call.phone, phoneLookup);
        phoneMap.set(call.phone, { calls: [call], customer: customer || undefined });
      }
    }

    const crewData = getCachedCrewData();
    const jobs = crewData?.jobs || [];

    const result: ContactRecord[] = [];
    for (const [phone, data] of phoneMap) {
      const customerJobs = jobs.filter((j) => j.phone === phone || (data.customer && (j.email === data.customer.email || j.name === data.customer.name)));
      result.push({
        id: phone,
        name: data.customer?.name || data.calls[0]?.customerName || phone,
        phone,
        email: data.customer?.email || undefined,
        totalCalls: data.calls.length,
        lastCallDate: data.calls[0]?.dateTime || "",
        jobs: customerJobs.map((j) => ({ id: j.id, name: j.name || j.address || "Job", stage: j.stage || "" })),
        disposition: dispositions[phone] || undefined,
      });
    }

    result.sort((a, b) => b.totalCalls - a.totalCalls);
    return result;
  }, [callRecords, dispositions, phoneLookup]);

  // Filtered calls by tab
  const filteredCalls = useMemo(() => {
    let filtered = callRecords;

    if (activeTab === "Inbound") filtered = filtered.filter((c) => c.direction === "inbound");
    else if (activeTab === "Outbound") filtered = filtered.filter((c) => c.direction === "outbound");
    else if (activeTab === "Missed") filtered = filtered.filter((c) => c.status === "No Answer" || c.status === "Busy" || c.status === "Canceled");
    else if (activeTab === "Leads") filtered = filtered.filter((c) => c.disposition);

    // Disposition filter
    if (dispositionFilter !== "All") {
      filtered = filtered.filter((c) => c.disposition === dispositionFilter);
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter((c) =>
        c.customerName.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (c.disposition && c.disposition.toLowerCase().includes(q))
      );
    }

    return filtered;
  }, [callRecords, activeTab, search, dispositionFilter]);

  // Filtered contacts
  const filteredContacts = useMemo(() => {
    if (!search.trim()) return contacts;
    const q = search.toLowerCase();
    return contacts.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      (c.email && c.email.toLowerCase().includes(q))
    );
  }, [contacts, search]);

  // Handle disposition change
  const handleDisposition = useCallback((phone: string, disposition: string) => {
    saveDisposition(phone, disposition);
    setDispositions(loadDispositions());
    setShowDispositionPicker(null);
  }, []);

  // Select contact
  const openContact = useCallback((contact: ContactRecord) => {
    setSelectedContact(contact);
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-4 p-6">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 animate-pulse rounded-lg bg-gray-200" />
          <div className="h-6 w-48 animate-pulse rounded bg-gray-200" />
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 w-24 animate-pulse rounded-lg bg-gray-200" />
          ))}
        </div>
        <div className="flex-1 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-gray-100 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
              <Phone className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Phone</h1>
              <p className="text-xs text-gray-500">{callRecords.length} calls · {contacts.length} contacts</p>
            </div>
          </div>

          {/* Search */}
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search calls, contacts..."
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-4 text-sm outline-none transition placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex items-center gap-1">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => { setActiveTab(tab); setSelectedContact(null); }}
              className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition ${activeTab === tab ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:bg-gray-100"}`}
            >
              {tab === "Inbound" && <PhoneIncoming className="mr-1.5 inline h-3.5 w-3.5" />}
              {tab === "Outbound" && <PhoneOutgoing className="mr-1.5 inline h-3.5 w-3.5" />}
              {tab === "Missed" && <PhoneMissed className="mr-1.5 inline h-3.5 w-3.5" />}
              {tab === "Contacts" && <Users className="mr-1.5 inline h-3.5 w-3.5" />}
              {tab === "Leads" && <Filter className="mr-1.5 inline h-3.5 w-3.5" />}
              {tab}
            </button>
          ))}

          {/* Disposition filter for Leads tab */}
          {activeTab === "Leads" && (
            <select
              value={dispositionFilter}
              onChange={(e) => setDispositionFilter(e.target.value)}
              className="ml-3 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 outline-none focus:border-blue-300"
            >
              <option value="All">All Dispositions</option>
              {LEAD_DISPOSITIONS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main list */}
        <div className={`flex-1 overflow-y-auto ${selectedContact ? "hidden lg:block" : ""}`}>
          {activeTab === "Contacts" ? (
            /* Contacts List */
            <div className="divide-y divide-gray-100">
              {filteredContacts.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                  <Users className="h-10 w-10 mb-2" />
                  <p className="text-sm font-semibold">No contacts found</p>
                </div>
              )}
              {filteredContacts.map((contact) => (
                <button
                  key={contact.id}
                  type="button"
                  onClick={() => openContact(contact)}
                  className={`w-full flex items-center gap-4 px-6 py-3.5 text-left transition hover:bg-blue-50 ${selectedContact?.id === contact.id ? "bg-blue-50 border-l-2 border-blue-600" : ""}`}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                    <User className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-bold text-gray-900">{contact.name}</p>
                    <p className="text-xs text-gray-500">{contact.phone}{contact.email ? ` · ${contact.email}` : ""}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold text-gray-600">{contact.totalCalls} calls</p>
                    <p className="text-[11px] text-gray-400">{contact.lastCallDate}</p>
                  </div>
                  {contact.disposition && (
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${getDispositionColor(contact.disposition)}`}>
                      {contact.disposition}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            /* Calls List */
            <div className="divide-y divide-gray-100">
              {filteredCalls.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                  <PhoneOff className="h-10 w-10 mb-2" />
                  <p className="text-sm font-semibold">No calls found</p>
                </div>
              )}
              {filteredCalls.map((call) => (
                <div key={call.id} className="group flex items-center gap-4 px-6 py-3.5 transition hover:bg-gray-50">
                  {/* Direction icon */}
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                    call.status === "No Answer" || call.status === "Busy" || call.status === "Canceled"
                      ? "bg-red-50 text-red-500"
                      : call.direction === "inbound"
                        ? "bg-green-50 text-green-600"
                        : "bg-blue-50 text-blue-600"
                  }`}>
                    {call.status === "No Answer" || call.status === "Busy" || call.status === "Canceled" ? (
                      <PhoneMissed className="h-4 w-4" />
                    ) : call.direction === "inbound" ? (
                      <ArrowDownLeft className="h-4 w-4" />
                    ) : (
                      <ArrowUpRight className="h-4 w-4" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-bold text-gray-900">{call.customerName}</p>
                      {call.tag === "Forwarded" && (
                        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-purple-50 text-purple-600">Forwarded</span>
                      )}
                      {call.tag === "Unknown Caller" && (
                        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-gray-100 text-gray-500">Unknown Caller</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">{call.phone ? formatPhoneDisplay(call.phone) : "No number"}</p>
                  </div>

                  {/* Status */}
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${getStatusColor(call.status)}`}>
                    {call.status}
                  </span>

                  {/* Duration */}
                  <div className="shrink-0 flex items-center gap-1 text-xs text-gray-500">
                    <Clock className="h-3 w-3" />
                    {call.duration}
                  </div>

                  {/* Date/Time */}
                  <p className="shrink-0 text-xs text-gray-400 w-28 text-right">{call.dateTime}</p>

                  {/* Disposition */}
                  <div className="relative shrink-0">
                    {call.disposition ? (
                      <button
                        type="button"
                        onClick={() => setShowDispositionPicker(showDispositionPicker === call.id ? null : call.id)}
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${getDispositionColor(call.disposition)}`}
                      >
                        {call.disposition}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowDispositionPicker(showDispositionPicker === call.id ? null : call.id)}
                        className="rounded-lg px-2 py-1 text-[11px] font-semibold text-gray-400 opacity-0 transition group-hover:opacity-100 hover:bg-gray-100 hover:text-gray-600"
                      >
                        + Disposition
                      </button>
                    )}

                    {/* Disposition picker dropdown */}
                    {showDispositionPicker === call.id && (
                      <div className="absolute right-0 top-8 z-50 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-xl">
                        {LEAD_DISPOSITIONS.map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => handleDisposition(call.phone, d)}
                            className="w-full px-3 py-1.5 text-left text-xs font-semibold text-gray-700 hover:bg-blue-50 hover:text-blue-700"
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Contact Side Panel */}
        {selectedContact && (
          <div className="w-full border-l border-gray-200 bg-white lg:w-96 overflow-y-auto">
            <div className="border-b border-gray-100 px-5 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                    <User className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">{selectedContact.name}</p>
                    <p className="text-xs text-gray-500">{selectedContact.phone}</p>
                    {selectedContact.email && <p className="text-xs text-gray-400">{selectedContact.email}</p>}
                  </div>
                </div>
                <button type="button" onClick={() => setSelectedContact(null)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Disposition */}
              <div className="mt-3">
                <select
                  value={selectedContact.disposition || ""}
                  onChange={(e) => {
                    handleDisposition(selectedContact.phone, e.target.value);
                    setSelectedContact({ ...selectedContact, disposition: e.target.value });
                  }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-300"
                >
                  <option value="">No Disposition</option>
                  {LEAD_DISPOSITIONS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Related Jobs */}
            {selectedContact.jobs.length > 0 && (
              <div className="border-b border-gray-100 px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">Related Jobs</p>
                <div className="space-y-2">
                  {selectedContact.jobs.map((job) => (
                    <div key={job.id} className="rounded-lg bg-gray-50 px-3 py-2">
                      <p className="text-sm font-semibold text-gray-900">{job.name}</p>
                      <p className="text-xs text-gray-500">{job.stage}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Call History for this contact */}
            <div className="px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">Call History ({selectedContact.totalCalls})</p>
              <div className="space-y-2">
                {callRecords
                  .filter((c) => c.phone === selectedContact.phone)
                  .slice(0, 20)
                  .map((call) => (
                    <div key={call.id} className="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2">
                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                        call.status === "No Answer" || call.status === "Busy"
                          ? "bg-red-100 text-red-500"
                          : call.direction === "inbound"
                            ? "bg-green-100 text-green-600"
                            : "bg-blue-100 text-blue-600"
                      }`}>
                        {call.direction === "inbound" ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-700">{call.direction === "inbound" ? "Inbound" : "Outbound"} · {call.status}</p>
                        <p className="text-[11px] text-gray-400">{call.dateTime} · {call.duration}</p>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
