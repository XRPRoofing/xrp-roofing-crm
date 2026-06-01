"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { customers, leads } from "@/lib/crm-data";
import { appointmentTypes, conversationFilters, createConversationFromLead, pipelineStages, quickTemplates } from "@/lib/crm-conversations";
import { controlCall, saveCallNotes, sendSms, startOutboundCall, subscribeToConversationEvents } from "@/lib/twilio/client";
import type { ConversationMessage, ConversationRecord } from "@/types/conversations";
import type { TwilioConversationEvent } from "@/types/twilio-conversations";
import { ArrowLeft, CheckCheck, Clock, FileImage, MessageCircle, Mic, Pause, Phone, PhoneOff, Plus, Search, Send, Smile, Upload, UserRound } from "lucide-react";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>;
}

function Button({ children, variant = "secondary", className = "", onClick }: { children: React.ReactNode; variant?: "primary" | "secondary" | "ghost"; className?: string; onClick?: () => void }) {
  const styles = {
    primary: "bg-blue-600 text-white hover:bg-blue-700",
    secondary: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
    ghost: "text-slate-600 hover:bg-slate-100",
  };
  return <button type="button" onClick={onClick} className={`inline-flex items-center justify-center rounded-xl px-3.5 py-2 text-sm font-semibold transition ${styles[variant]} ${className}`}>{children}</button>;
}

