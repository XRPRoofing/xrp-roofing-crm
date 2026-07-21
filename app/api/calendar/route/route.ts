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

async function geocodeAddress(
  address: string,
  apiKey: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`,
    );
    const data = (await response.json()) as {
      status?: string;
      results?: { geometry?: { location?: { lat: number; lng: number } } }[];
    };
    const location = data.results?.[0]?.geometry?.location;
    if (data.status === "OK" && location) {
      return { lat: location.lat, lng: location.lng };
    }
  } catch {
    /* ignore */
  }
  return null;
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

function computeWarnings(
  stops: RouteStop[],
  legs: RouteLeg[],
  startAddress = "",
): RouteWarning[] {
  const warnings: RouteWarning[] = [];

  for (const leg of legs) {
    const fromIndex = leg.fromStopIndex;
    const toIndex = leg.toStopIndex;

    if (toIndex < 0 || toIndex >= stops.length) continue;

    const toStop = stops[toIndex];
    if (!toStop) continue;

    const fromStop =
      !leg.fromStartAddress && fromIndex >= 0 && fromIndex < stops.length
        ? stops[fromIndex]
        : undefined;
    const fromTitle = leg.fromStartAddress ? startAddress || "Start" : fromStop?.title || "Previous";

    if (toStop.all_day || fromStop?.all_day) continue;

    if (!leg.fromStartAddress && fromStop) {
      const fromEnd = new Date(fromStop.end_time).getTime();
      const toStart = new Date(toStop.start_time).getTime();
      if (Number.isFinite(fromEnd) && Number.isFinite(toStart)) {
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

        const LARGE_GAP_MINUTES = 120;
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
    }

    const LONG_DRIVE_MILES = 50;
    const LONG_DRIVE_MINUTES = 60;

    if (leg.distanceMeters > LONG_DRIVE_MILES * 1609.344 || leg.durationSeconds > LONG_DRIVE_MINUTES * 60) {
      warnings.push({
        type: "long_drive",
        fromStopIndex: fromIndex,
        toStopIndex: toIndex,
        message: `Long drive from ${fromTitle} to ${toStop.title}`,
        severity: "warning",
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

  if (stops.length === 0) {
    return NextResponse.json(buildError("No stops for the selected date", []));
  }

  const routedStops = stops
    .map((stop, index) => ({ stop, originalIndex: index }))
    .filter(({ stop }) => stop.address?.trim());

  if (routedStops.length === 0) {
    return NextResponse.json({
      path: [],
      legs: [],
      totalDistanceMeters: 0,
      totalDurationSeconds: 0,
      warnings: [],
    });
  }

  let origin: { address?: string } | undefined;
  let destination: { address?: string } | undefined;
  let intermediates: { address?: string }[] = [];

  if (startAddress && routedStops.length > 0) {
    origin = { address: startAddress };
    destination = { address: routedStops[routedStops.length - 1].stop.address };
    intermediates = routedStops.slice(0, -1).map(({ stop }) => ({ address: stop.address }));
  } else if (routedStops.length === 1) {
    origin = { address: routedStops[0].stop.address };
    destination = { address: routedStops[0].stop.address };
    intermediates = [];
  } else {
    origin = { address: routedStops[0].stop.address };
    destination = { address: routedStops[routedStops.length - 1].stop.address };
    intermediates = routedStops.slice(1, -1).map(({ stop }) => ({ address: stop.address }));
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
      if (!startAddress && routedStops.length === 1) {
        const loc = await geocodeAddress(routedStops[0].stop.address, apiKey);
        if (loc) {
          const stopIndex = routedStops[0].originalIndex;
          const leg: RouteLeg = {
            fromStopIndex: stopIndex,
            toStopIndex: stopIndex,
            distanceMeters: 0,
            durationSeconds: 0,
            startLocation: loc,
            endLocation: loc,
          };
          return NextResponse.json({
            path: [],
            legs: [leg],
            totalDistanceMeters: 0,
            totalDurationSeconds: 0,
            warnings: [],
          });
        }
      }
      return NextResponse.json(buildError(message, stops), { status: response.status });
    }
  } catch (err) {
    return NextResponse.json(
      buildError(err instanceof Error ? err.message : "Failed to contact routing service", stops),
      { status: 500 },
    );
  }

  let route = googleData?.routes?.[0];

  if (!route && !startAddress && routedStops.length === 1) {
    const loc = await geocodeAddress(routedStops[0].stop.address, apiKey);
    if (loc) {
      const stopIndex = routedStops[0].originalIndex;
      const leg: RouteLeg = {
        fromStopIndex: stopIndex,
        toStopIndex: stopIndex,
        distanceMeters: 0,
        durationSeconds: 0,
        startLocation: loc,
        endLocation: loc,
      };
      return NextResponse.json({
        path: [],
        legs: [leg],
        totalDistanceMeters: 0,
        totalDurationSeconds: 0,
        warnings: [],
      });
    }
  }

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
    let fromStartAddressLeg = false;

    if (startAddress) {
      if (index === 0) {
        fromStartAddressLeg = true;
        fromStopIndex = -1;
        toStopIndex = routedStops[0]?.originalIndex ?? 0;
      } else {
        fromStopIndex = routedStops[index - 1]?.originalIndex ?? 0;
        toStopIndex = routedStops[index]?.originalIndex ?? 0;
      }
    } else if (routedStops.length === 1) {
      fromStopIndex = routedStops[0]?.originalIndex ?? 0;
      toStopIndex = routedStops[0]?.originalIndex ?? 0;
    } else {
      fromStopIndex = routedStops[index]?.originalIndex ?? 0;
      toStopIndex = routedStops[index + 1]?.originalIndex ?? 0;
    }

    return {
      fromStopIndex,
      toStopIndex,
      fromStartAddress: fromStartAddressLeg,
      distanceMeters: leg.distanceMeters || 0,
      durationSeconds: parseGoogleDuration(leg.duration),
      startLocation: { lat: startLat, lng: startLng },
      endLocation: { lat: endLat, lng: endLng },
    };
  });

  const totalDistanceMeters = route.distanceMeters || legs.reduce((sum, l) => sum + l.distanceMeters, 0);
  const totalDurationSeconds =
    parseGoogleDuration(route.duration) || legs.reduce((sum, l) => sum + l.durationSeconds, 0);

  const warnings = computeWarnings(stops, legs, startAddress);

  const result: RouteResult = {
    path,
    legs,
    totalDistanceMeters,
    totalDurationSeconds,
    warnings,
  };

  return NextResponse.json(result);
}
