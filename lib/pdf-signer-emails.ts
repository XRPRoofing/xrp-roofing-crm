/**
 * Customer-facing email helpers for the PDF signer.
 *
 * Sends signing invitations, reminders, and completion confirmations via Resend.
 * All functions are best-effort and never throw.
 */

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function logoUrl() {
  return `${(process.env.NEXT_PUBLIC_APP_URL || "https://www.xrproofing.app").replace(/\/+$/, "")}/images/logo.jpeg`;
}

function emailShell(title: string, bodyHtml: string) {
  return `
    <div style="margin:0;background:#f1f5f9;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
        <div style="background:#e9eef3;padding:18px 28px;text-align:center;">
          <img src="${logoUrl()}" alt="XRP Roofing" width="140" style="width:140px;max-width:55%;height:auto;display:inline-block;" />
        </div>
        <div style="background:#2563eb;padding:20px 28px;color:#fff;">
          <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.16em;opacity:.85;">XRP Roofing</div>
          <div style="font-size:22px;font-weight:900;margin-top:4px;">${escapeHtml(title)}</div>
        </div>
        <div style="padding:24px 28px;font-size:15px;line-height:1.6;">
          ${bodyHtml}
        </div>
      </div>
    </div>
  `;
}

export async function sendSigningInvitationEmail(input: {
  to: string;
  customerName?: string;
  documentName: string;
  signingUrl: string;
  expiresAt?: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !input.to) return false;

  const expiry = input.expiresAt
    ? new Date(input.expiresAt).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/Phoenix",
      })
    : undefined;

  const body = `
    <p>Hi ${escapeHtml(input.customerName || "there")},</p>
    <p>A document from XRP Roofing is ready for your review and signature:</p>
    <p style="font-weight:800;color:#2563eb;">${escapeHtml(input.documentName)}</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${escapeHtml(input.signingUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;border-radius:10px;padding:14px 28px;font-weight:800;">Review &amp; Sign Document</a>
    </div>
    ${expiry ? `<p style="font-size:13px;color:#64748b;">This secure link expires on ${escapeHtml(expiry)}.</p>` : ""}
    <p style="font-size:13px;color:#64748b;">If the button does not work, copy and paste this link into your browser:<br/><a href="${escapeHtml(input.signingUrl)}" style="color:#2563eb;word-break:break-all;">${escapeHtml(input.signingUrl)}</a></p>
    <p style="font-size:13px;color:#64748b;">Questions? Call us at (623) 300-8097.</p>
  `;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: "XRP Roofing <noreply@xrproofing.com>",
        to: [input.to],
        subject: `Document ready for signature — ${input.documentName}`,
        html: emailShell("Document Ready for Signature", body),
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function sendSigningReminderEmail(input: {
  to: string;
  customerName?: string;
  documentName: string;
  signingUrl: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !input.to) return false;

  const body = `
    <p>Hi ${escapeHtml(input.customerName || "there")},</p>
    <p>This is a friendly reminder that a document from XRP Roofing is still waiting for your signature:</p>
    <p style="font-weight:800;color:#2563eb;">${escapeHtml(input.documentName)}</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${escapeHtml(input.signingUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;border-radius:10px;padding:14px 28px;font-weight:800;">Sign Now</a>
    </div>
    <p style="font-size:13px;color:#64748b;">Questions? Call us at (623) 300-8097.</p>
  `;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: "XRP Roofing <noreply@xrproofing.com>",
        to: [input.to],
        subject: `Reminder: Document waiting for signature — ${input.documentName}`,
        html: emailShell("Document Reminder", body),
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function sendSigningCompleteEmail(input: {
  to: string;
  customerName?: string;
  documentName: string;
  downloadUrl?: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !input.to) return false;

  const downloadSection = input.downloadUrl
    ? `<div style="text-align:center;margin:24px 0;"><a href="${escapeHtml(input.downloadUrl)}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;border-radius:10px;padding:14px 28px;font-weight:800;">Download Signed Copy</a></div>`
    : "";

  const body = `
    <p>Hi ${escapeHtml(input.customerName || "there")},</p>
    <p>Thank you — your document has been signed and is complete:</p>
    <p style="font-weight:800;color:#16a34a;">${escapeHtml(input.documentName)}</p>
    ${downloadSection}
    <p style="font-size:13px;color:#64748b;">If you need another copy later, please contact XRP Roofing.</p>
    <p style="font-size:13px;color:#64748b;">Questions? Call us at (623) 300-8097.</p>
  `;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: "XRP Roofing <noreply@xrproofing.com>",
        to: [input.to],
        subject: `Document completed — ${input.documentName}`,
        html: emailShell("Document Completed", body),
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
