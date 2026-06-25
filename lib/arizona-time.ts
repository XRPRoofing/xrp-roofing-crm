/**
 * Arizona Mountain Time (America/Phoenix) formatting helpers.
 * All user-facing timestamps in the CRM must use this timezone.
 */

export const AZ_TZ = "America/Phoenix" as const;

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
