"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAutoRefresh, broadcastCrmUpdate } from "@/lib/use-auto-refresh";
import { azNoon, azParts } from "@/lib/arizona-time";
import { AiWriteButton } from "@/components/crm/AiWritingAssistant";
import {
  AlignLeft,
  Briefcase,
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  MessageSquare,
  Phone,
  PhoneOutgoing,
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
import { getTwilioLines } from "@/lib/twilio/numbers";
import { logCrewActivity } from "@/lib/crew-activity";

// Arizona Mountain Time
const ARIZONA_TIMEZONE = "America/Phoenix";

type ViewMode = "timeline" | "month" | "week" | "day";

const VIEW_LABELS: Record<ViewMode, string> = {
  timeline: "Timeline",
  day: "Day",
  week: "Week",
  month: "Month",
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
  const p = azParts(d);
  return dateKey(p.year, p.month, p.day);
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

function hasPhone(phone: string) {
  return !!(phone || "").replace(/[^\d+]/g, "");
}

function getWeekStart(date: Date): Date {
  const p = azParts(date);
  return azNoon(p.year, p.month, p.day - p.dow);
}

function isoDate(d: Date): string {
  const p = azParts(d);
  const mm = String(p.month + 1).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  return `${p.year}-${mm}-${dd}`;
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
  { id: "jonathan", name: "Jonathan Gonzalez", email: "info@xrproofing.com", teamColor: "blue" as const },
  { id: "darwin", name: "Darwin Rodas Garcia", email: "", teamColor: "green" as const },
  { id: "office", name: "Office", email: "info@xrproofing.com", teamColor: "purple" as const },
];

const TEAM_COLOR_STYLES: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  green: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200", dot: "bg-green-500" },
  blue: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", dot: "bg-blue-500" },
  orange: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", dot: "bg-orange-500" },
  purple: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", dot: "bg-purple-500" },
};

function getTeamColor(memberId: string) {
  const member = TEAM_MEMBERS.find((m) => m.id === memberId);
  return member ? TEAM_COLOR_STYLES[member.teamColor] || TEAM_COLOR_STYLES.blue : null;
}

const JOB_KINDS = ["Roof Inspection", "Repair", "Roof Replacement", "Maintenance", "Maintenance Inspection", "Emergency Repair", "Estimate", "Other"];
const JOB_KIND_ALIASES: Record<string, string> = {
  Inspection: "Roof Inspection",
  Replacement: "Roof Replacement",
  Installation: "Roof Replacement",
};
function normalizeJobKind(kind: string): string {
  return JOB_KIND_ALIASES[kind] || kind;
}
const DEFAULT_TAGS = ["Urgent", "Follow-up", "VIP", "Insurance", "Commercial", "Residential"];

/* ── Google Calendar helpers ────────────────────────────────────────────── */

type GoogleCalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  attendees?: { email?: string; displayName?: string }[];
  creator?: { email?: string };
  extendedProperties?: { private?: Record<string, string> };
  created?: string;
  updated?: string;
};

const GCAL_PREFIX = "gcal:";

function isGoogleEvent(event: CalendarEvent): boolean {
  return event.id.startsWith(GCAL_PREFIX);
}

