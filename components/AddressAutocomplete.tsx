"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { MapPin, X } from "lucide-react";

/* ── Inline Google Maps type definitions ─────────────────────────── */

interface GoogleAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface GooglePlaceGeometry {
  location?: { lat: () => number; lng: () => number };
}

interface GooglePlaceResult {
  formatted_address?: string;
  address_components?: GoogleAddressComponent[];
  geometry?: GooglePlaceGeometry;
}

interface AutocompletePrediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

interface AutocompleteService {
  getPlacePredictions: (
    request: {
      input: string;
      componentRestrictions?: { country: string | string[] };
      locationBias?: unknown;
      types?: string[];
    },
    callback: (
      predictions: AutocompletePrediction[] | null,
      status: string
    ) => void
  ) => void;
}

interface PlacesService {
  getDetails: (
    request: { placeId: string; fields: string[] },
    callback: (
      result: GooglePlaceResult | null,
      status: string
    ) => void
  ) => void;
}

declare global {
  interface Window {
    google?: {
      maps: {
        places: {
          Autocomplete: unknown;
          AutocompleteService: new () => AutocompleteService;
          PlacesService: new (
            div: HTMLDivElement
          ) => PlacesService;
          PlacesServiceStatus: { OK: string };
        };
        LatLngBounds: new (
          sw: { lat: number; lng: number },
          ne: { lat: number; lng: number }
        ) => unknown;
        LatLng: new (
          lat: number,
          lng: number
        ) => { lat: () => number; lng: () => number };
      };
    };
  }
}

/* ── Exported types ──────────────────────────────────────────────── */

export type AddressData = {
  formattedAddress: string;
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  latitude?: number;
  longitude?: number;
};

type AddressAutocompleteProps = {
  value: string;
  onChange: (address: string, fullData?: AddressData) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  name?: string;
  onAddressParsed?: (data: AddressData) => void;
};

/* ── Component ───────────────────────────────────────────────────── */

