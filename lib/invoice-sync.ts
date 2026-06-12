"use client";

import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";

/**
 * Supabase-backed invoice sync using dedicated invoices table.
 * Full real-time synchronization across all devices.
 */

export const invoicesTable = "invoices";

// Legacy table for payment/tracking updates from Stripe
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

// Map app invoice to database row format
function invoiceToRow(invoice: Record<string, unknown>) {
  return {
    id: invoice.id,
    invoice_number: invoice.invoiceNumber || invoice.invoice_number || invoice.id,
    client_name: invoice.clientName || invoice.client_name || "",
    client_email: invoice.clientEmail || invoice.client_email || null,
    client_phone: invoice.clientPhone || invoice.client_phone || null,
    property_address: invoice.propertyAddress || invoice.property_address || null,
    property_city: invoice.propertyCity || invoice.property_city || null,
    property_state: invoice.propertyState || invoice.property_state || null,
    property_zip: invoice.propertyZip || invoice.property_zip || null,
    due_date: invoice.dueDate || invoice.due_date || new Date().toISOString().split("T")[0],
    status: invoice.status || "Draft",
    line_items: JSON.stringify(invoice.lineItems || invoice.line_items || []),
    payments: JSON.stringify(invoice.payments || []),
    subtotal: invoice.subtotal || 0,
    tax_rate: invoice.taxRate || invoice.tax_rate || 0,
    tax_amount: invoice.taxAmount || invoice.tax_amount || 0,
    discount: invoice.discount || 0,
    total: calculateTotal(invoice),
    balance: calculateBalance(invoice),
    notes: invoice.notes || null,
    payment_terms: invoice.paymentTerms || invoice.payment_terms || null,
    warranty_notes: invoice.warrantyNotes || invoice.warranty_notes || null,
    job_reference: invoice.jobReference || invoice.job_reference || null,
    sent_at: invoice.sentAt || invoice.sent_at || null,
    sent_by: invoice.sentBy || invoice.sent_by || null,
    viewed_at: invoice.viewedAt || invoice.viewed_at || null,
    paid_at: invoice.paidAt || invoice.paid_at || null,
    activity: JSON.stringify(invoice.activity || ["Invoice created"]),
    is_deleted: invoice.isDeleted || false,
    deleted_at: invoice.deletedAt || null,
  };
}

function calculateTotal(invoice: Record<string, unknown>): number {
  const lineItems = (invoice.lineItems || invoice.line_items || []) as Array<{ unitPrice: number; quantity: number; tax?: number }>;
  const subtotal = lineItems.reduce((sum, item) => sum + (item.unitPrice || 0) * (item.quantity || 0), 0);
  const taxRate = (invoice.taxRate || invoice.tax_rate || 0) as number;
  const taxAmount = subtotal * (taxRate / 100);
  const discount = (invoice.discount || 0) as number;
  return subtotal + taxAmount - discount;
}

function calculateBalance(invoice: Record<string, unknown>): number {
  const total = calculateTotal(invoice);
  const payments = (invoice.payments || []) as Array<{ amount: number }>;
  const paid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  return Math.max(total - paid, 0);
}

// Map database row back to app format
function rowToInvoice(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientPhone: row.client_phone,
    propertyAddress: row.property_address,
    propertyCity: row.property_city,
    propertyState: row.property_state,
    propertyZip: row.property_zip,
    dueDate: row.due_date,
    status: row.status,
    lineItems: safeJsonParse(row.line_items, []),
    payments: safeJsonParse(row.payments, []),
    subtotal: row.subtotal,
    taxRate: row.tax_rate,
    taxAmount: row.tax_amount,
    discount: row.discount,
    total: row.total,
    balance: row.balance,
    notes: row.notes,
    paymentTerms: row.payment_terms,
    warrantyNotes: row.warranty_notes,
    jobReference: row.job_reference,
    sentAt: row.sent_at,
    sentBy: row.sent_by,
    viewedAt: row.viewed_at,
    paidAt: row.paid_at,
    activity: safeJsonParse(row.activity, ["Invoice created"]),
    isDeleted: row.is_deleted,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeJsonParse(value: unknown, fallback: unknown): unknown {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value as string);
  } catch {
    return fallback;
  }
}

/**
 * Push the full invoice record to Supabase so every device sees creates/edits.
 * Uses the new invoices table for proper real-time sync.
 */
export async function upsertInvoiceRecord(invoice: Record<string, unknown> & { id: string }): Promise<void> {
  if (!hasSupabaseConfig()) return;
  
  const supabase = createClient();
  const row = invoiceToRow(invoice);
  
  const { error } = await supabase
    .from(invoicesTable)
    .upsert(row, { onConflict: "id" });
    
  if (error) {
    console.error("Failed to upsert invoice:", error);
    // Fallback to old API for backward compatibility
    try {
      await fetch("/api/invoices/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invoice),
      });
    } catch {
      /* network error */
    }
  }
}

/**
 * Remove an invoice from Supabase so all devices see the deletion.
 */
export async function deleteInvoiceRecord(id: string): Promise<void> {
  if (!hasSupabaseConfig()) return;
  
  const supabase = createClient();
  const { error } = await supabase.from(invoicesTable).delete().eq("id", id);
  
  if (error) {
    console.error("Failed to delete invoice:", error);
    // Fallback to old API
    try {
      await fetch(`/api/invoices/share?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Load ALL invoice records from Supabase.
 * Filters out deleted invoices (soft delete).
 * Returns [] when Supabase is not configured.
 */
export async function loadAllInvoices<T extends { id: string; isDeleted?: boolean }>(): Promise<T[]> {
  if (!hasSupabaseConfig()) return [];
  
  const supabase = createClient();
  const { data, error } = await supabase
    .from(invoicesTable)
    .select("*")
    .or('is_deleted.is.null,is_deleted.eq.false')
    .order("updated_at", { ascending: false });
    
  if (error) {
    console.error("Failed to load invoices:", error);
    // Fallback to old API
    try {
      const response = await fetch("/api/invoices/share", { cache: "no-store" });
      if (!response.ok) return [];
      const result = (await response.json()) as { invoices?: T[] };
      // Filter out deleted invoices from fallback too
      return (result.invoices ?? []).filter((inv: T) => !inv.isDeleted);
    } catch {
      return [];
    }
  }
  
  return (data || []).map(rowToInvoice) as T[];
}

/** Load every shared invoice payload (legacy for Stripe payment updates). */
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
 * Subscribe to realtime INSERT/UPDATE/DELETE on invoices table.
 * The callback fires whenever any device creates/updates/deletes an invoice.
 */
export function subscribeToInvoiceShares(onChange: (payload: InvoiceSharePayload) => void): () => void {
  if (!hasSupabaseConfig()) return () => {};

  const supabase = createClient();
  const channel = supabase.channel(`invoices-realtime-${Math.random().toString(36).slice(2)}`);
  
  channel.on(
    "postgres_changes",
    { event: "*", schema: "public", table: invoicesTable },
    (message) => {
      const row = message.new as Record<string, unknown> | undefined;
      if (row) {
        onChange({
          id: row.id as string,
          status: row.status as string,
          payments: safeJsonParse(row.payments, []) as InvoiceSharePayment[],
          activity: safeJsonParse(row.activity, []) as string[],
          viewedAt: row.viewed_at as string | undefined,
          paidAt: row.paid_at as string | undefined,
          sentAt: row.sent_at as string | undefined,
          sentBy: row.sent_by as string | undefined,
        });
      }
    },
  );
  
  channel.subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
