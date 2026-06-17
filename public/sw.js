const CACHE_NAME = "xrp-crm-pwa-v9"; // Bumped for ringtone vibration pattern
const APP_SHELL = ["/", "/crm", "/crew", "/login", "/manifest.webmanifest"];

// API routes that should NEVER be cached - always fetch fresh
const API_ROUTES = ["/api/", "/_next/static", "/_next/data"];
// App pages that can be cached for offline use
const APP_PAGES = ["/crm", "/crew", "/login"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => 
      Promise.all(keys.map((key) => {
        // Delete ALL old caches to force fresh data
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }))
    ).then(() => self.clients.claim())
  );
});

// Check if request is an API call
function isApiRequest(url) {
  return API_ROUTES.some((route) => url.pathname.startsWith(route));
}

// Check if request is an app page
function isAppPage(url) {
  return APP_PAGES.some((page) => url.pathname === page || url.pathname.startsWith(page + "/"));
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== "GET") return;
  
  // Skip external requests
  if (url.origin !== self.location.origin) return;

  // API requests: ALWAYS fetch fresh (no caching)
  if (isApiRequest(url)) {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .catch(() => new Response(JSON.stringify({ error: "Network unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" }
        }))
    );
    return;
  }

  // App pages: Network first, fallback to cache
  if (isAppPage(url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Update cache with fresh version
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => {
          // Fallback to cache if network fails
          return caches.match(request).then((cached) => {
            return cached || caches.match("/crm");
          });
        })
    );
    return;
  }

  // Static assets: Cache first for performance
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    })
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
      renotify: true,
      requireInteraction: true,
      vibrate: [400, 200, 400, 200, 400, 1000, 400, 200, 400, 200, 400, 1000, 400, 200, 400, 200, 400],
      silent: false,
      data: { url: "/crm/conversations" },
      actions: [
        { action: "open", title: "Open CRM" },
      ],
    })
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    // Fallback if JSON parsing fails
    data = { title: "XRP CRM", body: event.data ? event.data.text() : "New notification" };
  }

  const notificationPromise = self.registration.showNotification(data.title || "Incoming call", {
    body: data.body || "New CRM notification",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag || "incoming-call",
    renotify: true,
    requireInteraction: true,
    vibrate: [400, 200, 400, 200, 400, 1000, 400, 200, 400, 200, 400, 1000, 400, 200, 400, 200, 400],
    silent: false,
    data: { url: data.url || "/crm/conversations" },
    actions: [
      { action: "open", title: "Open CRM" },
    ],
  });

  event.waitUntil(notificationPromise);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/crm/conversations";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("/crm") && "focus" in client) {
          return client.focus();
        }
      }

      if (clients.openWindow) return clients.openWindow(url);
      return undefined;
    })
  );
});

// Re-subscribe if push subscription expires
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe(event.oldSubscription.options)
      .then((subscription) => {
        return fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subscription),
        });
      })
      .catch(() => undefined)
  );
});
