"use client";

import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";

/**
 * Supabase-backed invoice payment sync.
 *
 * The Stripe webhook (/api/stripe/webhook) and view tracker
 * (/api/invoices/track) write payment + tracking state into the
 * `invoice_shares` table. The Admin Invoice Board subscribes here so those
 * Stripe-driven updates appear in real time without a refresh. When Supabase is
 * not configured these helpers no-op gracefully and the board keeps working off
 * localStorage.
 */

export const invoiceSharesTable = "invoice_shares";

export type InvoiceSharePayment = {
  amount: number;
  date: string;
  method: string;
  reference: string;
  notes: string;
  offline: boolean;
};

export type InvoiceSharePayload = {
  id: string;
  payments?: InvoiceSharePayment[];
  status?: string;
  activity?: string[];
  viewedAt?: string;
  paidAt?: string;
  failedAt?: string;
  sentAt?: string;
  sentBy?: string;
  emailDeliveredAt?: string;
  emailOpenedAt?: string;
};

type InvoiceShareRow = { id: string; payload: InvoiceSharePayload };

export const invoiceSyncEnabled = hasSupabaseConfig;

/**
 * Push the full invoice record to Supabase so every device sees creates/edits.
 * No-ops gracefully when Supabase is not configured.
 */
export async function upsertInvoiceRecord(invoice: Record<string, unknown> & { id: string }): Promise<void> {
  if (!hasSupabaseConfig()) return;
  try {
    await fetch("/api/invoices/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(invoice),
    });
  } catch {
    /* network error — local copy is the fallback */
  }
}

/**
 * Remove an invoice from Supabase so all devices see the deletion.
 * No-ops gracefully when Supabase is not configured.
 */
export async function deleteInvoiceRecord(id: string): Promise<void> {
  if (!hasSupabaseConfig()) return;
  try {
    await fetch(`/api/invoices/share?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    /* ignore; realtime / focus-reload reconciles */
  }
}

/**
 * Load ALL full invoice records from Supabase (seeded on mount so every device
 * sees invoices created on other devices, not just payment/tracking updates).
 * Returns [] when Supabase is not configured.
 */
export async function loadAllInvoices<T extends { id: string }>(): Promise<T[]> {
  if (!hasSupabaseConfig()) return [];
  try {
    const response = await fetch("/api/invoices/share", { cache: "no-store" });
    if (!response.ok) return [];
    const data = (await response.json()) as { invoices?: T[] };
    return data.invoices ?? [];
  } catch {
    return [];
  }
}

/** Load every shared invoice payload (id + payment/tracking state). */
export async function loadInvoiceShares(): Promise<InvoiceSharePayload[]> {
  if (!hasSupabaseConfig()) return [];

  const supabase = createClient();
  const { data, error } = await supabase.from(invoiceSharesTable).select("id, payload");
  if (error || !data) return [];

  return (data as InvoiceShareRow[])
    .map((row) => (row.payload ? { ...row.payload, id: row.id } : null))
    .filter((payload): payload is InvoiceSharePayload => Boolean(payload));
}

/**
 * Subscribe to realtime INSERT/UPDATE/DELETE on `invoice_shares`. The callback
 * fires with the changed payload whenever Stripe (or any client) updates an
 * invoice. Returns an unsubscribe function.
 */
export function subscribeToInvoiceShares(onChange: (payload: InvoiceSharePayload) => void): () => void {
  if (!hasSupabaseConfig()) return () => {};

  const supabase = createClient();
  const channel = supabase.channel("invoice-shares-sync");
  channel.on(
    "postgres_changes",
    { event: "*", schema: "public", table: invoiceSharesTable },
    (message) => {
      const row = (message.new || message.old) as InvoiceShareRow | undefined;
      if (row?.payload) onChange({ ...row.payload, id: row.id });
    },
  );
  channel.subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
