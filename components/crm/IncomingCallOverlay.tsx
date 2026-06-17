"use client";

import { useEffect, useRef } from "react";
import { Phone, PhoneOff } from "lucide-react";

interface IncomingCallOverlayProps {
  caller: { name: string; phone: string };
  onAnswer: () => void;
  onDecline: () => void;
}

export default function IncomingCallOverlay({ caller, onAnswer, onDecline }: IncomingCallOverlayProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const vibrateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Play ringtone
    const audio = new Audio("/sounds/ringtone.mp3");
    audio.loop = true;
    audio.volume = 0.8;
    audio.play().catch(() => undefined);
    audioRef.current = audio;

    // Vibrate pattern (if supported) — repeat every 2s
    if ("vibrate" in navigator) {
      navigator.vibrate([300, 200, 300, 200, 300]);
      vibrateIntervalRef.current = setInterval(() => {
        navigator.vibrate([300, 200, 300, 200, 300]);
      }, 2000);
    }

    return () => {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
      if (vibrateIntervalRef.current) clearInterval(vibrateIntervalRef.current);
      navigator.vibrate?.(0);
    };
  }, []);

  function handleAnswer() {
    audioRef.current?.pause();
    navigator.vibrate?.(0);
    onAnswer();
  }

  function handleDecline() {
    audioRef.current?.pause();
    navigator.vibrate?.(0);
    onDecline();
  }

  // Format display name: if it's just a phone number, show it nicely
  const displayName = caller.name === caller.phone ? "Unknown Caller" : caller.name;
  const displayPhone = caller.phone;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-between bg-gradient-to-b from-gray-900 via-gray-800 to-gray-900 p-6 sm:p-10">
      {/* Pulse animation behind avatar */}
      <style jsx>{`
        @keyframes pulse-ring {
          0% { transform: scale(0.9); opacity: 0.7; }
          50% { transform: scale(1.15); opacity: 0.3; }
          100% { transform: scale(0.9); opacity: 0.7; }
        }
        @keyframes slide-up {
          0% { transform: translateY(10px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        .pulse-ring {
          animation: pulse-ring 1.8s ease-in-out infinite;
        }
        .slide-up {
          animation: slide-up 0.4s ease-out forwards;
        }
      `}</style>

      {/* Top section — "Incoming Call" label */}
      <div className="slide-up mt-8 text-center sm:mt-16">
        <p className="text-sm font-medium uppercase tracking-widest text-green-400">Incoming Call</p>
      </div>

      {/* Center section — caller info + avatar */}
      <div className="slide-up flex flex-col items-center gap-4">
        {/* Pulsing avatar ring */}
        <div className="relative">
          <div className="pulse-ring absolute inset-0 rounded-full bg-green-500/30" style={{ margin: "-12px" }} />
          <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-gray-700 sm:h-36 sm:w-36">
            <Phone className="h-12 w-12 text-green-400 sm:h-14 sm:w-14" />
          </div>
        </div>

        {/* Caller info */}
        <div className="mt-4 text-center">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">{displayName}</h2>
          <p className="mt-1 text-lg text-gray-300 sm:text-xl">{displayPhone}</p>
        </div>
      </div>

      {/* Bottom section — Answer / Decline buttons */}
      <div className="slide-up mb-10 flex w-full max-w-xs items-center justify-between sm:mb-16 sm:max-w-sm">
        {/* Decline */}
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={handleDecline}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 shadow-lg shadow-red-600/30 transition-transform active:scale-90 sm:h-20 sm:w-20"
            aria-label="Decline call"
          >
            <PhoneOff className="h-7 w-7 text-white sm:h-8 sm:w-8" />
          </button>
          <span className="text-xs font-medium text-gray-400 sm:text-sm">Decline</span>
        </div>

        {/* Answer */}
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={handleAnswer}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-green-600 shadow-lg shadow-green-600/30 transition-transform active:scale-90 sm:h-20 sm:w-20"
            aria-label="Answer call"
          >
            <Phone className="h-7 w-7 text-white sm:h-8 sm:w-8" />
          </button>
          <span className="text-xs font-medium text-gray-400 sm:text-sm">Answer</span>
        </div>
      </div>
    </div>
  );
}
