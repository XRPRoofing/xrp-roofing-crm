"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import {
  AlignLeft,
  Briefcase,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  RefreshCw,
  Trash2,
  User,
  X,
} from "lucide-react";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import QuickSmsModal from "@/components/crm/QuickSmsModal";
import {
  loadCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  subscribeToCalendarUpdates,
  type CalendarEvent,
} from "@/lib/calendar-sync";

// Arizona Mountain Time
const ARIZONA_TIMEZONE = "America/Phoenix";

type ViewMode = "month" | "week" | "day";

const VIEW_LABELS: Record<ViewMode, string> = {
  month: "Month",
  week: "Week",
  day: "Day",
};

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const WEEKDAYS_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function dateKey(year: number, month: number, day: number) {
  return `${year}-${month}-${day}`;
}

function dateKeyFromDate(d: Date): string {
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
}

function arizonaToday(): { year: number; month: number; day: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ARIZONA_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  return {
    year: Number(parts.find((p) => p.type === "year")?.value),
    month: Number(parts.find((p) => p.type === "month")?.value) - 1,
    day: Number(parts.find((p) => p.type === "day")?.value),
  };
}

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

function eventToDateKey(event: CalendarEvent): string {
  const d = new Date(event.start_time);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ARIZONA_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(d);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value) - 1;
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return dateKey(year, month, day);
}

function eventHour(event: CalendarEvent): number {
  const d = new Date(event.start_time);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ARIZONA_TIMEZONE,
    hour: "numeric",
    hour12: false,
  }).formatToParts(d);
  return Number(parts.find((p) => p.type === "hour")?.value) || 0;
}

function eventEndHour(event: CalendarEvent): number {
  const d = new Date(event.end_time);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ARIZONA_TIMEZONE,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value) || 0;
  const m = Number(parts.find((p) => p.type === "minute")?.value) || 0;
  return m > 0 ? h + 1 : h;
}

function formatEventTime(event: CalendarEvent): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: ARIZONA_TIMEZONE,
  }).format(new Date(event.start_time));
}

function formatEventTimeRange(event: CalendarEvent): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: ARIZONA_TIMEZONE,
  });
  return `${fmt.format(new Date(event.start_time))} – ${fmt.format(new Date(event.end_time))}`;
}

function telHref(phone: string) {
  const cleaned = (phone || "").replace(/[^\d+]/g, "");
  return cleaned ? `tel:${cleaned}` : "";
}

function getWeekStart(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function isoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isoTime(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: ARIZONA_TIMEZONE,
  })
    .format(d)
    .replace(/^24/, "00");
}

/* ── Color palette for events ──────────────────────────────────────────── */

type ColorConfig = { id: string; label: string; color: string; dot: string };

