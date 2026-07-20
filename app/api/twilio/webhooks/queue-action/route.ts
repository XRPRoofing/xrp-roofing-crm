import { NextRequest, NextResponse } from "next/server";

const XML_HEADERS = { "Content-Type": "text/xml" };

// <Enqueue> `action` — Twilio requests this once the caller LEAVES the queue.
//
//  - QueueResult "leave"  -> we removed them at the max-wait cap: apologize and
//    hand off to the normal missed-call ending (hang up + missed-call auto-text
//    via /call-ended), so nobody is stuck on hold forever.
//  - anything else (bridged to an agent, caller hung up, error) -> the call is
//    already over/handled, so just hang up cleanly.
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const result = String(formData.get("QueueResult") || "").toLowerCase();
  const origin = req.nextUrl.origin;

  console.log(
    `[call-trace] queue exit | callSid=${formData.get("CallSid") || ""} | from=${formData.get("From") || ""} | queueResult=${result || "(none)"} | queueTime=${formData.get("QueueTime") || ""}s`,
  );

  if (result === "leave") {
    const callEndedUrl = new URL("/api/twilio/webhooks/call-ended", origin).toString();
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Amy">We're sorry, all of our team members are still assisting other customers. Please leave us a message or call back and we'll be happy to help.</Say>
  <Redirect method="POST">${callEndedUrl}</Redirect>
</Response>`;
    return new NextResponse(twiml, { headers: XML_HEADERS });
  }

  return new NextResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup /></Response>',
    { headers: XML_HEADERS },
  );
}

export async function GET() {
  return new NextResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup /></Response>',
    { headers: XML_HEADERS },
  );
}
