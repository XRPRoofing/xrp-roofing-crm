"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Circle, Copy, Crop, Minus, RotateCcw, Square, SlidersHorizontal, Trash2, Type, Undo2, X } from "lucide-react";

export type AnnotatorImage = { name: string; dataUrl: string };
export type AnnotatedResult = { name: string; dataUrl: string; note: string };

type Pt = { x: number; y: number };
type Stroke = { id: string; color: string; width: number; points: Pt[] };
type ShapeBase = { id: string; color: string; width: number };
type ArrowShape = ShapeBase & { kind: "arrow"; x1: number; y1: number; x2: number; y2: number; label: string };
type BoxShape   = ShapeBase & { kind: "box";   x: number; y: number; w: number; h: number };
type CircleShape= ShapeBase & { kind: "circle";cx: number; cy: number; rx: number; ry: number };
type TextShape  = ShapeBase & { kind: "text";  x: number; y: number; text: string; fontSize: number };
type Shape = ArrowShape | BoxShape | CircleShape | TextShape;
type Tool = "pen" | "arrow" | "box" | "circle" | "text";

const PALETTE = ["#eab308", "#ef4444", "#22c55e", "#3b82f6", "#ffffff", "#0f172a"];
const uid = () => Math.random().toString(36).slice(2);

function hitArrow(s: ArrowShape, p: Pt, tol: number) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const t = Math.max(0, Math.min(1, ((p.x - s.x1) * dx + (p.y - s.y1) * dy) / (len * len)));
  const nx = s.x1 + t * dx - p.x, ny = s.y1 + t * dy - p.y;
  return Math.sqrt(nx * nx + ny * ny) < tol;
}
function hitBox(s: BoxShape, p: Pt) {
  return p.x >= Math.min(s.x, s.x + s.w) && p.x <= Math.max(s.x, s.x + s.w) &&
         p.y >= Math.min(s.y, s.y + s.h) && p.y <= Math.max(s.y, s.y + s.h);
}
function hitCircle(s: CircleShape, p: Pt) {
  const dx = p.x - s.cx, dy = p.y - s.cy;
  return Math.abs(Math.sqrt(dx * dx + dy * dy) - Math.max(Math.abs(s.rx), Math.abs(s.ry))) < 24;
}
function hitText(s: TextShape, p: Pt) {
  return p.x >= s.x - 10 && p.x <= s.x + 200 && p.y >= s.y - s.fontSize - 4 && p.y <= s.y + 8;
}

function drawAllShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], selectedId: string | null) {
  shapes.forEach((s) => {
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (s.kind === "arrow") {
      const { x1, y1, x2, y2 } = s;
      const headLen = Math.max(18, s.width * 5);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      // filled arrowhead
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 7), y2 - headLen * Math.sin(angle - Math.PI / 7));
      ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 7), y2 - headLen * Math.sin(angle + Math.PI / 7));
      ctx.closePath();
      ctx.fill();
      // dot at tail
      ctx.beginPath();
      ctx.arc(x1, y1, s.width * 1.5, 0, Math.PI * 2);
      ctx.fill();
      // label near tail
      if (s.label) {
        const fs = Math.max(20, s.width * 6);
        ctx.font = `bold ${fs}px system-ui, sans-serif`;
        ctx.fillStyle = s.color;
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineWidth = fs * 0.3;
        ctx.strokeText(s.label, x1 + 12, y1 + fs / 2);
        ctx.fillText(s.label, x1 + 12, y1 + fs / 2);
      }
      // selection ring
      if (s.id === selectedId) {
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(x1, y1, s.width * 3 + 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (s.kind === "box") {
      ctx.strokeRect(s.x, s.y, s.w, s.h);
      if (s.id === selectedId) {
        ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.strokeRect(s.x - 4, s.y - 4, s.w + 8, s.h + 8);
        ctx.setLineDash([]);
      }
    } else if (s.kind === "circle") {
      ctx.beginPath();
      ctx.ellipse(s.cx, s.cy, Math.abs(s.rx), Math.abs(s.ry), 0, 0, Math.PI * 2);
      ctx.stroke();
      if (s.id === selectedId) {
        ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.ellipse(s.cx, s.cy, Math.abs(s.rx) + 6, Math.abs(s.ry) + 6, 0, 0, Math.PI * 2);
        ctx.stroke(); ctx.setLineDash([]);
      }
    } else if (s.kind === "text") {
      ctx.font = `bold ${s.fontSize}px system-ui, sans-serif`;
      ctx.fillStyle = s.color;
      ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = s.fontSize * 0.25;
      ctx.strokeText(s.text, s.x, s.y);
      ctx.fillText(s.text, s.x, s.y);
      if (s.id === selectedId) {
        const w = ctx.measureText(s.text).width;
        ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
        ctx.strokeRect(s.x - 4, s.y - s.fontSize - 2, w + 8, s.fontSize + 8);
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  });
}

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
  const shapeStartRef = useRef<Pt | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<AnnotatedResult[]>([]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [note, setNote] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [size, setSize] = useState(8);
  const [tool, setTool] = useState<Tool>("pen");
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [textPopup, setTextPopup] = useState<{ shapeId: string; value: string } | null>(null);

  const current = images && images.length > 0 ? images[index] : null;

  // --- canvas helpers ---
  const redraw = useCallback((sl: Stroke[], sh: Shape[], selId: string | null, preview?: Shape) => {
    const canvas = canvasRef.current;
    const img = baseImageRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    sl.forEach((stroke) => {
      if (!stroke.points.length) return;
      ctx.strokeStyle = stroke.color; ctx.lineWidth = stroke.width;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      stroke.points.forEach((pt) => ctx.lineTo(pt.x, pt.y));
      ctx.stroke();
    });
    drawAllShapes(ctx, sh, selId);
    if (preview) drawAllShapes(ctx, [preview], null);
  }, []);

  useEffect(() => {
    if (!current) return;
    const img = new window.Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth || 1280;
      canvas.height = img.naturalHeight || 960;
      baseImageRef.current = img;
      redraw([], [], null);
      setReady(true);
    };
    img.src = current.dataUrl;
  }, [current, redraw]);

  function ptrPos(e: React.PointerEvent<HTMLCanvasElement>): Pt {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top) * (canvas.height / r.height),
    };
  }

  function trySelectAt(pt: Pt): string | null {
    // iterate in reverse (top-most first)
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      if (s.kind === "arrow" && hitArrow(s, pt, 20)) return s.id;
      if (s.kind === "box" && hitBox(s, pt)) return s.id;
      if (s.kind === "circle" && hitCircle(s, pt)) return s.id;
      if (s.kind === "text" && hitText(s, pt)) return s.id;
    }
    return null;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!ready) return;
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const pt = ptrPos(e);

    if (tool === "pen") {
      setSelectedId(null);
      setStrokes((prev) => [...prev, { id: uid(), color, width: size, points: [pt] }]);
    } else {
      // tap existing shape to select (only in non-pen mode)
      const hit = trySelectAt(pt);
      if (hit) { setSelectedId(hit); drawingRef.current = false; return; }
      setSelectedId(null);
      shapeStartRef.current = pt;
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const pt = ptrPos(e);
    if (tool === "pen") {
      setStrokes((prev) => {
        if (!prev.length) return prev;
        const next = [...prev];
        const last = next[next.length - 1];
        next[next.length - 1] = { ...last, points: [...last.points, pt] };
        redraw(next, shapes, selectedId);
        return next;
      });
    } else if (shapeStartRef.current) {
      const s = shapeStartRef.current;
      let preview: Shape | undefined;
      if (tool === "arrow")  preview = { id: "_pre", kind: "arrow",  color, width: size, x1: s.x, y1: s.y, x2: pt.x, y2: pt.y, label: "" };
      if (tool === "box")    preview = { id: "_pre", kind: "box",    color, width: size, x: s.x, y: s.y, w: pt.x - s.x, h: pt.y - s.y };
      if (tool === "circle") preview = { id: "_pre", kind: "circle", color, width: size, cx: (s.x + pt.x) / 2, cy: (s.y + pt.y) / 2, rx: (pt.x - s.x) / 2, ry: (pt.y - s.y) / 2 };
      redraw(strokes, shapes, selectedId, preview);
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    try { canvasRef.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!shapeStartRef.current) return;
    const s = shapeStartRef.current;
    const pt = ptrPos(e);
    shapeStartRef.current = null;
    const dist = Math.hypot(pt.x - s.x, pt.y - s.y);
    if (dist < 6) return; // too small, treat as tap

    let newShape: Shape | null = null;
    const id = uid();
    if (tool === "arrow")  newShape = { id, kind: "arrow",  color, width: size, x1: s.x, y1: s.y, x2: pt.x, y2: pt.y, label: "" };
    if (tool === "box")    newShape = { id, kind: "box",    color, width: size, x: s.x, y: s.y, w: pt.x - s.x, h: pt.y - s.y };
    if (tool === "circle") newShape = { id, kind: "circle", color, width: size, cx: (s.x + pt.x) / 2, cy: (s.y + pt.y) / 2, rx: (pt.x - s.x) / 2, ry: (pt.y - s.y) / 2 };
    if (tool === "text") {
      newShape = { id, kind: "text", color, width: size, x: s.x, y: s.y, text: "Text", fontSize: Math.max(24, size * 4) };
    }
    if (!newShape) return;

    const nextShapes = [...shapes, newShape];
    setShapes(nextShapes);
    setSelectedId(id);
    redraw(strokes, nextShapes, id);

    // auto-open text popup for arrow and text shapes
    if (tool === "arrow" || tool === "text") {
      const label = tool === "arrow" ? (newShape as ArrowShape).label : (newShape as TextShape).text;
      setTextPopup({ shapeId: id, value: label });
    }
  }

  // floating action bar position (screen-space) for selected shape
  function getActionBarPos(): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !selectedId) return null;
    const shape = shapes.find((s) => s.id === selectedId);
    if (!shape) return null;
    const cr = canvas.getBoundingClientRect();
    const conr = container.getBoundingClientRect();
    const scaleX = cr.width / canvas.width;
    const scaleY = cr.height / canvas.height;
    let cx = 0, cy = 0;
    if (shape.kind === "arrow")  { cx = shape.x1; cy = shape.y1; }
    if (shape.kind === "box")    { cx = shape.x + shape.w / 2; cy = shape.y + shape.h; }
    if (shape.kind === "circle") { cx = shape.cx; cy = shape.cy + Math.abs(shape.ry); }
    if (shape.kind === "text")   { cx = shape.x; cy = shape.y + 12; }
    return {
      x: cr.left - conr.left + cx * scaleX,
      y: cr.top  - conr.top  + cy * scaleY + 12,
    };
  }

  function handleUndo() {
    if (shapes.length > 0) {
      setShapes((prev) => { const n = prev.slice(0, -1); redraw(strokes, n, null); return n; });
      setSelectedId(null);
    } else {
      setStrokes((prev) => { const n = prev.slice(0, -1); redraw(n, shapes, null); return n; });
    }
  }

  function handleClear() {
    setStrokes([]); setShapes([]); setSelectedId(null); redraw([], [], null);
  }

  function deleteSelected() {
    setShapes((prev) => { const n = prev.filter((s) => s.id !== selectedId); redraw(strokes, n, null); return n; });
    setSelectedId(null);
  }

  function duplicateSelected() {
    const shape = shapes.find((s) => s.id === selectedId);
    if (!shape) return;
    const id = uid();
    let dup: Shape;
    if (shape.kind === "arrow")  dup = { ...shape, id, x1: shape.x1 + 20, y1: shape.y1 + 20, x2: shape.x2 + 20, y2: shape.y2 + 20 };
    else if (shape.kind === "box")    dup = { ...shape, id, x: shape.x + 20, y: shape.y + 20 };
    else if (shape.kind === "circle") dup = { ...shape, id, cx: shape.cx + 20, cy: shape.cy + 20 };
    else dup = { ...shape, id, x: shape.x + 20, y: shape.y + 20 };
    const next = [...shapes, dup];
    setShapes(next); setSelectedId(id); redraw(strokes, next, id);
  }

  function commitTextPopup(value: string) {
    if (!textPopup) return;
    const { shapeId } = textPopup;
    setShapes((prev) => {
      const next = prev.map((s) => {
        if (s.id !== shapeId) return s;
        if (s.kind === "arrow") return { ...s, label: value };
        if (s.kind === "text")  return { ...s, text: value || "Text" };
        return s;
      });
      redraw(strokes, next, shapeId);
      return next;
    });
    setTextPopup(null);
  }

  function buildResult(): AnnotatedResult | null {
    const canvas = canvasRef.current;
    if (!canvas || !current) return null;
    const trimmed = note.trim();
    const out = document.createElement("canvas");
    const capH = trimmed ? Math.round(canvas.width * 0.04) + 24 : 0;
    out.width = canvas.width; out.height = canvas.height + capH;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0);
    if (trimmed) {
      const fs = Math.max(18, Math.round(canvas.width * 0.028));
      ctx.fillStyle = "#07183f";
      ctx.fillRect(0, canvas.height, out.width, capH);
      ctx.fillStyle = "#ffffff"; ctx.font = `600 ${fs}px system-ui, sans-serif`; ctx.textBaseline = "top";
      const pad = Math.round(fs * 0.6);
      trimmed.split("\n").slice(0, 2).forEach((line, li) => ctx.fillText(line, pad, canvas.height + pad + li * (fs + 4)));
    }
    return { name: current.name.replace(/\.[^.]+$/, "") + (trimmed ? " (noted)" : "") + ".jpg", dataUrl: out.toDataURL("image/jpeg", 0.85), note: trimmed };
  }

  function handleSave() {
    const result = buildResult();
    if (!result || !images) return;
    const nextResults = [...results, result];
    if (index + 1 < images.length) {
      setResults(nextResults); setStrokes([]); setShapes([]); setNote(""); setReady(false); setSelectedId(null); setIndex(index + 1);
    } else {
      onComplete(nextResults);
    }
  }

  if (!current || !images) return null;

  const actionPos = getActionBarPos();
  const selectedShape = shapes.find((s) => s.id === selectedId);
  const canShowText = selectedShape?.kind === "arrow" || selectedShape?.kind === "text";

  const toolBtns: { t: Tool; icon: React.ReactNode; label: string }[] = [
    { t: "pen",    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>, label: "Pen" },
    { t: "arrow",  icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="9 5 19 5 19 15"/></svg>, label: "Arrow" },
    { t: "circle", icon: <Circle className="h-5 w-5" />, label: "Circle" },
    { t: "box",    icon: <Square className="h-5 w-5" />, label: "Box" },
    { t: "text",   icon: <Type className="h-5 w-5" />, label: "Text" },
  ];

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-black">
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 text-white">
        <button type="button" onClick={onCancel} className="p-1 text-white hover:opacity-70"><X className="h-6 w-6" /></button>
        <div className="flex items-center gap-6 text-sm font-black">
          <button type="button" onClick={handleUndo} disabled={strokes.length === 0 && shapes.length === 0} className="flex items-center gap-1 disabled:opacity-30 hover:opacity-70">
            <Undo2 className="h-4 w-4" /> Undo
          </button>
          <button type="button" onClick={handleClear} disabled={strokes.length === 0 && shapes.length === 0} className="disabled:opacity-30 hover:opacity-70">
            Clear All
          </button>
        </div>
        {/* Color dot */}
        <div className="relative">
          <button type="button" onClick={() => setShowColorPicker((v) => !v)} className="h-8 w-8 rounded-full border-4 border-white/40 shadow-lg" style={{ backgroundColor: color }} />
          {showColorPicker && (
            <div className="absolute right-0 top-10 z-10 flex gap-2 rounded-2xl bg-slate-800 p-3 shadow-xl">
              {PALETTE.map((c) => (
                <button key={c} type="button" onClick={() => { setColor(c); setShowColorPicker(false); }} className={`h-7 w-7 rounded-full border-2 transition ${color === c ? "border-white scale-110" : "border-white/20"}`} style={{ backgroundColor: c }} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Canvas area */}
      <div ref={containerRef} className="relative min-h-0 flex-1 flex items-center justify-center overflow-hidden">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="max-h-full max-w-full touch-none"
          style={{ cursor: tool === "pen" ? "crosshair" : "default" }}
        />

        {/* Right-side vertical toolbar */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-1 rounded-2xl bg-black/60 p-1.5 backdrop-blur-sm">
          {toolBtns.map(({ t, icon, label }) => (
            <button key={t} type="button" title={label} onClick={() => { setTool(t); setSelectedId(null); }}
              className={`flex h-11 w-11 items-center justify-center rounded-xl transition ${tool === t ? "bg-white/20 text-white" : "text-slate-400 hover:bg-white/10 hover:text-white"}`}>
              {icon}
            </button>
          ))}
          <div className="my-1 h-px bg-white/10" />
          <button type="button" title="Rotate" className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-white/10 hover:text-white"><RotateCcw className="h-5 w-5" /></button>
          <button type="button" title="Crop" className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-white/10 hover:text-white"><Crop className="h-5 w-5" /></button>
          <button type="button" title="Adjust" className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-white/10 hover:text-white"><SlidersHorizontal className="h-5 w-5" /></button>
        </div>

        {/* Floating action bar for selected shape */}
        {actionPos && selectedId && (
          <div
            className="absolute flex items-center gap-px rounded-2xl bg-slate-800/95 p-1 shadow-2xl backdrop-blur-sm"
            style={{ left: actionPos.x - 60, top: actionPos.y }}
          >
            {canShowText && (
              <button type="button" title="Edit text"
                onClick={() => {
                  const s = shapes.find((sh) => sh.id === selectedId);
                  if (!s) return;
                  const val = s.kind === "arrow" ? s.label : s.kind === "text" ? s.text : "";
                  setTextPopup({ shapeId: selectedId, value: val });
                }}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-white hover:bg-white/10">
                <Type className="h-4 w-4" />
              </button>
            )}
            <button type="button" title="Duplicate" onClick={duplicateSelected} className="flex h-9 w-9 items-center justify-center rounded-xl text-white hover:bg-white/10">
              <Copy className="h-4 w-4" />
            </button>
            <button type="button" title="Delete" onClick={deleteSelected} className="flex h-9 w-9 items-center justify-center rounded-xl text-red-400 hover:bg-white/10">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Text popup */}
      {textPopup && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={() => setTextPopup(null)}>
          <div className="w-72 rounded-2xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex gap-2">
              {(["Abc", "ft. in.", "m. cm."] as const).map((mode) => (
                <button key={mode} type="button"
                  className={`rounded-xl px-3 py-1.5 text-xs font-black ${mode === "Abc" ? "bg-[#07183f] text-white" : "border border-slate-300 text-slate-600"}`}>
                  {mode}
                </button>
              ))}
            </div>
            <input
              autoFocus
              value={textPopup.value}
              onChange={(e) => setTextPopup((p) => p ? { ...p, value: e.target.value } : p)}
              onKeyDown={(e) => { if (e.key === "Enter") commitTextPopup(textPopup.value); if (e.key === "Escape") setTextPopup(null); }}
              placeholder="Text"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:border-blue-400 focus:bg-white"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setTextPopup(null)} className="rounded-xl px-4 py-2 text-sm font-black text-slate-500 hover:text-slate-700">Cancel</button>
              <button type="button" onClick={() => commitTextPopup(textPopup.value)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-700">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <div className="shrink-0 border-t border-white/10 bg-black px-4 pb-[env(safe-area-inset-bottom)] pt-3">
        {/* Stroke size */}
        <div className="mb-3 flex items-center gap-2">
          <Minus className="h-3 w-3 text-slate-500" />
          <input type="range" min={3} max={24} value={size} onChange={(e) => setSize(Number(e.target.value))}
            className="flex-1 accent-white" />
          <span className="w-6 text-center text-xs font-black text-white">{size}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-slate-400"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="14" y2="18"/></svg></span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a description…"
            className="flex-1 bg-transparent text-sm font-semibold text-white placeholder:text-slate-500 outline-none"
          />
          <button type="button" onClick={handleSave} disabled={!ready}
            className="rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white shadow-lg transition hover:bg-blue-700 disabled:opacity-40">
            {index + 1 < images.length ? "Next" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
