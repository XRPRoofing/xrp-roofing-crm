import { NextRequest, NextResponse } from "next/server";
import { getAdminClient, requireAuthUser, addAuditEvent, getDocumentWithDetails, enrichDocumentUrls } from "@/lib/pdf-signer-server";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase service role not configured" }, { status: 503 });

  try {
    const { id } = await params;
    const doc = await getDocumentWithDetails(admin, id);
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (doc.status === "Voided") return NextResponse.json({ document: await enrichDocumentUrls(admin, doc) });

    const { error } = await admin
      .from("pdf_documents")
      .update({ status: "Voided", updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });

    await addAuditEvent(admin, {
      documentId: id,
      eventType: "Voided",
      actor: user.email || "admin",
    });

    const updated = await getDocumentWithDetails(admin, id);
    if (!updated) return NextResponse.json({ error: "Voided but could not load document" }, { status: 500 });
    return NextResponse.json({ document: await enrichDocumentUrls(admin, updated) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to void document";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
