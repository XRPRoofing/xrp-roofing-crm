import twilio from "twilio";
import { getTwilioConfig, hasTwilioMessagingConfig, hasTwilioVoiceConfig } from "@/lib/twilio/config";
import { resolveFromNumber } from "@/lib/twilio/numbers";
import { getOnlineAgentIdentities, type AgentStatusResult } from "@/lib/agent-status-server";
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

  if (!client) throw new Error("Twilio client could not be created");

  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID || "";
  const fromNumber = resolveFromNumber(payload.from);

  // When a Messaging Service is configured, route ONLY through it (no `from`).
  // Passing `from` alongside messagingServiceSid can bypass 10DLC campaign
  // routing and cause carriers to flag the message as "Spam Likely".
  // The Messaging Service automatically selects the correct number from its
  // sender pool (linked to the 10DLC campaign).
  if (messagingServiceSid) {
    console.log(`[twilio:sms] to=${payload.to} messagingService=${messagingServiceSid} (requested from=${payload.from ?? "undefined"})`);
    return client.messages.create({
      to: payload.to,
      messagingServiceSid,
      body: payload.body,
      mediaUrl: payload.mediaUrl,
      statusCallback: process.env.TWILIO_MESSAGE_STATUS_WEBHOOK_URL,
    });
  }

  console.log(`[twilio:sms] to=${payload.to} from=${fromNumber} (requested=${payload.from ?? "undefined"})`);
  return client.messages.create({
    to: payload.to,
    from: fromNumber,
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

  if (!client) throw new Error("Twilio client could not be created");

  const statusCallback = callbackUrl || process.env.TWILIO_CALL_STATUS_WEBHOOK_URL;
  const fromNumber = resolveFromNumber(payload.from);
  console.log(`[twilio:call] to=${payload.to} from=${fromNumber} (requested=${payload.from ?? "undefined"})`);

  return client.calls.create({
    to: payload.to,
    from: fromNumber,
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
 * Always ensures at least one target exists (crm-agent as ultimate fallback).
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
    return;
  }
  // Ultimate fallback — always dial at least crm-agent to prevent empty <Dial>
  dial.client("crm-agent");
}

/** Fetch online agent identities for ring group routing */
export async function fetchOnlineAgents(): Promise<AgentStatusResult> {
  try {
    return await getOnlineAgentIdentities();
  } catch {
    return { configured: false, agents: [] };
  }
}

/** Check if any agents are available to take calls.
 *  Returns true when:
 *  - online agents exist, OR
 *  - TWILIO_RING_GROUP env var is set, OR
 *  - the agent-status system is NOT configured (fallback to crm-agent)
 */
export function hasAvailableAgents(status: AgentStatusResult): boolean {
  if (status.agents.length > 0) return true;
  const config = getTwilioConfig();
  if (config.ringGroup.length > 0) return true;
  // If the availability system is not configured, assume agents are available
  // so we dial crm-agent directly instead of entering the queue
  return !status.configured;
}

/**
 * Build TwiML for queue hold state. If agents are now available, dials them.
 * Otherwise plays hold message and redirects back to self for periodic retry.
 */
export function buildQueueHoldTwiml(
  agentStatus: AgentStatusResult,
  statusCallbackUrl: string,
  actionCallbackUrl: string,
  queueHoldUrl: string,
  callerNumber?: string,
): string {
  const config = getTwilioConfig();
  const response = new twilio.twiml.VoiceResponse();

  if (hasAvailableAgents(agentStatus)) {
    response.say("An agent is now available. Connecting you.");
    const dial = response.dial({
      answerOnBridge: true,
      record: "record-from-answer-dual",
      timeout: 45,
      action: actionCallbackUrl,
      method: "POST",
      recordingStatusCallback: statusCallbackUrl,
      recordingStatusCallbackEvent: ["completed"],
      recordingStatusCallbackMethod: "POST",
      // Show customer's number to staff; customer only sees the Twilio number they called
      ...(callerNumber ? { callerId: callerNumber } : {}),
    });
    dialRingGroup(dial, config, agentStatus.agents);
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

export function buildIncomingCallTwiml(statusCallbackUrl = process.env.TWILIO_CALL_STATUS_WEBHOOK_URL, actionCallbackUrl = statusCallbackUrl, onlineAgents?: string[], callerNumber?: string) {
  const response = new twilio.twiml.VoiceResponse();
  const config = getTwilioConfig();
  const dial = response.dial({
    answerOnBridge: true,
    record: "record-from-answer-dual",
    timeout: 45,
    action: actionCallbackUrl,
    method: "POST",
    recordingStatusCallback: statusCallbackUrl,
    recordingStatusCallbackEvent: ["completed"],
    recordingStatusCallbackMethod: "POST",
    // Show customer's number to staff; customer only sees the Twilio number they called
    ...(callerNumber ? { callerId: callerNumber } : {}),
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

export function buildOutboundBrowserCallTwiml(to?: string | null, statusCallbackUrl = process.env.TWILIO_CALL_STATUS_WEBHOOK_URL, actionCallbackUrl = statusCallbackUrl, confName?: string) {
  const response = new twilio.twiml.VoiceResponse();

  if (!to) {
    response.say("No phone number was provided.");
    return response.toString();
  }

  // Use a conference so hold/transfer/resume work via the Conferences API.
  if (confName) {
    response.dial({ action: actionCallbackUrl, method: "POST" }).conference(
      { beep: "false", endConferenceOnExit: true, startConferenceOnEnter: true, record: "record-from-start", recordingStatusCallback: statusCallbackUrl, recordingStatusCallbackEvent: ["completed"], recordingStatusCallbackMethod: "POST", participantLabel: "agent", statusCallback: statusCallbackUrl, statusCallbackEvent: ["join", "leave"] },
      confName,
    );
    return response.toString();
  }

  // Legacy non-conference path (fallback)
  const config = getTwilioConfig();
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

export function buildConferenceCustomerTwiml(confName: string, statusCallbackUrl?: string) {
  const response = new twilio.twiml.VoiceResponse();
  response.dial().conference(
    { beep: "false", endConferenceOnExit: false, startConferenceOnEnter: true, record: "do-not-record", participantLabel: "customer", statusCallback: statusCallbackUrl, statusCallbackEvent: ["join", "leave"], statusCallbackMethod: "POST" },
    confName,
  );
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

const IVR_MAX_RETRIES = 2;

export function buildIvrGreetingTwiml(menuActionUrl: string, selfUrl: string, attempt = 0) {
  const response = new twilio.twiml.VoiceResponse();
  const gather = response.gather({
    numDigits: 1,
    timeout: 7,
    action: menuActionUrl,
    method: "POST",
    input: ["dtmf"],
  });
  // Brief pause so the caller's audio stream is established before the greeting
  gather.pause({ length: 1 });
  gather.say(
    "Thank you for calling X R P Roofing. " +
    "To schedule a free roof inspection, press 1. " +
    "If you are a current customer, press 2. " +
    "For billing questions, press 3. " +
    "Or to reach the operator, press 0."
  );

  if (attempt < IVR_MAX_RETRIES) {
    const retryUrl = new URL(selfUrl);
    retryUrl.searchParams.set("attempt", String(attempt + 1));
    response.redirect(retryUrl.toString());
  } else {
    response.say("We did not receive a selection. Goodbye.");
    response.hangup();
  }

  return response.toString();
}

export type IvrDepartment = "billing" | "sales" | "scheduling" | "other";

/** Priority levels for queue ordering */
export type QueuePriority = "high" | "medium" | "low";

const DEPARTMENT_PRIORITY: Record<IvrDepartment, QueuePriority> = {
  scheduling: "high",
  sales: "high",
  billing: "medium",
  other: "low",
};

export function buildIvrMenuTwiml(
  digit: string,
  statusCallbackUrl: string,
  actionCallbackUrl: string,
  greetingRedirectUrl: string,
  agentStatus?: AgentStatusResult,
  queueHoldUrl?: string,
  callerNumber?: string,
) {
  const config = getTwilioConfig();
  const response = new twilio.twiml.VoiceResponse();

  const officeNumber = "+16233008097";
  const departmentMap: Record<string, { label: IvrDepartment; number: string }> = {
    "1": { label: "scheduling", number: officeNumber },
    "2": { label: "sales", number: config.phoneNumber },
    "3": { label: "billing", number: officeNumber },
    "0": { label: "other", number: officeNumber },
  };

  const dept = departmentMap[digit];

  if (!dept) {
    response.say("Sorry, that is not a valid option.");
    response.redirect(greetingRedirectUrl);
    return { twiml: response.toString(), department: null };
  }

  const sayDepartment = () => {
    if (dept.label === "scheduling") response.say("Connecting you to schedule your free roof inspection.");
    else if (dept.label === "sales") response.say("Connecting you to customer service.");
    else if (dept.label === "billing") response.say("Connecting you to our billing department.");
    else response.say("Connecting you to the operator.");
  };

  const status = agentStatus || { configured: false, agents: [] };

  // Only enter queue when agent-status system is configured but no agents are online
  if (queueHoldUrl && !hasAvailableAgents(status)) {
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

  // Agents available (or system not configured — fall through to crm-agent)
  sayDepartment();

  const dial = response.dial({
    answerOnBridge: true,
    record: "record-from-answer-dual",
    timeout: 45,
    action: actionCallbackUrl,
    method: "POST",
    recordingStatusCallback: statusCallbackUrl,
    recordingStatusCallbackEvent: ["completed"],
    recordingStatusCallbackMethod: "POST",
    // Show customer's number to staff; customer only sees the Twilio number they called
    ...(callerNumber ? { callerId: callerNumber } : {}),
  });

  // dialRingGroup guarantees at least crm-agent as ultimate fallback
  dialRingGroup(dial, config, status.agents);
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
