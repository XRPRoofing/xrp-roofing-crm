// Server-side internal notification emails for invoice lifecycle events
// (viewed / paid / failed). Sent to the XRP Roofing office via Resend so the
// team is alerted the moment a customer interacts with an invoice.

export type InvoiceEmailEvent = "viewed" | "paid" | "failed";

type InvoiceEmailInput = {
  event: InvoiceEmailEvent;
  customerName: string;
  invoiceNumber: string;
  amount: number;
  customerEmail?: string;
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

const eventCopy: Record<InvoiceEmailEvent, { label: string; subject: string; accent: string }> = {
  viewed: { label: "Invoice Viewed", subject: "viewed their invoice", accent: "#1768c9" },
  paid: { label: "Payment Received", subject: "completed payment", accent: "#16a34a" },
  failed: { label: "Payment Failed", subject: "had a failed payment", accent: "#dc2626" },
};

/**
 * Send an internal notification email about an invoice event. Returns true when
 * the email was sent, false when email is not configured (RESEND_API_KEY unset)
 * or sending failed. Never throws — callers (webhook, tracker) treat email as
 * best-effort so payment sync is never blocked by an email failure.
 */
export async function sendInternalInvoiceEmail(input: InvoiceEmailInput): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;

  const recipient = process.env.INVOICE_NOTIFICATION_EMAIL || "info@xrproofing.com";
  const logoUrl = `${(process.env.NEXT_PUBLIC_APP_URL || "https://xrp-roofing-crm.vercel.app").replace(/\/+$/, "")}/images/logo.jpeg`;
  const copy = eventCopy[input.event];
  const when = new Date().toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Phoenix",
  });

  const rows: [string, string][] = [
    ["Customer Name", input.customerName || "Unknown customer"],
    ["Invoice Number", input.invoiceNumber],
    ["Amount", currency(input.amount)],
    ["Date & Time", when],
  ];
  if (input.customerEmail) rows.push(["Customer Email", input.customerEmail]);

  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px 0;color:#64748b;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.08em;">${escapeHtml(label)}</td><td style="padding:8px 0;color:#0f172a;font-weight:800;font-size:15px;text-align:right;">${escapeHtml(value)}</td></tr>`,
    )
    .join("");

  const html = `
    <div style="margin:0;background:#f1f5f9;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
        <div style="background:#e9eef3;padding:18px 28px;text-align:center;">
          <img src="${logoUrl}" alt="XRP Roofing" width="140" style="width:140px;max-width:55%;height:auto;display:inline-block;" />
        </div>
        <div style="background:${copy.accent};padding:20px 28px;color:#fff;">
          <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.16em;opacity:.85;">XRP Roofing CRM</div>
          <div style="font-size:22px;font-weight:900;margin-top:4px;">${escapeHtml(copy.label)}</div>
        </div>
        <div style="padding:24px 28px;">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(input.customerName || "A customer")} ${escapeHtml(copy.subject)}.</p>
          <table style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0;">${tableRows}</table>
        </div>
      </div>
    </div>
  `;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: "XRP Roofing CRM <noreply@xrproofing.com>",
        to: [recipient],
        subject: `${copy.label}: ${input.invoiceNumber} — ${input.customerName || "Customer"}`,
        html,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
