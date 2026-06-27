"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { leads } from "@/lib/crm-data";
import { loadLiveCustomers, buildPhoneLookup, matchCustomerByPhone, loadContactEdits, saveContactEdit, subscribeToContactEdits, type ContactEdit } from "@/lib/conversation-contact-sync";
import type { Customer } from "@/types/crm";
import { appointmentTypes, pipelineStages, quickTemplates } from "@/lib/crm-conversations";
import { controlCall, createBrowserVoiceDevice, listConversationEvents, listConversationReadStates, markConversationRead as persistConversationRead, proxyRecordingUrl, saveCallNotes, sendSms, startOutboundCall, subscribeToConversationEvents, subscribeToConversationReadStates, uploadMmsMedia } from "@/lib/twilio/client";
import { useVoiceDevice } from "@/lib/twilio/voice-device-context";
import { addTwilioCrmNotification, getTwilioCallOutcomeLabel } from "@/lib/twilio/notifications";
import { upsertProposalRecord } from "@/lib/proposal-sync";
import { logCrewActivity } from "@/lib/crew-activity";
import { azDateTime } from "@/lib/arizona-time";
import type { BrowserVoiceCall } from "@/lib/twilio/client";
import type { ConversationChannel, ConversationMessage, ConversationRecord } from "@/types/conversations";
import type { TwilioConversationEvent } from "@/types/twilio-conversations";
import { ArrowLeft, Calendar, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Clock, FileImage, FileText, MessageCircle, Mic, Pause, Phone, PhoneIncoming, PhoneMissed, PhoneOff, PhoneOutgoing, Plus, Search, Send, Smile, Sparkles, Trash2, Upload, UserRound, X } from "lucide-react";
import { PhoneLink, AddressLink, linkifyContactInfo } from "@/components/ContactLinks";
import { getTwilioLines, getLineLabelForNumber } from "@/lib/twilio/numbers";
import { toE164 } from "@/lib/twilio/config";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-gray-200 bg-white shadow-sm ${className}`}>{children}</section>;
}

function Button({ children, variant = "secondary", className = "", onClick }: { children: React.ReactNode; variant?: "primary" | "secondary" | "ghost"; className?: string; onClick?: () => void }) {
  const styles = {
    primary: "bg-blue-600 text-white hover:bg-blue-700",
    secondary: "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
    ghost: "text-gray-600 hover:bg-gray-100",
  };
  return <button type="button" onClick={onClick} className={`inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-semibold transition ${styles[variant]} ${className}`}>{children}</button>;
}

function Badge({ children, tone = "blue" }: { children: React.ReactNode; tone?: "blue" | "slate" | "green" | "orange" }) {
  const styles = {
    blue: "bg-blue-50 text-blue-700 ring-blue-100",
    slate: "bg-gray-100 text-gray-600 ring-gray-200",
    green: "bg-blue-50 text-blue-700 ring-blue-100",
    orange: "bg-orange-50 text-orange-700 ring-orange-100",
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${styles[tone]}`}>{children}</span>;
}

// Convert URLs, phone numbers, and emails in text to clickable links
const linkifyText = linkifyContactInfo;

const CALL_DISPOSITIONS = [
  "No Answer", "Left Voicemail", "Interested", "Not Interested",
  "Call Back Requested", "Follow-Up Needed", "Appointment Scheduled",
  "Estimate Scheduled", "Proposal Sent", "Proposal Signed", "Job Won",
  "Wrong Number", "Spam", "Do Not Call", "Customer Unavailable", "Other",
] as const;

function getDispositionColor(d: string): string {
  switch (d) {
    case "Interested": case "Appointment Scheduled": case "Estimate Scheduled": case "Job Won": return "bg-green-500";
    case "Proposal Sent": case "Proposal Signed": case "Follow-Up Needed": case "Call Back Requested": return "bg-blue-500";
    case "Left Voicemail": case "No Answer": case "Customer Unavailable": return "bg-yellow-500";
    case "Not Interested": case "Wrong Number": case "Spam": case "Do Not Call": return "bg-red-500";
    default: return "bg-gray-400";
  }
}

function getDispositionBadgeStyle(d: string): string {
  switch (d) {
    case "Interested": case "Appointment Scheduled": case "Estimate Scheduled": case "Job Won": return "bg-green-50 text-green-700 ring-green-200";
    case "Proposal Sent": case "Proposal Signed": case "Follow-Up Needed": case "Call Back Requested": return "bg-blue-50 text-blue-700 ring-blue-200";
    case "Left Voicemail": case "No Answer": case "Customer Unavailable": return "bg-yellow-50 text-yellow-700 ring-yellow-200";
    case "Not Interested": case "Wrong Number": case "Spam": case "Do Not Call": return "bg-red-50 text-red-700 ring-red-200";
    default: return "bg-gray-50 text-gray-600 ring-gray-200";
  }
}

function CollapsedInboxRail({ onExpand, onNew }: { onExpand: () => void; onNew: () => void }) {
  return (
    <Card className="hidden h-full flex-col items-center gap-2 overflow-hidden p-2 xl:flex">
      <button type="button" onClick={onExpand} aria-label="Expand inbox" title="Show conversations" className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:bg-gray-50"><ChevronRight className="h-4 w-4" /></button>
      <button type="button" onClick={onNew} aria-label="New conversation" title="New conversation" className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm transition hover:bg-blue-700"><Plus className="h-4 w-4" /></button>
      <span className="mt-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 [writing-mode:vertical-rl]">Inbox</span>
    </Card>
  );
}

const inboxFilters = ["All", "Unread", "Read", "Missed Calls", "New Leads", "Assigned"] as const;
type InboxFilter = (typeof inboxFilters)[number];

function conversationIsAssigned(conversation: ConversationRecord) {
  const rep = conversation.contact.assignedRep?.trim().toLowerCase();
  return Boolean(rep && rep !== "unassigned");
}

function conversationMatchesFilter(conversation: ConversationRecord, filter: InboxFilter) {
  const unreadCount = conversation.isMissedCall ? 0 : conversation.unreadCount;
  switch (filter) {
    case "Unread":
      return !conversation.isMissedCall && unreadCount > 0;
    case "Read":
      return !conversation.isMissedCall && unreadCount === 0;
    case "Missed Calls":
      return conversation.isMissedCall;
    case "New Leads":
      return conversation.isNewLead;
    case "Assigned":
      return conversationIsAssigned(conversation);
    case "All":
    default:
      return true;
  }
}

function getLastDisposition(conversation: ConversationRecord): string | undefined {
  for (let i = conversation.messages.length - 1; i >= 0; i--) {
    if (conversation.messages[i].disposition) return conversation.messages[i].disposition;
  }
  return undefined;
}

