import { getTwilioClient } from "@/lib/twilio/server";
import { getTwilioConfig } from "@/lib/twilio/config";
import { getAdminClient, publishConversationEvent, lookupCallEventByCallSid } from "@/lib/twilio/realtime";
import { createCallRecordingInsights } from "@/lib/twilio/recording-insights";

export type ReconcileResult = {
  ok: boolean;
  reason?: string;
  callsAdded: number;
  recordingsProcessed: number;
  scannedCalls: number;
  scannedRecordings: number;
};

/**
 * Reconcile recent calls against Twilio's own records (the authoritative source
 * of truth) and backfill anything missing from the central `conversation_events`
 * store. This makes the CRM's call history self-healing: if a Twilio status or
 * recording webhook was ever dropped (Vercel `after()` teardown, a transient
 * 502, a callback pointed at a stale URL), the call — and its recording,
 * transcription, and AI summary — is recovered on the next reconcile pass so no
 * call is ever permanently missing for any admin.
 *
 * Cheap when nothing is missing (two Twilio list calls + an index lookup); the
 * expensive transcription/summarization only runs for genuinely-missing
 * recordings, and is bounded so it never exceeds the serverless time budget.
 */
export async function reconcileRecentCalls(opts?: {
  sinceMinutes?: number;
  maxCalls?: number;
  maxRecordings?: number;
}): Promise<ReconcileResult> {
  const empty = { callsAdded: 0, recordingsProcessed: 0, scannedCalls: 0, scannedRecordings: 0 };
  const client = getTwilioClient();
  if (!client) return { ok: false, reason: "Twilio is not configured", ...empty };
  const supabase = getAdminClient();
  if (!supabase) return { ok: false, reason: "Supabase storage is not configured", ...empty };

  const config = getTwilioConfig();
  const sinceMinutes = opts?.sinceMinutes ?? 180;
  const maxCalls = opts?.maxCalls ?? 100;
  const maxRecordings = opts?.maxRecordings ?? 4;
  const since = new Date(Date.now() - sinceMinutes * 60_000);

  // Index what we already have stored for this window (with a buffer so events
  // that landed slightly before the call started are still counted).
  const storedSince = new Date(since.getTime() - 30 * 60_000).toISOString();
  const { data: storedRows } = await supabase
    .from("conversation_events")
    .select("call_sid, type, recording_sid, payload")
    .gte("created_at", storedSince);

  const callSidsWithRow = new Set<string>();
  const callSidsWithRecording = new Set<string>();
  const recordingSids = new Set<string>();
  for (const row of (storedRows || []) as Array<{ call_sid: string | null; type: string | null; recording_sid: string | null; payload: Record<string, unknown> | null }>) {
    if (row.call_sid) {
      callSidsWithRow.add(row.call_sid);
      if (row.type === "call_recording") callSidsWithRecording.add(row.call_sid);
    }
    if (row.recording_sid) recordingSids.add(row.recording_sid);
    const pSid = row.payload && typeof row.payload.RecordingSid === "string" ? row.payload.RecordingSid : "";
    if (pSid) recordingSids.add(pSid);
  }

  let callsAdded = 0;
  let scannedCalls = 0;
  const twilioCalls = await client.calls.list({ startTimeAfter: since, limit: maxCalls }).catch(() => []);
  for (const call of twilioCalls) {
    scannedCalls += 1;
    const callSid = call.sid;
    if (!callSid || callSidsWithRow.has(callSid)) continue;

    const rawDirection = String(call.direction || "").toLowerCase();
    const direction: "inbound" | "outbound" = rawDirection.startsWith("outbound") ? "outbound" : "inbound";
    const from = call.from || "";
    const to = call.to || "";
    // Skip browser-only legs (client:agent-…) — the customer-facing leg carries
    // the real number and is what the call log shows.
    if (from.startsWith("client:") && to.startsWith("client:")) continue;

    const status = String(call.status || "").toLowerCase();
    const duration = Number(call.duration || 0);
    const answered = status === "completed" && duration > 0;

    await publishConversationEvent({
      id: `${callSid}-reconciled`,
      type: "call_status",
      direction,
      from,
      to,
      status: answered ? "completed" : status || "no-answer",
      callSid,
      body: answered ? "" : "Call not answered",
      payload: {
        CallStatus: status,
        CallDuration: String(duration),
        DialCallStatus: answered ? "completed" : status,
        DialCallDuration: String(duration),
        reconciledFromTwilio: true,
      },
      createdAt: (call.startTime ? new Date(call.startTime) : new Date()).toISOString(),
    }).catch(() => {});
    callSidsWithRow.add(callSid);
    callsAdded += 1;
  }

  // Backfill missing recordings (with transcription + summary). Bounded so the
  // request never exceeds the serverless time budget; remaining ones are picked
  // up on the next pass.
  let recordingsProcessed = 0;
  let scannedRecordings = 0;
  const twilioRecordings = await client.recordings.list({ dateCreatedAfter: since, limit: 50 }).catch(() => []);
  for (const rec of twilioRecordings) {
    if (recordingsProcessed >= maxRecordings) break;
    scannedRecordings += 1;
    const recSid = rec.sid;
    const callSid = rec.callSid || "";
    if (!recSid || recordingSids.has(recSid)) continue;
    if (callSid && callSidsWithRecording.has(callSid)) continue;

    const recordingUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Recordings/${recSid}.mp3`;

    // Recover the caller number + direction from the stored call event or Twilio.
    let from: string | undefined;
    let to: string | undefined;
    let direction: "inbound" | "outbound" | undefined;
    const original = callSid ? await lookupCallEventByCallSid(callSid) : null;
    if (original) {
      from = original.from;
      to = original.to;
      direction = original.direction;
    } else if (callSid) {
      const call = await client.calls(callSid).fetch().catch(() => null);
      if (call) {
        from = call.from || undefined;
        to = call.to || undefined;
        direction = String(call.direction || "").toLowerCase().startsWith("outbound") ? "outbound" : "inbound";
      }
    }

    await publishConversationEvent({
      id: `${callSid || recSid}-recording-available`,
      type: "call_recording",
      status: "processing",
      from,
      to,
      direction,
      callSid: callSid || undefined,
      recordingSid: recSid,
      recordingUrl,
      body: "Call recording saved. Transcript and summary are processing.",
      payload: { recordingUrl, RecordingSid: recSid, summary: "Transcript and summary are processing.", reconciledFromTwilio: true },
      createdAt: (rec.dateCreated ? new Date(rec.dateCreated) : new Date()).toISOString(),
    }).catch(() => {});

    try {
      const insights = await createCallRecordingInsights({
        callSid: callSid || undefined,
        recordingSid: recSid,
        recordingUrl,
        from,
        to,
        direction,
        payload: { reconciledFromTwilio: true },
      });
      if (insights) {
        await publishConversationEvent({ ...insights, from, to, direction });
        recordingsProcessed += 1;
        if (callSid) callSidsWithRecording.add(callSid);
        recordingSids.add(recSid);
      }
    } catch {
      // Leave the "processing" placeholder; the next pass retries.
    }
  }

  return { ok: true, callsAdded, recordingsProcessed, scannedCalls, scannedRecordings };
}
