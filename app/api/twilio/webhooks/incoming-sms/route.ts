import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeTwilioWebhookEvent } from "@/lib/twilio/server";
import { getTwilioConfig } from "@/lib/twilio/config";
import { publishConversationEvent } from "@/lib/twilio/realtime";
import { ensureCustomerFromLeadServer } from "@/lib/customers/ensure-server";
import { getLeadSourceForNumber } from "@/lib/twilio/numbers";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

const MMS_BUCKET = "mms-media";

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function reHostMedia(payload: Record<string, unknown>): Promise<string[]> {
  const numMedia = Number(payload.NumMedia || 0);
  if (numMedia === 0) return [];

  const supabase = getAdminClient();
  if (!supabase) return [];

  const config = getTwilioConfig();
  const authHeader = "Basic " + Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");

  const publicUrls: string[] = [];

  for (let i = 0; i < numMedia; i++) {
    const twilioUrl = String(payload[`MediaUrl${i}`] || "");
    if (!twilioUrl.startsWith("http")) continue;

    try {
      const res = await fetch(twilioUrl, { headers: { Authorization: authHeader } });
      if (!res.ok) continue;

      const contentType = res.headers.get("content-type") || "image/jpeg";
      const ext = contentType.includes("png") ? "png"
        : contentType.includes("gif") ? "gif"
        : contentType.includes("webp") ? "webp"
        : contentType.includes("quicktime") ? "mov"
        : contentType.includes("mp4") ? "mp4"
        : contentType.includes("3gpp") ? "3gp"
        : contentType.includes("webm") ? "webm"
        : contentType.includes("pdf") ? "pdf"
        : "jpg";
      const bytes = new Uint8Array(await res.arrayBuffer());
      const path = `inbound-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      let uploadErr = (await supabase.storage.from(MMS_BUCKET).upload(path, bytes, { contentType, upsert: false })).error;
      if (uploadErr && (uploadErr.message.includes("not found") || uploadErr.message.includes("Bucket"))) {
        await supabase.storage.createBucket(MMS_BUCKET, { public: true });
        uploadErr = (await supabase.storage.from(MMS_BUCKET).upload(path, bytes, { contentType, upsert: false })).error;
      }
      if (uploadErr) continue;

      const { data } = supabase.storage.from(MMS_BUCKET).getPublicUrl(path);
      publicUrls.push(data.publicUrl);
    } catch {
      continue;
    }
  }

  return publicUrls;
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const event = normalizeTwilioWebhookEvent("incoming_sms", formData);

  const publicUrls = await reHostMedia(event.payload);
  if (publicUrls.length > 0) {
    event.payload.mediaUrls = publicUrls;
  }

  await publishConversationEvent(event);
  // Inbound SMS = a lead. Auto-create/update the customer (best-effort).
  try {
    const source = getLeadSourceForNumber(event.to || "", "Inbound SMS");
    await ensureCustomerFromLeadServer({ name: event.from, phone: event.from, status: "New lead", source });
  } catch {}

  return new NextResponse("<Response></Response>", { headers: { "Content-Type": "text/xml" } });
}
