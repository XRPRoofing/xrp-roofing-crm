import webPush from "web-push";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

export interface StoredPushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!key) return null;

  return createClient(url, key, { auth: { persistSession: false } });
}

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@xrproofing.com";

  if (!publicKey || !privateKey) return false;

  webPush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

export async function savePushSubscription(subscription: StoredPushSubscription, userAgent?: string) {
  const supabase = getAdminClient();

  if (!supabase) return { ok: false, reason: "Supabase is not configured" };

  const { error } = await supabase.from("push_subscriptions").upsert({
    endpoint: subscription.endpoint,
    subscription,
    user_agent: userAgent,
    updated_at: new Date().toISOString(),
  }, { onConflict: "endpoint" });

  if (error) return { ok: false, reason: error.message };

  return { ok: true };
}

export async function sendIncomingCallPushNotification(from?: string) {
  const supabase = getAdminClient();

  if (!supabase) return { sent: 0, reason: "Supabase is not configured" };
  if (!configureWebPush()) return { sent: 0, reason: "VAPID keys are not configured" };

  const { data, error } = await supabase.from("push_subscriptions").select("endpoint, subscription");

  if (error) return { sent: 0, reason: error.message };

  const subscriptions = (data || []) as Array<{ endpoint: string; subscription: StoredPushSubscription }>;
  let sent = 0;

  await Promise.all(subscriptions.map(async ({ endpoint, subscription }) => {
    try {
      const now = new Date();
      const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Phoenix" });
      await webPush.sendNotification(subscription, JSON.stringify({
        title: "Incoming call",
        body: `Call from ${from || "Unknown caller"} at ${time}`,
        url: "/crm/conversations",
        tag: "incoming-call",
      }));
      sent += 1;
    } catch (error) {
      const statusCode = typeof error === "object" && error && "statusCode" in error ? Number((error as { statusCode?: number }).statusCode) : 0;
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
      }
    }
  }));

  return { sent };
}
