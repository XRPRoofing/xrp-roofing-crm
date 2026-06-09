import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  toName: z.string().min(1),
  toEmail: z.string().email(),
  subject: z.string().min(1),
  message: z.string().min(1),
  invoiceNumber: z.string().min(1),
  invoiceId: z.string().min(1).optional(),
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
    const logoUrl = new URL("/images/logo.jpeg", data.invoiceLink).toString();
    const payLink = `${data.invoiceLink}${data.invoiceLink.includes("?") ? "&" : "?"}action=pay#pay`;

    // Bulletproof, mobile-first email: table-based layout + table/VML buttons so
    // the View/Pay actions render and stay tappable in Gmail, Apple Mail and
    // Outlook (mobile + desktop).
    const button = (href: string, label: string, fill: string) => `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
        <tr>
          <td align="center" bgcolor="${fill}" style="border-radius:999px;">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="50%" stroke="f" fillcolor="${fill}">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;">${label}</center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-- -->
            <a href="${href}" target="_blank" style="display:block;min-width:200px;padding:14px 28px;border-radius:999px;background:${fill};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;text-decoration:none;text-align:center;">${label}</a>
            <!--<![endif]-->
          </td>
        </tr>
      </table>`;

    const html = `<!DOCTYPE html>
      <html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="x-apple-disable-message-reformatting" />
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
        <title>XRP Roofing Invoice</title>
      </head>
      <body style="margin:0;padding:0;background:#f1f5f9;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;">
          <tr>
            <td align="center" style="padding:0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
                <tr>
                  <td align="center" style="background:#e9eef3;padding:28px 16px;">
                    <img src="${logoUrl}" alt="XRP Roofing" width="150" style="width:150px;max-width:60%;height:auto;display:block;background:#fff;" />
                  </td>
                </tr>
                <tr>
                  <td style="background:#ffffff;padding:32px 24px 40px;font-family:Arial,Helvetica,sans-serif;color:#0f172a;font-size:16px;line-height:1.7;">
                    <div>${safeMessage}</div>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:16px;margin-top:28px;">
                      <tr>
                        <td style="padding:18px;">
                          <div style="font-size:13px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.12em;">Invoice</div>
                          <div style="font-weight:900;color:#07183f;font-size:22px;margin-top:4px;">${escapeHtml(data.invoiceNumber)}</div>
                          <div style="font-weight:900;color:#ea580c;font-size:28px;margin-top:12px;">${escapeHtml(data.balance)}</div>
                          <div style="font-size:13px;color:#475569;margin-top:4px;">Remaining balance due</div>
                        </td>
                      </tr>
                    </table>
                    <div style="margin-top:30px;">${button(data.invoiceLink, "View Invoice", "#07183f")}</div>
                    <div style="margin-top:14px;">${button(payLink, "Pay Invoice", "#1768c9")}</div>
                    <p style="font-size:12px;color:#64748b;margin-top:26px;text-align:center;">Payment options include ACH bank transfer and credit card.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>`;

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
        // Tag with the invoice id so the Resend webhook can map
        // email.delivered / email.opened events back to the invoice.
        ...(data.invoiceId ? { tags: [{ name: "invoice_id", value: data.invoiceId }] } : {}),
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
