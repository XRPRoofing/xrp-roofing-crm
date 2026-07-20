import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getAdminClient,
  requireAuthUser,
  addAuditEvent,
  loadFieldsForDocument,
  mapFieldRow,
  getDocumentById,
} from "@/lib/pdf-signer-server";

export const runtime = "nodejs";

const fieldSchema = z.object({
  id: z.string().optional(),
  type: z.string(),
  label: z.string().optional(),
  placeholder: z.string().optional(),
  page: z.number().int().min(0).default(0),
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().default(150),
  height: z.number().default(40),
  required: z.boolean().default(true),
  options: z.array(z.string()).default([]),
  recipientId: z.string().optional(),
});

const patchSchema = z.object({
  fields: z.array(fieldSchema),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase service role not configured" }, { status: 503 });

  try {
    const { id } = await params;
    const fields = await loadFieldsForDocument(admin, id);
    return NextResponse.json({ fields });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to load fields";
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
    const { fields } = patchSchema.parse(await req.json());

    // Ensure document exists.
    const doc = await getDocumentById(admin, id);
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const actor = user.email || "admin";
    const upsertedIds: string[] = [];

    for (const field of fields) {
      const row = {
        document_id: id,
        recipient_id: field.recipientId || null,
        type: field.type,
        label: field.label || null,
        placeholder: field.placeholder || null,
        page: field.page,
        x: field.x,
        y: field.y,
        width: field.width,
        height: field.height,
        required: field.required,
        options: field.options,
        updated_at: new Date().toISOString(),
      };

      if (field.id) {
        const { error } = await admin.from("pdf_document_fields").update(row).eq("id", field.id).eq("document_id", id);
        if (!error) upsertedIds.push(field.id);
      } else {
        const { data, error } = await admin.from("pdf_document_fields").insert(row).select("id").single();
        if (!error && data) upsertedIds.push(data.id as string);
      }
    }

    // Touch document updated_at so realtime sync fires.
    await admin.from("pdf_documents").update({ updated_at: new Date().toISOString() }).eq("id", id);

    await addAuditEvent(admin, {
      documentId: id,
      eventType: "Field Updated",
      actor,
      payload: { fieldIds: upsertedIds, count: upsertedIds.length },
    });

    const saved = await loadFieldsForDocument(admin, id);
    return NextResponse.json({ fields: saved });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid field data", details: err.issues }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Unable to update fields";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
