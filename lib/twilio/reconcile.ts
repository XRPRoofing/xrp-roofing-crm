import { appendConversationEvent, getAdminClient } from "@/lib/twilio/realtime";
import { getTwilioClient } from "@/lib/twilio/server";
import { findTwilioLine } from "@/lib/twilio/numbers";
import { createCallRecordingInsights } from "@/lib/twilio/recording-insights";
import type { TwilioConversationEvent } from "@/types/twilio-conversations";

type TwilioCallData = {
  sid: string;
  parentCallSid?: string;
  from: string;
  to: string;
  direction: string;
  status: string;
  duration: string;
  startTime?: Date;
  endTime?: Date;
};

type StoredCallRow = {
  id: string;
  call_sid: string | null;
  type: string;
  status: string | null;
  payload: Record<string, unknown> | null;
};

const ACTIVE_STATUSES = new Set(["queued", "initiated", "ringing", "in-progress"]);
const RECONCILED_METADATA_VERSION = 1;

function toCallData(call: {
  sid: string;
  parentCallSid?: string | null;
  from?: string | null;
  to?: string | null;
  direction?: string | null;
  status?: string | null;
  duration?: string | null;
  startTime?: Date | null;
  endTime?: Date | null;
}): TwilioCallData {
  return {
    sid: call.sid,
    parentCallSid: call.parentCallSid || undefined,
    from: call.from || "",
    to: call.to || "",
    direction: call.direction || "",
    status: call.status || "unknown",
    duration: call.duration || "0",
    startTime: call.startTime || undefined,
    endTime: call.endTime || undefined,
  };
}

function getDirection(call: TwilioCallData): "inbound" | "outbound" {
  return call.direction.toLowerCase().includes("inbound") ? "inbound" : "outbound";
}

function getCompanyLine(root: TwilioCallData, call: TwilioCallData, direction: "inbound" | "outbound") {
  const preferred = direction === "inbound" ? [root.to, call.to, call.from] : [root.from, call.from, call.to];
  for (const value of preferred) {
    const line = findTwilioLine(value);
    if (line) return line.number;
  }
  return direction === "inbound" ? root.to : root.from;
}

function getCustomerPhone(root: TwilioCallData, call: TwilioCallData, direction: "inbound" | "outbound", companyLine: string) {
  const preferred = direction === "inbound" ? [root.from, call.from, call.to] : [root.to, call.to, call.from];
  return preferred.find((value) => value && value !== companyLine && !value.startsWith("client:") && !findTwilioLine(value)) || "";
}

function getRoutedTo(call: TwilioCallData, customerPhone: string) {
  for (const value of [call.to, call.from]) {
    if (!value || value === customerPhone || value.startsWith("client:")) continue;
    if (findTwilioLine(value)) continue;
    return value;
  }
  return undefined;
}

/**
 * Self-heal call history from Twilio's authoritative API. Existing rows are
 * never changed: missing calls, final outcomes, and routing metadata are
 * appended as new conversation events and arrive through the existing realtime
 * subscription.
 */