const EVENT_COLORS: ColorConfig[] = [
  { id: "blue", label: "Blue", color: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
  { id: "red", label: "Red", color: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-500" },
  { id: "green", label: "Green", color: "bg-green-50 text-green-700 border-green-200", dot: "bg-green-500" },
  { id: "purple", label: "Purple", color: "bg-purple-50 text-purple-700 border-purple-200", dot: "bg-purple-500" },
  { id: "orange", label: "Orange", color: "bg-orange-50 text-orange-700 border-orange-200", dot: "bg-orange-500" },
  { id: "pink", label: "Pink", color: "bg-pink-50 text-pink-700 border-pink-200", dot: "bg-pink-400" },
  { id: "cyan", label: "Teal", color: "bg-cyan-50 text-cyan-700 border-cyan-200", dot: "bg-cyan-500" },
  { id: "yellow", label: "Yellow", color: "bg-yellow-50 text-yellow-800 border-yellow-200", dot: "bg-yellow-400" },
  { id: "gray", label: "Gray", color: "bg-gray-100 text-gray-700 border-gray-300", dot: "bg-gray-500" },
  { id: "indigo", label: "Indigo", color: "bg-indigo-50 text-indigo-700 border-indigo-200", dot: "bg-indigo-500" },
  { id: "emerald", label: "Emerald", color: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-600" },
];

const DEFAULT_COLOR = EVENT_COLORS[0];

function getColorConfig(colorId: string): ColorConfig {
  return EVENT_COLORS.find((c) => c.id === colorId) || DEFAULT_COLOR;
}

/* ── Team members ──────────────────────────────────────────────────────── */

const TEAM_MEMBERS = [
  { id: "jonathan", name: "Jonathan Gonzalez", email: "info@xrproofing.com" },
  { id: "darwin", name: "Darwin Rodas Garcia", email: "" },
];

/* ── Main Component ────────────────────────────────────────────────────── */

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [smsTarget, setSmsTarget] = useState<{
    phone: string;
    name?: string;
  } | null>(null);

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);
  const [currentDate, setCurrentDate] = useState(() => {
    const t = arizonaToday();
    return new Date(t.year, t.month, t.day);
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Modal state
  const [newScheduleOpen, setNewScheduleOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
    null,
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Team & color filters
  const [enabledTeam, setEnabledTeam] = useState<Set<string>>(
    new Set(TEAM_MEMBERS.map((m) => m.id)),
  );

  // Create form
  const [form, setForm] = useState({
    title: "",
    customer_name: "",
    customer_phone: "",
    location: "",
    job_kind: "Repair",
    date: "",
    startTime: "",
    endTime: "",
    description: "",
    color: "blue",
    assigned_to: TEAM_MEMBERS[0].id,
  });

  // Edit form
  const [editForm, setEditForm] = useState({
    title: "",
    customer_name: "",
    customer_phone: "",
    location: "",
    job_kind: "Repair",
    date: "",
    startTime: "",
    endTime: "",
    description: "",
    color: "blue",
    assigned_to: TEAM_MEMBERS[0].id,
  });

  /* ── Derived values ─────────────────────────────────────────────────── */

  const monthCursor = useMemo(
    () => new Date(currentDate.getFullYear(), currentDate.getMonth(), 1),
    [currentDate],
  );

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        month: "long",
        year: "numeric",
      }).format(monthCursor),
    [monthCursor],
  );

  const todayKey = useMemo(() => {
    const t = arizonaToday();
    return dateKey(t.year, t.month, t.day);
  }, []);

  const calendarCells = useMemo(() => {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();
    const cells: Array<{ date: Date; isCurrentMonth: boolean }> = [];
    for (let i = startWeekday - 1; i >= 0; i--) {
      cells.push({
        date: new Date(year, month - 1, prevMonthDays - i),
        isCurrentMonth: false,
      });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push({ date: new Date(year, month, day), isCurrentMonth: true });
    }
    while (cells.length % 7 !== 0) {
      const nextDay = cells.length - startWeekday - daysInMonth + 1;
      cells.push({
        date: new Date(year, month + 1, nextDay),
        isCurrentMonth: false,
      });
    }
    return cells;
  }, [monthCursor]);

  const miniCalCells = useMemo(() => {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();
    const cells: Array<{
      day: number;
      date: Date;
      isCurrentMonth: boolean;
      key: string;
    }> = [];
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = prevMonthDays - i;
      cells.push({
        day: d,
        date: new Date(year, month - 1, d),
        isCurrentMonth: false,
        key: dateKey(year, month - 1, d),
      });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({
        day,
        date: new Date(year, month, day),
        isCurrentMonth: true,
        key: dateKey(year, month, day),
      });
    }
    while (cells.length % 7 !== 0) {
      const d = cells.length - startWeekday - daysInMonth + 1;
      cells.push({
        day: d,
        date: new Date(year, month + 1, d),
        isCurrentMonth: false,
        key: dateKey(year, month + 1, d),
      });
    }
    return cells;
  }, [monthCursor]);

  const eventsByDate = useMemo(() => {
    return events.reduce<Record<string, CalendarEvent[]>>((grouped, event) => {
      const key = eventToDateKey(event);
      grouped[key] = [...(grouped[key] || []), event];
      return grouped;
    }, {});
  }, [events]);

  // Week view: 7 days starting from Sunday of the current week
  const weekDays = useMemo(() => {
    const start = getWeekStart(currentDate);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [currentDate]);

  const headerLabel = useMemo(() => {
    if (viewMode === "month") return monthLabel;
    if (viewMode === "week") {
      const start = weekDays[0];
      const end = weekDays[6];
      const fmt = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
      });
      const yearFmt = new Intl.DateTimeFormat("en-US", { year: "numeric" });
      return `${fmt.format(start)} – ${fmt.format(end)}, ${yearFmt.format(end)}`;
    }
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(currentDate);
  }, [viewMode, monthLabel, weekDays, currentDate]);

  /* ── Data loading ───────────────────────────────────────────────────── */

  const loadEvents = useCallback(async () => {
    if (events.length === 0) setLoading(true);
    setError("");
    try {
      const year = monthCursor.getFullYear();
      const month = monthCursor.getMonth();
      // Load 2 months around current view for week/day edge cases
      const timeMin = new Date(year, month - 1, 1).toISOString();
      const timeMax = new Date(year, month + 2, 1).toISOString();
      const loaded = await loadCalendarEvents(timeMin, timeMax);
      setEvents(loaded);
    } catch {
      setError("Unable to load calendar events.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthCursor]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useAutoRefresh(() => {
    void loadEvents();
  });

  // Real-time subscription
  useEffect(() => {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const timeMin = new Date(year, month - 1, 1).toISOString();
    const timeMax = new Date(year, month + 2, 1).toISOString();

    const unsubscribe = subscribeToCalendarUpdates(
      (updated) => setEvents(updated),
      timeMin,
      timeMax,
    );
    return unsubscribe;
  }, [monthCursor]);

  /* ── Navigation ─────────────────────────────────────────────────────── */

  function navigate(delta: number) {
    setCurrentDate((prev) => {
      if (viewMode === "month") {
        return new Date(prev.getFullYear(), prev.getMonth() + delta, 1);
      }
      if (viewMode === "week") {
        const d = new Date(prev);
        d.setDate(d.getDate() + delta * 7);
        return d;
      }
      // day
      const d = new Date(prev);
      d.setDate(d.getDate() + delta);
      return d;
    });
  }

  function goToToday() {
    const t = arizonaToday();
    setCurrentDate(new Date(t.year, t.month, t.day));
  }

  function goToDate(date: Date) {
    setCurrentDate(date);
    setSelectedDay(dateKeyFromDate(date));
  }

  /* ── Filtering ──────────────────────────────────────────────────────── */

  function toggleTeam(id: string) {
    setEnabledTeam((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function isEventVisible(event: CalendarEvent) {
    if (enabledTeam.size === 0) return true;
    if (enabledTeam.size === TEAM_MEMBERS.length) return true;
    return enabledTeam.has(event.assigned_to);
  }

  /* ── CRUD handlers ──────────────────────────────────────────────────── */

  async function handleCreateEvent(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setStatusMessage("");

    try {
      const startTime = `${form.date}T${form.startTime}:00`;
      const endTime = `${form.date}T${form.endTime}:00`;

      const result = await createCalendarEvent({
        title: form.title,
        description: form.description,
        start_time: new Date(startTime + "-07:00").toISOString(),
        end_time: new Date(endTime + "-07:00").toISOString(),
        all_day: false,
        location: form.location,
        color: form.color,
        assigned_to: form.assigned_to,
        customer_name: form.customer_name,
        customer_phone: form.customer_phone,
        job_kind: form.job_kind,
        created_by: form.assigned_to,
      });

      if (!result) {
        setError("Unable to create event.");
        return;
      }

      setStatusMessage("Event created successfully.");
      setForm({
        title: "",
        customer_name: "",
        customer_phone: "",
        location: "",
        job_kind: "Repair",
        date: "",
        startTime: "",
        endTime: "",
        description: "",
        color: "blue",
        assigned_to: TEAM_MEMBERS[0].id,
      });
      setNewScheduleOpen(false);
      await loadEvents();
    } catch {
      setError("Unable to create event.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateEvent(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedEvent) return;

    setUpdating(true);
    setError("");
    setStatusMessage("");

    try {
      const startTime = `${editForm.date}T${editForm.startTime}:00`;
      const endTime = `${editForm.date}T${editForm.endTime}:00`;

      const result = await updateCalendarEvent(selectedEvent.id, {
        title: editForm.title,
        description: editForm.description,
        start_time: new Date(startTime + "-07:00").toISOString(),
        end_time: new Date(endTime + "-07:00").toISOString(),
        location: editForm.location,
        color: editForm.color,
        assigned_to: editForm.assigned_to,
        customer_name: editForm.customer_name,
        customer_phone: editForm.customer_phone,
        job_kind: editForm.job_kind,
      });

      if (!result) {
        setError("Unable to update event.");
        return;
      }

      setStatusMessage("Event updated successfully.");
      setSelectedEvent(null);
      await loadEvents();
    } catch {
      setError("Unable to update event.");
    } finally {
      setUpdating(false);
    }
  }

  async function handleDeleteEvent() {
    if (!selectedEvent) return;
    setDeleting(true);
    setError("");

    try {
      const ok = await deleteCalendarEvent(selectedEvent.id);
      if (!ok) {
        setError("Unable to delete event.");
        return;
      }
      setStatusMessage("Event deleted.");
      setSelectedEvent(null);
      setDeleteConfirmOpen(false);
      await loadEvents();
    } catch {
      setError("Unable to delete event.");
    } finally {
      setDeleting(false);
    }
  }

  // Populate edit form when selecting an event
  useEffect(() => {
    if (!selectedEvent) return;
    const s = new Date(selectedEvent.start_time);
    const e = new Date(selectedEvent.end_time);
    setEditForm({
      title: selectedEvent.title,
      customer_name: selectedEvent.customer_name,
      customer_phone: selectedEvent.customer_phone,
      location: selectedEvent.location,
      job_kind: selectedEvent.job_kind || "Repair",
      date: isoDate(s),
      startTime: isoTime(s),
      endTime: isoTime(e),
      description: selectedEvent.description,
      color: selectedEvent.color || "blue",
      assigned_to: selectedEvent.assigned_to || TEAM_MEMBERS[0].id,
    });
  }, [selectedEvent]);

  /* ── Render helpers ─────────────────────────────────────────────────── */

  function renderEventChip(event: CalendarEvent, compact = false) {
    const cc = getColorConfig(event.color);
    const time = formatEventTime(event);
    return (
      <button
        key={event.id}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setSelectedEvent(event);
        }}
        className={`block w-full truncate rounded border px-1 py-0.5 text-left text-[10px] font-semibold leading-snug transition hover:opacity-80 sm:px-1.5 sm:py-[3px] sm:text-xs ${cc.color}`}
        title={`${event.title || "Untitled"}${time ? ` ${time}` : ""}`}
      >
        {compact ? (
          event.title || "Untitled"
        ) : (
          <span className="truncate">
            {event.title || "Untitled"}
            {time && (
              <span className="ml-1 hidden opacity-70 sm:inline">{time}</span>
            )}
          </span>
        )}
      </button>
    );
  }

  /* ── Month View ─────────────────────────────────────────────────────── */

  function renderMonthView() {
    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
        {/* Weekday Headers */}
        <div className="grid shrink-0 grid-cols-7 border-b border-gray-200 bg-gray-50">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="border-r border-gray-100 px-0.5 py-2 text-center text-xs font-bold uppercase tracking-wider text-gray-600 last:border-r-0 sm:px-2 sm:py-3 sm:text-sm"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Cells */}
        <div
          className="grid min-h-0 flex-1 grid-cols-7"
          style={{ gridAutoRows: "1fr" }}
        >
          {calendarCells.map((cell, index) => {
            const key = dateKeyFromDate(cell.date);
            const dayEvents = (eventsByDate[key] || []).filter(isEventVisible);
            const isToday = key === todayKey;
            const isDaySelected = key === selectedDay;
            const maxVisible = 3;

            return (
              <div
                key={`${key}-${index}`}
                className={`min-h-[80px] cursor-pointer border-b border-r border-gray-100 p-0.5 transition-colors hover:bg-blue-50/40 sm:min-h-[120px] sm:p-1.5 ${isDaySelected ? "bg-blue-50/60" : !cell.isCurrentMonth ? "bg-gray-50/50" : "bg-white"}`}
                onClick={() => {
                  setCurrentDate(cell.date);
                  setSelectedDay(key);
                  setViewMode("day");
                }}
              >
                <div className="mb-0.5 text-right sm:mb-1">
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold sm:h-7 sm:w-7 sm:text-sm ${isToday ? "bg-blue-600 text-white" : cell.isCurrentMonth ? "text-gray-900" : "text-gray-400"}`}
                  >
                    {cell.date.getDate()}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, maxVisible).map((event) =>
                    renderEventChip(event, true),
                  )}
                  {dayEvents.length > maxVisible && (
                    <div className="px-0.5 text-[10px] font-semibold text-blue-600 sm:px-1.5 sm:text-xs">
                      +{dayEvents.length - maxVisible} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* ── Week View ──────────────────────────────────────────────────────── */

  function renderWeekView() {
    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
        {/* Day headers */}
        <div className="grid shrink-0 grid-cols-[60px_repeat(7,1fr)] border-b border-gray-200 bg-gray-50">
          <div className="border-r border-gray-100" />
          {weekDays.map((day, i) => {
            const key = dateKeyFromDate(day);
            const isToday = key === todayKey;
            return (
              <div
                key={i}
                className={`cursor-pointer border-r border-gray-100 px-1 py-2 text-center last:border-r-0 hover:bg-blue-50 ${isToday ? "bg-blue-50" : ""}`}
                onClick={() => {
                  setCurrentDate(day);
                  setViewMode("day");
                }}
              >
                <div className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  {WEEKDAYS[i]}
                </div>
                <div
                  className={`mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${isToday ? "bg-blue-600 text-white" : "text-gray-900"}`}
                >
                  {day.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        {/* Time grid */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-[60px_repeat(7,1fr)]">
            {HOURS.map((hour) => (
              <div key={hour} className="contents">
                <div className="border-b border-r border-gray-100 px-1 py-2 text-right text-[10px] font-medium text-gray-400 sm:text-xs">
                  {formatHour(hour)}
                </div>
                {weekDays.map((day, dayIdx) => {
                  const key = dateKeyFromDate(day);
                  const hourEvents = (eventsByDate[key] || [])
                    .filter(isEventVisible)
                    .filter((ev) => eventHour(ev) === hour);
                  return (
                    <div
                      key={dayIdx}
                      className="relative min-h-[48px] border-b border-r border-gray-100 p-0.5 last:border-r-0"
                    >
                      {hourEvents.map((ev) => {
                        const span = Math.max(
                          1,
                          eventEndHour(ev) - eventHour(ev),
                        );
                        const cc = getColorConfig(ev.color);
                        return (
                          <button
                            key={ev.id}
                            type="button"
                            onClick={() => setSelectedEvent(ev)}
                            className={`absolute inset-x-0.5 z-10 overflow-hidden rounded border px-1 py-0.5 text-left text-[10px] font-semibold transition hover:opacity-80 sm:text-xs ${cc.color}`}
                            style={{
                              top: 0,
                              height: `${span * 48}px`,
                            }}
                            title={`${ev.title} ${formatEventTimeRange(ev)}`}
                          >
                            <div className="truncate">{ev.title}</div>
                            <div className="truncate opacity-70">
                              {formatEventTimeRange(ev)}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── Day View ───────────────────────────────────────────────────────── */

  function renderDayView() {
    const key = dateKeyFromDate(currentDate);
    const dayLabel = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(currentDate);

    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
        {/* Day header */}
        <div className="shrink-0 border-b border-gray-200 bg-gray-50 px-4 py-3">
          <div className="text-sm font-bold text-gray-900">{dayLabel}</div>
        </div>

        {/* Time grid */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-[60px_1fr]">
            {HOURS.map((hour) => {
              const hourEvents = (eventsByDate[key] || [])
                .filter(isEventVisible)
                .filter((ev) => eventHour(ev) === hour);
              return (
                <div key={hour} className="contents">
                  <div className="border-b border-r border-gray-100 px-2 py-3 text-right text-xs font-medium text-gray-400">
                    {formatHour(hour)}
                  </div>
                  <div className="relative min-h-[56px] border-b border-gray-100 p-1">
                    {hourEvents.map((ev) => {
                      const span = Math.max(
                        1,
                        eventEndHour(ev) - eventHour(ev),
                      );
                      const cc = getColorConfig(ev.color);
                      return (
                        <button
                          key={ev.id}
                          type="button"
                          onClick={() => setSelectedEvent(ev)}
                          className={`absolute inset-x-1 z-10 overflow-hidden rounded-lg border px-3 py-2 text-left transition hover:opacity-80 ${cc.color}`}
                          style={{
                            top: 0,
                            height: `${span * 56}px`,
                          }}
                        >
                          <div className="text-sm font-bold">{ev.title}</div>
                          <div className="mt-0.5 text-xs opacity-80">
                            {formatEventTimeRange(ev)}
                          </div>
                          {ev.customer_name && (
                            <div className="mt-0.5 text-xs opacity-70">
                              {ev.customer_name}
                            </div>
                          )}
                          {ev.location && (
                            <div className="mt-0.5 text-xs opacity-60">
                              {ev.location}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  /* ── Main Render ────────────────────────────────────────────────────── */

  return (
    <div className="flex min-h-0 max-w-full flex-1 flex-col overflow-x-hidden">
      {/* Status Messages */}
      {(error || statusMessage) && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3">
          {error && (
            <p className="text-sm font-medium text-red-600">{error}</p>
          )}
          {statusMessage && (
            <p className="text-sm font-medium text-blue-700">
              {statusMessage}
            </p>
          )}
        </div>
      )}

      {/* Top Toolbar */}
      <div className="sticky top-16 z-20 -mx-3 border-b border-gray-200 bg-white/95 px-3 py-1.5 backdrop-blur-sm sm:-mx-5 sm:px-5 sm:py-3">
        <div className="flex items-center justify-between gap-1.5 sm:gap-2">
          <div className="flex items-center gap-1.5 sm:gap-3">
            <button
              type="button"
              onClick={goToToday}
              className="rounded-md border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 sm:rounded-lg sm:px-4 sm:py-2 sm:text-sm"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="rounded-full p-1 text-gray-500 hover:bg-gray-100 sm:p-1.5"
              aria-label="Previous"
            >
              <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
            <button
              type="button"
              onClick={() => navigate(1)}
              className="rounded-full p-1 text-gray-500 hover:bg-gray-100 sm:p-1.5"
              aria-label="Next"
            >
              <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
            <h1 className="text-base font-bold text-gray-900 sm:text-xl">
              {headerLabel}
            </h1>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={loadEvents}
              className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100 sm:p-2"
              aria-label="Refresh"
            >
              <RefreshCw
                className={`h-4 w-4 sm:h-5 sm:w-5 ${loading ? "animate-spin" : ""}`}
              />
            </button>

            {/* View Switcher */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setViewDropdownOpen((prev) => !prev)}
                className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 sm:py-2 sm:text-sm"
              >
                {VIEW_LABELS[viewMode]}{" "}
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${viewDropdownOpen ? "rotate-180" : ""}`}
                />
              </button>
              {viewDropdownOpen && (
                <div className="absolute right-0 z-30 mt-1 w-36 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  {(["month", "week", "day"] as ViewMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setViewMode(mode);
                        setViewDropdownOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold ${viewMode === mode ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-gray-50"}`}
                    >
                      {VIEW_LABELS[mode]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setNewScheduleOpen(true)}
              className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 sm:px-4 sm:py-2 sm:text-sm"
            >
              <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> Event
            </button>
          </div>
        </div>
      </div>

      {/* Main Layout */}
      <div className="mt-1 flex min-h-0 flex-1 gap-2 sm:mt-2 sm:gap-4">
        {/* Calendar View */}
        {viewMode === "month" && renderMonthView()}
        {viewMode === "week" && renderWeekView()}
        {viewMode === "day" && renderDayView()}

        {/* Sidebar */}
        <aside className="hidden w-64 shrink-0 space-y-4 lg:block">
          {/* Mini Calendar */}
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900">{monthLabel}</h3>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setCurrentDate(
                      (prev) =>
                        new Date(prev.getFullYear(), prev.getMonth() - 1, 1),
                    )
                  }
                  className="rounded p-0.5 text-gray-400 hover:text-gray-600"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setCurrentDate(
                      (prev) =>
                        new Date(prev.getFullYear(), prev.getMonth() + 1, 1),
                    )
                  }
                  className="rounded p-0.5 text-gray-400 hover:text-gray-600"
                  aria-label="Next month"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] font-semibold text-gray-400">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-0.5 text-center">
              {miniCalCells.map((cell, idx) => {
                const isToday2 = cell.key === todayKey;
                const isSelected = cell.key === selectedDay;
                const hasEvents = Boolean(eventsByDate[cell.key]?.length);
                return (
                  <button
                    type="button"
                    key={`mini-${idx}`}
                    onClick={() => {
                      goToDate(cell.date);
                      setViewMode("day");
                    }}
                    className={`relative rounded-full py-0.5 text-xs cursor-pointer hover:bg-gray-100 ${isSelected && !isToday2 ? "bg-blue-100 font-bold text-blue-700" : isToday2 ? "bg-blue-600 font-bold text-white" : cell.isCurrentMonth ? "text-gray-700" : "text-gray-300"}`}
                  >
                    {cell.day}
                    {hasEvents && (
                      <span className="absolute bottom-0 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-blue-500" />
                    )}
                  </button>
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
                  if (enabledTeam.size === TEAM_MEMBERS.length)
                    setEnabledTeam(new Set());
                  else
                    setEnabledTeam(new Set(TEAM_MEMBERS.map((m) => m.id)));
                }}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span className="text-xs font-medium text-gray-700">
                Select all
              </span>
              <span className="ml-auto text-xs text-gray-400">
                {TEAM_MEMBERS.length}
              </span>
            </label>
            {TEAM_MEMBERS.map((member) => (
              <label
                key={member.id}
                className="flex cursor-pointer items-center gap-2 py-1"
              >
                <input
                  type="checkbox"
                  checked={enabledTeam.has(member.id)}
                  onChange={() => toggleTeam(member.id)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-xs font-medium text-gray-700">
                  {member.name}
                </span>
              </label>
            ))}
          </div>

          {/* Event Colors Legend */}
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <h3 className="mb-2 text-sm font-bold text-gray-900">
              Event Colors
            </h3>
            <div className="space-y-1">
              {EVENT_COLORS.slice(0, 6).map((c) => (
                <div key={c.id} className="flex items-center gap-2 px-1 py-1">
                  <span className={`h-3 w-3 rounded-sm ${c.dot}`} />
                  <span className="text-xs font-medium text-gray-700">
                    {c.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* ── New Event Modal ─────────────────────────────────────────── */}
      {newScheduleOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/30 p-3 sm:p-4"
          onClick={() => setNewScheduleOpen(false)}
        >
          <form
            id="new-event"
            onSubmit={handleCreateEvent}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 sm:px-6 sm:py-4">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600">
                  New event
                </p>
                <h2 className="mt-0.5 text-lg font-bold text-blue-700 sm:text-2xl">
                  Create Event
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setNewScheduleOpen(false)}
                aria-label="Close"
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="rounded-lg border border-gray-200 px-4 py-3 outline-none sm:col-span-2"
                  placeholder="Event title"
                />
                <input
                  value={form.customer_name}
                  onChange={(e) =>
                    setForm({ ...form, customer_name: e.target.value })
                  }
                  className="rounded-lg border border-gray-200 px-4 py-3 outline-none"
                  placeholder="Customer name"
                />
                <input
                  type="tel"
                  inputMode="tel"
                  value={form.customer_phone}
                  onChange={(e) =>
                    setForm({ ...form, customer_phone: e.target.value })
                  }
                  className="rounded-lg border border-gray-200 px-4 py-3 outline-none"
                  placeholder="Phone number"
                />
                <div className="sm:col-span-2">
                  <AddressAutocomplete
                    value={form.location}
                    onChange={(addr) => setForm({ ...form, location: addr })}
                    placeholder="Start typing job address..."
                  />
                </div>
                <select
                  value={form.job_kind}
                  onChange={(e) =>
                    setForm({ ...form, job_kind: e.target.value })
                  }
                  className="rounded-lg border border-gray-200 px-4 py-3 outline-none"
                >
                  <option>Repair</option>
                  <option>Replacement</option>
                  <option>Installation</option>
                  <option>Maintenance</option>
                  <option>Inspection</option>
                  <option>Other</option>
                </select>
                <select
                  value={form.assigned_to}
                  onChange={(e) =>
                    setForm({ ...form, assigned_to: e.target.value })
                  }
                  className="rounded-lg border border-gray-200 px-4 py-3 outline-none"
                >
                  {TEAM_MEMBERS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <input
                  required
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className="rounded-lg border border-gray-200 px-4 py-3 outline-none sm:col-span-2"
                />
                <input
                  required
                  type="time"
                  value={form.startTime}
                  onChange={(e) =>
                    setForm({ ...form, startTime: e.target.value })
                  }
                  className="rounded-lg border border-gray-200 px-4 py-3 outline-none"
                />
                <input
                  required
                  type="time"
                  value={form.endTime}
                  onChange={(e) =>
                    setForm({ ...form, endTime: e.target.value })
                  }
                  className="rounded-lg border border-gray-200 px-4 py-3 outline-none"
                />
                <select
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                  className="rounded-lg border border-gray-200 px-4 py-3 outline-none sm:col-span-2"
                >
                  {EVENT_COLORS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  className="min-h-[80px] rounded-lg border border-gray-200 px-4 py-3 outline-none sm:col-span-2"
                  placeholder="Notes"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-4 py-3 sm:px-6">
              <button
                type="button"
                onClick={() => setNewScheduleOpen(false)}
                className="rounded-lg border border-gray-200 px-4 py-2.5 font-bold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                disabled={saving}
                className="rounded-lg bg-blue-600 px-5 py-2.5 font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
              >
                {saving ? "Saving..." : "Create Event"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Event Detail / Edit Modal ──────────────────────────────── */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-gray-950/40 p-4"
          onClick={() => setSelectedEvent(null)}
        >
          <form
            onSubmit={handleUpdateEvent}
            onClick={(e) => e.stopPropagation()}
            className="mx-auto my-6 grid max-w-5xl gap-6 lg:grid-cols-[1fr_280px]"
          >
            {/* Main form */}
            <div className="rounded-2xl bg-white p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-gray-200 pb-4">
                <input
                  required
                  value={editForm.title}
                  onChange={(e) =>
                    setEditForm({ ...editForm, title: e.target.value })
                  }
                  className="w-full border-0 text-2xl font-bold text-blue-700 outline-none sm:text-3xl"
                  placeholder="Event title"
                />
                <button
                  type="button"
                  onClick={() => setSelectedEvent(null)}
                  className="rounded-full p-2 text-gray-500 hover:bg-gray-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <input
                  required
                  type="date"
                  value={editForm.date}
                  onChange={(e) =>
                    setEditForm({ ...editForm, date: e.target.value })
                  }
                  className="rounded-lg bg-gray-100 px-4 py-3 outline-none"
                />
                <input
                  required
                  type="time"
                  value={editForm.startTime}
                  onChange={(e) =>
                    setEditForm({ ...editForm, startTime: e.target.value })
                  }
                  className="rounded-lg bg-gray-100 px-4 py-3 outline-none"
                />
                <span className="font-semibold text-gray-600">to</span>
                <input
                  required
                  type="time"
                  value={editForm.endTime}
                  onChange={(e) =>
                    setEditForm({ ...editForm, endTime: e.target.value })
                  }
                  className="rounded-lg bg-gray-100 px-4 py-3 outline-none"
                />
                <span className="text-sm font-semibold text-gray-500">
                  (GMT-07:00) Phoenix
                </span>
              </div>

              <div className="mt-6 rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                <div className="grid gap-4">
                  <label className="grid grid-cols-[28px_1fr] items-center gap-4">
                    <User className="h-5 w-5 text-gray-500" />
                    <input
                      value={editForm.customer_name}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          customer_name: e.target.value,
                        })
                      }
                      className="rounded-lg bg-gray-100 px-4 py-3 outline-none"
                      placeholder="Customer name"
                    />
                  </label>
                  <div className="grid grid-cols-[28px_1fr] items-center gap-4">
                    <Phone className="h-5 w-5 text-gray-500" />
                    <div className="flex items-center gap-2">
                      <input
                        type="tel"
                        inputMode="tel"
                        value={editForm.customer_phone}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            customer_phone: e.target.value,
                          })
                        }
                        className="flex-1 rounded-lg bg-gray-100 px-4 py-3 outline-none"
                        placeholder="Phone number"
                      />
                      {telHref(editForm.customer_phone) && (
                        <a
                          href={telHref(editForm.customer_phone)}
                          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-blue-500 px-4 py-3 font-bold text-white hover:bg-blue-600"
                        >
                          <Phone className="h-4 w-4" />
                          Call
                        </a>
                      )}
                      {telHref(editForm.customer_phone) && (
                        <button
                          type="button"
                          onClick={() =>
                            setSmsTarget({
                              phone: editForm.customer_phone,
                              name: editForm.customer_name,
                            })
                          }
                          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-green-500 px-4 py-3 font-bold text-white hover:bg-green-600"
                        >
                          <MessageSquare className="h-4 w-4" />
                          SMS
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-[28px_1fr] items-center gap-4">
                    <MapPin className="h-5 w-5 text-gray-500" />
                    <div className="flex items-center gap-2">
                      <input
                        value={editForm.location}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            location: e.target.value,
                          })
                        }
                        className="flex-1 rounded-lg bg-gray-100 px-4 py-3 outline-none"
                        placeholder="Job address"
                      />
                      {editForm.location && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(editForm.location)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-blue-500 px-4 py-3 font-bold text-white hover:bg-blue-600"
                        >
                          <MapPin className="h-4 w-4" />
                          Map
                        </a>
                      )}
                    </div>
                  </div>
                  <label className="grid grid-cols-[28px_1fr] items-center gap-4">
                    <Briefcase className="h-5 w-5 text-gray-500" />
                    <select
                      value={editForm.job_kind}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          job_kind: e.target.value,
                        })
                      }
                      className="rounded-lg bg-gray-100 px-4 py-3 outline-none"
                    >
                      <option>Repair</option>
                      <option>Replacement</option>
                      <option>Installation</option>
                      <option>Maintenance</option>
                      <option>Inspection</option>
                      <option>Other</option>
                    </select>
                  </label>
                  <label className="grid grid-cols-[28px_1fr] items-center gap-4">
                    <Clock className="h-5 w-5 text-gray-500" />
                    <select
                      value={editForm.assigned_to}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          assigned_to: e.target.value,
                        })
                      }
                      className="rounded-lg bg-gray-100 px-4 py-3 outline-none"
                    >
                      {TEAM_MEMBERS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-[28px_1fr] items-start gap-4">
                    <AlignLeft className="mt-3 h-5 w-5 text-gray-500" />
                    <textarea
                      value={editForm.description}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          description: e.target.value,
                        })
                      }
                      className="min-h-32 rounded-lg bg-gray-100 px-4 py-3 outline-none"
                      placeholder="Add description / notes"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmOpen(true)}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-3 font-bold text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
                <button
                  disabled={updating}
                  className="rounded-lg bg-blue-600 px-6 py-3 font-bold text-white disabled:bg-gray-300"
                >
                  {updating ? "Saving..." : "Save changes"}
                </button>
              </div>
            </div>

            {/* Sidebar */}
            <aside className="rounded-2xl bg-white p-5 shadow-2xl">
              <div className="border-b border-gray-200 pb-3">
                <h3 className="font-bold text-blue-700">Event Color</h3>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2">
                {EVENT_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() =>
                      setEditForm({ ...editForm, color: c.id })
                    }
                    className={`flex h-8 w-8 items-center justify-center rounded-full ${c.dot} ${editForm.color === c.id ? "ring-2 ring-blue-500 ring-offset-2" : ""}`}
                    title={c.label}
                  >
                    {editForm.color === c.id && (
                      <svg
                        className="h-4 w-4 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </button>
                ))}
              </div>

              <div className="mt-6 border-t border-gray-200 pt-4">
                <h3 className="font-bold text-gray-700">Assigned to</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {TEAM_MEMBERS.find((m) => m.id === editForm.assigned_to)
                    ?.name || "Unassigned"}
                </p>
              </div>

              {selectedEvent.created_at && (
                <div className="mt-6 border-t border-gray-200 pt-4">
                  <p className="text-xs text-gray-400">
                    Created{" "}
                    {new Intl.DateTimeFormat("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: ARIZONA_TIMEZONE,
                    }).format(new Date(selectedEvent.created_at))}
                  </p>
                </div>
              )}
            </aside>
          </form>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirmOpen && selectedEvent && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-950/50 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900">Delete Event</h3>
            <p className="mt-2 text-sm text-gray-600">
              Are you sure you want to delete &quot;{selectedEvent.title}
              &quot;? This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 font-bold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDeleteEvent}
                className="rounded-lg bg-red-600 px-4 py-2 font-bold text-white hover:bg-red-700 disabled:bg-gray-300"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {smsTarget && (
        <QuickSmsModal
          phone={smsTarget.phone}
          name={smsTarget.name}
          onClose={() => setSmsTarget(null)}
        />
      )}
    </div>
  );
}
