import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

const CONFIG_ROW_ID = "_proposal_follow_up_config";

export interface FollowUpConfig {
  enabled: boolean;
  delayHours: number;
  emailSubject: string;
  emailTemplate: string;
}

const DEFAULT_CONFIG: FollowUpConfig = {
  enabled: true,
  delayHours: 24,
  emailSubject: "Following up — Your Roofing Proposal",
  emailTemplate:
    "Hi {customerName},\n\nWe just wanted to follow up regarding the roofing proposal we sent you. Please let us know if you have any questions. We are happy to help.\n\nThank you,\nXRP Roofing Team",
};

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ config: DEFAULT_CONFIG });
  }

  const { data } = await supabase
    .from("proposal_shares")
    .select("payload")
    .eq("id", CONFIG_ROW_ID)
    .single();

  const config: FollowUpConfig = data?.payload
    ? { ...DEFAULT_CONFIG, ...(data.payload as Partial<FollowUpConfig>) }
    : DEFAULT_CONFIG;

  return NextResponse.json({ config });
}

export async function POST(req: NextRequest) {
  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const body = (await req.json()) as Partial<FollowUpConfig>;
  const { data: existing } = await supabase
    .from("proposal_shares")
    .select("payload")
    .eq("id", CONFIG_ROW_ID)
    .single();

  const current = existing?.payload
    ? { ...DEFAULT_CONFIG, ...(existing.payload as Partial<FollowUpConfig>) }
    : DEFAULT_CONFIG;

  const next: FollowUpConfig = {
    enabled: body.enabled ?? current.enabled,
    delayHours: body.delayHours ?? current.delayHours,
    emailSubject: body.emailSubject ?? current.emailSubject,
    emailTemplate: body.emailTemplate ?? current.emailTemplate,
  };

  const { error } = await supabase
    .from("proposal_shares")
    .upsert({ id: CONFIG_ROW_ID, payload: next, updated_at: new Date().toISOString() }, { onConflict: "id" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }

  return NextResponse.json({ config: next });
}
