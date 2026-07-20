import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import {
  getAdminClient,
  createSignedUrl,
  addAuditEvent,
  getDocumentWithDetails,
  mapRecipientRow,
  loadRecipientsForDocument,
  loadFieldsForDocument,
  getDocumentById,
  enrichDocumentUrls,
  dataUrlToBytes,
  uploadStorageBytes,
  downloadStorageBytes,
  attachDocumentToJobAndCustomer,
} from "@/lib/pdf-signer-server";
import { flattenSignedPdf } from "@/lib/pdf-signer-pdf";
import type { PdfField, PdfRecipient } from "@/lib/pdf-signer-types";

export const runtime = "nodejs";

async function getSigningData(admin: any, token: string) {
  const { data: recRow, error: recError } = await admin
    .from("pdf_document_recipients")
    .select("*")
    .eq("token", token)
    .single();
  if (recError || !recRow) return null;
  const recipient = mapRecipientRow(recRow as Record<string, unknown>);
  if (recipient.tokenExpiresAt && new Date(recipient.tokenExpiresAt) < new Date()) return { error: "expired" };

  const doc = await getDocumentWithDetails(admin, recipient.documentId);
  if (!doc) return null;
  if (["Completed", "Voided", "Expired"].includes(doc.status)) return { error: "completed_or_voided" };

  const originalPdfUrl = await createSignedUrl(admin, doc.originalPdfPath);
  return { doc, recipient, originalPdfUrl };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: "Service role not configured" }, { status: 503 });

  try {
    const { token } = await params;
    const result = await getSigningData(admin, token);
    if (!result) return NextResponse.json({ error: "Invalid signing link" }, { status: 404 });
    if ("error" in result) {
      if (result.error === "expired") return NextResponse.json({ error: "Signing link has expired" }, { status: 410 });
      return NextResponse.json({ error: "This document can no longer be signed" }, { status: 400 });
    }

    const { doc, recipient, originalPdfUrl } = result;
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const ua = req.headers.get("user-agent") || "unknown";

    if (!recipient.openedAt) {
      await admin.from("pdf_document_recipients").update({ opened_at: new Date().toISOString() }).eq("id", recipient.id);
      const viewedAt = new Date().toISOString();
      const current = await getDocumentById(admin, doc.id);
      if (current) {
        await admin.from("pdf_documents").update({ payload: { ...current.payload, viewedAt } }).eq("id", doc.id);
      }
      await addAuditEvent(admin, { documentId: doc.id, recipientId: recipient.id, eventType: "Viewed", actor: recipient.name || "recipient", ipAddress: ip, userAgent: ua });
    }

    return NextResponse.json({
      document: { ...doc, originalPdfUrl },
      recipient,
      fields: doc.fields,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unable to load signing page" }, { status: 500 });
  }
}

const signSchema = z.object({
  values: z.record(z.string(), z.any()).default({}),
  signatures: z.record(z.string(), z.string()).default({}),
  recipientName: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: "Service role not configured" }, { status: 503 });

  try {
    const { token } = await params;
    const result = await getSigningData(admin, token);
    if (!result) return NextResponse.json({ error: "Invalid signing link" }, { status: 404 });
    if ("error" in result) {
      if (result.error === "expired") return NextResponse.json({ error: "Signing link has expired" }, { status: 410 });
      return NextResponse.json({ error: "This document can no longer be signed" }, { status: 400 });
    }
    const { doc, recipient } = result;

    const body = signSchema.parse(await req.json());
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const ua = req.headers.get("user-agent") || "unknown";
    const actor = body.recipientName || recipient.name || "recipient";
    const now = new Date().toISOString();

    const fields = await loadFieldsForDocument(admin, doc.id);
    const signatureMap: Record<string, Uint8Array> = {};
    const updatedFields: PdfField[] = [];

    for (const field of fields) {
      const value = body.values[field.id] ?? body.signatures[field.id];
      if (field.recipientId && field.recipientId !== recipient.id) continue;

      if (field.type === "signature" || field.type === "initials") {
        const sigDataUrl = body.signatures[field.id];
        if (sigDataUrl) {
          const sigBytes = dataUrlToBytes(sigDataUrl);
          if (!sigBytes) return NextResponse.json({ error: `Invalid signature for ${field.label || field.id}` }, { status: 400 });
          const sigPath = `signatures/${doc.id}/${field.id}-${Date.now()}.png`;
          await uploadStorageBytes(admin, sigPath, sigBytes, "image/png");
          signatureMap[sigPath] = sigBytes;
          const updated: PdfField = { ...field, value: sigPath, filledAt: now, filledBy: actor };
          updatedFields.push(updated);
          await admin.from("pdf_document_fields").update({ value: sigPath, filled_at: now, filled_by: actor }).eq("id", field.id);
          await addAuditEvent(admin, { documentId: doc.id, recipientId: recipient.id, eventType: "Field Updated", actor, ipAddress: ip, userAgent: ua, payload: { fieldId: field.id, fieldType: field.type, label: field.label } });
        }
      } else if (value !== undefined && value !== "" && value !== null) {
        const strValue = String(value);
        const updated: PdfField = { ...field, value: strValue, filledAt: now, filledBy: actor };
        updatedFields.push(updated);
        await admin.from("pdf_document_fields").update({ value: strValue, filled_at: now, filled_by: actor }).eq("id", field.id);
        await addAuditEvent(admin, { documentId: doc.id, recipientId: recipient.id, eventType: "Field Updated", actor, ipAddress: ip, userAgent: ua, payload: { fieldId: field.id, fieldType: field.type, label: field.label } });
      }
    }

    const completed = fields.every((f) => (!f.required || (f.value ?? "").toString().length > 0));
    if (completed) {
      const originalBytes = await downloadStorageBytes(admin, doc.originalPdfPath);
      if (!originalBytes) return NextResponse.json({ error: "Original PDF not found" }, { status: 500 });

      // Download any signature images that were stored before this request.
      for (const f of fields) {
        if ((f.type === "signature" || f.type === "initials") && f.value && !signatureMap[f.value]) {
          const b = await downloadStorageBytes(admin, f.value);
          if (b) signatureMap[f.value] = b;
        }
      }

      const flattened = await flattenSignedPdf(originalBytes, fields, signatureMap);
      const signedPath = `signed/${doc.id}/${Date.now()}-signed.pdf`;
      await uploadStorageBytes(admin, signedPath, flattened, "application/pdf");

      await admin.from("pdf_document_recipients").update({ status: "completed", signed_at: now, name: body.recipientName || recipient.name }).eq("id", recipient.id);
      await admin.from("pdf_documents").update({
        status: "Completed",
        signed_pdf_path: signedPath,
        completed_at: now,
        signed_at: now,
        payload: { ...doc.payload, signedBy: actor },
      }).eq("id", doc.id);

      await addAuditEvent(admin, { documentId: doc.id, recipientId: recipient.id, eventType: "Signed", actor, ipAddress: ip, userAgent: ua });
      await addAuditEvent(admin, { documentId: doc.id, recipientId: recipient.id, eventType: "Completed", actor, ipAddress: ip, userAgent: ua });

      const final = await getDocumentById(admin, doc.id);
      if (final) await attachDocumentToJobAndCustomer(admin, final, actor);

      const enriched = await enrichDocumentUrls(admin, await getDocumentWithDetails(admin, doc.id) || final || doc);
      return NextResponse.json({ completed: true, document: enriched, signedPdfUrl: enriched.signedPdfUrl });
    } else {
      await admin.from("pdf_document_recipients").update({ status: "partially_completed" }).eq("id", recipient.id);
      await admin.from("pdf_documents").update({ status: "Partially Completed" }).eq("id", doc.id);
      return NextResponse.json({ completed: false, status: "Partially Completed", fields: await loadFieldsForDocument(admin, doc.id) });
    }
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: "Invalid submission", details: err.issues }, { status: 400 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unable to process signing" }, { status: 500 });
  }
}