function mapGoogleEvent(ge: GoogleCalendarEvent): CalendarEvent {
  const allDay = Boolean(ge.start?.date && !ge.start?.dateTime);
  const startRaw = ge.start?.dateTime || ge.start?.date || "";
  const endRaw = ge.end?.dateTime || ge.end?.date || "";
  const startTime = startRaw ? new Date(startRaw).toISOString() : new Date().toISOString();
  let endTime = endRaw ? new Date(endRaw).toISOString() : startTime;
  if (allDay && endRaw) {
    const ed = new Date(endRaw);
    ed.setDate(ed.getDate() - 1);
    if (ed >= new Date(startRaw)) {
      endTime = ed.toISOString();
    }
  }
  const priv = ge.extendedProperties?.private || {};
  return {
    id: `${GCAL_PREFIX}${ge.id}`,
    title: ge.summary || "(No title)",
    description: ge.description || "",
    start_time: startTime,
    end_time: endTime,
    all_day: allDay,
    location: ge.location || priv.crmAddress || "",
    color: "cyan",
    assigned_to: "",
    customer_name: priv.crmName || "",
    customer_phone: priv.crmPhone || "",
    job_kind: priv.crmJobKind || "",
    created_by: ge.creator?.email || "",
    created_at: ge.created || "",
    updated_at: ge.updated || "",
  };
}

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
  const [googleConnected, setGoogleConnected] = useState(false);
  // Map of CRM event id → its linked Google Calendar event id, so edits/deletes
  // update the same Google event instead of creating duplicates. Populated from
  // the Google events' extendedProperties.private.crmEventId on every load.
  const crmToGoogleRef = useRef<Map<string, string>>(new Map());

  // URL search params for deep-linking (e.g. ?view=day&date=2026-06-22)
  const searchParams = useSearchParams();

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const v = searchParams.get("view");
    if (v === "timeline" || v === "day" || v === "week" || v === "month") return v;
    return "month";
  });
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);
  const [currentDate, setCurrentDate] = useState(() => {
    const dp = searchParams.get("date");
    if (dp) {
      const [y, m, d] = dp.split("-").map(Number);
      if (y && m && d) return azNoon(y, m - 1, d);
    }
    const t = arizonaToday();
    return azNoon(t.year, t.month, t.day);
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Sync state when URL search params change (Next.js soft navigation)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    const v = searchParams.get("view");
    if (v === "timeline" || v === "day" || v === "week" || v === "month") setViewMode(v as ViewMode);
    const dp = searchParams.get("date");
    if (dp) {
      const [y, m, d] = dp.split("-").map(Number);
      if (y && m && d) setCurrentDate(azNoon(y, m - 1, d));
    }
  }, [searchParams]);

  // Mobile week view: selected day index within the week (0–6)
  const [mobileWeekDayIdx, setMobileWeekDayIdx] = useState(() => azParts(new Date()).dow);

  // Modal state
  const [newScheduleOpen, setNewScheduleOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
    null,
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [createSuccess, setCreateSuccess] = useState(false);
  const [editMode, setEditMode] = useState(false);

  // Click-to-call state
  const [callPickerEvent, setCallPickerEvent] = useState<CalendarEvent | null>(null);
  const twilioLines = useMemo(() => getTwilioLines(), []);

  // Team & color filters
  const [enabledTeam, setEnabledTeam] = useState<Set<string>>(
    new Set(TEAM_MEMBERS.map((m) => m.id)),
  );

  // ── Filter state (Workiz-style) ─────────────────────────────────────────
  const [filterPopup, setFilterPopup] = useState<"status" | "tags" | "team" | "type" | null>(null);
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set(["open", "done"]));
  const [itemTypeFilter, setItemTypeFilter] = useState<Set<string>>(new Set(["jobs", "events"]));
  const [enabledJobKinds, setEnabledJobKinds] = useState<Set<string>>(new Set(JOB_KINDS));
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  const [eventTags, setEventTags] = useState<Record<string, string[]>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem("xrp:calendar-tags") || "{}"); } catch { return {}; }
  });
  const [newTagInput, setNewTagInput] = useState("");

  const allTags = useMemo(() => {
    const tags = new Set(DEFAULT_TAGS);
    Object.values(eventTags).flat().forEach((t) => tags.add(t));
    return Array.from(tags);
  }, [eventTags]);

  // Persist tags to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("xrp:calendar-tags", JSON.stringify(eventTags));
    }
  }, [eventTags]);

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
    guestEmails: "",
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
    guestEmails: "",
  });

  /* ── Derived values ─────────────────────────────────────────────────── */

  const monthCursor = useMemo(() => {
    const p = azParts(currentDate);
    return azNoon(p.year, p.month, 1);
  }, [currentDate]);

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        month: "long",
        year: "numeric",
        timeZone: ARIZONA_TIMEZONE,
      }).format(monthCursor),
    [monthCursor],
  );

  const todayKey = useMemo(() => {
    const t = arizonaToday();
    return dateKey(t.year, t.month, t.day);
  }, []);

  const calendarCells = useMemo(() => {
    const mc = azParts(monthCursor);
    const year = mc.year;
    const month = mc.month;
    const startWeekday = azParts(azNoon(year, month, 1)).dow;
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const prevMonthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const cells: Array<{ date: Date; isCurrentMonth: boolean }> = [];
    for (let i = startWeekday - 1; i >= 0; i--) {
      cells.push({
        date: azNoon(year, month - 1, prevMonthDays - i),
        isCurrentMonth: false,
      });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push({ date: azNoon(year, month, day), isCurrentMonth: true });
    }
    while (cells.length % 7 !== 0) {
      const nextDay = cells.length - startWeekday - daysInMonth + 1;
      cells.push({
        date: azNoon(year, month + 1, nextDay),
        isCurrentMonth: false,
      });
    }
    return cells;
  }, [monthCursor]);

  const miniCalCells = useMemo(() => {
    const mc = azParts(monthCursor);
    const year = mc.year;
    const month = mc.month;
    const startWeekday = azParts(azNoon(year, month, 1)).dow;
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const prevMonthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
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
        date: azNoon(year, month - 1, d),
        isCurrentMonth: false,
        key: dateKey(year, month - 1, d),
      });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({
        day,
        date: azNoon(year, month, day),
        isCurrentMonth: true,
        key: dateKey(year, month, day),
      });
    }
    while (cells.length % 7 !== 0) {
      const d = cells.length - startWeekday - daysInMonth + 1;
      cells.push({
        day: d,
        date: azNoon(year, month + 1, d),
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
    const sp = azParts(start);
    return Array.from({ length: 7 }, (_, i) =>
      azNoon(sp.year, sp.month, sp.day + i),
    );
  }, [currentDate]);

  const headerLabel = useMemo(() => {
    if (viewMode === "month") return monthLabel;
    if (viewMode === "week") {
      const start = weekDays[0];
      const end = weekDays[6];
      const fmt = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        timeZone: ARIZONA_TIMEZONE,
      });
      const yearFmt = new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: ARIZONA_TIMEZONE });
      return `${fmt.format(start)} – ${fmt.format(end)}, ${yearFmt.format(end)}`;
    }
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: ARIZONA_TIMEZONE,
    }).format(currentDate);
  }, [viewMode, monthLabel, weekDays, currentDate]);

  /* ── Data loading ───────────────────────────────────────────────────── */

  const loadEvents = useCallback(async () => {
    if (events.length === 0) setLoading(true);
    setError("");
    try {
      const mc = azParts(monthCursor);
      // Load 2 months around current view for week/day edge cases
      const timeMin = azNoon(mc.year, mc.month - 1, 1).toISOString();
      const timeMax = azNoon(mc.year, mc.month + 2, 1).toISOString();

      // Fetch CRM events and Google Calendar events in parallel
      const [crmEvents, gcalResult] = await Promise.all([
        loadCalendarEvents(timeMin, timeMax),
        fetch(`/api/google-calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`)
          .then((r) => r.json())
          .catch(() => ({ connected: false, events: [] })),
      ]);

      const gcalConnected = gcalResult.connected === true;
      setGoogleConnected(gcalConnected);

      const rawGcalEvents = (gcalConnected ? (gcalResult.events || []) : []) as GoogleCalendarEvent[];

      // Rebuild the CRM-event → Google-event link map from the source of truth
      // (each Google event carries its originating crmEventId), so edits/deletes
      // target the existing Google event instead of creating a duplicate.
      const linkMap = new Map<string, string>();
      for (const ge of rawGcalEvents) {
        const crmEventId = ge.extendedProperties?.private?.crmEventId;
        if (crmEventId && ge.id) linkMap.set(crmEventId, ge.id);
      }
      crmToGoogleRef.current = linkMap;

      const gcalEvents: CalendarEvent[] = rawGcalEvents.map(mapGoogleEvent);

      // Merge: preserve optimistic entries that haven't been confirmed yet
      setEvents((prev) => {
        const optimistic = prev.filter((e) => e.id.startsWith("optimistic-"));
        const realIds = new Set(crmEvents.map((e) => e.title + e.start_time));
        const pendingOptimistic = optimistic.filter((o) => !realIds.has(o.title + o.start_time));
        return [...crmEvents, ...gcalEvents, ...pendingOptimistic];
      });
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

  // Real-time subscription — merges updates without replacing optimistic entries
  useEffect(() => {
    const mc2 = azParts(monthCursor);
    const timeMin = azNoon(mc2.year, mc2.month - 1, 1).toISOString();
    const timeMax = azNoon(mc2.year, mc2.month + 2, 1).toISOString();

    const unsubscribe = subscribeToCalendarUpdates(
      (updated) =>
        setEvents((prev) => {
          const gcalEvents = prev.filter((e) => isGoogleEvent(e));
          // Remove any optimistic entries that now have real counterparts
          const optimistic = prev.filter((e) => e.id.startsWith("optimistic-"));
          const merged = [...updated];
          // Keep optimistic events only if no real event matches them yet
          for (const opt of optimistic) {
            const hasReal = updated.some((u) => u.title === opt.title && u.start_time === opt.start_time);
            if (!hasReal) merged.push(opt);
          }
          return [...merged, ...gcalEvents];
        }),
      timeMin,
      timeMax,
    );
    return unsubscribe;
  }, [monthCursor]);

  /* ── Navigation ─────────────────────────────────────────────────────── */

  function navigate(delta: number) {
    setCurrentDate((prev) => {
      const p = azParts(prev);
      if (viewMode === "month") {
        return azNoon(p.year, p.month + delta, 1);
      }
      if (viewMode === "week") {
        return azNoon(p.year, p.month, p.day + delta * 7);
      }
      // day or timeline
      return azNoon(p.year, p.month, p.day + delta);
    });
  }

  function goToToday() {
    const t = arizonaToday();
    setCurrentDate(azNoon(t.year, t.month, t.day));
  }

  function goToDate(date: Date) {
    setCurrentDate(date);
    setSelectedDay(dateKeyFromDate(date));
  }

  /* ── Swipe navigation (mobile) ─────────────────────────────────────── */

  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const swiping = useRef(false);

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    swiping.current = true;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (!swiping.current) return;
    swiping.current = false;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;
    navigate(dx < 0 ? 1 : -1);
  }

  /* ── Drag and drop (reschedule events) ────────────────────────────── */

  const [dragEventId, setDragEventId] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  function handleDragStart(e: React.DragEvent, eventId: string) {
    setDragEventId(eventId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", eventId);
  }

  function handleDragOver(e: React.DragEvent, dateKey: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverDate(dateKey);
  }

  function handleDragLeave() {
    setDragOverDate(null);
  }

  async function handleDrop(e: React.DragEvent, dateKey: string) {
    e.preventDefault();
    setDragOverDate(null);
    const eventId = e.dataTransfer.getData("text/plain") || dragEventId;
    setDragEventId(null);
    if (!eventId) return;
    const ev = events.find((x) => x.id === eventId);
    if (!ev) return;
    const [y, m, d] = dateKey.split("-").map(Number);
    const oldStart = new Date(ev.start_time);
    const oldEnd = new Date(ev.end_time);
    const diff = oldEnd.getTime() - oldStart.getTime();
    const newStart = new Date(oldStart);
    newStart.setFullYear(y, m - 1, d);
    const newEnd = new Date(newStart.getTime() + diff);
    const updated = { ...ev, start_time: newStart.toISOString(), end_time: newEnd.toISOString(), updated_at: new Date().toISOString() };
    setEvents((prev) => prev.map((x) => x.id === eventId ? updated : x));
    setStatusMessage("Event moved.");
    setTimeout(() => setStatusMessage(""), 2000);
    try {
      const { updateCalendarEvent } = await import("@/lib/calendar-sync");
      await updateCalendarEvent(eventId, { start_time: updated.start_time, end_time: updated.end_time });
      broadcastCrmUpdate();
    } catch {
      setEvents((prev) => prev.map((x) => x.id === eventId ? ev : x));
      setError("Failed to move event.");
    }
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
    // Team filter — when a specific member is selected, only show their events
    if (enabledTeam.size > 0 && enabledTeam.size < TEAM_MEMBERS.length) {
      if (!event.assigned_to || !enabledTeam.has(event.assigned_to)) return false;
    }
    // Item type filter (CRM jobs vs Google events)
    const isGcal = isGoogleEvent(event);
    const eventItemType = isGcal ? "events" : "jobs";
    if (!itemTypeFilter.has(eventItemType)) return false;
    // Status filter (open = future/today, done = past)
    const eventDate = new Date(event.start_time);
    const now = new Date();
    const isPast = eventDate < now && !event.all_day;
    const eventStatus = isPast ? "done" : "open";
    if (statusFilter.size > 0 && statusFilter.size < 2 && !statusFilter.has(eventStatus)) return false;
    // Job kind / type filter (normalize old values like "Inspection" → "Roof Inspection")
    if (enabledJobKinds.size < JOB_KINDS.length) {
      const kind = event.job_kind ? normalizeJobKind(event.job_kind) : "Other";
      if (!enabledJobKinds.has(kind)) return false;
    }
    // Tag filter
    if (tagFilter.size > 0) {
      const eTags = eventTags[event.id] || [];
      if (!eTags.some((t) => tagFilter.has(t))) return false;
    }
    return true;
  }

  function toggleJobKind(kind: string) {
    setEnabledJobKinds((prev) => {
      const n = new Set(prev);
      if (n.has(kind)) n.delete(kind);
      else n.add(kind);
      return n;
    });
  }

  /* ── CRUD handlers ──────────────────────────────────────────────────── */

  type GoogleSyncPayload = {
    crmEventId: string;
    title: string;
    name: string;
    address: string;
    jobKind: string;
    phone?: string;
    date: string;
    startTime: string;
    endTime: string;
    notes?: string;
    guestEmails?: string;
  };

  /**
   * Push a CRM calendar event to Google Calendar and keep the two linked.
   * If we already have a Google event for this CRM event, update it in place
   * (PUT); otherwise create one (POST). The returned Google id is cached in
   * crmToGoogleRef so subsequent edits/deletes target the same event instead
   * of creating duplicates. Failures surface a non-blocking status message.
   */
  async function syncEventToGoogle(mode: "create" | "update", payload: GoogleSyncPayload) {
    try {
      const existingGoogleId = crmToGoogleRef.current.get(payload.crmEventId);
      const method = existingGoogleId ? "PUT" : "POST";
      const body: Record<string, unknown> = { ...payload };
      if (existingGoogleId) body.id = existingGoogleId;

      const response = await fetch("/api/google-calendar/events", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        setError("Saved to the CRM, but couldn't sync to Google Calendar. Check the Google connection at the top of the page.");
        return;
      }

      const data = (await response.json()) as { event?: GoogleCalendarEvent };
      if (data.event?.id && payload.crmEventId) {
        crmToGoogleRef.current.set(payload.crmEventId, data.event.id);
      }
    } catch {
      setError("Saved to the CRM, but couldn't sync to Google Calendar.");
    }
    // Mode is used only for readability at call sites (create vs update).
    void mode;
  }

  async function handleCreateEvent(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setStatusMessage("");

    try {
      const startTime = `${form.date}T${form.startTime}:00`;
      const endTime = `${form.date}T${form.endTime}:00`;
      const startISO = new Date(startTime + "-07:00").toISOString();
      const endISO = new Date(endTime + "-07:00").toISOString();

      // Duplicate prevention: check if an event with same title + start already exists
      const duplicate = events.find((ev) => ev.title === form.title && ev.start_time === startISO && ev.customer_name === form.customer_name);
      if (duplicate) {
        setError("This event already exists on the calendar.");
        setSaving(false);
        return;
      }

      // Optimistic UI: insert placeholder event immediately so calendar updates instantly
      const optimisticId = `optimistic-${Date.now()}`;
      const optimisticEvent: CalendarEvent = {
        id: optimisticId,
        title: form.title,
        description: form.description,
        start_time: startISO,
        end_time: endISO,
        all_day: false,
        location: form.location,
        color: form.color,
        assigned_to: form.assigned_to,
        customer_name: form.customer_name,
        customer_phone: form.customer_phone,
        job_kind: form.job_kind,
        created_by: form.assigned_to,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setEvents((prev) => [...prev, optimisticEvent]);

      // Close modal and reset form immediately for instant feel
      setNewScheduleOpen(false);
      setCreateSuccess(true);
      setTimeout(() => setCreateSuccess(false), 4000);
      setStatusMessage("Event created successfully.");
      const savedForm = { ...form };
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
        guestEmails: "",
      });

      // Save to database in background
      const result = await createCalendarEvent({
        title: savedForm.title,
        description: savedForm.description,
        start_time: startISO,
        end_time: endISO,
        all_day: false,
        location: savedForm.location,
        color: savedForm.color,
        assigned_to: savedForm.assigned_to,
        customer_name: savedForm.customer_name,
        customer_phone: savedForm.customer_phone,
        job_kind: savedForm.job_kind,
        created_by: savedForm.assigned_to,
      });

      if (!result) {
        // Rollback optimistic update
        setEvents((prev) => prev.filter((ev) => ev.id !== optimisticId));
        setError("Unable to create event.");
        return;
      }

      // Replace optimistic event with real one (real-time subscription will also fire)
      setEvents((prev) => prev.map((ev) => ev.id === optimisticId ? result : ev));

      // Mirror the new CRM event to Google Calendar and remember the link so
      // later edits/deletes update the same Google event (no duplicates). Any
      // guest emails entered send a real Google invite (sendUpdates=all).
      if (googleConnected) {
        void syncEventToGoogle("create", {
          crmEventId: result.id || "",
          title: savedForm.title,
          name: savedForm.customer_name || savedForm.title,
          address: savedForm.location || "N/A",
          jobKind: savedForm.job_kind || "Other",
          phone: savedForm.customer_phone,
          date: savedForm.date,
          startTime: savedForm.startTime,
          endTime: savedForm.endTime,
          notes: savedForm.description,
          guestEmails: savedForm.guestEmails,
        });
      }

      broadcastCrmUpdate();
      void logCrewActivity({
        jobId: result.id || "",
        jobName: savedForm.title,
        actor: TEAM_MEMBERS.find((m) => m.id === savedForm.assigned_to)?.name || savedForm.assigned_to,
        action: "Calendar event created",
        details: `${savedForm.title} — ${savedForm.customer_name || "No customer"} on ${savedForm.date}`,
        module: "Calendar",
      });
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
      const startISO = new Date(startTime + "-07:00").toISOString();
      const endISO = new Date(endTime + "-07:00").toISOString();

      // Optimistic UI: update event in place immediately
      const optimisticUpdated: CalendarEvent = {
        ...selectedEvent,
        title: editForm.title,
        description: editForm.description,
        start_time: startISO,
        end_time: endISO,
        location: editForm.location,
        color: editForm.color,
        assigned_to: editForm.assigned_to,
        customer_name: editForm.customer_name,
        customer_phone: editForm.customer_phone,
        job_kind: editForm.job_kind,
        updated_at: new Date().toISOString(),
      };
      const prevEvents = events;
      setEvents((prev) => prev.map((ev) => ev.id === selectedEvent.id ? optimisticUpdated : ev));
      setSelectedEvent(null);
      setEditMode(false);
      setStatusMessage("Event updated successfully.");

      const result = await updateCalendarEvent(selectedEvent.id, {
        title: editForm.title,
        description: editForm.description,
        start_time: startISO,
        end_time: endISO,
        location: editForm.location,
        color: editForm.color,
        assigned_to: editForm.assigned_to,
        customer_name: editForm.customer_name,
        customer_phone: editForm.customer_phone,
        job_kind: editForm.job_kind,
      });

      if (!result) {
        // Rollback
        setEvents(prevEvents);
        setError("Unable to update event.");
        return;
      }

      // Replace with server response
      setEvents((prev) => prev.map((ev) => ev.id === selectedEvent.id ? result : ev));

      // Keep Google Calendar in sync: update the linked event, or create one
      // if this CRM event was never mirrored (e.g. made while Google was off).
      if (googleConnected) {
        void syncEventToGoogle("update", {
          crmEventId: selectedEvent.id,
          title: editForm.title,
          name: editForm.customer_name || editForm.title,
          address: editForm.location || "N/A",
          jobKind: editForm.job_kind || "Other",
          phone: editForm.customer_phone,
          date: editForm.date,
          startTime: editForm.startTime,
          endTime: editForm.endTime,
          notes: editForm.description,
          guestEmails: editForm.guestEmails,
        });
      }

      broadcastCrmUpdate();
      void logCrewActivity({
        jobId: selectedEvent.id,
        jobName: editForm.title,
        actor: TEAM_MEMBERS.find((m) => m.id === editForm.assigned_to)?.name || editForm.assigned_to,
        action: "Calendar event updated",
        details: `Updated "${editForm.title}" — ${editForm.customer_name || "No customer"}`,
        module: "Calendar",
      });
    } catch {
      setError("Unable to update event.");
    } finally {
      setUpdating(false);
    }
  }

  /** Update a Google Calendar event via the existing Google API route. */
  async function handleUpdateGoogleEvent(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedEvent) return;

    setUpdating(true);
    setError("");
    setStatusMessage("");

    try {
      const startISO = new Date(`${editForm.date}T${editForm.startTime}:00-07:00`).toISOString();
      const endISO = new Date(`${editForm.date}T${editForm.endTime}:00-07:00`).toISOString();
      const googleId = selectedEvent.id.slice(GCAL_PREFIX.length);

      const optimisticUpdated: CalendarEvent = {
        ...selectedEvent,
        title: editForm.title,
        description: editForm.description,
        start_time: startISO,
        end_time: endISO,
        location: editForm.location,
        customer_name: editForm.customer_name,
        customer_phone: editForm.customer_phone,
        job_kind: editForm.job_kind,
        updated_at: new Date().toISOString(),
      };
      const prevEvents = events;
      setEvents((prev) => prev.map((ev) => ev.id === selectedEvent.id ? optimisticUpdated : ev));
      setSelectedEvent(null);
      setEditMode(false);
      setStatusMessage("Event updated successfully.");

      const response = await fetch("/api/google-calendar/events", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: googleId,
          title: editForm.title,
          name: editForm.customer_name || editForm.title,
          address: editForm.location || "N/A",
          jobKind: editForm.job_kind || "Other",
          phone: editForm.customer_phone,
          date: editForm.date,
          startTime: editForm.startTime,
          endTime: editForm.endTime,
          notes: editForm.description,
          guestEmails: editForm.guestEmails,
        }),
      });

      if (!response.ok) {
        setEvents(prevEvents);
        setError("Unable to update Google Calendar event.");
        return;
      }

      const data = (await response.json()) as { event?: GoogleCalendarEvent };
      if (data.event) {
        const mapped = mapGoogleEvent(data.event);
        setEvents((prev) => prev.map((ev) => ev.id === mapped.id ? mapped : ev));
      }
      broadcastCrmUpdate();
    } catch {
      setError("Unable to update Google Calendar event.");
    } finally {
      setUpdating(false);
    }
  }

  /** Route the edit form submit to the correct backend (CRM vs Google). */
  function handleEditSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (selectedEvent && isGoogleEvent(selectedEvent)) {
      void handleUpdateGoogleEvent(e);
    } else {
      void handleUpdateEvent(e);
    }
  }

  async function handleDeleteEvent() {
    if (!selectedEvent) return;
    setDeleting(true);
    setError("");

    try {
      // Optimistic UI: remove event immediately
      const prevEvents = events;
      const deletedEvent = selectedEvent;
      setEvents((prev) => prev.filter((ev) => ev.id !== deletedEvent.id));
      setSelectedEvent(null);
      setEditMode(false);
      setDeleteConfirmOpen(false);
      setStatusMessage("Event deleted.");

      const ok = await deleteCalendarEvent(deletedEvent.id);
      if (!ok) {
        // Rollback
        setEvents(prevEvents);
        setError("Unable to delete event.");
        return;
      }

      // Remove the mirrored Google Calendar event too (with sendUpdates=all so
      // guests get a cancellation), if this CRM event was linked to one.
      const linkedGoogleId = crmToGoogleRef.current.get(deletedEvent.id);
      if (googleConnected && linkedGoogleId) {
        crmToGoogleRef.current.delete(deletedEvent.id);
        void fetch(`/api/google-calendar/events?id=${encodeURIComponent(linkedGoogleId)}`, {
          method: "DELETE",
        }).catch(() => {});
      }

      broadcastCrmUpdate();
      void logCrewActivity({
        jobId: deletedEvent.id,
        jobName: deletedEvent.title || "Untitled",
        actor: deletedEvent.assigned_to || "Unknown",
        action: "Calendar event deleted",
        details: `Deleted "${deletedEvent.title || "Untitled"}" — ${deletedEvent.customer_name || "No customer"}`,
        module: "Calendar",
      });
    } catch {
      setError("Unable to delete event.");
    } finally {
      setDeleting(false);
    }
  }

  // Populate edit form when selecting an event
  useEffect(() => {
    if (!selectedEvent) return;
    setEditMode(false);
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
      guestEmails: "",
    });
  }, [selectedEvent]);

  /** Open the FloatingDialer via CrmShell with the customer phone pre-filled */
  function openDialerForEvent(event: CalendarEvent, callerIdNumber?: string) {
    const phone = event.customer_phone?.replace(/[^\d+]/g, "");
    if (!phone) return;
    window.dispatchEvent(
      new CustomEvent("crm:open-dialer", {
        detail: { phone, callerId: callerIdNumber },
      }),
    );
    setCallPickerEvent(null);
  }

  /* ── Render helpers ─────────────────────────────────────────────────── */

  function renderEventChip(event: CalendarEvent, compact = false) {
    const tc = getTeamColor(event.assigned_to);
    const chipColor = tc ? `${tc.bg} ${tc.text} ${tc.border}` : getColorConfig(event.color).color;
    const time = formatEventTime(event);
    const isGcal = isGoogleEvent(event);
    const hasPhone = Boolean(event.customer_phone?.replace(/[^\d+]/g, ""));
    return (
      <div key={event.id} className="group relative flex w-full items-center">
        <button
          type="button"
          draggable
          onDragStart={(e) => handleDragStart(e, event.id)}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedEvent(event);
          }}
          className={`block w-full cursor-grab truncate rounded border px-1 py-0.5 text-left text-[10px] font-semibold leading-snug transition hover:opacity-80 active:cursor-grabbing sm:px-1.5 sm:py-[3px] sm:text-xs ${hasPhone ? "pr-5 sm:pr-6" : ""} ${chipColor}`}
          title={`${isGcal ? "[Google] " : ""}${event.title || "Untitled"}${time ? ` ${time}` : ""}`}
        >
          {compact ? (
            <>
              {isGcal && <span className="mr-0.5 text-[8px]">G</span>}
              {event.title || "Untitled"}
            </>
          ) : (
            <span className="truncate">
              {isGcal && <span className="mr-0.5 text-[8px] sm:text-[9px]">G</span>}
              {event.title || "Untitled"}
              {time && (
                <span className="ml-1 hidden opacity-70 sm:inline">{time}</span>
              )}
            </span>
          )}
        </button>
        {hasPhone && (
          <button
            type="button"
            title="Call customer"
            onClick={(e) => {
              e.stopPropagation();
              if (twilioLines.length <= 1) {
                openDialerForEvent(event, twilioLines[0]?.number);
              } else {
                setCallPickerEvent(event);
              }
            }}
            className="absolute right-0.5 top-1/2 z-10 hidden -translate-y-1/2 rounded p-0.5 text-green-700 hover:bg-green-100 group-hover:inline-flex sm:right-1"
          >
            <PhoneOutgoing className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  /* ── Timeline View (daily schedule list with week strip) ──────────── */

  function renderTimelineView() {
    const ws = getWeekStart(currentDate);
    const weekStripDays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(ws);
      d.setDate(d.getDate() + i);
      return d;
    });
    const WDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const selectedKey = dateKeyFromDate(currentDate);
    const dayEvents = (eventsByDate[selectedKey] || [])
      .filter(isEventVisible)
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

    const dayLabel = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: ARIZONA_TIMEZONE,
    }).format(currentDate);

    function getAssignedName(id: string) {
      const m = TEAM_MEMBERS.find((t) => t.id === id);
      return m ? m.name.split(" ")[0] : "";
    }

    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
        {/* Week strip */}
        <div className="flex items-center justify-around border-b border-gray-200 bg-white px-1 py-2 sm:px-4">
          {weekStripDays.map((d) => {
            const p = azParts(d);
            const k = dateKeyFromDate(d);
            const isSel = k === selectedKey;
            const isTd = k === todayKey;
            const hasEvts = Boolean(eventsByDate[k]?.length);
            return (
              <button key={k} type="button" onClick={() => setCurrentDate(d)} className="flex flex-col items-center gap-0.5">
                <span className={`text-[10px] font-semibold sm:text-xs ${isSel ? "text-green-600" : "text-gray-400"}`}>{WDAY_SHORT[p.dow]}</span>
                <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold sm:h-8 sm:w-8 sm:text-sm ${isSel || isTd ? "bg-green-500 text-white" : "text-gray-700 hover:bg-gray-100"}`}>{p.day}</span>
                {hasEvts && <span className={`h-1 w-1 rounded-full ${isSel ? "bg-green-400" : "bg-gray-300"}`} />}
              </button>
            );
          })}
        </div>

        {/* Day label */}
        <div className="border-b border-gray-100 bg-gray-50 px-3 py-2 sm:px-4">
          <h3 className="text-xs font-bold text-gray-700 sm:text-sm">{dayLabel}</h3>
          <p className="text-[10px] text-gray-400 sm:text-xs">{dayEvents.length} event{dayEvents.length !== 1 ? "s" : ""} scheduled</p>
        </div>

        {/* Schedule list */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {dayEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <CalendarIcon className="mb-2 h-10 w-10 opacity-40" />
              <p className="text-sm font-medium">No events scheduled</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {dayEvents.map((ev) => {
                const tc = getTeamColor(ev.assigned_to);
                const dotColor = tc?.dot || "bg-gray-400";
                const cardBg = tc ? `${tc.bg}` : "bg-white";
                const cardBorder = tc ? tc.border : "border-gray-200";
                const cardText = tc ? tc.text : "text-gray-700";
                const assignedName = getAssignedName(ev.assigned_to);
                return (
                  <button
                    key={ev.id}
                    type="button"
                    draggable
                    onDragStart={(e) => handleDragStart(e, ev.id)}
                    onClick={() => setSelectedEvent(ev)}
                    className={`flex w-full cursor-grab items-start gap-3 px-3 py-3 text-left transition hover:bg-gray-50 active:cursor-grabbing sm:px-4 sm:py-4`}
                  >
                    {/* Time column */}
                    <div className="w-16 shrink-0 pt-0.5 sm:w-20">
                      <div className="text-xs font-bold text-gray-900 sm:text-sm">{formatEventTime(ev)}</div>
                      <div className="text-[10px] text-gray-400 sm:text-xs">{new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: ARIZONA_TIMEZONE }).format(new Date(ev.end_time))}</div>
                    </div>
                    {/* Color bar */}
                    <div className={`mt-1 h-10 w-1 shrink-0 rounded-full ${dotColor} sm:h-12`} />
                    {/* Event details */}
                    <div className={`min-w-0 flex-1 rounded-lg border px-3 py-2 ${cardBg} ${cardBorder}`}>
                      <div className={`truncate text-xs font-bold sm:text-sm ${cardText}`}>{ev.title || "Untitled"}</div>
                      {ev.customer_name && <div className="mt-0.5 truncate text-[10px] text-gray-600 sm:text-xs">{ev.customer_name}</div>}
                      {ev.location && <div className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-gray-400 sm:text-xs"><MapPin className="h-3 w-3 shrink-0" />{ev.location}</div>}
                      <div className="mt-1 flex items-center gap-2">
                        {assignedName && (
                          <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold sm:text-xs ${cardBg} ${cardText}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
                            {assignedName}
                          </span>
                        )}
                        {ev.job_kind && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 sm:text-xs">{normalizeJobKind(ev.job_kind)}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── Month View ─────────────────────────────────────────────────────── */

  function renderMonthView() {
    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
        {/* Weekday Headers */}
        <div className="grid shrink-0 grid-cols-7 border-b border-gray-200 bg-gray-50">
          {WEEKDAYS_FULL.map((day, i) => (
            <div
              key={day}
              className="border-r border-gray-100 px-0.5 py-2 text-center text-xs font-bold uppercase tracking-wider text-gray-600 last:border-r-0 sm:px-2 sm:py-3 sm:text-sm"
            >
              <span className="sm:hidden">{WEEKDAYS[i]}</span>
              <span className="hidden sm:inline">{day}</span>
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
                className={`min-h-[80px] cursor-pointer border-b border-r border-gray-100 p-0.5 transition-colors hover:bg-blue-50/40 sm:min-h-[120px] sm:p-1.5 ${dragOverDate === key ? "bg-blue-100 ring-2 ring-inset ring-blue-400" : isDaySelected ? "bg-blue-50/60" : !cell.isCurrentMonth ? "bg-gray-50/50" : "bg-white"}`}
                onClick={() => {
                  setCurrentDate(cell.date);
                  setSelectedDay(key);
                  setViewMode("day");
                }}
                onDragOver={(e) => handleDragOver(e, key)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, key)}
              >
                <div className="mb-0.5 text-right sm:mb-1">
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold sm:h-7 sm:w-7 sm:text-sm ${isToday ? "bg-blue-600 text-white" : cell.isCurrentMonth ? "text-gray-900" : "text-gray-400"}`}
                  >
                    {azParts(cell.date).day}
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

  function renderWeekDayTimeGrid(days: Date[], colTemplate: string, cellHeight: number) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`grid ${colTemplate}`}>
          {HOURS.map((hour) => (
            <div key={hour} className="contents">
              <div className="border-b border-r border-gray-100 px-1 py-2 text-right text-[10px] font-medium text-gray-400 sm:text-xs">
                {formatHour(hour)}
              </div>
              {days.map((day, dayIdx) => {
                const key = dateKeyFromDate(day);
                const hourEvents = (eventsByDate[key] || [])
                  .filter(isEventVisible)
                  .filter((ev) => eventHour(ev) === hour);
                return (
                  <div
                    key={dayIdx}
                    className={`relative border-b border-r border-gray-100 p-0.5 last:border-r-0 ${dragOverDate === key ? "bg-blue-50" : ""}`}
                    style={{ minHeight: `${cellHeight}px` }}
                    onDragOver={(e) => handleDragOver(e, key)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, key)}
                  >
                    {hourEvents.map((ev) => {
                      const span = Math.max(
                        1,
                        eventEndHour(ev) - eventHour(ev),
                      );
                      const wtc = getTeamColor(ev.assigned_to);
                      const wColor = wtc ? `${wtc.bg} ${wtc.text} ${wtc.border}` : getColorConfig(ev.color).color;
                      const evHasPhone = Boolean(ev.customer_phone?.replace(/[^\d+]/g, ""));
                      return (
                        <div key={ev.id} className="group/ev absolute inset-x-0.5 z-10" style={{ top: 0, height: `${span * cellHeight}px` }}>
                          <button
                            type="button"
                            draggable
                            onDragStart={(e) => handleDragStart(e, ev.id)}
                            onClick={() => setSelectedEvent(ev)}
                            className={`h-full w-full cursor-grab overflow-hidden rounded border px-1.5 py-1 text-left text-xs font-semibold transition hover:opacity-80 active:cursor-grabbing sm:px-1 sm:py-0.5 sm:text-[10px] ${wColor}`}
                            title={`${ev.title} ${formatEventTimeRange(ev)}`}
                          >
                            <div className="truncate">{ev.title}</div>
                            <div className="truncate opacity-70">
                              {formatEventTimeRange(ev)}
                            </div>
                            {ev.customer_name && (
                              <div className="truncate text-[10px] opacity-60 sm:hidden">
                                {ev.customer_name}
                              </div>
                            )}
                          </button>
                          {evHasPhone && (
                            <button
                              type="button"
                              title="Call customer"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (twilioLines.length <= 1) {
                                  openDialerForEvent(ev, twilioLines[0]?.number);
                                } else {
                                  setCallPickerEvent(ev);
                                }
                              }}
                              className="absolute right-0.5 top-0.5 z-20 hidden rounded bg-white/80 p-0.5 text-green-700 shadow-sm hover:bg-green-100 group-hover/ev:inline-flex"
                            >
                              <PhoneOutgoing className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderWeekView() {
    const mobileDay = weekDays[mobileWeekDayIdx] || weekDays[0];

    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
        {/* ── Desktop day headers (hidden on mobile) ── */}
        <div className="hidden shrink-0 grid-cols-[60px_repeat(7,1fr)] border-b border-gray-200 bg-gray-50 sm:grid">
          <div className="border-r border-gray-100" />
          {weekDays.map((day, i) => {
            const key = dateKeyFromDate(day);
            const isToday = key === todayKey;
            return (
              <div
                key={i}
                className={`cursor-pointer border-r border-gray-100 px-1 py-3 text-center last:border-r-0 hover:bg-blue-50 ${isToday ? "bg-blue-50" : ""}`}
                onClick={() => {
                  setCurrentDate(day);
                  setViewMode("day");
                }}
              >
                <div className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  {WEEKDAYS_FULL[azParts(day).dow]}
                </div>
                <div
                  className={`mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full text-base font-bold ${isToday ? "bg-blue-600 text-white" : "text-gray-900"}`}
                >
                  {azParts(day).day}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Mobile day selector strip (visible only on mobile) ── */}
        <div className="flex shrink-0 items-center border-b border-gray-200 bg-gray-50 sm:hidden">
          <button
            type="button"
            onClick={() => setMobileWeekDayIdx((i) => Math.max(0, i - 1))}
            className="shrink-0 p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
            disabled={mobileWeekDayIdx === 0}
            aria-label="Previous day"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex flex-1 justify-around">
            {weekDays.map((day, i) => {
              const key = dateKeyFromDate(day);
              const isToday = key === todayKey;
              const isSelected = i === mobileWeekDayIdx;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setMobileWeekDayIdx(i)}
                  className={`flex flex-col items-center rounded-lg px-1.5 py-1.5 transition ${isSelected ? "bg-blue-600 text-white" : isToday ? "text-blue-600" : "text-gray-600"}`}
                >
                  <span className="text-[9px] font-bold uppercase tracking-wider">
                    {WEEKDAYS[azParts(day).dow]}
                  </span>
                  <span
                    className={`mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${isSelected ? "bg-white/20" : isToday && !isSelected ? "bg-blue-100" : ""}`}
                  >
                    {azParts(day).day}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setMobileWeekDayIdx((i) => Math.min(6, i + 1))}
            className="shrink-0 p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
            disabled={mobileWeekDayIdx === 6}
            aria-label="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* ── Desktop time grid (7 columns, hidden on mobile) ── */}
        <div className="hidden sm:flex sm:min-h-0 sm:flex-1 sm:flex-col">
          {renderWeekDayTimeGrid(weekDays, "grid-cols-[60px_repeat(7,1fr)]", 48)}
        </div>

        {/* ── Mobile time grid (single day, visible only on mobile) ── */}
        <div className="flex min-h-0 flex-1 flex-col sm:hidden">
          {renderWeekDayTimeGrid([mobileDay], "grid-cols-[50px_1fr]", 56)}
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
      timeZone: ARIZONA_TIMEZONE,
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
                      const dtc = getTeamColor(ev.assigned_to);
                      const dColor = dtc ? `${dtc.bg} ${dtc.text} ${dtc.border}` : getColorConfig(ev.color).color;
                      const evHasPhone = Boolean(ev.customer_phone?.replace(/[^\d+]/g, ""));
                      return (
                        <div key={ev.id} className="group/ev absolute inset-x-1 z-10" style={{ top: 0, height: `${span * 56}px` }}>
                          <button
                            type="button"
                            onClick={() => setSelectedEvent(ev)}
                            className={`h-full w-full overflow-hidden rounded-lg border px-3 py-2 text-left transition hover:opacity-80 ${dColor}`}
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
                          {evHasPhone && (
                            <button
                              type="button"
                              title="Call customer"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (twilioLines.length <= 1) {
                                  openDialerForEvent(ev, twilioLines[0]?.number);
                                } else {
                                  setCallPickerEvent(ev);
                                }
                              }}
                              className="absolute right-1 top-1 z-20 hidden rounded bg-white/80 p-1 text-green-700 shadow-sm hover:bg-green-100 group-hover/ev:inline-flex"
                            >
                              <PhoneOutgoing className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
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
    <div className="flex min-h-0 max-w-full flex-1 flex-col overflow-x-clip">
      {/* Success Toast */}
      {createSuccess && (
        <div className="fixed left-1/2 top-20 z-[70] -translate-x-1/2 animate-bounce">
          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-5 py-3 shadow-lg">
            <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <p className="text-sm font-bold text-green-700">Event created successfully</p>
          </div>
        </div>
      )}

      {/* Status Messages */}
      {(error || statusMessage) && !createSuccess && (
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

      {/* Filter Bar + Toolbar */}
      <div className="sticky top-16 z-20 -mx-3 sm:-mx-5">
        {/* Dark filter bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-700 bg-gray-800 px-3 py-2 sm:px-5">
          {/* Status Filter */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setFilterPopup(filterPopup === "status" ? null : "status"); }}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${filterPopup === "status" ? "bg-white text-gray-900" : "bg-gray-700 text-white hover:bg-gray-600"}`}
          >
            Status <ChevronDown className="h-3 w-3" />
          </button>

          {/* Tags Filter */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setFilterPopup(filterPopup === "tags" ? null : "tags"); }}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${filterPopup === "tags" ? "bg-white text-gray-900" : "bg-gray-700 text-white hover:bg-gray-600"}`}
          >
            Tags {tagFilter.size > 0 && <span className="rounded-full bg-blue-500 px-1.5 text-[10px] text-white">{tagFilter.size}</span>} <ChevronDown className="h-3 w-3" />
          </button>

          {/* Team Filter (dropdown) */}
          <div className="relative">
            <select
              value={enabledTeam.size === TEAM_MEMBERS.length ? "all" : Array.from(enabledTeam)[0] || "all"}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "all") {
                  setEnabledTeam(new Set(TEAM_MEMBERS.map((m) => m.id)));
                } else {
                  setEnabledTeam(new Set([v]));
                }
              }}
              className="shrink-0 appearance-none rounded-full bg-gray-700 px-3 py-1.5 pr-7 text-xs font-semibold text-white outline-none hover:bg-gray-600"
            >
              <option value="all">All Teams</option>
              {TEAM_MEMBERS.map((member) => (
                <option key={member.id} value={member.id}>{member.name.split(" ")[0]}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-white" />
          </div>

          {/* Type Filter */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setFilterPopup(filterPopup === "type" ? null : "type"); }}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${filterPopup === "type" ? "bg-white text-gray-900" : "bg-gray-700 text-white hover:bg-gray-600"}`}
          >
            Type {enabledJobKinds.size < JOB_KINDS.length && <span className="rounded-full bg-blue-500 px-1.5 text-[10px] text-white">{enabledJobKinds.size}</span>} <ChevronDown className="h-3 w-3" />
          </button>
        </div>

        {/* Toolbar with view tabs */}
        <div className="flex flex-wrap items-center justify-between gap-x-1.5 gap-y-2 border-b border-gray-200 bg-white/95 px-3 py-1.5 backdrop-blur-sm sm:gap-2 sm:px-5 sm:py-2.5">
          <div className="flex items-center gap-1.5 sm:gap-3">
            <button type="button" onClick={goToToday} className="rounded-md border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 sm:rounded-lg sm:px-4 sm:py-2 sm:text-sm">Today</button>
            <button type="button" onClick={() => navigate(-1)} className="rounded-full p-1 text-gray-500 hover:bg-gray-100 sm:p-1.5" aria-label="Previous"><ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" /></button>
            <button type="button" onClick={() => navigate(1)} className="rounded-full p-1 text-gray-500 hover:bg-gray-100 sm:p-1.5" aria-label="Next"><ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" /></button>
            <h1 className="hidden text-base font-bold text-gray-900 sm:block sm:text-xl">{headerLabel}</h1>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button type="button" onClick={loadEvents} className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100 sm:p-2" aria-label="Refresh">
              <RefreshCw className={`h-4 w-4 sm:h-5 sm:w-5 ${loading ? "animate-spin" : ""}`} />
            </button>

            {/* View Tabs (inline) */}
            <div className="flex items-center rounded-lg bg-gray-100 p-0.5">
              {(["timeline", "day", "week", "month"] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => { setViewMode(mode); setViewDropdownOpen(false); }}
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold transition sm:px-3 sm:py-1.5 sm:text-xs ${viewMode === mode ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                >
                  {VIEW_LABELS[mode]}
                </button>
              ))}
            </div>

            <button type="button" onClick={() => setNewScheduleOpen(true)} className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 sm:px-4 sm:py-2 sm:text-sm">
              <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> <span className="hidden sm:inline">Event</span>
            </button>
          </div>
        </div>
        {/* Mobile header label (below toolbar on small screens) */}
        <div className="border-b border-gray-200 bg-white px-3 py-1.5 sm:hidden">
          <h1 className="text-sm font-bold text-gray-900">{headerLabel}</h1>
        </div>
      </div>

      {/* Main Layout */}
      <div className="mt-1 flex min-h-0 flex-1 gap-2 sm:mt-2 sm:gap-4">
        {/* Calendar View — swipe left/right to navigate on mobile */}
        <div className="flex min-w-0 flex-1 flex-col" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
          {viewMode === "timeline" && renderTimelineView()}
          {viewMode === "month" && renderMonthView()}
          {viewMode === "week" && renderWeekView()}
          {viewMode === "day" && renderDayView()}
        </div>

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
                    setCurrentDate((prev) => {
                      const p = azParts(prev);
                      return azNoon(p.year, p.month - 1, 1);
                    })
                  }
                  className="rounded p-0.5 text-gray-400 hover:text-gray-600"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setCurrentDate((prev) => {
                      const p = azParts(prev);
                      return azNoon(p.year, p.month + 1, 1);
                    })
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

          {/* Google Calendar Status */}
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <h3 className="mb-2 text-sm font-bold text-gray-900">Google Calendar</h3>
            {googleConnected ? (
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
                <span className="text-xs font-medium text-green-700">Connected</span>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-gray-400" />
                  <span className="text-xs font-medium text-gray-500">Not connected</span>
                </div>
                <a
                  href="/api/google-calendar/connect"
                  className="mt-2 inline-block rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700"
                >
                  Connect Google Calendar
                </a>
              </div>
            )}
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
              <div className="flex items-center gap-2 px-1 py-1">
                <span className="h-3 w-3 rounded-sm bg-cyan-500" />
                <span className="text-xs font-medium text-gray-700">Google Calendar</span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* ── New Event Modal ─────────────────────────────────────────── */}
      {newScheduleOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-gray-950/30 pb-[72px] sm:items-center sm:pb-4 sm:px-4"
          onClick={() => setNewScheduleOpen(false)}
        >
          <form
            id="new-event"
            onSubmit={handleCreateEvent}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[calc(100dvh-140px)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-gray-200 bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-lg"
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
              {error && (
                <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                  <p className="text-sm font-medium text-red-600">{error}</p>
                </div>
              )}
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
                  {JOB_KINDS.map((kind) => (
                    <option key={kind} value={kind}>{kind}</option>
                  ))}
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
                <div className="sm:col-span-2">
                  <div className="mb-1 flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-gray-500">Notes</span><AiWriteButton getText={() => form.description} onReplace={(t) => setForm({ ...form, description: t })} context="calendar event notes for a roofing job" /></div>
                  <textarea
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                    className="min-h-[80px] w-full rounded-lg border border-gray-200 px-4 py-3 outline-none"
                    placeholder="Notes"
                  />
                </div>
                <input
                  type="text"
                  value={form.guestEmails}
                  onChange={(e) =>
                    setForm({ ...form, guestEmails: e.target.value })
                  }
                  className="rounded-lg border border-gray-200 px-4 py-3 outline-none sm:col-span-2"
                  placeholder="Invite guests (comma-separated emails)"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-3">
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
      {selectedEvent && isGoogleEvent(selectedEvent) && !editMode && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-gray-950/40 p-4"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="mx-auto my-6 max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2 border-b border-gray-200 pb-4">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className="inline-flex shrink-0 items-center rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-bold text-cyan-700">
                  Google Calendar
                </span>
                <h2 className="truncate text-xl font-bold text-cyan-700 sm:text-2xl">
                  {selectedEvent.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="rounded-full p-2 text-gray-500 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-gray-400" />
                <span className="text-sm text-gray-700">
                  {selectedEvent.all_day
                    ? new Intl.DateTimeFormat("en-US", {
                        dateStyle: "full",
                        timeZone: ARIZONA_TIMEZONE,
                      }).format(new Date(selectedEvent.start_time))
                    : `${new Intl.DateTimeFormat("en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: ARIZONA_TIMEZONE,
                      }).format(new Date(selectedEvent.start_time))} — ${new Intl.DateTimeFormat("en-US", {
                        timeStyle: "short",
                        timeZone: ARIZONA_TIMEZONE,
                      }).format(new Date(selectedEvent.end_time))}`}
                </span>
              </div>
              {selectedEvent.location && (
                <div className="flex items-center gap-3">
                  <MapPin className="h-5 w-5 text-gray-400" />
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedEvent.location)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline"
                  >
                    {selectedEvent.location}
                  </a>
                </div>
              )}
              {selectedEvent.customer_name && (
                <div className="flex items-center gap-3">
                  <User className="h-5 w-5 text-gray-400" />
                  <span className="text-sm text-gray-700">{selectedEvent.customer_name}</span>
                </div>
              )}
              {selectedEvent.customer_phone && (
                <div className="flex items-center gap-3">
                  <Phone className="h-5 w-5 text-gray-400" />
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700">{selectedEvent.customer_phone}</span>
                    {hasPhone(selectedEvent.customer_phone) && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            if (twilioLines.length <= 1) {
                              openDialerForEvent(selectedEvent, twilioLines[0]?.number);
                            } else {
                              setCallPickerEvent(selectedEvent);
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-600"
                        >
                          <PhoneOutgoing className="h-3 w-3" />
                          Call
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setSmsTarget({
                              phone: selectedEvent.customer_phone,
                              name: selectedEvent.customer_name,
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-lg bg-green-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-600"
                        >
                          <MessageSquare className="h-3 w-3" />
                          SMS
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
              {selectedEvent.job_kind && (
                <div className="flex items-center gap-3">
                  <Briefcase className="h-5 w-5 text-gray-400" />
                  <span className="text-sm text-gray-700">{selectedEvent.job_kind}</span>
                </div>
              )}
              {selectedEvent.description && (
                <div className="flex items-start gap-3">
                  <AlignLeft className="mt-0.5 h-5 w-5 text-gray-400" />
                  <p className="whitespace-pre-wrap text-sm text-gray-700">
                    {selectedEvent.description}
                  </p>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="rounded-lg border border-gray-200 px-4 py-2.5 font-bold text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => setEditMode(true)}
                className="rounded-lg bg-blue-600 px-4 py-2.5 font-bold text-white hover:bg-blue-700"
              >
                Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedEvent && !isGoogleEvent(selectedEvent) && !editMode && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-gray-950/40 p-4"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="mx-auto my-6 max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2 border-b border-gray-200 pb-4">
              <h2 className="min-w-0 truncate text-xl font-bold text-blue-700 sm:text-2xl">
                {selectedEvent.title || "Untitled"}
              </h2>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="shrink-0 rounded-full p-2 text-gray-500 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 shrink-0 text-gray-400" />
                <span className="text-sm text-gray-700">
                  {selectedEvent.all_day
                    ? new Intl.DateTimeFormat("en-US", {
                        dateStyle: "full",
                        timeZone: ARIZONA_TIMEZONE,
                      }).format(new Date(selectedEvent.start_time))
                    : `${new Intl.DateTimeFormat("en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: ARIZONA_TIMEZONE,
                      }).format(new Date(selectedEvent.start_time))} — ${new Intl.DateTimeFormat("en-US", {
                        timeStyle: "short",
                        timeZone: ARIZONA_TIMEZONE,
                      }).format(new Date(selectedEvent.end_time))}`}
                </span>
              </div>
              {selectedEvent.customer_name && (
                <div className="flex items-center gap-3">
                  <User className="h-5 w-5 text-gray-400" />
                  <span className="text-sm font-medium text-gray-700">{selectedEvent.customer_name}</span>
                </div>
              )}
              {selectedEvent.customer_phone && (
                <div className="flex items-center gap-3">
                  <Phone className="h-5 w-5 text-gray-400" />
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700">{selectedEvent.customer_phone}</span>
                    {hasPhone(selectedEvent.customer_phone) && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            if (twilioLines.length <= 1) {
                              openDialerForEvent(selectedEvent, twilioLines[0]?.number);
                            } else {
                              setCallPickerEvent(selectedEvent);
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-600"
                        >
                          <PhoneOutgoing className="h-3 w-3" />
                          Call
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setSmsTarget({
                              phone: selectedEvent.customer_phone,
                              name: selectedEvent.customer_name,
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-lg bg-green-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-600"
                        >
                          <MessageSquare className="h-3 w-3" />
                          SMS
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
              {selectedEvent.location && (
                <div className="flex items-center gap-3">
                  <MapPin className="h-5 w-5 text-gray-400" />
                  <div className="flex items-center gap-2">
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedEvent.location)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline"
                    >
                      {selectedEvent.location}
                    </a>
                  </div>
                </div>
              )}
              {selectedEvent.job_kind && (
                <div className="flex items-center gap-3">
                  <Briefcase className="h-5 w-5 text-gray-400" />
                  <span className="text-sm text-gray-700">{selectedEvent.job_kind}</span>
                </div>
              )}
              {selectedEvent.assigned_to && (
                <div className="flex items-center gap-3">
                  <User className="h-5 w-5 text-gray-400" />
                  <span className="text-sm text-gray-500">
                    Assigned to: {TEAM_MEMBERS.find((m) => m.id === selectedEvent.assigned_to)?.name || selectedEvent.assigned_to}
                  </span>
                </div>
              )}
              {selectedEvent.description && (
                <div className="flex items-start gap-3">
                  <AlignLeft className="mt-0.5 h-5 w-5 text-gray-400" />
                  <p className="whitespace-pre-wrap text-sm text-gray-700">
                    {selectedEvent.description}
                  </p>
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-wrap justify-between gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-50 sm:gap-2 sm:px-4 sm:py-2.5"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedEvent(null)}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 sm:px-4 sm:py-2.5"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => setEditMode(true)}
                  className="rounded-lg bg-blue-600 px-4 py-2.5 font-bold text-white hover:bg-blue-700"
                >
                  Edit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedEvent && editMode && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-gray-950/40 p-4"
          onClick={() => { setSelectedEvent(null); setEditMode(false); }}
        >
          <form
            onSubmit={handleEditSubmit}
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
                  onClick={() => { setSelectedEvent(null); setEditMode(false); }}
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
                      {hasPhone(editForm.customer_phone) && (
                        <button
                          type="button"
                          onClick={() => {
                            const phone = editForm.customer_phone.replace(/[^\d+]/g, "");
                            if (!phone) return;
                            window.dispatchEvent(new CustomEvent("crm:open-dialer", { detail: { phone, callerId: twilioLines[0]?.number } }));
                          }}
                          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-blue-500 px-4 py-3 font-bold text-white hover:bg-blue-600"
                        >
                          <PhoneOutgoing className="h-4 w-4" />
                          Call
                        </button>
                      )}
                      {hasPhone(editForm.customer_phone) && (
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
                      {JOB_KINDS.map((kind) => (
                        <option key={kind} value={kind}>{kind}</option>
                      ))}
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
                    <div>
                      <div className="mb-1 flex justify-end"><AiWriteButton getText={() => editForm.description} onReplace={(t) => setEditForm({ ...editForm, description: t })} context="calendar event notes for a roofing job" /></div>
                      <textarea
                        value={editForm.description}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            description: e.target.value,
                          })
                        }
                        className="min-h-32 w-full rounded-lg bg-gray-100 px-4 py-3 outline-none"
                        placeholder="Add description / notes"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">
                        Guest email(s) — send Google invite
                      </label>
                      <input
                        type="text"
                        value={editForm.guestEmails}
                        onChange={(e) =>
                          setEditForm({ ...editForm, guestEmails: e.target.value })
                        }
                        className="w-full rounded-lg bg-gray-100 px-4 py-3 outline-none"
                        placeholder="name@example.com, name2@example.com"
                      />
                      <p className="mt-1 text-xs text-gray-400">
                        Separate multiple emails with commas. Guests get a Google Calendar invite when you save.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                {isGoogleEvent(selectedEvent) ? (
                  <span />
                ) : (
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmOpen(true)}
                    className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-3 font-bold text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                )}
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

      {/* ── Filter popup overlays (at root level, above sticky container) ── */}

      {/* Status popup */}
      {filterPopup === "status" && (
        <div className="fixed inset-0 z-[95]" onClick={() => setFilterPopup(null)}>
          <div className="absolute inset-0 bg-black/30 sm:bg-black/10" />
          {/* Desktop */}
          <div className="absolute left-3 top-28 z-50 hidden w-64 rounded-xl border border-gray-200 bg-white p-4 shadow-2xl sm:block" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-bold text-gray-900">Status</h4>
              <button type="button" onClick={() => { setStatusFilter(new Set(["open", "done"])); setItemTypeFilter(new Set(["jobs", "events"])); }} className="text-xs font-medium text-blue-600 hover:text-blue-700">Select all</button>
            </div>
            <div className="mb-3 flex gap-1 rounded-lg bg-gray-100 p-1">
              {(["jobs", "events"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setItemTypeFilter((prev) => { const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n; })}
                  className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition ${itemTypeFilter.has(t) ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                >
                  {t === "jobs" ? "Jobs" : "Events"}
                </button>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-2.5 py-2">
              <input type="checkbox" checked={statusFilter.has("open")} onChange={() => setStatusFilter((prev) => { const n = new Set(prev); if (n.has("open")) n.delete("open"); else n.add("open"); return n; })} className="h-4 w-4 rounded border-gray-300" />
              <span className="text-sm font-medium text-gray-700">Open</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2.5 py-2">
              <input type="checkbox" checked={statusFilter.has("done")} onChange={() => setStatusFilter((prev) => { const n = new Set(prev); if (n.has("done")) n.delete("done"); else n.add("done"); return n; })} className="h-4 w-4 rounded border-gray-300" />
              <span className="text-sm font-medium text-gray-700">Done</span>
            </label>
            <button type="button" onClick={() => setFilterPopup(null)} className="mt-3 w-full rounded-lg bg-yellow-400 py-2 text-sm font-bold text-gray-900 hover:bg-yellow-500">Submit</button>
          </div>
          {/* Mobile */}
          <div className="absolute inset-x-0 bottom-[72px] rounded-t-2xl bg-white p-5 pb-6 shadow-2xl sm:hidden" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-gray-300" />
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-base font-bold text-gray-900">Status</h4>
              <button type="button" onClick={() => { setStatusFilter(new Set(["open", "done"])); setItemTypeFilter(new Set(["jobs", "events"])); }} className="text-xs font-medium text-blue-600 hover:text-blue-700">Select all</button>
            </div>
            <div className="mb-3 flex gap-1 rounded-lg bg-gray-100 p-1">
              {(["jobs", "events"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setItemTypeFilter((prev) => { const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n; })}
                  className={`flex-1 rounded-md px-2 py-1.5 text-sm font-semibold transition ${itemTypeFilter.has(t) ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                >
                  {t === "jobs" ? "Jobs" : "Events"}
                </button>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-2.5 py-3">
              <input type="checkbox" checked={statusFilter.has("open")} onChange={() => setStatusFilter((prev) => { const n = new Set(prev); if (n.has("open")) n.delete("open"); else n.add("open"); return n; })} className="h-5 w-5 rounded border-gray-300" />
              <span className="text-sm font-medium text-gray-700">Open</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2.5 py-3">
              <input type="checkbox" checked={statusFilter.has("done")} onChange={() => setStatusFilter((prev) => { const n = new Set(prev); if (n.has("done")) n.delete("done"); else n.add("done"); return n; })} className="h-5 w-5 rounded border-gray-300" />
              <span className="text-sm font-medium text-gray-700">Done</span>
            </label>
            <button type="button" onClick={() => setFilterPopup(null)} className="mt-4 w-full rounded-lg bg-yellow-400 py-3 text-sm font-bold text-gray-900 hover:bg-yellow-500">Apply</button>
          </div>
        </div>
      )}

      {/* Tags popup */}
      {filterPopup === "tags" && (
        <div className="fixed inset-0 z-[95]" onClick={() => setFilterPopup(null)}>
          <div className="absolute inset-0 bg-black/30 sm:bg-black/10" />
          {/* Desktop */}
          <div className="absolute left-20 top-28 z-50 hidden w-64 rounded-xl border border-gray-200 bg-white p-4 shadow-2xl sm:block" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-bold text-gray-900">Tags</h4>
              <button type="button" onClick={() => setTagFilter(new Set())} className="text-xs font-medium text-blue-600 hover:text-blue-700">Clear all</button>
            </div>
            <div className="max-h-48 overflow-y-auto">
              {allTags.map((tag) => (
                <label key={tag} className="flex cursor-pointer items-center gap-2.5 py-1.5">
                  <input type="checkbox" checked={tagFilter.has(tag)} onChange={() => setTagFilter((prev) => { const n = new Set(prev); if (n.has(tag)) n.delete(tag); else n.add(tag); return n; })} className="h-4 w-4 rounded border-gray-300" />
                  <span className="text-sm font-medium text-gray-700">{tag}</span>
                </label>
              ))}
            </div>
            <div className="mt-3 flex gap-2 border-t border-gray-100 pt-3">
              <input type="text" value={newTagInput} onChange={(e) => setNewTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newTagInput.trim()) { setEventTags((prev) => ({ ...prev })); setNewTagInput(""); } }} placeholder="New tag..." className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs outline-none focus:border-blue-300" />
              <button type="button" onClick={() => { if (newTagInput.trim()) { setNewTagInput(""); } }} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700">Add</button>
            </div>
            <button type="button" onClick={() => setFilterPopup(null)} className="mt-3 w-full rounded-lg bg-yellow-400 py-2 text-sm font-bold text-gray-900 hover:bg-yellow-500">Submit</button>
          </div>
          {/* Mobile */}
          <div className="absolute inset-x-0 bottom-[72px] rounded-t-2xl bg-white p-5 pb-6 shadow-2xl sm:hidden" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-gray-300" />
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-base font-bold text-gray-900">Tags</h4>
              <button type="button" onClick={() => setTagFilter(new Set())} className="text-xs font-medium text-blue-600 hover:text-blue-700">Clear all</button>
            </div>
            <div className="max-h-48 overflow-y-auto">
              {allTags.map((tag) => (
                <label key={tag} className="flex cursor-pointer items-center gap-2.5 py-3">
                  <input type="checkbox" checked={tagFilter.has(tag)} onChange={() => setTagFilter((prev) => { const n = new Set(prev); if (n.has(tag)) n.delete(tag); else n.add(tag); return n; })} className="h-5 w-5 rounded border-gray-300" />
                  <span className="text-sm font-medium text-gray-700">{tag}</span>
                </label>
              ))}
            </div>
            <button type="button" onClick={() => setFilterPopup(null)} className="mt-4 w-full rounded-lg bg-yellow-400 py-3 text-sm font-bold text-gray-900 hover:bg-yellow-500">Apply</button>
          </div>
        </div>
      )}

      {/* Type popup */}
      {filterPopup === "type" && (
        <div className="fixed inset-0 z-[95]" onClick={() => setFilterPopup(null)}>
          <div className="absolute inset-0 bg-black/30 sm:bg-black/10" />
          {/* Desktop */}
          <div className="absolute right-20 top-28 z-50 hidden w-56 rounded-xl border border-gray-200 bg-white p-4 shadow-2xl sm:block" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-bold text-gray-900">Job Type</h4>
              <button type="button" onClick={() => setEnabledJobKinds(new Set(JOB_KINDS))} className="text-xs font-medium text-blue-600 hover:text-blue-700">Select all</button>
            </div>
            {JOB_KINDS.map((kind) => (
              <label key={kind} className="flex cursor-pointer items-center gap-2.5 py-1.5">
                <input type="checkbox" checked={enabledJobKinds.has(kind)} onChange={() => toggleJobKind(kind)} className="h-4 w-4 rounded border-gray-300" />
                <span className="text-sm font-medium text-gray-700">{kind}</span>
              </label>
            ))}
            <button type="button" onClick={() => setFilterPopup(null)} className="mt-3 w-full rounded-lg bg-yellow-400 py-2 text-sm font-bold text-gray-900 hover:bg-yellow-500">Submit</button>
          </div>
          {/* Mobile */}
          <div className="absolute inset-x-0 bottom-[72px] rounded-t-2xl bg-white p-5 pb-6 shadow-2xl sm:hidden" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-gray-300" />
            <div className="mb-4 flex items-center justify-between">
              <h4 className="text-base font-bold text-gray-900">Job Type</h4>
              <button type="button" onClick={() => setEnabledJobKinds(new Set(JOB_KINDS))} className="text-xs font-medium text-blue-600 hover:text-blue-700">Select all</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {JOB_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => toggleJobKind(kind)}
                  className={`rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition ${enabledJobKinds.has(kind) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-600"}`}
                >
                  {kind}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setFilterPopup(null)} className="mt-5 w-full rounded-lg bg-yellow-400 py-3 text-sm font-bold text-gray-900 hover:bg-yellow-500">Apply</button>
          </div>
        </div>
      )}

      {/* Floating calendar FAB — opens create schedule, sits above bottom nav on mobile */}
      <button
        type="button"
        onClick={() => setNewScheduleOpen(true)}
        className="fixed right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-yellow-400 text-gray-900 shadow-lg transition hover:bg-yellow-500 hover:shadow-xl sm:right-8 sm:h-14 sm:w-14 bottom-[140px] sm:bottom-[76px] lg:bottom-8"
        aria-label="Create event"
      >
        <Plus className="h-7 w-7" />
      </button>

      {/* Phone Number Picker for Click-to-Call */}
      {callPickerEvent && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-950/40 p-4"
          onClick={() => setCallPickerEvent(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-gray-200 pb-3">
              <h3 className="text-lg font-bold text-gray-900">Select Outbound Number</h3>
              <button
                type="button"
                onClick={() => setCallPickerEvent(null)}
                className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-sm text-gray-500">
              Calling <span className="font-semibold text-gray-700">{callPickerEvent.customer_name || callPickerEvent.customer_phone}</span>
            </p>
            <div className="mt-4 space-y-2">
              {twilioLines.map((line) => (
                <button
                  key={line.key}
                  type="button"
                  onClick={() => openDialerForEvent(callPickerEvent, line.number)}
                  className="flex w-full items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 text-left transition hover:border-blue-300 hover:bg-blue-50"
                >
                  <PhoneOutgoing className="h-5 w-5 text-blue-600" />
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{line.label}</div>
                    <div className="text-xs text-gray-500">{line.number}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