function ConversationInbox({ conversations, active, onSelect, onNew, onCollapse, onDelete }: { conversations: ConversationRecord[]; active?: ConversationRecord; onSelect: (conversation: ConversationRecord) => void; onNew: () => void; onCollapse?: () => void; onDelete?: (conversation: ConversationRecord) => void }) {
  const [filter, setFilter] = useState<InboxFilter>("All");
  const [search, setSearch] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [dispositionFilter, setDispositionFilter] = useState<string>("");

  const counts = useMemo(() => {
    const result = {} as Record<InboxFilter, number>;
    for (const name of inboxFilters) result[name] = conversations.filter((conversation) => conversationMatchesFilter(conversation, name)).length;
    return result;
  }, [conversations]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const queryDigits = query.replace(/\D/g, "");
    const queryPhone = queryDigits.length === 11 && queryDigits.startsWith("1") ? queryDigits.slice(1) : queryDigits;
    return conversations.filter((conversation) => {
      if (!conversationMatchesFilter(conversation, filter)) return false;
      if (dispositionFilter && getLastDisposition(conversation) !== dispositionFilter) return false;
      if (!query) return true;
      const textMatch = [conversation.contact.name, conversation.contact.phone, conversation.contact.address, conversation.lastMessage]
        .some((value) => value?.toLowerCase().includes(query));
      if (textMatch) return true;
      if (queryPhone.length >= 2 && conversation.contact.phone) {
        const cDigits = conversation.contact.phone.replace(/\D/g, "");
        const cPhone = cDigits.length === 11 && cDigits.startsWith("1") ? cDigits.slice(1) : cDigits;
        if (cPhone.includes(queryPhone)) return true;
      }
      return false;
    });
  }, [conversations, filter, search, dispositionFilter]);

  return (
    <Card className="flex max-h-[calc(100dvh-12rem)] min-h-0 flex-col overflow-hidden xl:max-h-none xl:h-full">
      <div className="border-b border-gray-200 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Inbox</p>
            <h2 className="mt-1 text-xl font-bold text-gray-950">Conversations</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onCollapse && <button type="button" onClick={onCollapse} aria-label="Minimize inbox" title="Minimize inbox" className="hidden h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:bg-gray-50 xl:flex"><ChevronLeft className="h-4 w-4" /></button>}
            <Button variant="primary" className="h-10 w-10 p-0" onClick={onNew} aria-label="New conversation"><Plus className="h-4 w-4" /></Button>
          </div>
        </div>
        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-3 text-sm outline-none transition placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50" placeholder="Search contacts" />
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {inboxFilters.map((name) => {
            const activeFilter = filter === name;
            return (
              <button key={name} type="button" onClick={() => setFilter(name)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${activeFilter ? "bg-blue-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-700"}`}>
                {name} <span className={activeFilter ? "text-blue-100" : "text-gray-400"}>({counts[name]})</span>
              </button>
            );
          })}
        </div>
        <select value={dispositionFilter} onChange={(e) => setDispositionFilter(e.target.value)} className={`mt-2 w-full rounded-lg border px-3 py-2 text-xs font-semibold outline-none transition ${dispositionFilter ? "border-blue-300 bg-blue-50 text-blue-700" : "border-gray-200 bg-gray-50 text-gray-500"} focus:border-blue-300 focus:ring-2 focus:ring-blue-100`}>
          <option value="">All Dispositions</option>
          {CALL_DISPOSITIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {conversations.length === 0 && <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-sm leading-6 text-gray-600">No conversations yet. Dial, receive a call, or send a text to create an accurate client conversation.</div>}
        {conversations.length > 0 && visible.length === 0 && <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-sm leading-6 text-gray-600">No conversations match {filter === "All" ? "your search" : `"${filter}"`}.</div>}
        {visible.map((conversation) => {
          const selected = conversation.id === active?.id;
          const unreadCount = conversation.isMissedCall ? 0 : conversation.unreadCount;
          const status = conversation.isMissedCall ? "Missed call" : unreadCount > 0 ? "Unread" : "Read";
          const statusClassName = conversation.isMissedCall || unreadCount === 0 ? "text-blue-700" : "text-blue-600";
          const lineLabel = conversation.twilioNumber ? getLineLabelForNumber(conversation.twilioNumber) : "";
          const lastDisp = getLastDisposition(conversation);
          return (
            <div key={conversation.id} className={`relative rounded-lg border p-3 text-left transition ${selected ? "border-blue-200 bg-blue-50 shadow-sm" : "border-transparent bg-white hover:border-gray-200 hover:bg-gray-50"}`}>
              <button type="button" onClick={() => onSelect(conversation)} className="w-full text-left">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    {unreadCount > 0 && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-blue-600" aria-hidden />}
                    <p className={`truncate text-base ${unreadCount > 0 ? "font-bold text-gray-950" : "font-semibold text-gray-800"}`}>{conversation.contact.name}</p>
                    {lineLabel && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${lineLabel === "Partner Referral" ? "bg-purple-50 text-purple-600 ring-1 ring-purple-200" : "bg-gray-100 text-gray-500 ring-1 ring-gray-200"}`}>{lineLabel}</span>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {unreadCount > 0 && <Badge tone="blue">{unreadCount}</Badge>}
                    <span className="text-xs text-gray-500">{conversation.lastActivityAt}</span>
                  </div>
                </div>
                <p className="mt-1 truncate text-sm font-medium text-gray-700"><PhoneLink value={conversation.contact.phone} /></p>
                <p className="mt-0.5 line-clamp-1 text-xs text-gray-500"><AddressLink value={conversation.contact.address} /></p>
                <p className="mt-1 line-clamp-2 text-sm leading-5 text-gray-600">{linkifyText(conversation.lastMessage)}</p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className={`text-xs font-bold ${statusClassName}`}>{status}</span>
                  {lastDisp && <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${getDispositionBadgeStyle(lastDisp)}`}>{lastDisp}</span>}
                </div>
              </button>
              {onDelete && confirmDeleteId !== conversation.id && (
                <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(conversation.id); }} className="absolute right-2 top-2 rounded-full p-1.5 text-gray-300 transition hover:bg-red-50 hover:text-red-500" title="Delete conversation">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              {onDelete && confirmDeleteId === conversation.id && (
                <div className="mt-2 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <p className="flex-1 text-xs font-medium text-red-800">Delete this conversation?</p>
                  <button type="button" onClick={() => { onDelete(conversation); setConfirmDeleteId(null); }} className="rounded-md bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700">Delete</button>
                  <button type="button" onClick={() => setConfirmDeleteId(null)} className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50">Cancel</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function CallRow({ message }: { message: ConversationMessage }) {
  const missed = message.status === "missed";
  const outbound = message.direction === "outbound";
  const tone = missed
    ? { border: "border-orange-200", bg: "bg-orange-50", text: "text-orange-700", ring: "ring-orange-100", Icon: PhoneMissed }
    : outbound
    ? { border: "border-blue-200", bg: "bg-blue-50", text: "text-blue-700", ring: "ring-blue-100", Icon: PhoneOutgoing }
    : { border: "border-blue-200", bg: "bg-blue-50", text: "text-blue-700", ring: "ring-blue-100", Icon: PhoneIncoming };
  const Icon = tone.Icon;

  return (
    <div className="flex justify-center">
      <div className={`flex w-full max-w-[86%] items-center gap-3 rounded-lg border ${tone.border} ${tone.bg} px-4 py-3`}>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white ${tone.text} ring-1 ${tone.ring}`}><Icon className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${tone.text}`}>{message.body}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className="truncate text-xs text-gray-500">{message.author} · {message.timestamp}</span>
            {message.line && <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${message.line === "Partner Referral" ? "bg-purple-50 text-purple-600" : "bg-gray-100 text-gray-500"}`}>{message.line}</span>}
            {message.disposition && <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${getDispositionBadgeStyle(message.disposition)}`}>{message.disposition}</span>}
          </div>
        </div>
        {message.recordingUrl && <audio controls src={proxyRecordingUrl(message.recordingUrl)} className="h-8 w-40 max-w-[40%]" />}
      </div>
    </div>
  );
}

const SMS_TRUNCATE_LENGTH = 300;

function SmsStatusBadge({ status, outbound }: { status?: string; outbound: boolean }) {
  if (status === "delivered") return <span className="inline-flex items-center gap-0.5"><CheckCheck className="h-3 w-3" /><span>Delivered</span></span>;
  if (status === "sent") return <span>Sent</span>;
  if (status === "missed") return <span className={outbound ? "text-red-300" : "text-red-500"}>Failed</span>;
  return null;
}

function TruncatedBody({ body, outbound }: { body: string; outbound: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (body.length <= SMS_TRUNCATE_LENGTH || expanded) {
    return (
      <>
        <p className="whitespace-pre-wrap break-words text-sm leading-6">{linkifyText(body)}</p>
        {expanded && <button type="button" onClick={() => setExpanded(false)} className={`mt-1 text-xs font-semibold ${outbound ? "text-blue-200 hover:text-white" : "text-blue-600 hover:text-blue-800"}`}>Show less</button>}
      </>
    );
  }
  return (
    <>
      <p className="whitespace-pre-wrap break-words text-sm leading-6">{linkifyText(body.slice(0, SMS_TRUNCATE_LENGTH) + "\u2026")}</p>
      <button type="button" onClick={() => setExpanded(true)} className={`mt-1 text-xs font-semibold ${outbound ? "text-blue-200 hover:text-white" : "text-blue-600 hover:text-blue-800"}`}>View full message</button>
    </>
  );
}

function MessageRow({ message }: { message: ConversationMessage }) {
  const outbound = message.direction === "outbound";
  const internal = message.direction === "internal";

  if (message.channel === "call") return <CallRow message={message} />;

  if (internal) {
    return (
      <div className="flex justify-center">
        <div className="max-w-[86%] rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-600">
          <span className="font-semibold">{message.timestamp}</span>
          <p className="mt-1 whitespace-pre-wrap break-words leading-5">{linkifyText(message.body)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[78%] rounded-lg px-4 py-3 ${outbound ? "bg-blue-600 text-white" : "border border-gray-200 bg-white text-gray-800 shadow-sm"}`}>
        <div className={`mb-1 flex flex-wrap items-center gap-2 text-xs ${outbound ? "text-blue-100" : "text-gray-500"}`}>
          <span>{message.author}</span>
          <span>{message.timestamp}</span>
          <SmsStatusBadge status={message.status} outbound={outbound} />
          {message.line && <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${message.line === "Partner Referral" ? (outbound ? "bg-purple-500/20 text-purple-100" : "bg-purple-50 text-purple-600 ring-1 ring-purple-200") : (outbound ? "bg-white/10 text-blue-100" : "bg-gray-50 text-gray-500 ring-1 ring-gray-200")}`}>{message.line}</span>}
        </div>
        {message.mediaUrls && message.mediaUrls.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {message.mediaUrls.map((url) => {
              const isPdf = url.toLowerCase().endsWith(".pdf");
              return isPdf ? (
                <a key={url} href={url} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${outbound ? "bg-white/20 text-white hover:bg-white/30" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}><FileText className="h-4 w-4" />PDF Document</a>
              ) : (
                <a key={url} href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt="MMS" className="max-h-48 max-w-[240px] rounded-lg border border-white/20 object-cover" /></a>
              );
            })}
          </div>
        )}
        <TruncatedBody body={message.body} outbound={outbound} />
        {message.attachments && <div className="mt-3 flex flex-wrap gap-2">{message.attachments.map((item) => <span key={item} className="inline-flex items-center gap-1 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-gray-600 ring-1 ring-gray-200"><FileImage className="h-3 w-3 text-blue-600" />{item}</span>)}</div>}
      </div>
    </div>
  );
}

function CallInsightsCard({ event, onOpen }: { event: TwilioConversationEvent; onOpen: (event: TwilioConversationEvent) => void }) {
  const isProcessing = event.status === "processing";
  const isFallback = Boolean(event.payload.isFallbackSummary);
  const summary = typeof event.payload.summary === "string" ? event.payload.summary : event.body || "";
  const eventDisposition = typeof event.payload.disposition === "string" ? event.payload.disposition : undefined;
  const callOutcome = typeof event.payload.callOutcome === "string" ? event.payload.callOutcome : "";
  const outcomeLabel = callOutcome ? callOutcome.replace(/-/g, " ").replace(/^\w/, (c: string) => c.toUpperCase()) : "";

  return (
    <div className={`rounded-lg border px-3 py-2.5 text-sm ${isFallback ? "border-amber-100 bg-amber-50 text-amber-950" : "border-blue-100 bg-blue-50 text-blue-950"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <p className="flex items-center gap-1.5 font-bold">{isFallback ? <><PhoneOff className="h-3.5 w-3.5" />Call status</> : <><Sparkles className="h-3.5 w-3.5" />Call summary</>}</p>
          {outcomeLabel && isFallback && <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 ring-1 ring-amber-200">{outcomeLabel}</span>}
          {eventDisposition && <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${getDispositionBadgeStyle(eventDisposition)}`}>{eventDisposition}</span>}
        </div>
        <span className={`text-[11px] font-semibold ${isFallback ? "text-amber-700" : "text-blue-700"}`}>{new Date(event.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
      </div>
      {isProcessing ? (
        <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-blue-700"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />Generating summary…</p>
      ) : (
        <p className={`mt-1 line-clamp-3 whitespace-pre-wrap break-words leading-5 ${isFallback ? "text-amber-900" : "text-blue-900"}`}>{summary || "Summary unavailable."}</p>
      )}
      <button onClick={() => onOpen(event)} className={`mt-2 inline-flex items-center gap-1 text-xs font-bold underline-offset-2 hover:underline ${isFallback ? "text-amber-800" : "text-blue-800"}`}>{isFallback ? "Details" : "Details & recording"}<ChevronRight className="h-3.5 w-3.5" /></button>
    </div>
  );
}

function CallTranscriptModal({ event, onClose, onDeleteRecording }: { event: TwilioConversationEvent | null; onClose: () => void; onDeleteRecording?: (event: TwilioConversationEvent) => void }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!event) return null;

  const transcript = typeof event.payload.transcript === "string" ? event.payload.transcript : "";
  const summary = typeof event.payload.summary === "string" ? event.payload.summary : event.body || "";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-950/50 p-4" onClick={onClose}>
      <div onClick={(clickEvent) => clickEvent.stopPropagation()} className="flex max-h-[86vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <p className="text-sm font-bold text-gray-950">Call summary</p>
            <p className="text-xs font-semibold text-gray-500">{azDateTime(event.createdAt)}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-blue-700"><Sparkles className="h-3.5 w-3.5" />Summary</p>
            <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-gray-800">{summary || "Summary is still processing or unavailable."}</p>
          </div>
          {event.recordingUrl && (
            <div className="flex items-center gap-2">
              <audio controls src={proxyRecordingUrl(event.recordingUrl)} className="min-w-0 flex-1" />
              {onDeleteRecording && !confirmDelete && (
                <button onClick={() => setConfirmDelete(true)} className="shrink-0 rounded-full p-2 text-gray-400 transition hover:bg-red-50 hover:text-red-600" title="Delete recording">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              {onDeleteRecording && confirmDelete && (
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => { onDeleteRecording(event); onClose(); }} className="rounded-md bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700">Delete</button>
                  <button onClick={() => setConfirmDelete(false)} className="rounded-md bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-200">Cancel</button>
                </div>
              )}
            </div>
          )}
          {!event.payload.isFallbackSummary && (
            <div className="rounded-lg border border-gray-200 bg-gray-50">
              <button type="button" onClick={() => setShowTranscript((value) => !value)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-gray-600">Full transcript<ChevronDown className={`h-4 w-4 transition ${showTranscript ? "rotate-180" : ""}`} /></button>
              {showTranscript && <p className="whitespace-pre-wrap break-words px-3 pb-3 text-sm leading-6 text-gray-800">{transcript || "Transcript is still processing or unavailable."}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FloatingDialer({ contactName, dialNumber, forwardNumber, callNotes, callDisposition, isOpen, isMinimized, isActiveCall, isHeld, isMuted, callSid, fromNumber, onFromNumberChange, onClose, onMinimize, onStartCall, onEndCall, onHoldCall, onMuteCall, onForwardCall, onSaveCallNotes, onNotesChange, onDispositionChange, onDialNumberChange, onForwardNumberChange }: { contactName?: string; dialNumber: string; forwardNumber: string; callNotes: string; callDisposition: string; isOpen: boolean; isMinimized: boolean; isActiveCall: boolean; isHeld: boolean; isMuted: boolean; callSid?: string; fromNumber: string; onFromNumberChange: (value: string) => void; onClose: () => void; onMinimize: () => void; onStartCall: () => void; onEndCall: () => void; onHoldCall: () => void; onMuteCall: () => void; onForwardCall: () => void; onSaveCallNotes: () => void; onNotesChange: (notes: string) => void; onDispositionChange: (disposition: string) => void; onDialNumberChange: (value: string) => void; onForwardNumberChange: (value: string) => void }) {
  const [callFromOpen, setCallFromOpen] = useState(false);
  const lines = getTwilioLines();
  const selectedLine = lines.find((l) => l.number === fromNumber);
  if (!isOpen) return null;

  const keys = "123456789*0#".split("");
  const dispositions = CALL_DISPOSITIONS;

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 sm:inset-auto sm:bottom-6 sm:right-6 sm:w-[340px]">
      <Card className="overflow-hidden border-blue-100 shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Dialer</p>
            <input value={dialNumber} onChange={(event) => onDialNumberChange(event.target.value)} className="mt-1 w-full bg-transparent text-lg font-bold text-gray-950 outline-none" aria-label="Dial number" placeholder="Enter phone number" />
          </div>
          <div className="flex items-center gap-1">
            {isActiveCall && <Badge tone="green"><Clock className="mr-1 h-3 w-3" />{isHeld ? "Held" : "Live"}</Badge>}
            <button onClick={onMinimize} className="rounded-lg px-2 py-1 text-xs font-semibold text-gray-500 hover:bg-gray-100">{isMinimized ? "Open" : "Min"}</button>
            <button onClick={onClose} className="rounded-lg px-2 py-1 text-xs font-semibold text-gray-500 hover:bg-gray-100">×</button>
          </div>
        </div>
        {!isMinimized && (
          <div className="p-3">
            {lines.length > 0 && <div className="relative mb-2"><button type="button" onClick={() => setCallFromOpen((v) => !v)} className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 transition hover:bg-gray-100"><span className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-gray-400" /><span className="font-medium">Call from: {selectedLine?.label || "Select number"}</span></span><ChevronDown className={`h-4 w-4 text-gray-400 transition ${callFromOpen ? "rotate-180" : ""}`} /></button>{callFromOpen && (<><button type="button" className="fixed inset-0 z-10" onClick={() => setCallFromOpen(false)} /><div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">{lines.map((line) => <button key={line.number} type="button" onClick={() => { onFromNumberChange(line.number); setCallFromOpen(false); }} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-blue-50 ${fromNumber === line.number ? "bg-blue-50 font-semibold text-blue-700" : "text-gray-700"}`}><Phone className="h-3.5 w-3.5 text-gray-400" /><span>{line.label}</span><span className="ml-auto text-xs text-gray-400">{line.number}</span></button>)}</div></>)}</div>}
            <p className="mb-2 text-xs text-gray-500">Calling as XRP Roofing · {contactName || dialNumber || "Manual number"}</p>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button onClick={onStartCall} className="rounded-lg bg-blue-600 px-3 py-3 text-sm font-bold text-white transition hover:bg-blue-700"><Phone className="mr-2 inline h-4 w-4" />Dial number</button>
              <button onClick={onEndCall} disabled={!isActiveCall} className="rounded-lg bg-gray-900 px-3 py-3 text-sm font-bold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"><PhoneOff className="mr-2 inline h-4 w-4" />End</button>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-base font-semibold">{keys.map((key) => <button key={key} onClick={() => onDialNumberChange(`${dialNumber}${key}`)} className="rounded-lg border border-gray-200 bg-gray-50 py-2.5 text-gray-800 transition hover:bg-blue-50 hover:text-blue-700">{key}</button>)}</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={onMuteCall} disabled={!isActiveCall} className={`rounded-lg border border-gray-200 p-2.5 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 ${isMuted ? "bg-orange-50 text-orange-700" : "text-gray-600"}`}><Mic className="mx-auto h-4 w-4" /></button>
              <button onClick={onHoldCall} disabled={!isActiveCall || !callSid} className={`rounded-lg border border-gray-200 p-2.5 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 ${isHeld ? "bg-orange-50 text-orange-700" : "text-gray-600"}`}><Pause className="mx-auto h-4 w-4" /></button>
            </div>
            {callSid && <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs font-semibold text-blue-700">Call connected. Add notes below or forward this live call to another number.</div>}
            {callSid && <div className="mt-3 grid gap-2"><p className="text-xs font-bold uppercase tracking-wide text-gray-500">Forward call</p><div className="flex gap-2"><input value={forwardNumber} onChange={(event) => onForwardNumberChange(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50" placeholder="Forward to phone number" /><button onClick={onForwardCall} className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-bold text-white">Forward</button></div></div>}
            {callSid && <div className="mt-3 grid gap-2"><p className="text-xs font-bold uppercase tracking-wide text-gray-500">Call disposition</p><select value={callDisposition} onChange={(event) => onDispositionChange(event.target.value)} className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50"><option value="">Select disposition</option>{dispositions.map((disposition) => <option key={disposition} value={disposition}>{disposition}</option>)}</select></div>}
            {callSid && <div className="mt-3"><p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500">Call notes</p><textarea value={callNotes} onChange={(event) => onNotesChange(event.target.value)} className="min-h-20 w-full rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm outline-none focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50" placeholder="Type live call notes..." /><button onClick={onSaveCallNotes} className="mt-2 w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-blue-700">Save call notes</button></div>}
          </div>
        )}
      </Card>
    </div>
  );
}

function SchedulerPanel({ onSchedule }: { onSchedule: () => void }) {
  return (
    <Card className="p-4">
      <p className="text-sm font-semibold text-gray-950">Schedule appointment</p>
      <p className="mt-1 text-xs leading-5 text-gray-500">Create an appointment for this contact. It syncs to the CRM calendar.</p>
      <Button variant="primary" className="mt-3 w-full" onClick={onSchedule}><Calendar className="mr-1.5 h-4 w-4" />New appointment</Button>
    </Card>
  );
}

function EditableDetailRow({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} className="rounded-lg border border-transparent bg-gray-50 px-2 py-1.5 text-sm leading-5 text-gray-800 outline-none transition hover:border-gray-200 focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50" />
    </label>
  );
}

