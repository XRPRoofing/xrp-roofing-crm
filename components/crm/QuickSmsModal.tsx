"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Send, X } from "lucide-react";
import { getTwilioLines, type TwilioLine } from "@/lib/twilio/numbers";
import { sendSms } from "@/lib/twilio/client";

interface QuickSmsModalProps {
  phone: string;
  name?: string;
  onClose: () => void;
}

export default function QuickSmsModal({ phone, name, onClose }: QuickSmsModalProps) {
  const [lines] = useState<TwilioLine[]>(() => getTwilioLines());
  const [fromNumber, setFromNumber] = useState(() => lines[0]?.number || "");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSend = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed || !phone || sending) return;
    setSending(true);
    setError("");
    try {
      await sendSms({ to: phone, body: trimmed, from: fromNumber });
      setSent(true);
      setTimeout(() => onClose(), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }, [body, phone, fromNumber, sending, onClose]);

  const displayName = name || phone;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="mx-4 w-full max-w-md rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 text-green-700">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Send Message</p>
              <p className="text-xs text-gray-500">To: {displayName}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          {/* From number selector */}
          {lines.length > 1 && (
            <label className="grid gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-gray-500">Send from</span>
              <select
                value={fromNumber}
                onChange={(e) => setFromNumber(e.target.value)}
                className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50"
              >
                {lines.map((line) => (
                  <option key={line.key} value={line.number}>{line.label}</option>
                ))}
              </select>
            </label>
          )}

          {/* Message input */}
          <label className="grid gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wide text-gray-500">Message</span>
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void handleSend(); } }}
              rows={4}
              className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50"
              placeholder="Type your message..."
            />
          </label>

          {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
          {sent && <p className="text-xs font-semibold text-green-600">Message sent! It will appear in Conversations.</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={() => void handleSend()}
            disabled={!body.trim() || sending || sent}
            className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {sending ? "Sending..." : sent ? "Sent!" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
