"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin, Phone, Plus, Trash2, User, X } from "lucide-react";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { showToast } from "@/components/crm/Toast";

const APPOINTMENT_TYPES = [
  "Roof Inspection",
  "Installation",
  "Follow-Up",
  "Warranty Visit",
  "Insurance Adjuster Meeting",
  "Estimate Review",
  "Emergency Repair",
  "Final Walkthrough",
] as const;

type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

type ScheduleEvent = {
  id: string;
  title: string;
  customerName: string;
  phone: string;
  address: string;
  appointmentType: AppointmentType;
  date: string;
  startTime: string;
  endTime: string;
  notes: string;
  assignedTo: string;
  status: "Scheduled" | "Completed" | "Cancelled" | "No Show";
};

const STORAGE_KEY = "xrp-crm-schedule";
const ARIZONA_TIMEZONE = "America/Phoenix";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function readSchedule(): ScheduleEvent[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]") as ScheduleEvent[];
  } catch {
    return [];
  }
}

function saveSchedule(events: ScheduleEvent[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch { /* quota */ }
}

function dateKey(year: number, month: number, day: number) {
  return `${year}-${month}-${day}`;
}

function getTypeColor(type: AppointmentType) {
  switch (type) {
    case "Roof Inspection": return "bg-blue-100 text-blue-700 border-blue-200";
    case "Installation": return "bg-orange-100 text-orange-700 border-orange-200";
    case "Follow-Up": return "bg-green-100 text-green-700 border-green-200";
    case "Warranty Visit": return "bg-purple-100 text-purple-700 border-purple-200";
    case "Insurance Adjuster Meeting": return "bg-yellow-100 text-yellow-700 border-yellow-200";
    case "Estimate Review": return "bg-sky-100 text-sky-700 border-sky-200";
    case "Emergency Repair": return "bg-red-100 text-red-700 border-red-200";
    case "Final Walkthrough": return "bg-teal-100 text-teal-700 border-teal-200";
    default: return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

function getStatusBadge(status: ScheduleEvent["status"]) {
  switch (status) {
    case "Completed": return "bg-green-600 text-white";
    case "Cancelled": return "bg-red-500 text-white";
    case "No Show": return "bg-gray-500 text-white";
    default: return "bg-blue-600 text-white";
  }
}

export default function SchedulePage() {
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<ScheduleEvent | null>(null);
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: ARIZONA_TIMEZONE, year: "numeric", month: "numeric" });
    const parts = formatter.formatToParts(now);
    const year = Number(parts.find((p) => p.type === "year")?.value);
    const month = Number(parts.find((p) => p.type === "month")?.value) - 1;
    return new Date(year, month, 1);
  });
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    customerName: "",
    phone: "",
    address: "",
    appointmentType: "Roof Inspection" as AppointmentType,
    date: "",
    startTime: "09:00",
    endTime: "10:00",
    notes: "",
    assignedTo: "Jonathan Gonzalez",
  });

  const loadEvents = useCallback(() => {
    const stored = readSchedule();
    setEvents(stored);
    setLoaded(true);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadEvents(); }, [loadEvents]);
  useAutoRefresh(loadEvents);

  useEffect(() => {
    if (!loaded) return;
    saveSchedule(events);
  }, [events, loaded]);

  const todayKey = useMemo(() => {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: ARIZONA_TIMEZONE, year: "numeric", month: "numeric", day: "numeric" });
    const parts = formatter.formatToParts(now);
    const year = Number(parts.find((p) => p.type === "year")?.value);
    const month = Number(parts.find((p) => p.type === "month")?.value) - 1;
    const day = Number(parts.find((p) => p.type === "day")?.value);
    return dateKey(year, month, day);
  }, []);

  const calendarCells = useMemo(() => {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<Date | null> = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [monthCursor]);

  const eventsByDate = useMemo(() => {
    const grouped: Record<string, ScheduleEvent[]> = {};
    events.forEach((event) => {
      const [y, m, d] = event.date.split("-").map(Number);
      const key = dateKey(y, m - 1, d);
      grouped[key] = [...(grouped[key] || []), event];
    });
    return grouped;
  }, [events]);

  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(monthCursor);
  const activeDayKey = selectedDayKey || todayKey;
  const dayEvents = eventsByDate[activeDayKey] || [];

  const activeDayLabel = useMemo(() => {
    const [year, month, day] = activeDayKey.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date(year, month, day));
  }, [activeDayKey]);

  const upcomingEvents = useMemo(() => {
    const now = new Date();
    return [...events]
      .filter((e) => new Date(`${e.date}T${e.startTime || "00:00"}`) >= now && e.status === "Scheduled")
      .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
      .slice(0, 5);
  }, [events]);

  function handleCreateEvent(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customerName || !form.date) return;
    const newEvent: ScheduleEvent = {
      id: `sch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: form.title || `${form.appointmentType} — ${form.customerName}`,
      customerName: form.customerName,
      phone: form.phone,
      address: form.address,
      appointmentType: form.appointmentType,
      date: form.date,
      startTime: form.startTime,
      endTime: form.endTime,
      notes: form.notes,
      assignedTo: form.assignedTo,
      status: "Scheduled",
    };
    setEvents((prev) => [newEvent, ...prev]);
    setShowForm(false);
    setForm({ title: "", customerName: "", phone: "", address: "", appointmentType: "Roof Inspection", date: "", startTime: "09:00", endTime: "10:00", notes: "", assignedTo: "Jonathan Gonzalez" });
    showToast("Appointment scheduled");
  }

  function updateEventStatus(eventId: string, status: ScheduleEvent["status"]) {
    setEvents((prev) => prev.map((e) => e.id === eventId ? { ...e, status } : e));
    showToast(`Appointment marked as ${status.toLowerCase()}`);
  }

  function deleteEvent(eventId: string) {
    setEvents((prev) => prev.filter((e) => e.id !== eventId));
    setSelectedEvent(null);
    showToast("Appointment deleted");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-orange-600">CRM Module</p>
          <h1 className="mt-2 text-2xl font-bold text-blue-700 sm:text-3xl">Schedule</h1>
          <p className="crm-board-subtitle mt-2 hidden text-gray-600 sm:block">Manage job appointments, inspections, installations, and follow-ups.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700">
          <Plus className="h-4 w-4" /> New Appointment
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Calendar */}
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">{monthLabel}</h2>
            <div className="flex gap-1">
              <button onClick={() => { setSelectedDayKey(null); setMonthCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1)); }} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><ChevronLeft className="h-5 w-5" /></button>
              <button onClick={() => { setSelectedDayKey(null); setMonthCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1)); }} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><ChevronRight className="h-5 w-5" /></button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-7 gap-px">
            {WEEKDAYS.map((d) => <div key={d} className="pb-2 text-center text-xs font-bold uppercase text-gray-400">{d}</div>)}
            {calendarCells.map((cell, idx) => {
              if (!cell) return <div key={`empty-${idx}`} className="h-12 sm:h-16" />;
              const key = dateKey(cell.getFullYear(), cell.getMonth(), cell.getDate());
              const isToday = key === todayKey;
              const isActive = key === activeDayKey;
              const count = (eventsByDate[key] || []).length;
              return (
                <button key={key} type="button" onClick={() => setSelectedDayKey(key)} className={`flex h-12 flex-col items-center justify-center rounded-lg transition sm:h-16 ${isActive ? "bg-blue-600 text-white" : isToday ? "bg-blue-50 text-blue-700 font-bold" : "text-gray-700 hover:bg-gray-50"}`}>
                  <span className="text-sm font-semibold">{cell.getDate()}</span>
                  {count > 0 && <span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${isActive ? "bg-white" : "bg-orange-500"}`} />}
                </button>
              );
            })}
          </div>

          {/* Day agenda */}
          <div className="mt-6 border-t border-gray-100 pt-4">
            <h3 className="text-sm font-bold text-gray-900">{activeDayLabel}</h3>
            {dayEvents.length === 0 && <p className="mt-3 text-sm text-gray-400">No appointments scheduled.</p>}
            <div className="mt-3 space-y-2">
              {dayEvents.sort((a, b) => a.startTime.localeCompare(b.startTime)).map((event) => (
                <button key={event.id} type="button" onClick={() => setSelectedEvent(event)} className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition hover:shadow-sm ${getTypeColor(event.appointmentType)}`}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{event.title}</p>
                    <p className="mt-0.5 text-xs opacity-80">{event.startTime} – {event.endTime}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${getStatusBadge(event.status)}`}>{event.status}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar: upcoming + detail */}
        <div className="space-y-4">
          {/* Upcoming */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="flex items-center gap-2 text-sm font-bold text-gray-900"><CalendarDays className="h-4 w-4 text-orange-500" /> Upcoming</h3>
            {upcomingEvents.length === 0 && <p className="mt-3 text-sm text-gray-400">No upcoming appointments.</p>}
            <div className="mt-3 space-y-2">
              {upcomingEvents.map((event) => (
                <button key={event.id} type="button" onClick={() => setSelectedEvent(event)} className="flex w-full items-start gap-3 rounded-lg bg-gray-50 p-3 text-left transition hover:bg-gray-100">
                  <div className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${event.appointmentType === "Installation" ? "bg-orange-500" : event.appointmentType === "Emergency Repair" ? "bg-red-500" : "bg-blue-500"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-gray-800">{event.customerName}</p>
                    <p className="text-xs text-gray-500">{event.appointmentType}</p>
                    <p className="text-xs text-gray-400">{new Date(`${event.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {event.startTime}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Event detail */}
          {selectedEvent && (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-gray-900">{selectedEvent.title}</h3>
                <button onClick={() => setSelectedEvent(null)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"><X className="h-4 w-4" /></button>
              </div>
              <span className={`mt-2 inline-block rounded-full border px-3 py-1 text-xs font-bold ${getTypeColor(selectedEvent.appointmentType)}`}>{selectedEvent.appointmentType}</span>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex items-center gap-2 text-gray-600"><User className="h-4 w-4 text-gray-400" />{selectedEvent.customerName}</div>
                {selectedEvent.phone && <div className="flex items-center gap-2 text-gray-600"><Phone className="h-4 w-4 text-gray-400" /><a href={`tel:${selectedEvent.phone.replace(/\D/g, "")}`} className="text-blue-600 hover:underline">{selectedEvent.phone}</a></div>}
                {selectedEvent.address && <div className="flex items-center gap-2 text-gray-600"><MapPin className="h-4 w-4 text-gray-400" />{selectedEvent.address}</div>}
                <div className="flex items-center gap-2 text-gray-600"><Clock className="h-4 w-4 text-gray-400" />{selectedEvent.startTime} – {selectedEvent.endTime}</div>
                <div className="flex items-center gap-2 text-gray-600"><CalendarDays className="h-4 w-4 text-gray-400" />{new Date(`${selectedEvent.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div>
              </div>
              {selectedEvent.notes && <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">{selectedEvent.notes}</p>}
              <p className="mt-2 text-xs text-gray-400">Assigned to {selectedEvent.assignedTo}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {selectedEvent.status === "Scheduled" && (
                  <>
                    <button onClick={() => updateEventStatus(selectedEvent.id, "Completed")} className="rounded-lg bg-green-600 px-3 py-2 text-xs font-bold text-white hover:bg-green-700">Mark Complete</button>
                    <button onClick={() => updateEventStatus(selectedEvent.id, "No Show")} className="rounded-lg bg-gray-500 px-3 py-2 text-xs font-bold text-white hover:bg-gray-600">No Show</button>
                    <button onClick={() => updateEventStatus(selectedEvent.id, "Cancelled")} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50">Cancel</button>
                  </>
                )}
                <button onClick={() => { if (window.confirm("Delete this appointment?")) deleteEvent(selectedEvent.id); }} className="rounded-lg px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50"><Trash2 className="inline h-3.5 w-3.5" /> Delete</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create Appointment Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/20 p-3 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setShowForm(false)}>
          <form onSubmit={handleCreateEvent} className="my-auto w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-bold text-gray-900">New Appointment</h2>
              <button type="button" onClick={() => setShowForm(false)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 p-6">
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wide text-gray-500">Appointment Type</span>
                <select value={form.appointmentType} onChange={(e) => setForm({ ...form, appointmentType: e.target.value as AppointmentType })} className="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-medium outline-none focus:border-blue-300 focus:bg-white">
                  {APPOINTMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wide text-gray-500">Customer Name *</span>
                  <input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} required className="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="e.g. Maria Hernandez" />
                </label>
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wide text-gray-500">Phone</span>
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="(602) 555-0184" />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wide text-gray-500">Address</span>
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="2148 E Camelback Rd, Phoenix, AZ" />
              </label>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wide text-gray-500">Date *</span>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required className="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" />
                </label>
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wide text-gray-500">Start Time</span>
                  <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" />
                </label>
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wide text-gray-500">End Time</span>
                  <input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wide text-gray-500">Assigned To</span>
                <input value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" />
              </label>
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wide text-gray-500">Notes</span>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="mt-1 w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="Any additional notes..." />
              </label>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
              <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50">Cancel</button>
              <button type="submit" className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700">Schedule</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
