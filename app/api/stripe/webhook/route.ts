import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import { sendInternalInvoiceEmail } from "@/lib/invoice-emails";
import { pushServerNotification } from "@/lib/server-notifications";

// Stripe needs the raw request body for signature verification, so this route
// must run on the Node.js runtime (not edge) and read the body as text.
export const runtime = "nodejs";

type StoredPayment = {
  amount: number;
  date: string;
  method: string;
  reference: string;
  notes: string;
  offline: boolean;
};

type StoredInvoice = {
  clientName?: string;
  invoiceNumber?: string;
  email?: string;
  payments?: StoredPayment[];
  activity?: string[];
  status?: string;
  paidAt?: string;
  failedAt?: string;
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

function getPaidAmount(payments: StoredPayment[]) {
  return payments.reduce((total, payment) => total + payment.amount, 0);
}

/**
 * Verify the Stripe signature against the raw payload using STRIPE_WEBHOOK_SECRET.
 * Implemented with Node crypto so we don't need the Stripe SDK. Returns true when
 * the secret is not configured (verification is opt-in and won't break setups
 * that haven't added the secret yet).
 */
function verifyStripeSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key, value];
    }),
  );

  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

function getInvoiceId(object: Record<string, unknown>): string | undefined {
  const metadata = object?.metadata as Record<string, unknown> | undefined;
  const fromMetadata = metadata?.invoiceId;
  return typeof fromMetadata === "string" && fromMetadata ? fromMetadata : undefined;
}

