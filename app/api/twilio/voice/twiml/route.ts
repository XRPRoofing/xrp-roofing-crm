import { NextRequest, NextResponse } from "next/server";
import { publishConversationEvent } from "@/lib/twilio/realtime";
import { buildOutboundBrowserCallTwiml, buildConferenceCustomerTwiml, normalizeTwilioWebhookEvent, resolveCallStatusCallbackUrl, getTwilioClient } from "@/lib/twilio/server";
import { resolveFromNumber } from "@/lib/twilio/numbers";

async function handleTwiml(req: NextRequest, formData: FormData) {
  const to = formData.get("To")?.toString();
  const callSid = formData.get("CallSid")?.toString() || "";
  const callerIdParam = formData.get("CallerId")?.toString();
  const event = normalizeTwilioWebhookEvent("call_status", formData);
  await publishConversationEvent({
    ...event,
    direction: "outbound",
    to: to || event.to,
    status: event.status || "initiated",
  });
  const callbackUrl = resolveCallStatusCallbackUrl(req.nextUrl.origin);
  const actionUrl = new URL("/api/twilio/webhooks/call-ended", req.nextUrl.origin).toString();

  // Use a conference for the call so hold/transfer work via Conferences API
  const confName = `call-${callSid}`;
  const twiml = buildOutboundBrowserCallTwiml(to, callbackUrl, actionUrl, confName);

  // Dial the customer into the same conference in the background
  if (to && callSid) {
    const client = getTwilioClient();
    if (client) {
      const callerId = resolveFromNumber(callerIdParam);
      console.log(`[twilio:twiml] to=${to} callerId=${callerId} (requested=${callerIdParam ?? "undefined"}) callSid=${callSid}`);
      const customerTwiml = buildConferenceCustomerTwiml(confName, callbackUrl);
      client.calls.create({
        to,
        from: callerId,
        twiml: customerTwiml,
        statusCallback: callbackUrl,
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      }).catch(() => {});
    }
  }

  return new NextResponse(twiml, { headers: { "Content-Type": "text/xml" } });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  return handleTwiml(req, formData);
}

export async function GET(req: NextRequest) {
  const formData = new FormData();
  req.nextUrl.searchParams.forEach((value, key) => formData.set(key, value));
  return handleTwiml(req, formData);
}
