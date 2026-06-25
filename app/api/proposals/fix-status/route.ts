import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

export const dynamic = "force-dynamic";

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Admin endpoint to fix a proposal's status without resending emails.
 * Usage: GET /api/proposals/fix-status?id=PROPOSAL_ID&status=Sent
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const status = req.nextUrl.searchParams.get("status") || "Sent";

  if (!id) {
    return NextResponse.json({ error: "Proposal id is required (?id=...)" }, { status: 400 });
  }

  const validStatuses = ["Draft", "Sent", "Viewed", "Won", "Signed", "Signed Offline", "Declined"];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: `Invalid status. Valid: ${validStatuses.join(", ")}` }, { status: 400 });
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("proposal_shares")
    .select("payload")
    .eq("id", id)
    .single();

  if (error || !data?.payload) {
    // Try searching by customer name if id didn't match
    const { data: allData } = await supabase
      .from("proposal_shares")
      .select("id, payload")
      .limit(500);

    if (allData) {
      const match = allData.find((row) => {
        const p = row.payload as Record<string, unknown>;
        const name = (p?.customerName as string || "").toLowerCase();
        return name.includes(id.toLowerCase());
      });

      if (match) {
        const payload = match.payload as Record<string, unknown>;
        const updated = { ...payload, status };
        await supabase
          .from("proposal_shares")
          .upsert({ id: match.id, payload: updated, updated_at: new Date().toISOString() }, { onConflict: "id" });

        return NextResponse.json({
          ok: true,
          proposalId: match.id,
          customerName: payload.customerName,
          previousStatus: payload.status,
          newStatus: status,
        });
      }
    }

    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  const payload = data.payload as Record<string, unknown>;
  const previousStatus = payload.status;
  const updated = { ...payload, status };

  await supabase
    .from("proposal_shares")
    .upsert({ id, payload: updated, updated_at: new Date().toISOString() }, { onConflict: "id" });

  return NextResponse.json({
    ok: true,
    proposalId: id,
    customerName: payload.customerName,
    previousStatus,
    newStatus: status,
  });
}
