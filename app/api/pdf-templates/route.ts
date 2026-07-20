import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminClient, requireAuthUser, mapTemplateRow, downloadStorageBytes } from "@/lib/pdf-signer-server";
import { getPdfPageSize } from "@/lib/pdf-signer-pdf";

export const runtime = "nodejs";

const templateFieldSchema = z.object({
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
});

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  pdfPath: z.string().min(1),
  createdBy: z.string().optional(),
  fields: z.array(templateFieldSchema).optional(),
});

export async function GET(req: NextRequest) {
  const user = await requireAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase service role not configured" }, { status: 503 });

  try {
    const { data, error } = await admin.from("pdf_templates").select("*").order("updated_at", { ascending: false }).limit(200);
    if (error) return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
    const rows = (data || []) as Record<string, unknown>[];
    const templates = rows.map((row) => mapTemplateRow(row));
    return NextResponse.json({ templates });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to load templates";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await requireAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase service role not configured" }, { status: 503 });

  try {
    const body = createSchema.parse(await req.json());
    const id = `TPL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    let fields = body.fields || [];
    if (fields.length === 0) {
      // Default signature field if none provided.
      const originalBytes = await downloadStorageBytes(admin, body.pdfPath);
      const size = originalBytes ? await getPdfPageSize(originalBytes) : null;
      const pageWidth = size?.width ?? 612;
      const pageHeight = size?.height ?? 792;
      const width = 200;
      const height = 60;
      fields = [
        {
          type: "signature",
          label: "Signature",
          page: 0,
          x: Math.max(0, pageWidth - width - 50),
          y: 50,
          width,
          height,
          required: true,
          options: [],
        },
      ];
    }

    const { error } = await admin.from("pdf_templates").insert({
      id,
      name: body.name,
      description: body.description,
      pdf_path: body.pdfPath,
      created_by: body.createdBy || user.email || "admin",
      payload: { fields },
    });
    if (error) return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });

    const { data: row, error: selectError } = await admin.from("pdf_templates").select("*").eq("id", id).single();
    if (selectError || !row) return NextResponse.json({ error: "Template created but could not be loaded" }, { status: 500 });
    const template = mapTemplateRow(row as Record<string, unknown>);
    return NextResponse.json({ template });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid template data", details: err.issues }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Unable to create template";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
