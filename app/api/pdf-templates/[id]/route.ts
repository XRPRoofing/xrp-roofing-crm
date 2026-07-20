import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminClient, requireAuthUser, getTemplateById, enrichTemplateUrl, deleteStorageObjects } from "@/lib/pdf-signer-server";

export const runtime = "nodejs";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  fields: z.array(z.any()).optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase service role not configured" }, { status: 503 });

  try {
    const { id } = await params;
    const template = await getTemplateById(admin, id);
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    return NextResponse.json({ template: await enrichTemplateUrl(admin, template) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to load template";
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
    const body = patchSchema.parse(await req.json());

    const { data: existing, error: findError } = await admin.from("pdf_templates").select("payload").eq("id", id).single();
    if (findError || !existing) return NextResponse.json({ error: "Template not found" }, { status: 404 });

    const currentPayload = (existing as Record<string, unknown>).payload as Record<string, unknown> | undefined;
    const nextPayload = { ...currentPayload };
    if (body.fields) nextPayload.fields = body.fields;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description || null;
    updates.payload = nextPayload;

    const { error } = await admin.from("pdf_templates").update(updates).eq("id", id);
    if (error) return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });

    const template = await getTemplateById(admin, id);
    if (!template) return NextResponse.json({ error: "Template updated but could not be loaded" }, { status: 500 });
    return NextResponse.json({ template: await enrichTemplateUrl(admin, template) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid template data", details: err.issues }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Unable to update template";
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
    const template = await getTemplateById(admin, id);
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

    await deleteStorageObjects(admin, template.pdfPath ? [template.pdfPath] : []);

    const { error } = await admin.from("pdf_templates").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to delete template";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
