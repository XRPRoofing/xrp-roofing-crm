import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { z } from "zod";
import { savePushSubscription } from "@/lib/push-notifications";

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

async function getAuthUserId(): Promise<string | undefined> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return undefined;

  const cookieStore = await cookies();
  const supabase = createServerClient(url, anonKey, {
    cookies: { getAll() { return cookieStore.getAll(); } },
  });

  const { data } = await supabase.auth.getUser();
  return data.user?.id;
}

export async function POST(req: NextRequest) {
  const parsed = subscriptionSchema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid push subscription" }, { status: 400 });
  }

  const userId = await getAuthUserId();
  const result = await savePushSubscription(parsed.data, req.headers.get("user-agent") || undefined, userId);

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
