import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createOutboundCall } from "@/lib/twilio/server";
import { publishConversationEvent } from "@/lib/twilio/realtime";

const callSchema = z.object({
  to: z.string().min(7),
  conversationId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = callSchema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid call payload" }, { status: 400 });
  }

  try {
    const call = await createOutboundCall(parsed.data);
    await publishConversationEvent({
      id: call.sid,
      type: "call_status",
      direction: "outbound",
      from: call.from,
      to: call.to,
      status: call.status,
      callSid: call.sid,
      conversationId: parsed.data.conversationId,
      payload: { sid: call.sid, status: call.status },
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ sid: call.sid, status: call.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start call";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
