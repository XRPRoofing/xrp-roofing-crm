import { NextRequest, NextResponse } from "next/server";
import { buildIncomingCallTwiml, normalizeTwilioWebhookEvent } from "@/lib/twilio/server";
import { publishConversationEvent } from "@/lib/twilio/realtime";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const event = normalizeTwilioWebhookEvent("incoming_call", formData);

  await publishConversationEvent(event);

  return new NextResponse(buildIncomingCallTwiml(), { headers: { "Content-Type": "text/xml" } });
}

export async function GET(req: NextRequest) {
  const formData = new FormData();
  req.nextUrl.searchParams.forEach((value, key) => formData.set(key, value));
  const event = normalizeTwilioWebhookEvent("incoming_call", formData);
  await publishConversationEvent(event);

  return new NextResponse(buildIncomingCallTwiml(), { headers: { "Content-Type": "text/xml" } });
}