function Badge({ children, tone = "blue" }: { children: React.ReactNode; tone?: "blue" | "slate" | "green" }) {
  const styles = {
    blue: "bg-blue-50 text-blue-700 ring-blue-100",
    slate: "bg-slate-100 text-slate-600 ring-slate-200",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${styles[tone]}`}>{children}</span>;
}

function ConversationInbox({ conversations, active, onSelect }: { conversations: ConversationRecord[]; active: ConversationRecord; onSelect: (conversation: ConversationRecord) => void }) {
  return (
    <Card className="flex min-h-0 flex-col overflow-hidden xl:sticky xl:top-24 xl:h-[calc(100vh-8rem)]">
      <div className="border-b border-slate-200 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Inbox</p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">Conversations</h2>
          </div>
          <Button variant="primary" className="h-10 w-10 p-0"><Plus className="h-4 w-4" /></Button>
        </div>
        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50" placeholder="Search contacts" />
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {conversationFilters.slice(0, 4).map((filter) => <button key={filter} className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-blue-50 hover:text-blue-700">{filter}</button>)}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {conversations.map((conversation) => {
          const selected = conversation.id === active.id;
          const status = conversation.isMissedCall ? "Missed call" : conversation.unreadCount > 0 ? "Unread" : conversation.channels.includes("sms") ? "SMS" : "Call";
          return (
            <button key={conversation.id} type="button" onClick={() => onSelect(conversation)} className={`w-full rounded-xl border p-3 text-left transition ${selected ? "border-blue-200 bg-blue-50 shadow-sm" : "border-transparent bg-white hover:border-slate-200 hover:bg-slate-50"}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="truncate text-base font-bold text-slate-950">{conversation.contact.name}</p>
                <span className="shrink-0 text-xs text-slate-500">{conversation.lastActivityAt}</span>
              </div>
              <p className="mt-1 truncate text-sm font-medium text-slate-700">{conversation.contact.phone}</p>
              <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{conversation.contact.address}</p>
              <p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-600">{conversation.lastMessage}</p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500">{status}</span>
                {conversation.unreadCount > 0 && <Badge>{conversation.unreadCount} new</Badge>}
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function MessageRow({ message }: { message: ConversationMessage }) {
  const outbound = message.direction === "outbound";
  const internal = message.direction === "internal";

  if (internal) {
    return (
      <div className="flex justify-center">
        <div className="max-w-[86%] rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-500">
          <span className="font-medium">{message.timestamp}</span> · {message.body}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[78%] rounded-2xl px-4 py-3 ${outbound ? "bg-blue-600 text-white" : "border border-slate-200 bg-white text-slate-800 shadow-sm"}`}>
        <div className={`mb-1 flex items-center gap-2 text-xs ${outbound ? "text-blue-100" : "text-slate-500"}`}><span>{message.author}</span><span>{message.timestamp}</span>{message.status === "delivered" && <CheckCheck className="h-3 w-3" />}</div>
        <p className="text-sm leading-6">{message.body}</p>
        {message.attachments && <div className="mt-3 flex flex-wrap gap-2">{message.attachments.map((item) => <span key={item} className="inline-flex items-center gap-1 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200"><FileImage className="h-3 w-3 text-blue-600" />{item}</span>)}</div>}
      </div>
    </div>
  );
}

function FloatingDialer({ contact, dialNumber, isOpen, isMinimized, isActiveCall, isHeld, callSid, onClose, onMinimize, onStartCall, onEndCall, onHoldCall, onNotesChange, onDialNumberChange }: { contact: ConversationRecord["contact"]; dialNumber: string; isOpen: boolean; isMinimized: boolean; isActiveCall: boolean; isHeld: boolean; callSid?: string; onClose: () => void; onMinimize: () => void; onStartCall: () => void; onEndCall: () => void; onHoldCall: () => void; onNotesChange: (notes: string) => void; onDialNumberChange: (value: string) => void }) {
  if (!isOpen) return null;

  const keys = "123456789*0#".split("");

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 sm:inset-auto sm:bottom-6 sm:right-6 sm:w-[340px]">
      <Card className="overflow-hidden border-blue-100 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Dialer</p>
            <input value={dialNumber} onChange={(event) => onDialNumberChange(event.target.value)} className="mt-1 w-full bg-transparent text-lg font-bold text-slate-950 outline-none" aria-label="Dial number" />
          </div>
          <div className="flex items-center gap-1">
            {isActiveCall && <Badge tone="green"><Clock className="mr-1 h-3 w-3" />{isHeld ? "Held" : "Live"}</Badge>}
            <button onClick={onMinimize} className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100">{isMinimized ? "Open" : "Min"}</button>
            <button onClick={onClose} className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100">×</button>
          </div>
        </div>
        {!isMinimized && (
          <div className="p-3">
            <p className="mb-2 text-xs text-slate-500">Calling as XRP Roofing · {contact.name}</p>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button onClick={onStartCall} className="rounded-xl bg-blue-600 px-3 py-3 text-sm font-bold text-white transition hover:bg-blue-700"><Phone className="mr-2 inline h-4 w-4" />Dial number</button>
              <button onClick={onEndCall} disabled={!isActiveCall} className="rounded-xl bg-slate-900 px-3 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"><PhoneOff className="mr-2 inline h-4 w-4" />End</button>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-base font-semibold">{keys.map((key) => <button key={key} onClick={() => onDialNumberChange(`${dialNumber}${key}`)} className="rounded-xl border border-slate-200 bg-slate-50 py-2.5 text-slate-800 transition hover:bg-blue-50 hover:text-blue-700">{key}</button>)}</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50"><Mic className="mx-auto h-4 w-4" /></button>
              <button onClick={onHoldCall} disabled={!isActiveCall || !callSid} className={`rounded-xl border border-slate-200 p-2.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${isHeld ? "bg-orange-50 text-orange-700" : "text-slate-600"}`}><Pause className="mx-auto h-4 w-4" /></button>
            </div>
            {callSid && <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700">Recording starts automatically when Twilio connects the call. Transcript and summary sync from Twilio webhook data when available.</div>}
            {callSid && <textarea onChange={(event) => onNotesChange(event.target.value)} className="mt-3 min-h-16 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50" placeholder="Type live call notes..." />}
          </div>
        )}
      </Card>
    </div>
  );
}

function SchedulerPanel() {
  return (
    <Card className="p-4">
      <p className="text-sm font-semibold text-slate-950">Schedule appointment</p>
      <div className="mt-3 grid gap-2">
        <input type="date" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none" />
        <input type="time" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none" />
        <select className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none"><option>Johnny Roofer</option><option>Office Coordinator</option></select>
        <select className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none">{appointmentTypes.map((type) => <option key={type}>{type}</option>)}</select>
        <Button variant="primary">Save appointment</Button>
      </div>
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className="text-sm leading-5 text-slate-800">{value}</p></div>;
}

function ContactPanel({ conversation, onDial }: { conversation: ConversationRecord; onDial: (conversation: ConversationRecord) => void }) {
  const contact = conversation.contact;
  return (
    <aside className="space-y-4 xl:sticky xl:top-24 xl:h-[calc(100vh-8rem)] xl:overflow-y-auto xl:pr-1">
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><UserRound className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold text-slate-950">{contact.name}</p>
            <button onClick={() => onDial(conversation)} className="mt-1 inline-flex items-center text-sm font-medium text-blue-700 hover:text-blue-800"><Phone className="mr-1.5 h-3.5 w-3.5" />{contact.phone}</button>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-bold text-slate-950">Contact Info</h3>
        <div className="mt-4 space-y-4">
          <DetailRow label="Email" value={contact.email} />
          <DetailRow label="Address" value={contact.address} />
          <DetailRow label="Lead source" value={contact.leadSource} />
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-bold text-slate-950">Job Details</h3>
        <div className="mt-4 space-y-4">
          <DetailRow label="Roof type" value={contact.roofType} />
          <DetailRow label="Assigned rep" value={contact.assignedRep} />
          <DetailRow label="Insurance" value={contact.insuranceStatus} />
          <DetailRow label="Job status" value={contact.jobStatus} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">{contact.tags.slice(0, 3).map((tag) => <Badge key={tag} tone="slate">{tag}</Badge>)}</div>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-bold text-slate-950">Activity Timeline</h3>
        <div className="mt-4 space-y-3">
          {conversation.messages.slice(0, 3).map((message) => <div key={message.id} className="border-l-2 border-slate-200 pl-3"><p className="text-sm text-slate-700">{message.body}</p><p className="mt-1 text-xs text-slate-500">{message.timestamp}</p></div>)}
        </div>
      </Card>

      <SchedulerPanel />
    </aside>
  );
}

export default function ConversationBoard() {
  const conversations = useMemo(() => leads.map((lead) => createConversationFromLead(lead, customers.find((customer) => customer.name === lead.name))), []);
  const [activeConversationId, setActiveConversationId] = useState(conversations[0]?.id || "");
  const active = conversations.find((conversation) => conversation.id === activeConversationId) || conversations[0];
  const [isDialerOpen, setIsDialerOpen] = useState(false);
  const [isDialerMinimized, setIsDialerMinimized] = useState(false);
  const [isActiveCall, setIsActiveCall] = useState(false);
  const [isHeld, setIsHeld] = useState(false);
  const [callSid, setCallSid] = useState<string>();
  const [messageText, setMessageText] = useState("");
  const [twilioNotice, setTwilioNotice] = useState("Twilio realtime ready");
  const [dialNumber, setDialNumber] = useState(active?.contact.phone || "");
  const [showMobileThread, setShowMobileThread] = useState(false);

  useEffect(() => {
    try {
      return subscribeToConversationEvents((event: TwilioConversationEvent) => {
        setTwilioNotice(`${event.type.replace("_", " ")} synced${event.status ? `: ${event.status}` : ""}`);
      });
    } catch {
      queueMicrotask(() => setTwilioNotice("Realtime subscription waiting for Supabase configuration"));
    }
  }, []);

  async function handleStartCall() {
    setTwilioNotice("Starting Twilio call...");
    try {
      const call = await startOutboundCall({ to: dialNumber || active.contact.phone, conversationId: active.id });
      setCallSid(call.sid);
      setIsActiveCall(true);
      setIsHeld(false);
      setTwilioNotice(`Call ${call.status}`);
    } catch (error) {
      setIsActiveCall(true);
      setIsHeld(false);
      setCallSid(undefined);
      setTwilioNotice(error instanceof Error ? error.message : "Twilio call unavailable");
    }
  }

  async function handleEndCall() {
    if (!callSid) {
      setIsActiveCall(false);
      setIsHeld(false);
      return;
    }

    setTwilioNotice("Ending Twilio call...");
    try {
      const result = await controlCall({ callSid, action: "end", conversationId: active.id });
      setIsActiveCall(false);
      setIsHeld(false);
      setCallSid(undefined);
      setTwilioNotice(`Call ${result.status}`);
    } catch (error) {
      setTwilioNotice(error instanceof Error ? error.message : "Call could not be ended");
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

  async function handleSendSms() {
    if (!messageText.trim()) return;
    setTwilioNotice("Sending SMS...");
    try {
      const message = await sendSms({ to: active.contact.phone, body: messageText.trim(), conversationId: active.id });
      setMessageText("");
      setTwilioNotice(`SMS ${message.status}`);
    } catch (error) {
      setTwilioNotice(error instanceof Error ? error.message : "SMS could not be sent");
    }
  }

  async function handleNotesChange(notes: string) {
    if (!callSid) return;
    try {
      await saveCallNotes({ callSid, conversationId: active.id, notes });
      setTwilioNotice("Call notes auto-saved");
    } catch {
      setTwilioNotice("Call notes waiting for realtime storage");
    }
  }

  function openDialerForConversation(conversation: ConversationRecord) {
    setActiveConversationId(conversation.id);
    setDialNumber(conversation.contact.phone);
    setIsDialerOpen(true);
    setIsDialerMinimized(false);
    setShowMobileThread(true);
  }

  return (
    <div className="-mx-4 -my-6 min-h-[calc(100vh-5rem)] bg-slate-100 px-4 py-6 font-sans sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      {isActiveCall && (
        <div className="sticky top-20 z-40 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-600 px-4 py-3 text-white shadow-sm">
          <div className="flex items-center gap-3"><span className="h-2.5 w-2.5 rounded-full bg-emerald-300" /><span className="text-sm font-semibold">Active call with {active.contact.name}</span><Badge tone="green"><Clock className="mr-1 h-3 w-3" />{isHeld ? "Held" : "Live"}</Badge></div>
          <div className="flex gap-2"><Button variant="ghost" className="text-white hover:bg-blue-500"><Mic className="mr-1 h-3 w-3" />Mute</Button><Button variant="ghost" className="text-white hover:bg-blue-500" onClick={() => { setIsDialerOpen(true); setIsDialerMinimized(false); }}>Open dialer</Button><button onClick={handleEndCall} className="inline-flex items-center rounded-xl bg-slate-950 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"><PhoneOff className="mr-1.5 h-4 w-4" />End</button></div>
        </div>
      )}

      <div className="sticky top-20 z-30 mb-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Communication center</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Conversations</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Manage roofing calls, SMS follow-ups, scheduling, and customer activity in a clean three-panel workspace.</p><p className="mt-2 text-xs font-medium text-blue-700">{twilioNotice}</p></div>
          <div className="flex flex-wrap gap-2"><Button variant="primary" onClick={() => { setIsDialerOpen(true); setIsDialerMinimized(false); }}><Phone className="mr-2 h-4 w-4" />Dial</Button>{pipelineStages.slice(0, 3).map((stage) => <Button key={stage}>{stage}</Button>)}</div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[320px_minmax(520px,1fr)_340px]">
        <div className={`${showMobileThread ? "hidden xl:block" : "block"}`}>
          <ConversationInbox conversations={conversations} active={active} onSelect={(conversation) => {
            setActiveConversationId(conversation.id);
            setDialNumber(conversation.contact.phone);
            setShowMobileThread(true);
          }} />
        </div>
        <main className={`${showMobileThread ? "flex" : "hidden xl:flex"} min-h-[calc(100vh-12rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm xl:min-h-[calc(100vh-8rem)]`}> 
          <div className="sticky top-0 z-20 flex flex-col gap-3 border-b border-slate-200 bg-white p-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3"><button type="button" onClick={() => setShowMobileThread(false)} className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 shadow-sm xl:hidden"><ArrowLeft className="h-4 w-4" /></button><div><p className="text-lg font-bold text-slate-950">{active.contact.name}</p><p className="text-sm text-slate-500">{active.contact.address}</p></div></div>
            <div className="flex flex-wrap gap-2"><Button variant="primary">Move stage</Button><Button>Schedule</Button><Button>Create estimate</Button></div>
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-slate-50 p-5">{active.messages.map((message) => <MessageRow key={message.id} message={message} />)}<div className="flex justify-start"><div className="rounded-full bg-white px-3 py-1.5 text-xs text-slate-500 shadow-sm ring-1 ring-slate-200">Office is typing...</div></div></div>
          <div className="sticky bottom-0 z-20 border-t border-slate-200 bg-white p-4">
            <div className="mb-3 flex gap-2 overflow-x-auto">{quickTemplates.map((template) => <button key={template} className="shrink-0 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-100">{template}</button>)}</div>
            <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2"><button className="rounded-lg p-2.5 text-slate-500 transition hover:bg-white hover:text-blue-700"><Smile className="h-5 w-5" /></button><button className="rounded-lg p-2.5 text-slate-500 transition hover:bg-white hover:text-blue-700"><Upload className="h-5 w-5" /></button><textarea value={messageText} onChange={(event) => setMessageText(event.target.value)} className="min-h-12 flex-1 resize-none bg-transparent p-2 text-sm outline-none placeholder:text-slate-400" placeholder="Send SMS or add a note..." /><button onClick={handleSendSms} className="rounded-xl bg-blue-600 p-3 text-white transition hover:bg-blue-700"><Send className="h-5 w-5" /></button></div>
          </div>
        </main>
        <div className="hidden xl:block"><ContactPanel conversation={active} onDial={openDialerForConversation} /></div>
      </div>

      {!isDialerOpen && (
        <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3">
          <Link href="/crm/team-chat" className="inline-flex items-center rounded-full bg-[#07183f] px-5 py-4 text-sm font-semibold text-white shadow-lg transition hover:bg-blue-900">
            <MessageCircle className="mr-2 h-5 w-5" />Team Chat
          </Link>
          <button onClick={() => setIsDialerOpen(true)} className="inline-flex items-center rounded-full bg-blue-600 px-5 py-4 text-sm font-semibold text-white shadow-lg transition hover:bg-blue-700">
            <Phone className="mr-2 h-5 w-5" />Dial
          </button>
        </div>
      )}
      <FloatingDialer contact={active.contact} dialNumber={dialNumber} isOpen={isDialerOpen} isMinimized={isDialerMinimized} isActiveCall={isActiveCall} isHeld={isHeld} callSid={callSid} onClose={() => setIsDialerOpen(false)} onMinimize={() => setIsDialerMinimized((value) => !value)} onStartCall={handleStartCall} onEndCall={handleEndCall} onHoldCall={handleHoldCall} onNotesChange={handleNotesChange} onDialNumberChange={setDialNumber} />
    </div>
  );
}

