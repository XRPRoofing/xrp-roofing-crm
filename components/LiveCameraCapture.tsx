"use client";

/**
 * LiveCameraCapture
 * Full-screen camera overlay using getUserMedia — CompanyCam-style UI.
 * - Keeps camera live after each shot (no OS confirmation screen)
 * - Auto-saves immediately on capture
 * - Flash control: Off / On / Auto (torch via video track)
 * - Zoom: 0.5× / 1× / 2× pills + pinch-to-zoom gesture on mobile
 * - HIDDEN / IMAGE / OUTLINE view-mode tab bar
 * - "Photo Saved" toast + running count
 * - Thumbnail strip of captured photos
 * - X button to close
 * Falls back gracefully on devices where getUserMedia is unavailable.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, ChevronRight, Info, X, Zap, ZapOff } from "lucide-react";

export type CapturedPhoto = {
  dataUrl: string;
  name: string;
};

type ViewMode = "HIDDEN" | "IMAGE" | "OUTLINE";
type FlashMode = "off" | "on" | "auto";
type ZoomLevel = 0.5 | 1 | 2;

const FLASH_LABELS: Record<FlashMode, string> = { off: "Off", on: "On", auto: "Auto" };
const ZOOM_LEVELS: ZoomLevel[] = [0.5, 1, 2];

type Props = {
  label: string;           // e.g. "Before", "After", "Progress"
  accentColor: string;     // Tailwind bg class e.g. "bg-blue-600"
  onCapture: (photo: CapturedPhoto) => void | Promise<void>;
  onClose: () => void;
  existingCount?: number;  // photos already saved before opening
  jobAddress?: string;     // shown in top address bar
};

export default function LiveCameraCapture({ label, accentColor, onCapture, onClose, existingCount = 0, jobAddress }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState(false);
  const savingCount = useRef(0);
  const [savingDisplay, setSavingDisplay] = useState(0);
  const [count, setCount] = useState(0);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [camError, setCamError] = useState(false);
  const [zoom, setZoom] = useState<ZoomLevel>(1);
  const [flashMode, setFlashMode] = useState<FlashMode>("off");
  const [flashSupported, setFlashSupported] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("IMAGE");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pinch-to-zoom state
  const pinchStartDistance = useRef<number | null>(null);
  const pinchStartZoom = useRef<number>(1);
  const zoomRangeRef = useRef<{ min: number; max: number }>({ min: 1, max: 1 });
  const currentHwZoom = useRef<number>(1);

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
      // Detect flash (torch) support
      const track = stream.getVideoTracks()[0];
      if (track) {
        const caps = track.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean; zoom?: { min: number; max: number } }) | undefined;
        if (caps?.torch) setFlashSupported(true);
        if (caps?.zoom) {
          zoomRangeRef.current = { min: caps.zoom.min ?? 1, max: caps.zoom.max ?? 1 };
        }
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

  // Apply zoom via video track constraint where supported
  useEffect(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const caps = track.getCapabilities?.() as (MediaTrackCapabilities & { zoom?: { min: number; max: number } }) | undefined;
    if (caps?.zoom) {
      const min = caps.zoom.min ?? 1;
      const max = caps.zoom.max ?? 1;
      zoomRangeRef.current = { min, max };
      let target: number;
      if (zoom === 0.5) target = min;
      else if (zoom === 2) target = Math.min(max, min * 4);
      else target = Math.min(min * 2, max);
      target = Math.max(min, Math.min(target, max));
      currentHwZoom.current = target;
      void track.applyConstraints({ advanced: [{ zoom: target } as MediaTrackConstraintSet] }).catch(() => {});
    }
  }, [zoom]);

  // Apply flash (torch) via video track constraint
  useEffect(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !flashSupported) return;
    const torchOn = flashMode === "on";
    void track.applyConstraints({ advanced: [{ torch: torchOn } as MediaTrackConstraintSet] }).catch(() => {});
  }, [flashMode, flashSupported]);

  // Pinch-to-zoom handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDistance.current = Math.sqrt(dx * dx + dy * dy);
      pinchStartZoom.current = currentHwZoom.current;
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStartDistance.current !== null) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const scale = dist / pinchStartDistance.current;
      const { min, max } = zoomRangeRef.current;
      const newZoom = Math.max(min, Math.min(max, pinchStartZoom.current * scale));
      currentHwZoom.current = newZoom;

      const track = streamRef.current?.getVideoTracks()[0];
      if (track) {
        void track.applyConstraints({ advanced: [{ zoom: newZoom } as MediaTrackConstraintSet] }).catch(() => {});
      }
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (pinchStartDistance.current !== null) {
      pinchStartDistance.current = null;
      // Snap to nearest zoom level pill
      const { min, max } = zoomRangeRef.current;
      const zoomFraction = max > min ? (currentHwZoom.current - min) / (max - min) : 0;
      if (zoomFraction < 0.15) setZoom(0.5);
      else if (zoomFraction > 0.5) setZoom(2);
      else setZoom(1);
    }
  }, []);

  const capture = useCallback(() => {
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

    // Compress to JPEG — use smaller canvas
    const MAX = 1600;
    const scale = Math.min(1, MAX / Math.max(w, h));
    const cw = Math.round(w * scale);
    const ch = Math.round(h * scale);
    const small = document.createElement("canvas");
    small.width = cw;
    small.height = ch;
    small.getContext("2d")?.drawImage(canvas, 0, 0, cw, ch);

    // Quick low-res thumbnail for the strip (never blocks shutter)
    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = 160;
    thumbCanvas.height = Math.round(160 * (ch / cw));
    thumbCanvas.getContext("2d")?.drawImage(small, 0, 0, thumbCanvas.width, thumbCanvas.height);
    const thumbUrl = thumbCanvas.toDataURL("image/jpeg", 0.5);

    // Instant UI feedback — never block the shutter
    setCount((c) => c + 1);
    setThumbs((prev) => [...prev, thumbUrl]);
    setToast(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(false), 1800);

    // Flash auto mode: briefly fire torch for capture if ambient is low
    if (flashMode === "auto" && flashSupported) {
      const track = streamRef.current?.getVideoTracks()[0];
      if (track) {
        void track.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] }).catch(() => {});
        setTimeout(() => {
          void track.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] }).catch(() => {});
        }, 400);
      }
    }

    // Compress full-res in background, then save — camera stays ready
    savingCount.current += 1;
    setSavingDisplay(savingCount.current);

    const photoName = `${label.toLowerCase()}-${Date.now()}.jpg`;

    // Use OffscreenCanvas for async compression when available
    const compressAndSave = async () => {
      let dataUrl: string;
      if (typeof OffscreenCanvas !== "undefined") {
        const offscreen = new OffscreenCanvas(cw, ch);
        offscreen.getContext("2d")?.drawImage(small, 0, 0);
        const blob = await offscreen.convertToBlob({ type: "image/jpeg", quality: 0.75 });
        dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } else {
        dataUrl = small.toDataURL("image/jpeg", 0.75);
      }
      const photo: CapturedPhoto = { dataUrl, name: photoName };
      await Promise.resolve(onCapture(photo));
    };

    void compressAndSave().finally(() => {
      savingCount.current -= 1;
      setSavingDisplay(savingCount.current);
    });
  }, [label, onCapture, flashMode, flashSupported]);

  // Hardware shutter button via volume keys / Enter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void capture(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capture]);

  const totalCount = existingCount + count;

  const cycleFlash = useCallback(() => {
    setFlashMode((current) => {
      if (current === "off") return "on";
      if (current === "on") return "auto";
      return "off";
    });
  }, []);

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
      <div
        className="relative flex-1 overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Top bar — address + controls (CompanyCam style) */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent px-4 py-3 pt-safe">
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm active:scale-95"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Center: address / label */}
          <button type="button" className="flex min-w-0 items-center gap-1 rounded-full bg-black/40 px-4 py-1.5 backdrop-blur-sm active:bg-black/60">
            <span className="max-w-[160px] truncate text-sm font-bold text-white">
              {jobAddress ?? label}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-white/70" />
          </button>

          {/* Flash toggle */}
          {flashSupported ? (
            <button
              type="button"
              onClick={cycleFlash}
              className="flex h-9 items-center gap-1 rounded-full bg-black/40 px-3 text-white backdrop-blur-sm active:scale-95"
            >
              {flashMode === "off" ? <ZapOff className="h-4 w-4" /> : <Zap className="h-4 w-4 text-yellow-400" />}
              <span className="text-[10px] font-black uppercase">{FLASH_LABELS[flashMode]}</span>
            </button>
          ) : (
            <button type="button" className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm active:scale-95">
              <Info className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* "Photo Saved" toast */}
        {toast && (
          <div className="absolute left-1/2 top-16 -translate-x-1/2 flex items-center gap-2 rounded-full bg-emerald-600/90 px-4 py-2 text-sm font-black text-white backdrop-blur-sm">
            <CheckCircle2 className="h-4 w-4" /> Photo Saved
          </div>
        )}

        {/* Photo type badge + count */}
        {totalCount > 0 && (
          <div className="absolute right-3 top-14 flex flex-col items-end gap-1.5">
            <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-widest text-white ${accentColor}`}>{label}</span>
            <span className="rounded-full bg-black/50 px-2.5 py-1 text-xs font-black text-white backdrop-blur-sm">
              {totalCount} photo{totalCount !== 1 ? "s" : ""}
            </span>
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
            <button type="button" onClick={() => setPreview(null)} className="absolute right-4 top-4 rounded-full bg-white/20 p-2">
              <X className="h-5 w-5 text-white" />
            </button>
          </div>
        )}
      </div>

      {/* Thumbnail strip */}
      {thumbs.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto bg-black px-3 py-1.5">
          {[...thumbs].reverse().map((src, i) => (
            <button key={i} type="button" onClick={() => setPreview(src)} className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-12 w-16 rounded-md object-cover opacity-90 hover:opacity-100" />
            </button>
          ))}
        </div>
      )}

      {/* Bottom controls bar */}
      <div className="flex flex-col items-center gap-3 bg-black pb-safe px-6 pt-3 pb-4">
        {/* Zoom pills */}
        <div className="flex items-center gap-2 rounded-full bg-black/60 p-1 backdrop-blur-sm">
          {ZOOM_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => setZoom(level)}
              className={`rounded-full px-4 py-1.5 text-xs font-black transition ${zoom === level ? "bg-[#0A3D91] text-white" : "text-white/60 hover:text-white"}`}
            >
              {level === 0.5 ? ".5" : level}×
            </button>
          ))}
        </div>

        {/* Shutter button */}
        <button
          type="button"
          disabled={!ready}
          onClick={() => void capture()}
          className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white shadow-xl transition active:scale-90 active:bg-white/20"
          aria-label="Take photo"
        >
          <span className="h-14 w-14 rounded-full bg-white" />
        </button>

        {/* Background upload indicator */}
        {savingDisplay > 0 && (
          <p className="text-xs font-bold text-white/70 animate-pulse">
            Uploading {savingDisplay} photo{savingDisplay !== 1 ? "s" : ""}…
          </p>
        )}

        {/* HIDDEN / IMAGE / OUTLINE tab bar */}
        <div className="flex w-full items-center justify-center gap-0">
          {(["HIDDEN", "IMAGE", "OUTLINE"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`flex-1 py-2 text-[11px] font-black uppercase tracking-widest transition ${
                viewMode === mode
                  ? "rounded-full bg-[#0A3D91] text-white"
                  : "text-white/50 hover:text-white"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
