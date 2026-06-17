"use client";

import { useEffect, useMemo, useState } from "react";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { AlignLeft, Briefcase, ChevronDown, ChevronLeft, ChevronRight, Clock, ExternalLink, MapPin, Phone, Plus, RefreshCw, User, X } from "lucide-react";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";

type GoogleCalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  location?: string;
  colorId?: string;
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

// Arizona Mountain Time - consistent timezone across all devices
const ARIZONA_TIMEZONE = "America/Phoenix";

function formatEventTime(event: GoogleCalendarEvent) {
  const dateValue = event.start?.dateTime;
  if (!dateValue) return "";

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: ARIZONA_TIMEZONE,
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

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function dateKey(year: number, month: number, day: number) {
  return `${year}-${month}-${day}`;
}

function eventDateKey(event: GoogleCalendarEvent) {
  const value = event.start?.dateTime || event.start?.date;
  if (!value) return null;

  if (event.start?.date && !event.start?.dateTime) {
    const [y, m, d] = event.start.date.split("-").map(Number);
    return dateKey(y, m - 1, d);
  }

  const arizonaFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ARIZONA_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = arizonaFormatter.formatToParts(new Date(value));
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value) - 1;
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return dateKey(year, month, day);
}

function getGoogleCalendarStatusMessage(status: string | null) {
  if (status === "connected") return "Google Calendar connected successfully.";
  if (status === "missing_env") return "Google Calendar server settings are missing. Check GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in Vercel, then redeploy.";
  if (status === "token_error") return "Google rejected the connection. Make sure the redirect URI in Google Cloud exactly matches your Vercel GOOGLE_REDIRECT_URI.";
  if (status === "missing_code") return "Google did not return an authorization code. Please try connecting again.";
  if (status === "error") return "Google Calendar authorization was cancelled or denied.";
  return "";
}

/* ── Google Calendar color mapping ──────────────────────────────────────── */
// Maps Google Calendar colorId values to their actual color names and CSS classes.
// These match the official Google Calendar event color palette.

type ColorConfig = { id: string; label: string; color: string; dot: string };

