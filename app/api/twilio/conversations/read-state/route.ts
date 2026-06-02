import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listConversationReadStates, markConversationReadState } from "@/lib/twilio/realtime";

const readStateSchema = z.object({
  conversationId: z.string().min(1),
});

export async function GET() {
  const result = await listConversationReadStates();

  if (!result.ok) return NextResponse.json({ readStates: {}, error: result.reason }, { status: 200 });

  return NextResponse.json({ readStates: result.readStates });
}

export async function POST(req: NextRequest) {
  const parsed = readStateSchema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) return NextResponse.json({ error: "Invalid read-state payload" }, { status: 400 });

  const result = await markConversationReadState(parsed.data.conversationId);

  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 503 });

  return NextResponse.json({ ok: true, readAt: result.readAt });
}
