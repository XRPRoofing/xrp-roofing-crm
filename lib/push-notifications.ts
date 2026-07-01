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

export async function savePushSubscription(subscription: StoredPushSubscription, userAgent?: string, userId?: string) {
  const supabase = getAdminClient();

  if (!supabase) return { ok: false, reason: "Supabase is not configured" };

  const record: Record<string, unknown> = {
    endpoint: subscription.endpoint,
    subscription,
    user_agent: userAgent,
    updated_at: new Date().toISOString(),
  };
  if (userId) record.user_id = userId;

  const { error } = await supabase.from("push_subscriptions").upsert(record, { onConflict: "endpoint" });

  if (error) {
    console.error("[push] savePushSubscription failed:", error.message, "— ensure push_subscriptions table exists in Supabase");
    return { ok: false, reason: error.message };
  }

  console.log("[push] subscription saved:", subscription.endpoint.slice(0, 60));
  return { ok: true };
}

export async function checkPushStatus() {
  const checks: Record<string, unknown> = {};

  // Check Supabase
  const supabase = getAdminClient();
  if (!supabase) {
    checks.supabase = "NOT CONFIGURED — missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY";
  } else {
    checks.supabase = "OK";
  }

  // Check VAPID keys
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  checks.vapidPublicKey = publicKey ? `OK (${publicKey.slice(0, 10)}...)` : "MISSING";
  checks.vapidPrivateKey = privateKey ? "OK (set)" : "MISSING";

  // Check table & subscriptions
  if (supabase) {
    const { data, error } = await supabase.from("push_subscriptions").select("endpoint, updated_at");
    if (error) {
      checks.table = `ERROR: ${error.message}`;
      checks.subscriptions = 0;
    } else {
      checks.table = "OK";
      checks.subscriptions = data?.length || 0;
      checks.latestSubscription = data?.[0]?.updated_at || null;
    }
  }

  return checks;
}

export async function sendIncomingCallPushNotification(from?: string) {
  const supabase = getAdminClient();

  if (!supabase) {
    console.error("[push] Supabase is not configured");
    return { sent: 0, reason: "Supabase is not configured" };
  }
  if (!configureWebPush()) {
    console.error("[push] VAPID keys are not configured — check NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY");
    return { sent: 0, reason: "VAPID keys are not configured" };
  }

  const { data, error } = await supabase.from("push_subscriptions").select("endpoint, subscription");

  if (error) {
    console.error("[push] Failed to query push_subscriptions:", error.message);
    return { sent: 0, reason: error.message };
  }

  const subscriptions = (data || []) as Array<{ endpoint: string; subscription: StoredPushSubscription }>;
  console.log(`[push] Found ${subscriptions.length} push subscription(s) to notify`);

  if (subscriptions.length === 0) {
    return { sent: 0, reason: "No push subscriptions found" };
  }

  let sent = 0;

  await Promise.all(subscriptions.map(async ({ endpoint, subscription }) => {
    try {
      const now = new Date();
      const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Phoenix" });
      await webPush.sendNotification(subscription, JSON.stringify({
        title: "📞 Incoming Call",
        body: `Call from ${from || "Unknown caller"} at ${time}`,
        url: "/crm/phone",
        tag: "incoming-call",
      }));
      sent += 1;
    } catch (pushError) {
      const statusCode = typeof pushError === "object" && pushError && "statusCode" in pushError ? Number((pushError as { statusCode?: number }).statusCode) : 0;
      console.error(`[push] Failed to send to ${endpoint.slice(0, 50)}:`, statusCode, pushError instanceof Error ? pushError.message : pushError);
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
      }
    }
  }));

  console.log(`[push] Sent ${sent}/${subscriptions.length} push notification(s) for call from ${from || "unknown"}`);
  return { sent };
}