const GOOGLE_CALENDAR_COLORS: Record<string, ColorConfig> = {
  "1":  { id: "1",  label: "Lavender",   color: "bg-indigo-50 text-indigo-700 border-indigo-200",  dot: "bg-indigo-400" },
  "2":  { id: "2",  label: "Sage",       color: "bg-green-50 text-green-700 border-green-200",    dot: "bg-green-400" },
  "3":  { id: "3",  label: "Grape",      color: "bg-purple-50 text-purple-700 border-purple-200",  dot: "bg-purple-500" },
  "4":  { id: "4",  label: "Flamingo",   color: "bg-pink-50 text-pink-700 border-pink-200",      dot: "bg-pink-400" },
  "5":  { id: "5",  label: "Banana",     color: "bg-yellow-50 text-yellow-800 border-yellow-200",  dot: "bg-yellow-400" },
  "6":  { id: "6",  label: "Tangerine",  color: "bg-orange-50 text-orange-700 border-orange-200",  dot: "bg-orange-500" },
  "7":  { id: "7",  label: "Peacock",    color: "bg-cyan-50 text-cyan-700 border-cyan-200",      dot: "bg-cyan-500" },
  "8":  { id: "8",  label: "Graphite",   color: "bg-gray-100 text-gray-700 border-gray-300",      dot: "bg-gray-500" },
  "9":  { id: "9",  label: "Blueberry",  color: "bg-blue-50 text-blue-700 border-blue-200",      dot: "bg-blue-600" },
  "10": { id: "10", label: "Basil",      color: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-600" },
  "11": { id: "11", label: "Tomato",     color: "bg-red-50 text-red-700 border-red-200",          dot: "bg-red-500" },
};

const DEFAULT_COLOR: ColorConfig = { id: "default", label: "Default", color: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" };

function getEventColorConfig(event: GoogleCalendarEvent): ColorConfig {
  if (event.colorId && GOOGLE_CALENDAR_COLORS[event.colorId]) {
    return GOOGLE_CALENDAR_COLORS[event.colorId];
  }
  return DEFAULT_COLOR;
}

/* ── Event type sidebar (based on actual colors used) ──────────────────── */

const EVENT_TYPE_CONFIG: ColorConfig[] = [
  DEFAULT_COLOR,
  ...Object.values(GOOGLE_CALENDAR_COLORS),
];

/* ── Team members ──────────────────────────────────────────────────────── */

const TEAM_MEMBERS = [
  { id: "jonathan", name: "Jonathan Gonzalez" },
  { id: "darwin", name: "Darwin Rodas Garcia" },
];

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
    const arizonaFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: ARIZONA_TIMEZONE,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });
    const parts = arizonaFormatter.formatToParts(now);
    const year = Number(parts.find((p) => p.type === "year")?.value);
    const month = Number(parts.find((p) => p.type === "month")?.value) - 1;
    return new Date(year, month, 1);
  });
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
  const [enabledTypes, setEnabledTypes] = useState<Set<string>>(new Set(EVENT_TYPE_CONFIG.map((t) => t.id)));
  const [enabledTeam, setEnabledTeam] = useState<Set<string>>(new Set(TEAM_MEMBERS.map((m) => m.id)));

  const calendarCells = useMemo(() => {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Include trailing days from previous month
    const prevMonthDays = new Date(year, month, 0).getDate();
    const cells: Array<{ date: Date; isCurrentMonth: boolean }> = [];
    for (let i = startWeekday - 1; i >= 0; i--) {
      cells.push({ date: new Date(year, month - 1, prevMonthDays - i), isCurrentMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push({ date: new Date(year, month, day), isCurrentMonth: true });
    }
    while (cells.length % 7 !== 0) {
      const nextDay = cells.length - startWeekday - daysInMonth + 1;
      cells.push({ date: new Date(year, month + 1, nextDay), isCurrentMonth: false });
    }
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

  const monthLabel = useMemo(() => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1)), [monthCursor]);
  const todayKey = useMemo(() => {
    const now = new Date();
    const arizonaFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: ARIZONA_TIMEZONE,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });
    const parts = arizonaFormatter.formatToParts(now);
    const year = Number(parts.find((p) => p.type === "year")?.value);
    const month = Number(parts.find((p) => p.type === "month")?.value) - 1;
    const day = Number(parts.find((p) => p.type === "day")?.value);
    return dateKey(year, month, day);
  }, []);

  /* ── Mini calendar for sidebar ─────────────────────────────────────── */
  const miniCalCells = useMemo(() => {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();
    const cells: Array<{ day: number; isCurrentMonth: boolean; key: string }> = [];
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = prevMonthDays - i;
      cells.push({ day: d, isCurrentMonth: false, key: dateKey(year, month - 1, d) });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({ day, isCurrentMonth: true, key: dateKey(year, month, day) });
    }
    while (cells.length % 7 !== 0) {
      const d = cells.length - startWeekday - daysInMonth + 1;
      cells.push({ day: d, isCurrentMonth: false, key: dateKey(year, month + 1, d) });
    }
    return cells;
  }, [monthCursor]);

  // Dynamically compute which colors are actually used by current events
  const usedColors = useMemo(() => {
    const usedIds = new Set<string>();
    for (const event of events) {
      usedIds.add(getEventColorConfig(event).id);
    }
    // Always include default, plus any colors found in events
    return EVENT_TYPE_CONFIG.filter((c) => usedIds.has(c.id));
  }, [events]);

  function shiftMonth(delta: number) {
    setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  function goToToday() {
    const now = new Date();
    const arizonaFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: ARIZONA_TIMEZONE,
      year: "numeric",
      month: "numeric",
    });
    const parts = arizonaFormatter.formatToParts(now);
    const year = Number(parts.find((p) => p.type === "year")?.value);
    const month = Number(parts.find((p) => p.type === "month")?.value) - 1;
    setMonthCursor(new Date(year, month, 1));
  }

  async function loadEvents() {
    setLoading(true);
    setError("");

    try {
      const year = monthCursor.getFullYear();
      const month = monthCursor.getMonth();
      const timeMin = new Date(year, month, 1).toISOString();
      const timeMax = new Date(year, month + 2, 1).toISOString();
      const response = await fetch(`/api/google-calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&timeZone=${encodeURIComponent(ARIZONA_TIMEZONE)}`);
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
    setStatusMessage(getGoogleCalendarStatusMessage(status)); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  useEffect(() => {
    void loadEvents(); // eslint-disable-line react-hooks/set-state-in-effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthCursor]);

  useAutoRefresh(() => { void loadEvents(); });

  useEffect(() => {
    if (!selectedEvent) return;

    const details = getEventDetails(selectedEvent);

    setEventForm({ // eslint-disable-line react-hooks/set-state-in-effect
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

  function toggleType(type: string) {
    setEnabledTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function toggleTeam(id: string) {
    setEnabledTeam((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function isEventVisible(event: GoogleCalendarEvent) {
    const colorConfig = getEventColorConfig(event);
    return enabledTypes.has(colorConfig.id);
  }

  return (
    <div className="flex min-h-0 max-w-full flex-1 flex-col overflow-x-hidden">
      {/* ── Status Messages ─────────────────────────────────────────── */}
      {(error || statusMessage || (!loading && !connected)) && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3">
          {!loading && !connected && (
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">Google Calendar is not connected.</p>
              <a href="/api/google-calendar/connect" className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">Connect Google</a>
            </div>
          )}
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          {statusMessage && <p className="text-sm font-medium text-blue-700">{statusMessage}</p>}
        </div>
      )}

      {/* ── Top Toolbar (sticky) ──────────────────────────────────── */}
      <div className="sticky top-16 z-20 -mx-4 border-b border-gray-200 bg-white/95 px-4 py-1.5 backdrop-blur-sm sm:-mx-8 sm:px-8 sm:py-3">
        <div className="flex items-center justify-between gap-1.5 sm:gap-2">
          <div className="flex items-center gap-1.5 sm:gap-3">
            <button type="button" onClick={goToToday} className="rounded-md border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 sm:rounded-lg sm:px-4 sm:py-2 sm:text-sm">
              Today
            </button>
            <button type="button" onClick={() => shiftMonth(-1)} className="rounded-full p-1 text-gray-500 hover:bg-gray-100 sm:p-1.5" aria-label="Previous month">
              <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
            <button type="button" onClick={() => shiftMonth(1)} className="rounded-full p-1 text-gray-500 hover:bg-gray-100 sm:p-1.5" aria-label="Next month">
              <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
            <h1 className="text-base font-bold text-gray-900 sm:text-xl">{monthLabel}</h1>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button type="button" onClick={loadEvents} className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100 sm:p-2" aria-label="Refresh">
              <RefreshCw className={`h-4 w-4 sm:h-5 sm:w-5 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button type="button" className="hidden items-center gap-1 rounded-lg border border-gray-300 px-2 py-1.5 text-xs font-semibold text-gray-700 sm:flex sm:px-3 sm:py-2 sm:text-sm">
              Monthly <ChevronDown className="h-3 w-3 sm:h-4 sm:w-4" />
            </button>
            <button type="button" onClick={() => setNewScheduleOpen(true)} className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 sm:px-4 sm:py-2 sm:text-sm">
              <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> Event
            </button>
          </div>
        </div>
      </div>

      {/* ── Main Layout: Calendar + Sidebar ─────────────────────────── */}
      <div className="mt-1 flex min-h-0 flex-1 gap-2 sm:mt-2 sm:gap-4">
        {/* Calendar Grid */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
          {/* Weekday Headers */}
          <div className="grid grid-cols-7 border-b border-gray-200">
            {WEEKDAYS.map((day) => (
              <div key={day} className="border-r border-gray-100 px-0.5 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-500 last:border-r-0 sm:px-2 sm:py-3 sm:text-sm">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Cells */}
          <div className="grid min-h-0 flex-1 grid-cols-7" style={{ gridAutoRows: "1fr" }}>
            {calendarCells.map((cell, index) => {
              const key = dateKey(cell.date.getFullYear(), cell.date.getMonth(), cell.date.getDate());
              const dayEvents = (eventsByDate[key] || []).filter(isEventVisible);
              const isToday = key === todayKey;
              const maxVisible = 6;

              return (
                <div
                  key={`${key}-${index}`}
                  className={`min-h-[80px] border-b border-r border-gray-100 p-0.5 sm:min-h-[160px] sm:p-1.5 ${!cell.isCurrentMonth ? "bg-gray-50/50" : "bg-white"}`}
                >
                  {/* Day number */}
                  <div className="mb-0.5 text-right sm:mb-1">
                    <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold sm:h-7 sm:w-7 sm:text-sm ${isToday ? "bg-blue-600 text-white" : cell.isCurrentMonth ? "text-gray-900" : "text-gray-400"}`}>
                      {cell.date.getDate()}
                    </span>
                  </div>

                  {/* Events */}
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, maxVisible).map((event) => {
                      const config = getEventColorConfig(event);
                      const time = formatEventTime(event);
                      return (
                        <button
                          key={event.id}
                          type="button"
                          onClick={() => setSelectedEvent(event)}
                          className={`block w-full truncate rounded px-0.5 py-0.5 text-left text-[10px] font-semibold leading-snug border sm:px-1.5 sm:py-[3px] sm:text-sm ${config.color} hover:opacity-80 transition`}
                          title={`${event.summary || "Untitled"}${time ? ` ${time}` : ""}`}
                        >
                          <span className="truncate">{event.summary || "Untitled"}{time && <span className="ml-1 opacity-70 hidden sm:inline">{time}</span>}</span>
                        </button>
                      );
                    })}
                    {dayEvents.length > maxVisible && (
                      <button
                        type="button"
                        onClick={() => {
                          if (dayEvents[maxVisible]) setSelectedEvent(dayEvents[maxVisible]);
                        }}
                        className="block w-full px-0.5 text-left text-[10px] font-semibold text-blue-600 hover:underline sm:px-1.5 sm:text-xs"
                      >
                        +{dayEvents.length - maxVisible}
                        <span className="hidden sm:inline"> more</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sidebar */}
        <aside className="hidden w-64 shrink-0 space-y-4 lg:block">
          {/* Mini Calendar */}
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900">{monthLabel}</h3>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => shiftMonth(-1)} className="rounded p-0.5 text-gray-400 hover:text-gray-600" aria-label="Previous month">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => shiftMonth(1)} className="rounded p-0.5 text-gray-400 hover:text-gray-600" aria-label="Next month">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] font-semibold text-gray-400">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-0.5 text-center">
              {miniCalCells.map((cell, idx) => {
                const isToday2 = cell.key === todayKey;
                return (
                  <div
                    key={`mini-${idx}`}
                    className={`rounded-full py-0.5 text-xs ${isToday2 ? "bg-blue-600 font-bold text-white" : cell.isCurrentMonth ? "text-gray-700" : "text-gray-300"}`}
                  >
                    {cell.day}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Team */}
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <h3 className="mb-2 text-sm font-bold text-gray-900">Team</h3>
            <label className="flex cursor-pointer items-center gap-2 py-1">
              <input
                type="checkbox"
                checked={enabledTeam.size === TEAM_MEMBERS.length}
                onChange={() => {
                  if (enabledTeam.size === TEAM_MEMBERS.length) setEnabledTeam(new Set());
                  else setEnabledTeam(new Set(TEAM_MEMBERS.map((m) => m.id)));
                }}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span className="text-xs font-medium text-gray-700">Select all</span>
              <span className="ml-auto text-xs text-gray-400">{TEAM_MEMBERS.length}</span>
            </label>
            {TEAM_MEMBERS.map((member) => (
              <label key={member.id} className="flex cursor-pointer items-center gap-2 py-1">
                <input
                  type="checkbox"
                  checked={enabledTeam.has(member.id)}
                  onChange={() => toggleTeam(member.id)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-xs font-medium text-gray-700">{member.name}</span>
              </label>
            ))}
          </div>

          {/* Event Colors */}
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <h3 className="mb-2 text-sm font-bold text-gray-900">Event colors</h3>
            <p className="mb-2 text-xs text-gray-400">
              {enabledTypes.size === EVENT_TYPE_CONFIG.length ? "Showing all events" : `${enabledTypes.size} of ${EVENT_TYPE_CONFIG.length} colors shown`}
            </p>
            <div className="space-y-1">
              {usedColors.map((type) => (
                <label key={type.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 hover:bg-gray-50">
                  <span className={`h-3 w-3 rounded-sm ${type.dot}`} />
                  <span className="flex-1 text-xs font-medium text-gray-700">{type.label}</span>
                  <input
                    type="checkbox"
                    checked={enabledTypes.has(type.id)}
                    onChange={() => toggleType(type.id)}
                    className="h-3.5 w-3.5 rounded border-gray-300"
                  />
                </label>
              ))}
            </div>
          </div>

          {/* Colors Legend */}
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <h3 className="mb-2 text-sm font-bold text-gray-900">Colors</h3>
            <p className="text-xs text-gray-400">Colors match your Google Calendar event colors</p>
          </div>
        </aside>
      </div>

      {/* ── New Appointment Modal ───────────────────────────────────── */}
      {newScheduleOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/30 p-3 sm:p-4" onClick={() => setNewScheduleOpen(false)}>
          <form
            id="new-appointment"
            onSubmit={handleCreateEvent}
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 sm:px-6 sm:py-4">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600">New schedule</p>
                <h2 className="mt-0.5 text-lg font-bold text-blue-700 sm:text-2xl">Create appointment</h2>
              </div>
              <button type="button" onClick={() => setNewScheduleOpen(false)} aria-label="Close" className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              {!connected && <p className="mb-3 rounded-lg bg-orange-50 px-4 py-3 text-sm font-bold text-orange-700">Connect Google first</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                <input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="rounded-lg border border-gray-200 px-4 py-3 outline-none sm:col-span-2" placeholder="Appointment title" />
                <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="rounded-lg border border-gray-200 px-4 py-3 outline-none" placeholder="Customer name" />
                <input type="tel" inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="rounded-lg border border-gray-200 px-4 py-3 outline-none" placeholder="Phone number (for click-to-call)" />
                <div className="sm:col-span-2">
                  <AddressAutocomplete
                    value={form.address}
                    onChange={(addr) => setForm({ ...form, address: addr })}
                    placeholder="Start typing job address..."
                    required
                  />
                </div>
                <select required value={form.jobKind} onChange={(event) => setForm({ ...form, jobKind: event.target.value })} className="rounded-lg border border-gray-200 px-4 py-3 outline-none sm:col-span-2">
                  <option>Repair</option>
                  <option>Replacement</option>
                  <option>Installation</option>
                  <option>Maintenance</option>
                </select>
                <input required type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} className="rounded-lg border border-gray-200 px-4 py-3 outline-none sm:col-span-2" />
                <input required type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} className="rounded-lg border border-gray-200 px-4 py-3 outline-none" />
                <input required type="time" value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} className="rounded-lg border border-gray-200 px-4 py-3 outline-none" />
                <input value={form.guestEmails} onChange={(event) => setForm({ ...form, guestEmails: event.target.value })} className="rounded-lg border border-gray-200 px-4 py-3 outline-none sm:col-span-2" placeholder="Guest emails, separated by commas" />
                <input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="rounded-lg border border-gray-200 px-4 py-3 outline-none sm:col-span-2" placeholder="Notes" />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-4 py-3 sm:px-6">
              <button type="button" onClick={() => setNewScheduleOpen(false)} className="rounded-lg border border-gray-200 px-4 py-2.5 font-bold text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button disabled={!connected || saving} className="rounded-lg bg-blue-600 px-5 py-2.5 font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none">
                {saving ? "Saving..." : "Save to Calendar"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Event Detail / Edit Modal ──────────────────────────────── */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-950/40 p-4">
          <form onSubmit={handleUpdateEvent} className="mx-auto my-6 grid max-w-6xl gap-6 lg:grid-cols-[1fr_260px]">
            <div className="rounded-2xl bg-white p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-gray-200 pb-4">
                <input required value={eventForm.title} onChange={(event) => setEventForm({ ...eventForm, title: event.target.value })} className="w-full border-0 text-3xl font-normal text-blue-700 outline-none" placeholder="Add title" />
                <button type="button" onClick={() => setSelectedEvent(null)} className="rounded-full p-2 text-gray-500 hover:bg-gray-100">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <input required type="date" value={eventForm.date} onChange={(event) => setEventForm({ ...eventForm, date: event.target.value })} className="rounded-lg bg-gray-100 px-4 py-3 outline-none" />
                <input required type="time" value={eventForm.startTime} onChange={(event) => setEventForm({ ...eventForm, startTime: event.target.value })} className="rounded-lg bg-gray-100 px-4 py-3 outline-none" />
                <span className="font-semibold text-gray-600">to</span>
                <input required type="time" value={eventForm.endTime} onChange={(event) => setEventForm({ ...eventForm, endTime: event.target.value })} className="rounded-lg bg-gray-100 px-4 py-3 outline-none" />
                <span className="font-semibold text-gray-700">(GMT-07:00) Mountain Standard Time - Phoenix</span>
              </div>

              <div className="mt-8 rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                <div className="mt-4 grid gap-4">
                  <label className="grid grid-cols-[28px_1fr] items-center gap-4">
                    <User className="h-5 w-5 text-gray-500" />
                    <input required value={eventForm.name} onChange={(event) => setEventForm({ ...eventForm, name: event.target.value })} className="rounded-lg bg-gray-100 px-4 py-3 outline-none" placeholder="Customer name" />
                  </label>
                  <div className="grid grid-cols-[28px_1fr] items-center gap-4">
                    <Phone className="h-5 w-5 text-gray-500" />
                    <div className="flex items-center gap-2">
                      <input type="tel" inputMode="tel" value={eventForm.phone} onChange={(event) => setEventForm({ ...eventForm, phone: event.target.value })} className="flex-1 rounded-lg bg-gray-100 px-4 py-3 outline-none" placeholder="Phone number" />
                      {telHref(eventForm.phone) && (
                        <a href={telHref(eventForm.phone)} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-blue-500 px-4 py-3 font-bold text-white hover:bg-blue-600">
                          <Phone className="h-4 w-4" />Call
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-[28px_1fr] items-center gap-4">
                    <MapPin className="h-5 w-5 text-gray-500" />
                    <div className="flex items-center gap-2">
                      <input required value={eventForm.address} onChange={(event) => setEventForm({ ...eventForm, address: event.target.value })} className="flex-1 rounded-lg bg-gray-100 px-4 py-3 outline-none" placeholder="Job address" />
                      {eventForm.address && (
                        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(eventForm.address)}`} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-blue-500 px-4 py-3 font-bold text-white hover:bg-blue-600">
                          <MapPin className="h-4 w-4" />Map
                        </a>
                      )}
                    </div>
                  </div>
                  <label className="grid grid-cols-[28px_1fr] items-center gap-4">
                    <Briefcase className="h-5 w-5 text-gray-500" />
                    <select required value={eventForm.jobKind} onChange={(event) => setEventForm({ ...eventForm, jobKind: event.target.value })} className="rounded-lg bg-gray-100 px-4 py-3 outline-none">
                      <option>Repair</option>
                      <option>Replacement</option>
                      <option>Installation</option>
                      <option>Maintenance</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-[28px_1fr] items-start gap-4">
                    <AlignLeft className="mt-3 h-5 w-5 text-gray-500" />
                    <textarea value={eventForm.notes} onChange={(event) => setEventForm({ ...eventForm, notes: event.target.value })} className="min-h-48 rounded-lg bg-gray-100 px-4 py-3 outline-none" placeholder="Add description / notes" />
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                {selectedEvent.htmlLink && (
                  <a href={selectedEvent.htmlLink} target="_blank" rel="noreferrer" className="inline-flex rounded-lg border border-gray-200 px-4 py-3 font-bold text-gray-700">
                    <ExternalLink className="mr-2 h-4 w-4" />Open in Google Calendar
                  </a>
                )}
                <button disabled={updating} className="rounded-lg bg-blue-600 px-6 py-3 font-bold text-white disabled:bg-gray-300">
                  {updating ? "Saving..." : "Save changes"}
                </button>
              </div>
            </div>

            <aside className="rounded-2xl bg-white p-5 shadow-2xl">
              <div className="flex items-center gap-2 border-b border-gray-200 pb-3">
                <Clock className="h-5 w-5 text-gray-500" />
                <h3 className="font-bold text-blue-700">Guests</h3>
              </div>
              <textarea value={eventForm.guestEmails} onChange={(event) => setEventForm({ ...eventForm, guestEmails: event.target.value })} className="mt-5 min-h-24 w-full rounded-lg bg-gray-100 px-4 py-3 outline-none" placeholder="Add guest emails, separated by commas" />
              <p className="mt-2 text-xs font-semibold text-gray-500">Saving changes will send the Google Calendar invite/update to each guest.</p>
              <div className="mt-8 space-y-4">
                <p className="font-bold text-gray-700">Guest permissions</p>
                <label className="flex items-center gap-3 text-sm font-semibold text-gray-700"><input type="checkbox" className="h-4 w-4" />Modify event</label>
                <label className="flex items-center gap-3 text-sm font-semibold text-gray-700"><input type="checkbox" defaultChecked className="h-4 w-4" />Invite others</label>
                <label className="flex items-center gap-3 text-sm font-semibold text-gray-700"><input type="checkbox" defaultChecked className="h-4 w-4" />See guest list</label>
              </div>
            </aside>
          </form>
        </div>
      )}
    </div>
  );
}
