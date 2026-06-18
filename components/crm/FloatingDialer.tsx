"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  GripVertical,
  Hash,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneForwarded,
  PhoneOff,
  Play,
  Plus,
  Clock,
  Users,
  X,
  User,
  BriefcaseBusiness,
  Contact,
} from "lucide-react";
import type { BrowserVoiceCall, BrowserVoiceDevice } from "@/lib/twilio/client";
import { createBrowserVoiceDevice, controlCall, listConversationEvents } from "@/lib/twilio/client";
import type { TwilioConversationEvent } from "@/types/twilio-conversations";
import type { Customer } from "@/types/crm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = "keypad" | "recents" | "contacts";
type CallState = "idle" | "connecting" | "active" | "held";
type ContactType = "client" | "lead" | "job";

interface PhoneNumber {
  label: string;
  number: string;
}

interface RecentCall {
  id: string;
  phone: string;
  name?: string;
  direction: "inbound" | "outbound";
  time: string;
  type?: ContactType;
}

interface FloatingDialerProps {
  open: boolean;
  onClose: () => void;
  voiceDeviceRef: React.RefObject<BrowserVoiceDevice | null>;
  phoneNumbers: PhoneNumber[];
  customers: Customer[];
  onCallStateChange?: (active: boolean) => void;
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
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
}: FloatingDialerProps) {
  // Position state for dragging
  const [position, setPosition] = useState({ x: -1, y: -1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

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

  // In-call DTMF keypad
  const [showInCallKeypad, setShowInCallKeypad] = useState(false);

  // Tag/identify caller
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [callerTag, setCallerTag] = useState<ContactType | null>(null);

  // Recents
  const [recents, setRecents] = useState<RecentCall[]>([]);
  const [recentsLoading, setRecentsLoading] = useState(false);

  // Initialize position on first open
  useEffect(() => {
    if (open && position.x === -1) {
      const x = window.innerWidth - 380;
      const y = window.innerHeight - 580;
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

  const findContactName = useCallback((phone: string): string | undefined => {
    const digits = phone.replace(/\D/g, "");
    return customers.find((c) => c.phone.replace(/\D/g, "") === digits)?.name;
  }, [customers]);

  // Load recents when tab opens
  useEffect(() => {
    if (activeTab === "recents" && recents.length === 0) {
      setRecentsLoading(true); // eslint-disable-line react-hooks/set-state-in-effect
      listConversationEvents(50)
        .then((events) => {
          const callEvents = events.filter(
            (e: TwilioConversationEvent) => e.type === "incoming_call" || (e.type === "call_status" && e.direction)
          );
          const seen = new Set<string>();
          const recent: RecentCall[] = [];
          for (const ev of callEvents) {
            const phone = ev.direction === "inbound" ? ev.from : ev.to;
            if (!phone || seen.has(phone)) continue;
            seen.add(phone);
            recent.push({
              id: ev.id,
              phone,
              name: findContactName(phone),
              direction: ev.direction || "inbound",
              time: ev.createdAt,
            });
            if (recent.length >= 20) break;
          }
          setRecents(recent);
        })
        .catch(() => {})
        .finally(() => setRecentsLoading(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, recents.length, findContactName]);

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
        x: Math.max(0, Math.min(window.innerWidth - 360, clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 100, clientY - dragOffset.current.y)),
      });
    }

    function handleEnd() {
      setIsDragging(false);
    }

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
  // Call actions
  // -------------------------------------------------------------------------

  async function handleStartCall(numberOverride?: string) {
    const destination = numberOverride || dialNumber.trim();
    if (!destination) return;
    try {
      setCallState("connecting");
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
      setCallerTag(null);
      call.on("accept", () => {
        const sid = (call as unknown as BrowserVoiceCall).parameters?.CallSid;
        if (sid) setCallSid(sid);
      });
      call.on("disconnect", () => {
        setCallState("idle");
        setCallSid(undefined);
        browserCallRef.current = null;
        setShowTransfer(false);
        setShowInCallKeypad(false);
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
    browserCallRef.current?.disconnect();
    browserCallRef.current = null;
    setCallState("idle");
    setCallSid(undefined);
    setIsMuted(false);
    setShowTransfer(false);
    setShowInCallKeypad(false);
  }

  function handleMute() {
    if (!browserCallRef.current) return;
    browserCallRef.current.mute?.(!isMuted);
    setIsMuted((v) => !v);
  }

  function handleHold() {
    if (!callSid) return;
    const action = callState === "held" ? "resume" : "hold";
    controlCall({ callSid, action }).catch(() => {});
    setCallState(callState === "held" ? "active" : "held");
  }

  function handleTransfer() {
    if (!callSid || !transferNumber.trim()) return;
    controlCall({ callSid, action: "forward", forwardTo: transferNumber.trim() }).catch(() => {});
    setShowTransfer(false);
    setTransferNumber("");
    // Call will disconnect on our end after transfer
    setCallState("idle");
    browserCallRef.current = null;
  }

  function handleSendDtmf(digit: string) {
    if (!browserCallRef.current) return;
    const call = browserCallRef.current as unknown as { sendDigits?: (digits: string) => void };
    call.sendDigits?.(digit);
  }

  function handleTagCaller(type: ContactType) {
    setCallerTag(type);
    setShowTagMenu(false);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (!open) return null;

  const isInCall = callState !== "idle";

  return (
    <div
      ref={containerRef}
      className="fixed z-[9999] w-[350px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
      style={{
        left: position.x,
        top: position.y,
        cursor: isDragging ? "grabbing" : undefined,
      }}
    >
      {/* Header - Draggable */}
      <div
        className="flex items-center justify-between border-b border-gray-200 bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-3 select-none"
        onMouseDown={handleDragStart}
        onTouchStart={handleDragStart}
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
      >
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-blue-200" />
          <Phone className="h-4 w-4 text-white" />
          <span className="text-sm font-bold text-white">Phone</span>
          {isInCall && (
            <span className="rounded-full bg-green-400/20 px-2 py-0.5 text-[10px] font-bold text-green-100">
              {callState === "held" ? "Held" : callState === "connecting" ? "Connecting..." : formatDuration(callDuration)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-blue-200 transition hover:bg-blue-500 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Caller ID Selector */}
      {phoneNumbers.length > 0 && !isInCall && (
        <div className="relative border-b border-gray-100 px-4 py-2">
          <button
            type="button"
            onClick={() => setCallerIdOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 transition hover:bg-gray-100"
          >
            <span className="flex items-center gap-2">
              <Phone className="h-3.5 w-3.5 text-gray-400" />
              <span className="font-medium">
                {phoneNumbers.find((p) => p.number === selectedCallerId)?.label || formatPhone(selectedCallerId) || "Select number"}
              </span>
            </span>
            <ChevronDown className={`h-4 w-4 text-gray-400 transition ${callerIdOpen ? "rotate-180" : ""}`} />
          </button>
          {callerIdOpen && (
            <>
              <button type="button" className="fixed inset-0 z-10" onClick={() => setCallerIdOpen(false)} />
              <div className="absolute left-4 right-4 top-full z-20 mt-1 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                {phoneNumbers.map((pn) => (
                  <button
                    key={pn.number}
                    type="button"
                    onClick={() => { setSelectedCallerId(pn.number); setCallerIdOpen(false); }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-blue-50 ${selectedCallerId === pn.number ? "bg-blue-50 font-semibold text-blue-700" : "text-gray-700"}`}
                  >
                    <Phone className="h-3.5 w-3.5 text-gray-400" />
                    <span>{pn.label}</span>
                    <span className="ml-auto text-xs text-gray-400">{formatPhone(pn.number)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* In-Call Controls */}
      {isInCall && (
        <div className="border-b border-gray-100 px-4 py-3">
          {/* Current call info */}
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-gray-900">{findContactName(dialNumber) || formatPhone(dialNumber)}</p>
              <p className="text-xs text-gray-500">{formatPhone(dialNumber)}</p>
            </div>
            <div className="flex items-center gap-1.5">
              {callerTag && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  callerTag === "client" ? "bg-blue-100 text-blue-700" :
                  callerTag === "lead" ? "bg-green-100 text-green-700" :
                  "bg-purple-100 text-purple-700"
                }`}>
                  {callerTag === "client" ? "Client" : callerTag === "lead" ? "Lead" : "Job"}
                </span>
              )}
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                callState === "held" ? "bg-orange-100 text-orange-700" :
                callState === "connecting" ? "bg-yellow-100 text-yellow-700" :
                "bg-green-100 text-green-700"
              }`}>
                {callState === "held" ? "On Hold" : callState === "connecting" ? "Connecting" : formatDuration(callDuration)}
              </span>
            </div>
          </div>

          {/* Call action buttons */}
          <div className="grid grid-cols-5 gap-1.5">
            <button
              type="button"
              onClick={handleMute}
              className={`flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-semibold transition ${
                isMuted ? "bg-orange-50 text-orange-700" : "bg-gray-50 text-gray-600 hover:bg-gray-100"
              }`}
            >
              {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              {isMuted ? "Unmute" : "Mute"}
            </button>
            <button
              type="button"
              onClick={() => setShowInCallKeypad((v) => !v)}
              className={`flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-semibold transition ${
                showInCallKeypad ? "bg-blue-50 text-blue-700" : "bg-gray-50 text-gray-600 hover:bg-gray-100"
              }`}
            >
              <Hash className="h-4 w-4" />
              Keypad
            </button>
            <button
              type="button"
              onClick={() => setShowTransfer((v) => !v)}
              className={`flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-semibold transition ${
                showTransfer ? "bg-blue-50 text-blue-700" : "bg-gray-50 text-gray-600 hover:bg-gray-100"
              }`}
            >
              <PhoneForwarded className="h-4 w-4" />
              Transfer
            </button>
            <button
              type="button"
              onClick={handleHold}
              disabled={!callSid}
              className={`flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-semibold transition disabled:opacity-50 ${
                callState === "held" ? "bg-orange-50 text-orange-700" : "bg-gray-50 text-gray-600 hover:bg-gray-100"
              }`}
            >
              {callState === "held" ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              {callState === "held" ? "Resume" : "Hold"}
            </button>
            <button
              type="button"
              onClick={() => setShowTagMenu((v) => !v)}
              className={`relative flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-semibold transition ${
                showTagMenu ? "bg-blue-50 text-blue-700" : "bg-gray-50 text-gray-600 hover:bg-gray-100"
              }`}
            >
              <Plus className="h-4 w-4" />
              Tag
            </button>
          </div>

          {/* Tag menu dropdown */}
          {showTagMenu && (
            <div className="mt-2 rounded-lg border border-gray-200 bg-white py-1 shadow-sm">
              <button type="button" onClick={() => handleTagCaller("client")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-blue-50">
                <User className="h-4 w-4 text-blue-500" /> Client
              </button>
              <button type="button" onClick={() => handleTagCaller("lead")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-green-50">
                <Contact className="h-4 w-4 text-green-500" /> Lead
              </button>
              <button type="button" onClick={() => handleTagCaller("job")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-purple-50">
                <BriefcaseBusiness className="h-4 w-4 text-purple-500" /> Job
              </button>
            </div>
          )}

          {/* Transfer input */}
          {showTransfer && (
            <div className="mt-2 flex items-center gap-2">
              <input
                value={transferNumber}
                onChange={(e) => setTransferNumber(e.target.value)}
                placeholder="Transfer to number..."
                className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              />
              <button
                type="button"
                onClick={handleTransfer}
                disabled={!transferNumber.trim()}
                className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                Transfer
              </button>
            </div>
          )}

          {/* In-call DTMF keypad */}
          {showInCallKeypad && (
            <div className="mt-2 grid grid-cols-3 gap-1">
              {"123456789*0#".split("").map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleSendDtmf(key)}
                  className="rounded-lg border border-gray-200 bg-gray-50 py-2 text-sm font-semibold text-gray-800 transition hover:bg-blue-50 hover:text-blue-700 active:scale-95"
                >
                  {key}
                </button>
              ))}
            </div>
          )}

          {/* End call */}
          <button
            type="button"
            onClick={handleEndCall}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 py-2.5 text-sm font-bold text-white transition hover:bg-red-700 active:scale-[0.98]"
          >
            <PhoneOff className="h-4 w-4" />
            End Call
          </button>
        </div>
      )}

      {/* Tabs */}
      {!isInCall && (
        <>
          <div className="flex border-b border-gray-100">
            {([
              { key: "keypad" as Tab, icon: Hash, label: "Keypad" },
              { key: "recents" as Tab, icon: Clock, label: "Recents" },
              { key: "contacts" as Tab, icon: Users, label: "Contacts" },
            ]).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition ${
                  activeTab === tab.key
                    ? "border-b-2 border-blue-600 text-blue-700"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Keypad Tab */}
          {activeTab === "keypad" && (
            <div className="p-3">
              <input
                value={dialNumber}
                onChange={(e) => setDialNumber(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-center text-lg font-bold text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
                placeholder="Enter phone number"
              />
              <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
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
                    className="flex flex-col items-center justify-center rounded-xl border border-gray-100 bg-gray-50 py-2.5 transition hover:bg-blue-50 hover:text-blue-700 active:scale-95"
                  >
                    <span className="text-lg font-semibold text-gray-800">{key}</span>
                    {sub && <span className="text-[9px] font-medium tracking-widest text-gray-400">{sub}</span>}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleStartCall()}
                  disabled={!dialNumber.trim()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-green-600 py-3 text-sm font-bold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]"
                >
                  <Phone className="h-4 w-4" />
                  Call
                </button>
                {dialNumber && (
                  <button
                    type="button"
                    onClick={() => setDialNumber((v) => v.slice(0, -1))}
                    className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-600 transition hover:bg-gray-100"
                  >
                    ⌫
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Recents Tab */}
          {activeTab === "recents" && (
            <div className="max-h-[360px] overflow-y-auto">
              {recentsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                </div>
              ) : recents.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">No recent calls</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {recents.map((call) => (
                    <button
                      key={call.id}
                      type="button"
                      onClick={() => { setDialNumber(call.phone); setActiveTab("keypad"); }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-gray-50"
                    >
                      <div className={`flex h-9 w-9 items-center justify-center rounded-full ${
                        call.direction === "inbound" ? "bg-green-100" : "bg-blue-100"
                      }`}>
                        <Phone className={`h-4 w-4 ${call.direction === "inbound" ? "text-green-600" : "text-blue-600"}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">
                          {call.name || formatPhone(call.phone)}
                        </p>
                        <p className="text-xs text-gray-500">
                          {call.direction === "inbound" ? "Incoming" : "Outgoing"} · {formatTime(call.time)}
                        </p>
                      </div>
                      <Phone className="h-4 w-4 shrink-0 text-gray-300" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Contacts Tab */}
          {activeTab === "contacts" && (
            <div className="max-h-[360px] overflow-y-auto">
              {customers.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">No contacts found</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {customers.filter((c) => c.phone).map((customer) => (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => { setDialNumber(customer.phone); setActiveTab("keypad"); }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-gray-50"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100">
                        <User className="h-4 w-4 text-gray-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">{customer.name}</p>
                        <p className="text-xs text-gray-500">{formatPhone(customer.phone)}</p>
                      </div>
                      <Phone className="h-4 w-4 shrink-0 text-gray-300" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