const successEvents = new Set(["checkout.session.completed", "payment_intent.succeeded", "invoice.paid"]);
const failureEvents = new Set(["payment_intent.payment_failed", "checkout.session.async_payment_failed"]);

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!verifyStripeSignature(rawBody, req.headers.get("stripe-signature"))) {
    console.error("[stripe-webhook] signature verification failed — check STRIPE_WEBHOOK_SECRET matches this endpoint's signing secret");
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const supabase = getAdminClient();
  if (!supabase) {
    console.error("[stripe-webhook] no Supabase key available (set SUPABASE_SERVICE_ROLE_KEY)");
    return NextResponse.json({ error: "Payment sync storage is not configured" }, { status: 503 });
  }

  // Writes to invoice_shares are protected by RLS that only allows the
  // authenticated/service role. Without the service role key the anon key is
  // used, reads/writes are silently blocked, and payments never sync. Surface
  // that as a hard failure so the misconfiguration is visible in Stripe.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[stripe-webhook] SUPABASE_SERVICE_ROLE_KEY is not set — invoice_shares writes will be blocked by RLS");
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured" }, { status: 500 });
  }

  const eventType = event.type || "";
  const object = event.data?.object || {};
  const invoiceId = getInvoiceId(object);

  // Only events tied to one of our invoices are actionable.
  if (!invoiceId || (!successEvents.has(eventType) && !failureEvents.has(eventType))) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const { data, error: selectError } = await supabase
    .from("invoice_shares")
    .select("payload")
    .eq("id", invoiceId)
    .maybeSingle();

  if (selectError) {
    console.error(`[stripe-webhook] failed to read invoice ${invoiceId}:`, selectError.message);
    return NextResponse.json({ error: "Unable to read invoice" }, { status: 500 });
  }

  const invoice = data?.payload as StoredInvoice | undefined;
  if (!invoice) {
    // The invoice was never published to invoice_shares (or under a different
    // id). Don't lose the payment silently — notify the office using the data
    // Stripe gave us, then ack so Stripe doesn't retry forever.
    console.warn(`[stripe-webhook] ${eventType} for unknown invoice ${invoiceId} — sending fallback notification`);
    if (successEvents.has(eventType)) {
      const fallbackAmount = Number(object.amount_total ?? object.amount_received ?? object.amount_paid ?? object.amount ?? 0) / 100;
      const fallbackMeta = (object.metadata as Record<string, unknown> | undefined) || {};
      await sendInternalInvoiceEmail({
        event: "paid",
        customerName: typeof fallbackMeta.clientName === "string" ? fallbackMeta.clientName : "",
        invoiceNumber: typeof fallbackMeta.invoiceNumber === "string" ? fallbackMeta.invoiceNumber : invoiceId,
        amount: fallbackAmount,
        customerEmail: typeof object.customer_email === "string" ? object.customer_email : undefined,
      });
    }
    return NextResponse.json({ ok: true, ignored: true });
  }

  const metadata = (object.metadata as Record<string, unknown> | undefined) || {};
  const customerName = invoice.clientName || "";
  const invoiceNumber = invoice.invoiceNumber || invoiceId;
  const customerEmail = invoice.email;

  if (successEvents.has(eventType)) {
    // Resolve amount + reference per event shape (all amounts arrive in cents).
    const amountCents = Number(
      object.amount_total ?? object.amount_received ?? object.amount_paid ?? object.amount ?? 0,
    );
    const amount = amountCents / 100;
    const reference = String(object.payment_intent || object.id || "");
    const method = metadata.paymentMethod === "ach" ? "Stripe ACH" : "Stripe Card";

    const existingPayments = invoice.payments || [];
    // Idempotency: card payments fire both checkout.session.completed and
    // payment_intent.succeeded — never record the same Stripe reference twice.
    const alreadyRecorded = reference
      ? existingPayments.some((payment) => payment.reference === reference)
      : false;

    const payments = alreadyRecorded
      ? existingPayments
      : [
          ...existingPayments,
          {
            amount,
            date: new Date().toISOString().slice(0, 10),
            method,
            reference,
            notes: "Stripe payment completed",
            offline: false,
          },
        ];

    const total = calculateTotals(invoice);
    const paid = getPaidAmount(payments);
    const status = paid >= total && total > 0 ? "Paid" : "Partially Paid";
    const activity = alreadyRecorded
      ? invoice.activity || []
      : [
          "Notification: Stripe payment completed",
          `Stripe payment completed: $${amount.toLocaleString()}`,
          ...(invoice.activity || []),
        ];

    const payload: StoredInvoice = {
      ...invoice,
      payments,
      status,
      paidAt: status === "Paid" ? new Date().toISOString() : invoice.paidAt,
      activity,
    };

    const { error: writeError } = await supabase
      .from("invoice_shares")
      .upsert({ id: invoiceId, payload, updated_at: new Date().toISOString() }, { onConflict: "id" });

    if (writeError) {
      console.error(`[stripe-webhook] failed to mark invoice ${invoiceId} paid:`, writeError.message);
      return NextResponse.json({ error: "Unable to update invoice" }, { status: 500 });
    }

    if (!alreadyRecorded) {
      await sendInternalInvoiceEmail({ event: "paid", customerName, invoiceNumber, amount, customerEmail });
      await pushServerNotification({
        title: "Payment received",
        message: `${customerName || "Customer"} paid $${amount.toLocaleString()} on ${invoiceNumber}`,
        actor: "Stripe",
        module: "Invoices",
      });
    }

    return NextResponse.json({ ok: true });
  }

  // Failure events.
  const failedAmount = Number(object.amount ?? object.amount_total ?? 0) / 100;
  const payload: StoredInvoice = {
    ...invoice,
    failedAt: new Date().toISOString(),
    activity: ["Notification: Failed payment", "Stripe payment failed", ...(invoice.activity || [])],
  };

  const { error: failWriteError } = await supabase
    .from("invoice_shares")
    .upsert({ id: invoiceId, payload, updated_at: new Date().toISOString() }, { onConflict: "id" });

  if (failWriteError) {
    console.error(`[stripe-webhook] failed to record failed payment for ${invoiceId}:`, failWriteError.message);
    return NextResponse.json({ error: "Unable to update invoice" }, { status: 500 });
  }

  await sendInternalInvoiceEmail({
    event: "failed",
    customerName,
    invoiceNumber,
    amount: failedAmount || calculateTotals(invoice),
    customerEmail,
  });

  await pushServerNotification({
    title: "Payment failed",
    message: `${customerName || "Customer"} — payment of $${(failedAmount || calculateTotals(invoice)).toLocaleString()} failed on ${invoiceNumber}`,
    actor: "Stripe",
    module: "Invoices",
  });

  return NextResponse.json({ ok: true });
}