export async function reconcileRecentCalls(opts?: {
  sinceMinutes?: number;
  maxCalls?: number;
  maxRecordings?: number;
}) {
  const client = getTwilioClient();
  const supabase = getAdminClient();
  if (!client || !supabase) {
    return { ok: false as const, reason: "Twilio or Supabase is not configured", callsAdded: 0, metadataEventsAppended: 0, recordingsAdded: 0 };
  }

  const sinceMinutes = Math.min(Math.max(opts?.sinceMinutes ?? 180, 5), 43_200);
  const maxCalls = Math.min(Math.max(opts?.maxCalls ?? 100, 1), 500);
  const maxRecordings = Math.min(Math.max(opts?.maxRecordings ?? 4, 0), 20);
  const since = new Date(Date.now() - sinceMinutes * 60_000);

  const storedRows: StoredCallRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("conversation_events")
      .select("id, call_sid, type, status, payload")
      .order("created_at", { ascending: false })
      .range(offset, offset + 999);
    if (error) return { ok: false as const, reason: error.message, callsAdded: 0, metadataEventsAppended: 0, recordingsAdded: 0 };
    const page = (data || []) as StoredCallRow[];
    storedRows.push(...page);
    if (page.length < 1000) break;
  }
  const rowsByCallSid = new Map<string, StoredCallRow[]>();
  const storedRecordingSids = new Set<string>();
  const storedRecordingInsightSids = new Set<string>();
  for (const row of storedRows) {
    if (row.call_sid) {
      const rows = rowsByCallSid.get(row.call_sid) || [];
      rows.push(row);
      rowsByCallSid.set(row.call_sid, rows);
    }
    if (row.type === "call_recording") {
      const recordingSid = String(row.payload?.RecordingSid || row.payload?.recordingSid || "");
      if (recordingSid) {
        storedRecordingSids.add(recordingSid);
        if (row.status === "completed" && (row.payload?.transcript || row.payload?.summary)) storedRecordingInsightSids.add(recordingSid);
      }
    }
  }

  const listedCalls = (await client.calls.list({ startTimeAfter: since, limit: maxCalls })).map(toCallData);
  const callBySid = new Map(listedCalls.map((call) => [call.sid, call]));

  async function loadCall(callSid: string) {
    const cached = callBySid.get(callSid);
    if (cached) return cached;
    try {
      const fetched = toCallData(await client!.calls(callSid).fetch());
      callBySid.set(callSid, fetched);
      return fetched;
    } catch {
      return undefined;
    }
  }

  async function loadRootCall(call: TwilioCallData) {
    let root = call;
    const seen = new Set([call.sid]);
    for (let depth = 0; root.parentCallSid && depth < 6; depth += 1) {
      if (seen.has(root.parentCallSid)) break;
      seen.add(root.parentCallSid);
      const parent = await loadCall(root.parentCallSid);
      if (!parent) break;
      root = parent;
    }
    return root;
  }

  const unreconciledSids = [...rowsByCallSid.entries()]
    .filter(([, rows]) => !rows.some((row) =>
      Number(row.payload?.reconciledCallMetadataVersion || 0) >= RECONCILED_METADATA_VERSION
      && row.payload?.ReconciledTerminal === true,
    ))
    .map(([callSid]) => callSid)
    .slice(0, 100);
  for (const callSid of unreconciledSids) await loadCall(callSid);

  let callsAdded = 0;
  let metadataEventsAppended = 0;

  for (const call of callBySid.values()) {
    const existingRows = rowsByCallSid.get(call.sid) || [];
    const terminal = !ACTIVE_STATUSES.has(call.status.toLowerCase());
    const hasFinalMetadata = existingRows.some((row) =>
      Number(row.payload?.reconciledCallMetadataVersion || 0) >= RECONCILED_METADATA_VERSION
      && row.payload?.ReconciledTerminal === true,
    );
    if ((!terminal && existingRows.length > 0) || (terminal && hasFinalMetadata)) continue;

    const root = await loadRootCall(call);
    const rootDirection = getDirection(root);
    const originalCompanyLine = getCompanyLine(root, call, rootDirection);
    const customerPhone = getCustomerPhone(root, call, rootDirection, originalCompanyLine);
    const isChildLeg = root.sid !== call.sid;
    const routedTo = isChildLeg && rootDirection === "inbound" ? getRoutedTo(call, customerPhone) : undefined;
    const duration = Number(call.duration || 0);
    const answered = call.status.toLowerCase() === "completed" && duration > 0;
    const createdAt = (call.endTime || call.startTime || new Date()).toISOString();
    const eventId = `${call.sid}-${terminal ? "final" : "discovered"}-metadata-v${RECONCILED_METADATA_VERSION}`;
    const payload: Record<string, unknown> = {
      CallSid: call.sid,
      CallStatus: call.status,
      CallDuration: duration,
      Direction: call.direction,
      ParentCallSid: call.parentCallSid,
      RootCallSid: root.sid,
      RootDirection: rootDirection,
      OriginalCompanyLine: originalCompanyLine,
      CustomerPhone: customerPhone,
      CallStartTime: call.startTime?.toISOString(),
      CallEndTime: call.endTime?.toISOString(),
      IsChildLeg: isChildLeg,
      IsRoutedLeg: Boolean(routedTo),
      RoutedTo: routedTo,
      AnsweredByNumber: answered ? routedTo : undefined,
      ReconciledTerminal: terminal,
      reconciledCallMetadataVersion: RECONCILED_METADATA_VERSION,
    };
    if (isChildLeg) {
      payload.DialCallStatus = call.status;
      payload.DialCallDuration = duration;
    }

    const event: TwilioConversationEvent = {
      id: eventId,
      type: "call_status",
      direction: rootDirection,
      from: rootDirection === "inbound" ? customerPhone : originalCompanyLine,
      to: rootDirection === "inbound" ? originalCompanyLine : customerPhone,
      status: call.status,
      callSid: call.sid,
      payload,
      createdAt,
    };
    const appended = await appendConversationEvent(event);
    if (appended.stored) {
      metadataEventsAppended += 1;
      if (existingRows.length === 0) callsAdded += 1;
    }
  }

  let recordingsAdded = 0;
  if (maxRecordings > 0) {
    const recordings = await client.recordings.list({ dateCreatedAfter: since, limit: 100 });
    const missing = recordings
      .filter((recording) => !storedRecordingInsightSids.has(recording.sid))
      .sort((a, b) => new Date(b.dateCreated || 0).getTime() - new Date(a.dateCreated || 0).getTime())
      .slice(0, maxRecordings);

    for (const recording of missing) {
      const recordingUrl = `https://api.twilio.com${recording.uri.replace(".json", ".mp3")}`;
      const call = callBySid.get(recording.callSid) || await loadCall(recording.callSid);
      const root = call ? await loadRootCall(call) : undefined;
      const rootDirection = root ? getDirection(root) : undefined;
      const originalCompanyLine = root && rootDirection ? getCompanyLine(root, call || root, rootDirection) : undefined;
      const customerPhone = root && rootDirection && originalCompanyLine
        ? getCustomerPhone(root, call || root, rootDirection, originalCompanyLine)
        : undefined;
      const baseEvent: TwilioConversationEvent = {
        id: `${recording.sid}-reconciled-recording-v${RECONCILED_METADATA_VERSION}`,
        type: "call_recording",
        direction: rootDirection,
        callSid: recording.callSid,
        recordingSid: recording.sid,
        recordingUrl,
        from: rootDirection === "inbound" ? customerPhone : originalCompanyLine,
        to: rootDirection === "inbound" ? originalCompanyLine : customerPhone,
        body: "Call recording saved. Transcript and summary are processing.",
        status: "processing",
        payload: {
          RecordingSid: recording.sid,
          RecordingUrl: recordingUrl.replace(/\.mp3$/, ""),
          RecordingDuration: recording.duration || "0",
          CallSid: recording.callSid,
          RootCallSid: root?.sid || recording.callSid,
          RootDirection: rootDirection,
          OriginalCompanyLine: originalCompanyLine,
          CustomerPhone: customerPhone,
          source: "twilio-reconciliation",
          reconciledCallMetadataVersion: RECONCILED_METADATA_VERSION,
        },
        createdAt: (recording.dateCreated || new Date()).toISOString(),
      };
      if (!storedRecordingSids.has(recording.sid)) {
        const appended = await appendConversationEvent(baseEvent);
        if (appended.stored) recordingsAdded += 1;
      }

      const analysis = await createCallRecordingInsights({
        callSid: recording.callSid,
        recordingSid: recording.sid,
        recordingUrl,
        from: baseEvent.from,
        to: baseEvent.to,
        direction: rootDirection,
        payload: baseEvent.payload || {},
      }).catch(() => null);
      if (analysis) {
        const appended = await appendConversationEvent({
          ...analysis,
          id: `${recording.sid}-reconciled-insights-v${RECONCILED_METADATA_VERSION}`,
          createdAt: new Date().toISOString(),
        });
        if (appended.stored) recordingsAdded += 1;
      }
    }
  }

  return { ok: true as const, callsAdded, metadataEventsAppended, recordingsAdded };
}
