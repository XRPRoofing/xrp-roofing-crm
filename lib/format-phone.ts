/**
 * Phone number formatting utility that preserves cursor position.
 * Formats as (XXX) XXX-XXXX for US numbers.
 */

const DIGITS_ONLY = /\D/g;

/** Strip all non-digit characters from a string. */
export function digitsOnly(value: string): string {
  return value.replace(DIGITS_ONLY, "");
}

/** Format a digits-only string as (XXX) XXX-XXXX. */
export function formatPhoneDisplay(digits: string): string {
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

/**
 * Handle phone input change while preserving a stable cursor position.
 * Returns { formatted, cursorPos } so the caller can set both the value and
 * the cursor position in the input element.
 */
export function handlePhoneChange(
  newRawValue: string,
  prevFormatted: string,
  selectionStart: number | null,
): { formatted: string; cursorPos: number } {
  const digits = digitsOnly(newRawValue).slice(0, 10);
  const formatted = formatPhoneDisplay(digits);

  // Calculate where the cursor should be after formatting.
  // Count how many digits are before the cursor in the raw input.
  const cursorInRaw = selectionStart ?? newRawValue.length;
  let digitsBeforeCursor = 0;
  for (let i = 0; i < cursorInRaw && i < newRawValue.length; i++) {
    if (/\d/.test(newRawValue[i])) digitsBeforeCursor++;
  }

  // Find the position in the formatted string that corresponds to that digit count.
  let cursorPos = 0;
  let counted = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (counted === digitsBeforeCursor) { cursorPos = i; break; }
    if (/\d/.test(formatted[i])) counted++;
    cursorPos = i + 1;
  }

  return { formatted, cursorPos };
}
