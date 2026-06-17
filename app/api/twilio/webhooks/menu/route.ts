import { NextRequest, NextResponse, after } from "next/server";
import { buildIvrMenuTwiml, fetchOnlineAgents, normalizeTwilioWebhookEvent, resolveCallStatusCallbackUrl } from "@/lib/twilio/server";
import { publishConversationEvent } from "@/lib/twilio/realtime";

const XML_HEADERS = { "Content-Type": "text/xml" };

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const digit = formData.get("Digits")?.toString() || "";

  const origin = req.nextUrl.origin;
  const statusCallbackUrl = resolveCallStatusCallbackUrl(origin);
  const actionCallbackUrl = new URL("/api/twilio/webhooks/call-ended", origin).toString();
  const greetingRedirectUrl = new URL("/api/twilio/webhooks/incoming-call", origin).toString();

  const queueHoldUrl = new URL("/api/twilio/webhooks/queue-hold", origin).toString();

  const onlineAgents = await fetchOnlineAgents();
  const { twiml, department } = buildIvrMenuTwiml(digit, statusCallbackUrl, actionCallbackUrl, greetingRedirectUrl, onlineAgents, queueHoldUrl);

  if (department) {
    after(async () => {
      try {
        const event = normalizeTwilioWebhookEvent("call_status", formData);
        await publishConversationEvent({
          ...event,
          id: `${event.callSid}-ivr-${department}`,
          type: "call_status",
          status: "ivr-routed",
          body: `IVR: caller selected ${department}`,
          payload: { ...event.payload, ivrSelection: digit, ivrDepartment: department },
        });
      } catch {}
    });
  }

  return new NextResponse(twiml, { headers: XML_HEADERS });
}
