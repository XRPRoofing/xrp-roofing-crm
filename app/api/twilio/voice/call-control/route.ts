import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTwilioClient } from "@/lib/twilio/server";
import { publishConversationEvent } from "@/lib/twilio/realtime";

const controlSchema = z.object({
  callSid: z.string().min(1),
  action: z.enum(["end", "hold", "resume", "forward"]),
  forwardTo: z.string().optional(),
  conversationId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = controlSchema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid call control payload" }, { status: 400 });
  }

  const client = getTwilioClient();

  if (!client) {
    return NextResponse.json({ error: "Twilio client could not be created" }, { status: 503 });
  }

  try {
    if (parsed.data.action === "end") {
      const call = await client.calls(parsed.data.callSid).update({ status: "completed" });
      await publishConversationEvent({
        id: crypto.randomUUID(),
        type: "call_status",
        direction: "outbound",
        status: "completed",
        callSid: parsed.data.callSid,
        conversationId: parsed.data.conversationId,
        payload: { sid: call.sid, action: parsed.data.action, status: call.status },
        createdAt: new Date().toISOString(),
      });

      return NextResponse.json({ sid: call.sid, status: call.status, action: parsed.data.action });
    }

    if (parsed.data.action === "forward") {
      const forwardTo = parsed.data.forwardTo?.trim();
      const normalizedForwardTo = forwardTo?.startsWith("+") ? `+${forwardTo.slice(1).replace(/\D/g, "")}` : forwardTo?.replace(/\D/g, "");
      if (!normalizedForwardTo || normalizedForwardTo.length < 7) return NextResponse.json({ error: "Enter a valid forwarding number" }, { status: 400 });

      const url = new URL("/api/twilio/voice/forward", req.nextUrl.origin);
      url.searchParams.set("To", normalizedForwardTo);
      const call = await client.calls(parsed.data.callSid).update({ url: url.toString(), method: "POST" });

      await publishConversationEvent({
        id: crypto.randomUUID(),
        type: "call_status",
        direction: "outbound",
        status: "forwarded",
        callSid: parsed.data.callSid,
        conversationId: parsed.data.conversationId,
        body: `Call forwarded to ${normalizedForwardTo}`,
        payload: { sid: call.sid, action: parsed.data.action, status: call.status, forwardTo: normalizedForwardTo },
        createdAt: new Date().toISOString(),
      });

      return NextResponse.json({ sid: call.sid, status: "forwarded", action: parsed.data.action });
    }

    await publishConversationEvent({
      id: crypto.randomUUID(),
      type: "call_status",
      direction: "outbound",
      status: parsed.data.action,
      callSid: parsed.data.callSid,
      conversationId: parsed.data.conversationId,
      payload: { action: parsed.data.action, note: "Hold and resume require a bridged Twilio call leg to control the customer audio stream." },
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ sid: parsed.data.callSid, status: parsed.data.action, action: parsed.data.action });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to control call";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
