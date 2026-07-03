"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Briefcase,
  CalendarDays,
  Clock,
  ExternalLink,
  Hash,
  ChevronDown,
  ChevronRight,
  FileText,
  Headphones,
  MessageSquare,
  Mic,
  Phone,
  Play,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  PhoneOutgoing,
  Search,
  ShieldBan,
  User,
  Users,
  Voicemail,
  X,
} from "lucide-react";
import { listConversationEvents, subscribeToConversationEvents, sendSms, proxyRecordingUrl } from "@/lib/twilio/client";
import { loadLiveCustomers, buildPhoneLookup, matchCustomerByPhone } from "@/lib/conversation-contact-sync";
import { azDateTime } from "@/lib/arizona-time";
import { getTwilioLines } from "@/lib/twilio/numbers";
import type { TwilioConversationEvent } from "@/types/twilio-conversations";
import type { Customer, Lead } from "@/types/crm";
import { leadToJobRecord, upsertJobRecord } from "@/lib/crew-sync";
import { syncJobToCalendar, toArizonaISO } from "@/lib/calendar-sync";
import { findOrCreateCustomer } from "@/lib/customer-sync";
import { createManualFolder } from "@/lib/manual-folders";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";

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
  recordingUrl?: string;
  summary?: string;
  transcript?: string;
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
    blue: "bg-gray-400",
    orange: "bg-orange-400",
    yellow: "bg-yellow-400",
    gray: "bg-gray-400",
  };
  return <span className={`inline-block h-2 w-2 rounded-full ${colorMap[color] || "bg-gray-400"}`} />;
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
  const [actionSheetCallId, setActionSheetCallId] = useState<string | null>(null);

  // Right-side New Job panel
  const [jobPanelOpen, setJobPanelOpen] = useState(false);
  const [jobPanelPhone, setJobPanelPhone] = useState("");
  const [jobPanelName, setJobPanelName] = useState("");
  const [jobForm, setJobForm] = useState({
    name: "",
    address: "",
    phone: "",
    source: "Phone Call",
    description: "",
    scheduleDate: "",
    scheduleStartTime: "",
    scheduleEndDate: "",
    scheduleEndTime: "",
    assignedTo: "",
  });
  const [jobCreating, setJobCreating] = useState(false);
  const [jobCreated, setJobCreated] = useState(false);

  // Right-side Message panel
  const [smsPanelOpen, setSmsPanelOpen] = useState(false);
  const [smsPanelPhone, setSmsPanelPhone] = useState("");
  const [smsPanelName, setSmsPanelName] = useState("");
  const [smsBody, setSmsBody] = useState("");
  const [smsSending, setSmsSending] = useState(false);
  const [smsSent, setSmsSent] = useState(false);

  // Expanded summary modal
  const [expandedSummary, setExpandedSummary] = useState<{ name: string; summary: string; recordingUrl?: string; transcript?: string } | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

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
      // Skip internal browser-to-Twilio legs (client:crm-agent) — they duplicate the real call
      const fromVal = (e.from || "").replace(/^\+/, "");
      const toVal = (e.to || "").replace(/^\+/, "");
      if (fromVal.startsWith("client:") || toVal.startsWith("client:")) continue;
      const existing = callMap.get(e.callSid);
      if (!existing || new Date(e.createdAt) > new Date(existing.createdAt)) {
        callMap.set(e.callSid, e);
      }
    }

    // Build recording + summary map from call_recording events
    // A call can produce multiple call_recording events (processing → completed).
    // Prefer the most complete one (non-processing status, has summary, has url).
    const recordingEvents = events.filter((e) => e.type === "call_recording");
    type RecInfo = { url?: string; summary?: string; transcript?: string };
    const recordingMap = new Map<string, RecInfo>();
    for (const e of recordingEvents) {
      const sid = e.callSid;
      if (!sid) continue;
      const existing = recordingMap.get(sid);
      const summary = typeof e.payload?.summary === "string" ? e.payload.summary : (e.body || "");
      const transcript = typeof e.payload?.transcript === "string" ? e.payload.transcript : "";
      const url = e.recordingUrl || "";
      // Skip processing placeholders if we already have a completed one
      if (existing && e.status === "processing" && existing.summary) continue;
      if (!existing || (summary && !existing.summary) || (url && !existing.url) || e.status !== "processing") {
        recordingMap.set(sid, { url: url || existing?.url, summary: (e.status !== "processing" ? summary : "") || existing?.summary || summary, transcript: transcript || existing?.transcript });
      }
    }

    // Conference recording resolution: browser-initiated outbound calls use a
    // conference for hold/transfer.  The recording callback arrives with
    // payload.ConferenceSid but no callSid/from/to.  Trace through conference
    // participant events to find the customer's callSid and attach the recording.
    const confSidToName = new Map<string, string>();
    const confNameToCustomer = new Map<string, string>();
    for (const e of events) {
      if (e.type !== "call_status") continue;
      const p = e.payload;
      if (!p) continue;
      const cs = typeof p.ConferenceSid === "string" ? p.ConferenceSid : "";
      const fn = typeof p.FriendlyName === "string" ? p.FriendlyName : "";
      if (cs && fn && typeof fn === "string" && fn.startsWith("call-")) {
        confSidToName.set(cs, fn);
        if (p.ParticipantLabel === "customer" && e.callSid) {
          confNameToCustomer.set(fn, e.callSid);
        }
      }
    }
    for (const e of recordingEvents) {
      if (e.callSid) continue;
      const cs = typeof e.payload?.ConferenceSid === "string" ? e.payload.ConferenceSid : "";
      if (!cs) continue;
      const fn = confSidToName.get(cs);
      if (!fn) continue;
      const customerSid = confNameToCustomer.get(fn);
      if (!customerSid) continue;
      const summary = typeof e.payload?.summary === "string" ? e.payload.summary : (e.body || "");
      const transcript = typeof e.payload?.transcript === "string" ? e.payload.transcript : "";
      const url = e.recordingUrl || "";
      const existing = recordingMap.get(customerSid);
      if (existing && e.status === "processing" && existing.summary) continue;
      if (!existing || (summary && !existing.summary) || (url && !existing.url) || e.status !== "processing") {
        recordingMap.set(customerSid, { url: url || existing?.url, summary: (e.status !== "processing" ? summary : "") || existing?.summary || summary, transcript: transcript || existing?.transcript });
      }
    }

    // Fallback: build a phone+time index from recording events for calls whose
    // callSid doesn't appear in the recordingMap (Twilio may use a child leg
    // SID for the recording callback that differs from the parent call SID).
    const recordingByPhone = new Map<string, Array<{ time: number; url?: string; summary?: string; transcript?: string }>>();
    for (const e of recordingEvents) {
      const phone = e.direction === "inbound" ? (e.from || "") : (e.to || "");
      const normalized = phone.replace(/\D/g, "").slice(-10);
      if (!normalized) continue;
      const summary = typeof e.payload?.summary === "string" ? e.payload.summary : (e.body || "");
      const transcript = typeof e.payload?.transcript === "string" ? e.payload.transcript : "";
      const url = e.recordingUrl || "";
      if (!summary && !url) continue;
      if (!recordingByPhone.has(normalized)) recordingByPhone.set(normalized, []);
      recordingByPhone.get(normalized)!.push({ time: new Date(e.createdAt).getTime(), url, summary, transcript });
    }

    const records: CallRecord[] = [];
    for (const [, event] of callMap) {
      const phone = event.direction === "inbound" ? event.from || "" : event.to || "";
      const customer = matchCustomerByPhone(phone, phoneLookup);
      const payload = event.payload || {};
      const rawDur = payload.CallDuration ?? payload.DialCallDuration ?? payload.Duration ?? payload.duration ?? 0;
      const duration = typeof rawDur === "number" ? rawDur : Number(rawDur) || 0;

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
        continue; // skip calls with no identifiable phone number
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
        ...(() => {
          // Try direct callSid match first
          const bySid = recordingMap.get(event.callSid || "");
          if (bySid?.summary || bySid?.url) return { recordingUrl: bySid.url, summary: bySid.summary, transcript: bySid.transcript };
          // Fallback: find recording by phone + closest time (within 10 min)
          const normalized = phone.replace(/\D/g, "").slice(-10);
          const candidates = recordingByPhone.get(normalized);
          if (!candidates?.length) return { recordingUrl: bySid?.url, summary: bySid?.summary, transcript: bySid?.transcript };
          const callTime = new Date(event.createdAt).getTime();
          let best: typeof candidates[0] | undefined;
          let bestDelta = Infinity;
          for (const c of candidates) {
            const delta = Math.abs(c.time - callTime);
            if (delta < bestDelta && delta < 600_000) { bestDelta = delta; best = c; }
          }
          return { recordingUrl: best?.url || bySid?.url, summary: best?.summary || bySid?.summary, transcript: best?.transcript || bySid?.transcript };
        })(),
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

  // Open right-side New Job panel
  const openJobPanel = useCallback((phone: string, name?: string) => {
    setJobPanelPhone(phone);
    setJobPanelName(name || "");
    setJobCreated(false);
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10);
    const timeStr = today.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", timeZone: "America/Phoenix" });
    setJobForm({
      name: name || "",
      address: "",
      phone,
      source: "Phone Call",
      description: "",
      scheduleDate: dateStr,
      scheduleStartTime: timeStr,
      scheduleEndDate: dateStr,
      scheduleEndTime: `${String(Math.min(23, Number(timeStr.slice(0, 2)) + 1)).padStart(2, "0")}:${timeStr.slice(3)}`,
      assignedTo: "",
    });
    setJobPanelOpen(true);
  }, []);

  // Create job from panel form
  const handleCreateJob = useCallback(async () => {
    if (!jobForm.name.trim()) return;
    setJobCreating(true);
    try {
      const getCityFromAddr = (addr: string) => {
        const parts = addr.split(",").map((p) => p.trim()).filter(Boolean);
        return parts.length >= 2 ? parts[parts.length - 2] : "Phoenix";
      };
      const newJob: Lead = {
        id: `J-${Date.now()}`,
        name: jobForm.name,
        email: "",
        phone: jobForm.phone,
        address: jobForm.address || "Address pending",
        city: getCityFromAddr(jobForm.address),
        stage: "new_lead",
        value: 0,
        assignedTo: jobForm.assignedTo,
        roofType: "Roofing",
        source: jobForm.source || "Phone Call",
        lastActivity: jobForm.description || "New job created",
        nextAction: "Schedule inspection",
      };
      await upsertJobRecord(leadToJobRecord(newJob));
      void createManualFolder({ name: `${newJob.name} - ${newJob.address}`.trim(), address: newJob.address, customerName: newJob.name, workType: "Roofing" }).catch(() => {});
      void findOrCreateCustomer({ name: newJob.name, phone: newJob.phone, email: "", propertyAddress: newJob.address }).catch(() => {});
      if (jobForm.scheduleDate) {
        const startISO = toArizonaISO(jobForm.scheduleDate, jobForm.scheduleStartTime || undefined);
        const endTime = jobForm.scheduleEndDate && jobForm.scheduleEndTime
          ? toArizonaISO(jobForm.scheduleEndDate, jobForm.scheduleEndTime)
          : new Date(new Date(startISO).getTime() + 60 * 60 * 1000).toISOString();
        void syncJobToCalendar(newJob.id, {
          title: `Roofing — ${newJob.name}`,
          description: jobForm.description || `Roofing job for ${newJob.name}`,
          start_time: startISO,
          end_time: endTime,
          all_day: !jobForm.scheduleStartTime,
          location: newJob.address,
          color: "#f97316",
          assigned_to: jobForm.assignedTo,
          customer_name: newJob.name,
          customer_phone: newJob.phone,
          job_kind: "Roofing",
          created_by: "Office",
        }).catch(() => {});
      }
      setJobCreated(true);
      setTimeout(() => setJobPanelOpen(false), 1500);
    } catch { /* */ }
    setJobCreating(false);
  }, [jobForm]);

  // Open right-side Message panel
  const openSmsPanel = useCallback((phone: string, name?: string) => {
    setSmsPanelPhone(phone);
    setSmsPanelName(name || "");
    setSmsBody("");
    setSmsSent(false);
    setSmsPanelOpen(true);
  }, []);

  // Send SMS from panel
  const handleSendSms = useCallback(async () => {
    if (!smsBody.trim() || !smsPanelPhone) return;
    setSmsSending(true);
    try {
      const lines = getTwilioLines();
      const fromNumber = lines[0]?.number || "";
      await sendSms({ to: smsPanelPhone, body: smsBody, from: fromNumber });
      setSmsSent(true);
      setTimeout(() => setSmsPanelOpen(false), 1500);
    } catch { /* */ }
    setSmsSending(false);
  }, [smsBody, smsPanelPhone]);

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
                <p className="text-lg font-bold text-gray-800">{stats.inbound}</p>
                <p className="text-[10px] font-semibold text-gray-500">Inbound</p>
              </div>
              <div className="rounded-lg bg-white px-3 py-2 text-center shadow-sm">
                <p className="text-lg font-bold text-gray-800">{stats.outbound}</p>
                <p className="text-[10px] font-semibold text-gray-500">Outbound</p>
              </div>
            </div>

            {/* ========== Desktop stats cards ========== */}
            <div className="hidden grid-cols-6 gap-3 p-4 lg:grid lg:px-6">
              <StatCard icon={PhoneMissed} iconColor="text-red-600" iconBg="bg-red-50" label="Missed Calls" value={stats.missed} />
              <StatCard icon={PhoneIncoming} iconColor="text-gray-600" iconBg="bg-gray-100" label="Inbound Calls" value={stats.inbound} />
              <StatCard icon={PhoneOutgoing} iconColor="text-gray-600" iconBg="bg-gray-100" label="Outbound Calls" value={stats.outbound} />
              <StatCard icon={Headphones} iconColor="text-gray-600" iconBg="bg-gray-100" label="Active Calls" value={stats.activeCalls} />
              <StatCard icon={Clock} iconColor="text-gray-600" iconBg="bg-gray-100" label="Avg Duration" value={formatDurationLong(stats.avgDuration)} />
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

            {/* ========== Mobile call cards (compact, expandable) ========== */}
            <div className="divide-y divide-gray-100 lg:hidden">
              {paginatedCalls.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <PhoneOff className="h-10 w-10" />
                  <p className="mt-2 text-sm font-semibold">No calls yet</p>
                  <p className="text-xs">Start making or receiving calls.</p>
                </div>
              )}
              {paginatedCalls.map((call) => {
                const mobileExpanded = selectedCallId === call.id;
                return (
                  <div key={call.id} className="bg-white">
                    {/* Compact row */}
                    <div
                      className={`flex items-center gap-3 px-4 py-2.5 active:bg-gray-50 ${mobileExpanded ? "bg-blue-50/50" : ""}`}
                      onClick={() => setSelectedCallId(mobileExpanded ? null : call.id)}
                      role="button"
                      tabIndex={0}
                    >
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                        call.statusColor === "red" ? "bg-red-50" : "bg-gray-100"
                      }`}>
                        {call.statusColor === "red" ? (
                          <PhoneMissed className="h-4 w-4 text-red-500" />
                        ) : call.direction === "inbound" ? (
                          <ArrowDownLeft className="h-4 w-4 text-green-600" />
                        ) : (
                          <ArrowUpRight className="h-4 w-4 text-gray-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-bold text-gray-900">{call.customerName}</p>
                          {call.recordingUrl && <Headphones className="h-3 w-3 shrink-0 text-blue-500" />}
                          {call.summary && <FileText className="h-3 w-3 shrink-0 text-blue-500" />}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-gray-400">
                          <span>{call.status}</span>
                          <span>·</span>
                          <span className="flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" />{call.duration}</span>
                          <span>·</span>
                          <span>{call.dateTime}</span>
                        </div>
                      </div>
                      <ChevronRight className={`h-4 w-4 shrink-0 text-gray-300 transition-transform ${mobileExpanded ? "rotate-90" : ""}`} />
                    </div>
                    {/* Expanded detail */}
                    {mobileExpanded && (
                      <div className="border-t border-blue-100 bg-blue-50/30 px-4 py-3">
                        {/* Recording + Summary */}
                        {(call.recordingUrl || call.summary) && (
                          <div className="mb-3 space-y-2 rounded-lg bg-white p-2.5 ring-1 ring-blue-100">
                            {call.recordingUrl && <audio controls src={proxyRecordingUrl(call.recordingUrl)} className="h-8 w-full" preload="none" />}
                            {call.summary && (
                              <button
                                type="button"
                                onClick={() => { setShowTranscript(false); setExpandedSummary({ name: call.customerName, summary: call.summary!, recordingUrl: call.recordingUrl, transcript: call.transcript }); }}
                                className="flex items-center gap-1.5 text-xs font-semibold text-blue-600"
                              >
                                <FileText className="h-3.5 w-3.5" />
                                View AI Summary & Transcript
                              </button>
                            )}
                          </div>
                        )}
                        {/* Disposition */}
                        <div className="mb-3">
                          {call.disposition ? (
                            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ring-1 ${getDispositionColor(call.disposition)}`}>{call.disposition}</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setShowDispositionPicker(showDispositionPicker === call.id ? null : call.id)}
                              className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[10px] font-semibold text-gray-400"
                            >
                              + Tag
                            </button>
                          )}
                          {showDispositionPicker === call.id && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {LEAD_DISPOSITIONS.map((d) => (
                                <button key={d} type="button" onClick={() => handleDisposition(call.phone, d)} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${getDispositionColor(d)} active:opacity-70`}>
                                  {d}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        {/* Quick actions */}
                        <div className="flex items-center gap-2">
                          {call.phone && (
                            <button type="button" onClick={() => handleCallBack(call.phone)} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 active:bg-gray-50">
                              <Phone className="h-3.5 w-3.5 text-gray-500" />
                              Call
                            </button>
                          )}
                          {call.phone && (
                            <button type="button" onClick={() => openSmsPanel(call.phone, call.customerName)} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 active:bg-gray-50">
                              <MessageSquare className="h-3.5 w-3.5 text-gray-500" />
                              Message
                            </button>
                          )}
                          <button type="button" onClick={() => openJobPanel(call.phone, call.customerName)} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 active:bg-gray-50">
                            <Briefcase className="h-3.5 w-3.5 text-gray-500" />
                            Job
                          </button>
                          {call.customerId && (
                            <a href={`/crm/customers?id=${call.customerId}`} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 active:bg-gray-50">
                              <ExternalLink className="h-3.5 w-3.5 text-gray-500" />
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ========== Mobile Action Bottom Sheet ========== */}
            {actionSheetCallId && (() => {
              const sheetCall = paginatedCalls.find((c) => c.id === actionSheetCallId);
              if (!sheetCall) return null;
              return (
                <div className="fixed inset-0 z-50 lg:hidden">
                  <button type="button" className="absolute inset-0 bg-black/30" onClick={() => setActionSheetCallId(null)} />
                  <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white shadow-2xl" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" }}>
                    <div className="mx-auto my-2.5 h-1 w-10 rounded-full bg-gray-300" />
                    <div className="border-b border-gray-100 px-5 pb-3">
                      <p className="text-lg font-bold text-gray-900">{sheetCall.customerName}</p>
                      <p className="text-sm text-gray-400">{sheetCall.phone ? formatPhoneDisplay(sheetCall.phone) : ""}</p>
                    </div>
                    <div className="py-1">
                      {sheetCall.phone && (
                        <button type="button" onClick={() => { setActionSheetCallId(null); handleCallBack(sheetCall.phone); }} className="flex w-full items-center gap-4 px-5 py-4 text-left transition active:bg-gray-50">
                          <Phone className="h-5 w-5 text-gray-500" />
                          <span className="text-base font-semibold text-gray-700">Call {sheetCall.customerName}</span>
                        </button>
                      )}
                      {sheetCall.phone && (
                        <button type="button" onClick={() => { setActionSheetCallId(null); openSmsPanel(sheetCall.phone, sheetCall.customerName); }} className="flex w-full items-center gap-4 px-5 py-4 text-left transition active:bg-gray-50">
                          <MessageSquare className="h-5 w-5 text-gray-500" />
                          <span className="text-base font-semibold text-gray-700">Message {sheetCall.customerName}</span>
                        </button>
                      )}
                      <button type="button" onClick={() => { setActionSheetCallId(null); openJobPanel(sheetCall.phone, sheetCall.customerName); }} className="flex w-full items-center gap-4 px-5 py-4 text-left transition active:bg-gray-50">
                        <Briefcase className="h-5 w-5 text-gray-500" />
                        <span className="text-base font-semibold text-gray-700">New job</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ========== Desktop call history table (compact, expandable rows) ========== */}
            <div className="hidden lg:block">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="w-8 py-2 pl-4" />
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">Status</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">From</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">To</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">Time</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">Duration</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">Info</th>
                    <th className="pr-4 py-2 text-right text-[11px] font-bold uppercase tracking-wider text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {paginatedCalls.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-16 text-center">
                        <PhoneOff className="mx-auto h-10 w-10 text-gray-300" />
                        <p className="mt-2 text-sm font-semibold text-gray-400">No calls yet</p>
                        <p className="text-xs text-gray-400">Your call history is empty.</p>
                      </td>
                    </tr>
                  )}
                  {paginatedCalls.map((call) => {
                    const isExpanded = selectedCallId === call.id;
                    return (
                      <tr key={call.id} className="group">
                        <td colSpan={8} className="p-0">
                          {/* Compact row */}
                          <div
                            onClick={() => setSelectedCallId(isExpanded ? null : call.id)}
                            className={`flex cursor-pointer items-center gap-0 transition hover:bg-blue-50/50 ${isExpanded ? "bg-blue-50/60" : ""}`}
                          >
                            <div className="flex w-8 shrink-0 items-center justify-center pl-4">
                              <ChevronRight className={`h-3.5 w-3.5 text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                            </div>
                            <div className="flex min-w-[90px] items-center gap-1.5 px-3 py-2.5">
                              <StatusDot color={call.statusColor} />
                              <span className="text-xs font-semibold text-gray-800">{call.status}</span>
                            </div>
                            <div className="flex min-w-[180px] flex-1 items-center gap-2 px-3 py-2.5">
                              {call.statusColor === "red" ? (
                                <PhoneMissed className="h-3.5 w-3.5 shrink-0 text-red-500" />
                              ) : call.direction === "inbound" ? (
                                <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-green-500" />
                              ) : (
                                <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                              )}
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-gray-900">{call.customerName}</p>
                                <p className="truncate text-[11px] text-gray-400">{call.from ? formatPhoneDisplay(call.from) : "-"}</p>
                              </div>
                            </div>
                            <div className="min-w-[120px] px-3 py-2.5">
                              <p className="text-xs text-gray-600">{call.to ? formatPhoneDisplay(call.to) : "-"}</p>
                            </div>
                            <div className="min-w-[130px] px-3 py-2.5">
                              <p className="text-xs text-gray-600">{call.dateTime}</p>
                            </div>
                            <div className="min-w-[70px] px-3 py-2.5">
                              <div className="flex items-center gap-1 text-xs text-gray-600">
                                <Clock className="h-3 w-3 text-gray-400" />
                                {call.duration}
                              </div>
                            </div>
                            <div className="flex min-w-[80px] items-center gap-1.5 px-3 py-2.5">
                              {call.recordingUrl && <span title="Recording available"><Headphones className="h-3 w-3 text-blue-500" /></span>}
                              {call.summary && <span title="AI Summary available"><FileText className="h-3 w-3 text-blue-500" /></span>}
                              {call.disposition && (
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${getDispositionColor(call.disposition)}`}>
                                  {call.disposition}
                                </span>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center justify-end gap-1 pr-4 py-2.5">
                              {call.phone && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleCallBack(call.phone); }}
                                  title="Call Back"
                                  className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                                >
                                  <Phone className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {call.phone && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); openSmsPanel(call.phone, call.customerName); }}
                                  title="Message"
                                  className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                                >
                                  <MessageSquare className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {call.customerId && (
                                <a
                                  href={`/crm/customers?id=${call.customerId}`}
                                  onClick={(e) => e.stopPropagation()}
                                  title="View Customer"
                                  className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}
                            </div>
                          </div>
                          {/* Expanded detail panel (inline) */}
                          {isExpanded && (
                            <div className="border-t border-blue-100 bg-blue-50/40 px-6 py-3">
                              <div className="flex flex-wrap items-start gap-5">
                                {/* Recording + Summary */}
                                {(call.recordingUrl || call.summary) && (
                                  <div className="min-w-[260px] max-w-sm space-y-2">
                                    {call.recordingUrl && (
                                      <div>
                                        <p className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-gray-500"><Headphones className="h-3 w-3" />Recording</p>
                                        <audio controls src={proxyRecordingUrl(call.recordingUrl)} className="h-8 w-full" preload="none" />
                                      </div>
                                    )}
                                    {call.summary && (
                                      <button
                                        type="button"
                                        onClick={() => { setShowTranscript(false); setExpandedSummary({ name: call.customerName, summary: call.summary!, recordingUrl: call.recordingUrl, transcript: call.transcript }); }}
                                        className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                                      >
                                        <FileText className="h-3.5 w-3.5" />
                                        View AI Summary & Transcript
                                      </button>
                                    )}
                                  </div>
                                )}
                                {/* Details */}
                                <div className="flex flex-wrap items-start gap-4">
                                  <div>
                                    <p className="text-[10px] font-bold uppercase text-gray-400">Direction</p>
                                    <p className="text-xs font-semibold text-gray-800">{call.direction === "inbound" ? "Inbound" : "Outbound"}</p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-bold uppercase text-gray-400">Line</p>
                                    <p className="text-xs font-semibold text-gray-800">{call.twilioLine || "-"}</p>
                                  </div>
                                  {call.tag && (
                                    <div>
                                      <p className="text-[10px] font-bold uppercase text-gray-400">Tag</p>
                                      <p className="text-xs font-semibold text-gray-800">{call.tag}</p>
                                    </div>
                                  )}
                                </div>
                                {/* Disposition */}
                                <div>
                                  <p className="text-[10px] font-bold uppercase text-gray-400">Disposition</p>
                                  <div className="relative mt-0.5">
                                    {call.disposition ? (
                                      <button
                                        type="button"
                                        onClick={() => setShowDispositionPicker(showDispositionPicker === call.id ? null : call.id)}
                                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${getDispositionColor(call.disposition)}`}
                                      >
                                        {call.disposition}
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => setShowDispositionPicker(showDispositionPicker === call.id ? null : call.id)}
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
                                {/* Quick actions */}
                                <div className="ml-auto flex items-center gap-2">
                                  {call.phone && (
                                    <button type="button" onClick={() => handleCallBack(call.phone)} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50">
                                      <Phone className="h-3.5 w-3.5 text-gray-500" />
                                      Call
                                    </button>
                                  )}
                                  {call.phone && (
                                    <button type="button" onClick={() => openSmsPanel(call.phone, call.customerName)} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50">
                                      <MessageSquare className="h-3.5 w-3.5 text-gray-500" />
                                      Message
                                    </button>
                                  )}
                                  <button type="button" onClick={() => openJobPanel(call.phone, call.customerName)} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50">
                                    <Briefcase className="h-3.5 w-3.5 text-gray-500" />
                                    New Job
                                  </button>
                                  {call.customerId && (
                                    <a href={`/crm/customers?id=${call.customerId}`} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50">
                                      <ExternalLink className="h-3.5 w-3.5 text-gray-500" />
                                      Customer
                                    </a>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
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

      {/* ---- Right-side New Job Panel ---- */}
      {jobPanelOpen && (
        <>
          <button type="button" className="fixed inset-0 z-40 bg-black/20" onClick={() => setJobPanelOpen(false)} />
          <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" }}>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-200 bg-blue-600 px-5 py-4">
              <div className="flex items-center gap-3">
                <Briefcase className="h-5 w-5 text-white" />
                <div>
                  <h2 className="text-base font-bold text-white">New Job</h2>
                  <p className="text-xs text-blue-100">{jobPanelName ? jobPanelName : "From call"} &middot; {jobPanelPhone ? formatPhoneDisplay(jobPanelPhone) : ""}</p>
                </div>
              </div>
              <button type="button" onClick={() => setJobPanelOpen(false)} className="rounded-lg p-1.5 text-white/70 hover:bg-blue-700 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Success */}
            {jobCreated ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
                  <Briefcase className="h-7 w-7 text-green-600" />
                </div>
                <p className="text-lg font-bold text-gray-900">Job Created</p>
                <p className="text-sm text-gray-500">Added to dashboard and calendar.</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {/* Name */}
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-600"><User className="h-3.5 w-3.5" /> Customer Name</label>
                  <input type="text" value={jobForm.name} onChange={(e) => setJobForm((p) => ({ ...p, name: e.target.value }))} placeholder="Enter customer name" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>

                {/* Address */}
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-600"><Hash className="h-3.5 w-3.5" /> Address</label>
                  <AddressAutocomplete value={jobForm.address} onChange={(val) => setJobForm((p) => ({ ...p, address: val }))} placeholder="Search address..." className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>

                {/* Phone */}
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-600"><Phone className="h-3.5 w-3.5" /> Phone</label>
                  <input type="tel" value={jobForm.phone} onChange={(e) => setJobForm((p) => ({ ...p, phone: e.target.value }))} className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm" readOnly />
                </div>

                {/* Ad Source */}
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-600"><BarChart3 className="h-3.5 w-3.5" /> Ad Source</label>
                  <select value={jobForm.source} onChange={(e) => setJobForm((p) => ({ ...p, source: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
                    <option>Phone Call</option>
                    <option>Google</option>
                    <option>Yelp</option>
                    <option>Referral</option>
                    <option>Social Media</option>
                    <option>Home Advisor</option>
                    <option>Angi</option>
                    <option>Door Knock</option>
                    <option>Storm Chase</option>
                    <option>Other</option>
                  </select>
                </div>

                {/* Description */}
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-600"><MessageSquare className="h-3.5 w-3.5" /> Job Description</label>
                  <textarea value={jobForm.description} onChange={(e) => setJobForm((p) => ({ ...p, description: e.target.value }))} placeholder="Describe the job..." rows={3} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>

                {/* Schedule */}
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3">
                  <p className="flex items-center gap-1.5 text-xs font-bold text-gray-700"><CalendarDays className="h-3.5 w-3.5" /> Schedule</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-0.5 text-[11px] font-semibold text-gray-500">Start Date</label>
                      <input type="date" value={jobForm.scheduleDate} onChange={(e) => setJobForm((p) => ({ ...p, scheduleDate: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="mb-0.5 text-[11px] font-semibold text-gray-500">Start Time</label>
                      <input type="time" value={jobForm.scheduleStartTime} onChange={(e) => setJobForm((p) => ({ ...p, scheduleStartTime: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="mb-0.5 text-[11px] font-semibold text-gray-500">End Date</label>
                      <input type="date" value={jobForm.scheduleEndDate} onChange={(e) => setJobForm((p) => ({ ...p, scheduleEndDate: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="mb-0.5 text-[11px] font-semibold text-gray-500">End Time</label>
                      <input type="time" value={jobForm.scheduleEndTime} onChange={(e) => setJobForm((p) => ({ ...p, scheduleEndTime: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none" />
                    </div>
                  </div>
                </div>

                {/* Assigned To */}
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-600"><Users className="h-3.5 w-3.5" /> Assign Team Members</label>
                  <input type="text" value={jobForm.assignedTo} onChange={(e) => setJobForm((p) => ({ ...p, assignedTo: e.target.value }))} placeholder="e.g. Oscar, Team A" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
              </div>
            )}

            {/* Footer */}
            {!jobCreated && (
              <div className="border-t border-gray-200 px-5 py-4">
                <button type="button" onClick={handleCreateJob} disabled={jobCreating || !jobForm.name.trim()} className="w-full rounded-lg bg-yellow-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-yellow-600 disabled:opacity-50">
                  {jobCreating ? "Creating..." : "Create Job"}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* ---- Right-side Message Panel ---- */}
      {smsPanelOpen && (
        <>
          <button type="button" className="fixed inset-0 z-40 bg-black/20" onClick={() => setSmsPanelOpen(false)} />
          <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" }}>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-200 bg-gray-800 px-5 py-4">
              <div className="flex items-center gap-3">
                <MessageSquare className="h-5 w-5 text-white" />
                <div>
                  <h2 className="text-base font-bold text-white">Message</h2>
                  <p className="text-xs text-gray-300">{smsPanelName ? smsPanelName : "Send SMS"} &middot; {smsPanelPhone ? formatPhoneDisplay(smsPanelPhone) : ""}</p>
                </div>
              </div>
              <button type="button" onClick={() => setSmsPanelOpen(false)} className="rounded-lg p-1.5 text-white/70 hover:bg-gray-700 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Success */}
            {smsSent ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
                  <MessageSquare className="h-7 w-7 text-green-600" />
                </div>
                <p className="text-lg font-bold text-gray-900">Message Sent</p>
                <p className="text-sm text-gray-500">SMS delivered to {smsPanelName || formatPhoneDisplay(smsPanelPhone)}</p>
              </div>
            ) : (
              <div className="flex flex-1 flex-col px-5 py-4">
                {/* To */}
                <div className="mb-4">
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-600"><Phone className="h-3.5 w-3.5" /> To</label>
                  <div className="flex items-center gap-2 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2">
                    <span className="text-sm font-semibold text-gray-700">{smsPanelName || "Unknown"}</span>
                    <span className="text-sm text-gray-400">{formatPhoneDisplay(smsPanelPhone)}</span>
                  </div>
                </div>

                {/* Message body */}
                <div className="flex-1">
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-600"><MessageSquare className="h-3.5 w-3.5" /> Message</label>
                  <textarea
                    value={smsBody}
                    onChange={(e) => setSmsBody(e.target.value)}
                    placeholder="Type your message..."
                    rows={6}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    autoFocus
                  />
                  <p className="mt-1 text-right text-[11px] text-gray-400">{smsBody.length} characters</p>
                </div>
              </div>
            )}

            {/* Footer */}
            {!smsSent && (
              <div className="border-t border-gray-200 px-5 py-4">
                <button type="button" onClick={handleSendSms} disabled={smsSending || !smsBody.trim()} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50">
                  {smsSending ? "Sending..." : "Send Message"}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* ========== Expanded AI Summary Modal ========== */}
      {expandedSummary && (
        <>
          <div className="fixed inset-0 z-[90] bg-black/40" onClick={() => setExpandedSummary(null)} />
          <div className="fixed inset-x-4 top-[10%] z-[91] mx-auto max-w-lg rounded-xl border border-gray-200 bg-white shadow-2xl sm:inset-x-auto sm:w-full">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50">
                  <FileText className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">AI Call Summary</h3>
                  <p className="text-xs text-gray-500">{expandedSummary.name}</p>
                </div>
              </div>
              <button type="button" onClick={() => setExpandedSummary(null)} className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
              {expandedSummary.recordingUrl && (
                <div className="mb-4">
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500"><Mic className="h-3 w-3" />Recording</p>
                  <audio controls src={proxyRecordingUrl(expandedSummary.recordingUrl)} className="w-full" preload="none" />
                </div>
              )}
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-blue-700"><FileText className="h-3 w-3" />Summary</p>
                <p className="whitespace-pre-wrap text-sm leading-6 text-gray-800">{expandedSummary.summary}</p>
              </div>
              {expandedSummary.transcript && (
                <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50">
                  <button type="button" onClick={() => setShowTranscript((v) => !v)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-gray-600">
                    Full Transcript
                    <ChevronDown className={`h-4 w-4 transition ${showTranscript ? "rotate-180" : ""}`} />
                  </button>
                  {showTranscript && <p className="whitespace-pre-wrap break-words px-3 pb-3 text-sm leading-6 text-gray-800">{expandedSummary.transcript}</p>}
                </div>
              )}
            </div>
          </div>
        </>
      )}
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
