import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import type { Customer } from "@/types/crm";

/**
 * Server-side find-or-create for customers, used by lead sources that run on
 * the server (Twilio call/SMS webhooks, web form). Mirrors the client helper
 * `findOrCreateCustomer` in lib/customer-sync.ts: it matches an existing
 * customer by phone -> email -> property address and updates it, otherwise it
 * creates a new record. This guarantees no duplicate customers regardless of
 * which channel a lead arrives on. Writes go through the service role into the
 * shared `customer_records` table so every device sees the customer instantly
 * via realtime.
 */
const customersTable = "customer_records";

export type LeadContact = {
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

type CustomerRow = { id: string; payload: Customer };

const normalize = (value?: string) => (value || "").toLowerCase().trim();
const digits = (value?: string) => (value || "").replace(/\D/g, "");

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function ensureCustomerFromLeadServer(contact: LeadContact): Promise<Customer | null> {
  // Need at least one identifier to dedupe on; ignore empty inbound events.
  if (!digits(contact.phone) && !normalize(contact.email) && !normalize(contact.propertyAddress)) {
    return null;
  }
  const admin = getAdminClient();
  if (!admin) return null;

  const { data, error } = await admin.from(customersTable).select("id, payload");
  if (error) return null;
  const existing = (data as CustomerRow[])
    .map((row) => (row.payload ? { ...row.payload, id: row.id } : null))
    .filter((customer): customer is Customer => Boolean(customer));

  const phone = digits(contact.phone);
  const email = normalize(contact.email);
  const address = normalize(contact.propertyAddress);
  const match =
    (phone && existing.find((customer) => digits(customer.phone) === phone)) ||
    (email && existing.find((customer) => normalize(customer.email) === email)) ||
    (address && existing.find((customer) => normalize(customer.propertyAddress) === address)) ||
    null;

  const merged: Customer = match
    ? {
        ...match,
        name: match.name || contact.name || "New customer",
        email: match.email || contact.email || "",
        phone: match.phone || contact.phone || "",
        propertyAddress: match.propertyAddress || contact.propertyAddress || "",
        roofDetails: match.roofDetails || contact.roofDetails || "",
        insuranceCarrier: match.insuranceCarrier || contact.insuranceCarrier || "",
        status: match.status || contact.status || "New customer",
        lifetimeValue: contact.lifetimeValue ?? match.lifetimeValue ?? 0,
      }
    : {
        id: `C-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: contact.name || "New customer",
        email: contact.email || "",
        phone: contact.phone || "",
        propertyAddress: contact.propertyAddress || "",
        roofDetails: contact.roofDetails || "",
        insuranceCarrier: contact.insuranceCarrier || "",
        status: contact.status || "New lead",
        lifetimeValue: contact.lifetimeValue || 0,
      };

  const { error: upsertError } = await admin
    .from(customersTable)
    .upsert({ id: merged.id, payload: merged, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (upsertError) return null;
  return merged;
}
