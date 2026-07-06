import { NextRequest, NextResponse, after } from "next/server";
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

  // Dial the customer into the same conference in the background.
  if (to && callSid) {
    const client = getTwilioClient();
    if (client) {
      const callerId = resolveFromNumber(callerIdParam);
      console.log(`[twilio:twiml] to=${to} callerId=${callerId} (requested=${callerIdParam ?? "undefined"}) callSid=${callSid}`);
      const customerTwiml = buildConferenceCustomerTwiml(confName, callbackUrl);
      // Run after the TwiML response is returned so the agent leg isn't delayed,
      // but still capture the result. Previously the customer dial was
      // fire-and-forget with a swallowed error, so when it failed (unverified
      // caller ID, geo-permission, bad number, etc.) the customer was never
      // called yet the agent's own conference leg still showed "Answered" — with
      // zero diagnostics. Now failures are logged and surfaced as a failed
      // call_status event so the Phone log reflects reality.
      after(async () => {
        try {
          const customerCall = await client.calls.create({
            to,
            from: callerId,
            twiml: customerTwiml,
            statusCallback: callbackUrl,
            statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
          });
          console.log(`[twilio:twiml] customer leg created sid=${customerCall.sid} to=${to} from=${callerId}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[twilio:twiml] customer dial FAILED to=${to} from=${callerId} callSid=${callSid}:`, message);
          await publishConversationEvent({
            ...event,
            id: `${callSid}-customer-failed`,
            direction: "outbound",
            to,
            status: "failed",
            body: `Outbound call could not reach the customer: ${message}`,
          }).catch(() => {});
        }
      });
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
