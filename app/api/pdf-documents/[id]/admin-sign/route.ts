import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import {
  getAdminClient,
  requireAuthUser,
  addAuditEvent,
  getDocumentWithDetails,
  enrichDocumentUrls,
  dataUrlToBytes,
  uploadStorageBytes,
  downloadStorageBytes,
  attachDocumentToJobAndCustomer,
} from "@/lib/pdf-signer-server";
import { flattenSignedPdf } from "@/lib/pdf-signer-pdf";
import { sendSigningCompleteEmail } from "@/lib/pdf-signer-emails";

export const runtime = "nodejs";

const adminSignSchema = z.object({
  signaturePng: z.string().min(1),
  signedBy: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase service role not configured" }, { status: 503 });

  try {
    const { id } = await params;
    const body = adminSignSchema.parse(await req.json());

    const doc = await getDocumentWithDetails(admin, id);
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (["Completed", "Voided", "Expired"].includes(doc.status)) {
      return NextResponse.json({ error: `Document is already ${doc.status.toLowerCase()}` }, { status: 400 });
    }

    const actor = body.signedBy || user.email || "admin";
    const signatureBytes = dataUrlToBytes(body.signaturePng);
    if (!signatureBytes) {
      return NextResponse.json({ error: "Invalid signature image" }, { status: 400 });
    }

    const signaturePath = `signatures/${id}/${randomUUID()}.png`;
    const { error: uploadError } = await uploadStorageBytes(admin, signaturePath, signatureBytes, "image/png");
    if (uploadError) return NextResponse.json({ error: uploadError }, { status: 500 });

    // Create an admin recipient to own the signature.
    const { data: recipientRow } = await admin
      .from("pdf_document_recipients")
      .insert({
        document_id: id,
        role: "Office",
        name: actor,
        email: user.email,
        token: randomUUID(),
        status: "completed",
        signed_at: new Date().toISOString(),
      })
      .select()
      .single();

    const recipientId = recipientRow?.id as string | undefined;

    // Find or create a signature field for this recipient.
    const signatureFields = doc.fields?.filter((f) => f.type === "signature") || [];
    let targetField = signatureFields.find((f) => !f.recipientId || f.recipientId === recipientId);
    if (!targetField) {
      targetField = signatureFields[0];
    }

    const signedAt = new Date().toISOString();
    if (targetField) {
      await admin
        .from("pdf_document_fields")
        .update({
          recipient_id: recipientId || targetField.recipientId,
          value: signaturePath,
          filled_at: signedAt,
          filled_by: actor,
        })
        .eq("id", targetField.id);
    } else {
      // No signature field exists; create one at a sensible default location.
      const originalBytes = await downloadStorageBytes(admin, doc.originalPdfPath);
      const size = originalBytes ? null : null;
      const { width: pageWidth = 612, height: pageHeight = 792 } = size || { width: 612, height: 792 };
      const width = 200;
      const height = 60;
      await admin.from("pdf_document_fields").insert({
        document_id: id,
        recipient_id: recipientId,
        type: "signature",
        label: "Signature",
        required: true,
        page: 0,
        x: Math.max(0, pageWidth - width - 50),
        y: 50,
        width,
        height,
        value: signaturePath,
        filled_at: signedAt,
        filled_by: actor,
      });
    }

    // Flatten the signed PDF.
    const refreshed = await getDocumentWithDetails(admin, id);
    if (!refreshed) return NextResponse.json({ error: "Unable to load document after field update" }, { status: 500 });

    const originalBytes = await downloadStorageBytes(admin, refreshed.originalPdfPath);
    if (!originalBytes) return NextResponse.json({ error: "Original PDF not found" }, { status: 500 });

    const signatureMap: Record<string, Uint8Array> = {};
    for (const field of refreshed.fields || []) {
      if ((field.type === "signature" || field.type === "initials") && field.value) {
        const bytes = await downloadStorageBytes(admin, field.value);
        if (bytes) signatureMap[field.value] = bytes;
      }
    }

    const flattened = await flattenSignedPdf(originalBytes, refreshed.fields || [], signatureMap);
    const signedPath = `signed/${id}/${Date.now()}-signed.pdf`;
    const { error: signedUploadError } = await uploadStorageBytes(admin, signedPath, flattened, "application/pdf");
    if (signedUploadError) return NextResponse.json({ error: signedUploadError }, { status: 500 });

    const payload = { ...(refreshed.payload || {}), signedBy: actor };
    const { error: updateError } = await admin.from("pdf_documents").update({
      status: "Completed",
      signed_pdf_path: signedPath,
      completed_at: signedAt,
      signed_at: signedAt,
      updated_at: signedAt,
      payload,
    }).eq("id", id);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 503 });

    await addAuditEvent(admin, { documentId: id, recipientId, eventType: "Field Updated", actor, payload: { fieldType: "signature" } });
    await addAuditEvent(admin, { documentId: id, recipientId, eventType: "Signed", actor });
    await addAuditEvent(admin, { documentId: id, recipientId, eventType: "Completed", actor });

    await attachDocumentToJobAndCustomer(admin, { ...refreshed, status: "Completed", signedPdfPath: signedPath, signedBy: actor, signedAt }, actor);

    const finalDoc = await getDocumentWithDetails(admin, id);
    if (!finalDoc) return NextResponse.json({ error: "Document finalized but could not be loaded" }, { status: 500 });
    const enriched = await enrichDocumentUrls(admin, finalDoc);

    // Best-effort completion email to admin/self; there is no customer email at this path.
    if (user.email) {
      void sendSigningCompleteEmail({ to: user.email, documentName: finalDoc.title, downloadUrl: enriched.signedPdfUrl });
    }

    return NextResponse.json({ document: enriched });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid sign payload", details: err.issues }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Unable to sign document";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
