import { NextRequest, NextResponse, after } from "next/server";
import { buildIvrGreetingTwiml, buildIvrMenuTwiml, normalizeTwilioWebhookEvent, resolveCallStatusCallbackUrl, resolveInboundAgents } from "@/lib/twilio/server";
import { ensureCustomerFromLeadServer } from "@/lib/customers/ensure-server";
import { publishConversationEvent } from "@/lib/twilio/realtime";
import { getLeadSourceForNumber } from "@/lib/twilio/numbers";
import { sendIncomingCallPushNotification } from "@/lib/push-notifications";

const XML_HEADERS = { "Content-Type": "text/xml" };

async function handleIncomingCall(formData: FormData, req: NextRequest) {
  const origin = req.nextUrl.origin;
  const attempt = parseInt(req.nextUrl.searchParams.get("attempt") || "0", 10) || 0;
  const isMissedIvr = req.nextUrl.searchParams.get("missed") === "1";

  // IVR exhausted all retries without a digit press. Instead of hanging up
  // (which silently turned these into missed calls that never rang anyone),
  // route the caller to the operator ring group — same fan-out as pressing "0".
  // The greeting/menu wording is unchanged; only the no-selection ending does.
  if (isMissedIvr) {
    const callerNumber = String(formData.get("From") || "");
    console.log(
      `[call-trace] IVR no selection \u2014 routing to operator ring group | callSid=${formData.get("CallSid") || ""} | from=${callerNumber}`,
    );
    const statusCallbackUrl = resolveCallStatusCallbackUrl(origin);
    const actionCallbackUrl = new URL("/api/twilio/webhooks/call-ended", origin).toString();
    const greetingRedirect = new URL("/api/twilio/webhooks/incoming-call", origin);
    greetingRedirect.searchParams.set("attempt", "1");
    const queueHoldUrl = new URL("/api/twilio/webhooks/queue-hold", origin).toString();
    const { status: onlineAgents, shouldQueue } = await resolveInboundAgents();
    const queue = shouldQueue
      ? {
          waitUrl: new URL("/api/twilio/webhooks/queue-wait", origin).toString(),
          actionUrl: new URL("/api/twilio/webhooks/queue-action", origin).toString(),
        }
      : undefined;
    const { twiml, department } = buildIvrMenuTwiml(
      "0",
      statusCallbackUrl,
      actionCallbackUrl,
      greetingRedirect.toString(),
      onlineAgents,
      queueHoldUrl,
      callerNumber,
      queue,
    );
    after(async () => {
      const event = normalizeTwilioWebhookEvent("call_status", formData);
      await Promise.allSettled([
        sendIncomingCallPushNotification(event.from),
        publishConversationEvent({
          ...event,
          id: `${event.callSid}-ivr-nokey-operator`,
          status: "ivr-routed",
          body: "No IVR selection \u2014 routed to operator",
          payload: { ...event.payload, ivrSelection: "0", ivrDepartment: department, noKeyFallback: true },
        }),
      ]);
    });
    return new NextResponse(twiml, { headers: XML_HEADERS });
  }

  const menuActionUrl = new URL("/api/twilio/webhooks/menu", origin).toString();
  const selfUrl = new URL("/api/twilio/webhooks/incoming-call", origin).toString();
  const twiml = buildIvrGreetingTwiml(menuActionUrl, selfUrl, attempt);

  if (attempt === 0) {
    console.log(
      `[call-trace] incoming call received | callSid=${formData.get("CallSid") || ""} | from=${formData.get("From") || ""} | to=${formData.get("To") || ""}`,
    );
    after(async () => {
      const event = normalizeTwilioWebhookEvent("incoming_call", formData);

      // Send push notification immediately so all devices ring
      const pushResult = await sendIncomingCallPushNotification(event.from).catch((err) => {
        console.error("[incoming-call] push notification threw:", err);
        return { sent: 0, reason: String(err) };
      });
      console.log("[incoming-call] push result:", JSON.stringify(pushResult));

      // Publish an incoming_call event so the call appears on the
      // Conversations Board immediately — even if the caller abandons
      // during the IVR greeting.
      await publishConversationEvent({
        ...event,
        id: `${event.callSid}-incoming`,
        status: "ringing",
        body: "",
      }).catch((err) => {
        console.error("[incoming-call] publishConversationEvent failed:", err);
      });

      const toNumber = String(formData.get("To") || "");
      const source = getLeadSourceForNumber(toNumber, "Inbound call");
      await ensureCustomerFromLeadServer({
        name: event.from,
        phone: event.from,
        status: "New lead",
        source,
      }).catch((err) => {
        console.error("[incoming-call] ensureCustomer failed:", err);
      });
    });
  }

  return new NextResponse(twiml, { headers: XML_HEADERS });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  return handleIncomingCall(formData, req);
}

export async function GET(req: NextRequest) {
  const formData = new FormData();
  req.nextUrl.searchParams.forEach((value, key) => formData.set(key, value));
  return handleIncomingCall(formData, req);
}
