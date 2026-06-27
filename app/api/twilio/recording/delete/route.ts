import { NextRequest, NextResponse } from "next/server";
import { getTwilioClient } from "@/lib/twilio/server";
import { getTwilioConfig } from "@/lib/twilio/config";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

const deleteSchema = {
  parse(body: unknown): { callSid: string; recordingSid?: string } {
    if (!body || typeof body !== "object") throw new Error("Invalid payload");
    const obj = body as Record<string, unknown>;
    const callSid = typeof obj.callSid === "string" ? obj.callSid.trim() : "";
    if (!callSid) throw new Error("callSid is required");
    const recordingSid = typeof obj.recordingSid === "string" ? obj.recordingSid.trim() : undefined;
    return { callSid, recordingSid };
  },
};

export async function POST(req: NextRequest) {
  try {
    const parsed = deleteSchema.parse(await req.json().catch(() => null));

    // Delete recording from Twilio if we have a recordingSid
    if (parsed.recordingSid) {
      const config = getTwilioConfig();
      const client = getTwilioClient();
      if (client && config.accountSid) {
        try {
          await client.recordings(parsed.recordingSid).remove();
        } catch {
          // Twilio deletion may fail if already deleted — safe to ignore
        }
      }
    }

    // Delete call_recording events from Supabase for this callSid
    const supabase = getAdminClient();
    if (supabase) {
      const { error } = await supabase
        .from("conversation_events")
        .delete()
        .eq("call_sid", parsed.callSid)
        .eq("type", "call_recording");

      if (error) {
        console.error("[Recording Delete] Supabase deletion failed:", error.message);
        return NextResponse.json({ error: "Failed to delete recording from database" }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, callSid: parsed.callSid });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete recording";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
