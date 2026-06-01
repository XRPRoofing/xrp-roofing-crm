"use client";

import { useEffect } from "react";

export default function PwaRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/sw.js");
      if ("Notification" in window && Notification.permission === "default") {
        void Notification.requestPermission();
      }
    });
  }, []);

  return null;
}
