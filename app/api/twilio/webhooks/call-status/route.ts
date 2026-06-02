import { NextRequest, NextResponse } from "next/server";
import { createCallRecordingInsights } from "@/lib/twilio/recording-insights";
import { normalizeTwilioWebhookEvent } from "@/lib/twilio/server";
import { publishConversationEvent } from "@/lib/twilio/realtime";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const event = normalizeTwilioWebhookEvent("call_status", formData);

  await publishConversationEvent(event);
  if (event.recordingUrl) {
    await publishConversationEvent({
      ...event,
      id: `${event.id}-recording-available`,
      type: "call_recording",
      status: "processing",
      body: "Call recording saved. Transcript and summary are processing.",
      recordingUrl: event.recordingUrl,
      payload: {
        ...event.payload,
        recordingUrl: event.recordingUrl,
        summary: "Transcript and summary are processing.",
      },
    });

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
      void publishConversationEvent({
        ...event,
        id: `${event.id}-recording-summary-failed`,
        type: "call_recording",
        status: "failed",
        body: error instanceof Error ? `Recording saved, but summary failed: ${error.message}` : "Recording saved, but summary failed.",
        recordingUrl: event.recordingUrl,
        payload: {
          ...event.payload,
          recordingUrl: event.recordingUrl,
          summary: "Recording saved, but transcript and summary could not be created.",
          processingError: error instanceof Error ? error.message : "Unknown processing error",
        },
      });
      console.error("Unable to process call recording", error);
    });
  }

  return NextResponse.json({ ok: true });
}
