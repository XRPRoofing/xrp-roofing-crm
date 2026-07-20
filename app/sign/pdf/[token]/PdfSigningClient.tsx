"use client";

import { useRef, useState } from "react";
import type { SigningPageData, PdfField, PdfRecipient } from "@/lib/pdf-signer-types";

interface Props {
  token: string;
  signingData: SigningPageData;
}

export default function PdfSigningClient({ token, signingData }: Props) {
  const { document, fields = [], recipient } = signingData;
  const [values, setValues] = useState<Record<string, string>>({});
  const [signatures, setSignatures] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ completed?: boolean; signedPdfUrl?: string; error?: string; message?: string } | null>(null);

  const handleTextChange = (field: PdfField, value: string) => setValues((prev) => ({ ...prev, [field.id]: value }));
  const handleCheckboxChange = (field: PdfField, checked: boolean) => setValues((prev) => ({ ...prev, [field.id]: checked ? "true" : "" }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/pdf-sign/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values, signatures, recipientName: recipient?.name }),
      });
      const data = (await res.json().catch(() => ({}))) as { completed?: boolean; signedPdfUrl?: string; error?: string; message?: string };
      if (!res.ok) setResult({ error: data.error || `Request failed (${res.status})` });
      else setResult(data);
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : "Unable to submit" });
    } finally {
      setBusy(false);
    }
  }

  if (result?.completed) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 md:p-10">
        <div className="mx-auto max-w-2xl rounded-xl bg-white p-8 shadow">
          <h1 className="mb-2 text-2xl font-bold text-slate-900">Document completed</h1>
          <p className="mb-6 text-slate-600">Thank you. {document.title} has been signed.</p>
          {result.signedPdfUrl && (
            <a href={result.signedPdfUrl} target="_blank" rel="noreferrer" className="inline-flex rounded-md bg-emerald-600 px-5 py-2.5 font-semibold text-white hover:bg-emerald-700">
              Download signed copy
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-4xl rounded-xl bg-white p-6 shadow md:p-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-900 md:text-2xl">{document.title}</h1>
          {recipient?.email && <p className="text-sm text-slate-500">Prepared for {recipient.name || recipient.email}</p>}
        </div>

        {document.originalPdfUrl ? (
          <iframe src={`${document.originalPdfUrl}#toolbar=1`} className="mb-6 w-full rounded border border-slate-200" style={{ height: 600 }} title="Document preview" />
        ) : (
          <div className="mb-6 rounded border border-slate-200 p-8 text-center text-slate-500">Preview not available</div>
        )}

        {result?.error && <div className="mb-4 rounded bg-red-50 p-3 text-red-700">{result.error}</div>}
        {result?.message && <div className="mb-4 rounded bg-amber-50 p-3 text-amber-800">{result.message}</div>}

        <form onSubmit={handleSubmit} className="space-y-6">
          {fields.length === 0 && <p className="text-slate-500">No fields to complete.</p>}
          {fields.map((field) => (
            <div key={field.id} className="rounded border border-slate-200 p-4">
              <label className="mb-2 block font-semibold text-slate-800">
                {field.label || field.type}
                {field.required && <span className="ml-1 text-red-500">*</span>}
              </label>
              {renderFieldControl(field, values[field.id] || "", signatures[field.id] || "", handleTextChange, handleCheckboxChange, (sig) => setSignatures((prev) => ({ ...prev, [field.id]: sig })))}
            </div>
          ))}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {busy ? "Submitting..." : "Sign and submit"}
          </button>
        </form>
      </div>
    </div>
  );
}

function renderFieldControl(
  field: PdfField,
  value: string,
  signature: string,
  onText: (f: PdfField, v: string) => void,
  onCheckbox: (f: PdfField, v: boolean) => void,
  onSignature: (v: string) => void,
) {
  if (field.type === "signature" || field.type === "initials") {
    return <SignaturePad value={signature} onChange={onSignature} />;
  }
  if (field.type === "checkbox") {
    return (
      <input
        type="checkbox"
        checked={value === "true"}
        onChange={(e) => onCheckbox(field, e.target.checked)}
        className="h-5 w-5 rounded border-slate-300 text-blue-600"
      />
    );
  }
  if (field.type === "radio" && field.options?.length) {
    return (
      <div className="space-y-2">
        {field.options.map((opt) => (
          <label key={opt} className="flex items-center gap-2">
            <input
              type="radio"
              name={field.id}
              value={opt}
              checked={value === opt}
              onChange={(e) => onText(field, e.target.value)}
              className="text-blue-600"
            />
            {opt}
          </label>
        ))}
      </div>
    );
  }
  if (field.type === "dropdown" && field.options?.length) {
    return (
      <select
        value={value}
        onChange={(e) => onText(field, e.target.value)}
        className="w-full rounded border border-slate-300 p-2"
      >
        <option value="">Select...</option>
        {field.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "date") {
    return <input type="date" value={value} onChange={(e) => onText(field, e.target.value)} className="w-full rounded border border-slate-300 p-2" />;
  }
  return (
    <input
      type="text"
      value={value}
      placeholder={field.placeholder}
      onChange={(e) => onText(field, e.target.value)}
      className="w-full rounded border border-slate-300 p-2"
    />
  );
}

function SignaturePad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);

  function getPoint(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function start(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    setDrawing(true);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const point = getPoint(e as any);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  }

  function move(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const point = getPoint(e as any);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }

  function end() {
    setDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL("image/png"));
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={400}
        height={120}
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
        className="w-full max-w-md cursor-crosshair touch-none rounded border border-slate-300 bg-white"
        style={{ height: 120, maxWidth: 400 }}
      />
      <button type="button" onClick={clear} className="text-sm font-medium text-red-600 hover:underline">
        Clear signature
      </button>
      {value && <p className="text-xs text-emerald-600">Signature captured</p>}
    </div>
  );
}
