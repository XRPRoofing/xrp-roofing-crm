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
