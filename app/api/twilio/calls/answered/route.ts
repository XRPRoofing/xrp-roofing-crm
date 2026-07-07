import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import { recordCallAnsweredBy } from "@/lib/twilio/realtime";

/**
 * POST /api/twilio/calls/answered
 *
 * Records which admin answered an inbound call so it shows durably in the
 * notification bell, Phone call log, and customer-profile communication
 * history. The answering user is resolved from their Supabase JWT (their
 * profile full_name is authoritative), and stamped onto every stored
 * conversation_event for the CallSid.
 *
 * Auth: Supabase JWT via Bearer header or JSON body `token`.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const callSid = typeof body.callSid === "string" ? body.callSid : "";
    if (!callSid) return NextResponse.json({ error: "callSid is required" }, { status: 400 });

    const authHeader = req.headers.get("authorization");
    const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const jwt = headerToken || (typeof body.token === "string" ? body.token : "");
    if (!jwt) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabaseUrl = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .single();

    const fullName =
      profile?.full_name ||
      (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "") ||
      (typeof user.user_metadata?.name === "string" ? user.user_metadata.name : "") ||
      (typeof body.name === "string" ? body.name : "") ||
      (user.email ? user.email.split("@")[0] : "") ||
      "an agent";

    const result = await recordCallAnsweredBy(callSid, fullName, user.id);
    if (!result.ok) return NextResponse.json({ ok: false, warning: result.reason });

    return NextResponse.json({ ok: true, name: fullName, updated: result.updated, inserted: result.inserted });
  } catch (err) {
    // Best-effort: never break the answer flow if logging who-answered fails.
    return NextResponse.json({ ok: false, warning: err instanceof Error ? err.message : "answered logging error" });
  }
}
