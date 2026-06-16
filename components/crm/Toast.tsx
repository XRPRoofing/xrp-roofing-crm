"use client";

import { useEffect, useState, useCallback } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";

type ToastType = "success" | "error" | "info";

type ToastItem = {
  id: string;
  message: string;
  type: ToastType;
};

let toastListeners: Array<(toast: ToastItem) => void> = [];

export function showToast(message: string, type: ToastType = "success") {
  const toast: ToastItem = {
    id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    message,
    type,
  };
  toastListeners.forEach((listener) => listener(toast));
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((toast: ToastItem) => {
    setToasts((current) => [...current, toast]);
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== toast.id));
    }, 3500);
  }, []);

  useEffect(() => {
    toastListeners.push(addToast);
    return () => {
      toastListeners = toastListeners.filter((l) => l !== addToast);
    };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 right-4 z-[90] flex flex-col gap-2 lg:bottom-6">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold shadow-lg animate-in slide-in-from-right-5 ${
            toast.type === "success"
              ? "bg-green-600 text-white"
              : toast.type === "error"
              ? "bg-red-600 text-white"
              : "bg-blue-600 text-white"
          }`}
        >
          {toast.type === "success" && <CheckCircle2 className="h-4 w-4 shrink-0" />}
          {toast.type === "error" && <AlertCircle className="h-4 w-4 shrink-0" />}
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
            className="ml-2 shrink-0 opacity-70 hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
