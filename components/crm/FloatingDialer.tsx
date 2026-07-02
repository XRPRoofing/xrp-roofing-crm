"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Briefcase,
  CalendarDays,
  ChevronDown,
  GripVertical,
  Hash,
  MessageSquare,
  Mic,
  MicOff,
  Minus,
  MoreVertical,
  Pause,
  Phone,
  PhoneCall,
  PhoneForwarded,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  PhoneOutgoing,
  Play,
  Search,
  User,
  Users,
  Volume2,
  X,
  Clock,
  Maximize2,
} from "lucide-react";
import type { BrowserVoiceCall, BrowserVoiceDevice } from "@/lib/twilio/client";
import { createBrowserVoiceDevice, controlCall, listConversationEvents } from "@/lib/twilio/client";
import { getTwilioCallOutcomeLabel } from "@/lib/twilio/notifications";
import type { Customer, Lead } from "@/types/crm";
import { logCrewActivity } from "@/lib/crew-activity";
import { leadToJobRecord, upsertJobRecord } from "@/lib/crew-sync";
import { syncJobToCalendar, toArizonaISO } from "@/lib/calendar-sync";
import { findOrCreateCustomer } from "@/lib/customer-sync";
import { createManualFolder } from "@/lib/manual-folders";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { sendSms } from "@/lib/twilio/client";
import { getTwilioLines } from "@/lib/twilio/numbers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = "recents" | "contacts" | "keypad" | "queue";
type CallState = "idle" | "connecting" | "active" | "held" | "forwarding";
type ForwardingStatus = "forwarding" | "ringing" | "connected" | "no-answer" | "busy" | "failed" | "ended";

interface PhoneNumber {
  label: string;
  number: string;
}

interface RecentCall {
  id: string;
  phone: string;
  name?: string;
  direction: "inbound" | "outbound";
  outcome?: string;
  time: string;
  duration?: number;
}

interface MissedCall {
  id: string;
  phone: string;
  name?: string;
  time: string;
}

