"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ExternalLink,
  GripVertical,
  Hash,
  MapPin,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneForwarded,
  PhoneOff,
  Play,
  Plus,
  Save,
  StickyNote,
  User,
} from "lucide-react";
import type { Customer } from "@/types/crm";
import { getLineLabelForNumber } from "@/lib/twilio/numbers";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import Link from "next/link";

export type CallCardState = "ringing" | "active" | "held";

interface FloatingCallCardProps {
  state: CallCardState;
  caller: { name: string; phone: string };
  muted: boolean;
  twilioNumber?: string;
  customers?: Customer[];
  onAnswer: () => void;
  onDecline: () => void;
  onEnd: () => void;
  onMute: () => void;
  onHold?: () => void;
  onTransfer?: (number: string) => void;
  onSendDtmf?: (digit: string) => void;
  onSaveNotes?: (notes: string, disposition: string, callerInfo: CallerInfo) => void;
  onCreateLead?: (info: CallerInfo) => void;
  onSchedule?: (type: string, callerInfo: CallerInfo) => void;
}

export interface CallerInfo {
  name: string;
  phone: string;
  address: string;
  email: string;
  serviceNeeded: string;
  leadSource: string;
  notes: string;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return phone;
}

const SCHEDULE_TYPES = ["Inspection", "Estimate Appointment", "Repair Appointment", "Follow-up Call"] as const;
const DISPOSITIONS = [
  "No Answer", "Left Voicemail", "Interested", "Not Interested",
  "Call Back Requested", "Follow-Up Needed", "Appointment Scheduled",
  "Estimate Scheduled", "Proposal Sent", "Proposal Signed", "Job Won",
  "Wrong Number", "Spam", "Do Not Call", "Customer Unavailable", "Other",
] as const;
const LEAD_SOURCES = ["Google", "Facebook", "Website", "Referral", "Partner Referral", "Door Knocking", "Yelp", "Angi", "Thumbtack", "Phone Call", "Other"] as const;

