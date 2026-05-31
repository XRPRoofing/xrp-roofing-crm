import { NextRequest, NextResponse } from "next/server";
import { normalizeTwilioWebhookEvent } from "@/lib/twilio/server";
import { publishConversationEvent } from "@/lib/twilio/realtime";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const event = normalizeTwilioWebhookEvent("incoming_sms", formData);

  await publishConversationEvent(event);

  return new NextResponse("<Response></Response>", { headers: { "Content-Type": "text/xml" } });
}
