"use client";

import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import type { Customer } from "@/types/crm";

/**
 * Device-synced manual customer records.
 *
 * Manually added / edited customers used to live only in this browser's
 * localStorage, so they never appeared on other devices. They now persist in
 * the shared `customer_records` table (one row per customer) via /api/customers
 * (service role), and the Customers board subscribes to realtime so a change on
 * one device shows on every other device without a refresh. When Supabase is
 * not configured these helpers fall back to localStorage so local/dev mode
 * keeps working.
 */

export const customersTable = "customer_records";
export const customersLocalKey = "xrp-crm-customers";

export const customerSyncEnabled = hasSupabaseConfig;

function readLocal(): Customer[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(customersLocalKey) || "[]") as Customer[];
  } catch {
    return [];
  }
}

function writeLocal(customers: Customer[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(customersLocalKey, JSON.stringify(customers));
}

/** Load every shared manual customer record. */
export async function loadCustomerRecords(): Promise<Customer[]> {
  if (!hasSupabaseConfig()) return readLocal();
  try {
    const response = await fetch("/api/customers", { cache: "no-store" });
    if (!response.ok) return readLocal();
    const data = (await response.json()) as { customers?: Customer[] };
    return data.customers || [];
  } catch {
    return readLocal();
  }
}

/** Create or update one customer record (shared across devices). */
export async function upsertCustomerRecord(customer: Customer): Promise<void> {
  if (!hasSupabaseConfig()) {
    writeLocal([customer, ...readLocal().filter((item) => item.id !== customer.id)]);
    return;
  }
  try {
    await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(customer),
    });
  } catch {
    writeLocal([customer, ...readLocal().filter((item) => item.id !== customer.id)]);
  }
}

/** Delete one customer record. */
export async function deleteCustomerRecord(id: string): Promise<void> {
  if (!hasSupabaseConfig()) {
    writeLocal(readLocal().filter((item) => item.id !== id));
    return;
  }
  try {
    await fetch(`/api/customers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    writeLocal(readLocal().filter((item) => item.id !== id));
  }
}

/**
 * Subscribe to realtime INSERT/UPDATE/DELETE on `customer_records`. The callback
 * fires whenever any device changes a customer. Returns an unsubscribe fn.
 */
export function subscribeToCustomerRecords(onChange: () => void): () => void {
  if (!hasSupabaseConfig()) return () => {};
  const supabase = createClient();
  const channel = supabase.channel("customer-records-sync");
  channel.on(
    "postgres_changes",
    { event: "*", schema: "public", table: customersTable },
    () => onChange(),
  );
  channel.subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
