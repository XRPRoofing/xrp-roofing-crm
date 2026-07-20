import { NextRequest, NextResponse } from "next/server";
import {
  decodePolyline,
  parseGoogleDuration,
  type RouteResult,
  type RouteLeg,
  type RouteWarning,
  type RouteStop,
} from "@/lib/calendar-route";

export const runtime = "nodejs";

const MAX_INTERMEDIATES = 25;

type RouteRequest = {
  date?: string;
  memberId?: string;
  startAddress?: string;
  stops: RouteStop[];
};

type GoogleLatLng = { latitude: number; longitude: number };

type GoogleRouteLeg = {
  distanceMeters?: number;
  duration?: string;
  startLocation?: { latLng?: GoogleLatLng };
  endLocation?: { latLng?: GoogleLatLng };
  polyline?: { encodedPolyline?: string };
};

type GoogleRoute = {
  distanceMeters?: number;
  duration?: string;
  polyline?: { encodedPolyline?: string };
  legs?: GoogleRouteLeg[];
};

type GoogleRoutesError = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

function getApiKey(): string | undefined {
  return process.env.GOOGLE_ROUTES_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
}

function buildError(message: string, stops: RouteStop[]): RouteResult {
  return {
    path: [],
    legs: [],
    totalDistanceMeters: 0,
    totalDurationSeconds: 0,
    warnings: [],
    error: message,
  };
}

function computeWarnings(stops: RouteStop[], legs: RouteLeg[]): RouteWarning[] {
  const warnings: RouteWarning[] = [];

  for (const leg of legs) {
    const fromIndex = leg.fromStopIndex;
    const toIndex = leg.toStopIndex;

    if (fromIndex < 0 || toIndex < 1 || fromIndex >= stops.length || toIndex >= stops.length) {
      continue;
    }

    const fromStop = stops[fromIndex];
    const toStop = stops[toIndex];
    if (!fromStop || !toStop) continue;
    if (fromStop.all_day || toStop.all_day) continue;

    const fromEnd = new Date(fromStop.end_time).getTime();
    const toStart = new Date(toStop.start_time).getTime();
    if (!Number.isFinite(fromEnd) || !Number.isFinite(toStart)) continue;

    const gapMs = toStart - fromEnd;
    const travelMs = leg.durationSeconds * 1000;

    if (travelMs > gapMs) {
      warnings.push({
        type: "insufficient_travel",
        fromStopIndex: fromIndex,
        toStopIndex: toIndex,
        message: `Not enough travel time between ${fromStop.title} and ${toStop.title}`,
        severity: "warning",
      });
    }

    const LONG_DRIVE_MILES = 50;
    const LONG_DRIVE_MINUTES = 60;
    const LARGE_GAP_MINUTES = 120;

    if (leg.distanceMeters > LONG_DRIVE_MILES * 1609.344 || leg.durationSeconds > LONG_DRIVE_MINUTES * 60) {
      warnings.push({
        type: "long_drive",
        fromStopIndex: fromIndex,
        toStopIndex: toIndex,
        message: `Long drive from ${fromStop.title} to ${toStop.title}`,
        severity: "warning",
      });
    }

    if (gapMs - travelMs > LARGE_GAP_MINUTES * 60 * 1000) {
      warnings.push({
        type: "large_gap",
        fromStopIndex: fromIndex,
        toStopIndex: toIndex,
        message: `Large gap between ${fromStop.title} and ${toStop.title}`,
        severity: "info",
      });
    }
  }

  return warnings;
}

