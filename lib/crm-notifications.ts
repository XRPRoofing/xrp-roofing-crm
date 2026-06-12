import { pushNotificationToSupabase } from "@/lib/notification-sync";

export type CrmNotification = {
  id: string;
  title: string;
  message: string;
  actor: string;
  module: string;
  createdAt: string;
  read: boolean;
  status?: "unread" | "read" | "archived" | "deleted";
};

export const crmNotificationsStorageKey = "xrp-crm-notifications";
const crmDeletedNotificationsStorageKey = "xrp-crm-deleted-notifications";

export function readDeletedNotificationIds() {
  if (typeof window === "undefined") return [] as string[];

  try {
    return JSON.parse(window.localStorage.getItem(crmDeletedNotificationsStorageKey) || "[]") as string[];
  } catch {
    return [] as string[];
  }
}

function saveDeletedNotificationIds(ids: string[]) {
  window.localStorage.setItem(crmDeletedNotificationsStorageKey, JSON.stringify(Array.from(new Set(ids)).slice(0, 500)));
}

export function readCrmNotifications() {
  if (typeof window === "undefined") return [] as CrmNotification[];

  const savedNotifications = window.localStorage.getItem(crmNotificationsStorageKey);
  if (!savedNotifications) return [] as CrmNotification[];

  try {
    const deletedIds = readDeletedNotificationIds();
    const filtered = (JSON.parse(savedNotifications) as CrmNotification[]).filter((notification) => notification.status !== "deleted" && !deletedIds.includes(notification.id));
    // Dedup by title+message (keeps the first = most recent, since ordered newest-first)
    const seen = new Set<string>();
    return filtered.filter((n) => {
      const key = `${n.title}::${n.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch {
    return [] as CrmNotification[];
  }
}

export function saveCrmNotifications(notifications: CrmNotification[]) {
  window.localStorage.setItem(crmNotificationsStorageKey, JSON.stringify(notifications));
  window.dispatchEvent(new Event("crm-notifications-updated"));
}

export function addCrmNotification(input: Omit<CrmNotification, "id" | "createdAt" | "read" | "status">) {
  if (typeof window === "undefined") return;

  const notification: CrmNotification = {
    ...input,
    id: `notification-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(),
    read: false,
    status: "unread",
  };

  if (readDeletedNotificationIds().includes(notification.id)) return;
  saveCrmNotifications([notification, ...readCrmNotifications()].slice(0, 80));
  void pushNotificationToSupabase(notification);
}

export function addUniqueCrmNotification(uniqueId: string, input: Omit<CrmNotification, "id" | "createdAt" | "read" | "status">) {
  if (typeof window === "undefined") return;

  const notifications = readCrmNotifications();
  const id = `notification-${uniqueId}`;
  if (readDeletedNotificationIds().includes(id) || notifications.some((notification) => notification.id === id)) return;

  const notification: CrmNotification = {
    ...input,
    id,
    createdAt: new Date().toISOString(),
    read: false,
    status: "unread",
  };

  saveCrmNotifications([notification, ...notifications].slice(0, 80));
  void pushNotificationToSupabase(notification);
}

export function markCrmNotificationsRead() {
  saveCrmNotifications(readCrmNotifications().map((notification) => ({ ...notification, read: true, status: "read" })));
}

export function archiveCrmNotification(notificationId: string) {
  saveCrmNotifications(readCrmNotifications().map((notification) => notification.id === notificationId ? { ...notification, read: true, status: "archived" } : notification));
}

export function deleteCrmNotification(notificationId: string) {
  saveDeletedNotificationIds([...readDeletedNotificationIds(), notificationId]);
  saveCrmNotifications(readCrmNotifications().filter((notification) => notification.id !== notificationId));
}
