import { toE164 } from "@/lib/twilio/config";

export interface TwilioLine {
  key: string;
  label: string;
  number: string;
  leadSource: string;
}

/**
 * Build the list of configured Twilio lines from environment variables.
 *
 * Server-side: reads TWILIO_PHONE_NUMBER, TWILIO_PARTNER_REFERRAL_NUMBER, …
 * Client-side: reads NEXT_PUBLIC_TWILIO_PHONE_NUMBER, NEXT_PUBLIC_TWILIO_PARTNER_REFERRAL_NUMBER, …
 *
 * To add a new line, add its env vars and a new entry to this array.
 */
export function getTwilioLines(): TwilioLine[] {
  const lines: TwilioLine[] = [];

  const mainNumber = toE164(
    process.env.TWILIO_PHONE_NUMBER ||
    process.env.NEXT_PUBLIC_TWILIO_PHONE_NUMBER ||
    ""
  );
  if (mainNumber) {
    lines.push({ key: "main", label: "Main Line", number: mainNumber, leadSource: "Inbound" });
  }

  const partnerNumber = toE164(
    process.env.TWILIO_PARTNER_REFERRAL_NUMBER ||
    process.env.NEXT_PUBLIC_TWILIO_PARTNER_REFERRAL_NUMBER ||
    ""
  );
  if (partnerNumber) {
    lines.push({ key: "partner_referral", label: "Partner Referral", number: partnerNumber, leadSource: "Partner Referral" });
  }

  const line3Number = toE164(
    process.env.TWILIO_PHONE_NUMBER_3 ||
    process.env.NEXT_PUBLIC_TWILIO_PHONE_NUMBER_3 ||
    ""
  );
  if (line3Number) {
    lines.push({ key: "line_3", label: "Line 3", number: line3Number, leadSource: "Line 3" });
  }

  return lines;
}

/**
 * Find the TwilioLine matching a phone number (E.164 or raw).
 * Returns undefined when the number doesn't match any configured line.
 */
export function findTwilioLine(phone: string): TwilioLine | undefined {
  if (!phone) return undefined;
  const normalized = toE164(phone);
  if (!normalized) return undefined;
  return getTwilioLines().find((line) => line.number === normalized);
}

/**
 * Get the lead-source label for an inbound number.
 * Falls back to a generic label based on the event type when no line matches.
 */
export function getLeadSourceForNumber(toNumber: string, fallback: string): string {
  const line = findTwilioLine(toNumber);
  return line ? line.leadSource : fallback;
}

/**
 * Get the human-readable line label for display (badges, etc.).
 * Returns empty string when the number doesn't match any configured line.
 */
export function getLineLabelForNumber(phone: string): string {
  const line = findTwilioLine(phone);
  return line?.label || "";
}

/**
 * Resolve which Twilio number to use as the "from" for outbound messages/calls.
 * If the requested number matches a configured line, use it; otherwise default
 * to the first configured line (Main Line).
 */
export function resolveFromNumber(requestedFrom?: string): string {
  const lines = getTwilioLines();
  if (!lines.length) return "";
  if (requestedFrom) {
    const normalized = toE164(requestedFrom);
    const match = lines.find((line) => line.number === normalized);
    if (match) return match.number;
  }
  return lines[0].number;
}
