import { customers, leads } from "@/lib/crm-data";
import { addUniqueCrmNotification } from "@/lib/crm-notifications";
import type { TwilioConversationEvent } from "@/types/twilio-conversations";

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function formatPhoneIdentity(value: string) {
  return value.trim() || "Unknown number";
}

function findContactName(phone: string) {
  const normalized = normalizePhone(phone);
  const lead = leads.find((item) => normalizePhone(item.phone) === normalized);
  const customer = customers.find((item) => normalizePhone(item.phone) === normalized);
  return customer?.name || lead?.name || formatPhoneIdentity(phone);
}

export function getTwilioEventPhone(event: TwilioConversationEvent) {
  return event.direction === "outbound" ? event.to || event.from || "" : event.from || event.to || "";
}

export function getTwilioCallOutcomeLabel(event: TwilioConversationEvent) {
  const status = (event.status || "").toLowerCase();
  const payloadStatus = String(event.payload.CallStatus || "").toLowerCase();
  const answeredBy = String(event.payload.AnsweredBy || "").toLowerCase();
  const dialCallStatus = String(event.payload.DialCallStatus || "").toLowerCase();

  // Prefer DialCallDuration (actual agent conversation time) over CallDuration
  // (parent call time which includes IVR).
  const duration = Number(event.payload.DialCallDuration || event.payload.CallDuration || 0);
  const effectiveStatus = status || payloadStatus;

  const isOutbound = event.direction === "outbound";
  if (event.type === "call_recording") return "Call recorded with summary";

  // incoming_call events are published the moment a call arrives. They have no
  // terminal status yet, so label them as "Incoming Call".
  if (event.type === "incoming_call") return "Incoming Call";

  // When DialCallStatus is present (from a <Dial> action callback), use it for
  // the most accurate outcome — it reflects the actual agent/forwarded leg.
  if (dialCallStatus) {
    if (!isOutbound && ["no-answer", "busy", "failed", "canceled"].includes(dialCallStatus)) return "Missed call";
    if (!isOutbound && dialCallStatus === "completed" && duration === 0) return "Missed call";
    if (isOutbound && ["no-answer", "busy", "failed", "canceled"].includes(dialCallStatus)) return "No answer";
    if (isOutbound && dialCallStatus === "completed" && duration === 0) return "No answer";
    if (dialCallStatus === "completed" && duration > 0) return "Completed call";
  }

  // For inbound completed calls without DialCallStatus (parent-call status
  // callbacks), CallDuration includes IVR time — not agent conversation time.
  // No Dial verb was involved for this event, so treat as a missed call.  If a
  // real Dial-action event also exists for this call, the UI suppresses this
  // less-specific event anyway.
  if (!isOutbound && !dialCallStatus && effectiveStatus === "completed") return "Missed call";

  if (!isOutbound && ["no-answer", "busy", "failed", "canceled", "missed"].includes(effectiveStatus)) return "Missed call";
  if (!isOutbound && effectiveStatus === "completed" && duration === 0) return "Missed call";
  if (isOutbound && ["no-answer", "busy", "failed", "canceled"].includes(effectiveStatus)) return "No answer";
  if (isOutbound && effectiveStatus === "completed" && duration === 0) return "No answer";
  if (effectiveStatus === "in-progress" || effectiveStatus === "answered" || answeredBy) return "Answered call";
  if (effectiveStatus === "completed") return "Completed call";
  if (effectiveStatus === "ringing") return "Ringing call";
  if (effectiveStatus === "initiated" || effectiveStatus === "queued") return "Call started";

  // IVR-routed events: the caller pressed a digit but the call hasn't reached
  // a terminal state yet via this event alone.
  if (effectiveStatus === "ivr-routed") return "Incoming Call";

  return "Call activity";
}

export function createTwilioCrmNotification(event: TwilioConversationEvent) {
  const phone = getTwilioEventPhone(event);
  const name = findContactName(phone);
  const direction = event.direction === "outbound" ? "Outbound" : "Inbound";

  if (event.type === "incoming_sms" || event.type === "message_status") {
    return {
      title: `${direction} text ${event.type === "message_status" ? event.status || "sent" : "received"}`,
      message: `${name}: ${event.body || "SMS activity"}`,
    };
  }

  if (event.type === "incoming_call" || event.type === "call_status") {
    const status = (event.status || String(event.payload.CallStatus || "")).toLowerCase();
    if (["ringing", "initiated", "queued", "in-progress"].includes(status)) return null;

    return {
      title: `${direction} ${getTwilioCallOutcomeLabel(event).toLowerCase()}`,
      message: `${name}${event.status ? ` · ${event.status}` : ""}`,
    };
  }

  if (event.type === "call_recording") {
    return {
      title: "Call recording summary ready",
      message: `${name}: ${event.body || "Transcript and summary completed."}`,
    };
  }

  return null;
}

export function addTwilioCrmNotification(event: TwilioConversationEvent) {
  const notification = createTwilioCrmNotification(event);
  if (!notification) return;

  addUniqueCrmNotification(event.id, {
    ...notification,
    actor: event.direction === "outbound" ? "XRP Roofing" : "Customer",
    module: "Conversations",
  });
}
