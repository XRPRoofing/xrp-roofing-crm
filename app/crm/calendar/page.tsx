"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlignLeft, Bell, Briefcase, CalendarDays, ChevronLeft, ChevronRight, Clock, ExternalLink, Loader2, MapPin, Phone, Plus, RefreshCw, User, X } from "lucide-react";

type GoogleCalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  location?: string;
  extendedProperties?: {
    private?: {
      crmName?: string;
      crmPhone?: string;
      crmAddress?: string;
      crmJobKind?: string;
      crmNotes?: string;
    };
  };
  start?: {
    date?: string;
    dateTime?: string;
  };
  end?: {
    date?: string;
    dateTime?: string;
  };
  attendees?: {
    email?: string;
  }[];
};

function formatEventDate(event: GoogleCalendarEvent) {
  const dateValue = event.start?.dateTime || event.start?.date;
  if (!dateValue) return "Date pending";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: event.start?.dateTime ? "numeric" : undefined,
    minute: event.start?.dateTime ? "2-digit" : undefined,
  }).format(new Date(dateValue));
}

function formatEventTime(event: GoogleCalendarEvent) {
  const dateValue = event.start?.dateTime;
  if (!dateValue) return "All day";

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(dateValue));
}

function getDateInputValue(value: string | undefined) {
  if (!value) return "";
  return value.slice(0, 10);
}

function getTimeInputValue(value: string | undefined) {
  if (!value) return "";
  return value.slice(11, 16);
}

function getDescriptionValue(description: string | undefined, label: string) {
  if (!description) return "";
  const line = description.split("\n").find((item) => item.toLowerCase().startsWith(`${label.toLowerCase()}:`));
  return line?.split(":").slice(1).join(":").trim() || "";
}

function getEventDetails(event: GoogleCalendarEvent) {
  const privateDetails = event.extendedProperties?.private;

  return {
    name: privateDetails?.crmName || getDescriptionValue(event.description, "Name") || event.summary || "Not provided",
    phone: privateDetails?.crmPhone || getDescriptionValue(event.description, "Phone") || "",
    address: privateDetails?.crmAddress || getDescriptionValue(event.description, "Address") || event.location || "Not provided",
    jobKind: privateDetails?.crmJobKind || getDescriptionValue(event.description, "Kind of Job") || "Not specified",
    notes: privateDetails?.crmNotes || getDescriptionValue(event.description, "Notes") || event.description || "No notes",
  };
}

