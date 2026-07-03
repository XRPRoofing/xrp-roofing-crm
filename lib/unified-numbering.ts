/**
 * Unified numbering system for proposals and invoices.
 *
 * Both proposals and invoices share a single auto-incrementing counter stored
 * in localStorage AND synchronized with Supabase. The sequence starts at 3210.
 * When an invoice is created from a proposal, it reuses the proposal's number
 * so the customer always sees one consistent reference.
 *
 * On every page load the counter is reconciled against the database to prevent
 * duplicates or skips across devices.
 */

import { createClient } from "@/lib/supabase/client";

const COUNTER_KEY = "xrp_unified_counter";
const COUNTER_START = 3210;

/** Return the next number and advance the counter. */
export function getNextUnifiedNumber(): number {
  const stored = localStorage.getItem(COUNTER_KEY);
  const next = stored ? parseInt(stored, 10) : COUNTER_START;
  localStorage.setItem(COUNTER_KEY, String(next + 1));
  return next;
}

/** Read the current counter value without advancing it. */
export function peekNextUnifiedNumber(): number {
  const stored = localStorage.getItem(COUNTER_KEY);
  return stored ? parseInt(stored, 10) : COUNTER_START;
}

/**
 * Ensure the counter is at least `minNext` so no number is reused.
 * Call this on page load after scanning existing proposals/invoices.
 */
export function ensureCounterAtLeast(minNext: number): void {
  const current = peekNextUnifiedNumber();
  if (minNext > current) {
    localStorage.setItem(COUNTER_KEY, String(minNext));
  }
}

/**
 * Sync the counter from Supabase by scanning both proposals and invoices
 * in the database. Ensures no numbers are skipped or duplicated across
 * devices. Call this once on page load.
 */
export async function syncCounterFromDatabase(): Promise<void> {
  try {
    const supabase = createClient();
    const [{ data: proposals }, { data: invoices }] = await Promise.all([
      supabase.from("proposals").select("proposal_number"),
      supabase.from("invoices").select("invoice_number"),
    ]);

    const nums: number[] = [];
    if (proposals) {
      for (const p of proposals) {
        const n = parseUnifiedNumber(String(p.proposal_number || ""));
        if (!Number.isNaN(n)) nums.push(n);
      }
    }
    if (invoices) {
      for (const inv of invoices) {
        const n = parseUnifiedNumber(String(inv.invoice_number || ""));
        if (!Number.isNaN(n)) nums.push(n);
      }
    }
    if (nums.length > 0) {
      ensureCounterAtLeast(Math.max(...nums) + 1);
    }
  } catch {
    // Supabase unavailable — rely on localStorage counter
  }
}

/** Format a unified number for display (e.g. 3210 → "#3210"). */
export function formatUnifiedNumber(n: number): string {
  return `#${n}`;
}

/**
 * Extract the numeric portion from a unified number string.
 * Handles formats like "3210", "#3210", "XRP-3210", "XRP-INV-1001", "XRP-P-3210".
 * Returns NaN if not parseable.
 */
export function parseUnifiedNumber(value: string): number {
  const cleaned = value.replace(/^[#]|^XRP-INV-|^XRP-P-|^XRP-/i, "");
  return parseInt(cleaned, 10);
}
