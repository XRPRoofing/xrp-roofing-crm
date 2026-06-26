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

  const row = {
    id: event.id,
    type: event.type,
    direction: event.direction,
    from_phone: event.from,
    to_phone: event.to,
    body: event.body,
    status: event.status,
    call_sid: event.callSid,
    message_sid: event.messageSid,
    recording_sid: event.recordingSid,
    recording_url: event.recordingUrl,
    conversation_id: event.conversationId,
    payload: event.payload,
    created_at: event.createdAt,
  };

  // Try insert first. On conflict (duplicate id), do a selective update that
  // preserves non-empty body and recording_url — Twilio status callbacks often
  // re-fire with the same id but without Body/recording data, which would
  // otherwise blank out the original content.
  const { error: insertError } = await supabase.from("conversation_events").insert(row);

  const isConflict = insertError && (insertError.code === "23505" || insertError.message.includes("duplicate"));
  if (isConflict) {
    const updateRow: Record<string, unknown> = { ...row };
    delete updateRow.id;
    // Twilio status callbacks (sent→delivered) re-fire with the same id but
    // omit Body, Direction, and recording fields. Preserve these from the
    // original insert so outbound messages keep their body text, correct
    // direction, and recording URL.
    if (!updateRow.body) delete updateRow.body;
    if (!updateRow.recording_url) delete updateRow.recording_url;
    if (!updateRow.conversation_id) delete updateRow.conversation_id;
    delete updateRow.direction;
    delete updateRow.created_at;

    // Preserve Dial-action payload fields (DialCallStatus, DialCallDuration)
    // when a parent-call status callback re-fires without them — losing these
    // turns answered calls into false "Missed call" entries.
    const newPayload = updateRow.payload as Record<string, unknown> | undefined;
    if (newPayload && !newPayload.DialCallStatus) {
      const { data: existing } = await supabase
        .from("conversation_events")
        .select("payload, status")
        .eq("id", row.id)
        .single();
      const existingPayload = existing?.payload as Record<string, unknown> | null;
      if (existingPayload?.DialCallStatus) {
        newPayload.DialCallStatus = existingPayload.DialCallStatus;
        newPayload.DialCallDuration = existingPayload.DialCallDuration;
        updateRow.status = existing!.status;
      }
    }

    const { error: updateError } = await supabase.from("conversation_events").update(updateRow).eq("id", row.id);
    if (updateError) return { stored: false, reason: getConversationEventsErrorMessage(updateError.message) };
    return { stored: true };
  }

  const error = insertError;

  if (error && error.message.includes("recording_url")) {
    const fallbackRow: Record<string, unknown> = { ...row };
    delete fallbackRow.recording_url;
    const fallback = await supabase.from("conversation_events").insert(fallbackRow);
    if (fallback.error) return { stored: false, reason: getConversationEventsErrorMessage(fallback.error.message) };
    return { stored: true };
  }

  if (error) return { stored: false, reason: getConversationEventsErrorMessage(error.message) };

  return { stored: true };
}

function mapConversationEventRow(row: Record<string, unknown>): TwilioConversationEvent {
  return {
    id: String(row.id),
    type: row.type as TwilioConversationEvent["type"],
    direction: row.direction as TwilioConversationEvent["direction"],
    from: row.from_phone ? String(row.from_phone) : undefined,
    to: row.to_phone ? String(row.to_phone) : undefined,
    body: row.body ? String(row.body) : undefined,
    status: row.status ? String(row.status) : undefined,
    callSid: row.call_sid ? String(row.call_sid) : undefined,
    messageSid: row.message_sid ? String(row.message_sid) : undefined,
    conversationId: row.conversation_id ? String(row.conversation_id) : undefined,
    recordingSid: row.recording_sid ? String(row.recording_sid) : row.payload && typeof row.payload === "object" && "RecordingSid" in row.payload ? String((row.payload as Record<string, unknown>).RecordingSid) : undefined,
    recordingUrl: row.recording_url ? String(row.recording_url) : row.payload && typeof row.payload === "object" && "recordingUrl" in row.payload ? String((row.payload as Record<string, unknown>).recordingUrl) : undefined,
    payload: (row.payload as Record<string, unknown>) || {},
    createdAt: String(row.created_at),
  };
}

export async function listConversationEvents(limit = 1000) {
  const supabase = getAdminClient();

  if (!supabase) return { ok: false as const, reason: "Supabase realtime storage is not configured", events: [] };

  // Fetch the newest N events (descending) then reverse to chronological order
  // so conversation building works correctly.
  const { data, error } = await supabase
    .from("conversation_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return { ok: false as const, reason: getConversationEventsErrorMessage(error.message), events: [] };

  return { ok: true as const, events: ((data || []) as Record<string, unknown>[]).map(mapConversationEventRow).reverse() };
}

function getConversationEventsErrorMessage(message: string) {
  if (message.includes("conversation_events") && message.includes("schema cache")) {
    return "Call history table is missing. Run supabase/conversation-events.sql in the Supabase SQL editor.";
  }

  return message;
}


/** Look up the original call event by CallSid to recover From/To phone numbers
 * that may be missing from recording-status callbacks. */
export async function lookupCallEventByCallSid(callSid: string) {
  const supabase = getAdminClient();
  if (!supabase || !callSid) return null;

  const { data } = await supabase
    .from("conversation_events")
    .select("from_phone, to_phone, direction, conversation_id")
    .eq("call_sid", callSid)
    .not("from_phone", "eq", "")
    .order("created_at", { ascending: true })
    .limit(1);

  if (!data || data.length === 0) return null;
  const row = data[0] as { from_phone: string; to_phone: string; direction: string; conversation_id: string | null };
  return { from: row.from_phone, to: row.to_phone, direction: row.direction as "inbound" | "outbound", conversationId: row.conversation_id };
}

export async function listConversationReadStates() {
  const supabase = getAdminClient();

  if (!supabase) return { ok: false as const, reason: "Supabase realtime storage is not configured", readStates: {} as Record<string, string> };

  const { data, error } = await supabase.from("conversation_read_states").select("conversation_id, read_at");

  if (error) return { ok: false as const, reason: getConversationEventsErrorMessage(error.message), readStates: {} as Record<string, string> };

  const readStates = ((data || []) as Array<{ conversation_id: string; read_at: string }>).reduce<Record<string, string>>((current, row) => {
    current[row.conversation_id] = row.read_at;
    return current;
  }, {});

  return { ok: true as const, readStates };
}

export async function markConversationReadState(conversationId: string) {
  const supabase = getAdminClient();

  if (!supabase) return { ok: false as const, reason: "Supabase realtime storage is not configured" };

  const readAt = new Date().toISOString();
  const { error } = await supabase.from("conversation_read_states").upsert({ conversation_id: conversationId, read_at: readAt, updated_at: readAt }, { onConflict: "conversation_id" });

  if (error) return { ok: false as const, reason: getConversationEventsErrorMessage(error.message) };

  return { ok: true as const, readAt };
}
