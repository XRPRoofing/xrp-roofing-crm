import { NextRequest, NextResponse, after } from "next/server";
import { createCallRecordingInsights } from "@/lib/twilio/recording-insights";
import { normalizeTwilioWebhookEvent } from "@/lib/twilio/server";
import { publishConversationEvent, lookupCallEventByCallSid } from "@/lib/twilio/realtime";

export const maxDuration = 60;

const NO_RECORDING_STATUSES = ["no-answer", "busy", "failed", "canceled"];

function buildFallbackCallSummary(status: string, direction?: "inbound" | "outbound"): string {
  const s = status.toLowerCase();
  if (s === "no-answer") {
    return direction === "outbound"
      ? "Summary: Outbound call was placed but the customer did not answer. No conversation occurred.\nNext steps:\n- Try calling again later\n- Consider sending a follow-up text"
      : "Summary: Inbound call was received but was not answered in time. The caller may try again.\nNext steps:\n- Return the call when available\n- Check for voicemail";
  }
  if (s === "busy") {
    return `Summary: The call could not be completed because the ${direction === "outbound" ? "customer's" : "caller's"} line was busy.\nNext steps:\n- Try calling again in a few minutes`;
  }
  if (s === "failed") {
    return direction === "outbound"
      ? "Summary: The call didn't connect — the customer likely didn't answer, or the call ended before they picked up. No conversation occurred.\nNext steps:\n- Try calling again\n- Consider sending a follow-up text"
      : "Summary: The inbound call didn't connect — the caller may have hung up before it was answered. No conversation occurred.\nNext steps:\n- Return the call when available\n- Check for voicemail";
  }
  if (s === "canceled") {
    return "Summary: The call was canceled before it was answered.\nNext steps:\n- Reach out via text if follow-up is needed";
  }
  return `Summary: Call ended with status: ${status}. No conversation occurred.`;
}

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
      // Recording callbacks (especially from conferences) may lack From/To.
      // Resolve them from the original call event so the recording is
      // associated with the correct conversation.
      let recFrom = event.from;
      let recTo = event.to;
      let recDirection = event.direction;
      let recConversationId = event.conversationId;

      if ((!recFrom || !recTo) && event.callSid) {
        const original = await lookupCallEventByCallSid(event.callSid);
        if (original) {
          recFrom = recFrom || original.from;
          recTo = recTo || original.to;
          recDirection = original.direction;
          recConversationId = recConversationId || original.conversationId || undefined;
        }
      }

      console.log("[Twilio Recording] Recording completed callback received", { callSid: event.callSid, recordingSid: event.recordingSid, recordingUrl: event.recordingUrl, from: recFrom, to: recTo });
      await publishConversationEvent({
        ...event,
        id: `${event.id}-recording-available`,
        type: "call_recording",
        status: "processing",
        from: recFrom,
        to: recTo,
        direction: recDirection,
        conversationId: recConversationId,
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
            from: recFrom,
            to: recTo,
            direction: recDirection,
            payload: event.payload,
          });
          if (insights) {
            console.log("[Twilio Recording] Publishing transcript and summary", { callSid: insights.callSid, recordingSid: insights.recordingSid });
            await publishConversationEvent({
              ...insights,
              from: recFrom,
              to: recTo,
              direction: recDirection,
              conversationId: recConversationId,
            });
          }
        } catch (error) {
          await publishConversationEvent({
            ...event,
            id: `${event.id}-recording-summary-failed`,
            type: "call_recording",
            status: "failed",
            from: recFrom,
            to: recTo,
            direction: recDirection,
            conversationId: recConversationId,
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

    // For calls that end without a recording (no-answer, busy, failed,
    // canceled), publish a call_recording event with a status-based fallback
    // summary so the Conversation Board always shows a Call Summary card.
    if (!event.recordingUrl && event.callSid) {
      const dialStatus = String(event.payload.DialCallStatus || "").toLowerCase();
      const callStatus = (event.status || "").toLowerCase();
      const effectiveStatus = dialStatus || callStatus;

      if (NO_RECORDING_STATUSES.includes(effectiveStatus)) {
        let fallbackFrom = event.from;
        let fallbackTo = event.to;
        let fallbackDirection = event.direction;
        let fallbackConversationId = event.conversationId;

        if ((!fallbackFrom || !fallbackTo) && event.callSid) {
          const original = await lookupCallEventByCallSid(event.callSid);
          if (original) {
            fallbackFrom = fallbackFrom || original.from;
            fallbackTo = fallbackTo || original.to;
            fallbackDirection = original.direction;
            fallbackConversationId = fallbackConversationId || original.conversationId || undefined;
          }
        }

        const summary = buildFallbackCallSummary(effectiveStatus, fallbackDirection);
        await publishConversationEvent({
          id: `${event.callSid}-status-summary`,
          type: "call_recording",
          direction: fallbackDirection,
          from: fallbackFrom,
          to: fallbackTo,
          status: "completed",
          callSid: event.callSid,
          conversationId: fallbackConversationId,
          body: summary,
          payload: {
            ...event.payload,
            summary,
            isFallbackSummary: true,
            callOutcome: effectiveStatus,
          },
          createdAt: new Date().toISOString(),
        });
        console.log("[Twilio Call Status] Fallback summary published", { callSid: event.callSid, status: effectiveStatus });
      }
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