interface FloatingDialerProps {
  open: boolean;
  onClose: () => void;
  voiceDeviceRef: React.RefObject<BrowserVoiceDevice | null>;
  phoneNumbers: PhoneNumber[];
  customers: Customer[];
  onCallStateChange?: (active: boolean) => void;
  onCallEnd?: (callSid: string) => void;
  initialDialNumber?: string;
  initialCallerId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatCallTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatCallDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000 && d.getDate() === now.getDate()) return "Today";
  if (diff < 172800000) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FloatingDialer({
  open,
  onClose,
  voiceDeviceRef,
  phoneNumbers,
  customers,
  onCallStateChange,
  onCallEnd,
  initialDialNumber,
  initialCallerId,
}: FloatingDialerProps) {
  // Position state for dragging
  const [position, setPosition] = useState({ x: -1, y: -1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Minimized state
  const [minimized, setMinimized] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>("keypad");

  // Dialer state
  const [dialNumber, setDialNumber] = useState("");
  const [selectedCallerId, setSelectedCallerId] = useState(phoneNumbers[0]?.number || "");
  const [callerIdOpen, setCallerIdOpen] = useState(false);

  // Call state
  const [callState, setCallState] = useState<CallState>("idle");
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [callSid, setCallSid] = useState<string | undefined>();
  const browserCallRef = useRef<BrowserVoiceCall | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Transfer state
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferNumber, setTransferNumber] = useState("");

  // Forwarding status tracking
  const [forwardingStatus, setForwardingStatus] = useState<ForwardingStatus | null>(null);
  const [forwardingDest, setForwardingDest] = useState("");
  const forwardingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // In-call DTMF keypad
  const [showInCallKeypad, setShowInCallKeypad] = useState(false);

  // Recents
  const [recents, setRecents] = useState<RecentCall[]>([]);
  const [recentsLoading, setRecentsLoading] = useState(false);

  // Missed calls
  const [missedCalls, setMissedCalls] = useState<MissedCall[]>([]);
  const [missedLoading, setMissedLoading] = useState(false);

  // Recents filter (All / Missed)
  const [recentsFilter, setRecentsFilter] = useState<"all" | "missed">("all");
  const missedCount = useMemo(() => recents.filter((c) => c.outcome === "Missed call").length, [recents]);

  // Action menu for call items
  const [actionMenuCallId, setActionMenuCallId] = useState<string | null>(null);

  // SMS modal
  const [smsTarget, setSmsTarget] = useState<{ phone: string; name?: string } | null>(null);
  const [smsBody, setSmsBody] = useState("");
  const [smsSending, setSmsSending] = useState(false);
  const [smsSent, setSmsSent] = useState(false);

  // New Job form
  const [showNewJobForm, setShowNewJobForm] = useState(false);
  const [newJobPhone, setNewJobPhone] = useState("");
  const [newJobName, setNewJobName] = useState("");
  const [newJobForm, setNewJobForm] = useState({
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

  // Contact search
  const [contactSearch, setContactSearch] = useState("");

  // Initialize position on first open
  useEffect(() => {
    if (open && position.x === -1) {
      const x = window.innerWidth - 390;
      const y = Math.max(16, window.innerHeight - 620);
      setPosition({ x: Math.max(16, x), y: Math.max(16, y) }); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [open, position.x]);

  // Duration timer
  useEffect(() => {
    if (callState === "active") {
      durationIntervalRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
    } else if (callState === "idle") {
      setCallDuration(0); // eslint-disable-line react-hooks/set-state-in-effect
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
    }
    return () => {
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
    };
  }, [callState]);

  // Notify parent of call state changes
  useEffect(() => {
    onCallStateChange?.(callState !== "idle");
  }, [callState, onCallStateChange]);

  // Listen for custom events from Phone page to open SMS / New Job panels
  useEffect(() => {
    function handleOpenSms(e: Event) {
      const detail = (e as CustomEvent).detail as { phone: string; name?: string } | undefined;
      if (detail?.phone) {
        if (!open) window.dispatchEvent(new CustomEvent("crm:open-dialer"));
        setTimeout(() => openSmsPanel(detail.phone, detail.name), 100);
      }
    }
    function handleOpenNewJob(e: Event) {
      const detail = (e as CustomEvent).detail as { phone: string; name?: string } | undefined;
      if (detail?.phone) {
        if (!open) window.dispatchEvent(new CustomEvent("crm:open-dialer"));
        setTimeout(() => openNewJobForm(detail.phone, detail.name), 100);
      }
    }
    window.addEventListener("crm:open-sms", handleOpenSms);
    window.addEventListener("crm:open-new-job", handleOpenNewJob);
    return () => {
      window.removeEventListener("crm:open-sms", handleOpenSms);
      window.removeEventListener("crm:open-new-job", handleOpenNewJob);
    };
  }); // intentionally no deps — always latest closures

  // Apply initial dial number / caller ID when provided
  useEffect(() => {
    if (open && initialDialNumber) {
      setDialNumber(initialDialNumber); // eslint-disable-line react-hooks/set-state-in-effect
      setActiveTab("keypad"); // eslint-disable-line react-hooks/set-state-in-effect
    }
    if (open && initialCallerId) {
      setSelectedCallerId(initialCallerId); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [open, initialDialNumber, initialCallerId]);

  // Build phone→name lookup
  const phoneLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers) {
      const digits = c.phone?.replace(/\D/g, "");
      if (digits) map.set(digits, c.name);
    }
    return map;
  }, [customers]);

  const findContactName = useCallback((phone: string): string | undefined => {
    return phoneLookup.get(phone.replace(/\D/g, ""));
  }, [phoneLookup]);

  // Pre-fetch recents + missed
  const prefetchedRef = useRef(false);
  useEffect(() => {
    if (!open || prefetchedRef.current) return;
    prefetchedRef.current = true;
    setRecentsLoading(true);
    setMissedLoading(true);
    listConversationEvents(200)
      .then((events) => {
        const seen = new Set<string>();
        const recent: RecentCall[] = [];
        const missed: MissedCall[] = [];
        for (const ev of events) {
          if (recent.length < 30 && (ev.type === "incoming_call" || (ev.type === "call_status" && ev.direction))) {
            const phone = ev.direction === "inbound" ? ev.from : ev.to;
            if (phone && !seen.has(phone)) {
              seen.add(phone);
              const outcome = getTwilioCallOutcomeLabel(ev);
              recent.push({
                id: ev.id,
                phone,
                name: findContactName(phone),
                direction: ev.direction || "inbound",
                outcome: outcome || undefined,
                time: ev.createdAt,
                duration: (() => { const d = ev.payload?.CallDuration ?? ev.payload?.DialCallDuration ?? ev.payload?.Duration ?? ev.payload?.duration; return d != null ? (typeof d === "number" ? d : Number(d) || 0) : undefined; })(),
              });
            }
          }
          if (missed.length < 50 && getTwilioCallOutcomeLabel(ev) === "Missed call") {
            const phone = ev.from || ev.to || "";
            if (phone) missed.push({ id: ev.id, phone, name: findContactName(phone), time: ev.createdAt });
          }
        }
        setRecents(recent);
        setMissedCalls(missed);
      })
      .catch(() => {})
      .finally(() => { setRecentsLoading(false); setMissedLoading(false); });
  }, [open, findContactName]);

  // -------------------------------------------------------------------------
  // Drag handlers
  // -------------------------------------------------------------------------

  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    dragOffset.current = {
      x: clientX - position.x,
      y: clientY - position.y,
    };
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;
    function handleMove(e: MouseEvent | TouchEvent) {
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 300, clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 100, clientY - dragOffset.current.y)),
      });
    }
    function handleEnd() { setIsDragging(false); }
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleEnd);
    window.addEventListener("touchmove", handleMove);
    window.addEventListener("touchend", handleEnd);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleEnd);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleEnd);
    };
  }, [isDragging]);

  // -------------------------------------------------------------------------
  // Call actions (unchanged logic)
  // -------------------------------------------------------------------------

  async function handleStartCall(numberOverride?: string) {
    const destination = numberOverride || dialNumber.trim();
    if (!destination) return;
    try {
      setCallState("connecting");
      setMinimized(false);
      const device = voiceDeviceRef.current || await createBrowserVoiceDevice("crm-agent");
      if (!voiceDeviceRef.current) {
        (voiceDeviceRef as React.MutableRefObject<BrowserVoiceDevice | null>).current = device;
      }
      const connectParams: Record<string, string> = { To: destination };
      if (selectedCallerId) connectParams.CallerId = selectedCallerId;
      const call = await device.connect({ params: connectParams });
      browserCallRef.current = call as unknown as BrowserVoiceCall;
      setCallState("active");
      setIsMuted(false);
      const destDigits = destination.replace(/\D/g, "");
      const matchedCustomer = customers.find((c) => c.phone?.replace(/\D/g, "") === destDigits);
      void logCrewActivity({
        jobId: matchedCustomer?.id || "",
        jobName: matchedCustomer?.name || destination,
        actor: "Office",
        action: "Outbound call placed",
        details: `Called ${destination}${selectedCallerId ? ` from ${selectedCallerId}` : ""}`,
        module: "Calls",
      });
      const existingSid = (call as unknown as BrowserVoiceCall).parameters?.CallSid;
      if (existingSid) setCallSid(existingSid);
      call.on("accept", () => {
        const sid = (call as unknown as BrowserVoiceCall).parameters?.CallSid;
        if (sid) setCallSid(sid);
      });
      call.on("disconnect", () => {
        const endedSid = callSid || (call as unknown as BrowserVoiceCall).parameters?.CallSid;
        setCallState("idle");
        setCallSid(undefined);
        browserCallRef.current = null;
        setShowTransfer(false);
        setShowInCallKeypad(false);
        if (endedSid) onCallEnd?.(endedSid);
      });
      call.on("error", () => {
        setCallState("idle");
        browserCallRef.current = null;
      });
    } catch {
      setCallState("idle");
    }
  }

  function handleEndCall() {
    const endedSid = callSid;
    browserCallRef.current?.disconnect();
    browserCallRef.current = null;
    setCallState("idle");
    setCallSid(undefined);
    setIsMuted(false);
    setShowTransfer(false);
    setShowInCallKeypad(false);
    if (endedSid) onCallEnd?.(endedSid);
  }

  function handleMute() {
    if (!browserCallRef.current) return;
    browserCallRef.current.mute?.(!isMuted);
    setIsMuted((v) => !v);
  }

  async function handleHold() {
    if (!callSid) return;
    const action = callState === "held" ? "resume" : "hold";
    try {
      await controlCall({ callSid, action });
      setCallState(callState === "held" ? "active" : "held");
    } catch { /* */ }
  }

  function clearForwardingState() {
    setForwardingStatus(null);
    setForwardingDest("");
    setCallState("idle");
    setCallSid(undefined);
    browserCallRef.current = null;
    if (forwardingTimerRef.current) clearTimeout(forwardingTimerRef.current);
  }

  async function handleTransfer() {
    if (!callSid || !transferNumber.trim()) return;
    const dest = transferNumber.trim();
    try {
      setForwardingDest(dest);
      setForwardingStatus("forwarding");
      setCallState("forwarding");
      setShowTransfer(false);
      setShowInCallKeypad(false);
      await controlCall({ callSid, action: "forward", forwardTo: dest });
      setForwardingStatus("ringing");
      void logCrewActivity({ jobId: "", jobName: dialNumber || dest, actor: "Office", action: "Call forwarded", details: `Forwarded to ${dest}`, module: "Calls" }).catch(() => {});
      forwardingTimerRef.current = setTimeout(() => {
        setForwardingStatus("connected");
        forwardingTimerRef.current = setTimeout(() => clearForwardingState(), 4000);
      }, 3000);
      setTransferNumber("");
      browserCallRef.current = null;
    } catch {
      setForwardingStatus("failed");
      forwardingTimerRef.current = setTimeout(() => clearForwardingState(), 3000);
    }
  }

  function handleSendDtmf(digit: string) {
    if (!browserCallRef.current) return;
    const call = browserCallRef.current as unknown as { sendDigits?: (digits: string) => void };
    call.sendDigits?.(digit);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // ── Open action menu for a recent call ──
  function openActionMenu(callId: string) {
    setActionMenuCallId(actionMenuCallId === callId ? null : callId);
  }

  // ── Open SMS panel for a phone number ──
  function openSmsPanel(phone: string, name?: string) {
    setActionMenuCallId(null);
    setSmsTarget({ phone, name });
    setSmsBody("");
    setSmsSent(false);
  }

  // ── Send SMS ──
  async function handleSendSms() {
    if (!smsTarget || !smsBody.trim()) return;
    setSmsSending(true);
    try {
      const lines = getTwilioLines();
      await sendSms({ to: smsTarget.phone, body: smsBody.trim(), from: lines[0]?.number || selectedCallerId });
      setSmsSent(true);
      setTimeout(() => setSmsTarget(null), 1500);
    } catch { /* */ }
    setSmsSending(false);
  }

  // ── Open New Job form pre-filled with call info ──
  function openNewJobForm(phone: string, name?: string) {
    setActionMenuCallId(null);
    setNewJobPhone(phone);
    setNewJobName(name || "");
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10);
    const timeStr = today.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", timeZone: "America/Phoenix" });
    setNewJobForm({
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
    setShowNewJobForm(true);
  }

  // ── Create job from inline form ──
  async function handleCreateJob() {
    if (!newJobForm.name.trim()) return;
    setJobCreating(true);
    try {
      const getCityFromAddr = (addr: string) => {
        const parts = addr.split(",").map((p) => p.trim()).filter(Boolean);
        return parts.length >= 2 ? parts[parts.length - 2] : "Phoenix";
      };

      const newJob: Lead = {
        id: `J-${Date.now()}`,
        name: newJobForm.name,
        email: "",
        phone: newJobForm.phone,
        address: newJobForm.address || "Address pending",
        city: getCityFromAddr(newJobForm.address),
        stage: "new_lead",
        value: 0,
        assignedTo: newJobForm.assignedTo,
        roofType: "Roofing",
        source: newJobForm.source || "Phone Call",
        lastActivity: newJobForm.description || "New job created",
        nextAction: "Schedule inspection",
      };

      await upsertJobRecord(leadToJobRecord(newJob));

      void logCrewActivity({
        jobId: newJob.id,
        jobName: newJob.name,
        actor: "Office",
        action: "Job created",
        details: `${newJob.address}, ${newJob.city} — from phone`,
        module: "Jobs",
      }).catch(() => {});

      void createManualFolder({
        name: `${newJob.name} - ${newJob.address}`.trim(),
        address: newJob.address,
        customerName: newJob.name,
        workType: "Roofing",
      }).catch(() => {});

      void findOrCreateCustomer({
        name: newJob.name,
        phone: newJob.phone,
        email: "",
        propertyAddress: newJob.address,
      }).catch(() => {});

      if (newJobForm.scheduleDate) {
        const startISO = toArizonaISO(newJobForm.scheduleDate, newJobForm.scheduleStartTime || undefined);
        const endTime = newJobForm.scheduleEndDate && newJobForm.scheduleEndTime
          ? toArizonaISO(newJobForm.scheduleEndDate, newJobForm.scheduleEndTime)
          : new Date(new Date(startISO).getTime() + 60 * 60 * 1000).toISOString();
        void syncJobToCalendar(newJob.id, {
          title: `Roofing — ${newJob.name}`,
          description: newJobForm.description || `Roofing job for ${newJob.name}`,
          start_time: startISO,
          end_time: endTime,
          all_day: !newJobForm.scheduleStartTime,
          location: newJob.address,
          color: "#f97316",
          assigned_to: newJobForm.assignedTo,
          customer_name: newJob.name,
          customer_phone: newJob.phone,
          job_kind: "Roofing",
          created_by: "Office",
        }).catch(() => {});
      }

      setShowNewJobForm(false);
    } catch { /* */ }
    setJobCreating(false);
  }

  if (!open) return null;

  const isInCall = callState !== "idle";
  const currentLine = phoneNumbers.find((p) => p.number === selectedCallerId) || phoneNumbers[0];
  const callerName = findContactName(dialNumber) || "";

  // Filtered contacts
  const filteredContacts = contactSearch.trim()
    ? customers.filter((c) => c.phone && (c.name.toLowerCase().includes(contactSearch.toLowerCase()) || c.phone.includes(contactSearch)))
    : customers.filter((c) => c.phone);

  // ── Minimized pill ──
  if (minimized && !isInCall) {
    return (
      <div
        ref={containerRef}
        className="fixed z-[9999] flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2.5 shadow-xl"
        style={{ left: position.x, top: position.y, cursor: isDragging ? "grabbing" : undefined }}
      >
        <div
          className="flex cursor-grab items-center gap-2"
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500">
            <Phone className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-bold text-gray-800">Phone</span>
        </div>
        <button type="button" onClick={() => setMinimized(false)} className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
          <Maximize2 className="h-4 w-4" />
        </button>
        <button type="button" onClick={onClose} className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-red-500">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // ── Active call minimized pill ──
  if (minimized && isInCall) {
    return (
      <div
        ref={containerRef}
        className="fixed z-[9999] flex items-center gap-3 rounded-full border border-blue-200 bg-blue-50 px-4 py-2.5 shadow-xl"
        style={{ left: position.x, top: position.y, cursor: isDragging ? "grabbing" : undefined }}
      >
        <div
          className="flex cursor-grab items-center gap-2"
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
        >
          <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-blue-500">
            <PhoneCall className="h-4 w-4 text-white" />
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-ping rounded-full bg-blue-400" />
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-blue-500" />
          </div>
          <div>
            <p className="text-xs font-bold text-blue-800">{callerName || formatPhone(dialNumber)}</p>
            <p className="text-[10px] font-semibold text-blue-600">
              {callState === "held" ? "On Hold" : callState === "connecting" ? "Connecting..." : formatDuration(callDuration)}
            </p>
          </div>
        </div>
        <button type="button" onClick={() => setMinimized(false)} className="rounded-full p-1.5 text-blue-600 hover:bg-blue-100">
          <Maximize2 className="h-4 w-4" />
        </button>
        <button type="button" onClick={handleEndCall} className="rounded-full bg-red-500 p-1.5 text-white hover:bg-red-600">
          <PhoneOff className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="fixed z-[9999] flex w-[300px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
      style={{
        left: position.x,
        top: position.y,
        maxHeight: "480px",
        cursor: isDragging ? "grabbing" : undefined,
      }}
    >
      {/* ══════════ Header ══════════ */}
      <div
        className="flex items-center justify-between bg-gradient-to-b from-gray-50 to-white px-3 pb-1.5 pt-2 select-none"
        onMouseDown={handleDragStart}
        onTouchStart={handleDragStart}
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
      >
        <div className="flex items-center gap-2.5">
          <GripVertical className="h-3.5 w-3.5 text-gray-300" />
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600 shadow-sm">
            {callerName ? (
              <span className="text-sm font-bold text-white">{callerName.charAt(0).toUpperCase()}</span>
            ) : (
              <Phone className="h-4 w-4 text-white" />
            )}
          </div>
        </div>

        {/* Active number selector */}
        <div className="relative">
          <button
            type="button"
            onClick={() => !isInCall && setCallerIdOpen((v) => !v)}
            className="flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-xs transition hover:bg-gray-100"
          >
            <span className="font-semibold text-gray-800 text-xs">
              {currentLine ? formatPhone(currentLine.number) : "No Line"}
            </span>
            {!isInCall && <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition ${callerIdOpen ? "rotate-180" : ""}`} />}
          </button>
          {callerIdOpen && !isInCall && (
            <>
              <button type="button" className="fixed inset-0 z-10" onClick={() => setCallerIdOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 w-64 rounded-xl border border-gray-200 bg-white py-1.5 shadow-xl">
                {phoneNumbers.map((pn) => (
                  <button
                    key={pn.number}
                    type="button"
                    onClick={() => { setSelectedCallerId(pn.number); setCallerIdOpen(false); }}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-gray-50 ${selectedCallerId === pn.number ? "bg-blue-50" : ""}`}
                  >
                    <span className={`h-2 w-2 rounded-full ${selectedCallerId === pn.number ? "bg-blue-500" : "bg-gray-300"}`} />
                    <div>
                      <p className={`text-sm font-semibold ${selectedCallerId === pn.number ? "text-blue-700" : "text-gray-700"}`}>{pn.label}</p>
                      <p className="text-xs text-gray-400">{formatPhone(pn.number)}</p>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Window controls */}
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setMinimized(true)} className="rounded-full p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600">
            <Minus className="h-4 w-4" />
          </button>
          {!isInCall && (
            <button type="button" onClick={onClose} className="rounded-full p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-red-500">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* ══════════ Active Call Screen ══════════ */}
      {isInCall && callState !== "forwarding" && (
        <div className="flex flex-col items-center bg-gradient-to-b from-white to-gray-50 px-6 pb-5 pt-4">
          {/* Caller avatar */}
          <div className="relative mb-3">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600 shadow-lg">
              {callerName ? (
                <span className="text-2xl font-bold text-white">{callerName.charAt(0).toUpperCase()}</span>
              ) : (
                <User className="h-8 w-8 text-white" />
              )}
            </div>
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-blue-500 px-2 py-0.5 text-[9px] font-bold text-white shadow">
              {callState === "held" ? "HELD" : callState === "connecting" ? "DIALING" : "LIVE"}
            </span>
          </div>

          {/* Name & number */}
          <p className="text-lg font-bold text-gray-900">{callerName || "Unknown"}</p>
          <p className="text-sm text-gray-500">{formatPhone(dialNumber)}</p>

          {/* Timer */}
          <p className={`mt-1 text-2xl font-light tabular-nums ${callState === "held" ? "text-orange-500" : callState === "connecting" ? "text-yellow-500" : "text-blue-600"}`}>
            {callState === "connecting" ? "Connecting..." : formatDuration(callDuration)}
          </p>

          {/* Call action grid */}
          <div className="mt-5 grid w-full grid-cols-3 gap-3">
            <button
              type="button"
              onClick={handleMute}
              className={`flex flex-col items-center gap-1.5 rounded-2xl py-3 text-xs font-semibold transition active:scale-95 ${
                isMuted ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              {isMuted ? "Unmute" : "Mute"}
            </button>
            <button
              type="button"
              onClick={handleHold}
              disabled={!callSid}
              className={`flex flex-col items-center gap-1.5 rounded-2xl py-3 text-xs font-semibold transition active:scale-95 disabled:opacity-40 ${
                callState === "held" ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {callState === "held" ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
              {callState === "held" ? "Resume" : "Hold"}
            </button>
            <button
              type="button"
              onClick={() => setShowInCallKeypad((v) => !v)}
              className={`flex flex-col items-center gap-1.5 rounded-2xl py-3 text-xs font-semibold transition active:scale-95 ${
                showInCallKeypad ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              <Hash className="h-5 w-5" />
              Keypad
            </button>
            <button
              type="button"
              onClick={() => setShowTransfer((v) => !v)}
              className={`flex flex-col items-center gap-1.5 rounded-2xl py-3 text-xs font-semibold transition active:scale-95 ${
                showTransfer ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              <PhoneForwarded className="h-5 w-5" />
              Transfer
            </button>
            <button
              type="button"
              className="flex flex-col items-center gap-1.5 rounded-2xl bg-gray-100 py-3 text-xs font-semibold text-gray-600 transition hover:bg-gray-200 active:scale-95"
            >
              <Volume2 className="h-5 w-5" />
              Speaker
            </button>
            <button
              type="button"
              onClick={handleEndCall}
              className="flex flex-col items-center gap-1.5 rounded-2xl bg-red-500 py-3 text-xs font-bold text-white transition hover:bg-red-600 active:scale-95"
            >
              <PhoneOff className="h-5 w-5" />
              End
            </button>
          </div>

          {/* Transfer input */}
          {showTransfer && (
            <div className="mt-3 flex w-full items-center gap-2">
              <input
                value={transferNumber}
                onChange={(e) => setTransferNumber(e.target.value)}
                placeholder="Transfer to number..."
                className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              />
              <button
                type="button"
                onClick={handleTransfer}
                disabled={!transferNumber.trim()}
                className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                Go
              </button>
            </div>
          )}

          {/* In-call DTMF keypad */}
          {showInCallKeypad && (
            <div className="mt-3 grid w-full grid-cols-3 gap-1.5">
              {"123456789*0#".split("").map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleSendDtmf(key)}
                  className="rounded-xl bg-white py-2.5 text-sm font-semibold text-gray-800 shadow-sm transition hover:bg-blue-50 active:scale-95"
                >
                  {key}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════ Forwarding Status ══════════ */}
      {callState === "forwarding" && forwardingStatus && (
        <div className="flex flex-col items-center px-6 py-8">
          <div className={`mb-4 flex h-16 w-16 items-center justify-center rounded-full ${
            forwardingStatus === "connected" ? "bg-blue-100" :
            forwardingStatus === "failed" ? "bg-red-100" :
            "bg-blue-100"
          }`}>
            <PhoneForwarded className={`h-7 w-7 ${
              forwardingStatus === "connected" ? "text-blue-600" :
              forwardingStatus === "failed" ? "text-red-600" :
              "text-blue-600"
            }`} />
          </div>
          <p className="text-base font-bold text-gray-900">
            {forwardingStatus === "forwarding" && "Forwarding Call..."}
            {forwardingStatus === "ringing" && "Ringing..."}
            {forwardingStatus === "connected" && "Forwarded Successfully"}
            {forwardingStatus === "no-answer" && "No Answer"}
            {forwardingStatus === "busy" && "Busy"}
            {forwardingStatus === "failed" && "Forwarding Failed"}
            {forwardingStatus === "ended" && "Call Ended"}
          </p>
          <p className="mt-1 text-sm text-gray-500">{formatPhone(forwardingDest)}</p>
          {(forwardingStatus === "forwarding" || forwardingStatus === "ringing") && (
            <div className="mt-4 h-6 w-6 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
          )}
          {(forwardingStatus === "connected" || forwardingStatus === "no-answer" || forwardingStatus === "busy" || forwardingStatus === "failed" || forwardingStatus === "ended") && (
            <button
              type="button"
              onClick={clearForwardingState}
              className="mt-4 rounded-xl bg-gray-100 px-6 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-200"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* ══════════ Tab Content (when not in call) ══════════ */}
      {!isInCall && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* ── Keypad Tab ── */}
          {activeTab === "keypad" && (
            <div className="flex flex-1 flex-col px-5 pb-3 pt-2">
              {/* Number display */}
              <div className="mb-3 text-center">
                <input
                  value={dialNumber}
                  onChange={(e) => setDialNumber(e.target.value)}
                  className="w-full bg-transparent text-center text-xl font-light tracking-wider text-gray-900 outline-none placeholder:text-gray-300"
                  placeholder="Enter number"
                />
              </div>

              {/* Dial pad */}
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { key: "1", sub: "" },
                  { key: "2", sub: "ABC" },
                  { key: "3", sub: "DEF" },
                  { key: "4", sub: "GHI" },
                  { key: "5", sub: "JKL" },
                  { key: "6", sub: "MNO" },
                  { key: "7", sub: "PQRS" },
                  { key: "8", sub: "TUV" },
                  { key: "9", sub: "WXYZ" },
                  { key: "*", sub: "" },
                  { key: "0", sub: "+" },
                  { key: "#", sub: "" },
                ].map(({ key, sub }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setDialNumber((v) => `${v}${key}`)}
                    className="flex flex-col items-center justify-center rounded-full bg-gray-50 py-2.5 transition hover:bg-gray-100 active:scale-95 active:bg-gray-200"
                  >
                    <span className="text-lg font-medium text-gray-800">{key}</span>
                    {sub && <span className="mt-[-2px] text-[9px] font-medium tracking-[0.2em] text-gray-400">{sub}</span>}
                  </button>
                ))}
              </div>

              {/* Call button row */}
              <div className="mt-3 flex items-center justify-center gap-6">
                <div className="w-12" />
                <button
                  type="button"
                  onClick={() => handleStartCall()}
                  disabled={!dialNumber.trim()}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500 text-white shadow-lg transition hover:bg-blue-600 disabled:opacity-40 active:scale-95"
                >
                  <Phone className="h-5 w-5" />
                </button>
                {dialNumber ? (
                  <button
                    type="button"
                    onClick={() => setDialNumber((v) => v.slice(0, -1))}
                    className="flex h-10 w-10 items-center justify-center text-gray-400 transition hover:text-gray-600"
                  >
                    <span className="text-xl">⌫</span>
                  </button>
                ) : (
                  <div className="w-12" />
                )}
              </div>
            </div>
          )}

          {/* ── Recents Tab ── */}
          {activeTab === "recents" && (() => {
            const filteredRecents = recentsFilter === "all" ? recents : recents.filter((c) => c.outcome === "Missed call");
            return (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* All / Missed filter */}
              <div className="flex border-b border-gray-200 px-4 pt-1">
                <button
                  type="button"
                  onClick={() => setRecentsFilter("all")}
                  className={`flex-1 pb-2 text-center text-xs font-semibold transition ${
                    recentsFilter === "all"
                      ? "border-b-2 border-blue-600 text-blue-600"
                      : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setRecentsFilter("missed")}
                  className={`flex-1 pb-2 text-center text-xs font-semibold transition ${
                    recentsFilter === "missed"
                      ? "border-b-2 border-blue-600 text-blue-600"
                      : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  Missed{missedCount > 0 ? ` (${missedCount})` : ""}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
              {recentsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-blue-500" />
                </div>
              ) : filteredRecents.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-gray-400">
                  <Clock className="mb-2 h-8 w-8" />
                  <p className="text-sm font-medium">{recentsFilter === "missed" ? "No missed calls" : "No recent calls"}</p>
                </div>
              ) : (
                <div>
                  {filteredRecents.map((call, idx) => {
                    const showDate = idx === 0 || formatCallDate(call.time) !== formatCallDate(filteredRecents[idx - 1].time);
                    const isMissed = call.outcome === "Missed call";
                    return (
                      <div key={call.id}>
                        {showDate && (
                          <p className="bg-gray-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                            {formatCallDate(call.time)}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => openActionMenu(call.id)}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition hover:bg-gray-50 active:bg-gray-100"
                        >
                          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                            isMissed ? "bg-red-50" : "bg-blue-50"
                          }`}>
                            {isMissed ? <PhoneMissed className="h-4 w-4 text-red-500" /> :
                             call.direction === "inbound" ? <PhoneIncoming className="h-4 w-4 text-blue-600" /> :
                             <PhoneOutgoing className="h-4 w-4 text-blue-600" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className={`truncate text-sm font-semibold ${isMissed ? "text-red-600" : "text-gray-900"}`}>
                              {call.name || formatPhone(call.phone)}
                            </p>
                            <p className="text-xs text-gray-400">
                              {call.direction === "inbound" ? "Incoming" : "Outgoing"}
                              {call.duration ? ` · ${formatDuration(call.duration)}` : ""}
                              {" · "}{formatCallTime(call.time)}
                            </p>
                          </div>
                          <MoreVertical className="h-4 w-4 shrink-0 text-gray-300" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              </div>
            </div>
            );
          })()}

          {/* ── Contacts Tab ── */}
          {activeTab === "contacts" && (
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Search */}
              <div className="px-4 pb-2 pt-1">
                <div className="flex items-center gap-2 rounded-xl bg-gray-100 px-3 py-2">
                  <Search className="h-4 w-4 text-gray-400" />
                  <input
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    placeholder="Search contacts..."
                    className="w-full bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"
                  />
                  {contactSearch && (
                    <button type="button" onClick={() => setContactSearch("")} className="text-gray-400 hover:text-gray-600">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {filteredContacts.length === 0 ? (
                  <div className="flex flex-col items-center py-12 text-gray-400">
                    <Users className="mb-2 h-8 w-8" />
                    <p className="text-sm font-medium">No contacts found</p>
                  </div>
                ) : (
                  <div>
                    {filteredContacts.slice(0, 50).map((customer) => (
                      <div
                        key={customer.id}
                        className="flex items-center gap-2 px-3 py-2 transition hover:bg-gray-50"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50">
                          <span className="text-xs font-bold text-blue-600">{customer.name.charAt(0).toUpperCase()}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-gray-900">{customer.name}</p>
                          <p className="text-[11px] text-gray-400">{formatPhone(customer.phone)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleStartCall(customer.phone)}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 transition hover:bg-blue-100"
                        >
                          <Phone className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Queue Tab ── */}
          {activeTab === "queue" && (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
                <Users className="h-6 w-6 text-gray-400" />
              </div>
              <p className="text-sm font-semibold text-gray-500">No calls waiting in queue</p>
              <p className="mt-1 text-xs text-gray-400">Incoming calls will appear here</p>
            </div>
          )}
        </div>
      )}

      {/* ══════════ Action Bottom Sheet ══════════ */}
      {actionMenuCallId && (() => {
        const menuCall = recents.find((c) => c.id === actionMenuCallId);
        if (!menuCall) return null;
        const displayName = menuCall.name || formatPhone(menuCall.phone);
        return (
          <>
            <button type="button" className="absolute inset-0 z-20 bg-black/20 rounded-2xl" onClick={() => setActionMenuCallId(null)} />
            <div className="absolute inset-x-0 bottom-0 z-30 rounded-b-2xl bg-white shadow-2xl">
              <div className="border-b border-gray-100 px-5 py-3">
                <p className="text-base font-bold text-gray-900">{displayName}</p>
                <p className="text-sm text-gray-400">{formatPhone(menuCall.phone)}</p>
              </div>
              <div className="py-1">
                <button type="button" onClick={() => { setActionMenuCallId(null); handleStartCall(menuCall.phone); }} className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition hover:bg-gray-50 active:bg-gray-100">
                  <Phone className="h-5 w-5 text-blue-600" />
                  <span className="text-sm font-semibold text-gray-700">Call {displayName}</span>
                </button>
                <button type="button" onClick={() => openSmsPanel(menuCall.phone, menuCall.name)} className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition hover:bg-gray-50 active:bg-gray-100">
                  <MessageSquare className="h-5 w-5 text-blue-600" />
                  <span className="text-sm font-semibold text-gray-700">Message {displayName}</span>
                </button>
                <button type="button" onClick={() => openNewJobForm(menuCall.phone, menuCall.name)} className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition hover:bg-gray-50 active:bg-gray-100">
                  <Briefcase className="h-5 w-5 text-blue-600" />
                  <span className="text-sm font-semibold text-gray-700">New job</span>
                </button>
              </div>
            </div>
          </>
        );
      })()}

      {/* ══════════ SMS Overlay ══════════ */}
      {smsTarget && (
        <div className="absolute inset-0 z-30 flex flex-col rounded-2xl bg-white">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <div>
              <p className="text-sm font-bold text-gray-900">Message</p>
              <p className="text-xs text-gray-500">{smsTarget.name || formatPhone(smsTarget.phone)}</p>
            </div>
            <button type="button" onClick={() => setSmsTarget(null)} className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-1 flex-col px-4 py-3">
            <textarea
              value={smsBody}
              onChange={(e) => setSmsBody(e.target.value)}
              placeholder="Type your message..."
              className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white"
              autoFocus
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              {smsSent && <span className="text-xs font-semibold text-blue-600">Sent!</span>}
              <button
                type="button"
                onClick={handleSendSms}
                disabled={!smsBody.trim() || smsSending}
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {smsSending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ New Job Form Overlay ══════════ */}
      {showNewJobForm && (
        <div className="absolute inset-0 z-30 flex flex-col rounded-2xl bg-white">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-blue-600" />
              <p className="text-sm font-bold text-gray-900">New Job</p>
            </div>
            <button type="button" onClick={() => setShowNewJobForm(false)} className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <div className="space-y-3">
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Client info</p>
                <p className="text-sm font-bold text-gray-900">{newJobName || "Unknown"}</p>
                <p className="text-xs text-gray-500">{formatPhone(newJobPhone)}</p>
              </div>

              <label className="grid gap-1">
                <span className="text-[11px] font-bold text-gray-500">Name *</span>
                <input
                  value={newJobForm.name}
                  onChange={(e) => setNewJobForm({ ...newJobForm, name: e.target.value })}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white"
                  placeholder="Customer name"
                  required
                />
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] font-bold text-gray-500">Address</span>
                <AddressAutocomplete
                  value={newJobForm.address}
                  onChange={(addr) => setNewJobForm((f) => ({ ...f, address: addr }))}
                  placeholder="Start typing address..."
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] font-bold text-gray-500">Ad Source</span>
                <select
                  value={newJobForm.source}
                  onChange={(e) => setNewJobForm({ ...newJobForm, source: e.target.value })}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white"
                >
                  {["Phone Call", "AZR", "Google", "Facebook", "Website", "Referral", "Partner Referral", "Door Knocking", "Yelp", "Angi", "Thumbtack", "Other"].map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] font-bold text-gray-500">Job Description</span>
                <textarea
                  value={newJobForm.description}
                  onChange={(e) => setNewJobForm({ ...newJobForm, description: e.target.value })}
                  className="resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white"
                  rows={2}
                  placeholder="Describe the job..."
                />
              </label>

              <div className="border-t border-gray-200 pt-3">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-gray-700">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Schedule
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1">
                    <span className="text-[10px] font-semibold text-gray-400">Start date</span>
                    <input type="date" value={newJobForm.scheduleDate} onChange={(e) => setNewJobForm({ ...newJobForm, scheduleDate: e.target.value })} className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs outline-none focus:border-blue-300 focus:bg-white" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-semibold text-gray-400">Start time</span>
                    <input type="time" value={newJobForm.scheduleStartTime} onChange={(e) => setNewJobForm({ ...newJobForm, scheduleStartTime: e.target.value })} className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs outline-none focus:border-blue-300 focus:bg-white" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-semibold text-gray-400">End date</span>
                    <input type="date" value={newJobForm.scheduleEndDate} onChange={(e) => setNewJobForm({ ...newJobForm, scheduleEndDate: e.target.value })} className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs outline-none focus:border-blue-300 focus:bg-white" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-semibold text-gray-400">End time</span>
                    <input type="time" value={newJobForm.scheduleEndTime} onChange={(e) => setNewJobForm({ ...newJobForm, scheduleEndTime: e.target.value })} className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs outline-none focus:border-blue-300 focus:bg-white" />
                  </label>
                </div>
              </div>

              <label className="grid gap-1">
                <span className="text-[11px] font-bold text-gray-500">Assigned Team Members</span>
                <input
                  value={newJobForm.assignedTo}
                  onChange={(e) => setNewJobForm({ ...newJobForm, assignedTo: e.target.value })}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white"
                  placeholder="e.g. Crew A, John"
                />
              </label>
            </div>
          </div>
          <div className="border-t border-gray-200 px-4 py-3">
            <button
              type="button"
              onClick={handleCreateJob}
              disabled={!newJobForm.name.trim() || jobCreating}
              className="w-full rounded-xl bg-yellow-400 py-2.5 text-sm font-bold text-gray-900 transition hover:bg-yellow-500 disabled:opacity-50 active:scale-[0.98]"
            >
              {jobCreating ? "Creating..." : "Create job"}
            </button>
          </div>
        </div>
      )}

      {/* ══════════ Bottom Tab Bar ══════════ */}
      {!isInCall && (
        <div className="flex border-t border-gray-200 bg-white">
          {([
            { key: "recents" as Tab, icon: Clock, label: "Recents" },
            { key: "contacts" as Tab, icon: Users, label: "Contacts" },
            { key: "keypad" as Tab, icon: Hash, label: "Keypad" },
            { key: "queue" as Tab, icon: PhoneIncoming, label: "Queue" },
          ]).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 text-[10px] font-semibold transition ${
                activeTab === tab.key
                  ? "text-blue-600"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              <tab.icon className={`h-4 w-4 ${activeTab === tab.key ? "text-blue-600" : ""}`} />
              {tab.label}
              {tab.key === "recents" && missedCount > 0 && activeTab !== "recents" && (
                <span className="absolute -mt-3 ml-6 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                  {missedCount}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
