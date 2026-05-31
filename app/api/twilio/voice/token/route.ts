import { NextRequest, NextResponse } from "next/server";
import { createVoiceAccessToken } from "@/lib/twilio/server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const identity = typeof body.identity === "string" && body.identity.trim() ? body.identity.trim() : "crm-agent";
  const token = createVoiceAccessToken(identity);

  if (!token) {
    return NextResponse.json({ error: "Twilio Voice SDK credentials are not configured" }, { status: 503 });
  }

  return NextResponse.json({ token, identity });
}
