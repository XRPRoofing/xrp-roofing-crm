import { NextRequest, NextResponse, after } from "next/server";
import { normalizeTwilioWebhookEvent } from "@/lib/twilio/server";
import { publishConversationEvent } from "@/lib/twilio/realtime";
import { maybeSendMissedCallAutoText } from "@/lib/twilio/missed-call";
import { dispatchAutomation } from "@/lib/automation/engine.server";

const CLEAN_HANGUP_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup /></Response>';
const XML_HEADERS = { "Content-Type": "text/xml" };

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const event = normalizeTwilioWebhookEvent("call_status", formData);

    const dialStatus = String(formData.get("DialCallStatus") || "").toLowerCase();
    const dialDuration = String(formData.get("DialCallDuration") || "0");
    const isBrowserOutbound = (event.from || "").startsWith("client:");

    const answered = dialStatus === "answered" || (dialStatus === "completed" && Number(dialDuration) > 0);
    console.log(
      `[call-trace] ring group result | callSid=${event.callSid} | from=${event.from} | dialStatus=${dialStatus || "(none)"} | dialDuration=${dialDuration}s | answeredLeg=${formData.get("DialCallSid") || ""} | outcome=${answered ? "ANSWERED" : `MISSED (${dialStatus || "no dial"})`}`,
    );

    const direction = isBrowserOutbound ? "outbound" : event.direction;

    await publishConversationEvent({
      ...event,
      id: event.callSid ? `${event.callSid}-dial-result` : event.id,
      direction,
      status: dialStatus || event.status || "completed",
      payload: {
        ...event.payload,
        DialCallStatus: dialStatus,
        DialCallDuration: dialDuration,
        CallDuration: event.payload.CallDuration || dialDuration,
      },
    });

    // This is the terminal no-answer step for IVR-routed / failover calls: if the
    // whole call went unanswered everywhere (no answered leg, so no recording),
    // auto-text the inbound caller once. An answered call has answered=true here,
    // so it is never texted. De-duplicated per call by the shared helper.
    //
    // Runs strictly AFTER the TwiML response is returned (via `after`), so it
    // adds zero latency to the hang-up and cannot affect call-flow timing. The
    // call is already over at this point — no routing/IVR/forwarding is touched.
    if (!answered && event.callSid && direction === "inbound") {
      const callSid = event.callSid;
      const caller = event.from;
      const line = event.to;
      const origin = req.nextUrl.origin;
      after(async () => {
        await maybeSendMissedCallAutoText({ callSid, direction: "inbound", caller, line, origin }).catch(() => {});
        await dispatchAutomation({ trigger: "call_missed", customerPhone: caller, phone: caller, line }).catch(() => {});
      });
    }
  } catch (error) {
    console.error("Unable to persist call-ended event", error);
  }

  return new NextResponse(CLEAN_HANGUP_TWIML, { headers: XML_HEADERS });
}

export async function GET() {
  return new NextResponse(CLEAN_HANGUP_TWIML, { headers: XML_HEADERS });
}
