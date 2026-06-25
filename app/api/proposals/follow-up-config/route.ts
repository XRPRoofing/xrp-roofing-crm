import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

const CONFIG_ROW_ID = "_proposal_follow_up_config";

export interface FollowUpStep {
  delayHours: number;
  emailSubject: string;
  emailTemplate: string;
  smsTemplate: string;
}

export interface FollowUpConfig {
  enabled: boolean;
  delayHours: number;
  emailSubject: string;
  emailTemplate: string;
  smsEnabled: boolean;
  smsTemplate: string;
  steps: FollowUpStep[];
}

const DEFAULT_STEPS: FollowUpStep[] = [
  {
    delayHours: 24,
    emailSubject: "Following up — Your Roofing Proposal",
    emailTemplate: "Hi {customerName},\n\nWe just wanted to follow up regarding the roofing proposal we sent you. Please let us know if you have any questions. We are happy to help.\n\nThank you,\nXRP Roofing Team",
    smsTemplate: "Hi {customerName}, just following up on your roofing proposal. Let us know if you have any questions — we're happy to help! View your proposal here: {proposalLink} — XRP Roofing",
  },
  {
    delayHours: 72,
    emailSubject: "Quick reminder — Your Roofing Proposal",
    emailTemplate: "Hi {customerName},\n\nJust a friendly reminder about the roofing proposal we sent. We'd love to help get your project started. If you have any questions or need changes, feel free to reach out anytime.\n\nBest regards,\nXRP Roofing Team",
    smsTemplate: "Hi {customerName}, just a reminder about your roofing proposal. We'd love to help — let us know if you have any questions! {proposalLink} — XRP Roofing",
  },
  {
    delayHours: 168,
    emailSubject: "Final follow-up — Your Roofing Proposal",
    emailTemplate: "Hi {customerName},\n\nThis is our final follow-up regarding the roofing proposal we sent you. We understand timing is important, so we'll leave the ball in your court. Your proposal link remains active whenever you're ready to move forward.\n\nThank you for considering XRP Roofing.\n\nBest regards,\nXRP Roofing Team",
    smsTemplate: "Hi {customerName}, this is our final follow-up on your roofing proposal. Your proposal remains available whenever you're ready: {proposalLink} — XRP Roofing",
  },
];

const DEFAULT_CONFIG: FollowUpConfig = {
  enabled: true,
  delayHours: 24,
  emailSubject: "Following up — Your Roofing Proposal",
  emailTemplate: DEFAULT_STEPS[0].emailTemplate,
  smsEnabled: false,
  smsTemplate: DEFAULT_STEPS[0].smsTemplate,
  steps: DEFAULT_STEPS,
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

  const stored = data?.payload as Partial<FollowUpConfig> | null;
  const config: FollowUpConfig = stored
    ? {
        ...DEFAULT_CONFIG,
        ...stored,
        steps: stored.steps && stored.steps.length > 0 ? stored.steps : DEFAULT_STEPS,
      }
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
    smsEnabled: body.smsEnabled ?? current.smsEnabled,
    smsTemplate: body.smsTemplate ?? current.smsTemplate,
    steps: body.steps && body.steps.length > 0 ? body.steps : current.steps || DEFAULT_STEPS,
  };

  const { error } = await supabase
    .from("proposal_shares")
    .upsert({ id: CONFIG_ROW_ID, payload: next, updated_at: new Date().toISOString() }, { onConflict: "id" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }

  return NextResponse.json({ config: next });
}
