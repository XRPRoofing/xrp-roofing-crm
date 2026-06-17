import { NextRequest, NextResponse } from "next/server";
import { sendIncomingCallPushNotification } from "@/lib/push-notifications";
import { buildIvrGreetingTwiml, normalizeTwilioWebhookEvent } from "@/lib/twilio/server";
import { publishConversationEvent } from "@/lib/twilio/realtime";
import { ensureCustomerFromLeadServer } from "@/lib/customers/ensure-server";

const XML_HEADERS = { "Content-Type": "text/xml" };

async function handleIncomingCall(formData: FormData, origin: string) {
  const event = normalizeTwilioWebhookEvent("incoming_call", formData);

  await publishConversationEvent(event);
  await sendIncomingCallPushNotification(event.from);

  try {
    await ensureCustomerFromLeadServer({ name: event.from, phone: event.from, status: "New lead", source: "Inbound call" });
  } catch {}

  const menuActionUrl = new URL("/api/twilio/webhooks/menu", origin).toString();
  const selfUrl = new URL("/api/twilio/webhooks/incoming-call", origin).toString();

  return new NextResponse(buildIvrGreetingTwiml(menuActionUrl, selfUrl), { headers: XML_HEADERS });
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
