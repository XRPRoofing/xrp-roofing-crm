import { NextRequest, NextResponse } from "next/server";
import { publishConversationEvent } from "@/lib/twilio/realtime";
import { buildOutboundBrowserCallTwiml, normalizeTwilioWebhookEvent } from "@/lib/twilio/server";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const to = formData.get("To")?.toString();
  const event = normalizeTwilioWebhookEvent("call_status", formData);
  await publishConversationEvent({
    ...event,
    direction: "outbound",
    to: to || event.to,
    status: event.status || "initiated",
  });
  const twiml = buildOutboundBrowserCallTwiml(to);

  return new NextResponse(twiml, { headers: { "Content-Type": "text/xml" } });
}

export async function GET(req: NextRequest) {
  const to = req.nextUrl.searchParams.get("To");
  const formData = new FormData();
  req.nextUrl.searchParams.forEach((value, key) => formData.set(key, value));
  const event = normalizeTwilioWebhookEvent("call_status", formData);
  await publishConversationEvent({
    ...event,
    direction: "outbound",
    to: to || event.to,
    status: event.status || "initiated",
  });
  const twiml = buildOutboundBrowserCallTwiml(to);

  return new NextResponse(twiml, { headers: { "Content-Type": "text/xml" } });
}
