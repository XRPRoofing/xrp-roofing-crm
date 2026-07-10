import twilio from "twilio";
import { getTwilioConfig, hasTwilioMessagingConfig, hasTwilioVoiceConfig } from "@/lib/twilio/config";
import { findTwilioLine, resolveFromNumber } from "@/lib/twilio/numbers";
import { getAdminAgentIdentities, getOnlineAgentIdentities, type AgentStatusResult } from "@/lib/agent-status-server";
import type { RoutingStep } from "@/lib/twilio/routing-types";
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
  // The in-app softphone (CrmShell / FloatingDialer / ConversationBoard) always
  // registers its Twilio Voice device under the shared "crm-agent" identity, so
  // "crm-agent" must ALWAYS be a dial target — otherwise inbound calls ring
  // per-user identities (agent-<id>) or the ring-group only and the browser
  // never receives the call, leaving no way to answer.
  const targets = new Set<string>(["crm-agent"]);
  if (onlineAgents && onlineAgents.length > 0) {
    for (const agentId of onlineAgents) targets.add(agentId);
  } else {
    for (const agentId of config.ringGroup) targets.add(agentId);
  }
  const list = Array.from(targets);
  console.log(`[call-trace] dialing ring group | clients=[${list.join(",")}] | count=${list.length}`);
  for (const agentId of list) {
    dial.client(agentId);
  }
}

/** Fetch the agent identities to ring for an inbound call.
 *  Prefers genuinely-online admins (fresh presence in `agent_status`): when at
 *  least one admin is online we ring ONLY them, so stale/offline browsers are
 *  never dialed (dead legs mask who is actually available). When presence is
 *  unavailable or reports nobody online, falls back to EVERY admin-access
 *  user's browser (each registers its own `agent-<id>` identity) so a call is
 *  never left ringing nobody. dialRingGroup adds `crm-agent` (mobile app +
 *  shared fallback) on top. */
export async function fetchOnlineAgents(): Promise<AgentStatusResult> {
  try {
    const [online, admins] = await Promise.all([
      getOnlineAgentIdentities().catch(() => ({ configured: false, agents: [] as string[] })),
      getAdminAgentIdentities().catch(() => [] as string[]),
    ]);
    const usingPresence = online.configured && online.agents.length > 0;
    const agents = usingPresence ? online.agents : admins;
    console.log(
      `[call-trace] ring-group members resolved | source=${usingPresence ? "presence(online)" : "profiles(all-admins fallback)"} | online=[${(online.agents || []).join(",")}] | allAdmins=[${admins.join(",")}] | willDial=[${agents.join(",")}]`,
    );
    return { configured: usingPresence || agents.length > 0, agents };
  } catch (err) {
    console.error("[call-trace] fetchOnlineAgents failed:", err);
    return { configured: false, agents: [] };
  }
}

/** Check if any agents are available to take calls.
 *  The shared "crm-agent" browser softphone is ALWAYS a dial target (see
 *  dialRingGroup), so the in-app softphone can always receive the call. We
 *  therefore never trap callers in the hold queue — an unanswered <Dial> falls
 *  through to its `action` callback (voicemail / call-ended) after `timeout`,
 *  which is the correct "no answer" path rather than an endless hold loop.
 */
