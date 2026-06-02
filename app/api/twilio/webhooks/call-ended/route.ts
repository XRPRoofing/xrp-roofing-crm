import { NextResponse } from "next/server";

const CLEAN_HANGUP_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup /></Response>';

export async function POST() {
  return new NextResponse(CLEAN_HANGUP_TWIML, { headers: { "Content-Type": "text/xml" } });
}

export async function GET() {
  return new NextResponse(CLEAN_HANGUP_TWIML, { headers: { "Content-Type": "text/xml" } });
}
