/**
 * Server-side helper to push CRM notifications to the crm_notifications table.
 * Used by API routes (Stripe webhook, invoice tracking, etc.) that run on the
 * server and cannot call addCrmNotification (which is client-side only).
 */

import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

const TABLE = "crm_notifications";

type ServerNotification = {
  title: string;
  message: string;
  actor: string;
  module: string;
};

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function pushServerNotification(input: ServerNotification): Promise<void> {
  const supabase = getAdminClient();
  if (!supabase) return;

  const id = `notification-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const createdAt = new Date().toISOString();

  const payload = {
    id,
    title: input.title,
    message: input.message,
    actor: input.actor,
    module: input.module,
    createdAt,
    read: false,
    status: "unread",
  };

  try {
    await supabase.from(TABLE).upsert({ id, payload, created_at: createdAt });
  } catch {
    // best-effort — don't break the webhook if notification fails
  }
}
