"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Navigation, Route, X } from "lucide-react";
import { azParts } from "@/lib/arizona-time";
import type { CalendarEvent } from "@/lib/calendar-sync";
import type { Lead } from "@/types/crm";
import {
  buildRosterFromMembers,
  eventMatchesMember,
  getSelectableRoster,
  getSortedSelectableMembers,
  getUnassignedMember,
  resolveRouteAssignee,
  UNASSIGNED_ID,
  type TeamMember,
  type TeamRoster,
} from "@/lib/calendar-team";
import {
  buildRouteStops,
  eventToDateKey,
  formatDistance,
  formatDuration,
  type RouteLeg,
  type RouteResult,
  type RouteStop,
  type RouteWarning,
} from "@/lib/calendar-route";

type CalendarRoutePlannerProps = {
  open: boolean;
  onClose: () => void;
  currentDate: Date;
  events: CalendarEvent[];
  jobs: Lead[];
  selectedEvent: CalendarEvent | null;
  onSelectEvent: (event: CalendarEvent) => void;
};

type GoogleLatLng = { lat: number; lng: number };
interface GoogleLatLngBounds {
  extend(point: GoogleLatLng): void;
  getCenter(): GoogleLatLng;
}
interface GoogleMap {
  fitBounds(bounds: GoogleLatLngBounds): void;
  panTo(position: GoogleLatLng): void;
  setCenter(position: GoogleLatLng): void;
  setZoom(zoom: number): void;
}
interface GoogleMarker {
  setMap(map: GoogleMap | null): void;
  addListener(event: string, handler: () => void): void;
}
interface GooglePolyline {
  setMap(map: GoogleMap | null): void;
}
interface GoogleMapsApi {
  maps: {
    Map: new (el: HTMLElement, opts: { center: GoogleLatLng; zoom: number; mapTypeControl?: boolean; streetViewControl?: boolean; fullscreenControl?: boolean; zoomControl?: boolean }) => GoogleMap;
    Marker: new (opts: { map: GoogleMap; position: GoogleLatLng; title?: string; label?: string }) => GoogleMarker;
    Polyline: new (opts: { map: GoogleMap; path: GoogleLatLng[]; geodesic?: boolean; strokeColor?: string; strokeOpacity?: number; strokeWeight?: number }) => GooglePolyline;
    LatLngBounds: new () => GoogleLatLngBounds;
  };
}

function getGoogleApi(): GoogleMapsApi | undefined {
  return (window as unknown as { google?: GoogleMapsApi }).google;
}

