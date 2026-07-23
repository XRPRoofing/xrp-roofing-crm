import { NextResponse } from "next/server";
import { listConversationEvents, listConversationEventsForPhone } from "@/lib/twilio/realtime";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const limit = Number(params.get("limit") || 1000);
  const safeLimit = Number.isFinite(limit) ? limit : 1000;
  const phone = params.get("phone") || "";

  // When a phone is supplied, return that number's complete history (not capped
  // by the global recency window) so a customer's older calls/texts are never
  // dropped. Without a phone, behaviour is unchanged.
  const result = phone
    ? await listConversationEventsForPhone(phone, Math.max(safeLimit, 5000))
    : await listConversationEvents(safeLimit);

  if (!result.ok) {
    return NextResponse.json({ error: result.reason, events: [] }, { status: 200 });
  }

  return NextResponse.json({ events: result.events });
}
