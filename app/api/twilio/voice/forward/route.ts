import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { getTwilioConfig } from "@/lib/twilio/config";

function buildForwardTwiml(to?: string | null) {
  const response = new twilio.twiml.VoiceResponse();
  const config = getTwilioConfig();

  if (!to) {
    response.say("No forwarding number was provided.");
    return response.toString();
  }

  response.dial({ callerId: config.phoneNumber }).number(to);
  return response.toString();
}

export async function POST(req: NextRequest) {
  const formData = await req.formData().catch(() => new FormData());
  const to = formData.get("To")?.toString() || req.nextUrl.searchParams.get("To");

  return new NextResponse(buildForwardTwiml(to), { headers: { "Content-Type": "text/xml" } });
}

export async function GET(req: NextRequest) {
  const to = req.nextUrl.searchParams.get("To");

  return new NextResponse(buildForwardTwiml(to), { headers: { "Content-Type": "text/xml" } });
}
