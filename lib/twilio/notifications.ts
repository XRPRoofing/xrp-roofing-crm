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
  const duration = Number(event.payload.CallDuration || event.payload.DialCallDuration || 0);
  const effectiveStatus = status || payloadStatus;

  if (event.type === "call_recording") return "Call recorded with summary";
  if (["no-answer", "busy", "failed", "canceled", "missed"].includes(effectiveStatus)) return "Missed call";
  if (effectiveStatus === "completed" && duration === 0) return "Missed call";
  if (effectiveStatus === "in-progress" || effectiveStatus === "answered" || answeredBy) return "Answered call";
  if (effectiveStatus === "completed") return "Completed call";
  if (effectiveStatus === "ringing") return "Ringing call";
  if (effectiveStatus === "initiated" || effectiveStatus === "queued") return "Call started";
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
