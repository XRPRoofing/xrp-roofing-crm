import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import { reconcileRecentCalls } from "@/lib/twilio/reconcile";

export const maxDuration = 60;

/**
 * POST /api/twilio/calls/reconcile
 *
 * Self-healing pass for the central call history: reconciles recent calls
 * against Twilio's own records and backfills any call / recording / transcript
 * / summary that a dropped webhook left missing, so every admin always sees the
 * same complete history. Auth: Supabase JWT (Bearer header or body `token`).
 */
async function handle(req: NextRequest, jwt: string, sinceMinutes?: number) {
  if (!jwt) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabaseUrl = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const result = await reconcileRecentCalls(sinceMinutes ? { sinceMinutes } : undefined);
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const authHeader = req.headers.get("authorization");
    const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const jwt = headerToken || (typeof body.token === "string" ? body.token : "");
    const sinceMinutes = typeof body.sinceMinutes === "number" ? body.sinceMinutes : undefined;
    return await handle(req, jwt, sinceMinutes);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "reconcile error" });
  }
}
