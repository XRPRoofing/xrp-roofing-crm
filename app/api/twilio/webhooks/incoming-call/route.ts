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
    const event = normalizeTwilioWebhookEvent("incoming_call", formData);

    const results = await Promise.allSettled([
      sendIncomingCallPushNotification(event.from),
      publishConversationEvent(event),
      ensureCustomerFromLeadServer({ name: event.from, phone: event.from, status: "New lead", source: "Inbound call" }),
    ]);

    const [pushResult, convResult, customerResult] = results;
    if (pushResult.status === "fulfilled" && pushResult.value.sent === 0 && pushResult.value.reason) {
      console.warn("[incoming-call] push notification skipped:", pushResult.value.reason);
    }
    if (pushResult.status === "rejected") console.error("[incoming-call] push failed:", pushResult.reason);
    if (convResult.status === "rejected") console.error("[incoming-call] publishConversationEvent failed:", convResult.reason);
    if (customerResult.status === "rejected") console.error("[incoming-call] ensureCustomer failed:", customerResult.reason);
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
