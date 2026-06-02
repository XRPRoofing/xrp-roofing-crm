import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import type { TwilioConversationEvent } from "@/types/twilio-conversations";

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!key) return null;

  return createClient(url, key, { auth: { persistSession: false } });
}

export async function publishConversationEvent(event: TwilioConversationEvent) {
  const supabase = getAdminClient();

  if (!supabase) return { stored: false, reason: "Supabase realtime storage is not configured" };

  const { error } = await supabase.from("conversation_events").insert({
    id: event.id,
    type: event.type,
    direction: event.direction,
    from_phone: event.from,
    to_phone: event.to,
    body: event.body,
    status: event.status,
    call_sid: event.callSid,
    message_sid: event.messageSid,
    recording_url: event.recordingUrl,
    conversation_id: event.conversationId,
    payload: event.payload,
    created_at: event.createdAt,
  });

  if (error) return { stored: false, reason: error.message };

  return { stored: true };
}
