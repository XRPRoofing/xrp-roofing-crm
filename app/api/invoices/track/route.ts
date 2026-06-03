import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import { sendInternalInvoiceEmail } from "@/lib/invoice-emails";

const schema = z.object({ id: z.string().min(1) });

type StoredInvoice = {
  clientName?: string;
  invoiceNumber?: string;
  email?: string;
  activity?: string[];
  viewedAt?: string;
  lineItems?: { quantity: number; unitPrice: number; tax: number }[];
  discount?: number;
};

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function calculateTotals(invoice: StoredInvoice) {
  const lineItems = invoice.lineItems || [];
  const subtotal = lineItems.reduce((total, item) => total + item.quantity * item.unitPrice, 0);
  const tax = lineItems.reduce((total, item) => total + item.quantity * item.unitPrice * (item.tax / 100), 0);
  return Math.max(subtotal + tax - (invoice.discount || 0), 0);
}

export async function POST(req: NextRequest) {
  let id: string;
  try {
    ({ id } = schema.parse(await req.json()));
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const { data } = await supabase.from("invoice_shares").select("payload").eq("id", id).single();
  const invoice = data?.payload as StoredInvoice | undefined;
  if (!invoice) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  // Only record + notify on the first view so the office is not spammed on
  // every page load / refresh.
  if (invoice.viewedAt) {
    return NextResponse.json({ ok: true, alreadyViewed: true });
  }

  const payload: StoredInvoice = {
    ...invoice,
    viewedAt: new Date().toISOString(),
    activity: ["Notification: Invoice viewed", "Viewed", ...(invoice.activity || [])],
  };

  await supabase
    .from("invoice_shares")
    .upsert({ id, payload, updated_at: new Date().toISOString() }, { onConflict: "id" });

  await sendInternalInvoiceEmail({
    event: "viewed",
    customerName: invoice.clientName || "",
    invoiceNumber: invoice.invoiceNumber || id,
    amount: calculateTotals(invoice),
    customerEmail: invoice.email,
  });

  return NextResponse.json({ ok: true });
}
