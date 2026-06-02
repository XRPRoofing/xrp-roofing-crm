const CACHE_NAME = "xrp-crm-pwa-v3";
const APP_SHELL = ["/", "/crm", "/crew", "/login", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("/crm")))
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "INCOMING_CALL_NOTIFICATION") return;

  const from = event.data.from || "Unknown caller";

  event.waitUntil(
    self.registration.showNotification("Incoming call", {
      body: `Call from ${from}`,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "incoming-call",
      requireInteraction: true,
      vibrate: [300, 120, 300, 120, 300],
      data: { url: "/crm/conversations" },
      actions: [
        { action: "open", title: "Open CRM" },
      ],
    })
  );
});

self.addEventListener("push", (event) => {
  const data = event.data?.json?.() || {};

  event.waitUntil(
    self.registration.showNotification(data.title || "XRP CRM", {
      body: data.body || "New CRM notification",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag || "xrp-crm",
      requireInteraction: true,
      vibrate: [300, 120, 300, 120, 300],
      data: { url: data.url || "/crm/conversations" },
      actions: [
        { action: "open", title: "Open CRM" },
      ],
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/crm/conversations";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }

      if (clients.openWindow) return clients.openWindow(url);
      return undefined;
    })
  );
});
