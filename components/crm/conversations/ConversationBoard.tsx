"use client";

import { useEffect, useState } from "react";
import { leads } from "@/lib/crm-data";
import { appointmentTypes, conversationFilters, createConversationFromLead, pipelineStages, quickTemplates } from "@/lib/crm-conversations";
import { saveCallNotes, sendSms, startOutboundCall, subscribeToConversationEvents } from "@/lib/twilio/client";
import type { ConversationMessage, ConversationRecord } from "@/types/conversations";
import type { TwilioConversationEvent } from "@/types/twilio-conversations";
import { CheckCheck, Clock, FileImage, Headphones, Mail, Mic, Pause, Phone, PhoneOff, Plus, Search, Send, Smile, Upload, UserRound } from "lucide-react";

function ChannelBadge({ channel }: { channel: string }) {
  const label = channel.toUpperCase();
  const Icon = channel === "sms" ? Headphones : channel === "email" ? Mail : Phone;
  return <span className="inline-flex items-center gap-1 rounded-full bg-blue-50/80 px-2.5 py-1 text-[11px] font-black text-blue-700 shadow-sm shadow-blue-100/50 ring-1 ring-blue-100/70"><Icon className="h-3 w-3" />{label}</span>;
}

function ConversationInbox({ conversations, active, onSelect, onDial }: { conversations: ConversationRecord[]; active: ConversationRecord; onSelect: (conversation: ConversationRecord) => void; onDial: (conversation: ConversationRecord) => void }) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-[2rem] bg-white/85 shadow-2xl shadow-slate-200/80 ring-1 ring-white/80 backdrop-blur-xl xl:sticky xl:top-24 xl:h-[calc(100vh-8rem)]">
      <div className="sticky top-0 z-20 border-b border-slate-100/70 bg-white/90 p-5 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-orange-500">Inbox</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-[#07183f]">Conversations</h2>
          </div>
          <button className="rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 p-3 text-white shadow-xl shadow-orange-200 transition hover:-translate-y-0.5 hover:shadow-orange-300 active:scale-95"><Plus className="h-4 w-4" /></button>
        </div>
        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="w-full rounded-2xl bg-slate-100/80 py-3.5 pl-10 pr-3 text-sm font-semibold text-slate-700 outline-none ring-1 ring-slate-200/70 transition placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-blue-100" placeholder="Search contacts..." />
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {conversationFilters.map((filter) => <button key={filter} className="shrink-0 rounded-full bg-slate-100/80 px-3 py-1.5 text-xs font-black text-slate-600 transition hover:-translate-y-0.5 hover:bg-blue-50 hover:text-blue-700 hover:shadow-md active:scale-95">{filter}</button>)}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 [scrollbar-gutter:stable]">
        {conversations.map((conversation) => (
          <article key={conversation.id} onClick={() => onSelect(conversation)} className={`group cursor-pointer rounded-[1.6rem] p-4 transition duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-slate-200/70 ${conversation.id === active.id ? "bg-gradient-to-br from-blue-50 via-white to-orange-50/40 shadow-lg shadow-blue-100/60 ring-1 ring-blue-100" : "bg-white/80 ring-1 ring-slate-100 hover:bg-white"}`}>
            <div className="flex items-start gap-3">
              <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#07183f] to-blue-700 text-white shadow-lg shadow-blue-950/20"><UserRound className="h-5 w-5" />{conversation.unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-orange-500 shadow-lg shadow-orange-300 ring-2 ring-white" />}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-black text-slate-950">{conversation.contact.name}</p>
                  <span className="text-[11px] font-bold text-slate-500">{conversation.lastActivityAt}</span>
                </div>
                <p className="mt-1 truncate text-xs font-bold text-slate-500">{conversation.contact.assignedRep} · {conversation.contact.jobStatus}</p>
                <p className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-slate-600">{conversation.lastMessage}</p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="flex gap-1.5">{conversation.channels.map((channel) => <ChannelBadge key={channel} channel={channel} />)}</div>
                  {conversation.unreadCount > 0 && <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[11px] font-black text-white shadow-lg shadow-orange-200">{conversation.unreadCount}</span>}
                </div>
                <button onClick={(event) => { event.stopPropagation(); onDial(conversation); }} className="mt-3 inline-flex items-center rounded-full bg-blue-50 px-3 py-1.5 text-[11px] font-black text-blue-700 shadow-sm transition hover:bg-blue-100"><Phone className="mr-1 h-3 w-3" />{conversation.contact.phone}</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </aside>
  );
}

function MessageRow({ message }: { message: ConversationMessage }) {
  const outbound = message.direction === "outbound";
  const internal = message.direction === "internal";
  return (
    <div className={`flex transition duration-300 ${outbound ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[82%] rounded-[1.75rem] px-4 py-3 shadow-lg transition hover:-translate-y-0.5 ${outbound ? "bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-blue-200" : internal ? "bg-orange-50/90 text-orange-900 shadow-orange-100 ring-1 ring-orange-100" : "bg-white/95 text-slate-800 shadow-slate-200 ring-1 ring-white/80"}`}>
        <div className="mb-1 flex items-center gap-2 text-[11px] font-black opacity-70"><span>{message.author}</span><span>{message.timestamp}</span>{message.status === "delivered" && <CheckCheck className="h-3 w-3" />}</div>
        <p className="text-sm font-medium leading-6">{message.body}</p>
        {message.attachments && <div className="mt-3 flex flex-wrap gap-2">{message.attachments.map((item) => <span key={item} className="inline-flex items-center gap-1 rounded-2xl bg-white/85 px-3 py-2 text-[11px] font-black text-slate-600 shadow-sm"><FileImage className="h-3 w-3 text-blue-600" />{item}</span>)}</div>}
      </div>
    </div>
  );
}

function FloatingDialer({ contact, isOpen, isMinimized, isActiveCall, callSid, onClose, onMinimize, onStartCall, onEndCall, onNotesChange }: { contact: ConversationRecord["contact"]; isOpen: boolean; isMinimized: boolean; isActiveCall: boolean; callSid?: string; onClose: () => void; onMinimize: () => void; onStartCall: () => void; onEndCall: () => void; onNotesChange: (notes: string) => void }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 sm:inset-auto sm:bottom-8 sm:right-8 sm:w-[360px]">
      <div className={`overflow-hidden rounded-t-[2rem] bg-gradient-to-br from-[#07183f] via-blue-800 to-blue-600 p-4 text-white shadow-2xl shadow-blue-950/30 ring-1 ring-white/20 backdrop-blur-2xl transition duration-300 sm:rounded-[2rem] ${isMinimized ? "translate-y-2 opacity-95" : "translate-y-0 opacity-100"}`}>
      <div className="flex items-center justify-between">
        <div><p className="text-xs font-black uppercase tracking-wider text-blue-100">Floating dialer</p><p className="mt-1 text-lg font-black">{contact.phone}</p></div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-xs font-black text-white ring-1 ring-white/15"><Clock className="h-3 w-3" />03:18</span>
          <button onClick={onMinimize} className="rounded-full bg-white/10 px-2 py-1 text-xs font-black ring-1 ring-white/10 transition hover:bg-white/20">{isMinimized ? "Open" : "Min"}</button>
          <button onClick={onClose} className="rounded-full bg-white/10 px-2 py-1 text-xs font-black ring-1 ring-white/10 transition hover:bg-white/20">×</button>
        </div>
      </div>
      {!isMinimized && (
        <>
      <div className="mt-4 flex h-8 items-end justify-center gap-1.5">{[35, 60, 42, 75, 50, 68, 38, 58, 45].map((height, index) => <span key={index} className={`w-1.5 rounded-full bg-orange-300/90 shadow-sm shadow-orange-200/30 transition-all ${isActiveCall ? "animate-pulse" : ""}`} style={{ height: `${height}%` }} />)}</div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm font-black">{"123456789*0#".split("").map((key) => <button key={key} className="rounded-2xl bg-white/10 py-3 text-white ring-1 ring-white/10 transition hover:-translate-y-0.5 hover:bg-white/20 active:scale-95">{key}</button>)}</div>
      <div className="mt-4 grid grid-cols-4 gap-2">
        <button className="rounded-2xl bg-white/10 p-3 text-white ring-1 ring-white/10 transition hover:bg-white/20 active:scale-95"><Mic className="mx-auto h-4 w-4" /></button>
        <button className="rounded-2xl bg-white/10 p-3 text-white ring-1 ring-white/10 transition hover:bg-white/20 active:scale-95"><Pause className="mx-auto h-4 w-4" /></button>
        <button onClick={onStartCall} className="rounded-2xl bg-emerald-400 p-3 text-white shadow-lg shadow-emerald-950/20 transition hover:-translate-y-0.5 active:scale-95"><Phone className="mx-auto h-4 w-4" /></button>
        <button onClick={onEndCall} className="rounded-2xl bg-red-500 p-3 text-white shadow-lg shadow-red-950/20 transition hover:-translate-y-0.5 active:scale-95"><PhoneOff className="mx-auto h-4 w-4" /></button>
      </div>
      <textarea onChange={(event) => onNotesChange(event.target.value)} className="mt-4 min-h-24 w-full rounded-2xl bg-white/10 p-3 text-sm font-medium text-white outline-none ring-1 ring-white/15 transition placeholder:text-blue-100 focus:bg-white/15 focus:ring-4 focus:ring-white/10" placeholder={callSid ? "Type live call notes... auto-save ready" : "Start a call to auto-save notes"} />
        </>
      )}
      </div>
    </div>
  );
}

function LeadIntakePanel() {
  return (
    <div className="rounded-[2rem] bg-white/85 p-4 shadow-xl shadow-slate-200/60 ring-1 ring-white/80 backdrop-blur">
      <p className="text-sm font-black text-[#07183f]">Fast lead intake</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {["Customer name", "Phone", "Address", "Email", "Roof type", "Insurance status"].map((field) => <input key={field} className="rounded-2xl bg-slate-100/80 px-3 py-2.5 text-sm font-semibold outline-none ring-1 ring-slate-200/70 transition focus:bg-white focus:ring-4 focus:ring-blue-100" placeholder={field} />)}
      </div>
    </div>
  );
}

function SchedulerPanel() {
  return (
    <div className="rounded-[2rem] bg-white/85 p-4 shadow-xl shadow-slate-200/60 ring-1 ring-white/80 backdrop-blur">
      <p className="text-sm font-black text-[#07183f]">Schedule appointment</p>
      <div className="mt-3 grid gap-2">
        <input type="date" className="rounded-2xl bg-slate-100/80 px-3 py-2.5 text-sm font-bold outline-none ring-1 ring-slate-200/70" />
        <input type="time" className="rounded-2xl bg-slate-100/80 px-3 py-2.5 text-sm font-bold outline-none ring-1 ring-slate-200/70" />
        <select className="rounded-2xl bg-slate-100/80 px-3 py-2.5 text-sm font-bold outline-none ring-1 ring-slate-200/70"><option>Johnny Roofer</option><option>Office Coordinator</option></select>
        <select className="rounded-2xl bg-slate-100/80 px-3 py-2.5 text-sm font-bold outline-none ring-1 ring-slate-200/70">{appointmentTypes.map((type) => <option key={type}>{type}</option>)}</select>
        <button className="rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 px-4 py-3 text-sm font-black text-white shadow-xl shadow-orange-200 transition hover:-translate-y-0.5 active:scale-95">Save appointment</button>
      </div>
    </div>
  );
}

function ContactPanel({ conversation, onDial }: { conversation: ConversationRecord; onDial: (conversation: ConversationRecord) => void }) {
  const contact = conversation.contact;
  return (
    <aside className="space-y-4 xl:sticky xl:top-24 xl:h-[calc(100vh-8rem)] xl:overflow-y-auto xl:pr-1">
      <div className="rounded-[2rem] bg-white/85 p-5 shadow-2xl shadow-slate-200/70 ring-1 ring-white/80 backdrop-blur">
        <div className="flex items-center gap-3"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#07183f] to-blue-700 text-white shadow-xl shadow-blue-950/20"><UserRound className="h-6 w-6" /></div><div><p className="text-lg font-black text-slate-950">{contact.name}</p><button onClick={() => onDial(conversation)} className="mt-1 inline-flex items-center text-sm font-black text-blue-700 transition hover:text-orange-600"><Phone className="mr-1 h-3.5 w-3.5" />{contact.phone}</button></div></div>
        <div className="mt-5 grid gap-3 text-sm">
          {[["Email", contact.email], ["Address", contact.address], ["Roof Type", contact.roofType], ["Assigned", contact.assignedRep], ["Insurance", contact.insuranceStatus], ["Lead Source", contact.leadSource]].map(([label, value]) => <div key={label} className="rounded-2xl bg-slate-50/90 p-3 shadow-sm ring-1 ring-slate-100"><p className="text-[11px] font-black uppercase text-slate-400">{label}</p><p className="mt-1 font-bold text-slate-800">{value}</p></div>)}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">{contact.tags.map((tag) => <span key={tag} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700 shadow-sm ring-1 ring-blue-100">{tag}</span>)}</div>
      </div>
      <SchedulerPanel />
    </aside>
  );
}

