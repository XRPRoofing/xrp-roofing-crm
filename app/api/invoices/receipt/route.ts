import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import { sendPaymentReceiptEmail } from "@/lib/invoice-customer-emails";
import { pushServerNotification } from "@/lib/server-notifications";

const schema = z.object({
  invoiceId: z.string().min(1),
  customerEmail: z.string().email(),
  customerName: z.string(),
  invoiceNumber: z.string(),
  amount: z.number().positive(),
  method: z.string(),
  reference: z.string().optional(),
  propertyAddress: z.string().optional(),
  lineItems: z
    .array(z.object({ description: z.string(), quantity: z.number(), unitPrice: z.number(), tax: z.number() }))
    .optional(),
  discount: z.number().optional(),
});

type StoredInvoice = {
  receiptSent?: boolean;
  activity?: string[];
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
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid data", details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // Check for duplicate receipt
  if (supabase) {
    const { data } = await supabase
      .from("invoice_shares")
      .select("payload")
      .eq("id", parsed.invoiceId)
      .maybeSingle();
    const invoice = data?.payload as StoredInvoice | undefined;
    if (invoice?.receiptSent) {
      return NextResponse.json({ ok: true, alreadySent: true });
    }
  }

  const sent = await sendPaymentReceiptEmail({
    customerEmail: parsed.customerEmail,
    customerName: parsed.customerName,
    invoiceNumber: parsed.invoiceNumber,
    amount: parsed.amount,
    method: parsed.method,
    reference: parsed.reference,
    propertyAddress: parsed.propertyAddress,
    lineItems: parsed.lineItems,
    discount: parsed.discount,
  });

  if (!sent) {
    return NextResponse.json({ error: "Failed to send receipt email" }, { status: 500 });
  }

  // Mark receipt as sent in invoice_shares to prevent duplicates
  if (supabase) {
    const { data } = await supabase
      .from("invoice_shares")
      .select("payload")
      .eq("id", parsed.invoiceId)
      .maybeSingle();
    if (data?.payload) {
      const invoice = data.payload as StoredInvoice;
      const updatedPayload: StoredInvoice = {
        ...invoice,
        receiptSent: true,
        activity: [`Receipt emailed to ${parsed.customerEmail}`, ...(invoice.activity || [])],
      };
      await supabase
        .from("invoice_shares")
        .upsert({ id: parsed.invoiceId, payload: updatedPayload, updated_at: new Date().toISOString() }, { onConflict: "id" });
    }
  }

  await pushServerNotification({
    title: "Receipt sent",
    message: `Payment receipt emailed to ${parsed.customerName || "Customer"} (${parsed.customerEmail}) for ${parsed.invoiceNumber}`,
    actor: "Invoices",
    module: "Invoices",
  });

  return NextResponse.json({ ok: true });
}
