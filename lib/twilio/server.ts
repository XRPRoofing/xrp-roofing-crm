import twilio from "twilio";
import { getTwilioConfig, hasTwilioMessagingConfig, hasTwilioVoiceConfig, toE164 } from "@/lib/twilio/config";
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

  const toNumber = toE164(payload.to);
  if (!toNumber) {
    throw new Error("Invalid destination phone number");
  }

  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID || "";
  const fromNumber = resolveFromNumber(payload.from);

  try {
    // When a Messaging Service is configured, route ONLY through it (no `from`).
    // Passing `from` alongside messagingServiceSid can bypass 10DLC campaign
    // routing and cause carriers to flag the message as "Spam Likely".
    // The Messaging Service automatically selects the correct number from its
    // sender pool (linked to the 10DLC campaign).
    if (messagingServiceSid) {
      console.log(`[twilio:sms] to=${toNumber} messagingService=${messagingServiceSid} (requested from=${payload.from ?? "undefined"})`);
      return await client.messages.create({
        to: toNumber,
        messagingServiceSid,
        body: payload.body,
        mediaUrl: payload.mediaUrl,
        statusCallback: process.env.TWILIO_MESSAGE_STATUS_WEBHOOK_URL,
      });
    }

    console.log(`[twilio:sms] to=${toNumber} from=${fromNumber} (requested=${payload.from ?? "undefined"})`);
    return await client.messages.create({
      to: toNumber,
      from: fromNumber,
      body: payload.body,
      mediaUrl: payload.mediaUrl,
      statusCallback: process.env.TWILIO_MESSAGE_STATUS_WEBHOOK_URL,
    });
  } catch (err) {
    const twilioError = err as { code?: string; message?: string; moreInfo?: string };
    console.error(`[twilio:sms] failed to send message | to=${toNumber} | code=${twilioError.code || "unknown"} | message=${twilioError.message || "unknown"}${twilioError.moreInfo ? ` | moreInfo=${twilioError.moreInfo}` : ""}`);
    throw new Error(twilioError.message || "Unable to send SMS");
  }
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
 * Resolve the client identities that should be rung for an inbound call.
 * Priority: onlineAgents (from availability system) > TWILIO_RING_GROUP env var.
 * No phantom fallback is added — every identity returned here must be actively
 * registered by a browser/softphone.
 */
function resolveRingGroupTargets(config: ReturnType<typeof getTwilioConfig>, onlineAgents?: string[]): string[] {
  const targets: string[] = [];
  const source = onlineAgents && onlineAgents.length > 0 ? onlineAgents : config.ringGroup;
  for (const agentId of source) {
    if (agentId && !targets.includes(agentId)) targets.push(agentId);
  }
  return targets;
}

/**
 * Dial all available agents simultaneously.
 * Adds <Client> nouns for online agents or the TWILIO_RING_GROUP env var.
 * Returns the list of client identities actually dialed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dialRingGroup(dial: any, config: ReturnType<typeof getTwilioConfig>, onlineAgents?: string[]): string[] {
  const targets = resolveRingGroupTargets(config, onlineAgents);
  if (targets.length > 0) {
    console.log(`[call-trace] dialing ring group | clients=[${targets.join(",")}] | count=${targets.length}`);
    for (const agentId of targets) {
      dial.client(agentId);
    }
  } else {
    console.log("[call-trace] ring group is empty | no clients to dial");
  }
  return targets;
}

/** Fetch the agent identities to ring for an inbound call.
 *  Prefers genuinely-online admins (fresh presence in `agent_status`): when at
 *  least one admin is online we ring ONLY them, so stale/offline browsers are
 *  never dialed (dead legs mask who is actually available). When presence is
 *  unavailable or reports nobody online, falls back to EVERY admin-access
 *  user's browser (each registers its own `agent-<id>` identity) so a call is
 *  never left ringing nobody. */

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
 *  True when at least one online agent is present or TWILIO_RING_GROUP is
 *  configured. No phantom fallback is assumed, so callers can route to the
 *  no-agents / hold queue path when nobody is available.
 */
export function hasAvailableAgents(status: AgentStatusResult): boolean {
  const config = getTwilioConfig();
  return status.agents.length > 0 || config.ringGroup.length > 0;
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
  _callerNumber?: string,
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
    });
    const dialedClients = dialRingGroup(dial, config, agentStatus.agents);
    const inboundForwardNumber = normalizePhoneForTwiml(config.inboundForwardNumber);
    const hasForward = Boolean(inboundForwardNumber && inboundForwardNumber !== config.phoneNumber);
    if (hasForward) {
      dial.number(inboundForwardNumber);
    }
    if (dialedClients.length === 0 && !hasForward) {
      response.say("No agents are available to take your call.");
      response.redirect({ method: "POST" }, actionCallbackUrl);
      return response.toString();
    }
  } else {
    response.say("Please wait, all agents are busy. Your call is important to us.");
    response.pause({ length: 15 });
    response.redirect({ method: "POST" }, queueHoldUrl);
  }

  return response.toString();
}

