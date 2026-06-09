import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

export const runtime = "nodejs";

type StoredInvoice = {
  activity?: string[];
  emailDeliveredAt?: string;
  emailOpenedAt?: string;
  [key: string]: unknown;
};

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Verify a Resend (Svix) webhook signature. Opt-in: returns true when
 * RESEND_WEBHOOK_SECRET is not configured so the endpoint still works without
 * it, but validates when the secret is present.
 */
function verifyResendSignature(rawBody: string, headers: Headers): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return true;

  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatureHeader = headers.get("svix-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secretBytes).update(signedContent).digest("base64");

  // svix-signature is a space-separated list of "v1,<signature>" entries.
  return signatureHeader.split(" ").some((entry) => {
    const [, sig] = entry.split(",");
    if (!sig) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

type ResendTag = { name?: string; value?: string };

function extractInvoiceId(tags: unknown): string | null {
  if (!tags) return null;
  if (Array.isArray(tags)) {
    const match = (tags as ResendTag[]).find((tag) => tag?.name === "invoice_id");
    return match?.value ?? null;
  }
  if (typeof tags === "object") {
    const value = (tags as Record<string, unknown>).invoice_id;
    return typeof value === "string" ? value : null;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!verifyResendSignature(rawBody, req.headers)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: { type?: string; data?: { tags?: unknown } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const type = event.type;
  if (type !== "email.delivered" && type !== "email.opened") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const invoiceId = extractInvoiceId(event.data?.tags);
  if (!invoiceId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const { data } = await supabase.from("invoice_shares").select("payload").eq("id", invoiceId).single();
  const invoice = data?.payload as StoredInvoice | undefined;
  if (!invoice) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const now = new Date().toISOString();
  const isDelivered = type === "email.delivered";

  // Idempotent: skip if we already recorded this event.
  if (isDelivered && invoice.emailDeliveredAt) return NextResponse.json({ ok: true, alreadyRecorded: true });
  if (!isDelivered && invoice.emailOpenedAt) return NextResponse.json({ ok: true, alreadyRecorded: true });

  const payload: StoredInvoice = {
    ...invoice,
    ...(isDelivered ? { emailDeliveredAt: now } : { emailOpenedAt: now }),
    activity: [isDelivered ? "Email Delivered" : "Email Opened", ...(invoice.activity || [])],
  };

  await supabase
    .from("invoice_shares")
    .upsert({ id: invoiceId, payload, updated_at: now }, { onConflict: "id" });

  return NextResponse.json({ ok: true });
}
