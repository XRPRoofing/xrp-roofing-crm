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

/** Contact details from any lead source used to find-or-create a customer. */
export type CustomerLeadInput = {
  name?: string;
  email?: string;
  phone?: string;
  propertyAddress?: string;
  roofDetails?: string;
  insuranceCarrier?: string;
  status?: string;
  lifetimeValue?: number;
  source?: string;
};

function normalizeText(value?: string) {
  return (value || "").toLowerCase().trim();
}

function digitsOnly(value?: string) {
  return (value || "").replace(/\D/g, "");
}

/** Match an existing customer by phone, then email, then property address. */
function matchExistingCustomer(existing: Customer[], input: CustomerLeadInput): Customer | undefined {
  const phone = digitsOnly(input.phone);
  if (phone) {
    const byPhone = existing.find((customer) => digitsOnly(customer.phone) === phone);
    if (byPhone) return byPhone;
  }
  const email = normalizeText(input.email);
  if (email) {
    const byEmail = existing.find((customer) => normalizeText(customer.email) === email);
    if (byEmail) return byEmail;
  }
  const address = normalizeText(input.propertyAddress);
  if (address) {
    const byAddress = existing.find((customer) => normalizeText(customer.propertyAddress) === address);
    if (byAddress) return byAddress;
  }
  return undefined;
}

/**
 * Find-or-create the customer for an incoming lead from any source
 * (manual entry, conversations, calls, SMS, web form, estimates, CSV import).
 *
 * Matches an existing customer by phone -> email -> property address. If found,
 * fills in any blanks and updates the record; otherwise creates a new one. This
 * is the single choke point that guarantees no duplicate customers and that
 * every lead lands on the shared Customers board across all devices.
 */
export async function findOrCreateCustomer(input: CustomerLeadInput): Promise<Customer> {
  const existing = await loadCustomerRecords();
  const match = matchExistingCustomer(existing, input);

  const merged: Customer = match
    ? {
        ...match,
        name: match.name || input.name || "New customer",
        email: match.email || input.email || "",
        phone: match.phone || input.phone || "",
        propertyAddress: match.propertyAddress || input.propertyAddress || "",
        roofDetails: match.roofDetails || input.roofDetails || "",
        insuranceCarrier: match.insuranceCarrier || input.insuranceCarrier || "",
        status: match.status || input.status || "New customer",
        lifetimeValue: input.lifetimeValue ?? match.lifetimeValue ?? 0,
      }
    : {
        id: `C-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: input.name || "New customer",
        email: input.email || "",
        phone: input.phone || "",
        propertyAddress: input.propertyAddress || "",
        roofDetails: input.roofDetails || "",
        insuranceCarrier: input.insuranceCarrier || "",
        status: input.status || "New lead",
        lifetimeValue: input.lifetimeValue || 0,
      };

  await upsertCustomerRecord(merged);
  return merged;
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
