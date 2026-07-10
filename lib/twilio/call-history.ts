import { findTwilioLine } from "@/lib/twilio/numbers";
import type { TwilioConversationEvent } from "@/types/twilio-conversations";

export type NormalizedCallHistoryRecord = {
  callSid: string;
  direction: "inbound" | "outbound";
  from: string;
  to: string;
  customerPhone: string;
  companyLine?: string;
  status: string;
  durationSec: number;
  startAt: string;
  endAt?: string;
  answeredBy?: string;
  recordingUrl?: string;
  summary?: string;
  transcript?: string;
  disposition?: string;
  notes?: string;
  tags: string[];
  forwarded: boolean;
  ivrRouted: boolean;
  recordingProcessing: boolean;
};

type MergedLeg = TwilioConversationEvent & {
  firstAt: string;
  lastAt: string;
  events: TwilioConversationEvent[];
};

const ACTIVE_STATUSES = new Set(["queued", "initiated", "ringing", "in-progress"]);

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function number(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isClientAddress(value?: string) {
  return Boolean(value?.startsWith("client:"));
}

function getStatus(event: TwilioConversationEvent) {
  return text(event.payload?.DialCallStatus || event.status || event.payload?.CallStatus).toLowerCase();
}

function getRootSid(event: TwilioConversationEvent) {
  return text(event.payload?.RootCallSid) || event.callSid || "";
}

function mergeLegEvents(events: TwilioConversationEvent[]) {
  const legs = new Map<string, MergedLeg>();
  for (const event of events) {
    if (!event.callSid || event.type === "call_recording" || event.type === "call_note") continue;
    const previous = legs.get(event.callSid);
    if (!previous) {
      legs.set(event.callSid, { ...event, payload: { ...event.payload }, firstAt: event.createdAt, lastAt: event.createdAt, events: [event] });
      continue;
    }
    const payload = { ...previous.payload };
    for (const [key, value] of Object.entries(event.payload || {})) {
      if (value !== undefined && value !== null && value !== "") payload[key] = value;
    }
    legs.set(event.callSid, {
      ...previous,
      ...event,
      direction: event.direction || previous.direction,
      from: event.from || previous.from,
      to: event.to || previous.to,
      status: event.status || previous.status,
      payload,
      firstAt: new Date(event.createdAt).getTime() < new Date(previous.firstAt).getTime() ? event.createdAt : previous.firstAt,
      lastAt: new Date(event.createdAt).getTime() > new Date(previous.lastAt).getTime() ? event.createdAt : previous.lastAt,
      events: [...previous.events, event],
    });
  }
  return legs;
}

function configuredLineFor(direction: "inbound" | "outbound", legs: MergedLeg[]) {
  let explicitFallback: string | undefined;
  for (const leg of legs) {
    const explicit = text(leg.payload?.OriginalCompanyLine);
    if (!explicit) continue;
    const line = findTwilioLine(explicit);
    if (line) return line.number;
    explicitFallback ||= explicit;
  }
  const preferred = direction === "inbound" ? legs.map((leg) => leg.to) : legs.map((leg) => leg.from);
  for (const phone of preferred) {
    const line = findTwilioLine(phone || "");
    if (line) return line.number;
  }
  for (const leg of legs) {
    for (const phone of [leg.from, leg.to]) {
      const line = findTwilioLine(phone || "");
      if (line) return line.number;
    }
  }
  return explicitFallback;
}

function customerPhoneFor(direction: "inbound" | "outbound", legs: MergedLeg[], companyLine?: string) {
  for (const leg of legs) {
    const explicit = text(leg.payload?.CustomerPhone);
    if (explicit) return explicit;
  }
  const preferred = direction === "inbound" ? legs.map((leg) => leg.from) : legs.map((leg) => leg.to);
  for (const phone of preferred) {
    if (phone && !isClientAddress(phone) && phone !== companyLine && !findTwilioLine(phone)) return phone;
  }
  for (const leg of legs) {
    for (const phone of [leg.from, leg.to]) {
      if (phone && !isClientAddress(phone) && phone !== companyLine && !findTwilioLine(phone)) return phone;
    }
  }
  return "";
}

function dateValues(legs: MergedLeg[], key: "CallStartTime" | "CallEndTime") {
  return legs.flatMap((leg) => leg.events.map((event) => text(event.payload?.[key]))).filter(Boolean);
}

function earliest(values: string[]) {
  return values.reduce((result, value) => new Date(value).getTime() < new Date(result).getTime() ? value : result);
}

function latest(values: string[]) {
  return values.reduce((result, value) => new Date(value).getTime() > new Date(result).getTime() ? value : result);
}

export function normalizeCallHistory(events: TwilioConversationEvent[]): NormalizedCallHistoryRecord[] {
  const legs = mergeLegEvents(events);
  const groups = new Map<string, MergedLeg[]>();
  for (const leg of legs.values()) {
    const rootSid = getRootSid(leg);
    if (!rootSid) continue;
    if (rootSid === leg.callSid && (isClientAddress(leg.from) || isClientAddress(leg.to))) continue;
    const group = groups.get(rootSid) || [];
    group.push(leg);
    groups.set(rootSid, group);
  }

  const rootByLegSid = new Map<string, string>();
  for (const leg of legs.values()) rootByLegSid.set(leg.callSid || "", getRootSid(leg));

  const conferenceNameBySid = new Map<string, string>();
  const conferenceCustomerByName = new Map<string, string>();
  const conferenceParticipantsByName = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.type !== "call_status") continue;
    const friendlyName = text(event.payload?.FriendlyName);
    if (!friendlyName.startsWith("call-")) continue;
    const conferenceSid = text(event.payload?.ConferenceSid);
    if (conferenceSid) conferenceNameBySid.set(conferenceSid, friendlyName);
    if (event.callSid) {
      const participants = conferenceParticipantsByName.get(friendlyName) || new Set<string>();
      participants.add(event.callSid);
      conferenceParticipantsByName.set(friendlyName, participants);
      if (event.payload?.ParticipantLabel === "customer") conferenceCustomerByName.set(friendlyName, event.callSid);
    }
  }

  const conferenceRootByCallSid = new Map<string, string>();
  for (const [friendlyName, customerSid] of conferenceCustomerByName) {
    const rootSid = rootByLegSid.get(customerSid) || rootByLegSid.get(friendlyName.slice("call-".length)) || customerSid;
    conferenceRootByCallSid.set(customerSid, rootSid);
    conferenceRootByCallSid.set(friendlyName.slice("call-".length), rootSid);
    for (const participantSid of conferenceParticipantsByName.get(friendlyName) || []) {
      conferenceRootByCallSid.set(participantSid, rootSid);
    }
  }

  const relatedRootSid = (event: TwilioConversationEvent) => {
    const explicit = text(event.payload?.RootCallSid);
    if (explicit) return explicit;
    if (event.callSid) {
      const direct = rootByLegSid.get(event.callSid) || conferenceRootByCallSid.get(event.callSid);
      if (direct) return direct;
    }
    const friendlyName = conferenceNameBySid.get(text(event.payload?.ConferenceSid));
    const customerSid = friendlyName ? conferenceCustomerByName.get(friendlyName) : undefined;
    return customerSid ? rootByLegSid.get(customerSid) || customerSid : "";
  };

  const recordings = events.filter((event) => event.type === "call_recording");
  const notes = events.filter((event) => event.type === "call_note" && event.callSid);
  const records: NormalizedCallHistoryRecord[] = [];

  for (const [rootSid, groupLegs] of groups) {
    const groupSids = new Set(groupLegs.map((leg) => leg.callSid));
    const rootLeg = groupLegs.find((leg) => leg.callSid === rootSid) || groupLegs[0];
    const rootDirection = groupLegs.map((leg) => text(leg.payload?.RootDirection)).find(Boolean);
    const direction = rootDirection === "inbound" || rootDirection === "outbound"
      ? rootDirection
      : rootLeg.direction === "outbound" ? "outbound" : "inbound";
    const companyLine = configuredLineFor(direction, groupLegs);
    const customerPhone = customerPhoneFor(direction, groupLegs, companyLine);
    const groupEvents = groupLegs.flatMap((leg) => leg.events);
    const ivrRouted = groupEvents.some((event) => {
      const status = getStatus(event);
      return Boolean(event.payload?.ivrDepartment || event.payload?.IvrDepartment || event.payload?.IsRoutedLeg)
        || ["ivr-routed", "ivr_routed", "routing", "routed"].includes(status);
    });
    const forwarded = groupEvents.some((event) => Boolean(
      event.payload?.ForwardedFrom || event.payload?.forwardedFrom || event.payload?.RoutedTo,
    ) || ["forwarded", "forward"].includes(getStatus(event)));

    const groupRecordings = recordings
      .filter((event) => relatedRootSid(event) === rootSid || groupSids.has(event.callSid || ""))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const recording = groupRecordings.find((event) => Boolean(event.recordingUrl || event.payload?.RecordingUrl || event.payload?.recordingUrl));
    const insights = groupRecordings.find((event) => Boolean(
      event.payload?.transcript || event.payload?.TranscriptionText || event.payload?.summary || (event.status === "completed" && event.body),
    ));
    const recordingUrl = recording?.recordingUrl
      || (recording?.payload?.recordingUrl ? text(recording.payload.recordingUrl) : undefined)
      || (recording?.payload?.RecordingUrl ? `${text(recording.payload.RecordingUrl)}.mp3` : undefined);
    const transcript = insights ? text(insights.payload?.transcript || insights.payload?.TranscriptionText) || undefined : undefined;
    const summary = insights ? text(insights.payload?.summary || insights.body) || undefined : undefined;

    const groupNotes = notes
      .filter((event) => groupSids.has(event.callSid || "") || text(event.payload?.RootCallSid) === rootSid)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const note = groupNotes[0];
    const noteTags = Array.isArray(note?.payload?.tags) ? note.payload.tags.filter((tag): tag is string => typeof tag === "string") : [];

    const dialDurations = groupEvents.map((event) => number(event.payload?.DialCallDuration)).filter((value) => value > 0);
    const childDurations = groupEvents
      .filter((event) => Boolean(event.payload?.IsChildLeg || event.payload?.IsRoutedLeg))
      .map((event) => number(event.payload?.CallDuration))
      .filter((value) => value > 0);
    const callDurations = groupEvents.map((event) => number(event.payload?.CallDuration)).filter((value) => value > 0);
    const recordingDuration = number(recording?.payload?.RecordingDuration || recording?.payload?.recordingDuration || insights?.payload?.RecordingDuration);
    const durationSec = recordingDuration
      || Math.max(0, ...dialDurations)
      || Math.max(0, ...(direction === "inbound" ? childDurations : callDurations));

    const answeredByName = groupEvents.map((event) => text(event.payload?.answeredByName)).find(Boolean);
    const answeredByNumber = groupEvents.map((event) => text(event.payload?.AnsweredByNumber)).find(Boolean);
    const dialAnswered = groupEvents.some((event) => {
      const dialStatus = text(event.payload?.DialCallStatus).toLowerCase();
      return dialStatus === "completed" && number(event.payload?.DialCallDuration || event.payload?.CallDuration) > 0;
    });
    const routedLegAnswered = groupEvents.some((event) =>
      Boolean(event.payload?.IsChildLeg || event.payload?.IsRoutedLeg)
      && getStatus(event) === "completed"
      && number(event.payload?.CallDuration) > 0,
    );
    const outboundAnswered = direction === "outbound" && groupEvents.some((event) =>
      getStatus(event) === "completed" && number(event.payload?.CallDuration) > 0,
    );
    const answered = Boolean(recordingUrl || answeredByName || answeredByNumber || dialAnswered || routedLegAnswered || outboundAnswered);

    const statuses = groupEvents.map(getStatus).filter(Boolean);
    const hasTerminal = statuses.some((status) => !ACTIVE_STATUSES.has(status));
    const lastEventAt = latest(groupLegs.map((leg) => leg.lastAt));
    const recentlyActive = !hasTerminal
      && statuses.some((status) => ACTIVE_STATUSES.has(status))
      && Date.now() - new Date(lastEventAt).getTime() < 5 * 60_000;
    let status: string;
    if (recentlyActive) status = "Ringing";
    else if (answered) status = direction === "outbound" ? "Outbound" : ivrRouted ? "Answered · IVR Routed" : "Answered";
    else status = direction === "outbound" ? "No Answer" : ivrRouted ? "Missed · IVR Routed" : "Missed";

    const startValues = [...dateValues(groupLegs, "CallStartTime"), ...groupLegs.map((leg) => leg.firstAt)];
    const endValues = dateValues(groupLegs, "CallEndTime");
    if (hasTerminal) endValues.push(...groupLegs.map((leg) => leg.lastAt));
    const systemTags = [ivrRouted ? "IVR Routed" : "", forwarded ? "Forwarded" : ""].filter(Boolean);
    const tags = Array.from(new Set([...noteTags, ...systemTags]));

    records.push({
      callSid: rootSid,
      direction,
      from: direction === "inbound" ? customerPhone : companyLine || rootLeg.from || "",
      to: direction === "inbound" ? companyLine || rootLeg.to || "" : customerPhone,
      customerPhone,
      companyLine,
      status,
      durationSec,
      startAt: earliest(startValues),
      endAt: endValues.length > 0 ? latest(endValues) : undefined,
      answeredBy: answeredByName || answeredByNumber || undefined,
      recordingUrl,
      summary,
      transcript,
      disposition: text(note?.payload?.disposition) || undefined,
      notes: text(note?.payload?.notes) || undefined,
      tags,
      forwarded,
      ivrRouted,
      recordingProcessing: !summary && groupRecordings.some((event) => event.status === "processing"),
    });
  }

  return records.sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());
}
