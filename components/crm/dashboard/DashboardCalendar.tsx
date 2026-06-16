"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";

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

const ARIZONA_TIMEZONE = "America/Phoenix";

function getArizonaToday() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ARIZONA_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = formatter.formatToParts(new Date());
  return {
    year: Number(parts.find((p) => p.type === "year")?.value),
    month: Number(parts.find((p) => p.type === "month")?.value) - 1,
    day: Number(parts.find((p) => p.type === "day")?.value),
  };
}

function getWeekDays(baseDate: Date): Date[] {
  const day = baseDate.getDay();
  const sunday = new Date(baseDate);
  sunday.setDate(baseDate.getDate() - day);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    days.push(d);
  }
  return days;
}

function eventDateKey(event: CalendarEvent): string | null {
  const value = event.start?.dateTime || event.start?.date;
  if (!value) return null;

  if (event.start?.date && !event.start?.dateTime) {
    const [y, m, d] = event.start.date.split("-").map(Number);
    return `${y}-${m - 1}-${d}`;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ARIZONA_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = formatter.formatToParts(new Date(value));
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value) - 1;
  const dayNum = Number(parts.find((p) => p.type === "day")?.value);
  return `${year}-${month}-${dayNum}`;
}

function formatEventTime(event: CalendarEvent): string {
  const dateValue = event.start?.dateTime;
  if (!dateValue) return "";

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: ARIZONA_TIMEZONE,
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
    return new Date(year, month, day);
  }, []);

  const baseDate = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + weekOffset * 7);
    return d;
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
    async function fetchEvents() {
      setLoading(true);
      try {
        const sunday = weekDays[0];
        const saturday = weekDays[6];
        const timeMin = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate()).toISOString();
        const timeMax = new Date(saturday.getFullYear(), saturday.getMonth(), saturday.getDate() + 1).toISOString();

        const res = await fetch(
          `/api/google-calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`
        );
        const data = (await res.json()) as { connected?: boolean; events?: CalendarEvent[] };
        setConnected(Boolean(data.connected));
        setEvents(data.events || []);
      } catch {
        setConnected(false);
        setEvents([]);
      } finally {
        setLoading(false);
      }
    }
    void fetchEvents();
  }, [weekDays]);

  return (
    <section className="rounded-xl border border-gray-200 bg-white px-4 py-4 sm:px-5 sm:py-4">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-gray-900">{headerDate}</h2>
          <p className="text-xs text-gray-500">Your upcoming events are displayed below</p>
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
        <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center">
          <Calendar className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">Google Calendar not connected</p>
          <button
            type="button"
            onClick={() => router.push("/crm/calendar")}
            className="mt-2 text-xs font-medium text-blue-600 hover:underline"
          >
            Connect in Calendar settings
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-7 divide-x divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
          {weekDays.map((day, idx) => {
            const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
            const isToday = key === todayKey;
            const dayEvents = eventsByDate[key] || [];

            return (
              <div
                key={key}
                className={`min-h-[140px] ${isToday ? "bg-blue-50/40" : "bg-white"}`}
              >
                {/* Day header */}
                <div className={`border-b px-2 py-1.5 text-center ${isToday ? "border-blue-200 bg-blue-50" : "border-gray-100 bg-gray-50"}`}>
                  <p className={`text-[10px] font-semibold uppercase tracking-wide ${isToday ? "text-blue-600" : "text-gray-500"}`}>
                    {WEEKDAY_LABELS[idx]}
                  </p>
                  <p className={`text-sm font-bold ${isToday ? "text-blue-700" : "text-gray-900"}`}>
                    {day.getDate()}
                  </p>
                </div>

                {/* Events */}
                <div className="space-y-0.5 p-1">
                  {loading ? (
                    <div className="h-4 w-full animate-pulse rounded bg-gray-100" />
                  ) : dayEvents.length === 0 ? null : (
                    dayEvents.slice(0, 5).map((ev) => {
                      const time = formatEventTime(ev);
                      const title = ev.summary || "Untitled";
                      const isMaterial = title.toLowerCase().includes("material");
                      return (
                        <div
                          key={ev.id}
                          className={`cursor-pointer rounded px-1 py-0.5 text-[10px] leading-tight transition hover:opacity-80 ${
                            isMaterial
                              ? "border-l-2 border-orange-400 bg-orange-50 text-orange-800"
                              : "border-l-2 border-blue-300 bg-blue-50/50 text-gray-700"
                          }`}
                          onClick={() => router.push("/crm/calendar")}
                          title={`${title}${time ? ` ${time}` : ""}`}
                        >
                          <span className="line-clamp-2">
                            {title}
                            {time && <span className="ml-0.5 text-[9px] text-gray-500">{time}</span>}
                          </span>
                        </div>
                      );
                    })
                  )}
                  {dayEvents.length > 5 && (
                    <p className="px-1 text-[9px] text-gray-400">+{dayEvents.length - 5} more</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
