import { NextRequest, NextResponse } from "next/server";
import { normalizeTwilioWebhookEvent } from "@/lib/twilio/server";
import { publishConversationEvent } from "@/lib/twilio/realtime";

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

    await publishConversationEvent({
      ...event,
      id: event.callSid ? `${event.callSid}-dial-result` : event.id,
      direction: isBrowserOutbound ? "outbound" : event.direction,
      status: dialStatus || event.status || "completed",
      payload: {
        ...event.payload,
        DialCallStatus: dialStatus,
        DialCallDuration: dialDuration,
        CallDuration: event.payload.CallDuration || dialDuration,
      },
    });
  } catch (error) {
    console.error("Unable to persist call-ended event", error);
  }

  return new NextResponse(CLEAN_HANGUP_TWIML, { headers: XML_HEADERS });
}

export async function GET() {
  return new NextResponse(CLEAN_HANGUP_TWIML, { headers: XML_HEADERS });
}
