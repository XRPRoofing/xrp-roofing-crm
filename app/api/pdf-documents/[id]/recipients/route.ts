import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getAdminClient,
  requireAuthUser,
  addAuditEvent,
  getDocumentById,
  loadRecipientsForDocument,
  mapRecipientRow,
} from "@/lib/pdf-signer-server";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

const recipientSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  role: z.enum(["Customer", "Sales Rep", "Office", "Manager"]).optional(),
  label: z.string().optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase service role not configured" }, { status: 503 });

  try {
    const { id } = await params;
    const recipients = await loadRecipientsForDocument(admin, id);
    return NextResponse.json({ recipients });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to load recipients";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase service role not configured" }, { status: 503 });

  try {
    const { id } = await params;
    const doc = await getDocumentById(admin, id);
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const body = recipientSchema.parse(await req.json());

    const { data, error } = await admin
      .from("pdf_document_recipients")
      .insert({
        document_id: id,
        name: body.name || null,
        email: body.email || null,
        phone: body.phone || null,
        role: body.role || "Customer",
        label: body.label || null,
        token: randomUUID(),
        token_expires_at: null,
        status: "pending",
      })
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Unable to create recipient" }, { status: 503 });
    }

    await addAuditEvent(admin, {
      documentId: id,
      eventType: "Recipient Added",
      actor: user.email || "admin",
      payload: { recipientId: data.id, role: body.role || "Customer" },
    });

    const recipients = await loadRecipientsForDocument(admin, id);
    return NextResponse.json({ recipient: mapRecipientRow(data), recipients });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid recipient data", details: err.issues }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Unable to create recipient";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
