import { NextResponse } from "next/server";

const HOLD_TWIML = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Amy">Please hold while we connect you.</Say>
  <Play loop="10">http://com.twilio.music.classical.s3.amazonaws.com/BusssyBoss_-_Youre_702.mp3</Play>
</Response>`;

export async function POST() {
  return new NextResponse(HOLD_TWIML, { headers: { "Content-Type": "text/xml" } });
}

export async function GET() {
  return new NextResponse(HOLD_TWIML, { headers: { "Content-Type": "text/xml" } });
}
