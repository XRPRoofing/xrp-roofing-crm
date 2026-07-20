import { NextRequest, NextResponse } from "next/server";
import { getAdminClient, requireAuthUser } from "@/lib/pdf-signer-server";
import { PDF_DOCUMENTS_BUCKET } from "@/lib/pdf-signer-types";

export const runtime = "nodejs";

const MAX_PDF_SIZE = 4 * 1024 * 1024; // 4 MB

function generatePath(folder: string, fileName: string) {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
}

export async function POST(req: NextRequest) {
  const user = await requireAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase service role not configured" }, { status: 503 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const folder = (formData.get("folder") as string) || "originals";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const allowedFolders = ["originals", "signatures", "signed", "templates"];
    if (!allowedFolders.includes(folder)) {
      return NextResponse.json({ error: "Invalid folder" }, { status: 400 });
    }

    if (folder === "originals" || folder === "templates") {
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        return NextResponse.json({ error: "Only PDF files are accepted" }, { status: 400 });
      }
      if (file.size > MAX_PDF_SIZE) {
        return NextResponse.json({ error: `File too large. Maximum is ${MAX_PDF_SIZE / 1024 / 1024} MB.` }, { status: 413 });
      }
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
    const path = generatePath(folder, file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());

    let { error } = await admin.storage.from(PDF_DOCUMENTS_BUCKET).upload(path, bytes, {
      contentType: file.type || `application/${ext}`,
      upsert: false,
    });

    if (error && (error.message.includes("not found") || error.message.includes("Bucket"))) {
      await admin.storage.createBucket(PDF_DOCUMENTS_BUCKET, { public: false });
      const retry = await admin.storage.from(PDF_DOCUMENTS_BUCKET).upload(path, bytes, {
        contentType: file.type || `application/${ext}`,
        upsert: false,
      });
      if (retry.error) {
        return NextResponse.json({ error: retry.error.message }, { status: 500 });
      }
    } else if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data } = admin.storage.from(PDF_DOCUMENTS_BUCKET).getPublicUrl(path);
    // For a private bucket, getPublicUrl may not be usable; still return the path.
    // The caller should request a signed URL via the document/template endpoints.
    return NextResponse.json({ path, publicUrl: data?.publicUrl || null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
