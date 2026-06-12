import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import { applyProposalLock } from "@/lib/proposal-lock";

export const runtime = "nodejs";

// Shared, device-synced proposals (estimates). Stored one row per proposal in
// `proposal_shares` so two devices editing different proposals never clobber
// each other. Reads/writes use the service role (bypasses RLS); the browser
// subscribes to realtime for instant cross-device updates. The public proposal
// page + send flow write the same table via /api/proposals/share.
const proposalsTable = "proposal_shares";

const proposalSchema = z.record(z.string(), z.unknown()).and(z.object({ id: z.string().min(1) }));
type Proposal = z.infer<typeof proposalSchema>;
type ProposalRow = { id: string; payload: Proposal };

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function missingTable(message: string | undefined) {
  return Boolean(message && message.includes("does not exist"));
}

export async function GET() {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ proposals: [] });
  const { data, error } = await admin.from(proposalsTable).select("id, payload");
  if (error) {
    return NextResponse.json(
      missingTable(error.message)
        ? { proposals: [], error: "The proposal_shares table is missing. Run supabase/proposal-shares.sql." }
        : { proposals: [] },
    );
  }
  const proposals = (data as ProposalRow[])
    .map((row) => {
      if (!row.payload) return null;
      const { brochures: _b, ...rest } = row.payload as Proposal & { brochures?: unknown };
      return { ...rest, id: row.id };
    })
    .filter((proposal): proposal is Proposal => Boolean(proposal));
  return NextResponse.json({ proposals });
}

export async function POST(req: NextRequest) {
  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Proposal sync requires SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });
  }

  let proposal: Proposal;
  try {
    proposal = proposalSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid proposal" }, { status: 400 });
  }

  // Never let a stale board copy overwrite a signed proposal's locked
  // package/price/signature — re-impose the locked fields from the stored row.
  const { data: existing } = await admin
    .from(proposalsTable)
    .select("payload")
    .eq("id", proposal.id)
    .single();
  const payload = applyProposalLock(existing?.payload ?? null, proposal);

  const { error } = await admin
    .from(proposalsTable)
    .upsert({ id: proposal.id, payload, updated_at: new Date().toISOString() }, { onConflict: "id" });

  if (error) {
    return NextResponse.json(
      {
        error: missingTable(error.message)
          ? "The proposal_shares table is missing. Run supabase/proposal-shares.sql, then try again."
          : "Unable to save proposal.",
      },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, proposal: payload });
}

export async function DELETE(req: NextRequest) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ ok: true });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const { error } = await admin.from(proposalsTable).delete().eq("id", id);
  if (error && !missingTable(error.message)) {
    return NextResponse.json({ error: "Unable to delete proposal." }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
