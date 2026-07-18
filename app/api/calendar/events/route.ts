import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

export const runtime = "nodejs";

const TABLE = "calendar_events";

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(req: NextRequest) {
  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const url = new URL(req.url);
  const timeMin = url.searchParams.get("timeMin");
  const timeMax = url.searchParams.get("timeMax");

  let query = admin
    .from(TABLE)
    .select("*")
    .order("start_time", { ascending: true });

  if (timeMin) query = query.gte("start_time", timeMin);
  if (timeMax) query = query.lte("start_time", timeMax);

  const { data, error } = await query;

  // If table doesn't exist yet, return empty array instead of error
  if (error && error.code === "42P01") {
    return NextResponse.json({ events: [], needsInit: true });
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ events: data || [] });
}

export async function POST(req: NextRequest) {
  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const body = await req.json();
  const id = body.id || crypto.randomUUID();
  const now = new Date().toISOString();

  const row = {
    id,
    title: body.title || "",
    description: body.description || "",
    start_time: body.start_time,
    end_time: body.end_time,
    all_day: body.all_day || false,
    location: body.location || "",
    color: body.color || "",
    assigned_to: body.assigned_to || "",
    customer_name: body.customer_name || "",
    customer_phone: body.customer_phone || "",
    job_kind: body.job_kind || "",
    job_id: body.job_id || null,
    created_by: body.created_by || "",
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await admin.from(TABLE).insert(row).select().single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ event: data });
}

export async function PUT(req: NextRequest) {
  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const body = await req.json();
  if (!body.id) {
    return NextResponse.json({ error: "Missing event id" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const fields = [
    "title", "description", "start_time", "end_time", "all_day",
    "location", "color", "assigned_to", "customer_name", "customer_phone",
    "job_kind", "job_id",
  ];
  for (const f of fields) {
    if (body[f] !== undefined) updates[f] = body[f];
  }

  const { data, error } = await admin
    .from(TABLE)
    .update(updates)
    .eq("id", body.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ event: data });
}

export async function DELETE(req: NextRequest) {
  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing event id" }, { status: 400 });
  }

  const { error } = await admin.from(TABLE).delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