export function AddressAutocomplete({
  value,
  onChange,
  placeholder = "Start typing address...",
  className = "",
  required = false,
  disabled = false,
  autoFocus = false,
  id,
  name,
  onAddressParsed,
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const attrDivRef = useRef<HTMLDivElement | null>(null);
  const serviceRef = useRef<AutocompleteService | null>(null);
  const placesRef = useRef<PlacesService | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [predictions, setPredictions] = useState<AutocompletePrediction[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Keep latest callbacks in refs to avoid stale closures
  const onChangeRef = useRef(onChange);
  const onAddressParsedRef = useRef(onAddressParsed);
  useEffect(() => {
    onChangeRef.current = onChange;
    onAddressParsedRef.current = onAddressParsed;
  });

  /* ── Parse Google place result ──────────────────────────────────── */
  const parseAddressComponents = useCallback(
    (place: GooglePlaceResult): AddressData => {
      const components = place.address_components || [];
      let streetNumber = "";
      let streetName = "";
      let city = "";
      let state = "";
      let zipCode = "";
      let country = "";

      for (const component of components) {
        const types = component.types;
        if (types.includes("street_number")) streetNumber = component.long_name;
        if (types.includes("route")) streetName = component.long_name;
        if (types.includes("locality") || types.includes("sublocality"))
          city = component.long_name;
        if (types.includes("administrative_area_level_1"))
          state = component.short_name;
        if (types.includes("postal_code")) zipCode = component.long_name;
        if (types.includes("country")) country = component.short_name;
      }

      const streetAddress = `${streetNumber} ${streetName}`.trim();
      const formattedAddress = place.formatted_address || streetAddress;
      const latitude = place.geometry?.location?.lat?.();
      const longitude = place.geometry?.location?.lng?.();

      return {
        formattedAddress,
        streetAddress,
        city,
        state,
        zipCode,
        country,
        latitude,
        longitude,
      };
    },
    []
  );

  /* ── Load Google Maps script ────────────────────────────────────── */
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      queueMicrotask(() => setHasError(true));
      return;
    }

    if (window.google?.maps?.places?.AutocompleteService) {
      const ready = true;
      queueMicrotask(() => setIsLoaded(ready));
      return;
    }

    const scriptId = "google-maps-script";
    const poll = () => {
      const iv = setInterval(() => {
        if (window.google?.maps?.places?.AutocompleteService) {
          clearInterval(iv);
          queueMicrotask(() => setIsLoaded(true));
        }
      }, 100);
      const timeout = setTimeout(() => {
        clearInterval(iv);
        if (!window.google?.maps?.places?.AutocompleteService)
          queueMicrotask(() => setHasError(true));
      }, 10000);
      return () => {
        clearInterval(iv);
        clearTimeout(timeout);
      };
    };

    if (document.getElementById(scriptId)) return poll();

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => poll();
    script.onerror = () => setHasError(true);
    document.head.appendChild(script);
  }, []);

  /* ── Initialize services once loaded ────────────────────────────── */
  useEffect(() => {
    if (!isLoaded || serviceRef.current) return;
    const gm = window.google?.maps?.places;
    if (!gm) return;

    try {
      serviceRef.current = new gm.AutocompleteService();
      const div = document.createElement("div");
      attrDivRef.current = div;
      placesRef.current = new gm.PlacesService(div);
    } catch {
      queueMicrotask(() => setHasError(true));
    }

    return () => {
      attrDivRef.current = null;
    };
  }, [isLoaded]);

  /* ── Fetch predictions as user types ────────────────────────────── */
  const fetchPredictions = useCallback(
    (input: string) => {
      if (!serviceRef.current || input.length < 3) {
        setPredictions([]);
        setShowDropdown(false);
        return;
      }

      serviceRef.current.getPlacePredictions(
        {
          input,
          componentRestrictions: { country: "us" },
          types: ["address"],
        },
        (results, status) => {
          if (
            status ===
              (window.google?.maps?.places?.PlacesServiceStatus?.OK ?? "OK") &&
            results
          ) {
            setPredictions(results);
            setShowDropdown(true);
            setActiveIndex(-1);
          } else {
            setPredictions([]);
            setShowDropdown(false);
          }
        }
      );
    },
    []
  );

  /* ── Select a prediction ────────────────────────────────────────── */
  const selectPrediction = useCallback(
    (prediction: AutocompletePrediction) => {
      setShowDropdown(false);
      setPredictions([]);

      if (!placesRef.current) {
        onChangeRef.current(prediction.description);
        return;
      }

      placesRef.current.getDetails(
        {
          placeId: prediction.place_id,
          fields: ["formatted_address", "address_components", "geometry"],
        },
        (result, status) => {
          if (
            status ===
              (window.google?.maps?.places?.PlacesServiceStatus?.OK ?? "OK") &&
            result
          ) {
            const data = parseAddressComponents(result);
            onChangeRef.current(data.formattedAddress, data);
            onAddressParsedRef.current?.(data);
          } else {
            onChangeRef.current(prediction.description);
          }
        }
      );
    },
    [parseAddressComponents]
  );

  /* ── Input change handler ───────────────────────────────────────── */
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      onChangeRef.current(val);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchPredictions(val), 250);
    },
    [fetchPredictions]
  );

  /* ── Keyboard navigation ────────────────────────────────────────── */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showDropdown || predictions.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i < predictions.length - 1 ? i + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i > 0 ? i - 1 : predictions.length - 1));
      } else if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        selectPrediction(predictions[activeIndex]);
      } else if (e.key === "Escape") {
        setShowDropdown(false);
      }
    },
    [showDropdown, predictions, activeIndex, selectPrediction]
  );

  /* ── Close dropdown on outside click ────────────────────────────── */
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  /* ── Clear ──────────────────────────────────────────────────────── */
  const handleClear = () => {
    onChangeRef.current("");
    setPredictions([]);
    setShowDropdown(false);
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (predictions.length > 0) setShowDropdown(true);
          }}
          placeholder={placeholder}
          required={required}
          disabled={disabled || hasError}
          autoFocus={autoFocus}
          id={id}
          name={name}
          className={`
            w-full rounded-xl border border-slate-200 bg-slate-50 
            pl-10 pr-8 py-2.5 text-sm font-bold 
            outline-none transition-all
            focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-50
            disabled:opacity-50 disabled:cursor-not-allowed
            ${className}
          `}
          autoComplete="off"
        />
        {value && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {showDropdown && predictions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute left-0 right-0 top-full z-[99999] mt-1 max-h-60 overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg"
        >
          {predictions.map((p, i) => (
            <button
              key={p.place_id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectPrediction(p)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm transition-colors ${
                i === activeIndex
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <span>
                <span className="font-semibold">
                  {p.structured_formatting.main_text}
                </span>{" "}
                <span className="text-slate-500">
                  {p.structured_formatting.secondary_text}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {hasError && (
        <p className="mt-1 text-xs text-amber-600">
          Address autocomplete unavailable. Please type the full address
          manually.
        </p>
      )}
    </div>
  );
}

/* ── Hook (unchanged) ────────────────────────────────────────────── */

export function useAddressAutocomplete(
  initialValue = "",
  onAddressChange?: (data: AddressData) => void
) {
  const [address, setAddress] = useState(initialValue);
  const [parsedData, setParsedData] = useState<AddressData | null>(null);

  const handleAddressChange = useCallback(
    (newAddress: string, fullData?: AddressData) => {
      setAddress(newAddress);
      if (fullData) {
        setParsedData(fullData);
        onAddressChange?.(fullData);
      }
    },
    [onAddressChange]
  );

  return { address, setAddress, parsedData, handleAddressChange };
}

export default AddressAutocomplete;
