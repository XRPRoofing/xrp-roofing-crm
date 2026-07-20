import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminClient, requireAuthUser, dataUrlToBytes, uploadStorageBytes, mapTemplateRow } from "@/lib/pdf-signer-server";
import { getPdfPageSize } from "@/lib/pdf-signer-pdf";
import type { PdfTemplateField } from "@/lib/pdf-signer-types";

const migrateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  pdfDataUrl: z.string().min(1),
  createdBy: z.string().optional(),
  fields: z.array(z.any()).optional(),
});

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await requireAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: "Service role not configured" }, { status: 503 });

  try {
    const body = migrateSchema.parse(await req.json());
    const { data: existing } = await admin.from("pdf_templates").select("id").eq("id", body.id).single();
    if (existing) return NextResponse.json({ ok: true });

    const pdfBytes = dataUrlToBytes(body.pdfDataUrl);
    if (!pdfBytes) return NextResponse.json({ error: "Invalid PDF data URL" }, { status: 400 });

    const path = `templates/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${body.name.replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`;
    const { error: upErr } = await uploadStorageBytes(admin, path, pdfBytes, "application/pdf");
    if (upErr) return NextResponse.json({ error: upErr }, { status: 500 });

    let fields = (body.fields || []) as PdfTemplateField[];
    if (!fields.length) {
      const size = await getPdfPageSize(pdfBytes);
      const pw = size?.width ?? 612;
      const w = 200, h = 60;
      fields = [{ type: "signature", label: "Signature", page: 0, x: Math.max(0, pw - w - 50), y: 50, width: w, height: h, required: true, options: [] }];
    }

    const { error } = await admin.from("pdf_templates").insert({
      id: body.id,
      name: body.name,
      description: body.description,
      pdf_path: path,
      created_by: body.createdBy || user.email || "admin",
      payload: { fields },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 503 });

    const { data: row } = await admin.from("pdf_templates").select("*").eq("id", body.id).single();
    return NextResponse.json({ ok: true, template: row ? mapTemplateRow(row as Record<string, unknown>) : undefined });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: "Invalid migration payload", details: err.issues }, { status: 400 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Template migration failed" }, { status: 500 });
  }
}
