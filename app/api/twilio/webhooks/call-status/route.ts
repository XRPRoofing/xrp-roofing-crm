import { NextRequest, NextResponse } from "next/server";
import { createCallRecordingInsights } from "@/lib/twilio/recording-insights";
import { normalizeTwilioWebhookEvent } from "@/lib/twilio/server";
import { publishConversationEvent } from "@/lib/twilio/realtime";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const event = normalizeTwilioWebhookEvent("call_status", formData);

  await publishConversationEvent(event);
  if (event.recordingUrl) {
    createCallRecordingInsights({
      callSid: event.callSid,
      recordingUrl: event.recordingUrl,
      from: event.from,
      to: event.to,
      direction: event.direction,
      payload: event.payload,
    }).then((insights) => {
      if (insights) void publishConversationEvent(insights);
    }).catch((error) => {
      console.error("Unable to process call recording", error);
    });
  }

  return NextResponse.json({ ok: true });
}