export default function ConversationBoard() {
  const conversations = leads.map(createConversationFromLead);
  const [activeConversationId, setActiveConversationId] = useState(conversations[0]?.id || "");
  const active = conversations.find((conversation) => conversation.id === activeConversationId) || conversations[0];
  const [isDialerOpen, setIsDialerOpen] = useState(false);
  const [isDialerMinimized, setIsDialerMinimized] = useState(false);
  const [isActiveCall, setIsActiveCall] = useState(false);
  const [callSid, setCallSid] = useState<string>();
  const [messageText, setMessageText] = useState("");
  const [twilioNotice, setTwilioNotice] = useState("Twilio realtime ready");

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
      const call = await startOutboundCall({ to: active.contact.phone, conversationId: active.id });
      setCallSid(call.sid);
      setIsActiveCall(true);
      setTwilioNotice(`Call ${call.status}`);
    } catch (error) {
      setIsActiveCall(true);
      setCallSid(undefined);
      setTwilioNotice(error instanceof Error ? error.message : "Twilio call unavailable");
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
    setIsDialerOpen(true);
    setIsDialerMinimized(false);
  }

  return (
    <div className="-mx-4 -my-6 min-h-[calc(100vh-5rem)] bg-[radial-gradient(circle_at_top_left,#dbeafe,transparent_30%),linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)] px-4 py-6 font-sans sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      {isActiveCall && (
        <div className="sticky top-20 z-40 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#07183f]/95 px-4 py-3 text-white shadow-2xl shadow-blue-950/20 ring-1 ring-white/10 backdrop-blur-xl">
          <div className="flex items-center gap-3"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-lg shadow-emerald-300" /><span className="text-sm font-black">Active call with {active.contact.name}</span><span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black"><Clock className="mr-1 inline h-3 w-3" />03:18</span></div>
          <div className="flex gap-2"><button className="rounded-xl bg-white/10 px-3 py-2 text-xs font-black transition hover:bg-white/20"><Mic className="mr-1 inline h-3 w-3" />Mute</button><button onClick={() => { setIsDialerOpen(true); setIsDialerMinimized(false); }} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-black transition hover:bg-white/20">Open dialer</button><button onClick={() => setIsActiveCall(false)} className="rounded-xl bg-red-500 px-3 py-2 text-xs font-black transition hover:bg-red-600"><PhoneOff className="mr-1 inline h-3 w-3" />End</button></div>
        </div>
      )}
      <div className="sticky top-20 z-30 mb-5 flex flex-col justify-between gap-4 rounded-[2rem] bg-white/80 p-5 shadow-2xl shadow-slate-200/70 ring-1 ring-white/80 backdrop-blur-xl lg:flex-row lg:items-end">
        <div><p className="text-xs font-black uppercase tracking-[0.24em] text-orange-600">Premium communication board</p><h1 className="mt-2 text-3xl font-black tracking-tight text-[#07183f]">Conversations</h1><p className="mt-2 max-w-3xl text-sm font-semibold text-slate-600">Answer calls, type live notes, collect customer info, send SMS, schedule inspections, and update roofing lead status in one fast workspace.</p><p className="mt-2 text-xs font-black text-blue-700">{twilioNotice}</p></div>
        <div className="flex flex-wrap gap-2"><button onClick={() => { setIsDialerOpen(true); setIsDialerMinimized(false); }} className="inline-flex items-center rounded-full bg-gradient-to-br from-orange-400 to-orange-600 px-4 py-2 text-xs font-black text-white shadow-xl shadow-orange-200 transition hover:-translate-y-0.5 active:scale-95"><Phone className="mr-2 h-3.5 w-3.5" />Dial</button>{pipelineStages.slice(0, 4).map((stage) => <button key={stage} className="rounded-full bg-white/80 px-3 py-2 text-xs font-black text-slate-700 shadow-sm ring-1 ring-slate-100 transition hover:-translate-y-0.5 hover:bg-blue-50 hover:text-blue-700 active:scale-95">{stage}</button>)}</div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[340px_minmax(520px,1fr)_360px]">
        <ConversationInbox conversations={conversations} active={active} onSelect={(conversation) => setActiveConversationId(conversation.id)} onDial={openDialerForConversation} />
        <main className="flex min-h-[calc(100vh-8rem)] flex-col overflow-hidden rounded-[2rem] bg-slate-50/75 shadow-2xl shadow-slate-200/80 ring-1 ring-white/80 backdrop-blur">
          <div className="sticky top-0 z-20 flex flex-col gap-3 border-b border-white/70 bg-white/90 p-5 shadow-sm shadow-slate-200/60 backdrop-blur-xl md:flex-row md:items-center md:justify-between">
            <div><p className="text-lg font-black text-[#07183f]">{active.contact.name}</p><p className="text-sm font-semibold text-slate-500">{active.contact.address}</p></div>
            <div className="flex flex-wrap gap-2"><button className="rounded-2xl bg-blue-600 px-4 py-2 text-xs font-black text-white shadow-lg shadow-blue-200 transition hover:-translate-y-0.5 active:scale-95">Move stage</button><button className="rounded-2xl bg-orange-500 px-4 py-2 text-xs font-black text-white shadow-lg shadow-orange-200 transition hover:-translate-y-0.5 active:scale-95">Schedule inspection</button><button className="rounded-2xl bg-white px-4 py-2 text-xs font-black text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 active:scale-95">Create estimate</button></div>
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 [scrollbar-gutter:stable]">{active.messages.map((message) => <MessageRow key={message.id} message={message} />)}<div className="flex justify-start"><div className="rounded-full bg-white/80 px-4 py-2 text-xs font-black text-slate-400 shadow-sm ring-1 ring-white">Office is typing...</div></div><LeadIntakePanel /></div>
          <div className="sticky bottom-0 z-20 border-t border-white/70 bg-white/90 p-4 shadow-[0_-18px_40px_rgba(148,163,184,0.18)] backdrop-blur-xl">
            <div className="mb-3 flex gap-2 overflow-x-auto">{quickTemplates.map((template) => <button key={template} className="shrink-0 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-blue-100 active:scale-95">{template}</button>)}</div>
            <div className="flex items-end gap-2 rounded-[1.75rem] bg-slate-100/90 p-2 shadow-inner ring-1 ring-slate-200/80"><button className="rounded-2xl p-3 text-slate-500 transition hover:bg-white hover:text-blue-700 active:scale-95"><Smile className="h-5 w-5" /></button><button className="rounded-2xl p-3 text-slate-500 transition hover:bg-white hover:text-blue-700 active:scale-95"><Upload className="h-5 w-5" /></button><textarea value={messageText} onChange={(event) => setMessageText(event.target.value)} className="min-h-12 flex-1 resize-none bg-transparent p-2 text-sm font-semibold outline-none placeholder:text-slate-400" placeholder="Send SMS, add notes, or follow up..." /><button onClick={handleSendSms} className="rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 p-3 text-white shadow-xl shadow-orange-200 transition hover:-translate-y-0.5 active:scale-95"><Send className="h-5 w-5" /></button></div>
          </div>
        </main>
        <ContactPanel conversation={active} onDial={openDialerForConversation} />
      </div>
      {!isDialerOpen && (
        <button onClick={() => setIsDialerOpen(true)} className="fixed bottom-6 right-6 z-40 inline-flex items-center rounded-full bg-gradient-to-br from-orange-400 to-orange-600 px-5 py-4 text-sm font-black text-white shadow-2xl shadow-orange-300 transition hover:-translate-y-1 active:scale-95">
          <Phone className="mr-2 h-5 w-5" />Dial
        </button>
      )}
      <FloatingDialer contact={active.contact} isOpen={isDialerOpen} isMinimized={isDialerMinimized} isActiveCall={isActiveCall} callSid={callSid} onClose={() => setIsDialerOpen(false)} onMinimize={() => setIsDialerMinimized((value) => !value)} onStartCall={handleStartCall} onEndCall={() => setIsActiveCall(false)} onNotesChange={handleNotesChange} />
    </div>
  );
}
