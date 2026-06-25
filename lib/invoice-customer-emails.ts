// Customer-facing notification emails for invoice payment events.
// Sends directly to the customer (not the office).

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function currency(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

type RejectionEmailInput = {
  customerEmail: string;
  customerName: string;
  invoiceNumber: string;
  method: string;
  amount: number;
  rejectionNote: string;
};

/**
 * Send a rejection notification to the customer. Best-effort — never throws.
 */
export async function sendPaymentRejectedEmail(input: RejectionEmailInput): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;

  const logoUrl = `${(process.env.NEXT_PUBLIC_APP_URL || "https://www.xrproofing.app").replace(/\/+$/, "")}/images/logo.jpeg`;
  const when = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Phoenix" });

  const html = `
    <div style="margin:0;background:#f1f5f9;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
        <div style="background:#e9eef3;padding:18px 28px;text-align:center;">
          <img src="${logoUrl}" alt="XRP Roofing" width="140" style="width:140px;max-width:55%;height:auto;display:inline-block;" />
        </div>
        <div style="background:#dc2626;padding:20px 28px;color:#fff;">
          <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.16em;opacity:.85;">XRP Roofing</div>
          <div style="font-size:22px;font-weight:900;margin-top:4px;">Payment Verification Failed</div>
        </div>
        <div style="padding:24px 28px;">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
            Hi ${escapeHtml(input.customerName)},<br/><br/>
            We were unable to verify your recent payment submission for invoice
            <strong>${escapeHtml(input.invoiceNumber)}</strong>.
          </p>
          <table style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0;">
            <tr><td style="padding:8px 0;color:#64748b;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.08em;">Payment Method</td><td style="padding:8px 0;color:#0f172a;font-weight:800;font-size:15px;text-align:right;">${escapeHtml(input.method)}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.08em;">Amount Submitted</td><td style="padding:8px 0;color:#0f172a;font-weight:800;font-size:15px;text-align:right;">${escapeHtml(currency(input.amount))}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.08em;">Date</td><td style="padding:8px 0;color:#0f172a;font-weight:800;font-size:15px;text-align:right;">${escapeHtml(when)}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.08em;">Reason</td><td style="padding:8px 0;color:#dc2626;font-weight:800;font-size:15px;text-align:right;">${escapeHtml(input.rejectionNote)}</td></tr>
          </table>
          <div style="margin-top:20px;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:16px;">
            <p style="margin:0;font-size:14px;font-weight:700;color:#991b1b;line-height:1.5;">
              Your invoice remains unpaid. Please contact XRP Roofing to resolve this issue and resubmit your payment.<br/><br/>
              📞 +1 (623) 300-8097
            </p>
          </div>
        </div>
      </div>
    </div>
  `;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: "XRP Roofing <noreply@xrproofing.com>",
        to: [input.customerEmail],
        subject: `Payment Verification Failed — Invoice ${input.invoiceNumber}`,
        html,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
