import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

export const runtime = "nodejs";

// Shared, device-synced manual customer records. Stored one row per customer in
// `customer_records` so two devices editing different customers never clobber
// each other. Reads/writes use the service role (bypasses RLS); the browser
// subscribes to realtime for instant cross-device updates.
const customersTable = "customer_records";

const customerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().default(""),
  phone: z.string().default(""),
  propertyAddress: z.string().default(""),
  roofDetails: z.string().default(""),
  insuranceCarrier: z.string().default(""),
  status: z.string().default("New customer"),
  lifetimeValue: z.number().default(0),
});

type Customer = z.infer<typeof customerSchema>;
type CustomerRow = { id: string; payload: Customer };

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Detect "table/column not found" across both Postgres ("does not exist") and
// PostgREST (schema-cache) error shapes so a missing migration is reported
// clearly instead of a generic failure.
function missingSchema(error: { message?: string; code?: string } | null | undefined) {
  if (!error) return false;
  const message = (error.message || "").toLowerCase();
  const code = error.code || "";
  return (
    message.includes("does not exist") ||
    message.includes("could not find the table") ||
    message.includes("could not find the") ||
    message.includes("schema cache") ||
    code === "PGRST205" ||
    code === "PGRST204" ||
    code === "42P01"
  );
}

const MISSING_TABLE_MESSAGE =
  "The customer_records table is missing. Run supabase/customer-records.sql in your Supabase project, then try again.";

export async function GET() {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ customers: [] });
  // Newest first: customer_records.updated_at is bumped on every upsert.
  const { data, error } = await admin
    .from(customersTable)
    .select("id, payload, updated_at")
    .order("updated_at", { ascending: false });
  if (error) {
    return NextResponse.json({
      customers: [],
      error: missingSchema(error) ? MISSING_TABLE_MESSAGE : "Unable to load customers.",
      detail: error.message,
      code: error.code,
    });
  }
  const customers = (data as CustomerRow[])
    .map((row) => (row.payload ? { ...row.payload, id: row.id } : null))
    .filter((customer): customer is Customer => Boolean(customer));
  return NextResponse.json({ customers });
}

export async function POST(req: NextRequest) {
  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Customer sync requires SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });
  }

  let customer: Customer;
  try {
    customer = customerSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid customer" }, { status: 400 });
  }

  const { error } = await admin
    .from(customersTable)
    .upsert({ id: customer.id, payload: customer, updated_at: new Date().toISOString() }, { onConflict: "id" });

  if (error) {
    return NextResponse.json(
      {
        error: missingSchema(error) ? MISSING_TABLE_MESSAGE : "Unable to save customer.",
        detail: error.message,
        code: error.code,
      },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, customer });
}

export async function DELETE(req: NextRequest) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ ok: true });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const { error } = await admin.from(customersTable).delete().eq("id", id);
  if (error && !missingSchema(error)) {
    return NextResponse.json({ error: "Unable to delete customer.", detail: error.message, code: error.code }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
