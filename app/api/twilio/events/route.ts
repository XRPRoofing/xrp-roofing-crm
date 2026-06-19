import { NextResponse } from "next/server";
import { listConversationEvents } from "@/lib/twilio/realtime";

export async function GET(req: Request) {
  const limit = Number(new URL(req.url).searchParams.get("limit") || 1000);
  const result = await listConversationEvents(Number.isFinite(limit) ? limit : 1000);

  if (!result.ok) {
    return NextResponse.json({ error: result.reason, events: [] }, { status: 200 });
  }

  return NextResponse.json({ events: result.events });
}