export default function FloatingCallCard({
  state,
  caller,
  muted,
  twilioNumber,
  customers,
  onAnswer,
  onDecline,
  onEnd,
  onMute,
  onHold,
  onTransfer,
  onSendDtmf,
  onSaveNotes,
  onCreateLead,
  onSchedule,
}: FloatingCallCardProps) {
  // Duration
  const [duration, setDuration] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Drag
  const [position, setPosition] = useState({ x: -1, y: -1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Panels — auto-open notes when call becomes active
  const [showNotes, setShowNotes] = useState(state !== "ringing");
  const [showSchedule, setShowSchedule] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);

  // Entrance animation
  const [mounted, setMounted] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setMounted(true)); }, []);

  // Open notes when transitioning from ringing to active
  const prevStateRef = useRef(state);
  useEffect(() => {
    if (prevStateRef.current === "ringing" && (state === "active" || state === "held")) {
      setShowNotes(true);
    }
    prevStateRef.current = state;
  }, [state]);

  // Call data
  const [callNotes, setCallNotes] = useState("");
  const [disposition, setDisposition] = useState("");
  const [transferNumber, setTransferNumber] = useState("");
  const [callerInfo, setCallerInfo] = useState<CallerInfo>({
    name: "",
    phone: caller.phone,
    address: "",
    email: "",
    serviceNeeded: "",
    leadSource: "Phone Call",
    notes: "",
  });

  // Match existing customer (memoized to avoid re-scanning on every timer tick)
  const matchedCustomer = useMemo(() => {
    const callerDigits = caller.phone.replace(/\D/g, "");
    if (callerDigits.length < 10) return undefined;
    const last10 = callerDigits.slice(-10);
    return customers?.find((c) => c.phone.replace(/\D/g, "").slice(-10) === last10);
  }, [caller.phone, customers]);

  const lineLabel = twilioNumber ? getLineLabelForNumber(twilioNumber) : "";

  // Initialize caller info from matched customer or caller data
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (matchedCustomer) {
      setCallerInfo((prev) => ({
        ...prev,
        name: matchedCustomer.name || prev.name,
        phone: matchedCustomer.phone || prev.phone,
        address: matchedCustomer.propertyAddress || prev.address,
        email: matchedCustomer.email || prev.email,
      }));
    } else {
      setCallerInfo((prev) => ({
        ...prev,
        name: caller.name !== caller.phone ? caller.name : prev.name,
        phone: caller.phone,
      }));
    }
  }, [matchedCustomer, caller.name, caller.phone]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Duration timer
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (state === "active" || state === "held") {
      setDuration(0);
      intervalRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } else {
      setDuration(0);
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [state]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Initialize position
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (position.x === -1) {
      const x = window.innerWidth - 400;
      const y = Math.max(16, window.innerHeight - 600);
      setPosition({ x: Math.max(16, x), y: Math.max(16, y) });
    }
  }, [position.x]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    dragOffset.current = { x: clientX - position.x, y: clientY - position.y };
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;
    function handleMove(e: MouseEvent | TouchEvent) {
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 380, clientX - dragOffset.current.x)),
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

  function handleEndCall() {
    if (callNotes.trim() || disposition) {
      onSaveNotes?.(callNotes, disposition, callerInfo);
    }
    onEnd();
  }

  const displayName = matchedCustomer?.name || (caller.name !== caller.phone ? caller.name : "Unknown Caller");

  // ---- Ringing state ----
  if (state === "ringing") {
    return (
      <div
        ref={containerRef}
        className={`fixed z-[9999] w-80 overflow-hidden rounded-2xl border border-green-200 bg-white shadow-2xl transition-all duration-300 ${mounted ? "scale-100 opacity-100" : "scale-95 opacity-0"}`}
        style={{ left: position.x, top: position.y, cursor: isDragging ? "grabbing" : undefined }}
      >
        <div
          className="flex items-center justify-between bg-gradient-to-r from-green-600 to-green-700 px-4 py-3 select-none"
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
          style={{ cursor: isDragging ? "grabbing" : "grab" }}
        >
          <div className="flex items-center gap-2">
            <GripVertical className="h-4 w-4 text-green-200" />
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
            </span>
            <span className="text-sm font-bold text-white">Incoming Call</span>
          </div>
        </div>

        <div className="p-4">
          <div className="mb-3">
            <p className="truncate text-sm font-bold text-gray-900">{displayName}</p>
            <p className="text-xs text-gray-500">{formatPhone(caller.phone)}</p>
            {lineLabel && <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${lineLabel === "Partner Referral" ? "bg-purple-50 text-purple-600" : "bg-gray-100 text-gray-500"}`}>{lineLabel}</span>}
            {matchedCustomer && <span className="ml-1.5 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">Existing Customer</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onAnswer} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-green-700 active:scale-95">
              <Phone className="h-3.5 w-3.5" />Answer
            </button>
            <button onClick={onDecline} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-red-700 active:scale-95">
              <PhoneOff className="h-3.5 w-3.5" />Decline
            </button>
          </div>
          {matchedCustomer && (
            <Link
              href={`/crm/customers?customer=${encodeURIComponent(matchedCustomer.id)}`}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
            >
              <ExternalLink className="h-3 w-3" />View Customer Profile
            </Link>
          )}
        </div>
      </div>
    );
  }

  // ---- Active / held call ----
  return (
    <div
      ref={containerRef}
      className={`fixed z-[9999] w-[370px] overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-2xl transition-all duration-300 ${mounted ? "scale-100 opacity-100" : "scale-95 opacity-0"}`}
      style={{ left: position.x, top: position.y, cursor: isDragging ? "grabbing" : undefined }}
    >
      {/* Header - Draggable */}
      <div
        className="flex items-center justify-between bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-3 select-none"
        onMouseDown={handleDragStart}
        onTouchStart={handleDragStart}
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
      >
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-blue-200" />
          <Phone className="h-4 w-4 text-white" />
          <span className="text-sm font-bold text-white">Inbound Call</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${state === "held" ? "bg-orange-400/20 text-orange-100" : "bg-green-400/20 text-green-100"}`}>
            {state === "held" ? "On Hold" : formatDuration(duration)}
          </span>
        </div>
      </div>

      {/* Caller info */}
      <div className="border-b border-gray-100 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-gray-900">{displayName}</p>
            <p className="text-xs text-gray-500">{formatPhone(caller.phone)}</p>
          </div>
          <div className="flex items-center gap-1.5">
            {lineLabel && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${lineLabel === "Partner Referral" ? "bg-purple-50 text-purple-600" : "bg-gray-100 text-gray-500"}`}>{lineLabel}</span>}
            {matchedCustomer && (
              <Link href={`/crm/customers?customer=${encodeURIComponent(matchedCustomer.id)}`} className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700 transition hover:bg-blue-200">
                Customer <ExternalLink className="h-2.5 w-2.5" />
              </Link>
            )}
            {!matchedCustomer && <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">New</span>}
          </div>
        </div>
        {matchedCustomer?.propertyAddress && <p className="mt-1 flex items-center gap-1 text-xs text-gray-500"><MapPin className="h-3 w-3" />{matchedCustomer.propertyAddress}</p>}
      </div>

      {/* Call controls */}
      <div className="border-b border-gray-100 px-4 py-2">
        <div className="grid grid-cols-5 gap-1.5">
          <button type="button" onClick={onMute} className={`flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-semibold transition ${muted ? "bg-orange-50 text-orange-700" : "bg-gray-50 text-gray-600 hover:bg-gray-100"}`}>
            {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {muted ? "Unmute" : "Mute"}
          </button>
          {onHold && (
            <button type="button" onClick={onHold} className={`flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-semibold transition ${state === "held" ? "bg-orange-50 text-orange-700" : "bg-gray-50 text-gray-600 hover:bg-gray-100"}`}>
              {state === "held" ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              {state === "held" ? "Resume" : "Hold"}
            </button>
          )}
          {onSendDtmf && (
            <button type="button" onClick={() => { setShowKeypad((v) => !v); setShowTransfer(false); }} className={`flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-semibold transition ${showKeypad ? "bg-blue-50 text-blue-700" : "bg-gray-50 text-gray-600 hover:bg-gray-100"}`}>
              <Hash className="h-4 w-4" />Keypad
            </button>
          )}
          {onTransfer && (
            <button type="button" onClick={() => { setShowTransfer((v) => !v); setShowKeypad(false); }} className={`flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-semibold transition ${showTransfer ? "bg-blue-50 text-blue-700" : "bg-gray-50 text-gray-600 hover:bg-gray-100"}`}>
              <PhoneForwarded className="h-4 w-4" />Transfer
            </button>
          )}
          <button type="button" onClick={handleEndCall} className="flex flex-col items-center gap-1 rounded-lg bg-red-50 py-2 text-[10px] font-semibold text-red-700 transition hover:bg-red-100">
            <PhoneOff className="h-4 w-4" />End
          </button>
        </div>

        {/* Transfer input */}
        {showTransfer && (
          <div className="mt-2 flex items-center gap-2">
            <input value={transferNumber} onChange={(e) => setTransferNumber(e.target.value)} placeholder="Transfer to number..." className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" />
            <button type="button" onClick={() => { onTransfer?.(transferNumber.trim()); setShowTransfer(false); setTransferNumber(""); }} disabled={!transferNumber.trim()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-blue-700 disabled:opacity-50">Transfer</button>
          </div>
        )}

        {/* DTMF keypad */}
        {showKeypad && (
          <div className="mt-2 grid grid-cols-3 gap-1">
            {"123456789*0#".split("").map((key) => (
              <button key={key} type="button" onClick={() => onSendDtmf?.(key)} className="rounded-lg border border-gray-200 bg-gray-50 py-2 text-sm font-semibold text-gray-800 transition hover:bg-blue-50 hover:text-blue-700 active:scale-95">{key}</button>
            ))}
          </div>
        )}
      </div>

      {/* Action tabs */}
      <div className="flex border-b border-gray-100">
        <button type="button" onClick={() => { setShowNotes(true); setShowSchedule(false); setShowInfo(false); }} className={`flex flex-1 items-center justify-center gap-1 py-2 text-xs font-semibold transition ${showNotes ? "border-b-2 border-blue-600 text-blue-700" : "text-gray-500 hover:text-gray-700"}`}>
          <StickyNote className="h-3.5 w-3.5" />Notes
        </button>
        <button type="button" onClick={() => { setShowSchedule(true); setShowNotes(false); setShowInfo(false); }} className={`flex flex-1 items-center justify-center gap-1 py-2 text-xs font-semibold transition ${showSchedule ? "border-b-2 border-blue-600 text-blue-700" : "text-gray-500 hover:text-gray-700"}`}>
          <CalendarDays className="h-3.5 w-3.5" />Schedule
        </button>
        <button type="button" onClick={() => { setShowInfo(true); setShowNotes(false); setShowSchedule(false); }} className={`flex flex-1 items-center justify-center gap-1 py-2 text-xs font-semibold transition ${showInfo ? "border-b-2 border-blue-600 text-blue-700" : "text-gray-500 hover:text-gray-700"}`}>
          <User className="h-3.5 w-3.5" />{matchedCustomer ? "Customer" : "New Lead"}
        </button>
      </div>

      {/* Notes panel */}
      <div className="max-h-[280px] overflow-y-auto">
        {showNotes && (
          <div className="space-y-2 p-3">
            <textarea value={callNotes} onChange={(e) => setCallNotes(e.target.value)} className="min-h-24 w-full rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm outline-none placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100" placeholder="Type live call notes..." />
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500">Disposition</p>
              <select value={disposition} onChange={(e) => setDisposition(e.target.value)} className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100">
                <option value="">Select disposition</option>
                {DISPOSITIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <button type="button" onClick={() => onSaveNotes?.(callNotes, disposition, callerInfo)} disabled={!callNotes.trim()} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2 text-xs font-bold text-white transition hover:bg-blue-700 disabled:opacity-50">
              <Save className="h-3.5 w-3.5" />Save notes now
            </button>
          </div>
        )}

        {/* Schedule panel */}
        {showSchedule && (
          <div className="space-y-1.5 p-3">
            <p className="text-xs font-bold text-gray-500">Schedule while on call:</p>
            {SCHEDULE_TYPES.map((type) => (
              <button key={type} type="button" onClick={() => onSchedule?.(type, callerInfo)} className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-left text-sm font-semibold text-gray-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                <CalendarDays className="h-4 w-4 text-gray-400" />{type}
              </button>
            ))}
          </div>
        )}

        {/* Customer info / New lead panel */}
        {showInfo && (
          <div className="space-y-2 p-3">
            {matchedCustomer && (
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-2">
                <p className="text-xs font-bold text-blue-700">Existing customer matched</p>
                <p className="text-xs text-blue-600">{matchedCustomer.name} &middot; {matchedCustomer.status}</p>
              </div>
            )}
            <label className="grid gap-1">
              <span className="text-xs font-medium text-gray-500">Customer Name</span>
              <input value={callerInfo.name} onChange={(e) => setCallerInfo((p) => ({ ...p, name: e.target.value }))} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100" placeholder="Customer name" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-gray-500">Address</span>
              <AddressAutocomplete value={callerInfo.address} onChange={(address) => setCallerInfo((p) => ({ ...p, address }))} placeholder="Start typing address..." />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-gray-500">Email</span>
              <input value={callerInfo.email} onChange={(e) => setCallerInfo((p) => ({ ...p, email: e.target.value }))} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100" placeholder="customer@email.com" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-gray-500">Service Needed</span>
              <input value={callerInfo.serviceNeeded} onChange={(e) => setCallerInfo((p) => ({ ...p, serviceNeeded: e.target.value }))} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100" placeholder="Roof repair, inspection, etc." />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-gray-500">Lead Source</span>
              <select value={callerInfo.leadSource} onChange={(e) => setCallerInfo((p) => ({ ...p, leadSource: e.target.value }))} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100">
                {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            {!matchedCustomer && onCreateLead && (
              <button type="button" onClick={() => onCreateLead(callerInfo)} disabled={!callerInfo.name.trim()} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-green-600 py-2.5 text-xs font-bold text-white transition hover:bg-green-700 disabled:opacity-50">
                <Plus className="h-3.5 w-3.5" />Create new lead
              </button>
            )}
          </div>
        )}

        {/* Default: show notes prompt if no panel open */}
        {!showNotes && !showSchedule && !showInfo && (
          <div className="p-3">
            <button type="button" onClick={() => setShowNotes(true)} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 py-4 text-sm font-semibold text-gray-400 transition hover:border-blue-400 hover:text-blue-600">
              <StickyNote className="h-4 w-4" />Start typing notes...
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
