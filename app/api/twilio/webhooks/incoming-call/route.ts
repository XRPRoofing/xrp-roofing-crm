import { NextRequest, NextResponse, after } from "next/server";
import { buildIvrGreetingTwiml, normalizeTwilioWebhookEvent } from "@/lib/twilio/server";
import { ensureCustomerFromLeadServer } from "@/lib/customers/ensure-server";
import { publishConversationEvent } from "@/lib/twilio/realtime";
import { getLeadSourceForNumber } from "@/lib/twilio/numbers";
import { sendIncomingCallPushNotification } from "@/lib/push-notifications";

const XML_HEADERS = { "Content-Type": "text/xml" };

function handleIncomingCall(formData: FormData, req: NextRequest) {
  const origin = req.nextUrl.origin;
  const attempt = parseInt(req.nextUrl.searchParams.get("attempt") || "0", 10) || 0;
  const isMissedIvr = req.nextUrl.searchParams.get("missed") === "1";

  // IVR exhausted all retries without a digit press — record a missed call
  // and hang up cleanly.
  if (isMissedIvr) {
    after(async () => {
      const event = normalizeTwilioWebhookEvent("call_status", formData);
      await publishConversationEvent({
        ...event,
        id: `${event.callSid}-ivr-missed`,
        status: "no-answer",
        body: "Missed call \u2014 no IVR selection",
      }).catch((err) => {
        console.error("[incoming-call] publish missed-ivr event failed:", err);
      });
    });
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup /></Response>',
      { headers: XML_HEADERS },
    );
  }

  const menuActionUrl = new URL("/api/twilio/webhooks/menu", origin).toString();
  const selfUrl = new URL("/api/twilio/webhooks/incoming-call", origin).toString();
  const twiml = buildIvrGreetingTwiml(menuActionUrl, selfUrl, attempt);

  if (attempt === 0) {
    after(async () => {
      const event = normalizeTwilioWebhookEvent("incoming_call", formData);

      // Send push notification immediately so all devices ring
      await sendIncomingCallPushNotification(event.from).catch((err) => {
        console.error("[incoming-call] push notification failed:", err);
      });

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