function normalizePhone(value: string) {
  const d = value.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d;
}

function getTwilioLinePhone(event: TwilioConversationEvent): string {
  return event.direction === "inbound" ? (event.to || "") : (event.from || "");
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) outputArray[index] = rawData.charCodeAt(index);

  return outputArray;
}

function formatPhoneIdentity(value: string) {
  return value.trim() || "Unknown number";
}

function findCrmContactByPhone(phone: string, liveCustomerLookup?: Map<string, Customer>) {
  const normalized = normalizePhone(phone);
  const lead = leads.find((item) => normalizePhone(item.phone) === normalized);
  const customer = liveCustomerLookup ? matchCustomerByPhone(phone, liveCustomerLookup) : null;

  if (!lead && !customer) return null;

  return {
    id: customer?.id || lead?.id || normalized,
    name: customer?.name || lead?.name || phone,
    phone: customer?.phone || lead?.phone || phone,
    email: customer?.email || lead?.email || "",
    address: customer?.propertyAddress || (lead ? `${lead.address}, ${lead.city}, AZ` : ""),
    roofType: customer?.roofDetails || lead?.roofType || "Not specified",
    assignedRep: lead?.assignedTo || "Unassigned",
    insuranceStatus: customer?.insuranceCarrier || "Not confirmed",
    jobStatus: customer?.status || (lead?.stage ? lead.stage.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Manual contact"),
    leadSource: lead?.source || "Phone",
    tags: [customer?.status || lead?.source || "Phone"].filter(Boolean),
    notes: lead?.lastActivity || "Created from communication activity",
  };
}

function createManualConversation(phone: string, liveCustomerLookup?: Map<string, Customer>): ConversationRecord {
  const contact = findCrmContactByPhone(phone, liveCustomerLookup);
  const normalized = normalizePhone(phone) || crypto.randomUUID();

  return {
    id: `phone-${normalized}`,
    customerId: contact?.id,
    contact: contact || {
      id: normalized,
      name: formatPhoneIdentity(phone),
      phone: formatPhoneIdentity(phone),
      email: "",
      address: "Manual phone contact",
      roofType: "Not specified",
      assignedRep: "Unassigned",
      insuranceStatus: "Not confirmed",
      jobStatus: "Phone contact",
      leadSource: "Phone",
      tags: ["Phone"],
      notes: "Created from communication activity",
    },
    lastMessage: "New phone conversation",
    lastActivityAt: "Now",
    lastActivityIso: new Date().toISOString(),
    unreadCount: 0,
    isMissedCall: false,
    isNewLead: !contact,
    channels: [],
    messages: [],
    callSids: [],
  };
}

function getEventPhone(event: TwilioConversationEvent) {
  return event.direction === "outbound" ? event.to || event.from || "" : event.from || event.to || "";
}

function isMissedCallEvent(event: TwilioConversationEvent) {
  return getTwilioCallOutcomeLabel(event) === "Missed call";
}

function isAnsweredCallEvent(event: TwilioConversationEvent) {
  return ["Answered call", "Completed call", "Call recorded with summary", "Call forwarded"].includes(getTwilioCallOutcomeLabel(event));
}

function isVisibleCallTimelineEvent(event: TwilioConversationEvent) {
  if (!event.type.includes("call") && event.type !== "incoming_call") return true;
  // Call recordings are rendered once as a dedicated CallInsightsCard, not as a
  // timeline message bubble — rendering both is what caused duplicate summaries.
  if (event.type === "call_recording") return false;
  if (event.type === "call_note") return false;

  // incoming_call events are always visible so every inbound call appears on
  // the board even if the caller abandons during the IVR.
  if (event.type === "incoming_call") return true;

  const status = (event.status || String(event.payload.CallStatus || "")).toLowerCase();
  const label = getTwilioCallOutcomeLabel(event);

  if (["ringing", "initiated", "queued", "in-progress"].includes(status)) return false;
  return ["Incoming Call", "Outgoing Call", "Missed call", "Completed call", "Answered call", "Call recorded with summary", "Call forwarded"].includes(label) || status === "completed";
}

function getConversationIdForPhone(phone: string) {
  return "phone-" + (normalizePhone(phone) || phone);
}

function getCallMessageId(event: TwilioConversationEvent) {
  if (!event.callSid || !event.type.includes("call")) return event.id;
  if (event.type === "call_recording") return "recording-" + event.callSid;
  if (event.type === "call_note") return event.id;
  return "call-" + event.callSid;
}

// A single call produces several call_recording events (a "processing"
// placeholder, then the final transcript+summary, possibly a failure). They
// share a callSid but have different ids, so collapse them to one entry per call
// — preferring the completed summary, then the most recent — so the summary
// shows exactly once and stays unique after refresh / realtime sync.
function isMoreCompleteInsight(candidate: TwilioConversationEvent, current: TwilioConversationEvent) {
  const rank = (event: TwilioConversationEvent) => (event.status === "processing" ? 0 : 1);
  if (rank(candidate) !== rank(current)) return rank(candidate) > rank(current);
  return new Date(candidate.createdAt).getTime() >= new Date(current.createdAt).getTime();
}

function dedupeCallInsights(events: TwilioConversationEvent[]) {
  const byCall = new Map<string, TwilioConversationEvent>();
  for (const event of events) {
    const key = event.callSid || event.id;
    const existing = byCall.get(key);
    if (!existing || isMoreCompleteInsight(event, existing)) byCall.set(key, event);
  }
  return Array.from(byCall.values());
}

function formatActivityTime(isoString: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return "Now";
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 2) return "Now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getCallDurationLabel(event: TwilioConversationEvent) {
  const seconds = Number(event.payload.CallDuration || event.payload.DialCallDuration || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0 ? minutes + "m " + remainingSeconds + "s" : remainingSeconds + "s";
}

function eventMatchesConversation(event: TwilioConversationEvent, conversation: ConversationRecord) {
  if (event.conversationId && event.conversationId === conversation.id) return true;
  const eventPhone = normalizePhone(getEventPhone(event));
  if (eventPhone && eventPhone === normalizePhone(conversation.contact.phone)) return true;
  if (!event.callSid) return false;
  if (conversation.callSids?.includes(event.callSid)) return true;

  return conversation.messages.some((message) => message.id.includes(event.callSid || ""));
}

function extractMediaUrls(payload: Record<string, unknown>): string[] {
  const urls: string[] = [];
  // Outbound MMS: stored as payload.mediaUrls
  if (Array.isArray(payload.mediaUrls)) {
    for (const url of payload.mediaUrls) {
      if (typeof url === "string" && url.startsWith("http")) urls.push(url);
    }
  }
  // Inbound MMS: Twilio sends MediaUrl0, MediaUrl1, …
  const numMedia = Number(payload.NumMedia || 0);
  for (let i = 0; i < numMedia; i++) {
    const url = payload[`MediaUrl${i}`];
    if (typeof url === "string" && url.startsWith("http")) urls.push(url);
  }
  return urls;
}

function getSmsStatusLabel(event: TwilioConversationEvent): ConversationMessage["status"] {
  const s = (event.status || "").toLowerCase();
  if (s === "delivered" || s === "read") return "delivered";
  if (s === "failed" || s === "undelivered") return "missed";
  if (event.direction === "outbound") return "sent";
  return "read";
}

function createMessageFromEvent(event: TwilioConversationEvent, fallbackLine?: string): ConversationMessage {
  const isCall = event.type.includes("call");
  const channel: ConversationChannel = isCall ? "call" : "sms";
  const direction = event.direction || "internal";
  const callLabel = direction === "outbound" ? "Outbound call" : isMissedCallEvent(event) ? "Missed call" : "Inbound call";
  const duration = getCallDurationLabel(event);
  const twilioPhone = getTwilioLinePhone(event);
  const line = getLineLabelForNumber(twilioPhone) || fallbackLine || "";
  const mediaUrls = extractMediaUrls(event.payload);

  // Build a descriptive fallback for SMS events that includes direction and
  // line info instead of the generic "Message activity".
  let fallbackBody: string;
  if (event.type === "call_recording") {
    fallbackBody = "AI Summary Created";
  } else if (isCall) {
    fallbackBody = callLabel + (duration ? " \u00b7 " + duration : "");
  } else {
    const lineTag = line ? ` from ${line}` : "";
    fallbackBody = direction === "outbound"
      ? `SMS sent${lineTag} to ${formatPhoneIdentity(event.to || "customer")}`
      : `SMS received from ${formatPhoneIdentity(event.from || "customer")}${lineTag}`;
  }

  const messageStatus = isCall
    ? (isMissedCallEvent(event) ? "missed" : direction === "outbound" ? "sent" : "read")
    : getSmsStatusLabel(event);

  const disposition = typeof event.payload?.disposition === "string" ? event.payload.disposition : undefined;

  return {
    id: getCallMessageId(event),
    channel,
    direction,
    author: direction === "outbound" ? "XRP Roofing" : formatPhoneIdentity(event.from || "Customer"),
    body: event.body || fallbackBody,
    timestamp: new Date(event.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
    status: messageStatus,
    recordingUrl: event.recordingUrl,
    line,
    ...(mediaUrls.length > 0 ? { mediaUrls } : {}),
    ...(disposition ? { disposition } : {}),
  };
}
// Decide whether a missed call is still "outstanding" (i.e. should show the
// Missed call badge). It stays outstanding until the team reviews it (opens the
// conversation, which advances readAt) or a later answered call supersedes it.
function isMissedCallOutstanding(lastMissedAt?: string, lastAnsweredAt?: string, readAt?: string) {
  if (!lastMissedAt) return false;
  if (lastAnsweredAt && lastAnsweredAt >= lastMissedAt) return false;
  if (readAt && readAt >= lastMissedAt) return false;
  return true;
}

function upsertConversationFromEvent(current: ConversationRecord[], event: TwilioConversationEvent, readStates?: Record<string, string>, liveCustomerLookup?: Map<string, Customer>) {
  const phone = getEventPhone(event);
  const existing = event.conversationId ? current.find((conversation) => conversation.id === event.conversationId) : current.find((conversation) => eventMatchesConversation(event, conversation));
  if (!phone && !existing) return current;

  const normalized = normalizePhone(phone || existing?.contact.phone || "");
  const id = existing?.id || getConversationIdForPhone(phone);
  const channel: ConversationChannel = event.type.includes("call") ? "call" : event.type.includes("sms") || event.type.includes("message") ? "sms" : "note";
  const nextConversation = existing || createManualConversation(phone, liveCustomerLookup);
  const inboundTwilioPhone = event.direction === "inbound" ? toE164(event.to || "") : "";
  const twilioNumber = existing?.twilioNumber || (inboundTwilioPhone || undefined);
  const conversationLine = twilioNumber ? getLineLabelForNumber(twilioNumber) : "";
  const shouldDisplayMessage = isVisibleCallTimelineEvent(event);
  const message = shouldDisplayMessage ? createMessageFromEvent(event, conversationLine) : null;

  // Twilio's parent call leg often reports completed/0-duration even when the
  // child leg (the actual conversation) was answered via <Dial>. That produces
  // a false "Missed call" that would overwrite the correct "Inbound call" from
  // the earlier Dial action callback. Detect and suppress the false positive.
  //
  // Additionally, parent-call status callbacks (no DialCallStatus) should never
  // overwrite a more specific message that originated from a Dial action
  // callback — the Dial callback has the accurate outcome/duration.
  //
  // An initial incoming_call placeholder ("Inbound call", no duration) is NOT
  // considered "specific" and CAN be replaced by a terminal event.
  let isSuppressed = false;
  if (message && event.callSid) {
    const existingMsg = nextConversation.messages.find((m) => m.id === message.id);
    if (existingMsg) {
      const isExistingSpecific = existingMsg.status === "missed" || existingMsg.body.includes("\u00b7");
      const isParentCallEvent = event.type === "call_status" && !event.payload.DialCallStatus;
      // Don't let a parent-call callback overwrite a Dial-action result
      if (isParentCallEvent && isExistingSpecific) {
        isSuppressed = true;
      }
      // Don't let a "missed" status overwrite a non-missed specific result
      if (message.status === "missed" && isExistingSpecific && existingMsg.status !== "missed") {
        isSuppressed = true;
      }
    }
  }
  const effectiveMessage = isSuppressed ? null : message;

  // When a call_note event carries a disposition, propagate it to the matching call row
  const noteDisposition = event.type === "call_note" && event.callSid && typeof event.payload?.disposition === "string" ? event.payload.disposition : undefined;
  // When a call_recording event arrives, attach its recordingUrl to the matching call row
  const recordingUrl = event.type === "call_recording" && event.callSid && event.recordingUrl ? event.recordingUrl : undefined;

  const nextMessages = effectiveMessage ? [...nextConversation.messages.filter((item) => {
    if (item.id === effectiveMessage.id) return false;
    // Replace optimistic outbound message when server confirmation arrives
    if (event.messageSid && item.direction === "outbound" && effectiveMessage.direction === "outbound" && item.body === effectiveMessage.body && !item.id.startsWith("SM")) return false;
    return true;
  }).map((m) => {
    if (m.id !== "call-" + event.callSid) return m;
    let updated = m;
    if (noteDisposition) updated = { ...updated, disposition: noteDisposition };
    if (recordingUrl && !updated.recordingUrl) updated = { ...updated, recordingUrl };
    return updated;
  }), effectiveMessage].slice(-50) : nextConversation.messages.map((m) => {
    if (m.id !== "call-" + event.callSid) return m;
    let updated = m;
    if (noteDisposition) updated = { ...updated, disposition: noteDisposition };
    if (recordingUrl && !updated.recordingUrl) updated = { ...updated, recordingUrl };
    return updated;
  });
  const channels = Array.from(new Set([...nextConversation.channels, channel]));

  const nextCallSids = event.callSid && !nextConversation.callSids?.includes(event.callSid)
    ? [...(nextConversation.callSids || []), event.callSid]
    : nextConversation.callSids || [];

  // Read state comes from the shared DB (conversation_read_states) so unread /
  // missed status is consistent across devices and survives a refresh. An
  // inbound message/call only counts as unread if it arrived AFTER the last
  // time the conversation was opened.
  const readAt = nextConversation.readAt ?? readStates?.[id];
  const isAfterRead = !readAt || event.createdAt > readAt;
  const countsAsUnread = Boolean(effectiveMessage) && event.direction === "inbound" && !isMissedCallEvent(event) && isAfterRead;
  const lastMissedAt = (isMissedCallEvent(event) && !isSuppressed) ? event.createdAt : nextConversation.lastMissedAt;
  const lastAnsweredAt = isAnsweredCallEvent(event) ? event.createdAt : nextConversation.lastAnsweredAt;

  // Determine whether this event represents meaningful new activity that
  // should update the conversation's position in the inbox — even when the
  // event itself doesn't produce a visible timeline message.
  const isNewActivity = (() => {
    if (effectiveMessage) return true;
    if (event.type === "message_status") return false;
    if (event.type === "call_recording" && event.status === "completed") return true;
    if (event.type === "call_status") {
      const s = (event.status || "").toLowerCase();
      return ["completed", "no-answer", "busy", "failed", "canceled", "forwarded"].includes(s);
    }
    return false;
  })();

  const updated: ConversationRecord = {
    ...nextConversation,
    id,
    lastMessage: effectiveMessage?.body || nextConversation.lastMessage,
    lastActivityAt: isNewActivity ? formatActivityTime(event.createdAt) : nextConversation.lastActivityAt,
    lastActivityIso: isNewActivity ? event.createdAt : nextConversation.lastActivityIso,
    unreadCount: countsAsUnread ? nextConversation.unreadCount + 1 : nextConversation.unreadCount,
    isMissedCall: isMissedCallOutstanding(lastMissedAt, lastAnsweredAt, readAt),
    readAt,
    lastMissedAt,
    lastAnsweredAt,
    twilioNumber,
    channels,
    messages: nextMessages,
    callSids: nextCallSids,
  };

  if (isNewActivity) {
    return [updated, ...current.filter((conversation) => conversation.id !== id)];
  }
  return current.map((conversation) => conversation.id === id ? updated : conversation);
}

function createLocalCommunicationEvent(type: TwilioConversationEvent["type"], phone: string, body: string, direction: "inbound" | "outbound" = "outbound"): TwilioConversationEvent {
  return {
    id: crypto.randomUUID(),
    type,
    direction,
    from: direction === "outbound" ? "XRP Roofing" : phone,
    to: direction === "outbound" ? phone : "XRP Roofing",
    body,
    status: type.includes("call") ? "initiated" : "sent",
    payload: {},
    createdAt: new Date().toISOString(),
  };
}

function ContactPanel({ conversation, onDial, onContactChange, onSchedule }: { conversation: ConversationRecord; onDial: (conversation: ConversationRecord) => void; onContactChange: (field: keyof ConversationRecord["contact"], value: string) => void; onSchedule: () => void }) {
  const contact = conversation.contact;
  return (
    <aside className="space-y-4 xl:h-full xl:overflow-y-auto xl:pr-1">
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><UserRound className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <input value={contact.name} onChange={(event) => onContactChange("name", event.target.value)} className="w-full rounded-lg border border-transparent bg-transparent px-1 text-lg font-bold text-gray-950 outline-none transition hover:border-gray-200 focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50" />
            <button onClick={() => onDial(conversation)} className="mt-1 inline-flex items-center text-sm font-medium text-blue-700 hover:text-blue-800"><Phone className="mr-1.5 h-3.5 w-3.5" />{contact.phone}</button>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-bold text-gray-950">Contact Info</h3>
        <div className="mt-4 space-y-4">
          <EditableDetailRow label="Email" value={contact.email} onChange={(value) => onContactChange("email", value)} />
          <EditableDetailRow label="Address" value={contact.address} onChange={(value) => onContactChange("address", value)} />
          <EditableDetailRow label="Lead source" value={contact.leadSource} onChange={(value) => onContactChange("leadSource", value)} />
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-bold text-gray-950">Job Details</h3>
        <div className="mt-4 space-y-4">
          <EditableDetailRow label="Roof type" value={contact.roofType} onChange={(value) => onContactChange("roofType", value)} />
          <EditableDetailRow label="Assigned rep" value={contact.assignedRep} onChange={(value) => onContactChange("assignedRep", value)} />
          <EditableDetailRow label="Insurance" value={contact.insuranceStatus} onChange={(value) => onContactChange("insuranceStatus", value)} />
          <EditableDetailRow label="Job status" value={contact.jobStatus} onChange={(value) => onContactChange("jobStatus", value)} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">{contact.tags.slice(0, 3).map((tag) => <Badge key={tag} tone="slate">{tag}</Badge>)}</div>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-bold text-gray-950">Activity Timeline</h3>
        <div className="mt-4 space-y-3">
          {conversation.messages.slice(0, 3).map((message) => <div key={message.id} className="border-l-2 border-gray-200 pl-3"><p className="text-sm text-gray-700">{message.body.length > 120 ? message.body.slice(0, 120) + "\u2026" : message.body}</p><p className="mt-1 text-xs text-gray-500">{message.timestamp}{message.line && <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">{message.line}</span>}{message.status === "delivered" && <span className="ml-1.5 text-green-600">Delivered</span>}{message.status === "sent" && <span className="ml-1.5">Sent</span>}{message.status === "missed" && message.channel === "sms" && <span className="ml-1.5 text-red-500">Failed</span>}</p></div>)}
        </div>
      </Card>

      <SchedulerPanel onSchedule={onSchedule} />
    </aside>
  );
}

type RingtoneController = { stop: () => void };

function playRingtone(): RingtoneController | null {
  if (typeof window === "undefined") return null;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  let stopped = false;
  const ctx = new AudioCtx();
  void ctx.resume();

  function ringOnce() {
    if (stopped) return;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.05);
    gain.gain.setValueAtTime(0.3, now + 1.9);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 2);

    for (const frequency of [440, 480]) {
      const oscillator = ctx.createOscillator();
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start(now);
      oscillator.stop(now + 2);
    }
  }

  ringOnce();
  const interval = window.setInterval(ringOnce, 6000);

  return {
    stop() {
      stopped = true;
      window.clearInterval(interval);
      ctx.close().catch(() => undefined);
    },
  };
}

export default function ConversationBoard() {
  const sharedDevice = useVoiceDevice();
  const browserCallRef = useRef<BrowserVoiceCall | null>(null);
  const ringtoneRef = useRef<RingtoneController | null>(null);
  const messageBoardRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const initialConversations = useMemo<ConversationRecord[]>(() => [], []);
  const [conversations, setConversations] = useState<ConversationRecord[]>(initialConversations);
  const [activeConversationId, setActiveConversationId] = useState("");
  const active = conversations.find((conversation) => conversation.id === activeConversationId) || conversations[0];
  const liveCustomerLookupRef = useRef<Map<string, Customer>>(new Map());
  const contactEditsRef = useRef<Record<string, ContactEdit>>({});

  function scrollMessageBoardToBottom() {
    requestAnimationFrame(() => {
      messageBoardRef.current?.scrollTo({ top: messageBoardRef.current.scrollHeight, behavior: "smooth" });
    });
  }
  const [isDialerOpen, setIsDialerOpen] = useState(false);
  const [isDialerMinimized, setIsDialerMinimized] = useState(false);
  const [isActiveCall, setIsActiveCall] = useState(false);
  const [isHeld, setIsHeld] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [callSid, setCallSid] = useState<string>();
  const [messageText, setMessageText] = useState("");
  const [pendingMedia, setPendingMedia] = useState<File[]>([]);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [twilioNotice, setTwilioNotice] = useState("Twilio realtime ready");
  const [dialNumber, setDialNumber] = useState("");
  const [forwardNumber, setForwardNumber] = useState("");
  const [callNotes, setCallNotes] = useState("");
  const [callDisposition, setCallDisposition] = useState("");
  const [showMobileThread, setShowMobileThread] = useState(false);
  const [showMobileContact, setShowMobileContact] = useState(false);
  const [inboxCollapsed, setInboxCollapsed] = useState(false);
  const [incomingCall, setIncomingCall] = useState<BrowserVoiceCall | null>(null);
  const [incomingFrom, setIncomingFrom] = useState("");
  const [callInsights, setCallInsights] = useState<TwilioConversationEvent[]>([]);
  const [inboundReady, setInboundReady] = useState(false);
  const twilioLines = useMemo(() => getTwilioLines(), []);
  const [selectedFromNumber, setSelectedFromNumber] = useState(() => twilioLines[0]?.number || "");
  const [fromDropdownOpen, setFromDropdownOpen] = useState(false);
  const [selectedCallInsight, setSelectedCallInsight] = useState<TwilioConversationEvent | null>(null);
  const router = useRouter();
  const [stageMenuOpen, setStageMenuOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [scheduleForm, setScheduleForm] = useState({ title: "", date: "", startTime: "", endTime: "", jobKind: appointmentTypes[0], notes: "" });
  const [newConvoOpen, setNewConvoOpen] = useState(false);
  const [newConvoName, setNewConvoName] = useState("");
  const [newConvoPhone, setNewConvoPhone] = useState("");
  const [newConvoError, setNewConvoError] = useState("");
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return "default";
    return Notification.permission;
  });
  const [showDispositionModal, setShowDispositionModal] = useState(false);
  const [dispositionCallSid, setDispositionCallSid] = useState<string>();
  const [dispositionSaving, setDispositionSaving] = useState(false);
  const matchedDialContact = findCrmContactByPhone(dialNumber) || conversations.find((conversation) => normalizePhone(conversation.contact.phone) === normalizePhone(dialNumber))?.contact;

  // Auto-select the From number based on the active conversation's line
  useEffect(() => {
    if (active?.twilioNumber) setSelectedFromNumber(active.twilioNumber); // eslint-disable-line react-hooks/set-state-in-effect
    else if (twilioLines.length > 0) setSelectedFromNumber(twilioLines[0].number);
  }, [activeConversationId, active?.twilioNumber, twilioLines]);

  useEffect(() => {
    try { if (localStorage.getItem("xrp.conv.inboxCollapsed") === "1") setInboxCollapsed(true); } catch {}
  }, []);
  const toggleInboxCollapsed = useCallback(() => {
    setInboxCollapsed((value) => {
      const next = !value;
      try { localStorage.setItem("xrp.conv.inboxCollapsed", next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);

  function stopIncomingAlert() {
    navigator.vibrate?.(0);
    ringtoneRef.current?.stop();
    ringtoneRef.current = null;
  }

  const notifyIncomingCall = useCallback((from: string) => {
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    navigator.serviceWorker.ready.then((registration) => {
      registration.showNotification("Incoming call", {
        body: `Call from ${from || "Unknown caller"}`,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: "incoming-call",
        requireInteraction: true,
        data: { url: "/crm/conversations" },
      });
    }).catch(() => undefined);
  }, []);

  async function handleEnableNotifications() {
    if (!("Notification" in window)) {
      setTwilioNotice("Notifications are not supported on this device/browser");
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission !== "granted") {
      setTwilioNotice("Mobile notifications are blocked in browser settings");
      return;
    }

    try {
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) throw new Error("VAPID public key is not configured");

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      });

      if (!response.ok) throw new Error("Unable to save mobile push subscription");
      setTwilioNotice("Mobile call notifications enabled");
    } catch (error) {
      setTwilioNotice(error instanceof Error ? error.message : "Mobile push setup failed");
    }
  }

  const startIncomingAlert = useCallback((from: string) => {
    navigator.vibrate?.([500, 200, 500, 200, 500, 200, 500]);
    notifyIncomingCall(from);
    ringtoneRef.current?.stop();
    ringtoneRef.current = playRingtone();
  }, [notifyIncomingCall]);

  function markConversationRead(conversationId: string) {
    // Opening a conversation marks it read AND reviews any missed call. We stamp
    // readAt locally for instant feedback and persist to the shared DB so every
    // device (and a refresh) reflects the same state.
    const readAt = new Date().toISOString();
    setConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, unreadCount: 0, isMissedCall: false, readAt } : conversation));
    void persistConversationRead(conversationId);
  }

  async function handleDeleteConversation(conversation: ConversationRecord) {
    try {
      const res = await fetch("/api/twilio/conversations/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conversation.id, phone: conversation.contact.phone }),
      });
      if (!res.ok) throw new Error("Delete failed");
      setConversations((current) => current.filter((c) => c.id !== conversation.id));
      if (activeConversationId === conversation.id) {
        setActiveConversationId("");
      }
    } catch (error) {
      console.error("[Conversation Delete]", error);
    }
  }

  function handleSelectConversation(conversation: ConversationRecord) {
    setActiveConversationId(conversation.id);
    setDialNumber(conversation.contact.phone);
    setShowMobileThread(true);
    markConversationRead(conversation.id);
  }

  function handleContactChange(field: keyof ConversationRecord["contact"], value: string) {
    if (!active) return;

    setConversations((current) => current.map((conversation) => conversation.id === active.id ? { ...conversation, contact: { ...conversation.contact, [field]: value } } : conversation));

    // Persist to Supabase (cross-device) + localStorage (fallback).
    const phone = active.contact.phone;
    const edit: ContactEdit = { ...(contactEditsRef.current[active.id] || {} as ContactEdit), phone, [field]: value };
    contactEditsRef.current[active.id] = edit;
    void saveContactEdit(active.id, edit);
  }

  function handleMoveStage(stage: string) {
    handleContactChange("jobStatus", stage);
    setStageMenuOpen(false);
    setTwilioNotice(`Stage moved to ${stage}`);
  }

  function openScheduleModal() {
    if (!active) return;
    const today = new Date().toISOString().slice(0, 10);
    setScheduleForm({
      title: `Roof inspection — ${active.contact.name}`,
      date: today,
      startTime: "09:00",
      endTime: "10:00",
      jobKind: appointmentTypes[0],
      notes: active.contact.notes || "",
    });
    setScheduleError("");
    setScheduleOpen(true);
  }

  async function handleSaveSchedule(event?: React.FormEvent) {
    event?.preventDefault();
    if (!active) return;
    setScheduleSaving(true);
    setScheduleError("");
    try {
      const response = await fetch("/api/google-calendar/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: scheduleForm.title.trim() || `Appointment — ${active.contact.name}`,
          name: active.contact.name,
          phone: active.contact.phone,
          address: active.contact.address || active.contact.name,
          jobKind: scheduleForm.jobKind,
          date: scheduleForm.date,
          startTime: scheduleForm.startTime,
          endTime: scheduleForm.endTime,
          notes: scheduleForm.notes,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setScheduleError(data.error || "Unable to create the appointment. Connect Google Calendar on the Calendar board first.");
        return;
      }
      setScheduleOpen(false);
      setTwilioNotice("Appointment added to the CRM calendar");
    } catch {
      setScheduleError("Unable to create the appointment.");
    } finally {
      setScheduleSaving(false);
    }
  }

  function handleCreateEstimate() {
    if (!active) return;
    const contact = active.contact;
    const id = `P-${Date.now()}`;
    const history = active.messages
      .filter((message) => message.body)
      .slice(-8)
      .map((message) => `${message.author}: ${message.body}`)
      .join("\n");
    // A proposal IS the estimate + proposal draft on the Estimates board. Created
    // as a Draft (never auto-sent) and fully editable there.
    const proposal = {
      id,
      customerName: contact.name,
      customerEmail: contact.email || "",
      customerPhone: contact.phone || "",
      address: contact.address || "",
      scope: `Roofing scope for ${contact.roofType || "the property"} at ${contact.address || contact.name}. Edit to add line items and pricing.`,
      total: 0,
      status: "Draft" as const,
      template: "Standard",
      title: `${contact.name} Roofing Estimate`,
      summary: `Prepared for ${contact.name}${contact.roofType ? ` — ${contact.roofType}` : ""}.`,
      coverPhoto: "",
      coverText: "",
      notes: history ? `From conversation:\n${history}` : "",
      terms: "",
    };
    try {
      const existing = JSON.parse(window.localStorage.getItem("xrp-crm-proposals") || "[]") as unknown[];
      window.localStorage.setItem("xrp-crm-proposals", JSON.stringify([proposal, ...existing]));
    } catch {
      /* ignore storage failures; server upsert still runs */
    }
    void upsertProposalRecord(proposal);
    setTwilioNotice(`Estimate draft created for ${contact.name}`);
    router.push("/crm/proposals");
  }

  function applyLocalEvent(event: TwilioConversationEvent) {
    const phone = getEventPhone(event);
    const conversationId = getConversationIdForPhone(phone);
    addTwilioCrmNotification(event);
    setConversations((current: ConversationRecord[]) => upsertConversationFromEvent(current, event, undefined, liveCustomerLookupRef.current));
    setActiveConversationId(conversationId);
  }

  useEffect(() => {
    let mounted = true;

    // Load live customers + saved contact edits + conversation events in parallel
    Promise.all([listConversationEvents(), listConversationReadStates(), loadLiveCustomers(), loadContactEdits()]).then(([events, readStates, liveCustomers, savedEdits]) => {
      if (!mounted) return;

      liveCustomerLookupRef.current = buildPhoneLookup(liveCustomers);
      contactEditsRef.current = savedEdits;

      const rawConversations = events.reduce<ConversationRecord[]>((current, event) => upsertConversationFromEvent(current, event, readStates, liveCustomerLookupRef.current), []);
      const savedConversations = [...rawConversations].sort((a, b) => {
        const ta = a.lastActivityIso ? new Date(a.lastActivityIso).getTime() : 0;
        const tb = b.lastActivityIso ? new Date(b.lastActivityIso).getTime() : 0;
        return tb - ta;
      });
      setConversations(savedConversations.map((conversation) => savedEdits[conversation.id] ? { ...conversation, contact: { ...conversation.contact, ...savedEdits[conversation.id] } } : conversation));
      setCallInsights(dedupeCallInsights(events.filter((event) => event.type === "call_recording")));
      setActiveConversationId((current: string) => current || savedConversations[0]?.id || "");
      setTwilioNotice(savedConversations.length ? "Saved call and message history loaded" : "Ready for new calls and messages");
      scrollMessageBoardToBottom();
    }).catch((error) => {
      if (mounted) setTwilioNotice(error instanceof Error ? `Call history sync issue: ${error.message}` : "Call history sync issue");
    });

    return () => {
      mounted = false;
    };
  }, []);

  // Re-fetch events when the browser tab regains focus to catch anything
  // missed while the tab was in the background (covers cross-device sync
  // and dropped real-time connections).
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      Promise.all([listConversationEvents(), listConversationReadStates(), loadLiveCustomers(), loadContactEdits()]).then(([events, readStates, liveCustomers, savedEdits]) => {
        liveCustomerLookupRef.current = buildPhoneLookup(liveCustomers);
        contactEditsRef.current = savedEdits;
        const rawConversations = events.reduce<ConversationRecord[]>((current, event) => upsertConversationFromEvent(current, event, readStates, liveCustomerLookupRef.current), []);
        const sorted = [...rawConversations].sort((a, b) => {
          const ta = a.lastActivityIso ? new Date(a.lastActivityIso).getTime() : 0;
          const tb = b.lastActivityIso ? new Date(b.lastActivityIso).getTime() : 0;
          return tb - ta;
        });
        setConversations(sorted.map((conversation) => savedEdits[conversation.id] ? { ...conversation, contact: { ...conversation.contact, ...savedEdits[conversation.id] } } : conversation));
        setCallInsights(dedupeCallInsights(events.filter((event) => event.type === "call_recording")));
      }).catch(() => {});
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // Refresh relative timestamps ("3 min ago") every 60 seconds so they
  // stay accurate without a page reload.
  useEffect(() => {
    const interval = setInterval(() => {
      setConversations((current: ConversationRecord[]) =>
        current.map((conversation) =>
          conversation.lastActivityIso
            ? { ...conversation, lastActivityAt: formatActivityTime(conversation.lastActivityIso) }
            : conversation
        )
      );
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    try {
      return subscribeToConversationEvents((event: TwilioConversationEvent) => {
        setTwilioNotice(`${event.type.replace("_", " ")} synced${event.status ? `: ${event.status}` : ""}`);
        addTwilioCrmNotification(event);
        setConversations((current: ConversationRecord[]) => {
          const next = upsertConversationFromEvent(current, event, undefined, liveCustomerLookupRef.current);
          // Re-sort so the conversation with the most recent activity is
          // always at the top, regardless of which event type triggered it.
          next.sort((a, b) => {
            const ta = a.lastActivityIso ? new Date(a.lastActivityIso).getTime() : 0;
            const tb = b.lastActivityIso ? new Date(b.lastActivityIso).getTime() : 0;
            return tb - ta;
          });
          if (!activeConversationId && next[0]) queueMicrotask(() => setActiveConversationId(next[0].id));
          return next;
        });
        scrollMessageBoardToBottom();
        if (event.type === "call_recording") {
          setCallInsights((current: TwilioConversationEvent[]) => dedupeCallInsights([event, ...current]));
        }
        if (event.type === "incoming_call") {
          notifyIncomingCall(getEventPhone(event));
          navigator.vibrate?.([500, 200, 500, 200, 500]);
        }
      });
    } catch {
      queueMicrotask(() => setTwilioNotice("Call history syncs automatically after each call"));
    }
  }, [activeConversationId, notifyIncomingCall]);

  // Cross-device sync: when another device saves a contact name, re-apply edits
  useEffect(() => {
    return subscribeToContactEdits(() => {
      loadContactEdits().then((savedEdits) => {
        contactEditsRef.current = savedEdits;
        setConversations((current) =>
          current.map((conversation) =>
            savedEdits[conversation.id]
              ? { ...conversation, contact: { ...conversation.contact, ...savedEdits[conversation.id] } }
              : conversation
          )
        );
      }).catch(() => {});
    });
  }, []);

  useEffect(() => {
    scrollMessageBoardToBottom();
  }, [activeConversationId]);

  // When another device opens a conversation, mark it read here too (in real
  // time) so read/unread + missed status stays consistent across all devices.
  useEffect(() => {
    try {
      return subscribeToConversationReadStates((conversationId, readAt) => {
        setConversations((current: ConversationRecord[]) => current.map((conversation: ConversationRecord) => conversation.id === conversationId ? { ...conversation, unreadCount: 0, isMissedCall: false, readAt } : conversation));
      });
    } catch {
      /* realtime read-state sync unavailable; falls back to per-load read state */
    }
  }, []);


  useEffect(() => {
    const id = window.setInterval(() => {
      setConversations((current: ConversationRecord[]) =>
        current.map((conversation: ConversationRecord) =>
          conversation.lastActivityIso
            ? { ...conversation, lastActivityAt: formatActivityTime(conversation.lastActivityIso) }
            : conversation
        )
      );
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Incoming call transfer removed — CrmShell FloatingCallCard owns active incoming call state.

  // Device is now owned by CrmShell and shared via VoiceDeviceContext.
  // Mark inbound as ready if the shared device exists.
  useEffect(() => {
    if (sharedDevice?.deviceRef.current) {
      setInboundReady(true);
      setTwilioNotice("Ready for inbound calls");
    }
  }, [sharedDevice]);

  async function handleStartCall() {
    const destination = dialNumber.trim();
    if (!destination) {
      setTwilioNotice("Enter a phone number before dialing.");
      return;
    }

    setTwilioNotice("Starting Twilio call...");
    applyLocalEvent(createLocalCommunicationEvent("call_status", destination, `Dialed ${destination}`));
    try {
      const device = sharedDevice?.deviceRef.current || await createBrowserVoiceDevice("crm-agent");
      const connectParams: Record<string, string> = { To: destination };
      const callerId = selectedFromNumber || active?.twilioNumber;
      if (callerId) connectParams.CallerId = callerId;
      const call = await device.connect({ params: connectParams });
      browserCallRef.current = call as unknown as BrowserVoiceCall;
      setIsActiveCall(true);
      setIsHeld(false);
      setIsMuted(false);
      setTwilioNotice("Browser call connected. Your microphone is linked to Twilio.");
      void logCrewActivity({ jobId: active?.id || "", jobName: active?.contact.name || destination, actor: "Office", action: "Outbound call placed", details: `Called ${destination}${callerId ? ` from ${callerId}` : ""}`, module: "Calls" }).catch(() => {});
      call.on("accept", () => {
        const sid = (call as unknown as BrowserVoiceCall).parameters?.CallSid;
        if (sid) setCallSid(sid);
      });
      call.on("disconnect", () => {
        browserCallRef.current = null;
        setIsActiveCall(false);
        setIsHeld(false);
        setIsMuted(false);
        const sid = (call as unknown as BrowserVoiceCall).parameters?.CallSid;
        if (sid) setDispositionCallSid(sid);
        setShowDispositionModal(true);
        setTwilioNotice("Call ended — select a disposition");
      });
      call.on("error", (error) => {
        setTwilioNotice(error instanceof Error ? error.message : "Browser call error");
      });
    } catch (error) {
      try {
        const fallbackCall = await startOutboundCall({ to: destination, from: selectedFromNumber || active?.twilioNumber || undefined, conversationId: matchedDialContact ? active.id : undefined });
        setCallSid(fallbackCall.sid);
        setIsActiveCall(true);
        setIsHeld(false);
        setIsMuted(false);
        setTwilioNotice(`Server call ${fallbackCall.status}. Browser audio was not connected.`);
      } catch {
        setIsActiveCall(false);
        setIsHeld(false);
        setIsMuted(false);
        setCallSid(undefined);
        setCallNotes("");
        setCallDisposition("");
        setTwilioNotice(error instanceof Error ? error.message : "Twilio call unavailable");
      }
    }
  }

  function handleAnswerIncomingCall() {
    if (!incomingCall) return;

    stopIncomingAlert();
    incomingCall.accept();
    applyLocalEvent(createLocalCommunicationEvent("incoming_call", incomingCall.parameters?.From || incomingFrom, `Received call from ${incomingCall.parameters?.From || incomingFrom}`, "inbound"));
    browserCallRef.current = incomingCall;
    setCallSid(incomingCall.parameters?.CallSid);
    setDialNumber(incomingCall.parameters?.From || "");
    setIncomingCall(null);
    setIncomingFrom("");
    setIsActiveCall(true);
    setIsHeld(false);
    setIsMuted(false);
    setTwilioNotice("Incoming call connected");
    const callerPhone = incomingCall.parameters?.From || incomingFrom;
    void logCrewActivity({ jobId: active?.id || "", jobName: active?.contact.name || callerPhone, actor: "Office", action: "Incoming call answered", details: `Answered call from ${callerPhone}`, module: "Calls" }).catch(() => {});
  }

  function handleDeclineIncomingCall() {
    stopIncomingAlert();
    incomingCall?.reject();
    setIncomingCall(null);
    setIncomingFrom("");
    setTwilioNotice("Incoming call declined");
  }

  async function handleEndCall() {
    browserCallRef.current?.disconnect();
    browserCallRef.current = null;

    if (!callSid) {
      setIsActiveCall(false);
      setIsHeld(false);
      setIsMuted(false);
      return;
    }

    setTwilioNotice("Ending Twilio call...");
    try {
      const result = await controlCall({ callSid, action: "end", conversationId: active.id });
      setIsActiveCall(false);
      setIsHeld(false);
      setIsMuted(false);
      setDispositionCallSid(callSid);
      setShowDispositionModal(true);
      setTwilioNotice(`Call ${result.status} — select a disposition`);
    } catch {
      setIsActiveCall(false);
      setIsHeld(false);
      setIsMuted(false);
      setDispositionCallSid(callSid);
      setShowDispositionModal(true);
      setTwilioNotice("Call ended — select a disposition");
    }
  }

  async function handleHoldCall() {
    if (!callSid || !isActiveCall) return;

    const action = isHeld ? "resume" : "hold";
    setTwilioNotice(`${action === "hold" ? "Holding" : "Resuming"} call...`);
    try {
      await controlCall({ callSid, action, conversationId: active.id });
      setIsHeld(action === "hold");
      setTwilioNotice(action === "hold" ? "Call marked on hold" : "Call resumed");
    } catch (error) {
      setTwilioNotice(error instanceof Error ? error.message : "Call hold control unavailable");
    }
  }

  function handleMuteCall() {
    if (!isActiveCall) return;

    const nextMuted = !isMuted;
    if (browserCallRef.current?.mute) {
      browserCallRef.current.mute(nextMuted);
      setIsMuted(nextMuted);
      setTwilioNotice(nextMuted ? "Microphone muted" : "Microphone unmuted");
    } else {
      setTwilioNotice("Mute is only available for browser calls");
    }
  }

  async function handleForwardCall() {
    if (!callSid || !forwardNumber.trim()) {
      setTwilioNotice("Enter a forwarding number first.");
      return;
    }

    setTwilioNotice("Forwarding call...");
    try {
      const result = await controlCall({ callSid, action: "forward", forwardTo: forwardNumber.trim(), conversationId: active.id });
      setIsActiveCall(false);
      setIsHeld(false);
      setIsMuted(false);
      setCallSid(undefined);
      setTwilioNotice(`Call ${result.status}`);
    } catch (error) {
      setTwilioNotice(error instanceof Error ? error.message : "Call could not be forwarded");
    }
  }

  async function handleSendSms() {
    const destination = dialNumber.trim() || active?.contact.phone || "";
    if ((!messageText.trim() && pendingMedia.length === 0) || !destination) return;
    setTwilioNotice(pendingMedia.length > 0 ? "Uploading media..." : "Sending SMS...");
    const bodyText = messageText.trim() || (pendingMedia.length > 0 ? "" : "");
    applyLocalEvent(createLocalCommunicationEvent("message_status", destination, bodyText || `[${pendingMedia.map((f) => f.name).join(", ")}]`));
    scrollMessageBoardToBottom();
    try {
      let mediaUrls: string[] | undefined;
      if (pendingMedia.length > 0) {
        setMediaUploading(true);
        mediaUrls = await Promise.all(pendingMedia.map((file) => uploadMmsMedia(file)));
        setMediaUploading(false);
        setTwilioNotice("Sending MMS...");
      }
      const fromNumber = selectedFromNumber || active?.twilioNumber || undefined;
      const message = await sendSms({
        to: destination,
        body: bodyText || " ",
        from: fromNumber,
        conversationId: active?.id || getConversationIdForPhone(destination),
        mediaUrl: mediaUrls,
      });
      setMessageText("");
      setPendingMedia([]);
      setTwilioNotice(`SMS ${message.status}`);
      void logCrewActivity({ jobId: active?.id || "", jobName: active?.contact.name || destination, actor: "Office", action: "SMS sent", details: `Sent to ${destination}: ${(bodyText || "[media]").slice(0, 120)}`, module: "SMS" }).catch(() => {});
    } catch (error) {
      setMediaUploading(false);
      setTwilioNotice(error instanceof Error ? error.message : "SMS could not be sent");
    }
  }

  async function handleSaveCallNotes() {
    if (!callSid || !active) return;
    if (!callNotes.trim() && !callDisposition) {
      setTwilioNotice("Add notes or choose a disposition first");
      return;
    }

    try {
      await saveCallNotes({ callSid, conversationId: active.id, notes: callNotes.trim(), disposition: callDisposition });
      setTwilioNotice("Call notes and disposition saved");
    } catch {
      setTwilioNotice("Call notes could not be saved");
    }
  }

  async function handleSubmitDisposition() {
    const sid = dispositionCallSid || callSid;
    if (!sid || !active) {
      closeDispositionModal();
      return;
    }
    if (!callDisposition) {
      setTwilioNotice("Please select a disposition");
      return;
    }
    setDispositionSaving(true);
    try {
      await saveCallNotes({ callSid: sid, conversationId: active.id, notes: callNotes.trim(), disposition: callDisposition });
      setTwilioNotice("Disposition saved");
      void logCrewActivity({ jobId: active.id || "", jobName: active.contact.name || active.contact.phone, actor: "Office", action: `Call disposition: ${callDisposition}`, details: callNotes.trim() || callDisposition, module: "Calls" }).catch(() => {});
    } catch {
      setTwilioNotice("Disposition could not be saved");
    }
    setDispositionSaving(false);
    closeDispositionModal();
  }

  function skipDisposition() {
    closeDispositionModal();
  }

  function closeDispositionModal() {
    setShowDispositionModal(false);
    setDispositionCallSid(undefined);
    setCallSid(undefined);
    setCallNotes("");
    setCallDisposition("");
  }

  function startNewConversation(event?: React.FormEvent) {
    event?.preventDefault();
    const phone = newConvoPhone.trim();
    if (!phone) {
      setNewConvoError("Enter a phone number");
      return;
    }
    const name = newConvoName.trim();
    const base = createManualConversation(phone, liveCustomerLookupRef.current);
    const conversation = name ? { ...base, contact: { ...base.contact, name } } : base;

    setConversations((current) => current.some((item) => item.id === conversation.id)
      ? current.map((item) => item.id === conversation.id ? { ...item, contact: { ...item.contact, ...(name ? { name } : {}) } } : item)
      : [conversation, ...current]);
    setActiveConversationId(conversation.id);
    setDialNumber(phone);
    setShowMobileThread(true);

    if (name) {
      const edit: ContactEdit = { phone, name };
      contactEditsRef.current[conversation.id] = edit;
      void saveContactEdit(conversation.id, edit);
    }

    setNewConvoOpen(false);
    setNewConvoName("");
    setNewConvoPhone("");
    setNewConvoError("");
    setTwilioNotice(`New conversation started with ${name || phone}`);
  }

  function openNewConversation() {
    setNewConvoName("");
    setNewConvoPhone("");
    setNewConvoError("");
    setNewConvoOpen(true);
  }

  function openDialerForConversation(conversation: ConversationRecord) {
    setActiveConversationId(conversation.id);
    setDialNumber(conversation.contact.phone);
    setIsDialerOpen(true);
    setIsDialerMinimized(false);
    setShowMobileThread(true);
  }

  return (
    <div className="-mx-3 -my-4 flex min-h-[calc(100vh-5rem)] flex-1 flex-col overflow-x-clip bg-gray-100 px-3 py-4 font-sans sm:-mx-5 sm:px-5 xl:h-[calc(100vh-8.25rem)] xl:max-h-[calc(100vh-8.25rem)] xl:min-h-0 xl:overflow-hidden">
      {/* Incoming call UI removed — handled globally by CrmShell FloatingCallCard */}
      {isActiveCall && (
        <div className="sticky top-20 z-40 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-600 px-4 py-3 text-white shadow-sm">
          <div className="flex items-center gap-3"><span className="h-2.5 w-2.5 rounded-full bg-blue-300" /><span className="text-sm font-semibold">Active call with {matchedDialContact?.name || dialNumber}</span><Badge tone="green"><Clock className="mr-1 h-3 w-3" />{isHeld ? "Held" : "Live"}</Badge></div>
          <div className="flex gap-2"><Button variant="ghost" className="text-white hover:bg-blue-500" onClick={handleMuteCall}><Mic className="mr-1 h-3 w-3" />{isMuted ? "Unmute" : "Mute"}</Button><Button variant="ghost" className="text-white hover:bg-blue-500" onClick={() => { setIsDialerOpen(true); setIsDialerMinimized(false); }}>Notes / Forward</Button><button onClick={handleEndCall} className="inline-flex items-center rounded-lg bg-gray-950 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-gray-800"><PhoneOff className="mr-1.5 h-4 w-4" />End</button></div>
        </div>
      )}

      <div className={`${showMobileThread ? "hidden xl:flex" : "flex"} z-30 mb-3 items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5 shadow-sm xl:shrink-0`}>
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="text-lg font-bold tracking-tight text-gray-950 sm:text-xl">Conversations</h1>
          <Badge tone={inboundReady ? "green" : "slate"}>{inboundReady ? "Inbound ready" : "Inbound not connected"}</Badge>
          {notificationPermission !== "granted" && <button onClick={handleEnableNotifications} className="hidden rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 sm:inline">Enable notifications</button>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {twilioNotice && <p className="hidden max-w-xs truncate text-xs font-medium text-blue-700 lg:block">{twilioNotice}</p>}
          <Button variant="primary" onClick={() => { setIsDialerOpen(true); setIsDialerMinimized(false); }}><Phone className="mr-2 h-4 w-4" />Dial</Button>
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-4 xl:min-h-0 xl:flex-1 xl:auto-rows-[minmax(0,1fr)] xl:overflow-hidden ${inboxCollapsed ? "xl:grid-cols-[3rem_minmax(0,1fr)_320px]" : "xl:grid-cols-[300px_minmax(0,1fr)_320px]"}`}>
        <div className={`${showMobileThread ? "hidden xl:block" : "block"} min-w-0 xl:h-full xl:min-h-0 xl:overflow-hidden`}>
          <div className={inboxCollapsed ? "xl:hidden" : "xl:h-full xl:min-h-0"}>
            <ConversationInbox conversations={conversations} active={active} onSelect={handleSelectConversation} onNew={openNewConversation} onCollapse={toggleInboxCollapsed} onDelete={handleDeleteConversation} />
          </div>
          {inboxCollapsed && <CollapsedInboxRail onExpand={toggleInboxCollapsed} onNew={openNewConversation} />}
        </div>
        <main className={`${showMobileThread ? "flex" : "hidden xl:flex"} h-[calc(100dvh-8.5rem)] min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm xl:h-full`}> 
          {active ? (
            <>
              <div className="sticky top-0 z-20 flex flex-col gap-2 border-b border-gray-200 bg-white px-4 py-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-3"><button type="button" onClick={() => { setShowMobileThread(false); setShowMobileContact(false); }} className="rounded-lg border border-gray-200 bg-white p-2 text-gray-600 shadow-sm xl:hidden"><ArrowLeft className="h-4 w-4" /></button><div><p className="text-lg font-bold text-gray-950">{active.contact.name}</p><p className="text-sm text-gray-500"><AddressLink value={active.contact.address} /></p></div></div>
                <div className="flex flex-wrap items-center gap-2"><Button variant="primary" onClick={() => openDialerForConversation(active)}><Phone className="mr-1.5 h-4 w-4" />Call</Button><Button className="xl:hidden" onClick={() => setShowMobileContact(true)}><UserRound className="mr-1.5 h-4 w-4" />Contact</Button><div className="relative"><Button onClick={() => setStageMenuOpen((value) => !value)}>Move stage<ChevronDown className="ml-1 h-4 w-4" /></Button>{stageMenuOpen && (<><button type="button" aria-hidden onClick={() => setStageMenuOpen(false)} className="fixed inset-0 z-20 cursor-default" /><div className="absolute right-0 z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">{pipelineStages.map((stage) => <button key={stage} type="button" onClick={() => handleMoveStage(stage)} className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition hover:bg-gray-50 ${active.contact.jobStatus === stage ? "font-semibold text-blue-700" : "text-gray-700"}`}>{stage}{active.contact.jobStatus === stage && <CheckCheck className="h-4 w-4" />}</button>)}</div></>)}</div><Button onClick={openScheduleModal}><Calendar className="mr-1.5 h-4 w-4" />Schedule</Button><Button onClick={handleCreateEstimate}><FileText className="mr-1.5 h-4 w-4" />Create estimate</Button></div>
              </div>
              <div className="relative min-h-0 flex-1 bg-gray-50"><div ref={messageBoardRef} className="h-full space-y-4 overflow-y-auto overscroll-contain scroll-smooth p-4 pb-16">{(() => { const insights = callInsights.filter((e) => eventMatchesConversation(e, active)); const bySid = new Map<string, TwilioConversationEvent>(); for (const e of insights) if (e.callSid) bySid.set(e.callSid, e); const shown = new Set<string>(); return [...active.messages.flatMap((msg) => { const sid = msg.id.startsWith("call-") ? msg.id.slice(5) : ""; const insight = sid ? bySid.get(sid) : undefined; if (insight) { shown.add(insight.id); return [<MessageRow key={msg.id} message={msg} />, <CallInsightsCard key={insight.id} event={insight} onOpen={setSelectedCallInsight} />]; } return [<MessageRow key={msg.id} message={msg} />]; }), ...insights.filter((e) => !shown.has(e.id)).map((e) => <CallInsightsCard key={e.id} event={e} onOpen={setSelectedCallInsight} />)]; })()}</div><button onClick={scrollMessageBoardToBottom} className="absolute bottom-4 right-4 rounded-full bg-gray-900 px-3 py-2 text-xs font-bold text-white shadow-lg transition hover:bg-gray-800">Latest messages</button></div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center bg-gray-50 p-8 text-center">
              <div className="max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <Phone className="mx-auto h-10 w-10 text-blue-600" />
                <h2 className="mt-3 text-lg font-bold text-gray-950">No conversation selected</h2>
                <p className="mt-2 text-sm leading-6 text-gray-600">Dial a number, receive a call, or send a text. The contact or phone number will appear here with messages, recordings, transcripts, and summaries.</p>
              </div>
            </div>
          )}
          <div className="sticky bottom-0 z-20 border-t border-gray-200 bg-white p-3">
            <div className="mb-2 flex gap-2 overflow-x-auto">{quickTemplates.map((template) => <button key={template} onClick={() => setMessageText((prev: string) => prev ? `${prev} ${template}` : template)} className="shrink-0 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-100">{template}</button>)}</div>
            {!active && <input value={dialNumber} onChange={(event) => setDialNumber(event.target.value)} className="mb-2 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold outline-none transition placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50" placeholder="To: enter any phone number or choose a customer" />}
            {twilioLines.length > 0 && (
              <div className="relative mb-2">
                <button type="button" onClick={() => { if (twilioLines.length > 1) setFromDropdownOpen((v) => !v); }} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100">
                  <Phone className="h-3 w-3 text-gray-400" />
                  <span>From: {twilioLines.find((l) => l.number === selectedFromNumber)?.label || twilioLines[0]?.label || "Select"}</span>
                  {twilioLines.length > 1 && <ChevronDown className={`h-3 w-3 text-gray-400 transition ${fromDropdownOpen ? "rotate-180" : ""}`} />}
                </button>
                {fromDropdownOpen && twilioLines.length > 1 && (
                  <>
                    <button type="button" className="fixed inset-0 z-10" onClick={() => setFromDropdownOpen(false)} />
                    <div className="absolute bottom-full left-0 z-20 mb-1 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                      {twilioLines.map((line) => (
                        <button key={line.number} type="button" onClick={() => { setSelectedFromNumber(line.number); setFromDropdownOpen(false); }} className={`flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-xs transition hover:bg-blue-50 ${selectedFromNumber === line.number ? "bg-blue-50 font-semibold text-blue-700" : "text-gray-700"}`}>
                          <Phone className="h-3 w-3 text-gray-400" />
                          <span>{line.label}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp,application/pdf" multiple className="hidden" onChange={(event: ChangeEvent<HTMLInputElement>) => { const files = event.target.files; if (files) setPendingMedia((prev) => [...prev, ...Array.from(files)]); event.target.value = ""; }} />
            {pendingMedia.length > 0 && (
              <div className="flex flex-wrap gap-2 rounded-t-lg border border-b-0 border-gray-200 bg-gray-50 p-2">
                {pendingMedia.map((file, i) => (
                  <div key={`${file.name}-${i}`} className="group relative">
                    {file.type.startsWith("image/") ? (
                      <img src={URL.createObjectURL(file)} alt={file.name} className="h-16 w-16 rounded-lg border border-gray-200 object-cover" />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-gray-200 bg-white"><FileText className="h-6 w-6 text-gray-400" /><span className="absolute bottom-0.5 left-0.5 right-0.5 truncate text-center text-[9px] font-semibold text-gray-500">{file.name.split(".").pop()?.toUpperCase()}</span></div>
                    )}
                    <button type="button" onClick={() => setPendingMedia((prev) => prev.filter((_, idx) => idx !== i))} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow-sm opacity-0 transition group-hover:opacity-100"><X className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            )}
            <div className={`flex items-end gap-2 ${pendingMedia.length > 0 ? "rounded-b-lg border border-t-0" : "rounded-lg border"} border-gray-200 bg-gray-50 p-2`}><button type="button" onClick={() => setMessageText((prev: string) => `${prev}😊`)} className="rounded-lg p-2.5 text-gray-500 transition hover:bg-white hover:text-blue-700"><Smile className="h-5 w-5" /></button><button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-lg p-2.5 text-gray-500 transition hover:bg-white hover:text-blue-700" title="Attach image or PDF"><Upload className="h-5 w-5" /></button><textarea value={messageText} onChange={(event) => setMessageText(event.target.value)} className="min-h-12 flex-1 resize-none bg-transparent p-2 text-sm outline-none placeholder:text-gray-400" placeholder={pendingMedia.length > 0 ? "Add a caption (optional)..." : "Send SMS or add a note..."} /><button onClick={handleSendSms} disabled={mediaUploading} className="rounded-lg bg-blue-600 p-3 text-white transition hover:bg-blue-700 disabled:opacity-50">{mediaUploading ? <Clock className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}</button></div>
          </div>
        </main>
        {active && <div className="hidden xl:block xl:h-full xl:min-h-0 xl:overflow-y-auto"><ContactPanel conversation={active} onDial={openDialerForConversation} onContactChange={handleContactChange} onSchedule={openScheduleModal} /></div>}
        {active && showMobileContact && (
          <div className="fixed inset-0 z-[60] flex flex-col bg-gray-100 xl:hidden">
            <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
              <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Contact</p><p className="text-base font-bold text-gray-950">{active.contact.name}</p></div>
              <button type="button" onClick={() => setShowMobileContact(false)} aria-label="Close contact" className="rounded-lg border border-gray-200 bg-white p-2 text-gray-600 shadow-sm"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4"><ContactPanel conversation={active} onDial={openDialerForConversation} onContactChange={handleContactChange} onSchedule={openScheduleModal} /></div>
          </div>
        )}
      </div>

      <CallTranscriptModal event={selectedCallInsight} onClose={() => setSelectedCallInsight(null)} onDeleteRecording={async (evt) => {
        try {
          const res = await fetch("/api/twilio/recording/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ callSid: evt.callSid, recordingSid: evt.recordingSid }) });
          if (!res.ok) throw new Error("Delete failed");
          setCallInsights((current) => current.filter((ci) => ci.callSid !== evt.callSid));
        } catch (error) {
          console.error("[Recording Delete]", error);
        }
      }} />

      {newConvoOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/40 p-4" onClick={() => setNewConvoOpen(false)}>
          <form onClick={(event) => event.stopPropagation()} onSubmit={startNewConversation} className="w-full max-w-sm rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
              <p className="text-base font-bold text-gray-950">New conversation</p>
              <button type="button" onClick={() => setNewConvoOpen(false)} className="rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Phone number</span><input value={newConvoPhone} onChange={(event) => { setNewConvoPhone(event.target.value); setNewConvoError(""); }} inputMode="tel" autoFocus className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="(602) 555-0123" /></label>
              <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Name (optional)</span><input value={newConvoName} onChange={(event) => setNewConvoName(event.target.value)} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="Customer name" /></label>
              {newConvoError && <p className="text-sm font-medium text-orange-600">{newConvoError}</p>}
              <p className="text-xs leading-5 text-gray-500">Starts a new SMS conversation. Type your message and tap send.</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
              <Button onClick={() => setNewConvoOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => startNewConversation()}><MessageCircle className="mr-1.5 h-4 w-4" />Start conversation</Button>
            </div>
          </form>
        </div>
      )}

      {scheduleOpen && active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4" onClick={() => setScheduleOpen(false)}>
          <form onClick={(event) => event.stopPropagation()} onSubmit={handleSaveSchedule} className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
              <p className="text-base font-bold text-gray-950">Schedule appointment</p>
              <button type="button" onClick={() => setScheduleOpen(false)} className="rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <p className="text-xs text-gray-500">For {active.contact.name}{active.contact.address ? ` · ${active.contact.address}` : ""}</p>
              <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Title</span><input value={scheduleForm.title} onChange={(event) => setScheduleForm((form) => ({ ...form, title: event.target.value }))} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="Appointment title" /></label>
              <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Type</span><select value={scheduleForm.jobKind} onChange={(event) => setScheduleForm((form) => ({ ...form, jobKind: event.target.value }))} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white">{appointmentTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
              <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Date</span><input type="date" value={scheduleForm.date} onChange={(event) => setScheduleForm((form) => ({ ...form, date: event.target.value }))} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Start</span><input type="time" value={scheduleForm.startTime} onChange={(event) => setScheduleForm((form) => ({ ...form, startTime: event.target.value }))} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" /></label>
                <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-gray-500">End</span><input type="time" value={scheduleForm.endTime} onChange={(event) => setScheduleForm((form) => ({ ...form, endTime: event.target.value }))} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" /></label>
              </div>
              <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Notes</span><textarea value={scheduleForm.notes} onChange={(event) => setScheduleForm((form) => ({ ...form, notes: event.target.value }))} rows={3} className="resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="Optional details" /></label>
              {scheduleError && <p className="text-sm font-medium text-orange-600">{scheduleError}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
              <Button onClick={() => setScheduleOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => handleSaveSchedule()} className={scheduleSaving ? "pointer-events-none opacity-60" : ""}>{scheduleSaving ? "Saving…" : "Save appointment"}</Button>
            </div>
          </form>
        </div>
      )}

      {!isDialerOpen && (
        <div className={`fixed bottom-6 right-6 z-40 flex-col items-end gap-3 ${showMobileThread ? "hidden xl:flex" : "flex"}`}>
          <Link href="/crm/team-chat" className="inline-flex items-center rounded-full bg-blue-600 px-5 py-4 text-sm font-semibold text-white shadow-lg transition hover:bg-blue-900">
            <MessageCircle className="mr-2 h-5 w-5" />Team Chat
          </Link>
          <button onClick={() => setIsDialerOpen(true)} className="inline-flex items-center rounded-full bg-blue-600 px-5 py-4 text-sm font-semibold text-white shadow-lg transition hover:bg-blue-700">
            <Phone className="mr-2 h-5 w-5" />Dial
          </button>
        </div>
      )}
      <FloatingDialer contactName={matchedDialContact?.name} dialNumber={dialNumber} forwardNumber={forwardNumber} callNotes={callNotes} callDisposition={callDisposition} isOpen={isDialerOpen} isMinimized={isDialerMinimized} isActiveCall={isActiveCall} isHeld={isHeld} isMuted={isMuted} callSid={callSid} fromNumber={selectedFromNumber} onFromNumberChange={setSelectedFromNumber} onClose={() => setIsDialerOpen(false)} onMinimize={() => setIsDialerMinimized((value) => !value)} onStartCall={handleStartCall} onEndCall={handleEndCall} onHoldCall={handleHoldCall} onMuteCall={handleMuteCall} onForwardCall={handleForwardCall} onSaveCallNotes={handleSaveCallNotes} onNotesChange={setCallNotes} onDispositionChange={setCallDisposition} onDialNumberChange={setDialNumber} onForwardNumberChange={setForwardNumber} />

      {showDispositionModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-2xl">
            <div className="border-b border-gray-100 px-5 py-4">
              <h3 className="text-lg font-bold text-gray-900">Call Disposition</h3>
              <p className="mt-0.5 text-sm text-gray-500">Select the outcome of this call</p>
            </div>
            <div className="max-h-[50vh] overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-2 gap-2">
                {CALL_DISPOSITIONS.map((d) => (
                  <button key={d} type="button" onClick={() => setCallDisposition(d)} className={`rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition ${callDisposition === d ? "border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-200" : "border-gray-200 bg-white text-gray-700 hover:border-blue-200 hover:bg-blue-50"}`}>
                    <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${getDispositionColor(d)}`} />
                    {d}
                  </button>
                ))}
              </div>
              <div className="mt-4">
                <label className="text-xs font-bold uppercase tracking-wide text-gray-500">Notes (optional)</label>
                <textarea value={callNotes} onChange={(e) => setCallNotes(e.target.value)} className="mt-1 min-h-[72px] w-full rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm outline-none placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100" placeholder="Add call notes..." />
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
              <button type="button" onClick={skipDisposition} className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-500 transition hover:bg-gray-100">Skip</button>
              <button type="button" onClick={handleSubmitDisposition} disabled={!callDisposition || dispositionSaving} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-50">
                {dispositionSaving ? "Saving..." : "Save Disposition"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


