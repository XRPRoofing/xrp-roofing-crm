import { NextRequest, NextResponse } from "next/server";
import { buildIvrMenuTwiml, normalizeTwilioWebhookEvent, resolveCallStatusCallbackUrl } from "@/lib/twilio/server";
import { publishConversationEvent } from "@/lib/twilio/realtime";

const XML_HEADERS = { "Content-Type": "text/xml" };

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const digit = formData.get("Digits")?.toString() || "";

  const event = normalizeTwilioWebhookEvent("call_status", formData);
  const statusCallbackUrl = resolveCallStatusCallbackUrl(req.nextUrl.origin);
  const actionCallbackUrl = new URL("/api/twilio/webhooks/call-ended", req.nextUrl.origin).toString();
  const greetingRedirectUrl = new URL("/api/twilio/webhooks/incoming-call", req.nextUrl.origin).toString();

  const { twiml, department } = buildIvrMenuTwiml(digit, statusCallbackUrl, actionCallbackUrl, greetingRedirectUrl);

  if (department) {
    await publishConversationEvent({
      ...event,
      id: `${event.callSid}-ivr-${department}`,
      type: "call_status",
      status: "ivr-routed",
      body: `IVR: caller selected ${department}`,
      payload: { ...event.payload, ivrSelection: digit, ivrDepartment: department },
    });
  }

  return new NextResponse(twiml, { headers: XML_HEADERS });
}
