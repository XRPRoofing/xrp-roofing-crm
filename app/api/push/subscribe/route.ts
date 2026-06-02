import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { savePushSubscription } from "@/lib/push-notifications";

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export async function POST(req: NextRequest) {
  const parsed = subscriptionSchema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid push subscription" }, { status: 400 });
  }

  const result = await savePushSubscription(parsed.data, req.headers.get("user-agent") || undefined);

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
