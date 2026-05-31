import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return null;

  return createClient(url, key, { auth: { persistSession: false } });
}

function calculateTotals(invoice: { lineItems?: { quantity: number; unitPrice: number; tax: number }[]; discount?: number }) {
  const lineItems = invoice.lineItems || [];
  const subtotal = lineItems.reduce((total, item) => total + item.quantity * item.unitPrice, 0);
  const tax = lineItems.reduce((total, item) => total + item.quantity * item.unitPrice * (item.tax / 100), 0);
  return Math.max(subtotal + tax - (invoice.discount || 0), 0);
}

function getPaidAmount(invoice: { payments?: { amount: number }[] }) {
  return (invoice.payments || []).reduce((total, payment) => total + payment.amount, 0);
}

export async function POST(req: NextRequest) {
  const event = await req.json();
  const supabase = getAdminClient();

  if (!supabase) {
    return NextResponse.json({ error: "Payment sync storage is not configured" }, { status: 503 });
  }

  const eventType = event.type as string | undefined;
  const session = event.data?.object;
  const invoiceId = session?.metadata?.invoiceId as string | undefined;

  if (!invoiceId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const { data } = await supabase
    .from("invoice_shares")
    .select("payload")
    .eq("id", invoiceId)
    .single();

  const invoice = data?.payload as { payments?: unknown[]; activity?: string[]; status?: string; lineItems?: { quantity: number; unitPrice: number; tax: number }[]; discount?: number } | undefined;

  if (!invoice) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (eventType === "checkout.session.completed") {
    const amount = Number(session.amount_total || 0) / 100;
    const method = session.metadata?.paymentMethod === "ach" ? "Stripe ACH" : "Stripe Card";
    const payments = [...(invoice.payments || []), { amount, date: new Date().toISOString().slice(0, 10), method, reference: session.payment_intent || session.id, notes: "Stripe payment completed", offline: false }];
    const total = calculateTotals(invoice);
    const paid = getPaidAmount({ payments: payments as { amount: number }[] });
    const status = paid >= total && total > 0 ? "Paid" : "Partially Paid";
    const payload = { ...invoice, payments, status, activity: [`Notification: Stripe payment completed`, `Stripe payment completed: $${amount.toLocaleString()}`, ...(invoice.activity || [])] };

    await supabase.from("invoice_shares").upsert({ id: invoiceId, payload, updated_at: new Date().toISOString() }, { onConflict: "id" });
  }

  if (eventType === "checkout.session.async_payment_failed" || eventType === "payment_intent.payment_failed") {
    const payload = { ...invoice, activity: ["Notification: Failed payment", "Stripe payment failed", ...(invoice.activity || [])] };
    await supabase.from("invoice_shares").upsert({ id: invoiceId, payload, updated_at: new Date().toISOString() }, { onConflict: "id" });
  }

  return NextResponse.json({ ok: true });
}
