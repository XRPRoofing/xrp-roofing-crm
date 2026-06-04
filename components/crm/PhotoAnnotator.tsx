"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, Undo2, X } from "lucide-react";

export type AnnotatorImage = { name: string; dataUrl: string };
export type AnnotatedResult = { name: string; dataUrl: string; note: string };

type Stroke = { color: string; width: number; points: { x: number; y: number }[] };

const penColors = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#ffffff", "#0f172a"];
const penSizes = [
  { label: "S", value: 6 },
  { label: "M", value: 12 },
  { label: "L", value: 20 },
];

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  text.split(/\n/).forEach((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      return;
    }
    let current = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const candidate = `${current} ${words[i]}`;
      if (ctx.measureText(candidate).width > maxWidth) {
        lines.push(current);
        current = words[i];
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  });
  return lines;
}

/**
 * Full-screen editor that lets the user draw on a photo and attach a note, then
 * exports a NEW flattened JPEG (drawings + note caption baked in). Handles a
 * queue of images one at a time and returns all results via onComplete.
 */
export default function PhotoAnnotator({
  images,
  onComplete,
  onCancel,
}: {
  images: AnnotatorImage[] | null;
  onComplete: (results: AnnotatedResult[]) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseImageRef = useRef<HTMLImageElement | null>(null);
  const drawingRef = useRef(false);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<AnnotatedResult[]>([]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [note, setNote] = useState("");
  const [color, setColor] = useState(penColors[0]);
  const [size, setSize] = useState(penSizes[1].value);
  const [ready, setReady] = useState(false);

  const current = images && images.length > 0 ? images[index] : null;

  const redraw = useCallback((strokeList: Stroke[]) => {
    const canvas = canvasRef.current;
    const image = baseImageRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    strokeList.forEach((stroke) => {
      if (stroke.points.length === 0) return;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      stroke.points.forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.stroke();
      if (stroke.points.length === 1) {
        ctx.fillStyle = stroke.color;
        ctx.beginPath();
        ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }, []);

  // Load the current image into the canvas whenever the queue advances. State
  // resets happen on advance (handleSaveCurrent) / fresh mount, so this effect
  // only performs the async image load.
  useEffect(() => {
    if (!current) return;
    const image = new window.Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = image.naturalWidth || 1280;
      canvas.height = image.naturalHeight || 960;
      baseImageRef.current = image;
      redraw([]);
      setReady(true);
    };
    image.src = current.dataUrl;
  }, [current, redraw]);

  function pointerPosition(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!ready) return;
    event.preventDefault();
    canvasRef.current?.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const point = pointerPosition(event);
    setStrokes((current) => [...current, { color, width: size, points: [point] }]);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    event.preventDefault();
    const point = pointerPosition(event);
    setStrokes((current) => {
      if (current.length === 0) return current;
      const next = current.slice();
      const last = next[next.length - 1];
      next[next.length - 1] = { ...last, points: [...last.points, point] };
      redraw(next);
      return next;
    });
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false;
    try { canvasRef.current?.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
  }

  function handleUndo() {
    setStrokes((current) => {
      const next = current.slice(0, -1);
      redraw(next);
      return next;
    });
  }

  function handleClear() {
    setStrokes([]);
    redraw([]);
  }

  function buildResult(): AnnotatedResult | null {
    const canvas = canvasRef.current;
    if (!canvas || !current) return null;
    const trimmedNote = note.trim();

    const output = document.createElement("canvas");
    const captionHeight = trimmedNote ? Math.round(canvas.width * 0.04) + 24 : 0;
    output.width = canvas.width;
    output.height = canvas.height + captionHeight;
    const ctx = output.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0);

    if (trimmedNote) {
      const fontSize = Math.max(18, Math.round(canvas.width * 0.028));
      ctx.fillStyle = "#07183f";
      ctx.fillRect(0, canvas.height, output.width, captionHeight);
      ctx.fillStyle = "#ffffff";
      ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
      ctx.textBaseline = "top";
      const padding = Math.round(fontSize * 0.6);
      const lines = wrapText(ctx, trimmedNote, output.width - padding * 2).slice(0, 2);
      lines.forEach((line, lineIndex) => {
        ctx.fillText(line, padding, canvas.height + padding + lineIndex * (fontSize + 4));
      });
    }

    const dataUrl = output.toDataURL("image/jpeg", 0.8);
    const baseName = current.name.replace(/\.[^.]+$/, "");
    return {
      name: trimmedNote ? `${baseName} (noted).jpg` : `${baseName}.jpg`,
      dataUrl,
      note: trimmedNote,
    };
  }

  function handleSaveCurrent() {
    const result = buildResult();
    if (!result || !images) return;
    const nextResults = [...results, result];
    if (index + 1 < images.length) {
      setResults(nextResults);
      setStrokes([]);
      setNote("");
      setReady(false);
      setIndex(index + 1);
    } else {
      onComplete(nextResults);
    }
  }

  if (!current || !images) return null;

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-slate-950/90 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-white">
        <div>
          <p className="text-sm font-black">Mark up photo</p>
          {images.length > 1 && <p className="text-xs font-semibold text-slate-300">Photo {index + 1} of {images.length}</p>}
        </div>
        <button type="button" onClick={onCancel} className="rounded-xl p-2 text-slate-300 hover:bg-white/10 hover:text-white"><X className="h-5 w-5" /></button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="max-h-full max-w-full touch-none rounded-xl bg-white shadow-2xl"
          style={{ cursor: "crosshair" }}
        />
      </div>

      <div className="space-y-3 border-t border-white/10 bg-slate-900 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            {penColors.map((penColor) => (
              <button
                key={penColor}
                type="button"
                onClick={() => setColor(penColor)}
                aria-label={`Pen color ${penColor}`}
                className={`h-7 w-7 rounded-full border-2 transition ${color === penColor ? "border-white scale-110" : "border-white/30"}`}
                style={{ backgroundColor: penColor }}
              />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {penSizes.map((penSize) => (
              <button
                key={penSize.value}
                type="button"
                onClick={() => setSize(penSize.value)}
                className={`h-8 w-8 rounded-lg text-xs font-black transition ${size === penSize.value ? "bg-white text-slate-900" : "bg-white/10 text-white hover:bg-white/20"}`}
              >
                {penSize.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={handleUndo} disabled={strokes.length === 0} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-black text-white hover:bg-white/20 disabled:opacity-40"><Undo2 className="h-4 w-4" />Undo</button>
          <button type="button" onClick={handleClear} disabled={strokes.length === 0} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-black text-white hover:bg-white/20 disabled:opacity-40"><Eraser className="h-4 w-4" />Clear</button>
        </div>

        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Add a note (saved onto the image)…"
          rows={2}
          className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white placeholder:text-slate-400 outline-none focus:border-white/40"
        />

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-xl px-4 py-2.5 text-sm font-black text-slate-300 hover:text-white">Cancel</button>
          <button type="button" onClick={handleSaveCurrent} disabled={!ready} className="rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-orange-900/30 transition hover:bg-orange-600 disabled:opacity-50">
            {index + 1 < images.length ? "Save & Next" : "Save Photo"}
          </button>
        </div>
      </div>
    </div>
  );
}
