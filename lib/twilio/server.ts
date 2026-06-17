import twilio from "twilio";
import { getTwilioConfig, hasTwilioMessagingConfig, hasTwilioVoiceConfig } from "@/lib/twilio/config";
import { getOnlineAgentIdentities } from "@/lib/agent-status-server";
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

// The status-callback env var (TWILIO_CALL_STATUS_WEBHOOK_URL) sometimes still
// points at an old/third-party CRM (e.g. roofercrm-api.onrender.com), which
// silently steals recording + call-status callbacks. Only honor it when it
// points at this app; otherwise fall back to this app's own endpoint.
export function resolveCallStatusCallbackUrl(origin: string): string {
  const fallback = new URL("/api/twilio/webhooks/call-status", origin).toString();
  const configured = process.env.TWILIO_CALL_STATUS_WEBHOOK_URL?.trim();
  if (!configured) return fallback;
  try {
    if (new URL(configured).host === new URL(origin).host) return configured;
  } catch {
    return fallback;
  }
  return fallback;
}

export async function createOutboundCall(payload: TwilioCallPayload, callbackUrl?: string) {
  if (!hasTwilioVoiceConfig()) throw new Error("Twilio voice is not configured");

  const client = getTwilioClient();
  const config = getTwilioConfig();

  if (!client) throw new Error("Twilio client could not be created");

  const statusCallback = callbackUrl || process.env.TWILIO_CALL_STATUS_WEBHOOK_URL;

  return client.calls.create({
    to: payload.to,
    from: config.phoneNumber,
    url: process.env.TWILIO_OUTBOUND_VOICE_WEBHOOK_URL,
    statusCallback,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    record: true,
    recordingStatusCallback: statusCallback,
    recordingStatusCallbackEvent: ["completed"],
  });
}

function normalizePhoneForTwiml(value?: string) {
  const trimmed = value?.trim() || "";
  if (!trimmed) return "";

  return trimmed.startsWith("+") ? `+${trimmed.slice(1).replace(/\D/g, "")}` : trimmed.replace(/\D/g, "");
}

/**
 * Dial all available agents simultaneously.
 * Priority: onlineAgents (from availability system) > TWILIO_RING_GROUP env var > "crm-agent".
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dialRingGroup(dial: any, config: ReturnType<typeof getTwilioConfig>, onlineAgents?: string[]) {
  if (onlineAgents && onlineAgents.length > 0) {
    for (const agentId of onlineAgents) {
      dial.client(agentId);
    }
    return;
  }
  if (config.ringGroup.length > 0) {
    for (const agentId of config.ringGroup) {
      dial.client(agentId);
    }
  } else {
    dial.client("crm-agent");
  }
}

/** Fetch online agent identities for ring group routing */
export async function fetchOnlineAgents(): Promise<string[]> {
  try {
    return await getOnlineAgentIdentities();
  } catch {
    return [];
  }
}

/** Check if any agents are available to take calls (online or ring group configured) */
export function hasAvailableAgents(onlineAgents: string[]): boolean {
  if (onlineAgents.length > 0) return true;
  const config = getTwilioConfig();
  return config.ringGroup.length > 0;
}

/**
 * Build TwiML for queue hold state. If agents are now available, dials them.
 * Otherwise plays hold message and redirects back to self for periodic retry.
 */
export function buildQueueHoldTwiml(
  onlineAgents: string[],
  statusCallbackUrl: string,
  actionCallbackUrl: string,
  queueHoldUrl: string,
): string {
  const config = getTwilioConfig();
  const response = new twilio.twiml.VoiceResponse();

  if (onlineAgents.length > 0 || config.ringGroup.length > 0) {
    response.say("An agent is now available. Connecting you.");
    const dial = response.dial({
      answerOnBridge: true,
      record: "record-from-answer-dual",
      action: actionCallbackUrl,
      method: "POST",
      recordingStatusCallback: statusCallbackUrl,
      recordingStatusCallbackEvent: ["completed"],
      recordingStatusCallbackMethod: "POST",
    });
    dialRingGroup(dial, config, onlineAgents);
    const inboundForwardNumber = normalizePhoneForTwiml(config.inboundForwardNumber);
    if (inboundForwardNumber && inboundForwardNumber !== config.phoneNumber) {
      dial.number(inboundForwardNumber);
    }
  } else {
    response.say("Please wait, all agents are busy. Your call is important to us.");
    response.pause({ length: 15 });
    response.redirect({ method: "POST" }, queueHoldUrl);
  }

  return response.toString();
}

