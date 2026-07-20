import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getAdminClient,
  requireAuthUser,
  addAuditEvent,
  getDocumentWithDetails,
  loadRecipientsForDocument,
  signingUrl,
} from "@/lib/pdf-signer-server";
import { sendSigningReminderEmail } from "@/lib/pdf-signer-emails";

export const runtime = "nodejs";

const remindSchema = z.object({ recipientId: z.string().optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase service role not configured" }, { status: 503 });

  try {
    const { id } = await params;
    const { recipientId } = remindSchema.parse(await req.json().catch(() => ({})));
    const actor = user.email || "admin";

    const doc = await getDocumentWithDetails(admin, id);
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (["Completed", "Voided", "Expired"].includes(doc.status)) {
      return NextResponse.json({ error: `Cannot remind on a ${doc.status.toLowerCase()} document` }, { status: 400 });
    }

    let recipients = doc.recipients || [];
    if (!recipients.length) {
      recipients = await loadRecipientsForDocument(admin, id);
    }

    const target = recipientId
      ? recipients.find((r) => r.id === recipientId)
      : recipients.find((r) => r.status === "pending" || r.status === "viewed" || r.status === "partially_completed");

    if (!target || !target.email) {
      return NextResponse.json({ error: "No recipient with an email address to remind" }, { status: 400 });
    }

    const link = signingUrl(target.token);
    void sendSigningReminderEmail({
      to: target.email,
      customerName: target.name,
      documentName: doc.title,
      signingUrl: link,
    });

    await addAuditEvent(admin, {
      documentId: id,
      recipientId: target.id,
      eventType: "Reminder Sent",
      actor,
      payload: { recipientEmail: target.email },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: err.issues }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Unable to send reminder";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
