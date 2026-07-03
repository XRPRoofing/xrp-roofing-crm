// Customer-facing notification emails for invoice payment events.
// Sends directly to the customer (not the office).

export type PaymentReceiptInput = {
  customerEmail: string;
  customerName: string;
  invoiceNumber: string;
  amount: number;
  method: string;
  reference?: string;
  propertyAddress?: string;
  lineItems?: { description: string; quantity: number; unitPrice: number; tax: number }[];
  discount?: number;
};

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

/**
 * Send a payment receipt email to the customer after successful payment.
 * Best-effort — never throws.
 */
export async function sendPaymentReceiptEmail(input: PaymentReceiptInput): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !input.customerEmail) return false;

  const logoUrl = `${(process.env.NEXT_PUBLIC_APP_URL || "https://www.xrproofing.app").replace(/\/+$/, "")}/images/logo.jpeg`;
  const when = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Phoenix" });

  const lineItemRows = (input.lineItems || [])
    .map(
      (item) =>
        `<tr><td style="padding:6px 0;color:#334155;font-size:13px;">${escapeHtml(item.description)}</td><td style="padding:6px 0;color:#334155;font-size:13px;text-align:center;">${item.quantity}</td><td style="padding:6px 0;color:#0f172a;font-weight:700;font-size:13px;text-align:right;">${escapeHtml(currency(item.quantity * item.unitPrice))}</td></tr>`,
    )
    .join("");

  const subtotal = (input.lineItems || []).reduce((t, i) => t + i.quantity * i.unitPrice, 0);
  const taxTotal = (input.lineItems || []).reduce((t, i) => t + i.quantity * i.unitPrice * (i.tax / 100), 0);
  const discount = input.discount || 0;
  const grandTotal = Math.max(subtotal + taxTotal - discount, 0);

  const lineItemsSection = lineItemRows
    ? `<table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
        <tr style="border-bottom:2px solid #e2e8f0;">
          <th style="padding:8px 0;text-align:left;font-size:11px;font-weight:800;text-transform:uppercase;color:#64748b;">Description</th>
          <th style="padding:8px 0;text-align:center;font-size:11px;font-weight:800;text-transform:uppercase;color:#64748b;">Qty</th>
          <th style="padding:8px 0;text-align:right;font-size:11px;font-weight:800;text-transform:uppercase;color:#64748b;">Amount</th>
        </tr>
        ${lineItemRows}
      </table>
      <table style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0;">
        <tr><td style="padding:4px 0;font-size:13px;color:#64748b;">Subtotal</td><td style="padding:4px 0;text-align:right;font-size:13px;font-weight:700;">${escapeHtml(currency(subtotal))}</td></tr>
        ${taxTotal > 0 ? `<tr><td style="padding:4px 0;font-size:13px;color:#64748b;">Tax</td><td style="padding:4px 0;text-align:right;font-size:13px;font-weight:700;">${escapeHtml(currency(taxTotal))}</td></tr>` : ""}
        ${discount > 0 ? `<tr><td style="padding:4px 0;font-size:13px;color:#64748b;">Discount</td><td style="padding:4px 0;text-align:right;font-size:13px;font-weight:700;color:#16a34a;">-${escapeHtml(currency(discount))}</td></tr>` : ""}
        <tr style="border-top:2px solid #0f172a;"><td style="padding:8px 0;font-size:15px;font-weight:900;">Total Paid</td><td style="padding:8px 0;text-align:right;font-size:15px;font-weight:900;">${escapeHtml(currency(grandTotal > 0 ? grandTotal : input.amount))}</td></tr>
      </table>`
    : "";

  const html = `
    <div style="margin:0;background:#f1f5f9;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
        <div style="background:#e9eef3;padding:18px 28px;text-align:center;">
          <img src="${logoUrl}" alt="XRP Roofing" width="140" style="width:140px;max-width:55%;height:auto;display:inline-block;" />
        </div>
        <div style="background:#16a34a;padding:20px 28px;color:#fff;">
          <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.16em;opacity:.85;">XRP Roofing</div>
          <div style="font-size:22px;font-weight:900;margin-top:4px;">Payment Receipt</div>
        </div>
        <div style="padding:24px 28px;">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
            Hi ${escapeHtml(input.customerName || "Valued Customer")},<br/><br/>
            Thank you for your payment! This email confirms that your payment has been received and processed successfully.
          </p>
          <table style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0;margin-bottom:16px;">
            <tr><td style="padding:8px 0;color:#64748b;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.08em;">Invoice</td><td style="padding:8px 0;color:#0f172a;font-weight:800;font-size:15px;text-align:right;">${escapeHtml(input.invoiceNumber)}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.08em;">Amount Paid</td><td style="padding:8px 0;color:#16a34a;font-weight:800;font-size:15px;text-align:right;">${escapeHtml(currency(input.amount))}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.08em;">Payment Method</td><td style="padding:8px 0;color:#0f172a;font-weight:800;font-size:15px;text-align:right;">${escapeHtml(input.method)}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.08em;">Date</td><td style="padding:8px 0;color:#0f172a;font-weight:800;font-size:15px;text-align:right;">${escapeHtml(when)}</td></tr>
            ${input.reference ? `<tr><td style="padding:8px 0;color:#64748b;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.08em;">Reference</td><td style="padding:8px 0;color:#0f172a;font-weight:800;font-size:15px;text-align:right;">${escapeHtml(input.reference)}</td></tr>` : ""}
            ${input.propertyAddress ? `<tr><td style="padding:8px 0;color:#64748b;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.08em;">Property</td><td style="padding:8px 0;color:#0f172a;font-weight:800;font-size:15px;text-align:right;">${escapeHtml(input.propertyAddress)}</td></tr>` : ""}
          </table>
          ${lineItemsSection}
          <div style="margin-top:20px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;text-align:center;">
            <p style="margin:0;font-size:14px;font-weight:700;color:#166534;line-height:1.5;">
              PAID IN FULL<br/>
              <span style="font-size:12px;font-weight:400;color:#15803d;">Please keep this email as your receipt for your records.</span>
            </p>
          </div>
          <div style="margin-top:20px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5;">
              Thank you for choosing XRP Roofing!<br/>
              Questions? Call us at (623) 300-8097
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
        subject: `Payment Receipt — Invoice ${input.invoiceNumber} — XRP Roofing`,
        html,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
