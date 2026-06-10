import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import { sendInternalInvoiceEmail } from "@/lib/invoice-emails";
import { sendPaymentRejectedEmail } from "@/lib/invoice-customer-emails";

const schema = z.object({
  invoiceId: z.string().min(1),
  pendingId: z.string().min(1),
  rejectionNote: z.string().min(1),
  customerEmail: z.string().optional(),
  customerName: z.string().optional(),
  invoiceNumber: z.string().optional(),
  method: z.string().optional(),
  amount: z.number().optional(),
});

type PendingPayment = {
  id: string;
  amount: number;
  method: string;
  submittedAt: string;
  status: string;
};

type StoredInvoice = {
  pendingPayments?: PendingPayment[];
  activity?: string[];
  status?: string;
  [key: string]: unknown;
};

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  let parsed: z.infer<typeof schema>;
  try {
    parsed = schema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Storage not configured" }, { status: 503 });
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
  const nextPending = (invoice.pendingPayments || []).filter((p) => p.id !== parsed.pendingId);
  const amountStr = parsed.amount
    ? parsed.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "";

  const updatedPayload: StoredInvoice = {
    ...invoice,
    pendingPayments: nextPending,
    status: nextPending.length > 0 ? "Payment Submitted" : (invoice.status === "Payment Submitted" ? "Sent" : invoice.status),
    activity: [
      `Payment rejected by office: ${parsed.method ?? ""}${amountStr ? ` ${amountStr}` : ""} — ${parsed.rejectionNote}`,
      ...(invoice.activity || []),
    ],
  };

  const { error: writeError } = await supabase
    .from("invoice_shares")
    .upsert({ id: parsed.invoiceId, payload: updatedPayload, updated_at: new Date().toISOString() }, { onConflict: "id" });

  if (writeError) {
    return NextResponse.json({ error: "Unable to update invoice" }, { status: 500 });
  }

  // Notify office
  await sendInternalInvoiceEmail({
    event: "payment_rejected",
    customerName: parsed.customerName || "",
    invoiceNumber: parsed.invoiceNumber || parsed.invoiceId,
    amount: parsed.amount || 0,
    method: parsed.method,
    customerEmail: parsed.customerEmail,
    rejectionNote: parsed.rejectionNote,
  });

  // Notify customer
  if (parsed.customerEmail) {
    await sendPaymentRejectedEmail({
      customerEmail: parsed.customerEmail,
      customerName: parsed.customerName || "Valued Customer",
      invoiceNumber: parsed.invoiceNumber || parsed.invoiceId,
      method: parsed.method || "payment",
      amount: parsed.amount || 0,
      rejectionNote: parsed.rejectionNote,
    });
  }

  return NextResponse.json({ ok: true });
}
