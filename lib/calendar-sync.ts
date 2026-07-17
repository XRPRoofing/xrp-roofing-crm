"use client";

/**
 * Calendar event sync — uses API endpoints for CRUD (which use the service
 * role key server-side) and Supabase real-time for live updates.
 */

import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";

export type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  start_time: string; // ISO 8601
  end_time: string;   // ISO 8601
  all_day: boolean;
  location: string;
  color: string;
  assigned_to: string;
  customer_name: string;
  customer_phone: string;
  job_kind: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

const TABLE = "calendar_events";

export async function loadCalendarEvents(
  timeMin?: string,
  timeMax?: string
): Promise<CalendarEvent[]> {
  try {
    const params = new URLSearchParams();
    if (timeMin) params.set("timeMin", timeMin);
    if (timeMax) params.set("timeMax", timeMax);
    const response = await fetch(`/api/calendar/events?${params.toString()}`);
    const data = await response.json() as { events?: CalendarEvent[] };
    return data.events || [];
  } catch {
    return [];
  }
}

export async function createCalendarEvent(
  event: Omit<CalendarEvent, "id" | "created_at" | "updated_at">
): Promise<CalendarEvent | null> {
  try {
    const response = await fetch("/api/calendar/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    if (!response.ok) return null;
    const data = await response.json() as { event?: CalendarEvent };
    return data.event || null;
  } catch {
    return null;
  }
}

export async function updateCalendarEvent(
  id: string,
  updates: Partial<Omit<CalendarEvent, "id" | "created_at">>
): Promise<CalendarEvent | null> {
  try {
    const response = await fetch("/api/calendar/events", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...updates }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { event?: CalendarEvent };
    return data.event || null;
  } catch {
    return null;
  }
}

export async function deleteCalendarEvent(id: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/calendar/events?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Arizona timezone offset (UTC-7 year-round, no DST)
const AZ_OFFSET = "-07:00";

/**
 * Build an ISO string from a date + optional time, pinned to Arizona (UTC-7).
 * If no time is provided, defaults to 09:00.
 */
export function toArizonaISO(date: string, time?: string): string {
  const t = time || "09:00";
  return new Date(`${date}T${t}:00${AZ_OFFSET}`).toISOString();
}

// ── Job ↔ Calendar Event linking (localStorage map) ───────────────
const JOB_CAL_MAP_KEY = "xrp:job-calendar-map";
const CALENDAR_JOB_MAP_KEY = "xrp:calendar-job-map";

function readJobCalMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(JOB_CAL_MAP_KEY) || "{}"); } catch { return {}; }
}

function writeJobCalMap(map: Record<string, string>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(JOB_CAL_MAP_KEY, JSON.stringify(map));
}

function readCalJobMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const map = JSON.parse(localStorage.getItem(CALENDAR_JOB_MAP_KEY) || "{}") as Record<string, string>;
    // Seed the reverse map from the legacy job→calendar map on first read
    const legacy = JSON.parse(localStorage.getItem(JOB_CAL_MAP_KEY) || "{}") as Record<string, string>;
    for (const [jobId, eventId] of Object.entries(legacy)) {
      if (eventId && !map[eventId]) map[eventId] = jobId;
    }
    return map;
  } catch { return {}; }
}

function writeCalJobMap(map: Record<string, string>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CALENDAR_JOB_MAP_KEY, JSON.stringify(map));
}

export function linkJobToCalendarEvent(jobId: string, calendarEventId: string) {
  const map = readJobCalMap();
  map[jobId] = calendarEventId;
  writeJobCalMap(map);

  const reverseMap = readCalJobMap();
  reverseMap[calendarEventId] = jobId;
  writeCalJobMap(reverseMap);
}

export function getCalendarEventIdForJob(jobId: string): string | null {
  return readJobCalMap()[jobId] || null;
}

export function getJobIdForCalendarEvent(calendarEventId: string): string | null {
  return readCalJobMap()[calendarEventId] || null;
}

export function unlinkJobFromCalendarEvent(jobId: string) {
  const map = readJobCalMap();
  const eventId = map[jobId];
  delete map[jobId];
  writeJobCalMap(map);

  if (eventId) {
    const reverseMap = readCalJobMap();
    delete reverseMap[eventId];
    writeCalJobMap(reverseMap);
  }
}

/**
 * Create or update a calendar event for a job.
 * If the job already has a linked event, it updates it; otherwise creates a new one.
 * Returns the calendar event ID.
 */
export async function syncJobToCalendar(
  jobId: string,
  eventData: Omit<CalendarEvent, "id" | "created_at" | "updated_at">,
): Promise<string | null> {
  const existingId = getCalendarEventIdForJob(jobId);
  if (existingId) {
    const result = await updateCalendarEvent(existingId, eventData);
    if (result) return result.id;
    // If update failed (event deleted?), fall through to create
  }
  const created = await createCalendarEvent(eventData);
  if (created) {
    linkJobToCalendarEvent(jobId, created.id);
    return created.id;
  }
  return null;
}

// Real-time subscription via Supabase (debounced to prevent cascade re-fetches)
const calendarListeners = new Set<(events: CalendarEvent[]) => void>();
let calendarChannel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
let lastTimeMin: string | undefined;
let lastTimeMax: string | undefined;
let calendarDebounce: ReturnType<typeof setTimeout> | null = null;

export function subscribeToCalendarUpdates(
  onUpdate: (events: CalendarEvent[]) => void,
  timeMin?: string,
  timeMax?: string
): () => void {
  if (!hasSupabaseConfig()) return () => {};

  calendarListeners.add(onUpdate);
  lastTimeMin = timeMin;
  lastTimeMax = timeMax;

  if (!calendarChannel) {
    try {
      const supabase = createClient();
      calendarChannel = supabase
        .channel("calendar-events-realtime")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: TABLE },
          () => {
            // Debounce: batch rapid-fire updates into a single re-fetch
            if (calendarDebounce) clearTimeout(calendarDebounce);
            calendarDebounce = setTimeout(async () => {
              calendarDebounce = null;
              const events = await loadCalendarEvents(lastTimeMin, lastTimeMax);
              calendarListeners.forEach((cb) => cb(events));
            }, 500);
          }
        )
        .subscribe();
    } catch {
      calendarChannel = null;
      return () => {};
    }
  }

  return () => {
    calendarListeners.delete(onUpdate);
    if (calendarListeners.size === 0 && calendarChannel) {
      try {
        createClient().removeChannel(calendarChannel);
      } catch { /* ignore */ }
      calendarChannel = null;
      if (calendarDebounce) { clearTimeout(calendarDebounce); calendarDebounce = null; }
    }
  };
}
