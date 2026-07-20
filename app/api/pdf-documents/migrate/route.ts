import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import {
  getAdminClient,
  requireAuthUser,
  addAuditEvent,
  dataUrlToBytes,
  uploadStorageBytes,
  downloadStorageBytes,
  getDocumentById,
  enrichDocumentUrls,
  attachDocumentToJobAndCustomer,
} from "@/lib/pdf-signer-server";
import { getPdfPageSize, flattenSignedPdf } from "@/lib/pdf-signer-pdf";

const migrateSchema = z.object({
  id: z.string().min(1),
  documentName: z.string().min(1),
  customerName: z.string().optional(),
  jobAddress: z.string().optional(),
  createdBy: z.string().optional(),
  status: z.string().optional(),
  pdfDataUrl: z.string().optional(),
  pdfFileName: z.string().optional(),
  signatureDataUrl: z.string().optional(),
  signedBy: z.string().optional(),
  signedAt: z.string().optional(),
  sentAt: z.string().optional(),
  templateId: z.string().optional(),
});

const STATUS_MAP: Record<string, string> = { Draft: "Draft", Sent: "Sent", Viewed: "Viewed", Completed: "Completed", Voided: "Voided", Expired: "Expired" };

function safeName(name: string) { return name.replace(/[^a-zA-Z0-9._-]/g, "_"); }

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await requireAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: "Service role not configured" }, { status: 503 });

  try {
    const body = migrateSchema.parse(await req.json());
    const actor = user.email || "admin";
    const id = body.id;
    const existing = await getDocumentById(admin, id);
    if (existing) return NextResponse.json({ ok: true, document: await enrichDocumentUrls(admin, existing) });

    if (!body.pdfDataUrl) return NextResponse.json({ error: "No PDF to migrate" }, { status: 400 });
    const originalBytes = dataUrlToBytes(body.pdfDataUrl);
    if (!originalBytes) return NextResponse.json({ error: "Invalid PDF data URL" }, { status: 400 });

    const originalPath = `originals/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName(body.documentName || "document")}.pdf`;
    const { error: uploadOriginalError } = await uploadStorageBytes(admin, originalPath, originalBytes, "application/pdf");
    if (uploadOriginalError) return NextResponse.json({ error: uploadOriginalError }, { status: 500 });

    const status = body.signatureDataUrl && body.status === "Completed" ? "Completed" : (STATUS_MAP[body.status || ""] || "Draft");
    const payload: Record<string, unknown> = {
      customerName: body.customerName,
      jobAddress: body.jobAddress,
      pdfFileName: body.pdfFileName,
      sentAt: body.sentAt,
    };

    await admin.from("pdf_documents").insert({
      id,
      title: body.documentName,
      status,
      original_pdf_path: originalPath,
      created_by: body.createdBy || actor,
      payload,
    });

    const size = await getPdfPageSize(originalBytes);
    const pageWidth = size?.width ?? 612;
    const pageHeight = size?.height ?? 792;
    const w = 200, h = 60;
    const fieldRow = {
      document_id: id,
      type: "signature",
      label: "Signature",
      required: true,
      page: 0,
      x: Math.max(0, pageWidth - w - 50),
      y: 50,
      width: w,
      height: h,
      options: [],
    };
    const { data: fieldData } = await admin.from("pdf_document_fields").insert(fieldRow).select("id").single();
    const fieldId = (fieldData?.id as string) || randomUUID();

    let signedPdfPath = "";
    if (status === "Completed" && body.signatureDataUrl) {
      const sigBytes = dataUrlToBytes(body.signatureDataUrl);
      if (sigBytes) {
        const sigPath = `signatures/${id}/${Date.now()}-signature.png`;
        await uploadStorageBytes(admin, sigPath, sigBytes, "image/png");

        const rec = { document_id: id, role: "Customer", name: body.customerName, token: randomUUID(), status: "completed", signed_at: body.signedAt || new Date().toISOString() };
        const { data: recData } = await admin.from("pdf_document_recipients").insert(rec).select("id").single();
        await admin.from("pdf_document_fields").update({ recipient_id: recData?.id, value: sigPath, filled_at: body.signedAt || new Date().toISOString(), filled_by: body.signedBy || actor }).eq("id", fieldId);

        const flat = await flattenSignedPdf(originalBytes, [{ ...fieldRow, id: fieldId, value: sigPath, filledAt: body.signedAt, filledBy: body.signedBy, documentId: id, recipientId: recData?.id as string | undefined } as any as import("@/lib/pdf-signer-types").PdfField], { [sigPath]: sigBytes });
        signedPdfPath = `signed/${id}/${Date.now()}-migrated.pdf`;
        await uploadStorageBytes(admin, signedPdfPath, flat, "application/pdf");

        payload.signedBy = body.signedBy || body.customerName;
        await admin.from("pdf_documents").update({ signed_pdf_path: signedPdfPath, completed_at: body.signedAt || new Date().toISOString(), signed_at: body.signedAt || new Date().toISOString(), payload }).eq("id", id);
      }
    }

    await addAuditEvent(admin, { documentId: id, eventType: "Created", actor, payload: { kind: "legacy_migrated", status } });
    if (status === "Completed") {
      await addAuditEvent(admin, { documentId: id, eventType: "Signed", actor, payload: { signedBy: body.signedBy || body.customerName } });
      await addAuditEvent(admin, { documentId: id, eventType: "Completed", actor });
    }

    const finalDoc = await getDocumentById(admin, id);
    if (!finalDoc) return NextResponse.json({ error: "Migration succeeded but could not load document" }, { status: 500 });
    if (status === "Completed") await attachDocumentToJobAndCustomer(admin, finalDoc, actor);

    return NextResponse.json({ ok: true, document: await enrichDocumentUrls(admin, finalDoc) });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: "Invalid migration payload", details: err.issues }, { status: 400 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Migration failed" }, { status: 500 });
  }
}
