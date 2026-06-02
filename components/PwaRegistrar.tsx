"use client";

import { useEffect } from "react";

export default function PwaRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const register = async () => {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await registration.update().catch(() => undefined);

      if ("Notification" in window && Notification.permission === "default") {
        void Notification.requestPermission();
      }
    };

    if (document.readyState === "complete") void register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
