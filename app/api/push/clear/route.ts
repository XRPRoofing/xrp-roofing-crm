import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

export async function POST() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { error, count } = await supabase.from("push_subscriptions").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ cleared: count ?? "all", message: "All stale subscriptions removed. Devices will re-register on next CRM visit." });
}

export async function GET() {
  return POST();
}