function useGoogleMapsLoader() {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      setError("Google Maps API key is not configured");
      return;
    }
    if (getGoogleApi()?.maps?.Map) {
      setLoaded(true);
      return;
    }

    // Surfaces InvalidKeyMapError, RefererNotAllowedMapError, ApiNotActivatedMapError, etc.
    (window as unknown as Record<string, unknown>).gm_authFailure = () => {
      setError("Google Maps API key error (InvalidKey / RefererNotAllowed / ApiNotActivated). Check the browser console for the exact error code.");
    };

    const scriptId = "google-maps-script";
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;

    const waitForMapReady = (onReady: () => void, onTimeout: () => void) => {
      const iv = setInterval(() => {
        if (getGoogleApi()?.maps?.Map) {
          clearInterval(iv);
          onReady();
        }
      }, 100);
      const to = setTimeout(() => {
        clearInterval(iv);
        onTimeout();
      }, 10000);
      return () => {
        clearInterval(iv);
        clearTimeout(to);
      };
    };

    if (existing) {
      return waitForMapReady(
        () => setLoaded(true),
        () => setError("Google Maps failed to load"),
      );
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&loading=async&callback=__gmRoutePlannerInit`;
    script.async = true;
    script.defer = true;
    (window as unknown as Record<string, unknown>).__gmRoutePlannerInit = () => setLoaded(true);
    script.onerror = () => setError("Google Maps failed to load");
    document.head.appendChild(script);

    return () => {
      delete (window as unknown as Record<string, unknown>).__gmRoutePlannerInit;
    };
  }, []);

  return { loaded, error };
}

function dateKeyFromDate(d: Date): string {
  const p = azParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

function getStopPositions(stops: RouteStop[], legs: RouteLeg[]): (GoogleLatLng | undefined)[] {
  const positions: (GoogleLatLng | undefined)[] = new Array(stops.length);
  for (let i = 0; i < stops.length; i++) {
    const toLeg = legs.find((l) => l.toStopIndex === i);
    if (toLeg) {
      positions[i] = toLeg.endLocation;
      continue;
    }
    const fromLeg = legs.find((l) => !l.fromStartAddress && l.fromStopIndex === i);
    if (fromLeg) {
      positions[i] = fromLeg.startLocation;
    }
  }
  return positions;
}

export default function CalendarRoutePlanner({
  open,
  onClose,
  currentDate,
  events,
  jobs,
  selectedEvent,
  onSelectEvent,
}: CalendarRoutePlannerProps) {
  const { loaded: mapLoaded, error: mapLoadError } = useGoogleMapsLoader();

  const [baseMembers, setBaseMembers] = useState<TeamMember[]>([]);
  const [startAddress, setStartAddress] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [route, setRoute] = useState<RouteResult | null>(null);
  const hasSetInitialMember = useRef(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<GoogleMap | null>(null);
  const markersRef = useRef<GoogleMarker[]>([]);
  const polylineRef = useRef<GooglePolyline | null>(null);
  const stopPositionsRef = useRef<(GoogleLatLng | undefined)[]>([]);

  const currentDateKey = useMemo(() => dateKeyFromDate(currentDate), [currentDate]);
  const jobsById = useMemo(() => {
    const map: Record<string, Lead> = {};
    for (const job of jobs) map[job.id] = job;
    return map;
  }, [jobs]);

  const eventsForDate = useMemo(
    () => events.filter((e) => eventToDateKey(e) === currentDateKey),
    [events, currentDateKey],
  );

  const baseRoster = useMemo(
    () => (baseMembers.length > 0 ? buildRosterFromMembers(baseMembers) : null),
    [baseMembers],
  );
  const effectiveRoster = useMemo<TeamRoster | null>(() => {
    if (!baseRoster) return null;
    return getSelectableRoster(baseRoster, eventsForDate, jobsById);
  }, [baseRoster, eventsForDate, jobsById]);

  const selectableMembers = useMemo(() => {
    if (!effectiveRoster) return [getUnassignedMember()];
    return [getUnassignedMember(), ...getSortedSelectableMembers(effectiveRoster)];
  }, [effectiveRoster]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/team/roster")
      .then((r) => r.json())
      .then((data: { members?: TeamMember[]; startAddress?: string }) => {
        if (cancelled) return;
        setBaseMembers(data.members || []);
        setStartAddress(data.startAddress || "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!effectiveRoster || hasSetInitialMember.current) return;
    hasSetInitialMember.current = true;
    const nonUnassigned = selectableMembers.find((m) => m.id !== UNASSIGNED_ID);
    setSelectedMemberId(nonUnassigned?.id || UNASSIGNED_ID);
  }, [effectiveRoster, selectableMembers]);

  useEffect(() => {
    if (!effectiveRoster) return;
    if (selectedEvent) {
      const eventDateKey = eventToDateKey(selectedEvent);
      if (eventDateKey === currentDateKey) {
        const resolved = resolveRouteAssignee(selectedEvent, effectiveRoster, jobsById);
        if (resolved.memberId !== UNASSIGNED_ID) setSelectedMemberId(resolved.memberId);
      }
    }
  }, [selectedEvent, effectiveRoster, jobsById, currentDateKey]);

  useEffect(() => {
    if (!selectedEvent || !route) return;
    const stops = route.stops || [];
    const idx = stops.findIndex((s) => s.eventId === selectedEvent.id);
    if (idx >= 0) {
      setHighlightedIndex(idx);
      const pos = stopPositionsRef.current[idx];
      if (pos && mapInstanceRef.current) {
        mapInstanceRef.current.panTo(pos);
      }
    }
  }, [selectedEvent, route]);

  const selectedStops = useMemo(() => {
    if (!effectiveRoster) return [];
    const filtered = eventsForDate.filter((e) =>
      eventMatchesMember(e, effectiveRoster, selectedMemberId, jobsById)
    );
    return buildRouteStops(filtered, jobsById);
  }, [eventsForDate, effectiveRoster, jobsById, selectedMemberId]);


  useEffect(() => {
    if (!open) return;
    if (selectedStops.length === 0) {
      setRoute(null);
      setRouteError(null);
      return;
    }

    let cancelled = false;
    setRouteLoading(true);
    setRouteError(null);

    fetch("/api/calendar/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: currentDate.toISOString(),
        memberId: selectedMemberId,
        startAddress,
        stops: selectedStops,
      }),
    })
      .then(async (r) => {
        const data = (await r.json()) as RouteResult;
        if (cancelled) return;
        if (!r.ok) {
          setRouteError(data.error || "Route request failed");
          setRoute(null);
          return;
        }
        const unroutable = new Set(data.unroutableStopIndexes || []);
        const mergedStops = unroutable.size
          ? selectedStops.map((s, i) => (unroutable.has(i) ? { ...s, isUnmapped: true } : s))
          : selectedStops;
        setRoute({ ...data, stops: mergedStops });
      })
      .catch((err) => {
        if (cancelled) return;
        setRouteError(err instanceof Error ? err.message : "Route request failed");
        setRoute(null);
      })
      .finally(() => {
        if (!cancelled) setRouteLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, currentDate, selectedMemberId, startAddress, selectedStops]);

  // Create the map instance as soon as the script is ready so we can surface
  // Google auth/key errors and never leave the map container as a gray box.
  // Depends on `open`: the drawer unmounts its DOM when closed, so the map must
  // be (re)created against the fresh container each time it opens.
  useEffect(() => {
    if (!open) return;
    const google = getGoogleApi();
    if (!mapLoaded || !mapRef.current || !google?.maps?.Map || mapInstanceRef.current) return;

    mapInstanceRef.current = new google.maps.Map(mapRef.current, {
      center: { lat: 33.4484, lng: -112.074 },
      zoom: 9,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
  }, [mapLoaded, open]);

  // When the drawer closes its DOM is removed, but the map/marker/polyline refs
  // survive and point at detached nodes. Tear them down so a reopen rebuilds a
  // fresh map instead of skipping init and showing a blank/gray box.
  useEffect(() => {
    if (open) return;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }
    mapInstanceRef.current = null;
    stopPositionsRef.current = [];
  }, [open]);

  useEffect(() => {
    if (!open || !mapLoaded || !mapRef.current || !route) return;
    const google = getGoogleApi();
    if (!google?.maps) return;

    const stops = route.stops || selectedStops;
    const positions = getStopPositions(stops, route.legs);
    stopPositionsRef.current = positions;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }

    const validPositions = positions.filter((p): p is GoogleLatLng => !!p);

    if (validPositions.length === 1) {
      const single = validPositions[0];
      if (!mapInstanceRef.current) {
        mapInstanceRef.current = new google.maps.Map(mapRef.current, {
          center: single,
          zoom: 15,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
      } else {
        mapInstanceRef.current.setCenter(single);
        mapInstanceRef.current.setZoom(15);
      }
    } else if (validPositions.length > 1 || route.path.length > 1) {
      const bounds = new google.maps.LatLngBounds();
      if (route.path.length > 0) {
        for (const point of route.path) bounds.extend(point);
      } else {
        for (const point of validPositions) bounds.extend(point);
      }

      if (!mapInstanceRef.current) {
        mapInstanceRef.current = new google.maps.Map(mapRef.current, {
          center: bounds.getCenter(),
          zoom: 13,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
      }

      mapInstanceRef.current.fitBounds(bounds);
    }

    const map = mapInstanceRef.current;

    if (map) {
      for (let i = 0; i < stops.length; i++) {
        const pos = positions[i];
        if (!pos) continue;
        const marker = new google.maps.Marker({
          map,
          position: pos,
          title: stops[i]?.title || `Stop ${i + 1}`,
          label: String(i + 1),
        });
        marker.addListener("click", () => {
          setHighlightedIndex(i);
          const event = eventsForDate.find((e) => e.id === stops[i]?.eventId);
          if (event) onSelectEvent(event);
        });
        markersRef.current.push(marker);
      }
    }

    if (map && route.path.length > 1) {
      polylineRef.current = new google.maps.Polyline({
        map,
        path: route.path,
        geodesic: false,
        strokeColor: "#22c55e",
        strokeOpacity: 0.9,
        strokeWeight: 4,
      });
    }

    return () => {
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      if (polylineRef.current) {
        polylineRef.current.setMap(null);
        polylineRef.current = null;
      }
    };
  }, [open, mapLoaded, route, selectedStops, eventsForDate, onSelectEvent]);

  const handleSelectStop = (index: number) => {
    setHighlightedIndex(index);
    const stops = route?.stops || selectedStops;
    const event = eventsForDate.find((e) => e.id === stops[index]?.eventId);
    if (event) onSelectEvent(event);
    const pos = stopPositionsRef.current[index];
    if (pos && mapInstanceRef.current) mapInstanceRef.current.panTo(pos);
  };

  const stops = route?.stops || selectedStops;

  const timeDisplay = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Phoenix", hour: "numeric", minute: "2-digit" });

  const warningForStop = (index: number) =>
    route?.warnings.filter((w) => w.toStopIndex === index) || [];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="flex h-full w-full flex-col bg-white shadow-2xl sm:w-[520px]">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Route className="h-5 w-5 text-green-600" />
            <h2 className="text-lg font-semibold text-gray-900">Route Planner</h2>
          </div>
          <button onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 border-b px-4 py-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Team member</label>
            <select
              value={selectedMemberId}
              onChange={(e) => setSelectedMemberId(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
            >
              <option value="" disabled>
                Select team member
              </option>
              {selectableMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Office / depot start address (optional)</label>
            <input
              type="text"
              value={startAddress}
              onChange={(e) => setStartAddress(e.target.value)}
              placeholder="Leave blank to start at first appointment"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-3">
          <div ref={mapRef} className="mb-4 h-56 w-full rounded-lg border bg-gray-100 sm:h-64" />

          {mapLoadError && (
            <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {mapLoadError}
            </div>
          )}

          {routeLoading && <div className="py-2 text-sm text-gray-500">Calculating route…</div>}

          {routeError && (
            <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {routeError}
            </div>
          )}

          {!routeLoading && stops.length === 0 && (
            <div className="py-4 text-center text-sm text-gray-500">
              No appointments for this team member on the selected date.
            </div>
          )}

          {stops.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-4 rounded bg-green-50 px-3 py-2 text-sm text-green-800">
                <Navigation className="h-4 w-4" />
                <span>
                  Total: {formatDistance(route?.totalDistanceMeters || 0)} · {" "}
                  {formatDuration(route?.totalDurationSeconds || 0)}
                </span>
              </div>

              {route?.warnings && route.warnings.length > 0 && (
                <div className="space-y-2">
                  {route.warnings.map((w, i) => (
                    <div
                      key={i}
                      className={`rounded px-3 py-2 text-sm ${
                        w.severity === "warning"
                          ? "border border-orange-200 bg-orange-50 text-orange-800"
                          : "border border-blue-200 bg-blue-50 text-blue-800"
                      }`}
                    >
                      {w.message}
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                {stops.map((stop, index) => {
                  const leg = route?.legs.find((l) => l.toStopIndex === index);
                  const warnings = warningForStop(index);
                  const isHighlighted = highlightedIndex === index;
                  const isUnmapped = stop.isUnmapped || !stop.address;
                  return (
                    <button
                      key={stop.eventId}
                      onClick={() => handleSelectStop(index)}
                      className={`w-full rounded border p-3 text-left transition-colors ${
                        isHighlighted
                          ? "border-green-500 bg-green-50"
                          : "border-gray-200 bg-white hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                            isUnmapped ? "bg-gray-400" : "bg-green-600"
                          }`}
                        >
                          {index + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">{timeDisplay(stop.start_time)}</span>
                            <span className="truncate text-sm text-gray-700">{stop.title}</span>
                          </div>
                          {stop.customerName && (
                            <div className="text-sm text-gray-600">{stop.customerName}</div>
                          )}
                          <div className="flex items-center gap-1 text-sm text-gray-500">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="truncate">
                              {stop.address || stop.location || "No address – skipped from route."}
                            </span>
                          </div>
                          {stop.jobKind && (
                            <div className="text-xs text-gray-500">{stop.jobKind}</div>
                          )}
                          {leg && !isUnmapped && (
                            <div className="mt-1 text-xs text-gray-500">
                              {leg.fromStartAddress ? "From start" : "From previous"}: {" "}
                              {formatDistance(leg.distanceMeters)} · {formatDuration(leg.durationSeconds)}
                            </div>
                          )}
                          {warnings.map((w, wi) => (
                            <div
                              key={wi}
                              className={`mt-1 text-xs ${
                                w.severity === "warning" ? "text-orange-600" : "text-blue-600"
                              }`}
                            >
                              {w.message}
                            </div>
                          ))}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
