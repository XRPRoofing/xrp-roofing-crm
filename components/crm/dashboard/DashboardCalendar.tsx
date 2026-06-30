"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { azNoon, azParts, AZ_TZ } from "@/lib/arizona-time";
import { loadCalendarEvents, subscribeToCalendarUpdates, type CalendarEvent as CrmCalEvent } from "@/lib/calendar-sync";

type CalendarEvent = {
  id: string;
  summary?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  extendedProperties?: {
    private?: {
      crmName?: string;
      crmJobKind?: string;
    };
  };
};

function getArizonaToday() {
  return azParts(new Date());
}

function getWeekDays(baseDate: Date): Date[] {
  const p = azParts(baseDate);
  const sundayDay = p.day - p.dow;
  return Array.from({ length: 7 }, (_, i) =>
    azNoon(p.year, p.month, sundayDay + i),
  );
}

function eventDateKey(event: CalendarEvent): string | null {
  const value = event.start?.dateTime || event.start?.date;
  if (!value) return null;

  if (event.start?.date && !event.start?.dateTime) {
    const [y, m, d] = event.start.date.split("-").map(Number);
    return `${y}-${m - 1}-${d}`;
  }

  const p = azParts(new Date(value));
  return `${p.year}-${p.month}-${p.day}`;
}

function formatEventTime(event: CalendarEvent): string {
  const dateValue = event.start?.dateTime;
  if (!dateValue) return "";

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: AZ_TZ,
  }).format(new Date(dateValue));
}

const WEEKDAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export default function DashboardCalendar() {
  const router = useRouter();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);

  const today = useMemo(() => {
    const { year, month, day } = getArizonaToday();
    return azNoon(year, month, day);
  }, []);

  const baseDate = useMemo(() => {
    const p = azParts(today);
    return azNoon(p.year, p.month, p.day + weekOffset * 7);
  }, [today, weekOffset]);

  const weekDays = useMemo(() => getWeekDays(baseDate), [baseDate]);

  const todayKey = useMemo(() => {
    const { year, month, day } = getArizonaToday();
    return `${year}-${month}-${day}`;
  }, []);

  const headerDate = useMemo(() => {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: AZ_TZ,
    }).format(today);
  }, [today]);

  const eventsByDate = useMemo(() => {
    return events.reduce<Record<string, CalendarEvent[]>>((grouped, event) => {
      const key = eventDateKey(event);
      if (!key) return grouped;
      grouped[key] = [...(grouped[key] || []), event];
      return grouped;
    }, {});
  }, [events]);

  useEffect(() => {
    let mounted = true;
    async function fetchEvents() {
      setLoading(true);
      try {
        const sp = azParts(weekDays[0]);
        const ep = azParts(weekDays[6]);
        const timeMin = azNoon(sp.year, sp.month, sp.day).toISOString();
        const timeMax = azNoon(ep.year, ep.month, ep.day + 1).toISOString();

        // Fetch Google Calendar and CRM events in parallel
        const [gcalRes, crmEvents] = await Promise.all([
          fetch(`/api/google-calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`)
            .then((r) => r.json())
            .catch(() => ({ connected: false, events: [] })),
          loadCalendarEvents(timeMin, timeMax).catch(() => []),
        ]);

        if (!mounted) return;
        const data = gcalRes as { connected?: boolean; events?: CalendarEvent[] };
        setConnected(Boolean(data.connected));

        // Map CRM events to the same shape as Google Calendar events
        const mappedCrm: CalendarEvent[] = (crmEvents as CrmCalEvent[]).map((ce) => ({
          id: `crm:${ce.id}`,
          summary: ce.title,
          start: { dateTime: ce.start_time },
          end: { dateTime: ce.end_time },
          extendedProperties: { private: { crmName: ce.customer_name, crmJobKind: ce.job_kind } },
        }));

        setEvents([...(data.events || []), ...mappedCrm]);
      } catch {
        if (mounted) { setConnected(false); setEvents([]); }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void fetchEvents();
    return () => { mounted = false; };
  }, [weekDays]);

  // Real-time subscription for CRM calendar events
  useEffect(() => {
    const sp = azParts(weekDays[0]);
    const ep = azParts(weekDays[6]);
    const timeMin = azNoon(sp.year, sp.month, sp.day).toISOString();
    const timeMax = azNoon(ep.year, ep.month, ep.day + 1).toISOString();

    const unsubscribe = subscribeToCalendarUpdates(
      (updated) => {
        const mappedCrm: CalendarEvent[] = updated.map((ce) => ({
          id: `crm:${ce.id}`,
          summary: ce.title,
          start: { dateTime: ce.start_time },
          end: { dateTime: ce.end_time },
          extendedProperties: { private: { crmName: ce.customer_name, crmJobKind: ce.job_kind } },
        }));
        setEvents((prev) => {
          const nonCrm = prev.filter((e) => !e.id.startsWith("crm:"));
          return [...nonCrm, ...mappedCrm];
        });
      },
      timeMin,
      timeMax,
    );
    return unsubscribe;
  }, [weekDays]);

  return (
    <div className="px-4 py-4 sm:px-5">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{headerDate}</h2>
          <p className="text-sm text-gray-500">Your upcoming events are displayed below</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWeekOffset((w) => w - 1)}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setWeekOffset(0)}
            className="rounded-md px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setWeekOffset((w) => w + 1)}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => router.push("/crm/calendar")}
            className="ml-2 flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
          >
            <Calendar className="h-3.5 w-3.5" />
            View calendar
          </button>
        </div>
      </div>

      {/* Week grid */}
      {!connected && !loading ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center">
          <Calendar className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">Google Calendar not connected</p>
          <button
            type="button"
            onClick={() => router.push("/crm/calendar")}
            className="mt-2 text-sm font-medium text-blue-600 hover:underline"
          >
            Connect in Calendar settings
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-7 divide-x divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
          {weekDays.map((day, idx) => {
            const dp = azParts(day);
            const key = `${dp.year}-${dp.month}-${dp.day}`;
            const isToday = key === todayKey;
            const dayEvents = eventsByDate[key] || [];

            return (
              <div
                key={key}
                className={`min-h-[220px] ${isToday ? "bg-blue-50/40" : "bg-white"}`}
              >
                {/* Day header */}
                <div
                  className={`cursor-pointer border-b px-2 py-2 text-center transition hover:bg-blue-100 ${isToday ? "border-blue-200 bg-blue-50" : "border-gray-100 bg-gray-50"}`}
                  onClick={() => {
                    const mm = String(dp.month + 1).padStart(2, "0");
                    const dd = String(dp.day).padStart(2, "0");
                    router.push(`/crm/calendar?view=day&date=${dp.year}-${mm}-${dd}`);
                  }}
                >
                  <p className={`text-xs font-semibold uppercase tracking-wide ${isToday ? "text-blue-600" : "text-gray-500"}`}>
                    {WEEKDAY_LABELS[idx]}
                  </p>
                  <p className={`text-base font-bold ${isToday ? "text-blue-700" : "text-gray-900"}`}>
                    {dp.day}
                  </p>
                </div>

                {/* Events */}
                <div className="space-y-1.5 p-2">
                  {loading ? (
                    <div className="h-5 w-full animate-pulse rounded bg-gray-100" />
                  ) : dayEvents.length === 0 ? null : (
                    dayEvents.slice(0, 6).map((ev) => {
                      const time = formatEventTime(ev);
                      const title = ev.summary || "Untitled";
                      const isMaterial = title.toLowerCase().includes("material");
                      return (
                        <div
                          key={ev.id}
                          className={`cursor-pointer rounded px-2 py-1.5 text-[11px] leading-snug transition hover:opacity-80 ${
                            isMaterial
                              ? "border-l-2 border-orange-400 bg-orange-50 text-orange-800"
                              : "border-l-2 border-blue-300 bg-blue-50/50 text-gray-700"
                          }`}
                          onClick={() => {
                            const mm = String(dp.month + 1).padStart(2, "0");
                            const dd = String(dp.day).padStart(2, "0");
                            router.push(`/crm/calendar?view=day&date=${dp.year}-${mm}-${dd}`);
                          }}
                          title={`${title}${time ? ` ${time}` : ""}`}
                        >
                          <span className="line-clamp-2">
                            {title}
                            {time && <span className="ml-0.5 text-[10px] text-gray-500">{time}</span>}
                          </span>
                        </div>
                      );
                    })
                  )}
                  {dayEvents.length > 6 && (
                    <p className="px-1 text-[10px] text-gray-400">+{dayEvents.length - 6} more</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
