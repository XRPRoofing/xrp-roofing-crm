"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff, X } from "lucide-react";

export type CallCardState = "ringing" | "active" | "held";

interface FloatingCallCardProps {
  state: CallCardState;
  caller: { name: string; phone: string };
  muted: boolean;
  onAnswer: () => void;
  onDecline: () => void;
  onEnd: () => void;
  onMute: () => void;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function FloatingCallCard({
  state,
  caller,
  muted,
  onAnswer,
  onDecline,
  onEnd,
  onMute,
}: FloatingCallCardProps) {
  const [duration, setDuration] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (state === "active" || state === "held") {
      setDuration(0);
      intervalRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } else {
      setDuration(0);
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [state]);

  const displayName = caller.name === caller.phone ? "Unknown Caller" : caller.name;

  if (state === "ringing") {
    return (
      <div className="animate-call-card-in fixed bottom-20 right-4 z-[9999] w-72 rounded-xl border border-green-200 bg-white p-4 shadow-2xl sm:bottom-6 sm:right-6">
        {/* Pulse dot */}
        <div className="mb-2 flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
          </span>
          <span className="text-xs font-semibold uppercase tracking-wide text-green-700">Incoming Call</span>
        </div>

        {/* Caller info */}
        <div className="mb-3">
          <p className="truncate text-sm font-bold text-gray-900">{displayName}</p>
          <p className="text-xs text-gray-500">{caller.phone}</p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={onAnswer}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-green-700 active:scale-95"
            aria-label="Answer call"
          >
            <Phone className="h-3.5 w-3.5" />
            Answer
          </button>
          <button
            onClick={onDecline}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-red-700 active:scale-95"
            aria-label="Decline call"
          >
            <PhoneOff className="h-3.5 w-3.5" />
            Decline
          </button>
        </div>
      </div>
    );
  }

  // Active / held call
  return (
    <div className="fixed bottom-20 right-4 z-[9999] w-72 rounded-xl border border-blue-200 bg-white p-4 shadow-2xl sm:bottom-6 sm:right-6">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" />
          </span>
          <span className="text-xs font-semibold text-blue-700">
            {state === "held" ? "On Hold" : "In Call"}
          </span>
        </div>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-600">
          {formatDuration(duration)}
        </span>
      </div>

      {/* Caller info */}
      <div className="mb-3">
        <p className="truncate text-sm font-bold text-gray-900">{displayName}</p>
        <p className="text-xs text-gray-500">{caller.phone}</p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={onMute}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold shadow-sm transition-colors active:scale-95 ${
            muted
              ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          {muted ? "Unmute" : "Mute"}
        </button>
        <button
          onClick={onEnd}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-red-700 active:scale-95"
          aria-label="End call"
        >
          <X className="h-3.5 w-3.5" />
          End
        </button>
      </div>
    </div>
  );
}
