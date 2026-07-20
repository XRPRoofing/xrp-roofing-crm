import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import { buildTeamRoster, type ProfileLike } from "@/lib/calendar-team";

export const runtime = "nodejs";

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(_req: NextRequest) {
  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const { data, error } = await admin
    .from("profiles")
    .select("id, email, full_name, role")
    .order("full_name", { ascending: true });

  if (error) {
    if (error.code === "42P01") {
      return NextResponse.json({ members: [], startAddress: process.env.CALENDAR_ROUTE_START_ADDRESS || "" });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const profiles = (data || []) as ProfileLike[];
  const roster = buildTeamRoster(profiles);

  // Temporary diagnostics for production member matching
  console.info("[team/roster] members", roster.members.map((m) => ({ id: m.id, name: m.name, source: m.source, legacyIds: m.legacyIds })));

  return NextResponse.json({
    members: roster.members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      source: m.source,
      role: m.role,
      legacyIds: m.legacyIds,
      isSelectable: m.isSelectable,
    })),
    startAddress: process.env.CALENDAR_ROUTE_START_ADDRESS || "",
  });
}
