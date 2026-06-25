import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import { sendConversationSms } from "@/lib/twilio/server";
import { resolveFromNumber } from "@/lib/twilio/numbers";

export const runtime = "nodejs";
export const maxDuration = 60;

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

interface ProposalPayload {
  id: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  status?: string;
  viewedAt?: string;
  followUpSentAt?: string;
  followUpSmsSentAt?: string;
  followUpStepCompleted?: number;
  followUpStepSentAt?: string[];
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

function fillTemplate(template: string, customerName: string, proposalLink?: string): string {
  let result = template.replaceAll("{customerName}", customerName);
  if (proposalLink) result = result.replaceAll("{proposalLink}", proposalLink);
  return result;
}

async function sendFollowUpSms(
  toPhone: string,
  messageBody: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const fromNumber = resolveFromNumber();
    await sendConversationSms({ to: toPhone, body: messageBody, from: fromNumber });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "SMS send failed" };
  }
}

async function sendFollowUpEmail(
  toEmail: string,
  toName: string,
  subject: string,
  messageBody: string,
  proposalLink: string,
  declineLink: string,
  stepNumber: number,
  totalSteps: number,
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not configured" };

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://xrp-roofing-crm.vercel.app").replace(/\/+$/, "");
  const logoUrl = `${appUrl}/images/logo.jpeg`;
  const safeMessage = escapeHtml(messageBody).replaceAll("\n", "<br />");

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
        <div style="text-align:center;margin-top:16px;">
          <a href="${declineLink}" style="display:inline-block;border-radius:999px;background:#f1f5f9;color:#64748b;text-decoration:none;padding:10px 22px;font-weight:600;font-size:13px;border:1px solid #e2e8f0;">Not Interested</a>
        </div>
      </div>
      <div style="background:#f8fafc;padding:16px 28px;border-top:1px solid #e2e8f0;text-align:center;">
        <p style="margin:0;font-size:12px;color:#94a3b8;">XRP Roofing &middot; xrproofing.com</p>
        <p style="margin:4px 0 0;font-size:11px;color:#cbd5e1;">Follow-up ${stepNumber} of ${totalSteps}</p>
      </div>
    </div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: `XRP Roofing <noreply@xrproofing.com>`,
        to: [toEmail],
        subject,
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

  const steps = config.steps && config.steps.length > 0 ? config.steps : DEFAULT_STEPS;

  const { data: rows, error } = await supabase
    .from("proposal_shares")
    .select("id, payload")
    .order("updated_at", { ascending: false })
    .limit(10000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }

  const now = Date.now();
  const results: { proposalId: string; customerName: string; status: string; step?: number; error?: string }[] = [];
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://xrp-roofing-crm.vercel.app").replace(/\/+$/, "");
  const apiUrl = appUrl;

  for (const row of rows || []) {
    if (row.id.startsWith("_")) continue;

    const payload = row.payload as ProposalPayload | null;
    if (!payload) continue;

    if (payload.status !== "Viewed") continue;
    if (!payload.customerEmail && !payload.customerPhone) continue;
    if (!payload.viewedAt) continue;

    const viewedTime = new Date(payload.viewedAt).getTime();
    if (isNaN(viewedTime)) continue;

    const lastStepCompleted = payload.followUpStepCompleted ?? -1;

    if (lastStepCompleted >= steps.length - 1) continue;

    const nextStepIndex = lastStepCompleted + 1;
    const step = steps[nextStepIndex];
    if (!step) continue;

    const stepDelayMs = step.delayHours * 60 * 60 * 1000;
    if (now - viewedTime < stepDelayMs) continue;

    const customerName = payload.customerName || "Valued Customer";
    const proposalLink = `${appUrl}/proposal/${encodeURIComponent(payload.id)}`;
    const declineLink = `${apiUrl}/api/proposals/decline?id=${encodeURIComponent(payload.id)}`;
    const sentVia: string[] = [];

    if (payload.customerEmail) {
      const subject = fillTemplate(step.emailSubject, customerName, proposalLink);
      const message = fillTemplate(step.emailTemplate, customerName, proposalLink);
      const emailResult = await sendFollowUpEmail(
        payload.customerEmail,
        customerName,
        subject,
        message,
        proposalLink,
        declineLink,
        nextStepIndex + 1,
        steps.length,
      );
      if (emailResult.ok) sentVia.push("email");
      else results.push({ proposalId: payload.id, customerName, status: "failed", step: nextStepIndex + 1, error: `Email: ${emailResult.error}` });
    }

    if (config.smsEnabled && payload.customerPhone) {
      const smsMessage = fillTemplate(step.smsTemplate, customerName, proposalLink);
      const smsResult = await sendFollowUpSms(payload.customerPhone, smsMessage);
      if (smsResult.ok) sentVia.push("sms");
      else results.push({ proposalId: payload.id, customerName, status: "failed", step: nextStepIndex + 1, error: `SMS: ${smsResult.error}` });
    }

    if (sentVia.length > 0) {
      const stepSentAt = [...(payload.followUpStepSentAt || [])];
      stepSentAt[nextStepIndex] = new Date().toISOString();

      const updatedPayload = {
        ...payload,
        followUpStepCompleted: nextStepIndex,
        followUpStepSentAt: stepSentAt,
        followUpSentAt: nextStepIndex === 0 ? new Date().toISOString() : payload.followUpSentAt,
        ...(sentVia.includes("sms") ? { followUpSmsSentAt: new Date().toISOString() } : {}),
        followUpSentVia: sentVia.join("+"),
      };
      await supabase
        .from("proposal_shares")
        .upsert({ id: row.id, payload: updatedPayload, updated_at: new Date().toISOString() }, { onConflict: "id" });
      results.push({ proposalId: payload.id, customerName, status: "sent", step: nextStepIndex + 1 });

      const jobId = payload.job && typeof payload.job === "object" ? (payload.job as Record<string, unknown>)?.id as string | undefined : undefined;
      if (jobId) {
        try {
          await supabase.from("crew_activity_log").insert({
            id: `act-pfu${nextStepIndex + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            job_id: jobId,
            job_name: customerName,
            actor: "System",
            action: `Follow-up ${nextStepIndex + 1} of ${steps.length} sent (${sentVia.join(" + ")})`,
            details: `Automated follow-up step ${nextStepIndex + 1} sent to ${payload.customerEmail || payload.customerPhone}`,
            module: "Proposal",
            created_at: new Date().toISOString(),
          });
        } catch { /* ignore */ }
      }
    } else if (!results.some((r) => r.proposalId === payload.id)) {
      results.push({ proposalId: payload.id, customerName, status: "skipped" });
    }
  }

  return NextResponse.json({
    status: "completed",
    sent: results.filter((r) => r.status === "sent").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  });
}
