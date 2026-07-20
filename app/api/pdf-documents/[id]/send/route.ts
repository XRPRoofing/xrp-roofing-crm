import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getAdminClient,
  requireAuthUser,
  addAuditEvent,
  getDocumentWithDetails,
  enrichDocumentUrls,
  signingUrl,
  loadFieldsForDocument,
} from "@/lib/pdf-signer-server";
import { sendSigningInvitationEmail } from "@/lib/pdf-signer-emails";
import type { PdfRecipient } from "@/lib/pdf-signer-types";

export const runtime = "nodejs";

const sendSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  role: z.enum(["Customer", "Sales Rep", "Office", "Manager"]).optional(),
  label: z.string().optional(),
  expiresInDays: z.number().int().min(1).max(90).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase service role not configured" }, { status: 503 });

  try {
    const { id } = await params;
    const body = sendSchema.parse(await req.json());

    const doc = await getDocumentWithDetails(admin, id);
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (["Completed", "Voided", "Expired"].includes(doc.status)) {
      return NextResponse.json({ error: `Cannot send a ${doc.status.toLowerCase()} document` }, { status: 400 });
    }

    const expiresInDays = body.expiresInDays ?? 30;
    const tokenExpiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    const actor = user.email || "admin";

    // Reuse an existing pending customer recipient if one exists, otherwise create.
    let recipient: PdfRecipient | null = null;
    const existing = doc.recipients?.find((r) => r.status === "pending" && (body.email ? r.email === body.email : r.role === "Customer"));

    if (existing) {
      const token = crypto.randomUUID();
      const { data, error } = await admin
        .from("pdf_document_recipients")
        .update({
          name: body.name || existing.name,
          email: body.email || existing.email,
          phone: body.phone || existing.phone,
          role: (body.role as PdfRecipient["role"]) || existing.role,
          label: body.label || existing.label,
          token,
          token_expires_at: tokenExpiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select()
        .single();
      if (error || !data) return NextResponse.json({ error: error?.message || "Unable to update recipient" }, { status: 503 });
      recipient = {
        id: data.id as string,
        documentId: data.document_id as string,
        role: data.role as PdfRecipient["role"],
        label: (data.label as string) || undefined,
        name: (data.name as string) || undefined,
        email: (data.email as string) || undefined,
        phone: (data.phone as string) || undefined,
        token: data.token as string,
        tokenExpiresAt: (data.token_expires_at as string) || undefined,
        status: data.status as PdfRecipient["status"],
        openedAt: (data.opened_at as string) || undefined,
        signedAt: (data.signed_at as string) || undefined,
      };
    } else {
      const { data, error } = await admin
        .from("pdf_document_recipients")
        .insert({
          document_id: id,
          role: (body.role as PdfRecipient["role"]) || "Customer",
          label: body.label,
          name: body.name,
          email: body.email,
          phone: body.phone,
          token: crypto.randomUUID(),
          token_expires_at: tokenExpiresAt,
        })
        .select()
        .single();
      if (error || !data) return NextResponse.json({ error: error?.message || "Unable to create recipient" }, { status: 503 });
      recipient = {
        id: data.id as string,
        documentId: data.document_id as string,
        role: data.role as PdfRecipient["role"],
        label: (data.label as string) || undefined,
        name: (data.name as string) || undefined,
        email: (data.email as string) || undefined,
        phone: (data.phone as string) || undefined,
        token: data.token as string,
        tokenExpiresAt: (data.token_expires_at as string) || undefined,
        status: data.status as PdfRecipient["status"],
        openedAt: (data.opened_at as string) || undefined,
        signedAt: (data.signed_at as string) || undefined,
      };
    }

    if (!recipient) return NextResponse.json({ error: "Recipient could not be prepared" }, { status: 500 });

    // Assign unassigned fields to this recipient.
    const fields = await loadFieldsForDocument(admin, id);
    const unassigned = fields.filter((f) => !f.recipientId);
    if (unassigned.length > 0) {
      for (const field of unassigned) {
        await admin.from("pdf_document_fields").update({ recipient_id: recipient.id }).eq("id", field.id);
      }
    }

    // Mark document as Sent and record timestamp.
    const payloadUpdates = { ...doc.payload, sentAt: new Date().toISOString() };
    const { error: updateError } = await admin
      .from("pdf_documents")
      .update({ status: "Sent", updated_at: new Date().toISOString(), payload: payloadUpdates })
      .eq("id", id);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 503 });

    const signingLink = signingUrl(recipient.token);

    await addAuditEvent(admin, {
      documentId: id,
      recipientId: recipient.id,
      eventType: "Sent",
      actor,
      payload: { recipientEmail: recipient.email, tokenExpiresAt },
    });

    // Email is best-effort; if no email provided the UI can copy the link.
    if (recipient.email) {
      void sendSigningInvitationEmail({
        to: recipient.email,
        customerName: recipient.name,
        documentName: doc.title,
        signingUrl: signingLink,
        expiresAt: recipient.tokenExpiresAt,
      });
    }

    const updated = await getDocumentWithDetails(admin, id);
    if (!updated) return NextResponse.json({ error: "Unable to load updated document" }, { status: 500 });

    return NextResponse.json({
      document: await enrichDocumentUrls(admin, updated),
      recipient,
      signingUrl: signingLink,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid send data", details: err.issues }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Unable to send document";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