function telHref(phone: string) {
  const cleaned = (phone || "").replace(/[^\d+]/g, "");
  return cleaned ? `tel:${cleaned}` : "";
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateKey(year: number, month: number, day: number) {
  return `${year}-${month}-${day}`;
}

function eventDateKey(event: GoogleCalendarEvent) {
  const value = event.start?.dateTime || event.start?.date;
  if (!value) return null;
  const date = new Date(value);
  return dateKey(date.getFullYear(), date.getMonth(), date.getDate());
}

function getGoogleCalendarStatusMessage(status: string | null) {
  if (status === "connected") return "Google Calendar connected successfully.";
  if (status === "missing_env") return "Google Calendar server settings are missing. Check GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in Vercel, then redeploy.";
  if (status === "token_error") return "Google rejected the connection. Make sure the redirect URI in Google Cloud exactly matches your Vercel GOOGLE_REDIRECT_URI.";
  if (status === "missing_code") return "Google did not return an authorization code. Please try connecting again.";
  if (status === "error") return "Google Calendar authorization was cancelled or denied.";
  return "";
}

export default function CalendarPage() {
  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<GoogleCalendarEvent | null>(null);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const agendaRef = useRef<HTMLDivElement>(null);
  const [newScheduleOpen, setNewScheduleOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    name: "",
    phone: "",
    address: "",
    jobKind: "Repair",
    date: "",
    startTime: "",
    endTime: "",
    notes: "",
    guestEmails: "",
  });
  const [eventForm, setEventForm] = useState({
    title: "",
    name: "",
    phone: "",
    address: "",
    jobKind: "Repair",
    date: "",
    startTime: "",
    endTime: "",
    notes: "",
    guestEmails: "",
  });

  const calendarCells = useMemo(() => {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<Date | null> = [];
    for (let i = 0; i < startWeekday; i += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(year, month, day));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [monthCursor]);

  const eventsByDate = useMemo(() => {
    return events.reduce<Record<string, GoogleCalendarEvent[]>>((grouped, event) => {
      const key = eventDateKey(event);
      if (!key) return grouped;
      grouped[key] = [...(grouped[key] || []), event];
      return grouped;
    }, {});
  }, [events]);

  const monthLabel = useMemo(() => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(monthCursor), [monthCursor]);
  const todayKey = useMemo(() => {
    const now = new Date();
    return dateKey(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  const activeDayKey = selectedDayKey || todayKey;
  const agendaEvents = eventsByDate[activeDayKey] || [];
  const activeDayLabel = useMemo(() => {
    const [year, month, day] = activeDayKey.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date(year, month, day));
  }, [activeDayKey]);

  function shiftMonth(delta: number) {
    setSelectedDayKey(null);
    setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  // Select a day (and optionally open one event). Scrolls the openable day strip
  // into view so every event on that day is reachable without hunting.
  function openDay(key: string, event?: GoogleCalendarEvent) {
    setSelectedDayKey(key);
    if (event) setSelectedEvent(event);
    window.requestAnimationFrame(() => {
      agendaRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  async function loadEvents() {
    setLoading(true);
    setError("");

    try {
      const year = monthCursor.getFullYear();
      const month = monthCursor.getMonth();
      const timeMin = new Date(year, month - 1, 1).toISOString();
      const timeMax = new Date(year, month + 2, 1).toISOString();
      const response = await fetch(`/api/google-calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`);
      const data = await response.json() as { connected?: boolean; events?: GoogleCalendarEvent[]; error?: string };

      setConnected(Boolean(data.connected));
      setEvents(data.events || []);
      setError(data.error || "");
    } catch {
      setError("Unable to check Google Calendar connection.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("google_calendar");
    setStatusMessage(getGoogleCalendarStatusMessage(status));
  }, []);

  useEffect(() => {
    void loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthCursor]);

  useEffect(() => {
    if (!selectedEvent) return;

    const details = getEventDetails(selectedEvent);

    setEventForm({
      title: selectedEvent.summary || "",
      name: details.name === "Not provided" ? "" : details.name,
      phone: details.phone,
      address: details.address === "Not provided" ? "" : details.address,
      jobKind: details.jobKind === "Not specified" ? "Repair" : details.jobKind,
      date: getDateInputValue(selectedEvent.start?.dateTime || selectedEvent.start?.date),
      startTime: getTimeInputValue(selectedEvent.start?.dateTime),
      endTime: getTimeInputValue(selectedEvent.end?.dateTime),
      notes: details.notes === "No notes" ? "" : details.notes,
      guestEmails: selectedEvent.attendees?.map((attendee) => attendee.email).filter(Boolean).join(", ") || "",
    });
  }, [selectedEvent]);

  async function handleCreateEvent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setStatusMessage("");

    try {
      const response = await fetch("/api/google-calendar/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json() as { error?: string };

      if (!response.ok) {
        setError(data.error || "Unable to create appointment.");
        return;
      }

      setStatusMessage("Appointment created in Google Calendar.");
      setForm({ title: "", name: "", phone: "", address: "", jobKind: "Repair", date: "", startTime: "", endTime: "", notes: "", guestEmails: "" });
      setNewScheduleOpen(false);
      await loadEvents();
    } catch {
      setError("Unable to create appointment.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateEvent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEvent) return;

    setUpdating(true);
    setError("");
    setStatusMessage("");

    try {
      const response = await fetch("/api/google-calendar/events", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedEvent.id, ...eventForm }),
      });
      const data = await response.json() as { error?: string };

      if (!response.ok) {
        setError(data.error || "Unable to update appointment.");
        return;
      }

      setStatusMessage("Appointment updated in Google Calendar.");
      setSelectedEvent(null);
      await loadEvents();
    } catch {
      setError("Unable to update appointment.");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="sticky top-16 z-30 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:rounded-[2rem] sm:p-8 lg:top-20">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-orange-600 sm:text-sm">Scheduling</p>
            <h1 className="mt-0.5 text-lg font-black text-[#07183f] sm:mt-2 sm:text-3xl">Calendar & Appointments</h1>
            <p className="crm-board-subtitle mt-1 hidden text-slate-600 sm:mt-3 sm:block">Connect Google Calendar to view upcoming inspections, estimates, and team appointments.</p>
          </div>
          <div className="flex flex-wrap gap-2 sm:gap-3">
            <button type="button" onClick={() => setNewScheduleOpen(true)} className="rounded-xl bg-[#07183f] px-3 py-2 text-sm font-bold text-white sm:rounded-2xl sm:px-4 sm:py-3">
              <Plus className="mr-1.5 inline h-4 w-4" />New appointment
            </button>
            <button onClick={loadEvents} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 sm:rounded-2xl sm:px-4 sm:py-3">
              <RefreshCw className="mr-1.5 inline h-4 w-4" />Refresh
            </button>
            <a href="/api/google-calendar/connect" className="rounded-xl bg-orange-500 px-3 py-2 text-sm font-bold text-white shadow-lg shadow-orange-200 sm:rounded-2xl sm:px-4 sm:py-3">
              <CalendarDays className="mr-1.5 inline h-4 w-4" />{connected ? "Reconnect" : "Connect Google"}
            </a>
          </div>
        </div>

        <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm sm:mt-6 sm:p-4 sm:text-base">
          {loading && (
            <p className="flex items-center font-semibold text-slate-600"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Checking Google Calendar...</p>
          )}
          {!loading && connected && (
            <p className="font-bold text-emerald-700">Google Calendar connected. Showing your next {events.length} upcoming events.</p>
          )}
          {!loading && !connected && (
            <p className="font-bold text-slate-700">Google Calendar is not connected yet. Click Connect Google to authorize access.</p>
          )}
          {error && <p className="mt-2 font-semibold text-red-600">{error}</p>}
          {statusMessage && <p className="mt-2 font-semibold text-orange-700">{statusMessage}</p>}
        </div>
      </div>

      <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-black text-[#07183f] sm:text-2xl">{monthLabel}</h2>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:text-orange-600">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => setMonthCursor(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); })} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:text-orange-600">
              Today
            </button>
            <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:text-orange-600">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wide text-slate-400 sm:text-xs">
          {WEEKDAYS.map((weekday) => (
            <div key={weekday} className="py-1">
              <span className="sm:hidden">{weekday.charAt(0)}</span>
              <span className="hidden sm:inline">{weekday}</span>
            </div>
          ))}
        </div>

        <div className="mt-1 grid grid-cols-7 gap-1 sm:gap-2">
          {calendarCells.map((cellDate, index) => {
            if (!cellDate) return <div key={`empty-${index}`} className="min-h-16 rounded-xl bg-slate-50/40 sm:min-h-28" />;
            const key = dateKey(cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate());
            const dayEvents = eventsByDate[key] || [];
            const isToday = key === todayKey;
            const isSelected = key === activeDayKey;
            return (
              <div key={key} onClick={() => openDay(key)} className={`min-h-16 cursor-pointer rounded-xl border p-1.5 text-left transition sm:min-h-28 sm:p-2 ${isSelected ? "border-orange-400 ring-2 ring-orange-300" : isToday ? "border-orange-300 bg-orange-50/60" : "border-slate-100 bg-slate-50 hover:border-orange-200"}`}>
                <div className={`text-right text-[11px] font-bold sm:text-sm ${isToday ? "text-orange-600" : "text-slate-500"}`}>
                  {isToday ? <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-white sm:h-6 sm:w-6">{cellDate.getDate()}</span> : cellDate.getDate()}
                </div>
                <div className="mt-1 space-y-1">
                  {/* Desktop: show up to 2 readable chips. Tapping the day opens
                      the full openable strip below so nothing is ever hidden. */}
                  {dayEvents.slice(0, 2).map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={(clickEvent) => { clickEvent.stopPropagation(); openDay(key, event); }}
                      className="hidden w-full truncate rounded-lg bg-orange-50 px-1.5 py-1 text-left text-[11px] font-black leading-tight text-orange-700 ring-1 ring-orange-100 sm:block"
                    >
                      {formatEventTime(event)} · {event.summary || "Untitled event"}
                    </button>
                  ))}
                  {/* A single readable "N events" pill works on every screen size
                      (replaces the cramped chips + hidden "+N more"). */}
                  {dayEvents.length > 0 && (
                    <span
                      className={`block rounded-lg bg-orange-500 px-1.5 py-0.5 text-center text-[10px] font-black text-white sm:hidden`}
                    >
                      {dayEvents.length}
                    </span>
                  )}
                  {dayEvents.length > 2 && (
                    <span className="hidden text-[11px] font-bold text-orange-600 sm:block">{dayEvents.length} events →</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div ref={agendaRef} className="mt-4 scroll-mt-20 border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black uppercase tracking-[0.16em] text-orange-600">{activeDayLabel}</h3>
            <span className="text-xs font-bold text-slate-400">{agendaEvents.length} event{agendaEvents.length === 1 ? "" : "s"} · swipe →</span>
          </div>
          {agendaEvents.length === 0 ? (
            <p className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500">No events on this day. Tap any date above to see its appointments.</p>
          ) : (
            // Horizontal, swipeable strip: every event on the day is its own card
            // you can scroll to and open — nothing is hidden behind "+N more".
            <div className="mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
              {agendaEvents.map((event) => {
                const details = getEventDetails(event);
                const tel = telHref(details.phone);
                return (
                  <div key={event.id} className="flex w-[80%] max-w-[20rem] shrink-0 snap-start flex-col rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:w-72">
                    <button type="button" onClick={() => setSelectedEvent(event)} className="flex flex-1 items-start gap-3 text-left">
                      <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-orange-50 px-1.5 py-2 text-center text-orange-700">
                        <Clock className="h-3.5 w-3.5" />
                        <span className="mt-0.5 text-[11px] font-black leading-tight">{formatEventTime(event)}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black text-[#07183f]">{event.summary || "Untitled event"}</p>
                        {details.name !== "Not provided" && (
                          <p className="mt-1 flex items-center gap-1 truncate text-xs font-semibold text-slate-600"><User className="h-3 w-3 shrink-0 text-slate-400" />{details.name}</p>
                        )}
                        {details.address !== "Not provided" && (
                          <p className="mt-0.5 flex items-start gap-1 text-xs font-semibold text-slate-500"><MapPin className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />{details.address}</p>
                        )}
                      </div>
                    </button>
                    <div className="mt-3 flex items-center gap-2">
                      <button type="button" onClick={() => setSelectedEvent(event)} className="flex-1 rounded-xl bg-orange-500 px-3 py-2 text-xs font-black text-white transition hover:bg-orange-600">Open</button>
                      {tel && (
                        <a href={tel} aria-label={`Call ${details.phone}`} title={`Call ${details.phone}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white hover:bg-emerald-600">
                          <Phone className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {newScheduleOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-3 sm:p-4" onClick={() => setNewScheduleOpen(false)}>
          <form
            id="new-appointment"
            onSubmit={handleCreateEvent}
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-orange-600">New schedule</p>
                <h2 className="mt-0.5 text-lg font-black text-[#07183f] sm:text-2xl">Create appointment</h2>
              </div>
              <button type="button" onClick={() => setNewScheduleOpen(false)} aria-label="Close" className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              {!connected && <p className="mb-3 rounded-2xl bg-orange-50 px-4 py-3 text-sm font-bold text-orange-700">Connect Google first</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                <input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none sm:col-span-2" placeholder="Appointment title" />
                <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Customer name" />
                <input type="tel" inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Phone number (for click-to-call)" />
                <input required value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none sm:col-span-2" placeholder="Job address" />
                <select required value={form.jobKind} onChange={(event) => setForm({ ...form, jobKind: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none sm:col-span-2">
                  <option>Repair</option>
                  <option>Replacement</option>
                  <option>Installation</option>
                  <option>Maintenance</option>
                </select>
                <input required type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none sm:col-span-2" />
                <input required type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" />
                <input required type="time" value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" />
                <input value={form.guestEmails} onChange={(event) => setForm({ ...form, guestEmails: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none sm:col-span-2" placeholder="Guest emails, separated by commas" />
                <input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none sm:col-span-2" placeholder="Notes" />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-3 sm:px-6">
              <button type="button" onClick={() => setNewScheduleOpen(false)} className="rounded-2xl border border-slate-200 px-4 py-2.5 font-bold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button disabled={!connected || saving} className="rounded-2xl bg-orange-500 px-5 py-2.5 font-bold text-white shadow-lg shadow-orange-200 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none">
                {saving ? "Saving..." : "Save to Calendar"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-black text-[#07183f]">Upcoming Google Calendar events</h2>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {events.map((event) => {
            const phone = getEventDetails(event).phone;
            const tel = telHref(phone);
            return (
            <article key={event.id} onClick={() => setSelectedEvent(event)} className="cursor-pointer rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-black text-[#07183f]">{event.summary || "Untitled event"}</p>
                  <p className="mt-1 text-sm font-semibold text-orange-600">{formatEventDate(event)}</p>
                </div>
                {event.htmlLink && (
                  <a href={event.htmlLink} target="_blank" rel="noreferrer" onClick={(clickEvent) => clickEvent.stopPropagation()} className="rounded-xl bg-white p-2 text-slate-500 hover:text-orange-600">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
              {tel && (
                <a href={tel} onClick={(clickEvent) => clickEvent.stopPropagation()} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-600">
                  <Phone className="h-4 w-4" />{phone}
                </a>
              )}
              {event.description && <p className="mt-3 line-clamp-2 text-sm text-slate-600">{event.description}</p>}
            </article>
            );
          })}
          {!loading && connected && events.length === 0 && (
            <p className="rounded-2xl bg-slate-50 p-4 font-semibold text-slate-600">No upcoming events found.</p>
          )}
        </div>
      </div>
      {selectedEvent && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/40 p-4">
          <form onSubmit={handleUpdateEvent} className="mx-auto my-6 grid max-w-6xl gap-6 lg:grid-cols-[1fr_260px]">
            <div className="rounded-[2rem] bg-white p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                <input required value={eventForm.title} onChange={(event) => setEventForm({ ...eventForm, title: event.target.value })} className="w-full border-0 text-3xl font-normal text-[#07183f] outline-none" placeholder="Add title" />
                <button type="button" onClick={() => setSelectedEvent(null)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <input required type="date" value={eventForm.date} onChange={(event) => setEventForm({ ...eventForm, date: event.target.value })} className="rounded-lg bg-slate-100 px-4 py-3 outline-none" />
                <input required type="time" value={eventForm.startTime} onChange={(event) => setEventForm({ ...eventForm, startTime: event.target.value })} className="rounded-lg bg-slate-100 px-4 py-3 outline-none" />
                <span className="font-semibold text-slate-600">to</span>
                <input required type="time" value={eventForm.endTime} onChange={(event) => setEventForm({ ...eventForm, endTime: event.target.value })} className="rounded-lg bg-slate-100 px-4 py-3 outline-none" />
                <span className="font-semibold text-slate-700">(GMT-07:00) Mountain Standard Time - Phoenix</span>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 font-semibold text-slate-700">
                  <input type="checkbox" className="h-4 w-4" /> All day
                </label>
                <button type="button" className="rounded-lg bg-slate-100 px-4 py-3 font-semibold text-slate-700">Does not repeat</button>
              </div>

              <div className="mt-8 rounded-[1.5rem] border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex gap-8 border-b border-slate-200">
                  <button type="button" className="border-b-2 border-blue-600 px-2 pb-3 font-bold text-blue-600">Event details</button>
                  <button type="button" className="px-2 pb-3 font-bold text-slate-500">Find a time</button>
                </div>

                <div className="mt-6 grid gap-4">
                  <label className="grid grid-cols-[28px_1fr] items-center gap-4">
                    <User className="h-5 w-5 text-slate-500" />
                    <input required value={eventForm.name} onChange={(event) => setEventForm({ ...eventForm, name: event.target.value })} className="rounded-lg bg-slate-100 px-4 py-3 outline-none" placeholder="Customer name" />
                  </label>
                  <div className="grid grid-cols-[28px_1fr] items-center gap-4">
                    <Phone className="h-5 w-5 text-slate-500" />
                    <div className="flex items-center gap-2">
                      <input type="tel" inputMode="tel" value={eventForm.phone} onChange={(event) => setEventForm({ ...eventForm, phone: event.target.value })} className="flex-1 rounded-lg bg-slate-100 px-4 py-3 outline-none" placeholder="Phone number" />
                      {telHref(eventForm.phone) && (
                        <a href={telHref(eventForm.phone)} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-emerald-500 px-4 py-3 font-bold text-white hover:bg-emerald-600">
                          <Phone className="h-4 w-4" />Call
                        </a>
                      )}
                    </div>
                  </div>
                  <label className="grid grid-cols-[28px_1fr] items-center gap-4">
                    <MapPin className="h-5 w-5 text-slate-500" />
                    <input required value={eventForm.address} onChange={(event) => setEventForm({ ...eventForm, address: event.target.value })} className="rounded-lg bg-slate-100 px-4 py-3 outline-none" placeholder="Job address" />
                  </label>
                  <label className="grid grid-cols-[28px_1fr] items-center gap-4">
                    <Briefcase className="h-5 w-5 text-slate-500" />
                    <select required value={eventForm.jobKind} onChange={(event) => setEventForm({ ...eventForm, jobKind: event.target.value })} className="rounded-lg bg-slate-100 px-4 py-3 outline-none">
                      <option>Repair</option>
                      <option>Replacement</option>
                      <option>Installation</option>
                      <option>Maintenance</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-[28px_1fr] items-center gap-4">
                    <Bell className="h-5 w-5 text-slate-500" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-lg bg-slate-100 px-4 py-3 font-semibold text-slate-700">Notification</span>
                      <span className="rounded-lg bg-slate-100 px-4 py-3 font-semibold text-slate-700">10</span>
                      <span className="rounded-lg bg-slate-100 px-4 py-3 font-semibold text-slate-700">minutes</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-[28px_1fr] items-start gap-4">
                    <AlignLeft className="mt-3 h-5 w-5 text-slate-500" />
                    <textarea value={eventForm.notes} onChange={(event) => setEventForm({ ...eventForm, notes: event.target.value })} className="min-h-48 rounded-lg bg-slate-100 px-4 py-3 outline-none" placeholder="Add description / notes" />
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                {selectedEvent.htmlLink && (
                  <a href={selectedEvent.htmlLink} target="_blank" rel="noreferrer" className="inline-flex rounded-2xl border border-slate-200 px-4 py-3 font-bold text-slate-700">
                    <ExternalLink className="mr-2 h-4 w-4" />Open in Google Calendar
                  </a>
                )}
                <button disabled={updating} className="rounded-2xl bg-blue-600 px-6 py-3 font-bold text-white disabled:bg-slate-300">
                  {updating ? "Saving..." : "Save changes"}
                </button>
              </div>
            </div>

            <aside className="rounded-[2rem] bg-white p-5 shadow-2xl">
              <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                <Clock className="h-5 w-5 text-slate-500" />
                <h3 className="font-black text-[#07183f]">Guests</h3>
              </div>
              <textarea value={eventForm.guestEmails} onChange={(event) => setEventForm({ ...eventForm, guestEmails: event.target.value })} className="mt-5 min-h-24 w-full rounded-lg bg-slate-100 px-4 py-3 outline-none" placeholder="Add guest emails, separated by commas" />
              <p className="mt-2 text-xs font-semibold text-slate-500">Saving changes will send the Google Calendar invite/update to each guest.</p>
              <div className="mt-8 space-y-4">
                <p className="font-bold text-slate-700">Guest permissions</p>
                <label className="flex items-center gap-3 text-sm font-semibold text-slate-700"><input type="checkbox" className="h-4 w-4" />Modify event</label>
                <label className="flex items-center gap-3 text-sm font-semibold text-slate-700"><input type="checkbox" defaultChecked className="h-4 w-4" />Invite others</label>
                <label className="flex items-center gap-3 text-sm font-semibold text-slate-700"><input type="checkbox" defaultChecked className="h-4 w-4" />See guest list</label>
              </div>
            </aside>
          </form>
        </div>
      )}
    </div>
  );
}
