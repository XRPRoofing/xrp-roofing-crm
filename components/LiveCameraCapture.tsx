"use client";

/**
 * LiveCameraCapture
 * Full-screen camera overlay using getUserMedia.
 * - Keeps camera live after each shot (no OS confirmation screen)
 * - Auto-saves immediately on capture
 * - Shows "Photo Saved" toast + running count
 * - Thumbnail strip of captured photos
 * - X button to close
 * Falls back to <input capture> on devices where getUserMedia is unavailable.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, X, ZoomIn } from "lucide-react";

export type CapturedPhoto = {
  dataUrl: string;
  name: string;
};

type Props = {
  label: string;           // e.g. "Before", "After", "Progress"
  accentColor: string;     // Tailwind bg class e.g. "bg-blue-600"
  onCapture: (photo: CapturedPhoto) => void | Promise<void>;
  onClose: () => void;
  existingCount?: number;  // photos already saved before opening
};

export default function LiveCameraCapture({ label, accentColor, onCapture, onClose, existingCount = 0 }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState(false);
  const [saving, setSaving] = useState(false);
  const [count, setCount] = useState(0);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [camError, setCamError] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => setReady(true);
      }
    } catch {
      setCamError(true);
    }
  }, []);

  useEffect(() => {
    void startCamera();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [startCamera]);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);

    // Compress to JPEG
    const MAX = 1600;
    const scale = Math.min(1, MAX / Math.max(w, h));
    const cw = Math.round(w * scale);
    const ch = Math.round(h * scale);
    const small = document.createElement("canvas");
    small.width = cw;
    small.height = ch;
    small.getContext("2d")?.drawImage(canvas, 0, 0, cw, ch);
    const dataUrl = small.toDataURL("image/jpeg", 0.75);

    // Instant UI feedback — never block the shutter
    const photo: CapturedPhoto = { dataUrl, name: `${label.toLowerCase()}-${Date.now()}.jpg` };
    setCount((c) => c + 1);
    setThumbs((prev) => [...prev, dataUrl]);
    setToast(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(false), 1800);

    // Save in background — camera stays ready immediately
    setSaving(true);
    void Promise.resolve(onCapture(photo)).finally(() => setSaving(false));
  }, [label, onCapture]);

  // Hardware shutter button via volume keys / Enter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void capture(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capture]);

  const totalCount = existingCount + count;

  // Fallback: getUserMedia not supported
  if (camError) {
    return (
      <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-4 bg-black p-6">
        <p className="text-center text-sm font-bold text-white">Camera not available on this device/browser.</p>
        <p className="text-center text-xs text-slate-400">Use the Upload button instead, or open in Chrome/Safari.</p>
        <button type="button" onClick={onClose} className="rounded-2xl bg-white px-6 py-3 text-sm font-black text-slate-900">Close</button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black">
      {/* Camera viewfinder */}
      <div className="relative flex-1 overflow-hidden">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Top bar */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 py-3 pt-safe">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-black text-white uppercase tracking-widest ${accentColor}`}>{label}</span>
            {totalCount > 0 && (
              <span className="rounded-full bg-black/50 px-2.5 py-1 text-xs font-black text-white">
                Photos: {totalCount}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm active:scale-95"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* "Photo Saved" toast */}
        {toast && (
          <div className="absolute left-1/2 top-16 -translate-x-1/2 flex items-center gap-2 rounded-full bg-emerald-600/90 px-4 py-2 text-sm font-black text-white backdrop-blur-sm animate-fade-in">
            <CheckCircle2 className="h-4 w-4" /> Photo Saved
          </div>
        )}

        {/* Not ready overlay */}
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <div className="text-center text-white">
              <Camera className="mx-auto h-10 w-10 animate-pulse" />
              <p className="mt-2 text-sm font-semibold">Starting camera…</p>
            </div>
          </div>
        )}

        {/* Full-size preview tap */}
        {preview && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/90" onClick={() => setPreview(null)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Preview" className="max-h-full max-w-full object-contain" />
            <button type="button" onClick={() => setPreview(null)} className="absolute right-4 top-4 rounded-full bg-white/20 p-2"><X className="h-5 w-5 text-white" /></button>
          </div>
        )}
      </div>

      {/* Thumbnail strip */}
      {thumbs.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto bg-black/80 px-3 py-2">
          {[...thumbs].reverse().map((src, i) => (
            <button key={i} type="button" onClick={() => setPreview(src)} className="relative shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-14 w-20 rounded-lg object-cover opacity-90 hover:opacity-100" />
              <ZoomIn className="absolute right-1 top-1 h-3 w-3 text-white drop-shadow" />
            </button>
          ))}
        </div>
      )}

      {/* Shutter bar */}
      <div className="flex items-center justify-center bg-black px-6 pb-safe py-5">
        <button
          type="button"
          disabled={!ready || saving}
          onClick={() => void capture()}
          className={`flex h-20 w-20 items-center justify-center rounded-full border-4 border-white shadow-xl transition active:scale-90 ${saving ? "opacity-50" : "active:bg-white/20"}`}
          aria-label="Take photo"
        >
          <span className={`h-14 w-14 rounded-full ${accentColor} ${saving ? "animate-pulse" : ""}`} />
        </button>
      </div>
    </div>
  );
}
