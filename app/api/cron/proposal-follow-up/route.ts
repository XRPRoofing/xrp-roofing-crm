import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

export const runtime = "nodejs";
export const maxDuration = 60;

const CONFIG_ROW_ID = "_proposal_follow_up_config";

interface FollowUpConfig {
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

interface ProposalPayload {
  id: string;
  customerName?: string;
  customerEmail?: string;
  status?: string;
  viewedAt?: string;
  followUpSentAt?: string;
  [key: string]: unknown;
}

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function escapeHtml(v: string) {
  return v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function fillTemplate(template: string, customerName: string): string {
  return template.replaceAll("{customerName}", customerName);
}

async function sendFollowUpEmail(
  toEmail: string,
  toName: string,
  subject: string,
  messageBody: string,
  proposalLink: string,
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not configured" };

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://xrp-roofing-crm.vercel.app").replace(/\/+$/, "");
  const logoUrl = `${appUrl}/images/logo.jpeg`;
  const safeMessage = escapeHtml(messageBody).replaceAll("\n", "<br />");
  const safeSubject = escapeHtml(subject);

  const html = `
    <div style="margin:0;background:#f1f5f9;padding:0;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
      <div style="background:#e9eef3;padding:28px 0;text-align:center;">
        <img src="${logoUrl}" alt="XRP Roofing" style="width:150px;height:auto;display:inline-block;background:#fff;" />
      </div>
      <div style="max-width:560px;margin:0 auto;background:#fff;padding:38px 32px 46px;line-height:1.7;font-size:16px;">
        <div>${safeMessage}</div>
        <div style="text-align:center;margin-top:30px;">
          <a href="${proposalLink}" style="display:inline-block;border-radius:999px;background:#1768c9;color:#fff;text-decoration:none;padding:12px 25px;font-weight:700;">View Proposal</a>
        </div>
      </div>
      <div style="background:#f8fafc;padding:16px 28px;border-top:1px solid #e2e8f0;text-align:center;">
        <p style="margin:0;font-size:12px;color:#94a3b8;">XRP Roofing &middot; xrproofing.com</p>
      </div>
    </div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: `XRP Roofing <noreply@xrproofing.com>`,
        to: [toEmail],
        subject: safeSubject,
        html,
      }),
    });
    return res.ok ? { ok: true } : { ok: false, error: `Resend ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "email send failed" };
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  // Read follow-up config
  const { data: configRow } = await supabase
    .from("proposal_shares")
    .select("payload")
    .eq("id", CONFIG_ROW_ID)
    .single();

  const config: FollowUpConfig = configRow?.payload
    ? { ...DEFAULT_CONFIG, ...(configRow.payload as Partial<FollowUpConfig>) }
    : DEFAULT_CONFIG;

  if (!config.enabled) {
    return NextResponse.json({ status: "disabled", sent: 0 });
  }

  // Fetch all proposals
  const { data: rows, error } = await supabase
    .from("proposal_shares")
    .select("id, payload")
    .order("updated_at", { ascending: false })
    .limit(10000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }

  const now = Date.now();
  const delayMs = config.delayHours * 60 * 60 * 1000;
  const results: { proposalId: string; customerName: string; status: string; error?: string }[] = [];
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://xrp-roofing-crm.vercel.app").replace(/\/+$/, "");

  for (const row of rows || []) {
    if (row.id.startsWith("_")) continue;

    const payload = row.payload as ProposalPayload | null;
    if (!payload) continue;

    // Only follow up on "Viewed" proposals
    if (payload.status !== "Viewed") continue;

    // Skip if already followed up
    if (payload.followUpSentAt) continue;

    // Skip if no customer email
    if (!payload.customerEmail) continue;

    // Check if enough time has passed since viewed
    if (!payload.viewedAt) continue;
    const viewedTime = new Date(payload.viewedAt).getTime();
    if (isNaN(viewedTime) || now - viewedTime < delayMs) continue;

    const customerName = payload.customerName || "Valued Customer";
    const subject = fillTemplate(config.emailSubject, customerName);
    const message = fillTemplate(config.emailTemplate, customerName);
    const proposalLink = `${appUrl}/proposal/${encodeURIComponent(payload.id)}`;

    const result = await sendFollowUpEmail(payload.customerEmail, customerName, subject, message, proposalLink);

    if (result.ok) {
      // Mark follow-up as sent on the proposal
      const updatedPayload = {
        ...payload,
        followUpSentAt: new Date().toISOString(),
        followUpSentVia: "email",
      };
      await supabase
        .from("proposal_shares")
        .upsert({ id: row.id, payload: updatedPayload, updated_at: new Date().toISOString() }, { onConflict: "id" });
    }

    results.push({
      proposalId: payload.id,
      customerName,
      status: result.ok ? "sent" : "failed",
      ...(result.error ? { error: result.error } : {}),
    });
  }

  return NextResponse.json({
    status: "completed",
    sent: results.filter((r) => r.status === "sent").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  });
}
