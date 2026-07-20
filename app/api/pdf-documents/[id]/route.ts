import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getAdminClient,
  requireAuthUser,
  addAuditEvent,
  getDocumentWithDetails,
  enrichDocumentUrls,
  mapDocumentRow,
  deleteStorageObjects,
  loadFieldsForDocument,
} from "@/lib/pdf-signer-server";

export const runtime = "nodejs";

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  customerName: z.string().optional(),
  customerId: z.string().optional(),
  jobAddress: z.string().optional(),
  jobId: z.string().optional(),
  createdBy: z.string().optional(),
  pdfFileName: z.string().optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase service role not configured" }, { status: 503 });

  try {
    const { id } = await params;
    const doc = await getDocumentWithDetails(admin, id);
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    return NextResponse.json({ document: await enrichDocumentUrls(admin, doc) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to load document";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase service role not configured" }, { status: 503 });

  try {
    const { id } = await params;
    const { data: existing, error: findError } = await admin.from("pdf_documents").select("*").eq("id", id).single();
    if (findError || !existing) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const body = patchSchema.parse(await req.json());
    const row = existing as Record<string, unknown>;
    const currentPayload = (row.payload as Record<string, unknown> | null) || {};

    const nextPayload = { ...currentPayload };
    if (body.customerName !== undefined) nextPayload.customerName = body.customerName;
    if (body.jobAddress !== undefined) nextPayload.jobAddress = body.jobAddress;
    if (body.pdfFileName !== undefined) nextPayload.pdfFileName = body.pdfFileName;

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      payload: nextPayload,
    };
    if (body.title !== undefined) updates.title = body.title;
    if (body.customerId !== undefined) updates.customer_id = body.customerId || null;
    if (body.jobId !== undefined) updates.job_id = body.jobId || null;
    if (body.createdBy !== undefined) updates.created_by = body.createdBy;

    const { error } = await admin.from("pdf_documents").update(updates).eq("id", id);
    if (error) return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });

    await addAuditEvent(admin, {
      documentId: id,
      eventType: "Updated",
      actor: user.email || "admin",
      payload: { fields: Object.keys(body) },
    });

    const doc = await getDocumentWithDetails(admin, id);
    if (!doc) return NextResponse.json({ error: "Document updated but could not be loaded" }, { status: 500 });
    return NextResponse.json({ document: await enrichDocumentUrls(admin, doc) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid update data", details: err.issues }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Unable to update document";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase service role not configured" }, { status: 503 });

  try {
    const { id } = await params;
    const doc = await getDocumentWithDetails(admin, id);
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    if (doc.status !== "Draft") {
      return NextResponse.json(
        { error: "Only Draft documents can be deleted. Use Void to retire a sent/completed document." },
        { status: 400 },
      );
    }

    const fields = await loadFieldsForDocument(admin, id);
    const pathsToDelete: string[] = [doc.originalPdfPath, doc.signedPdfPath].filter(Boolean) as string[];
    for (const field of fields) {
      if (field.value && (field.type === "signature" || field.type === "initials")) {
        pathsToDelete.push(field.value);
      }
    }

    await deleteStorageObjects(admin, pathsToDelete);

    const { error } = await admin.from("pdf_documents").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to delete document";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
