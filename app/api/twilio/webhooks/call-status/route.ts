import { NextRequest, NextResponse, after } from "next/server";
import { createCallRecordingInsights } from "@/lib/twilio/recording-insights";
import { normalizeTwilioWebhookEvent } from "@/lib/twilio/server";
import { publishConversationEvent } from "@/lib/twilio/realtime";

export async function POST(req: NextRequest) {
  let isDialActionCallback = false;

  try {
    const formData = await req.formData();
    const event = normalizeTwilioWebhookEvent("call_status", formData);
    isDialActionCallback = formData.has("DialCallStatus");

    console.log("[Twilio Call Status] Webhook received", {
      callSid: event.callSid,
      recordingSid: event.recordingSid,
      status: event.status,
      hasRecordingUrl: Boolean(event.recordingUrl),
      isDialActionCallback,
      payloadKeys: Array.from(formData.keys()),
    });

    const storeResult = await publishConversationEvent(event);
    console.log("[Twilio Call Status] Event stored", { callSid: event.callSid, recordingSid: event.recordingSid, status: event.status, storeResult });

    if (event.recordingUrl) {
      console.log("[Twilio Recording] Recording completed callback received", { callSid: event.callSid, recordingSid: event.recordingSid, recordingUrl: event.recordingUrl });
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

      after(async () => {
        try {
          const insights = await createCallRecordingInsights({
            callSid: event.callSid,
            recordingSid: event.recordingSid,
            recordingUrl: event.recordingUrl,
            from: event.from,
            to: event.to,
            direction: event.direction,
            payload: event.payload,
          });
          if (insights) {
            console.log("[Twilio Recording] Publishing transcript and summary", { callSid: insights.callSid, recordingSid: insights.recordingSid });
            await publishConversationEvent(insights);
          }
        } catch (error) {
          await publishConversationEvent({
            ...event,
            id: `${event.id}-recording-summary-failed`,
            type: "call_recording",
            status: "failed",
            body: error instanceof Error ? `Recording saved, but summary failed: ${error.message}` : "Recording saved, but summary failed.",
            recordingSid: event.recordingSid,
            recordingUrl: event.recordingUrl,
            payload: {
              ...event.payload,
              recordingSid: event.recordingSid,
              recordingUrl: event.recordingUrl,
              summary: "Recording saved, but transcript and summary could not be created.",
              processingError: error instanceof Error ? error.message : "Unknown processing error",
            },
          });
          console.error("Unable to process call recording", error);
        }
      });
    }

    if (isDialActionCallback) {
      return new NextResponse("<Response></Response>", { headers: { "Content-Type": "text/xml" } });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unable to handle Twilio call status webhook", error);
    if (isDialActionCallback) {
      return new NextResponse("<Response></Response>", { headers: { "Content-Type": "text/xml" } });
    }

    return NextResponse.json({ ok: true, warning: "Call status webhook received but could not be fully processed" });
  }
}