export async function POST(req: NextRequest) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return NextResponse.json(buildError("Google Routes API key is not configured", []), { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as RouteRequest;
  const stops = Array.isArray(body.stops) ? body.stops : [];
  const startAddress = body.startAddress?.trim() || "";

  // Temporary diagnostics for production member matching
  console.info("[calendar/route] request", {
    memberId: body.memberId,
    date: body.date,
    startAddress,
    stopsCount: stops.length,
    keyPresent: Boolean(getApiKey()),
  });

  if (stops.length === 0) {
    return NextResponse.json(buildError("No stops for the selected date", []));
  }

  const unmappedStops = stops.filter((s) => !s.address?.trim());
  if (unmappedStops.length > 0) {
    return NextResponse.json(
      buildError("Route unavailable — verify property address", stops),
      { status: 400 },
    );
  }

  let origin: { address?: string } | undefined;
  let destination: { address?: string } | undefined;
  let intermediates: { address?: string }[] = [];

  if (startAddress) {
    origin = { address: startAddress };
    destination = { address: stops[stops.length - 1].address };
    intermediates = stops.slice(0, -1).map((s) => ({ address: s.address }));
  } else if (stops.length === 1) {
    return NextResponse.json({
      path: [],
      legs: [],
      totalDistanceMeters: 0,
      totalDurationSeconds: 0,
      warnings: [],
    });
  } else {
    origin = { address: stops[0].address };
    destination = { address: stops[stops.length - 1].address };
    intermediates = stops.slice(1, -1).map((s) => ({ address: s.address }));
  }

  if (intermediates.length > MAX_INTERMEDIATES) {
    return NextResponse.json(
      buildError(`Too many stops (${stops.length}). The route planner supports up to ${MAX_INTERMEDIATES + (startAddress ? 1 : 0)} appointments in Phase 1.`, stops),
      { status: 400 },
    );
  }

  const fieldMask = [
    "routes.duration",
    "routes.distanceMeters",
    "routes.polyline.encodedPolyline",
    "routes.legs.duration",
    "routes.legs.distanceMeters",
    "routes.legs.startLocation.latLng",
    "routes.legs.endLocation.latLng",
    "routes.legs.polyline.encodedPolyline",
  ].join(",");

  const payload: Record<string, unknown> = {
    origin,
    destination,
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_UNAWARE",
    polylineQuality: "HIGH_QUALITY",
    polylineEncoding: "ENCODED_POLYLINE",
  };

  if (intermediates.length > 0) {
    payload.intermediates = intermediates;
  }

  let googleData: { routes?: GoogleRoute[] } & GoogleRoutesError | undefined;
  try {
    const response = await fetch(
      `https://routes.googleapis.com/directions/v2:computeRoutes?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-FieldMask": fieldMask,
        },
        body: JSON.stringify(payload),
      },
    );

    googleData = (await response.json()) as { routes?: GoogleRoute[] } & GoogleRoutesError;

    if (!response.ok) {
      const message = googleData?.error?.message || `Google Routes API returned ${response.status}`;
      return NextResponse.json(buildError(message, stops), { status: response.status });
    }
  } catch (err) {
    return NextResponse.json(
      buildError(err instanceof Error ? err.message : "Failed to contact routing service", stops),
      { status: 500 },
    );
  }

  const route = googleData?.routes?.[0];
  if (!route) {
    return NextResponse.json(buildError("No route found — verify the addresses", stops), { status: 400 });
  }

  const encodedPolyline =
    route.polyline?.encodedPolyline ||
    route.legs?.map((l) => l.polyline?.encodedPolyline).filter(Boolean).join("");

  const path = encodedPolyline ? decodePolyline(encodedPolyline) : [];

  const legs: RouteLeg[] = (route.legs || []).map((leg, index) => {
    const startLat = leg.startLocation?.latLng?.latitude ?? 0;
    const startLng = leg.startLocation?.latLng?.longitude ?? 0;
    const endLat = leg.endLocation?.latLng?.latitude ?? 0;
    const endLng = leg.endLocation?.latLng?.longitude ?? 0;

    let fromStopIndex: number;
    let toStopIndex: number;

    if (startAddress) {
      fromStopIndex = index - 1;
      toStopIndex = index;
    } else {
      fromStopIndex = index;
      toStopIndex = index + 1;
    }

    return {
      fromStopIndex,
      toStopIndex,
      distanceMeters: leg.distanceMeters || 0,
      durationSeconds: parseGoogleDuration(leg.duration),
      startLocation: { lat: startLat, lng: startLng },
      endLocation: { lat: endLat, lng: endLng },
    };
  });

  const totalDistanceMeters = route.distanceMeters || legs.reduce((sum, l) => sum + l.distanceMeters, 0);
  const totalDurationSeconds =
    parseGoogleDuration(route.duration) || legs.reduce((sum, l) => sum + l.durationSeconds, 0);

  const warnings = computeWarnings(stops, legs);

  const result: RouteResult = {
    path,
    legs,
    totalDistanceMeters,
    totalDurationSeconds,
    warnings,
  };

  return NextResponse.json(result);
}
