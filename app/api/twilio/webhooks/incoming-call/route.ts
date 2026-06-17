import { NextRequest, NextResponse, after } from "next/server";
import { sendIncomingCallPushNotification } from "@/lib/push-notifications";
import { buildIvrGreetingTwiml, normalizeTwilioWebhookEvent } from "@/lib/twilio/server";
import { publishConversationEvent } from "@/lib/twilio/realtime";
import { ensureCustomerFromLeadServer } from "@/lib/customers/ensure-server";

const XML_HEADERS = { "Content-Type": "text/xml" };

function handleIncomingCall(formData: FormData, origin: string) {
  const menuActionUrl = new URL("/api/twilio/webhooks/menu", origin).toString();
  const selfUrl = new URL("/api/twilio/webhooks/incoming-call", origin).toString();
  const twiml = buildIvrGreetingTwiml(menuActionUrl, selfUrl);

  after(async () => {
    try {
      const event = normalizeTwilioWebhookEvent("incoming_call", formData);
      await publishConversationEvent(event);
      const pushResult = await sendIncomingCallPushNotification(event.from);
      if (pushResult.sent === 0 && pushResult.reason) {
        console.warn("[incoming-call] push notification skipped:", pushResult.reason);
      }
      await ensureCustomerFromLeadServer({ name: event.from, phone: event.from, status: "New lead", source: "Inbound call" });
    } catch (err) {
      console.error("[incoming-call] after() side-effect error:", err);
    }
  });

  return new NextResponse(twiml, { headers: XML_HEADERS });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  return handleIncomingCall(formData, req.nextUrl.origin);
}

export async function GET(req: NextRequest) {
  const formData = new FormData();
  req.nextUrl.searchParams.forEach((value, key) => formData.set(key, value));
  return handleIncomingCall(formData, req.nextUrl.origin);
}
