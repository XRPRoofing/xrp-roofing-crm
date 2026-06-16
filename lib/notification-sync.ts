"use client";

/**
 * Supabase-backed notification sync for real-time cross-device notifications.
 * Falls back to localStorage when Supabase is not available.
 * Table: crm_notifications (id text PK, payload jsonb, created_at timestamptz)
 */

import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import type { CrmNotification } from "@/lib/crm-notifications";
import { readCrmNotifications, readDeletedNotificationIds, saveCrmNotifications } from "@/lib/crm-notifications";

const TABLE = "crm_notifications";

/** Push a notification to Supabase so all devices see it in real-time. */
export async function pushNotificationToSupabase(notification: CrmNotification): Promise<void> {
  if (!hasSupabaseConfig()) return;
  try {
    const supabase = createClient();
    await supabase.from(TABLE).upsert({
      id: notification.id,
      payload: notification,
      created_at: notification.createdAt,
    });
  } catch {
    // silently fall back to localStorage-only
  }
}

/** Mark all notifications as read in Supabase so other devices see the read state. */
export async function markNotificationsReadInSupabase(notifications: CrmNotification[]): Promise<void> {
  if (!hasSupabaseConfig() || notifications.length === 0) return;
  try {
    const supabase = createClient();
    await Promise.all(
      notifications.map((n) =>
        supabase.from(TABLE).upsert({
          id: n.id,
          payload: { ...n, read: true, status: "read" },
          created_at: n.createdAt,
        })
      )
    );
  } catch {
    // best-effort
  }
}

/** Delete a notification from Supabase so it doesn't reappear on other devices. */
export async function deleteNotificationFromSupabase(notificationId: string): Promise<void> {
  if (!hasSupabaseConfig()) return;
  try {
    const supabase = createClient();
    await supabase.from(TABLE).delete().eq("id", notificationId);
  } catch {
    // best-effort
  }
}

/** Load recent notifications from Supabase, merging with localStorage. */
export async function loadNotificationsFromSupabase(): Promise<CrmNotification[]> {
  if (!hasSupabaseConfig()) return readCrmNotifications();
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("id, payload, created_at")
      .order("created_at", { ascending: false })
      .limit(80);
    if (error || !data?.length) return readCrmNotifications();
    const remote = (data as { id: string; payload: CrmNotification }[]).map((row) => ({
      ...row.payload,
      id: row.id,
    }));
    // Merge: remote notifications take priority, keep any local-only ones
    const remoteIds = new Set(remote.map((n) => n.id));
    const localOnly = readCrmNotifications().filter((n) => !remoteIds.has(n.id));
    const merged = [...remote, ...localOnly].slice(0, 80);

    // Dedup notifications with identical title+message (keeps the most recent).
    // Old bug created duplicate "Payment received" notifications with unique
    // timestamp-based IDs for the same invoice on every page load.
    const seen = new Map<string, number>();
    const duplicateIds: string[] = [];
    const deduped = merged.filter((n, i) => {
      const key = `${n.title}::${n.message}`;
      if (seen.has(key)) {
        duplicateIds.push(n.id);
        return false;
      }
      seen.set(key, i);
      return true;
    });

    // Fire-and-forget cleanup of duplicate rows from Supabase
    if (duplicateIds.length > 0) {
      void supabase.from(TABLE).delete().in("id", duplicateIds).then(() => {});
    }

    // Filter out notifications the user has locally deleted (prevents reappearance)
    const deletedIds = readDeletedNotificationIds();
    const filtered = deduped.filter((n) => !deletedIds.includes(n.id));

    // Keep localStorage in sync for offline fallback
    saveCrmNotifications(filtered);
    return filtered;
  } catch {
    return readCrmNotifications();
  }
}

const notificationListeners = new Set<(notifications: CrmNotification[]) => void>();
let notificationChannel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;

/**
 * Subscribe to real-time notification changes from Supabase.
 * Uses a shared channel so multiple callers don't create duplicate connections.
 */
export function subscribeToNotifications(onUpdate: (notifications: CrmNotification[]) => void): () => void {
  if (!hasSupabaseConfig()) return () => {};

  notificationListeners.add(onUpdate);

  if (!notificationChannel) {
    try {
      const supabase = createClient();
      notificationChannel = supabase
        .channel("crm-notifications-realtime-shared")
        .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, async () => {
          const notifications = await loadNotificationsFromSupabase();
          notificationListeners.forEach((cb) => cb(notifications));
        })
        .subscribe();
    } catch {
      notificationChannel = null;
      return () => {};
    }
  }

  return () => {
    notificationListeners.delete(onUpdate);
    if (notificationListeners.size === 0 && notificationChannel) {
      try { createClient().removeChannel(notificationChannel); } catch { /* ignore */ }
      notificationChannel = null;
    }
  };
}
