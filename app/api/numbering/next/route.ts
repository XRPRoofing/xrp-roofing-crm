import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

export const runtime = "nodejs";

// Atomic allocator for the shared proposal+invoice number sequence.
//
// The number is minted here (server-side) via the `next_document_number`
// Postgres function so two devices creating at the same moment can never get
// the same number. We pass a `seed` computed from the current max of existing
// documents so the counter never reuses or rewinds past live numbers, even the
// very first time it runs. Read-only aside from the single atomic counter row;
// no proposal/invoice/customer data is modified.

const COUNTER_KEY = "unified";
const COUNTER_START = 3210;

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function parseDocNumber(value: unknown): number {
  const cleaned = String(value ?? "").replace(/^[#]|^XRP-INV-|^XRP-P-|^XRP-/i, "");
  return parseInt(cleaned, 10);
}

type SupabaseAdmin = NonNullable<ReturnType<typeof getAdminClient>>;

// Highest number currently used by any proposal or invoice, so the sequence is
// seeded above live data and never collides with an existing document.
async function computeSeed(admin: SupabaseAdmin): Promise<number> {
  let max = COUNTER_START - 1;

  const { data: invoices } = await admin.from("invoices").select("invoice_number");
  if (invoices) {
    for (const row of invoices as { invoice_number?: unknown }[]) {
      const n = parseDocNumber(row.invoice_number);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }

  // Proposals/estimates live in proposal_shares with the number inside payload.
  const { data: proposals } = await admin.from("proposal_shares").select("payload");
  if (proposals) {
    for (const row of proposals as { payload?: { proposalNumber?: unknown } }[]) {
      const n = parseDocNumber(row.payload?.proposalNumber);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }

  return max + 1;
}

export async function POST() {
  const admin = getAdminClient();
  // Not configured — tell the client to fall back to its local allocator.
  if (!admin) {
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 200 });
  }

  try {
    const seed = await computeSeed(admin);
    const { data, error } = await admin.rpc("next_document_number", {
      p_key: COUNTER_KEY,
      p_seed: seed,
    });

    if (error) {
      // Migration not run yet (function missing) or transient error — fall back.
      return NextResponse.json(
        { ok: false, reason: "rpc_unavailable", seed },
        { status: 200 },
      );
    }

    const number = Number(data);
    if (!Number.isFinite(number)) {
      return NextResponse.json({ ok: false, reason: "bad_value", seed }, { status: 200 });
    }

    return NextResponse.json({ ok: true, number });
  } catch {
    return NextResponse.json({ ok: false, reason: "error" }, { status: 200 });
  }
}
