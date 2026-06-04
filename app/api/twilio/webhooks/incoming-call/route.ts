import { NextRequest, NextResponse } from "next/server";
import { sendIncomingCallPushNotification } from "@/lib/push-notifications";
import { buildIncomingCallTwiml, normalizeTwilioWebhookEvent, resolveCallStatusCallbackUrl } from "@/lib/twilio/server";
import { publishConversationEvent } from "@/lib/twilio/realtime";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const event = normalizeTwilioWebhookEvent("incoming_call", formData);

  await publishConversationEvent(event);
  await sendIncomingCallPushNotification(event.from);

  const callbackUrl = resolveCallStatusCallbackUrl(req.nextUrl.origin);

  const actionUrl = new URL("/api/twilio/webhooks/call-ended", req.nextUrl.origin).toString();

  return new NextResponse(buildIncomingCallTwiml(callbackUrl, actionUrl), { headers: { "Content-Type": "text/xml" } });
}

export async function GET(req: NextRequest) {
  const formData = new FormData();
  req.nextUrl.searchParams.forEach((value, key) => formData.set(key, value));
  const event = normalizeTwilioWebhookEvent("incoming_call", formData);
  await publishConversationEvent(event);
  await sendIncomingCallPushNotification(event.from);

  const callbackUrl = resolveCallStatusCallbackUrl(req.nextUrl.origin);

  const actionUrl = new URL("/api/twilio/webhooks/call-ended", req.nextUrl.origin).toString();

  return new NextResponse(buildIncomingCallTwiml(callbackUrl, actionUrl), { headers: { "Content-Type": "text/xml" } });
}
