import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeCallNote } from "@/lib/twilio/server";
import { publishConversationEvent } from "@/lib/twilio/realtime";

const noteSchema = z.object({
  callSid: z.string().min(1),
  conversationId: z.string().optional(),
  customerId: z.string().optional(),
  jobId: z.string().optional(),
  notes: z.string(),
  disposition: z.string().optional(),
  tags: z.array(z.string().min(1)).max(20).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = noteSchema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid call note payload" }, { status: 400 });
  }

  const event = normalizeCallNote(parsed.data);
  const result = await publishConversationEvent(event);

  return NextResponse.json({ ok: true, eventId: event.id, realtime: result });
}
