import { NextRequest, NextResponse } from "next/server";
import { buildQueueHoldTwiml, fetchOnlineAgents, resolveCallStatusCallbackUrl } from "@/lib/twilio/server";

const XML_HEADERS = { "Content-Type": "text/xml" };

export async function POST(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const statusCallbackUrl = resolveCallStatusCallbackUrl(origin);
  const actionCallbackUrl = new URL("/api/twilio/webhooks/call-ended", origin).toString();
  const queueHoldUrl = new URL("/api/twilio/webhooks/queue-hold", origin).toString();

  const onlineAgents = await fetchOnlineAgents();
  const twiml = buildQueueHoldTwiml(onlineAgents, statusCallbackUrl, actionCallbackUrl, queueHoldUrl);

  return new NextResponse(twiml, { headers: XML_HEADERS });
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const statusCallbackUrl = resolveCallStatusCallbackUrl(origin);
  const actionCallbackUrl = new URL("/api/twilio/webhooks/call-ended", origin).toString();
  const queueHoldUrl = new URL("/api/twilio/webhooks/queue-hold", origin).toString();

  const onlineAgents = await fetchOnlineAgents();
  const twiml = buildQueueHoldTwiml(onlineAgents, statusCallbackUrl, actionCallbackUrl, queueHoldUrl);

  return new NextResponse(twiml, { headers: XML_HEADERS });
}
