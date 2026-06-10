import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import { sendInternalInvoiceEmail } from "@/lib/invoice-emails";

const paymentSchema = z.object({
  invoiceId: z.string().min(1),
  method: z.enum(["Check", "Cash", "Bank Transfer"]),
  amount: z.number().positive(),
  checkNumber: z.string().optional(),
  checkAmount: z.number().optional(),
  notes: z.string().optional(),
  checkImageBase64: z.string().optional(),
  checkImageMimeType: z.string().optional(),
});

type StoredInvoice = {
  clientName?: string;
  invoiceNumber?: string;
  email?: string;
  payments?: unknown[];
  pendingPayments?: PendingPayment[];
  activity?: string[];
  status?: string;
  lineItems?: { quantity: number; unitPrice: number; tax: number }[];
  discount?: number;
};

type PendingPayment = {
  id: string;
  amount: number;
  method: string;
  checkNumber?: string;
  checkAmount?: number;
  checkImageBase64?: string;
  checkImageMimeType?: string;
  notes?: string;
  submittedAt: string;
  status: "pending_verification";
};

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function calculateTotal(invoice: StoredInvoice): number {
  const lineItems = invoice.lineItems || [];
  const subtotal = lineItems.reduce((t, i) => t + i.quantity * i.unitPrice, 0);
  const tax = lineItems.reduce((t, i) => t + i.quantity * i.unitPrice * (i.tax / 100), 0);
  return Math.max(subtotal + tax - (invoice.discount || 0), 0);
}

export async function POST(req: NextRequest) {
  let parsed: z.infer<typeof paymentSchema>;
  try {
    parsed = paymentSchema.parse(await req.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payment data", details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Invoice storage is not configured" }, { status: 503 });
  }

  const { data, error: readError } = await supabase
    .from("invoice_shares")
    .select("payload")
    .eq("id", parsed.invoiceId)
    .single();

  if (readError || !data?.payload) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const invoice = data.payload as StoredInvoice;

  const pending: PendingPayment = {
    id: crypto.randomUUID(),
    amount: parsed.amount,
    method: parsed.method,
    checkNumber: parsed.checkNumber,
    checkAmount: parsed.checkAmount,
    checkImageBase64: parsed.checkImageBase64,
    checkImageMimeType: parsed.checkImageMimeType,
    notes: parsed.notes,
    submittedAt: new Date().toISOString(),
    status: "pending_verification",
  };

  const existingPending = (invoice.pendingPayments || []) as PendingPayment[];
  const totalAmount = calculateTotal(invoice);

  const updatedPayload: StoredInvoice = {
    ...invoice,
    pendingPayments: [...existingPending, pending],
    status: "Payment Submitted",
    activity: [
      `Notification: ${parsed.method} payment submitted — pending verification`,
      `Customer submitted ${parsed.method} payment of $${parsed.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      ...(invoice.activity || []),
    ],
  };

  const { error: writeError } = await supabase
    .from("invoice_shares")
    .upsert({ id: parsed.invoiceId, payload: updatedPayload, updated_at: new Date().toISOString() }, { onConflict: "id" });

  if (writeError) {
    return NextResponse.json({ error: "Unable to record payment submission" }, { status: 500 });
  }

  await sendInternalInvoiceEmail({
    event: "payment_submitted",
    customerName: invoice.clientName || "",
    invoiceNumber: invoice.invoiceNumber || parsed.invoiceId,
    amount: parsed.amount,
    totalAmount,
    method: parsed.method,
    checkNumber: parsed.checkNumber,
    customerEmail: invoice.email,
  });

  return NextResponse.json({ ok: true, pendingId: pending.id });
}
