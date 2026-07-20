import { NextRequest, NextResponse } from "next/server";
import { resolveCallStatusCallbackUrl } from "@/lib/twilio/server";
import { QUEUE_NAME } from "@/lib/twilio/queue-config";

const XML_HEADERS = { "Content-Type": "text/xml" };

// TwiML executed on the fresh call placed to a now-free admin's browser (see
// `connectAgentToQueue`). When the admin answers, <Dial><Queue> bridges them to
// the caller waiting at the front of the hold queue and dequeues that caller.
// If the queue emptied in the meantime (e.g. another admin grabbed the caller
// first), <Dial><Queue> simply finds nobody and the call ends — no harm done.
function buildConnectTwiml(origin: string): string {
  const statusCallbackUrl = resolveCallStatusCallbackUrl(origin);
  const actionUrl = new URL("/api/twilio/webhooks/call-ended", origin).toString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial answerOnBridge="true" record="record-from-answer-dual" action="${actionUrl}" method="POST" recordingStatusCallback="${statusCallbackUrl}" recordingStatusCallbackEvent="completed" recordingStatusCallbackMethod="POST">
    <Queue>${QUEUE_NAME}</Queue>
  </Dial>
</Response>`;
}

export async function POST(req: NextRequest) {
  return new NextResponse(buildConnectTwiml(req.nextUrl.origin), { headers: XML_HEADERS });
}

export async function GET(req: NextRequest) {
  return new NextResponse(buildConnectTwiml(req.nextUrl.origin), { headers: XML_HEADERS });
}
