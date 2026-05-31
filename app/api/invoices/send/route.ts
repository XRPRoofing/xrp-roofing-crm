import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  toName: z.string().min(1),
  toEmail: z.string().email(),
  subject: z.string().min(1),
  message: z.string().min(1),
  invoiceNumber: z.string().min(1),
  invoiceLink: z.string().url(),
  balance: z.string().min(1),
});

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function POST(req: NextRequest) {
  try {
    const data = schema.parse(await req.json());
    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {
      throw new Error("RESEND_API_KEY not set");
    }

    const safeMessage = escapeHtml(data.message).replaceAll("\n", "<br />");
    const html = `
      <div style="margin:0;background:#f1f5f9;padding:0;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
        <div style="background:#e9eef3;padding:28px 0;text-align:center;">
          <img src="${new URL("/images/logo.png", data.invoiceLink).toString()}" alt="XRP Roofing" style="width:150px;height:auto;display:inline-block;background:#fff;" />
        </div>
        <div style="max-width:560px;margin:0 auto;background:#fff;padding:38px 32px 46px;line-height:1.7;font-size:16px;">
          <div>${safeMessage}</div>
          <div style="border:1px solid #e2e8f0;border-radius:16px;padding:18px;margin-top:28px;">
            <div style="font-size:13px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.12em;">Invoice</div>
            <div style="font-weight:900;color:#07183f;font-size:22px;margin-top:4px;">${escapeHtml(data.invoiceNumber)}</div>
            <div style="font-weight:900;color:#ea580c;font-size:28px;margin-top:12px;">${escapeHtml(data.balance)}</div>
            <div style="font-size:13px;color:#475569;margin-top:4px;">Remaining balance due</div>
          </div>
          <div style="text-align:center;margin-top:30px;">
            <a href="${data.invoiceLink}" style="display:inline-block;border-radius:999px;background:#1768c9;color:#fff;text-decoration:none;padding:12px 25px;font-weight:700;">View & Pay Invoice</a>
          </div>
          <p style="font-size:12px;color:#64748b;margin-top:26px;text-align:center;">Payment options include ACH bank transfer and credit card.</p>
        </div>
      </div>
    `;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: "XRP Roofing <noreply@xrproofing.com>",
        to: [data.toEmail],
        subject: data.subject,
        html,
      }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid invoice email data", details: error.issues }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unable to send invoice email";
    return NextResponse.json({ error: message.includes("RESEND_API_KEY") ? "Email service is not configured" : "Unable to send invoice email" }, { status: 500 });
  }
}