export function buildIncomingCallTwiml(statusCallbackUrl: string = process.env.TWILIO_CALL_STATUS_WEBHOOK_URL || "", actionCallbackUrl: string = statusCallbackUrl, onlineAgents?: string[], _callerNumber?: string) {
  const response = new twilio.twiml.VoiceResponse();
  const config = getTwilioConfig();
  const inboundForwardNumber = normalizePhoneForTwiml(config.inboundForwardNumber);
  const hasForward = Boolean(inboundForwardNumber && inboundForwardNumber !== config.phoneNumber);
  const clientTargets = resolveRingGroupTargets(config, onlineAgents);

  if (clientTargets.length === 0 && !hasForward) {
    response.say("No agents are available to take your call.");
    response.redirect({ method: "POST" }, actionCallbackUrl);
    return response.toString();
  }

  const dial = response.dial({
    answerOnBridge: true,
    record: "record-from-answer-dual",
    timeout: 45,
    action: actionCallbackUrl,
    method: "POST",
    recordingStatusCallback: statusCallbackUrl,
    recordingStatusCallbackEvent: ["completed"],
    recordingStatusCallbackMethod: "POST",
  });

  for (const agentId of clientTargets) {
    dial.client(agentId);
  }

  if (hasForward) {
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

/** True when a configured forward number is this line's own Twilio number.
 *  Dialing it would place a fresh inbound call to ourselves, re-enter the IVR
 *  greeting, and loop the caller back to the menu forever — so such a step must
 *  be skipped. Mirrors the guard the legacy simultaneous-ring path applies. */
function isSelfReferentialNumber(rawNumber: string | undefined, config: ReturnType<typeof getTwilioConfig>): boolean {
  const number = normalizePhoneForTwiml(rawNumber);
  const selfNumber = normalizePhoneForTwiml(config.phoneNumber);
  return Boolean(number && selfNumber && number === selfNumber);
}

/** Ring the targets for a single routing step onto an existing <Dial>.
 *  Returns true if at least one target was added. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyRoutingStepTargets(dial: any, step: RoutingStep, config: ReturnType<typeof getTwilioConfig>, agentStatus?: AgentStatusResult): boolean {
  if (step.type === "ring_group") {
    const targets = dialRingGroup(dial, config, agentStatus?.agents);
    return targets.length > 0;
  }
  const number = normalizePhoneForTwiml(step.number);
  if (number && !isSelfReferentialNumber(step.number, config)) {
    dial.number(number);
    return true;
  }
  return false;
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
  let redirectUrl: string;
  let hasTargets = false;

  if (!step) {
    // Sequence exhausted — no configured step answered. Fail over one last time
    // to the Main Line ring group if any agents are available.
    const targets = resolveRingGroupTargets(config, params.agentStatus?.agents);
    hasTargets = targets.length > 0;
    redirectUrl = params.finalNoAnswerUrl;
  } else {
    redirectUrl = params.nextStepUrlFor(params.option, params.stepIndex + 1);
    if (step.type === "ring_group") {
      const targets = resolveRingGroupTargets(config, params.agentStatus?.agents);
      hasTargets = targets.length > 0;
    } else if (isSelfReferentialNumber(step.number, config)) {
      // This step points at our own inbound line — dialing it would loop the
      // caller straight back into the IVR menu. Skip it silently and advance to
      // the next configured step instead of announcing "no agents".
      response.redirect({ method: "POST" }, redirectUrl);
      return response.toString();
    } else {
      hasTargets = Boolean(normalizePhoneForTwiml(step.number));
    }
  }

  if (!hasTargets) {
    response.say("No agents are available to take your call.");
    response.redirect({ method: "POST" }, redirectUrl);
    return response.toString();
  }

  const dial = response.dial({
    answerOnBridge: true,
    record: "record-from-answer-dual",
    timeout: step ? step.seconds : 30,
    action: redirectUrl,
    method: "POST",
    recordingStatusCallback: params.statusCallbackUrl,
    recordingStatusCallbackEvent: ["completed"],
    recordingStatusCallbackMethod: "POST",
  });

  if (!step) {
    dialRingGroup(dial, config, params.agentStatus?.agents);
  } else {
    applyRoutingStepTargets(dial, step, config, params.agentStatus);
  }

  return response.toString();
}

export function buildIvrMenuTwiml(
  digit: string,
  statusCallbackUrl: string,
  actionCallbackUrl: string,
  greetingRedirectUrl: string,
  agentStatus?: AgentStatusResult,
  queueHoldUrl?: string,
  _callerNumber?: string,
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

  sayDepartment();

  const forwardTo = normalizePhoneForTwiml(dept.number);
  const hasForward = Boolean(forwardTo && forwardTo !== config.phoneNumber);
  const clientTargets = resolveRingGroupTargets(config, status.agents);

  if (clientTargets.length === 0 && !hasForward) {
    response.say("No agents are available to take your call.");
    response.redirect({ method: "POST" }, actionCallbackUrl);
    return { twiml: response.toString(), department: dept.label };
  }

  const dial = response.dial({
    answerOnBridge: true,
    record: "record-from-answer-dual",
    timeout: 45,
    action: actionCallbackUrl,
    method: "POST",
    recordingStatusCallback: statusCallbackUrl,
    recordingStatusCallbackEvent: ["completed"],
    recordingStatusCallbackMethod: "POST",
  });

  for (const agentId of clientTargets) {
    dial.client(agentId);
  }

  if (hasForward) {
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
