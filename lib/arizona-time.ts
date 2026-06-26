/**
 * Arizona Mountain Time (America/Phoenix) formatting helpers.
 * All user-facing timestamps in the CRM must use this timezone.
 */

export const AZ_TZ = "America/Phoenix" as const;

/**
 * Create a Date representing noon in Arizona for the given date parts.
 * Arizona is always UTC-7 (no DST), so noon AZ = 19:00 UTC.
 * month is 0-based (0 = January). Day overflow is handled by Date.UTC.
 */
export function azNoon(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 19, 0, 0));
}

const azPartsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: AZ_TZ,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  weekday: "short",
});

/** Extract Arizona date parts (year, 0-based month, day, day-of-week) from any Date. */
export function azParts(d: Date): {
  year: number;
  month: number;
  day: number;
  dow: number;
} {
  const parts = azPartsFmt.formatToParts(d);
  const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(parts.find((p) => p.type === "year")!.value),
    month: Number(parts.find((p) => p.type === "month")!.value) - 1,
    day: Number(parts.find((p) => p.type === "day")!.value),
    dow: dowNames.indexOf(
      parts.find((p) => p.type === "weekday")?.value ?? "Sun",
    ),
  };
}

/** Format a Date or ISO string to a locale string in Arizona time. */
export function azDateTime(value: string | Date, opts?: Intl.DateTimeFormatOptions): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("en-US", { timeZone: AZ_TZ, ...opts });
}

/** Format date-only in Arizona time. */
export function azDate(value: string | Date, opts?: Intl.DateTimeFormatOptions): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("en-US", { timeZone: AZ_TZ, ...opts });
}

/** Format time-only in Arizona time. */
export function azTime(value: string | Date, opts?: Intl.DateTimeFormatOptions): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleTimeString("en-US", { timeZone: AZ_TZ, ...opts });
}
