import type { CalendarEvent } from "@/lib/calendar-sync";
import { azParts } from "@/lib/arizona-time";

export type RouteJob = {
  address: string;
  city: string;
  assignedTo: string;
  assignedCrew?: string[];
};

export type RouteStop = {
  eventId: string;
  title: string;
  start_time: string;
  end_time: string;
  all_day: boolean;
  address: string;
  location: string;
  customerName: string;
  customerPhone: string;
  jobKind: string;
  isUnmapped: boolean;
};

export type RouteLeg = {
  fromStopIndex: number;
  toStopIndex: number;
  distanceMeters: number;
  durationSeconds: number;
  startLocation: { lat: number; lng: number };
  endLocation: { lat: number; lng: number };
  fromStartAddress?: boolean;
};

export type RouteWarning = {
  type: "insufficient_travel" | "long_drive" | "large_gap";
  fromStopIndex: number;
  toStopIndex: number;
  message: string;
  severity: "warning" | "info";
};

export type RouteResult = {
  path: { lat: number; lng: number }[];
  legs: RouteLeg[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  warnings: RouteWarning[];
  stops?: RouteStop[];
  error?: string;
};

export function resolveRouteAddress(
  event: CalendarEvent,
  jobsById: Record<string, RouteJob> = {},
): string {
  const rawLocation = event.location?.trim();
  if (rawLocation) return rawLocation;

  if (event.job_id && jobsById[event.job_id]) {
    const job = jobsById[event.job_id];
    const parts = [job.address?.trim(), job.city?.trim()].filter(Boolean);
    if (parts.length > 0) return parts.join(", ");
  }

  return "";
}

export function eventToDateKey(event: CalendarEvent): string {
  const parts = azParts(new Date(event.start_time));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function buildRouteStops(
  events: CalendarEvent[],
  jobsById: Record<string, RouteJob> = {},
): RouteStop[] {
  return [...events]
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    .map((event) => {
      const address = resolveRouteAddress(event, jobsById);
      return {
        eventId: event.id,
        title: event.title,
        start_time: event.start_time,
        end_time: event.end_time,
        all_day: event.all_day,
        address,
        location: event.location?.trim() || "",
        customerName: event.customer_name?.trim() || "",
        customerPhone: event.customer_phone?.trim() || "",
        jobKind: event.job_kind?.trim() || "",
        isUnmapped: !address,
      };
    });
}

export function formatDuration(totalSeconds: number): string {
  if (!isFinite(totalSeconds) || totalSeconds < 0) return "0 min";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

export function formatDistance(meters: number): string {
  if (!isFinite(meters) || meters < 0) return "0 mi";
  const miles = meters / 1609.344;
  if (miles < 0.1) return `${Math.round(meters)} m`;
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

export function parseGoogleDuration(value: string | number | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string" || !value) return 0;
  const match = value.match(/^([\d.]+)s$/);
  if (match) return parseFloat(match[1]);
  return 0;
}

export function decodePolyline(encoded: string, precision = 5): { lat: number; lng: number }[] {
  const points: { lat: number; lng: number }[] = [];
  const factor = Math.pow(10, precision);
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({ lat: lat / factor, lng: lng / factor });
  }

  return points;
}
