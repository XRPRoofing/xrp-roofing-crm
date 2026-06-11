"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { MapPin, X } from "lucide-react";

// Inline type definitions for Google Maps API (avoids @types/google.maps dependency)
interface GoogleAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface GooglePlaceGeometry {
  location?: {
    lat: () => number;
    lng: () => number;
  };
}

interface GooglePlaceResult {
  formatted_address?: string;
  address_components?: GoogleAddressComponent[];
  geometry?: GooglePlaceGeometry;
}

interface GoogleAutocomplete {
  addListener: (event: string, callback: () => void) => void;
  getPlace: () => GooglePlaceResult;
}

interface GoogleLatLng {
  lat: () => number;
  lng: () => number;
}

interface GoogleLatLngBounds {
  constructor: (sw: GoogleLatLng, ne: GoogleLatLng) => void;
}

declare global {
  interface Window {
    google?: {
      maps: {
        places: {
          Autocomplete: new (
            input: HTMLInputElement,
            options?: {
              bounds?: unknown;
              componentRestrictions?: { country: string | string[] };
              fields?: string[];
              strictBounds?: boolean;
              types?: string[];
            }
          ) => GoogleAutocomplete;
        };
        LatLngBounds: new (sw: { lat: number; lng: number }, ne: { lat: number; lng: number }) => unknown;
        LatLng: new (lat: number, lng: number) => { lat: () => number; lng: () => number };
      };
    };
  }
}

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
  // Optional: also update individual fields
  onAddressParsed?: (data: AddressData) => void;
};

const arizonaBounds = {
  north: 37.0,
  south: 31.0,
  east: -109.0,
  west: -114.8,
};

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
  const autocompleteRef = useRef<GoogleAutocomplete | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Parse address components from Google Places result
  const parseAddressComponents = useCallback((
    place: GooglePlaceResult
  ): AddressData => {
    const components = place.address_components || [];
    
    let streetNumber = "";
    let streetName = "";
    let city = "";
    let state = "";
    let zipCode = "";
    let country = "";

    for (const component of components) {
      const types = component.types;
      
      if (types.includes("street_number")) {
        streetNumber = component.long_name;
      }
      if (types.includes("route")) {
        streetName = component.long_name;
      }
      if (types.includes("locality") || types.includes("sublocality")) {
        city = component.long_name;
      }
      if (types.includes("administrative_area_level_1")) {
        state = component.short_name;
      }
      if (types.includes("postal_code")) {
        zipCode = component.long_name;
      }
      if (types.includes("country")) {
        country = component.short_name;
      }
    }

    const streetAddress = `${streetNumber} ${streetName}`.trim();
    const formattedAddress = place.formatted_address || streetAddress;

    // Get lat/lng if available
    const geometry = place.geometry;
    const latitude = geometry?.location?.lat?.();
    const longitude = geometry?.location?.lng?.();

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
  }, []);

  // Initialize Google Places Autocomplete
  useEffect(() => {
    const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    
    if (!googleMapsApiKey) {
      setHasError(true);
      return;
    }

    // Check if Google Maps is already loaded
    if (window.google?.maps?.places?.Autocomplete) {
      setIsLoaded(true);
      return;
    }

    // Load Google Maps script
    const scriptId = "google-maps-script";
    if (document.getElementById(scriptId)) {
      // Script already loading, wait for it
      const checkLoaded = setInterval(() => {
        if (window.google?.maps?.places?.Autocomplete) {
          setIsLoaded(true);
          clearInterval(checkLoaded);
        }
      }, 100);
      return () => clearInterval(checkLoaded);
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${googleMapsApiKey}&libraries=places&loading=async`;
    script.async = true;
    script.defer = true;
    
    script.onload = () => {
      setIsLoaded(true);
      setHasError(false);
    };
    
    script.onerror = () => {
      setHasError(true);
    };

    document.head.appendChild(script);

    return () => {
      // Don't remove script on unmount as other components may need it
    };
  }, []);

  // Setup autocomplete when loaded
  useEffect(() => {
    if (!isLoaded || !inputRef.current || autocompleteRef.current) return;

    if (!window.google?.maps) return;

    try {
      const GoogleMaps = window.google.maps;
      const autocomplete = new GoogleMaps.places.Autocomplete(
        inputRef.current,
        {
          bounds: new GoogleMaps.LatLngBounds(
            { lat: arizonaBounds.south, lng: arizonaBounds.west },
            { lat: arizonaBounds.north, lng: arizonaBounds.east }
          ),
          componentRestrictions: { country: "us" },
          fields: ["formatted_address", "address_components", "geometry"],
          strictBounds: false,
        }
      );

      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        
        if (!place.formatted_address) {
          // User pressed Enter without selecting a suggestion
          return;
        }

        const addressData = parseAddressComponents(place);
        
        // Call onChange with formatted address and full data
        onChange(addressData.formattedAddress, addressData);
        
        // Also call onAddressParsed if provided
        if (onAddressParsed) {
          onAddressParsed(addressData);
        }
      });

      autocompleteRef.current = autocomplete;
    } catch (error) {
      console.error("Failed to initialize autocomplete:", error);
      setHasError(true);
    }
  }, [isLoaded, onChange, onAddressParsed, parseAddressComponents]);

  const handleClear = () => {
    onChange("");
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  return (
    <div className="relative">
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
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
      {hasError && (
        <p className="mt-1 text-xs text-amber-600">
          Address autocomplete unavailable. Please type the full address manually.
        </p>
      )}
    </div>
  );
}

// Hook to use address autocomplete in forms
export function useAddressAutocomplete(
  initialValue = "",
  onAddressChange?: (data: AddressData) => void
) {
  const [address, setAddress] = useState(initialValue);
  const [parsedData, setParsedData] = useState<AddressData | null>(null);

  const handleAddressChange = useCallback((
    newAddress: string,
    fullData?: AddressData
  ) => {
    setAddress(newAddress);
    if (fullData) {
      setParsedData(fullData);
      onAddressChange?.(fullData);
    }
  }, [onAddressChange]);

  return {
    address,
    setAddress,
    parsedData,
    handleAddressChange,
  };
}

export default AddressAutocomplete;
