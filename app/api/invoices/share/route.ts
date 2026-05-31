import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

const invoiceSchema = z.record(z.string(), z.unknown()).and(z.object({ id: z.string().min(1) }));

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!key) return null;

  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  try {
    const invoice = invoiceSchema.parse(await req.json());
    const supabase = getAdminClient();

    if (!supabase) {
      return NextResponse.json({ error: "Invoice sharing storage is not configured" }, { status: 503 });
    }

    const { error } = await supabase
      .from("invoice_shares")
      .upsert({ id: invoice.id, payload: invoice, updated_at: new Date().toISOString() }, { onConflict: "id" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    return NextResponse.json({ ok: true, id: invoice.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid invoice data", details: error.issues }, { status: 400 });
    }

    return NextResponse.json({ error: "Unable to share invoice" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Invoice id is required" }, { status: 400 });
  }

  const supabase = getAdminClient();

  if (!supabase) {
    return NextResponse.json({ error: "Invoice sharing storage is not configured" }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("invoice_shares")
    .select("payload")
    .eq("id", id)
    .single();

  if (error || !data?.payload) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  return NextResponse.json({ invoice: data.payload });
}
