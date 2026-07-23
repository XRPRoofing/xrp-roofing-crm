/**
 * Unified numbering system for proposals and invoices.
 *
 * Both proposals and invoices share a single sequence. The authoritative
 * allocator is server-side and ATOMIC (`/api/numbering/next` →
 * `next_document_number` Postgres function), so two devices creating a document
 * at the same moment can never receive the same number. The localStorage
 * counter below is only a FALLBACK for when the server/DB is unreachable or the
 * migration hasn't been applied yet.
 *
 * IMPORTANT: a number must only be consumed when a document is actually saved —
 * never during render or when opening/resetting a form — otherwise the sequence
 * skips ahead. Call `allocateNextUnifiedNumber()` at save time.
 *
 * When an invoice is created from a proposal, it reuses the proposal's number
 * so the customer always sees one consistent reference.
 */

import { createClient } from "@/lib/supabase/client";

const COUNTER_KEY = "xrp_unified_counter";
const COUNTER_START = 3210;

/**
 * Allocate the next number for a real save. Tries the atomic server allocator
 * first (safe across devices/users); falls back to the local counter only if
 * the server is unavailable. Always keeps the local counter ahead of whatever
 * was handed out so a later fallback stays consistent.
 */
export async function allocateNextUnifiedNumber(): Promise<number> {
  try {
    const res = await fetch("/api/numbering/next", { method: "POST" });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; number?: number; seed?: number }
      | null;

    if (data?.ok && typeof data.number === "number" && Number.isFinite(data.number)) {
      // Keep the local fallback counter above the server value.
      ensureCounterAtLeast(data.number + 1);
      return data.number;
    }

    // Server reachable but allocator unavailable (e.g. migration not run yet).
    // Use the seed it computed from live data so the local number won't collide.
    if (typeof data?.seed === "number" && Number.isFinite(data.seed)) {
      ensureCounterAtLeast(data.seed);
    }
  } catch {
    // Network error — fall through to the local counter.
  }
  return getNextUnifiedNumber();
}

/**
 * Local fallback: return the next number and advance the counter. Only used
 * when the atomic server allocator is unavailable.
 */
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
 * Sync the local fallback counter from existing documents so it starts above
 * live data. Invoices are read directly; proposals/estimates live in
 * `proposal_shares` with the number inside `payload`, so they're read through
 * `/api/proposals` (service role) rather than a non-existent `proposals` table.
 * Only affects the local fallback — the server allocator seeds itself.
 */
export async function syncCounterFromDatabase(): Promise<void> {
  const nums: number[] = [];

  // Proposals/estimates via the shared API (reads proposal_shares.payload).
  try {
    const res = await fetch("/api/proposals");
    const data = (await res.json().catch(() => null)) as
      | { proposals?: { payload?: { proposalNumber?: unknown } }[] }
      | null;
    for (const row of data?.proposals || []) {
      const n = parseUnifiedNumber(String(row?.payload?.proposalNumber ?? ""));
      if (!Number.isNaN(n)) nums.push(n);
    }
  } catch {
    // ignore — fall back to whatever the local counter already has
  }

  // Invoices directly (table exists; anon read allowed).
  try {
    const supabase = createClient();
    const { data: invoices } = await supabase.from("invoices").select("invoice_number");
    if (invoices) {
      for (const inv of invoices) {
        const n = parseUnifiedNumber(String(inv.invoice_number || ""));
        if (!Number.isNaN(n)) nums.push(n);
      }
    }
  } catch {
    // Supabase unavailable — rely on localStorage counter
  }

  if (nums.length > 0) {
    ensureCounterAtLeast(Math.max(...nums) + 1);
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
