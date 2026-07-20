import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import { connectAgentToQueue } from "@/lib/twilio/server";

/**
 * POST /api/twilio/queue/connect-next
 *
 * Called by an admin's browser the moment their call ends. If a caller is
 * waiting in the hold queue, rings this now-free admin and bridges them to the
 * next caller. No-ops when the queue is empty, so it's safe to call on every
 * hang-up. Auth: Supabase JWT (Bearer header or `token` in the JSON body).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const authHeader = req.headers.get("authorization");
    const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const jwt = headerToken || (typeof body.token === "string" ? body.token : "");
    if (!jwt) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabaseUrl = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ ok: false, warning: "Server misconfigured" });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    // Crew users never take calls.
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role === "crew") return NextResponse.json({ ok: true, skipped: "crew" });

    const connected = await connectAgentToQueue(`agent-${user.id}`, req.nextUrl.origin);
    return NextResponse.json({ ok: true, connected });
  } catch (err) {
    // Best-effort — a dequeue failure must never surface as an error to the UI.
    return NextResponse.json({ ok: false, warning: err instanceof Error ? err.message : "connect-next error" });
  }
}
