import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

const MMS_BUCKET = "mms-media";

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const supabase = getAdminClient();
    if (!supabase) return NextResponse.json({ error: "Storage not configured" }, { status: 500 });

    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const path = `${unique}.${ext}`;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error } = await supabase.storage
      .from(MMS_BUCKET)
      .upload(path, bytes, { contentType: file.type, upsert: false });

    if (error) {
      // Bucket may not exist — try creating it then retry
      if (error.message.includes("not found") || error.message.includes("Bucket")) {
        await supabase.storage.createBucket(MMS_BUCKET, { public: true });
        const retry = await supabase.storage
          .from(MMS_BUCKET)
          .upload(path, bytes, { contentType: file.type, upsert: false });
        if (retry.error) return NextResponse.json({ error: retry.error.message }, { status: 500 });
      } else {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    const { data } = supabase.storage.from(MMS_BUCKET).getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
