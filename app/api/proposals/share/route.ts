import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

const proposalSchema = z.record(z.string(), z.unknown()).and(z.object({ id: z.string().min(1) }));

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!key) return null;

  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  try {
    const proposal = proposalSchema.parse(await req.json());
    const supabase = getAdminClient();

    if (!supabase) {
      return NextResponse.json({ error: "Proposal sharing requires SUPABASE_SERVICE_ROLE_KEY so server writes can bypass row-level security." }, { status: 503 });
    }

    const { error } = await supabase
      .from("proposal_shares")
      .upsert({ id: proposal.id, payload: proposal, updated_at: new Date().toISOString() }, { onConflict: "id" });

    if (error) {
      return NextResponse.json({ error: error.message.includes("row-level security") ? "Supabase rejected the proposal share because SUPABASE_SERVICE_ROLE_KEY is missing or invalid. Add the service role key in Vercel environment variables and redeploy." : error.message }, { status: 503 });
    }

    return NextResponse.json({ ok: true, id: proposal.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid proposal data", details: error.issues }, { status: 400 });
    }

    return NextResponse.json({ error: "Unable to share proposal" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Proposal id is required" }, { status: 400 });
  }

  const supabase = getAdminClient();

  if (!supabase) {
    return NextResponse.json({ error: "Proposal sharing requires SUPABASE_SERVICE_ROLE_KEY so server reads can bypass row-level security." }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("proposal_shares")
    .select("payload")
    .eq("id", id)
    .single();

  if (error || !data?.payload) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  return NextResponse.json({ proposal: data.payload });
}

export async function PATCH(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    const updates = z.record(z.string(), z.unknown()).parse(await req.json());

    if (!id) {
      return NextResponse.json({ error: "Proposal id is required" }, { status: 400 });
    }

    const supabase = getAdminClient();

    if (!supabase) {
      return NextResponse.json({ error: "Proposal sharing requires SUPABASE_SERVICE_ROLE_KEY so server updates can bypass row-level security." }, { status: 503 });
    }

    const { data, error } = await supabase
      .from("proposal_shares")
      .select("payload")
      .eq("id", id)
      .single();

    if (error || !data?.payload) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    }

    const proposal = proposalSchema.parse(data.payload);
    const nextProposal = { ...proposal, ...updates, id, updatedAt: new Date().toISOString() };
    const { error: updateError } = await supabase
      .from("proposal_shares")
      .upsert({ id, payload: nextProposal, updated_at: new Date().toISOString() }, { onConflict: "id" });

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 503 });
    }

    return NextResponse.json({ proposal: nextProposal });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid proposal update data", details: error.issues }, { status: 400 });
    }

    return NextResponse.json({ error: "Unable to update proposal" }, { status: 500 });
  }
}
