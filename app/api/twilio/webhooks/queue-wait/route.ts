import { NextRequest, NextResponse } from "next/server";
import { MAX_QUEUE_WAIT_SECONDS } from "@/lib/twilio/queue-config";

const XML_HEADERS = { "Content-Type": "text/xml" };

// Hold music played to a caller while they wait in the queue. Twilio requests
// this `waitUrl` repeatedly for the duration of the hold, so each request also
// enforces the max wait: once the caller has waited MAX_QUEUE_WAIT_SECONDS we
// return <Leave>, which removes them from the queue and fires the <Enqueue>
// action (queue-action) to end the call gracefully.
function buildWaitTwiml(queueTimeSeconds: number): string {
  if (queueTimeSeconds >= MAX_QUEUE_WAIT_SECONDS) {
    return '<?xml version="1.0" encoding="UTF-8"?><Response><Leave /></Response>';
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Amy">Thank you for holding. A team member will be with you as soon as one is available.</Say>
  <Play>http://com.twilio.music.classical.s3.amazonaws.com/BusssyBoss_-_Youre_702.mp3</Play>
</Response>`;
}

async function handle(req: NextRequest, params: URLSearchParams | FormData) {
  const queueTime = Number(params.get("QueueTime") || "0") || 0;
  return new NextResponse(buildWaitTwiml(queueTime), { headers: XML_HEADERS });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  return handle(req, formData);
}

export async function GET(req: NextRequest) {
  return handle(req, req.nextUrl.searchParams);
}