export function hasAvailableAgents(_status: AgentStatusResult): boolean {
  return true;
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
    { beep: "false", endConferenceOnExit: true, startConferenceOnEnter: true, record: "do-not-record", participantLabel: "customer", statusCallback: statusCallbackUrl, statusCallbackEvent: ["join", "leave"], statusCallbackMethod: "POST" },
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
  const fromPhone = String(payload.From || "");

  // Twilio status callbacks (sent→delivered) do not include a Direction field.
  // Detect outbound by checking if From matches a configured Twilio number.
  let direction: "outbound" | "inbound" = "inbound";
  const directionRaw = String(payload.Direction || "");
  if (directionRaw.includes("outbound")) {
    direction = "outbound";
  } else if (!directionRaw && type === "message_status" && fromPhone) {
    direction = findTwilioLine(fromPhone) ? "outbound" : "inbound";
  }

  return {
    id: messageSid || recordingSid || (callSid ? `${callSid}-${status || type}` : crypto.randomUUID()),
    type,
    direction,
    from: fromPhone,
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
    // No selection after all retries. Instead of hanging up (which made these
    // calls "missed" and never rang anyone), redirect to incoming-call with
    // ?missed=1 which now rings the operator ring group. The IVR greeting/menu
    // wording above is unchanged.
    const missedUrl = new URL(selfUrl);
    missedUrl.searchParams.set("missed", "1");
    response.redirect({ method: "POST" }, missedUrl.toString());
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

const OFFICE_NUMBER = "+16233008097";

/** Resolve the department + default forward number for a pressed IVR digit.
 *  Returns null for invalid digits. Shared by the legacy simultaneous-ring
 *  path and the configurable step-based routing path so both agree on which
 *  key maps to which department. The IVR greeting/menu itself is unchanged. */
export function resolveIvrDepartment(digit: string): { label: IvrDepartment; number: string } | null {
  const config = getTwilioConfig();
  const departmentMap: Record<string, { label: IvrDepartment; number: string }> = {
    "1": { label: "scheduling", number: OFFICE_NUMBER },
    "2": { label: "sales", number: config.phoneNumber },
    "3": { label: "billing", number: OFFICE_NUMBER },
    "0": { label: "other", number: OFFICE_NUMBER },
  };
  return departmentMap[digit] || null;
}

/** The spoken "connecting you…" line for a department. */
export function ivrDepartmentSay(label: IvrDepartment): string {
  if (label === "scheduling") return "Connecting you to schedule your free roof inspection.";
  if (label === "sales") return "Connecting you to customer service.";
  if (label === "billing") return "Connecting you to our billing department.";
  return "Connecting you to the operator.";
}

/** Ring the targets for a single routing step onto an existing <Dial>. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyRoutingStepTargets(dial: any, step: RoutingStep, config: ReturnType<typeof getTwilioConfig>, agentStatus?: AgentStatusResult) {
  if (step.type === "ring_group") {
    dialRingGroup(dial, config, agentStatus?.agents);
    return;
  }
  const number = normalizePhoneForTwiml(step.number);
  if (number) dial.number(number);
}

/**
 * Build TwiML for one step of a configured routing sequence. Rings the step's
 * target(s) for `step.seconds`; the <Dial> `action` points at the next step so
 * an unanswered step automatically fails over to the following one. When the
 * step index is past the end, routes to the final "no answer" callback (same
 * ending as today). `sayText` is spoken only on the first step.
 */
export function buildRoutingStepTwiml(params: {
  steps: RoutingStep[];
  option: string;
  stepIndex: number;
  statusCallbackUrl: string;
  nextStepUrlFor: (option: string, stepIndex: number) => string;
  finalNoAnswerUrl: string;
  agentStatus?: AgentStatusResult;
  callerNumber?: string;
  sayText?: string;
}): string {
  const config = getTwilioConfig();
  const response = new twilio.twiml.VoiceResponse();
  if (params.stepIndex === 0 && params.sayText) response.say(params.sayText);

  const step = params.steps[params.stepIndex];
  if (!step) {
    // Sequence exhausted — no configured step answered. Instead of dropping the
    // call, fail over one last time to the Main Line ring group (all online
    // admin browsers + the shared softphone) for 30s so a routed call is never
    // missed just because the assigned person couldn't pick up. Only if this
    // also goes unanswered does it end (call-ended logs it + hangs up).
    const failoverDial = response.dial({
      answerOnBridge: true,
      record: "record-from-answer-dual",
      timeout: 30,
      action: params.finalNoAnswerUrl,
      method: "POST",
      recordingStatusCallback: params.statusCallbackUrl,
      recordingStatusCallbackEvent: ["completed"],
      recordingStatusCallbackMethod: "POST",
      ...(params.callerNumber ? { callerId: params.callerNumber } : {}),
    });
    dialRingGroup(failoverDial, config, params.agentStatus?.agents);
    return response.toString();
  }

  const dial = response.dial({
    answerOnBridge: true,
    record: "record-from-answer-dual",
    timeout: step.seconds,
    action: params.nextStepUrlFor(params.option, params.stepIndex + 1),
    method: "POST",
    recordingStatusCallback: params.statusCallbackUrl,
    recordingStatusCallbackEvent: ["completed"],
    recordingStatusCallbackMethod: "POST",
    ...(params.callerNumber ? { callerId: params.callerNumber } : {}),
  });
  applyRoutingStepTargets(dial, step, config, params.agentStatus);
  return response.toString();
}

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

  const dept = resolveIvrDepartment(digit);

  if (!dept) {
    response.say("Sorry, that is not a valid option.");
    response.redirect(greetingRedirectUrl);
    return { twiml: response.toString(), department: null };
  }

  const sayDepartment = () => {
    response.say(ivrDepartmentSay(dept.label));
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
    payload: { notes: payload.notes, disposition: payload.disposition, tags: payload.tags || [] },
    createdAt: new Date().toISOString(),
  };
}
