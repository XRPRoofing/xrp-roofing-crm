import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

/**
 * POST /api/agent/presence
 *
 * Marks the authenticated user online/offline in the `agent_status` table so
 * inbound calls can (optionally) prefer currently-online admins. Ringing still
 * targets every admin via `profiles`, so presence is a refinement, not a hard
 * requirement.
 *
 * Auth: Supabase JWT, accepted either as a Bearer header or in the JSON body
 * as `token` — the body form lets `navigator.sendBeacon` (which cannot set
 * headers) report "offline" on page unload.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    const authHeader = req.headers.get("authorization");
    const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const jwt = headerToken || (typeof body.token === "string" ? body.token : "");
    if (!jwt) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const status = body.status === "online" ? "online" : "offline";

    const supabaseUrl = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    // Crew users never take calls — don't track their presence.
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, full_name")
      .eq("id", user.id)
      .single();
    if (profile?.role === "crew") {
      return NextResponse.json({ ok: true, skipped: "crew" });
    }

    const fullName =
      profile?.full_name ||
      (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "") ||
      (typeof user.user_metadata?.name === "string" ? user.user_metadata.name : "") ||
      (user.email ? user.email.split("@")[0] : "");

    const { error: upsertError } = await supabase
      .from("agent_status")
      .upsert(
        { user_id: user.id, status, full_name: fullName, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );

    if (upsertError) {
      // Table may not exist yet (migration not run). Fail soft — ringing still
      // works from profiles, so presence errors must never break the app.
      return NextResponse.json({ ok: false, warning: upsertError.message });
    }

    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return NextResponse.json({ ok: false, warning: err instanceof Error ? err.message : "presence error" });
  }
}
