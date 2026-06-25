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

// Real-time subscription via Supabase
const calendarListeners = new Set<(events: CalendarEvent[]) => void>();
let calendarChannel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
let lastTimeMin: string | undefined;
let lastTimeMax: string | undefined;

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
          async () => {
            const events = await loadCalendarEvents(lastTimeMin, lastTimeMax);
            calendarListeners.forEach((cb) => cb(events));
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
    }
  };
}
