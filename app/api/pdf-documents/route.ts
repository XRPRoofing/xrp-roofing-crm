import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getAdminClient,
  requireAuthUser,
  addAuditEvent,
  getDocumentById,
  mapDocumentRow,
  enrichDocumentUrls,
  downloadStorageBytes,
} from "@/lib/pdf-signer-server";
import { getPdfPageSize } from "@/lib/pdf-signer-pdf";
import { type PdfField, type PdfTemplateField } from "@/lib/pdf-signer-types";

export const runtime = "nodejs";

const fieldSchema = z.object({
  type: z.string(),
  label: z.string().optional(),
  placeholder: z.string().optional(),
  page: z.number().int().min(0).default(0),
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().default(150),
  height: z.number().default(40),
  required: z.boolean().default(true),
  options: z.array(z.string()).optional(),
  recipientId: z.string().optional(),
});

const createSchema = z.object({
  title: z.string().min(1),
  customerName: z.string().optional(),
  customerId: z.string().optional(),
  jobAddress: z.string().optional(),
  jobId: z.string().optional(),
  createdBy: z.string().optional(),
  originalPdfPath: z.string().min(1),
  pdfFileName: z.string().optional(),
  templateId: z.string().optional(),
  fields: z.array(fieldSchema).optional(),
});

function newDocId() {
  return `PDF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function GET(req: NextRequest) {
  const user = await requireAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase service role not configured" }, { status: 503 });
  }

  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status");
  const customerId = searchParams.get("customerId");
  const jobId = searchParams.get("jobId");
  const limit = Math.min(Number(searchParams.get("limit") || "50"), 200);
  const offset = Math.max(Number(searchParams.get("offset") || "0"), 0);

  try {
    let query = admin.from("pdf_documents").select("*").order("updated_at", { ascending: false }).range(offset, offset + limit - 1);
    if (status) query = query.eq("status", status);
    if (customerId) query = query.eq("customer_id", customerId);
    if (jobId) query = query.eq("job_id", jobId);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
    }

    const rows = (data || []) as Record<string, unknown>[];
    const docs = rows.map((row) => mapDocumentRow(row));
    const withUrls = await Promise.all(docs.map((d) => enrichDocumentUrls(admin, d)));
    return NextResponse.json({ documents: withUrls });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to load documents";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await requireAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase service role not configured" }, { status: 503 });
  }

  try {
    const body = createSchema.parse(await req.json());
    const id = newDocId();

    const { error } = await admin.from("pdf_documents").insert({
      id,
      title: body.title,
      status: "Draft",
      template_id: body.templateId || null,
      customer_id: body.customerId || null,
      job_id: body.jobId || null,
      created_by: body.createdBy || "XRP Roofing",
      original_pdf_path: body.originalPdfPath,
      payload: {
        customerName: body.customerName,
        jobAddress: body.jobAddress,
        pdfFileName: body.pdfFileName,
      },
    });

    if (error) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
    }

    // Insert provided fields, or create a default signature field positioned at
    // the bottom-right of the first page.
    let fields: PdfTemplateField[] = (body.fields as PdfTemplateField[] | undefined) || [];
    if (fields.length === 0) {
      const originalBytes = await downloadStorageBytes(admin, body.originalPdfPath);
      const size = originalBytes ? await getPdfPageSize(originalBytes) : null;
      const pageWidth = size?.width ?? 612;
      const pageHeight = size?.height ?? 792;
      const width = 200;
      const height = 60;
      fields = [
        {
          type: "signature" as const,
          label: "Signature",
          required: true,
          page: 0,
          x: Math.max(0, pageWidth - width - 50),
          y: 50,
          width,
          height,
          options: [],
        },
      ] as PdfTemplateField[];
    }

    if (fields.length > 0) {
      const fieldRows = fields.map((f) => ({
        document_id: id,
        recipient_id: f.recipientId || null,
        type: f.type,
        label: f.label || null,
        placeholder: f.placeholder || null,
        page: f.page,
        x: f.x,
        y: f.y,
        width: f.width ?? 150,
        height: f.height ?? 40,
        required: f.required !== false,
        options: f.options || [],
      }));
      const { error: fieldError } = await admin.from("pdf_document_fields").insert(fieldRows);
      if (fieldError) {
        // non-fatal: document is created, log field error
        console.error("Failed to insert default fields:", fieldError.message);
      }
    }

    await addAuditEvent(admin, {
      documentId: id,
      eventType: "Created",
      actor: body.createdBy || user.email || "admin",
    });

    const doc = await getDocumentById(admin, id);
    if (!doc) return NextResponse.json({ error: "Document created but could not be loaded" }, { status: 500 });
    return NextResponse.json({ document: await enrichDocumentUrls(admin, doc) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid document data", details: err.issues }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Unable to create document";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
