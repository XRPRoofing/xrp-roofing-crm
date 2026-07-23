import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import type { TwilioConversationEvent } from "@/types/twilio-conversations";

export function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!key) return null;

  return createClient(url, key, { auth: { persistSession: false } });
}

function toConversationEventRow(event: TwilioConversationEvent) {
  return {
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
}

export async function publishConversationEvent(event: TwilioConversationEvent) {
  const supabase = getAdminClient();

  if (!supabase) return { stored: false, reason: "Supabase realtime storage is not configured" };

  const row = toConversationEventRow(event);

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

export async function appendConversationEvent(event: TwilioConversationEvent) {
  const supabase = getAdminClient();
  if (!supabase) return { stored: false, reason: "Supabase realtime storage is not configured" };

  const { error } = await supabase.from("conversation_events").insert(toConversationEventRow(event));
  const isConflict = error && (error.code === "23505" || error.message.includes("duplicate"));
  if (isConflict) return { stored: false, duplicate: true };
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

  const requested = Math.min(Math.max(Math.floor(limit), 1), 100_000);
  const rows: Record<string, unknown>[] = [];
  const pageSize = 1000;

  for (let offset = 0; offset < requested; offset += pageSize) {
    const pageLimit = Math.min(pageSize, requested - offset);
    const { data, error } = await supabase
      .from("conversation_events")
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + pageLimit - 1);

    if (error) return { ok: false as const, reason: getConversationEventsErrorMessage(error.message), events: [] };
    rows.push(...((data || []) as Record<string, unknown>[]));
    if (!data || data.length < pageLimit) break;
  }

  return { ok: true as const, events: rows.map(mapConversationEventRow).reverse() };
}

/** Read-only lookup of every stored conversation event involving a specific
 * phone number, regardless of how old it is. `listConversationEvents` only
 * returns the most recent `limit` rows globally, so on a busy CRM a customer's
 * older calls/texts fall outside that window and appear "missing". Filtering by
 * the phone's last-10 digits in the database returns that customer's full
 * history and a much smaller payload. Digits are sanitized to a numeric string,
 * so the ilike filter is injection-safe. */
export async function listConversationEventsForPhone(phone: string, limit = 5000) {
  const supabase = getAdminClient();

  if (!supabase) return { ok: false as const, reason: "Supabase realtime storage is not configured", events: [] };

  const digits = (phone || "").replace(/\D/g, "").slice(-10);
  if (digits.length < 10) return { ok: true as const, events: [] };

  const requested = Math.min(Math.max(Math.floor(limit), 1), 100_000);
  const rows: Record<string, unknown>[] = [];
  const pageSize = 1000;

  for (let offset = 0; offset < requested; offset += pageSize) {
    const pageLimit = Math.min(pageSize, requested - offset);
    const { data, error } = await supabase
      .from("conversation_events")
      .select("*")
      .or(`from_phone.ilike.%${digits}%,to_phone.ilike.%${digits}%`)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageLimit - 1);

    if (error) return { ok: false as const, reason: getConversationEventsErrorMessage(error.message), events: [] };
    rows.push(...((data || []) as Record<string, unknown>[]));
    if (!data || data.length < pageLimit) break;
  }

  return { ok: true as const, events: rows.map(mapConversationEventRow).reverse() };
}

function getConversationEventsErrorMessage(message: string) {
  if (message.includes("conversation_events") && message.includes("schema cache")) {
    return "Call history table is missing. Run supabase/conversation-events.sql in the Supabase SQL editor.";
  }

  return message;
}


type AnsweredByCallInfo = {
  from?: string;
  to?: string;
  direction?: "inbound" | "outbound";
};

/** Persist which admin/user answered a given call so it shows durably in the
 * notification bell, Phone call log, and customer-profile history. Stamps every
 * conversation_event row for the CallSid (payload.answeredByName /
 * answeredByUserId) so all existing views pick it up on reload and via the
 * realtime UPDATE subscription.
 *
 * Critically, this is also the answering browser's own durable write of the
 * call: if the Twilio status/recording webhooks were dropped (Vercel `after()`
 * teardown, callback 404, etc.) so NO row exists yet, we insert a COMPLETE
 * call row — with the caller's number and direction — so the call can never be
 * missing from the central call history for any admin, independent of Twilio. */
export async function recordCallAnsweredBy(callSid: string, name: string, userId?: string, info?: AnsweredByCallInfo) {
  const supabase = getAdminClient();
  if (!supabase) return { ok: false as const, reason: "Supabase realtime storage is not configured" };
  if (!callSid || !name) return { ok: false as const, reason: "callSid and name are required" };

  const answeredAt = new Date().toISOString();
  const direction = info?.direction || "inbound";
  const from = info?.from || undefined;
  const to = info?.to || undefined;

  const { data, error } = await supabase
    .from("conversation_events")
    .select("id, payload, from_phone, to_phone")
    .eq("call_sid", callSid);

  if (error) return { ok: false as const, reason: getConversationEventsErrorMessage(error.message) };

  const rows = (data || []) as Array<{ id: string; payload: Record<string, unknown> | null; from_phone: string | null; to_phone: string | null }>;
  if (rows.length === 0) {
    // No event stored yet for this call — the Twilio webhooks that normally
    // create the history row were lost. Insert a COMPLETE row (with caller
    // number + direction) so the call is never missing from Call History,
    // Phone page, or the customer profile for any admin.
    await publishConversationEvent({
      id: `${callSid}-answered-by`,
      type: "call_status",
      status: "answered",
      direction,
      from,
      to,
      callSid,
      body: `Answered by ${name}`,
      payload: {
        answeredByName: name,
        answeredByUserId: userId,
        answeredAt,
        // Mark as a real answered leg so outcome labels read "Answered", not "Missed".
        DialCallStatus: "answered",
        DialCallDuration: "1",
      },
      createdAt: answeredAt,
    });
    return { ok: true as const, updated: 0, inserted: 1 };
  }

  for (const row of rows) {
    const nextPayload = { ...(row.payload || {}), answeredByName: name, answeredByUserId: userId, answeredAt };
    const patch: Record<string, unknown> = { payload: nextPayload };
    // Backfill caller number if a partial row was stored without it.
    if (from && !row.from_phone) patch.from_phone = from;
    if (to && !row.to_phone) patch.to_phone = to;
    await supabase.from("conversation_events").update(patch).eq("id", row.id);
  }

  return { ok: true as const, updated: rows.length, inserted: 0 };
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