export function buildIncomingCallTwiml(statusCallbackUrl = process.env.TWILIO_CALL_STATUS_WEBHOOK_URL, actionCallbackUrl = statusCallbackUrl, onlineAgents?: string[]) {
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

  dialRingGroup(dial, config, onlineAgents);

  // Forwarding to the Twilio number itself would loop the call back into this
  // webhook, so only forward to a different (real) phone.
  const inboundForwardNumber = normalizePhoneForTwiml(config.inboundForwardNumber);
  if (inboundForwardNumber && inboundForwardNumber !== config.phoneNumber) {
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
  const recordingSid = String(payload.RecordingSid || "");

  return {
    id: messageSid || recordingSid || (callSid ? `${callSid}-${status || type}` : crypto.randomUUID()),
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
    recordingSid: recordingSid || undefined,
    recordingUrl: payload.RecordingUrl ? `${payload.RecordingUrl}.mp3` : undefined,
    payload,
    createdAt: now,
  };
}

export function buildIvrGreetingTwiml(menuActionUrl: string, selfUrl: string) {
  const response = new twilio.twiml.VoiceResponse();
  const gather = response.gather({
    numDigits: 1,
    action: menuActionUrl,
    method: "POST",
    input: ["dtmf"],
  });
  gather.say(
    "Thank you for calling X R P Roofing. " +
    "Press 1 for Billing or Invoice. " +
    "Press 2 for Sales. " +
    "Press 3 for Scheduling. " +
    "Press 4 for all other inquiries."
  );
  response.redirect(selfUrl);
  return response.toString();
}

export type IvrDepartment = "billing" | "sales" | "scheduling" | "other";

/** Priority levels for queue ordering (lower number = higher priority) */
export type QueuePriority = "high" | "medium" | "low";

const DEPARTMENT_PRIORITY: Record<IvrDepartment, QueuePriority> = {
  billing: "high",
  sales: "high",
  scheduling: "medium",
  other: "low",
};

export function buildIvrMenuTwiml(
  digit: string,
  statusCallbackUrl: string,
  actionCallbackUrl: string,
  greetingRedirectUrl: string,
  onlineAgents?: string[],
  queueHoldUrl?: string,
) {
  const config = getTwilioConfig();
  const response = new twilio.twiml.VoiceResponse();

  const departmentMap: Record<string, { label: IvrDepartment; number: string }> = {
    "1": { label: "billing", number: config.ivrBillingNumber },
    "2": { label: "sales", number: config.ivrSalesNumber },
    "3": { label: "scheduling", number: config.ivrSchedulingNumber },
    "4": { label: "other", number: config.ivrOtherNumber },
  };

  const dept = departmentMap[digit];

  if (!dept) {
    response.say("Sorry, that is not a valid option.");
    response.redirect(greetingRedirectUrl);
    return { twiml: response.toString(), department: null };
  }

  const sayDepartment = () => {
    if (dept.label === "billing") response.say("Connecting you to our billing department.");
    else if (dept.label === "sales") response.say("Connecting you to our sales team.");
    else if (dept.label === "scheduling") response.say("Connecting you to scheduling.");
    else response.say("Connecting you now.");
  };

  // If no agents are available, enter queue with hold message
  if (queueHoldUrl && !hasAvailableAgents(onlineAgents || [])) {
    sayDepartment();
    response.say("Please wait, all agents are busy. Your call is important to us.");
    const priority = DEPARTMENT_PRIORITY[dept.label];
    const holdUrl = new URL(queueHoldUrl);
    holdUrl.searchParams.set("priority", priority);
    holdUrl.searchParams.set("dept", dept.label);
    response.pause({ length: 15 });
    response.redirect({ method: "POST" }, holdUrl.toString());
    return { twiml: response.toString(), department: dept.label };
  }

  // Agents available — connect immediately
  sayDepartment();

  const dial = response.dial({
    answerOnBridge: true,
    record: "record-from-answer-dual",
    action: actionCallbackUrl,
    method: "POST",
    recordingStatusCallback: statusCallbackUrl,
    recordingStatusCallbackEvent: ["completed"],
    recordingStatusCallbackMethod: "POST",
  });

  dialRingGroup(dial, config, onlineAgents);
  const forwardTo = normalizePhoneForTwiml(dept.number);
  if (forwardTo && forwardTo !== config.phoneNumber) {
    dial.number(forwardTo);
  }

  return { twiml: response.toString(), department: dept.label };
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
