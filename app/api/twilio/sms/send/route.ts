import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sendConversationSms } from "@/lib/twilio/server";
import { publishConversationEvent } from "@/lib/twilio/realtime";

const smsSchema = z.object({
  to: z.string().min(7),
  body: z.string().min(1),
  from: z.string().optional(),
  conversationId: z.string().optional(),
  mediaUrl: z.array(z.string().url()).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = smsSchema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid SMS payload" }, { status: 400 });
  }

  try {
    const message = await sendConversationSms(parsed.data);
    await publishConversationEvent({
      id: message.sid,
      type: "message_status",
      direction: "outbound",
      from: message.from,
      to: message.to,
      body: message.body,
      status: message.status,
      messageSid: message.sid,
      conversationId: parsed.data.conversationId,
      payload: { sid: message.sid, status: message.status, ...(parsed.data.mediaUrl?.length ? { mediaUrls: parsed.data.mediaUrl } : {}) },
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ sid: message.sid, status: message.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send SMS";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
