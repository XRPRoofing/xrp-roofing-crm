"use client";

/**
 * Persistent conversation contact edits — synced via Supabase so every device
 * sees the same customer name for a phone number. Falls back to localStorage
 * when Supabase is not configured.
 *
 * Also provides phone → customer database auto-matching so known customers
 * display their name automatically in the Conversations Board.
 */

import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import type { Customer } from "@/types/crm";
import type { ConversationContact } from "@/types/conversations";

// ── Types ────────────────────────────────────────────────────────────────────

export type ContactEdit = Partial<ConversationContact> & { phone: string };

// ── Supabase table ───────────────────────────────────────────────────────────

const TABLE = "conversation_contacts";
const LOCAL_KEY = "crm-conversation-contact-edits";

// ── Normalize phone for matching ─────────────────────────────────────────────

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function normalizePhone(value: string) {
  const d = digits(value);
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d;
}

// ── Load all saved contact edits ─────────────────────────────────────────────

function readLocal(): Record<string, ContactEdit> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(LOCAL_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeLocal(edits: Record<string, ContactEdit>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(edits));
  } catch { /* ignore */ }
}

/**
 * Load all saved conversation contact edits from Supabase. Returns a map
 * keyed by conversation ID (e.g. "phone-6025551234").
 */
export async function loadContactEdits(): Promise<Record<string, ContactEdit>> {
  if (!hasSupabaseConfig()) return readLocal();
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("conversation_id, payload");
    if (error) return readLocal();
    const result: Record<string, ContactEdit> = {};
    for (const row of (data || []) as { conversation_id: string; payload: ContactEdit }[]) {
      result[row.conversation_id] = row.payload;
    }
    return result;
  } catch {
    return readLocal();
  }
}

/**
 * Save a contact edit for a specific conversation. Persists to both Supabase
 * (cross-device) and localStorage (fallback).
 */
export async function saveContactEdit(conversationId: string, edit: ContactEdit): Promise<void> {
  // Always keep localStorage in sync as fallback
  const local = readLocal();
  local[conversationId] = { ...(local[conversationId] || {} as ContactEdit), ...edit };
  writeLocal(local);

  if (!hasSupabaseConfig()) return;
  try {
    const supabase = createClient();
    await supabase
      .from(TABLE)
      .upsert(
        {
          conversation_id: conversationId,
          phone: normalizePhone(edit.phone),
          payload: local[conversationId],
          updated_at: new Date().toISOString(),
        },
        { onConflict: "conversation_id" },
      );
  } catch { /* localStorage fallback already saved */ }
}

// ── Subscribe to real-time contact edits ─────────────────────────────────────

let contactChannel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
const contactListeners = new Set<() => void>();

export function subscribeToContactEdits(onChange: () => void): () => void {
  if (!hasSupabaseConfig()) return () => {};

  contactListeners.add(onChange);

  if (!contactChannel) {
    const supabase = createClient();
    contactChannel = supabase
      .channel("crm-conversation-contacts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: TABLE },
        () => { contactListeners.forEach((listener) => listener()); },
      )
      .subscribe();
  }

  return () => {
    contactListeners.delete(onChange);
    if (contactListeners.size === 0 && contactChannel) {
      contactChannel.unsubscribe();
      contactChannel = null;
    }
  };
}

// ── Customer database phone matching ─────────────────────────────────────────

/**
 * Fetch all customers from the shared customer_records table via the
 * /api/customers endpoint. Returns an empty array on failure.
 */
export async function loadLiveCustomers(): Promise<Customer[]> {
  try {
    const response = await fetch("/api/customers", { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as { customers?: Customer[] };
    return data.customers || [];
  } catch {
    return [];
  }
}

/**
 * Build a phone-digits → Customer lookup map.
 */
export function buildPhoneLookup(customers: Customer[]): Map<string, Customer> {
  const map = new Map<string, Customer>();
  for (const customer of customers) {
    if (customer.phone) {
      const norm = normalizePhone(customer.phone);
      if (norm) map.set(norm, customer);
    }
  }
  return map;
}

/**
 * Find a matching customer for a phone number.
 */
export function matchCustomerByPhone(phone: string, lookup: Map<string, Customer>): Customer | null {
  const norm = normalizePhone(phone);
  return norm ? (lookup.get(norm) || null) : null;
}
