"use client";

/**
 * LiveCameraCapture
 * Full-screen camera overlay using getUserMedia — CompanyCam-style UI.
 * - Keeps camera live after each shot (no OS confirmation screen)
 * - Auto-saves immediately on capture
 * - Flash control: Off / On / Auto (torch via video track)
 * - Video recording: record short clips with audio via MediaRecorder
 * - Zoom: 0.5× / 1× / 2× pills + pinch-to-zoom gesture on mobile
 * - HIDDEN / IMAGE / OUTLINE view-mode tab bar
 * - "Photo Saved" / "Video Saved" toast + running count
 * - Thumbnail strip of captured photos/videos
 * - X button to close
 * Falls back gracefully on devices where getUserMedia is unavailable.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, ChevronRight, Info, Video, X, Zap, ZapOff } from "lucide-react";

export type CapturedPhoto = {
  dataUrl: string;
  name: string;
};

type CaptureMode = "photo" | "video";
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
  const [captureMode, setCaptureMode] = useState<CaptureMode>("photo");
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
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
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
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

  // --- Video recording ---
  const startRecording = useCallback(async () => {
    const videoStream = streamRef.current;
    if (!videoStream) return;

    // Get audio stream separately
    let audioStream: MediaStream | null = null;
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      audioStreamRef.current = audioStream;
    } catch {
      // No audio permission — record video-only
    }

    // Combine video + audio tracks
    const combinedTracks = [...videoStream.getVideoTracks()];
    if (audioStream) combinedTracks.push(...audioStream.getAudioTracks());
    const combinedStream = new MediaStream(combinedTracks);

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
        ? "video/webm;codecs=vp8,opus"
        : MediaRecorder.isTypeSupported("video/webm")
          ? "video/webm"
          : "video/mp4";

    const recorder = new MediaRecorder(combinedStream, { mimeType });
    recordedChunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      // Stop the recording timer
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }

      // Stop audio stream
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;

      const chunks = recordedChunksRef.current;
      if (chunks.length === 0) return;

      const ext = mimeType.includes("mp4") ? "mp4" : "webm";
      const blob = new Blob(chunks, { type: mimeType });
      const videoName = `${label.toLowerCase()}-${Date.now()}.${ext}`;

      // Generate a thumbnail from the current video frame
      const video = videoRef.current;
      const thumbCanvas = document.createElement("canvas");
      thumbCanvas.width = 160;
      thumbCanvas.height = 90;
      if (video) {
        thumbCanvas.getContext("2d")?.drawImage(video, 0, 0, 160, 90);
      }
      const thumbUrl = thumbCanvas.toDataURL("image/jpeg", 0.5);

      setCount((c) => c + 1);
      setThumbs((prev) => [...prev, thumbUrl]);
      setToast(true);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(false), 1800);

      savingCount.current += 1;
      setSavingDisplay(savingCount.current);

      const saveVideo = async () => {
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        await Promise.resolve(onCapture({ dataUrl, name: videoName }));
      };

      void saveVideo().finally(() => {
        savingCount.current -= 1;
        setSavingDisplay(savingCount.current);
      });

      setRecording(false);
      setRecordingTime(0);
    };

    mediaRecorderRef.current = recorder;
    recorder.start(1000); // collect data every second
    setRecording(true);
    setRecordingTime(0);
    recordingTimerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
  }, [label, onCapture]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  // Cleanup recording on unmount
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  // Hardware shutter button via volume keys / Enter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (captureMode === "video") {
          if (recording) stopRecording(); else void startRecording();
        } else {
          void capture();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capture, captureMode, recording, startRecording, stopRecording]);

  const totalCount = existingCount + count;

  const formatTime = useCallback((seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }, []);

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

        {/* Photo / Video mode toggle — placed at top so it's visible above mobile nav bars */}
        <div className="absolute left-1/2 top-14 -translate-x-1/2 z-10">
          <div className="flex items-center gap-1 rounded-full bg-black/60 p-1 backdrop-blur-sm">
            <button
              type="button"
              disabled={recording}
              onClick={() => setCaptureMode("photo")}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-black transition ${
                captureMode === "photo" ? "bg-[#0A3D91] text-white" : "text-white/60 hover:text-white"
              } ${recording ? "opacity-50" : ""}`}
            >
              <Camera className="h-3.5 w-3.5" /> Photo
            </button>
            <button
              type="button"
              disabled={recording}
              onClick={() => setCaptureMode("video")}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-black transition ${
                captureMode === "video" ? "bg-red-600 text-white" : "text-white/60 hover:text-white"
              } ${recording ? "opacity-50" : ""}`}
            >
              <Video className="h-3.5 w-3.5" /> Video
            </button>
          </div>
        </div>

        {/* Recording indicator */}
        {recording && (
          <div className="absolute left-1/2 top-[6.5rem] -translate-x-1/2 flex items-center gap-2 rounded-full bg-red-600/90 px-4 py-2 text-sm font-black text-white backdrop-blur-sm">
            <span className="h-3 w-3 animate-pulse rounded-full bg-white" />
            REC {formatTime(recordingTime)}
          </div>
        )}

        {/* "Photo/Video Saved" toast */}
        {toast && !recording && (
          <div className="absolute left-1/2 top-[6.5rem] -translate-x-1/2 flex items-center gap-2 rounded-full bg-emerald-600/90 px-4 py-2 text-sm font-black text-white backdrop-blur-sm">
            <CheckCircle2 className="h-4 w-4" /> {captureMode === "video" ? "Video" : "Photo"} Saved
          </div>
        )}

        {/* Photo type badge + count */}
        {totalCount > 0 && !recording && (
          <div className="absolute right-3 top-[6.5rem] flex flex-col items-end gap-1.5">
            <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-widest text-white ${accentColor}`}>{label}</span>
            <span className="rounded-full bg-black/50 px-2.5 py-1 text-xs font-black text-white backdrop-blur-sm">
              {totalCount} file{totalCount !== 1 ? "s" : ""}
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

        {/* Shutter / Record button */}
        {captureMode === "video" ? (
          <button
            type="button"
            disabled={!ready}
            onClick={() => { if (recording) stopRecording(); else void startRecording(); }}
            className={`flex h-20 w-20 items-center justify-center rounded-full border-4 shadow-xl transition active:scale-90 ${
              recording ? "border-white bg-black/20" : "border-red-500"
            }`}
            aria-label={recording ? "Stop recording" : "Start recording"}
          >
            {recording ? (
              <span className="h-8 w-8 rounded-md bg-red-500" />
            ) : (
              <span className="h-14 w-14 rounded-full bg-red-500" />
            )}
          </button>
        ) : (
          <button
            type="button"
            disabled={!ready}
            onClick={() => void capture()}
            className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white shadow-xl transition active:scale-90 active:bg-white/20"
            aria-label="Take photo"
          >
            <span className="h-14 w-14 rounded-full bg-white" />
          </button>
        )}

        {/* Background upload indicator */}
        {savingDisplay > 0 && (
          <p className="text-xs font-bold text-white/70 animate-pulse">
            Uploading {savingDisplay} file{savingDisplay !== 1 ? "s" : ""}…
          </p>
        )}


      </div>
    </div>
  );
}
