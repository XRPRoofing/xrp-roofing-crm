import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.replace(/\D/g, "") : "";

    if (!conversationId && !phone) {
      return NextResponse.json({ error: "conversationId or phone is required" }, { status: 400 });
    }

    const supabase = getAdminClient();
    if (!supabase) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    // Normalize phone: strip US country code prefix
    const normalized = phone.length === 11 && phone.startsWith("1") ? phone.slice(1) : phone;
    const e164 = normalized ? `+1${normalized}` : "";

    // Delete conversation events matching this contact by conversation_id or phone
    let deleted = 0;

    if (conversationId) {
      const { count } = await supabase
        .from("conversation_events")
        .delete({ count: "exact" })
        .eq("conversation_id", conversationId);
      deleted += count || 0;
    }

    // Also delete by phone number match (some events may not have conversation_id set)
    if (normalized) {
      const phoneVariants = [normalized, e164, `+1${normalized}`];
      for (const variant of phoneVariants) {
        const { count: fromCount } = await supabase
          .from("conversation_events")
          .delete({ count: "exact" })
          .eq("from_phone", variant);
        deleted += fromCount || 0;

        const { count: toCount } = await supabase
          .from("conversation_events")
          .delete({ count: "exact" })
          .eq("to_phone", variant);
        deleted += toCount || 0;
      }
    }

    // Also clean up read state
    if (conversationId) {
      await supabase
        .from("conversation_read_states")
        .delete()
        .eq("conversation_id", conversationId);
    }

    return NextResponse.json({ success: true, deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete conversation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
