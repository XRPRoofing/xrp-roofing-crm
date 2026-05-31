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
  const token = new AccessToken(config.accountSid, config.apiKeySid, config.apiKeySecret, { identity });

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

export function buildIncomingCallTwiml() {
  const response = new twilio.twiml.VoiceResponse();
  const dial = response.dial({ answerOnBridge: true });

  dial.client("crm-agent");

  return response.toString();
}

export function buildOutboundBrowserCallTwiml(to?: string | null) {
  const config = getTwilioConfig();
  const response = new twilio.twiml.VoiceResponse();

  if (!to) {
    response.say("No phone number was provided.");
    return response.toString();
  }

  response.dial({ callerId: config.phoneNumber }).number(to);

  return response.toString();
}

export function normalizeTwilioWebhookEvent(type: TwilioConversationEvent["type"], formData: FormData): TwilioConversationEvent {
  const payload = Object.fromEntries(formData.entries());
  const now = new Date().toISOString();
  const messageSid = String(payload.MessageSid || payload.SmsSid || "");
  const callSid = String(payload.CallSid || "");

  return {
    id: messageSid || callSid || crypto.randomUUID(),
    type,
    direction: String(payload.Direction || "").includes("outbound") ? "outbound" : "inbound",
    from: String(payload.From || ""),
    to: String(payload.To || ""),
    body: String(payload.Body || ""),
    status: String(payload.MessageStatus || payload.SmsStatus || payload.CallStatus || ""),
    callSid: callSid || undefined,
    messageSid: messageSid || undefined,
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
    body: payload.notes,
    payload: { notes: payload.notes },
    createdAt: new Date().toISOString(),
  };
}
