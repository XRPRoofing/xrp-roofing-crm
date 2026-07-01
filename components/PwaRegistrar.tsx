"use client";

import { useEffect } from "react";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function subscribeToPush(registration: ServiceWorkerRegistration) {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) {
    console.warn("[PwaRegistrar] NEXT_PUBLIC_VAPID_PUBLIC_KEY not set — push disabled");
    return;
  }

  try {
    // Always unsubscribe old subscription and create fresh one to avoid
    // stale/mismatched VAPID key issues that silently prevent delivery
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      await existing.unsubscribe();
      console.log("[PwaRegistrar] unsubscribed stale push subscription");
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    // Send fresh subscription to backend
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error("[PwaRegistrar] push subscribe failed:", res.status, body);
    } else {
      console.log("[PwaRegistrar] push subscription registered successfully");
    }
  } catch (err) {
    console.error("[PwaRegistrar] push subscription error:", err);
  }
}

export default function PwaRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const register = async () => {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await registration.update().catch(() => undefined);

      if ("Notification" in window) {
        if (Notification.permission === "default") {
          const permission = await Notification.requestPermission();
          if (permission === "granted") await subscribeToPush(registration);
        } else if (Notification.permission === "granted") {
          await subscribeToPush(registration);
        }
      }
    };

    if (document.readyState === "complete") void register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
