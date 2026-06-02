import twilio from "twilio";
import { getTwilioConfig, hasTwilioMessagingConfig, hasTwilioVoiceConfig } from "@/lib/twilio/config";
import type { TwilioCallNotePayload, TwilioCallPayload, TwilioConversationEvent, TwilioSmsPayload } from "@/types/twilio-conversations";

export function getTwilioClient() {
  const config = getTwilioConfig();

  if (!config.accountSid || !config.authToken) return null;

  return twilio(config.accountSid, config.authToken);
}

export function createVoiceAccessToken(identity: string) {
  if (!hasTwilioVoiceConfig()) return null;

  const config = getTwilioConfig();
  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;
  const token = new AccessToken(config.accountSid, config.apiKeySid, config.apiKeySecret, { identity, ttl: 86400 });

  token.addGrant(new VoiceGrant({ outgoingApplicationSid: config.twimlAppSid, incomingAllow: true }));

  return token.toJwt();
}

export async function sendConversationSms(payload: TwilioSmsPayload) {
  if (!hasTwilioMessagingConfig()) throw new Error("Twilio messaging is not configured");

  const client = getTwilioClient();
  const config = getTwilioConfig();

  if (!client) throw new Error("Twilio client could not be created");

  return client.messages.create({
    to: payload.to,
    from: config.phoneNumber,
    body: payload.body,
    mediaUrl: payload.mediaUrl,
    statusCallback: process.env.TWILIO_MESSAGE_STATUS_WEBHOOK_URL,
  });
}

export async function createOutboundCall(payload: TwilioCallPayload) {
  if (!hasTwilioVoiceConfig()) throw new Error("Twilio voice is not configured");

  const client = getTwilioClient();
  const config = getTwilioConfig();

  if (!client) throw new Error("Twilio client could not be created");

  return client.calls.create({
    to: payload.to,
    from: config.phoneNumber,
    url: process.env.TWILIO_OUTBOUND_VOICE_WEBHOOK_URL,
    statusCallback: process.env.TWILIO_CALL_STATUS_WEBHOOK_URL,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
  });
}

function normalizePhoneForTwiml(value?: string) {
  const trimmed = value?.trim() || "";
  if (!trimmed) return "";

  return trimmed.startsWith("+") ? `+${trimmed.slice(1).replace(/\D/g, "")}` : trimmed.replace(/\D/g, "");
}

export function buildIncomingCallTwiml(statusCallbackUrl = process.env.TWILIO_CALL_STATUS_WEBHOOK_URL, actionCallbackUrl = statusCallbackUrl) {
  const response = new twilio.twiml.VoiceResponse();
  const config = getTwilioConfig();
  const dial = response.dial({
    answerOnBridge: true,
    record: "record-from-answer-dual",
    action: actionCallbackUrl,
    method: "POST",
    recordingStatusCallback: statusCallbackUrl,
    recordingStatusCallbackEvent: ["completed"],
    recordingStatusCallbackMethod: "POST",
  });

  dial.client("crm-agent");

  const inboundForwardNumber = normalizePhoneForTwiml(config.inboundForwardNumber);
  if (inboundForwardNumber) {
    dial.number(inboundForwardNumber);
  }

  return response.toString();
}

export function buildOutboundBrowserCallTwiml(to?: string | null, statusCallbackUrl = process.env.TWILIO_CALL_STATUS_WEBHOOK_URL, actionCallbackUrl = statusCallbackUrl) {
  const config = getTwilioConfig();
  const response = new twilio.twiml.VoiceResponse();

  if (!to) {
    response.say("No phone number was provided.");
    return response.toString();
  }

  response.dial({
    callerId: config.phoneNumber,
    record: "record-from-answer-dual",
    action: actionCallbackUrl,
    method: "POST",
    recordingStatusCallback: statusCallbackUrl,
    recordingStatusCallbackEvent: ["completed"],
    recordingStatusCallbackMethod: "POST",
  }).number(to);

  return response.toString();
}

export function normalizeTwilioWebhookEvent(type: TwilioConversationEvent["type"], formData: FormData): TwilioConversationEvent {
  const payload = Object.fromEntries(formData.entries());
  const now = new Date().toISOString();
  const messageSid = String(payload.MessageSid || payload.SmsSid || "");
  const callSid = String(payload.CallSid || "");
  const status = String(payload.MessageStatus || payload.SmsStatus || payload.CallStatus || payload.RecordingStatus || payload.TranscriptionStatus || "");

  return {
    id: messageSid || (callSid ? `${callSid}-${status || type}-${Date.now()}` : crypto.randomUUID()),
    type,
    direction: String(payload.Direction || "").includes("outbound") ? "outbound" : "inbound",
    from: String(payload.From || ""),
    to: String(payload.To || ""),
    body: String(payload.Body || payload.TranscriptionText || ""),
    status,
    callSid: callSid || undefined,
    messageSid: messageSid || undefined,
    conversationId: payload.conversationId ? String(payload.conversationId) : undefined,
    customerId: payload.customerId ? String(payload.customerId) : undefined,
    jobId: payload.jobId ? String(payload.jobId) : undefined,
    recordingUrl: payload.RecordingUrl ? `${payload.RecordingUrl}.mp3` : undefined,
    payload,
    createdAt: now,
  };
}

export function normalizeCallNote(payload: TwilioCallNotePayload): TwilioConversationEvent {
  return {
    id: crypto.randomUUID(),
    type: "call_note",
    callSid: payload.callSid,
    conversationId: payload.conversationId,
    customerId: payload.customerId,
    jobId: payload.jobId,
    body: payload.disposition ? `${payload.disposition}: ${payload.notes}` : payload.notes,
    payload: { notes: payload.notes, disposition: payload.disposition },
    createdAt: new Date().toISOString(),
  };
}
