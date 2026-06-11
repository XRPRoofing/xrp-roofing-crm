import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const triggerSchema = z.object({
  automationId: z.string(),
  automationLabel: z.string(),
  channels: z.object({ email: z.boolean(), sms: z.boolean() }),
  template: z.string(),
  recipient: z.object({
    name: z.string(),
    email: z.string().optional(),
    phone: z.string().optional(),
  }),
  // Zod v4 compatibility: record requires (keyType, valueType) - both arguments required
  variables: z.record(z.string(), z.string()).optional(),
});

function escapeHtml(v: string) {
  return v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function fillTemplate(template: string, variables: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(variables)) {
    out = out.replaceAll(`{${key}}`, value);
  }
  return out;
}

async function sendEmail(to: string, subject: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not configured" };

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://xrp-roofing-crm.vercel.app").replace(/\/+$/, "");
  const logoUrl = `${appUrl}/images/logo.jpeg`;
  const html = `
    <div style="margin:0;background:#f1f5f9;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
        <div style="background:#e9eef3;padding:18px 28px;text-align:center;">
          <img src="${logoUrl}" alt="XRP Roofing" width="140" style="width:140px;max-width:55%;height:auto;display:inline-block;" />
        </div>
        <div style="background:#07183f;padding:20px 28px;color:#fff;">
          <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.16em;opacity:.85;">XRP Roofing CRM</div>
          <div style="font-size:20px;font-weight:900;margin-top:4px;">${escapeHtml(subject)}</div>
        </div>
        <div style="padding:24px 28px;">
          <p style="margin:0;font-size:15px;line-height:1.7;white-space:pre-line;">${escapeHtml(body)}</p>
        </div>
        <div style="background:#f8fafc;padding:16px 28px;border-top:1px solid #e2e8f0;text-align:center;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">XRP Roofing · (602) 555-0100 · xrproofing.com</p>
        </div>
      </div>
    </div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from: "XRP Roofing <noreply@xrproofing.com>", to: [to], subject, html }),
    });
    return res.ok ? { ok: true } : { ok: false, error: `Resend ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "email send failed" };
  }
}

async function sendSms(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  try {
    const res = await fetch(`${appUrl}/api/twilio/sms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, body }),
    });
    return res.ok ? { ok: true } : { ok: false, error: `SMS ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "sms send failed" };
  }
}

export async function POST(req: NextRequest) {
  const parsed = triggerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const { automationId, automationLabel, channels, template, recipient, variables = {} } = parsed.data;
  const vars = { customerName: recipient.name, ...variables };
  const message = fillTemplate(template, vars);
  const results: { channel: string; ok: boolean; error?: string }[] = [];

  if (channels.email && recipient.email) {
    const r = await sendEmail(recipient.email, automationLabel, message);
    results.push({ channel: "email", ...r });
  }
  if (channels.sms && recipient.phone) {
    const r = await sendSms(recipient.phone, message);
    results.push({ channel: "sms", ...r });
  }

  const anyOk = results.some((r) => r.ok);
  const status = results.length === 0 ? "skipped" : anyOk ? "sent" : "failed";

  return NextResponse.json({ automationId, automationLabel, status, results });
}
