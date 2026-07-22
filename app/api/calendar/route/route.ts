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

type RoutedStop = { stop: RouteStop; originalIndex: number };

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

// Result of one attempt to compute a route over a set of stops.
type ComputeOutcome =
  | { ok: true; result: RouteResult }
  | { ok: false; status: number; message: string };

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

// Compute a route over the given routed stops. `allStops` is the full stop list
// (used for warning indexing, since legs reference original indexes).
async function computeRouteForStops(
  routedStops: RoutedStop[],
  startAddress: string,
  apiKey: string,
  allStops: RouteStop[],
): Promise<ComputeOutcome> {
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
    return {
      ok: false,
      status: 400,
      message: `Too many stops (${allStops.length}). The route planner supports up to ${MAX_INTERMEDIATES + (startAddress ? 1 : 0)} appointments in Phase 1.`,
    };
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

  // For a lone stop we can short-circuit to a single geocoded pin.
  const singleStopResult = async (): Promise<ComputeOutcome | null> => {
    if (startAddress || routedStops.length !== 1) return null;
    const loc = await geocodeAddress(routedStops[0].stop.address, apiKey);
    if (!loc) return null;
    const stopIndex = routedStops[0].originalIndex;
    const leg: RouteLeg = {
      fromStopIndex: stopIndex,
      toStopIndex: stopIndex,
      distanceMeters: 0,
      durationSeconds: 0,
      startLocation: loc,
      endLocation: loc,
    };
    return {
      ok: true,
      result: {
        path: [],
        legs: [leg],
        totalDistanceMeters: 0,
        totalDurationSeconds: 0,
        warnings: [],
      },
    };
  };

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
      const single = await singleStopResult();
      if (single) return single;
      return { ok: false, status: response.status, message };
    }
  } catch (err) {
    return {
      ok: false,
      status: 500,
      message: err instanceof Error ? err.message : "Failed to contact routing service",
    };
  }

  const route = googleData?.routes?.[0];

  if (!route) {
    const single = await singleStopResult();
    if (single) return single;
    return { ok: false, status: 400, message: "No route found — verify the addresses" };
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

  const warnings = computeWarnings(allStops, legs, startAddress);

  return {
    ok: true,
    result: {
      path,
      legs,
      totalDistanceMeters,
      totalDurationSeconds,
      warnings,
    },
  };
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

  const routedStops: RoutedStop[] = stops
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

  const first = await computeRouteForStops(routedStops, startAddress, apiKey, stops);
  if (first.ok) {
    return NextResponse.json(first.result);
  }

  // Salvage: a single unresolvable address makes Google reject the whole
  // route. Geocode each stop to pinpoint the bad one(s), skip just those, and
  // route the remaining valid stops instead of failing everything.
  if (routedStops.length > 1) {
    const geocoded = await Promise.all(
      routedStops.map(({ stop }) => geocodeAddress(stop.address, apiKey)),
    );
    const good = routedStops.filter((_, i) => geocoded[i]);
    const badIndexes = routedStops
      .filter((_, i) => !geocoded[i])
      .map(({ originalIndex }) => originalIndex);

    if (badIndexes.length > 0 && good.length > 0) {
      const retry = await computeRouteForStops(good, startAddress, apiKey, stops);
      if (retry.ok) {
        retry.result.unroutableStopIndexes = badIndexes;
        for (const idx of badIndexes) {
          retry.result.warnings.push({
            type: "invalid_address",
            fromStopIndex: idx,
            toStopIndex: idx,
            message: "Address couldn't be located — skipped from the route. Please verify it.",
            severity: "warning",
          });
        }
        return NextResponse.json(retry.result);
      }
    }
  }

  return NextResponse.json(buildError(first.message, stops), { status: first.status });
}
