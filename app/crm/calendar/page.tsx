"use client";

import { useEffect, useMemo, useState } from "react";
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

  function shiftMonth(delta: number) {
    setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  async function loadEvents() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/google-calendar/events");
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
    void loadEvents();
  }, []);

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
      <div className="sticky top-16 z-30 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-[2rem] sm:p-8 lg:top-20">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-orange-600">Scheduling</p>
            <h1 className="mt-2 text-3xl font-black text-[#07183f]">Calendar & Appointments</h1>
            <p className="crm-board-subtitle mt-3 text-slate-600">Connect Google Calendar to view upcoming inspections, estimates, and team appointments.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a href="#new-appointment" className="rounded-2xl bg-[#07183f] px-4 py-3 font-bold text-white">
              <Plus className="mr-2 inline h-4 w-4" />New appointment
            </a>
            <button onClick={loadEvents} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold text-slate-700">
              <RefreshCw className="mr-2 inline h-4 w-4" />Refresh
            </button>
            <a href="/api/google-calendar/connect" className="rounded-2xl bg-orange-500 px-4 py-3 font-bold text-white shadow-lg shadow-orange-200">
              <CalendarDays className="mr-2 inline h-4 w-4" />{connected ? "Reconnect Google" : "Connect Google"}
            </a>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-slate-50 p-4">
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
            return (
              <div key={key} className={`min-h-16 rounded-xl border p-1.5 text-left sm:min-h-28 sm:p-2 ${isToday ? "border-orange-300 bg-orange-50/60" : "border-slate-100 bg-slate-50"}`}>
                <div className={`text-right text-[11px] font-bold sm:text-sm ${isToday ? "text-orange-600" : "text-slate-500"}`}>
                  {isToday ? <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-white sm:h-6 sm:w-6">{cellDate.getDate()}</span> : cellDate.getDate()}
                </div>
                <div className="mt-1 space-y-1">
                  {dayEvents.slice(0, 3).map((event) => {
                    const phone = getEventDetails(event).phone;
                    const tel = telHref(phone);
                    return (
                      <div key={event.id} className="group flex items-center gap-1 rounded-lg bg-orange-50 px-1.5 py-1 ring-1 ring-orange-100">
                        <button type="button" onClick={() => setSelectedEvent(event)} className="min-w-0 flex-1 text-left text-[10px] font-bold text-orange-700 sm:text-[11px]">
                          <span className="block truncate">{formatEventTime(event)} · {event.summary || "Untitled event"}</span>
                        </button>
                        {tel && (
                          <a href={tel} onClick={(clickEvent) => clickEvent.stopPropagation()} aria-label={`Call ${phone}`} title={`Call ${phone}`} className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white hover:bg-emerald-600">
                            <Phone className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                    );
                  })}
                  {dayEvents.length > 3 && (
                    <p className="text-[10px] font-bold text-slate-500 sm:text-[11px]">+{dayEvents.length - 3} more</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <form id="new-appointment" onSubmit={handleCreateEvent} className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-2 lg:flex-row lg:items-end">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-orange-600">New schedule</p>
            <h2 className="mt-2 text-2xl font-black text-[#07183f]">Create appointment</h2>
            <p className="mt-2 text-slate-600">Add inspections, estimates, customer meetings, crew schedules, or follow-ups directly to Google Calendar.</p>
          </div>
          {!connected && <p className="rounded-2xl bg-orange-50 px-4 py-3 font-bold text-orange-700">Connect Google first</p>}
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Appointment title" />
          <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Customer name" />
          <input type="tel" inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Phone number (for click-to-call)" />
          <input required value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none md:col-span-2" placeholder="Job address" />
          <select required value={form.jobKind} onChange={(event) => setForm({ ...form, jobKind: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none">
            <option>Repair</option>
            <option>Replacement</option>
            <option>Installation</option>
            <option>Maintenance</option>
          </select>
          <input required type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" />
          <input required type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" />
          <input required type="time" value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" />
          <input value={form.guestEmails} onChange={(event) => setForm({ ...form, guestEmails: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Guest emails, separated by commas" />
          <input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none md:col-span-2" placeholder="Notes" />
        </div>

        <button disabled={!connected || saving} className="mt-4 rounded-2xl bg-orange-500 px-5 py-3 font-bold text-white shadow-lg shadow-orange-200 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none">
          {saving ? "Saving..." : "Save to Google Calendar"}
        </button>
      </form>

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
