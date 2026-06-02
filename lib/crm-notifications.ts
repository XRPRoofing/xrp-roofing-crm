export type CrmNotification = {
  id: string;
  title: string;
  message: string;
  actor: string;
  module: string;
  createdAt: string;
  read: boolean;
};

export const crmNotificationsStorageKey = "xrp-crm-notifications";

export function readCrmNotifications() {
  if (typeof window === "undefined") return [] as CrmNotification[];

  const savedNotifications = window.localStorage.getItem(crmNotificationsStorageKey);
  if (!savedNotifications) return [] as CrmNotification[];

  try {
    return JSON.parse(savedNotifications) as CrmNotification[];
  } catch {
    return [] as CrmNotification[];
  }
}

export function saveCrmNotifications(notifications: CrmNotification[]) {
  window.localStorage.setItem(crmNotificationsStorageKey, JSON.stringify(notifications));
  window.dispatchEvent(new Event("crm-notifications-updated"));
}

export function addCrmNotification(input: Omit<CrmNotification, "id" | "createdAt" | "read">) {
  if (typeof window === "undefined") return;

  const notification: CrmNotification = {
    ...input,
    id: `notification-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(),
    read: false,
  };

  saveCrmNotifications([notification, ...readCrmNotifications()].slice(0, 80));
}

export function addUniqueCrmNotification(uniqueId: string, input: Omit<CrmNotification, "id" | "createdAt" | "read">) {
  if (typeof window === "undefined") return;

  const notifications = readCrmNotifications();
  const id = `notification-${uniqueId}`;
  if (notifications.some((notification) => notification.id === id)) return;

  saveCrmNotifications([
    {
      ...input,
      id,
      createdAt: new Date().toISOString(),
      read: false,
    },
    ...notifications,
  ].slice(0, 80));
}

export function markCrmNotificationsRead() {
  saveCrmNotifications(readCrmNotifications().map((notification) => ({ ...notification, read: true })));
}
