"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, PageViewport, RenderTask } from "pdfjs-dist";
import type { SigningPageData, PdfField, FieldType } from "@/lib/pdf-signer-types";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
}

interface PageView {
  page: PDFPageProxy;
  baseViewport: PageViewport;
  viewport: PageViewport;
  cssScale: number;
  cssWidth: number;
  cssHeight: number;
}

interface Props {
  token: string;
  signingData: SigningPageData;
}

const FIELD_DEFAULTS: Record<FieldType, { width: number; height: number; label: string }> = {
  signature: { width: 200, height: 60, label: "Signature" },
  initials: { width: 100, height: 50, label: "Initials" },
  text: { width: 150, height: 40, label: "Text" },
  date: { width: 150, height: 40, label: "Date" },
  full_name: { width: 150, height: 40, label: "Full name" },
  phone: { width: 150, height: 40, label: "Phone" },
  email: { width: 150, height: 40, label: "Email" },
  address: { width: 200, height: 40, label: "Address" },
  checkbox: { width: 20, height: 20, label: "Checkbox" },
  radio: { width: 150, height: 40, label: "Radio" },
  dropdown: { width: 150, height: 40, label: "Dropdown" },
  label: { width: 200, height: 30, label: "Label" },
};

export default function PdfSigningClient({ token, signingData }: Props) {
  const { document: pdfDocument, fields = [], recipient } = signingData;

  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of fields) {
      if (field.type !== "signature" && field.type !== "initials" && field.value) {
        initial[field.id] = String(field.value);
      }
    }
    return initial;
  });

  const [signatures, setSignatures] = useState<Record<string, string>>({});
  const [signatureModalField, setSignatureModalField] = useState<PdfField | null>(null);

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageViews, setPageViews] = useState<PageView[]>([]);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const fieldRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [showFallbackForm, setShowFallbackForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ completed?: boolean; signedPdfUrl?: string; error?: string; message?: string } | null>(null);

  // Measure container width, including mobile orientation changes.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(el);
    } else {
      window.addEventListener("resize", update);
    }
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", update);
    };
  }, []);

  // Load the PDF from the signed URL.
  useEffect(() => {
    if (!pdfDocument.originalPdfUrl) {
      setPdfLoading(false);
      setPdfError("No PDF preview URL available");
      return;
    }
    let cancelled = false;
    setPdfLoading(true);
    setPdfError(null);
    fetch(pdfDocument.originalPdfUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
        const buf = await res.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: buf }).promise;
        if (!cancelled) setPdfDoc(pdf);
      })
      .catch((err) => {
        if (!cancelled) setPdfError(err instanceof Error ? err.message : "Unable to load PDF");
      })
      .finally(() => {
        if (!cancelled) setPdfLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pdfDocument.originalPdfUrl]);

  // Build per-page view data based on container width and device pixel ratio.
  useEffect(() => {
    if (!pdfDoc || containerWidth <= 0) return;
    let cancelled = false;
    (async () => {
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const views: PageView[] = [];
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const baseViewport = page.getViewport({ scale: 1 });
        const cssScale = containerWidth / baseViewport.width;
        const viewport = page.getViewport({ scale: cssScale * dpr });
        views.push({
          page,
          baseViewport,
          viewport,
          cssScale,
          cssWidth: baseViewport.width * cssScale,
          cssHeight: baseViewport.height * cssScale,
        });
      }
      if (!cancelled) setPageViews(views);
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, containerWidth]);

  // Render every page into its canvas.
  useEffect(() => {
    if (!pageViews.length) return;
    const tasks: RenderTask[] = [];
    pageViews.forEach((view, i) => {
      const canvas = canvasRefs.current[i];
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = view.viewport.width;
      canvas.height = view.viewport.height;
      canvas.style.width = `${view.cssWidth}px`;
      canvas.style.height = `${view.cssHeight}px`;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const task = view.page.render({ canvasContext: ctx, viewport: view.viewport });
      tasks.push(task);
    });
    return () => {
      tasks.forEach((t) => t.cancel());
    };
  }, [pageViews]);

  const handleValueChange = useCallback((field: PdfField, value: string) => {
    setValues((prev) => ({ ...prev, [field.id]: value }));
    setActiveFieldId(field.id);
  }, []);

  const handleSignatureSave = useCallback((field: PdfField, dataUrl: string) => {
    setSignatures((prev) => ({ ...prev, [field.id]: dataUrl }));
    setSignatureModalField(null);
    setActiveFieldId(field.id);
  }, []);

  const isFieldFilled = useCallback((field: PdfField): boolean => {
    if (field.type === "signature" || field.type === "initials") {
      return !!(signatures[field.id]?.trim() || field.value?.trim());
    }
    if (field.type === "checkbox") {
      const v = values[field.id] ?? field.value;
      return v === "true";
    }
    const v = values[field.id] ?? field.value;
    return typeof v === "string" && v.length > 0;
  }, [values, signatures]);

  const requiredFields = useMemo(() => fields.filter((f) => f.required), [fields]);
  const completedRequiredCount = useMemo(
    () => requiredFields.filter(isFieldFilled).length,
    [requiredFields, isFieldFilled],
  );

  const requiredFieldsRemaining = useMemo(() => {
    return fields
      .filter((f) => f.required && !isFieldFilled(f))
      .sort((a, b) => {
        if (a.page !== b.page) return a.page - b.page;
        const viewA = pageViews[a.page];
        const viewB = pageViews[b.page];
        const hA = a.height || FIELD_DEFAULTS[a.type].height;
        const hB = b.height || FIELD_DEFAULTS[b.type].height;
        const topA = (viewA?.baseViewport.height || 0) - a.y - hA;
        const topB = (viewB?.baseViewport.height || 0) - b.y - hB;
        if (topA !== topB) return topA - topB;
        return (a.x || 0) - (b.x || 0);
      });
  }, [fields, isFieldFilled, pageViews]);

  function focusField(field: PdfField) {
    const el = fieldRefs.current.get(field.id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusable = el.querySelector<HTMLElement>("input, select, textarea, button");
    if (focusable) focusable.focus();
    else el.focus();
    setActiveFieldId(field.id);
  }

  function handleNextRequired() {
    if (requiredFieldsRemaining.length === 0) return;
    const active = document.activeElement;
    let currentId = activeFieldId;
    if (active) {
      const fromAttr = active.getAttribute("data-field-id") || (active.closest("[data-field-id]") as HTMLElement | null)?.dataset.fieldId;
      if (fromAttr) currentId = fromAttr;
    }
    let idx = currentId ? requiredFieldsRemaining.findIndex((f) => f.id === currentId) : -1;
    if (idx === -1) idx = 0;
    else idx = (idx + 1) % requiredFieldsRemaining.length;
    const field = requiredFieldsRemaining[idx];
    if (field) focusField(field);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const missing = fields.filter((f) => f.required && !isFieldFilled(f));
    if (missing.length > 0) {
      const first = [...missing].sort((a, b) => {
        if (a.page !== b.page) return a.page - b.page;
        const viewA = pageViews[a.page];
        const viewB = pageViews[b.page];
        const hA = a.height || FIELD_DEFAULTS[a.type].height;
        const hB = b.height || FIELD_DEFAULTS[b.type].height;
        const topA = (viewA?.baseViewport.height || 0) - a.y - hA;
        const topB = (viewB?.baseViewport.height || 0) - b.y - hB;
        if (topA !== topB) return topA - topB;
        return (a.x || 0) - (b.x || 0);
      })[0];
      setResult({ error: `Please complete ${missing.length} required field(s).` });
      if (first) focusField(first);
      return;
    }
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
          <p className="mb-6 text-slate-600">Thank you. {pdfDocument.title} has been signed.</p>
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
    <div className="min-h-screen bg-slate-50">
      <div className="sticky top-0 z-30 border-b border-slate-200 bg-white px-4 py-3 shadow-sm md:px-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-slate-900 md:text-xl">{pdfDocument.title}</h1>
            {recipient?.email && <p className="text-xs text-slate-500">Prepared for {recipient.name || recipient.email}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleNextRequired}
              disabled={requiredFieldsRemaining.length === 0}
              className="rounded-md bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              {requiredFieldsRemaining.length === 0 ? "All required fields completed" : `Next required field (${requiredFieldsRemaining.length})`}
            </button>
            <button
              type="button"
              onClick={() => setShowFallbackForm((v) => !v)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {showFallbackForm ? "Hide accessible form" : "Show accessible form"}
            </button>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mx-auto max-w-5xl px-4 pb-12 pt-4 md:px-8">
        {result?.error && <div className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{result.error}</div>}
        {result?.message && <div className="mb-4 rounded bg-amber-50 p-3 text-sm text-amber-800">{result.message}</div>}

        <div ref={containerRef} className="space-y-8">
          {pdfLoading && <div className="py-12 text-center text-sm text-slate-500">Loading PDF...</div>}
          {pdfError && <div className="py-12 text-center text-sm text-red-600">{pdfError}</div>}
          {!pdfLoading && !pdfError && pageViews.length === 0 && <div className="py-12 text-center text-sm text-slate-500">No pages to display.</div>}

          {pageViews.map((view, i) => (
            <div
              key={i}
              className="relative mx-auto inline-block rounded border border-slate-200 bg-white shadow-sm"
              style={{ width: view.cssWidth, height: view.cssHeight }}
            >
              <canvas
                ref={(el) => {
                  canvasRefs.current[i] = el;
                }}
                className="block"
              />
              <div className="absolute inset-0" style={{ width: view.cssWidth, height: view.cssHeight }}>
                {fields
                  .filter((f) => f.page === i)
                  .map((f) => {
                    const fieldView = pageViews[f.page];
                    if (!fieldView) return null;
                    const isFilled = isFieldFilled(f);
                    const setRef = (el: HTMLDivElement | null) => {
                      if (el) fieldRefs.current.set(f.id, el);
                      else fieldRefs.current.delete(f.id);
                    };
                    return (
                      <OverlayField
                        key={f.id}
                        field={f}
                        view={fieldView}
                        isFilled={isFilled}
                        setRef={setRef}
                      >
                        <FieldInput
                          field={f}
                          value={values[f.id] || ""}
                          signature={signatures[f.id] || ""}
                          onChange={(val) => handleValueChange(f, val)}
                          onOpenSignature={() => setSignatureModalField(f)}
                          onFocus={() => setActiveFieldId(f.id)}
                          variant="overlay"
                        />
                      </OverlayField>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>

        {showFallbackForm && (
          <FallbackForm
            fields={fields}
            values={values}
            signatures={signatures}
            onChange={handleValueChange}
            onOpenSignature={(f) => setSignatureModalField(f)}
            onFocusField={(f) => setActiveFieldId(f.id)}
          />
        )}

        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-500">
            {completedRequiredCount} of {requiredFields.length} required fields completed
          </p>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {busy ? "Submitting..." : "Sign and submit"}
          </button>
        </div>
      </form>

      {signatureModalField && (
        <SignatureModal
          field={signatureModalField}
          current={signatures[signatureModalField.id]}
          onSave={(dataUrl) => handleSignatureSave(signatureModalField, dataUrl)}
          onClose={() => setSignatureModalField(null)}
        />
      )}
    </div>
  );
}

function OverlayField({
  field,
  view,
  isFilled,
  setRef,
  children,
}: {
  field: PdfField;
  view: PageView;
  isFilled: boolean;
  setRef: (el: HTMLDivElement | null) => void;
  children: React.ReactNode;
}) {
  const defaults = FIELD_DEFAULTS[field.type];
  const w = (field.width || defaults.width) * view.cssScale;
  const h = (field.height || defaults.height) * view.cssScale;
  const left = Math.max(0, (field.x || 0) * view.cssScale);
  const top = Math.max(0, (view.baseViewport.height - (field.y || 0) - (field.height || defaults.height)) * view.cssScale);
  const requiredEmpty = field.required && !isFilled;

  return (
    <div
      ref={setRef}
      data-field-id={field.id}
      className={`absolute flex flex-col justify-center overflow-hidden rounded border text-xs leading-tight transition focus-within:ring-2 focus-within:ring-blue-500 ${
        requiredEmpty
          ? "border-red-500 bg-red-50 ring-1 ring-red-400"
          : field.required
            ? "border-emerald-500 bg-white"
            : "border-blue-400 bg-white/90 hover:bg-white"
      }`}
      style={{ left, top, width: w, height: h }}
    >
      {field.label && field.type !== "label" && h > 24 && (
        <div className="pointer-events-none shrink-0 truncate bg-white/90 px-0.5 text-[9px] font-semibold text-gray-600">
          {field.label}
          {field.required && <span className="ml-0.5 text-red-500">*</span>}
        </div>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function FieldInput({
  field,
  value,
  signature,
  onChange,
  onOpenSignature,
  onFocus,
  variant = "overlay",
}: {
  field: PdfField;
  value: string;
  signature: string;
  onChange: (val: string) => void;
  onOpenSignature: () => void;
  onFocus?: () => void;
  variant?: "overlay" | "fallback";
}) {
  const defaults = FIELD_DEFAULTS[field.type];
  const label = field.label || defaults.label;
  const inputBase =
    variant === "overlay"
      ? "h-full w-full bg-transparent px-0.5 text-[10px] leading-tight text-gray-900 outline-none placeholder:text-gray-400"
      : "w-full rounded border border-slate-300 p-2 text-sm text-gray-900";

  if (field.type === "signature" || field.type === "initials") {
    const hasServerValue = !!field.value && !signature;
    if (signature) {
      return (
        <button
          type="button"
          onClick={onOpenSignature}
          onFocus={onFocus}
          className={variant === "overlay" ? "h-full w-full" : "w-full"}
        >
          <img src={signature} alt={label} className={variant === "overlay" ? "h-full w-full object-contain" : "max-h-32 rounded border"} />
        </button>
      );
    }
    const btnClass =
      variant === "overlay"
        ? "flex h-full w-full items-center justify-center rounded border border-dashed border-blue-400 bg-blue-50 px-1 text-[10px] font-medium text-blue-700 hover:bg-blue-100"
        : "w-full rounded border border-dashed border-blue-400 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100";
    return (
      <button type="button" onClick={onOpenSignature} onFocus={onFocus} className={btnClass}>
        {hasServerValue
          ? `${label} captured — click to re-sign`
          : `Click to ${field.type === "initials" ? "initial" : "sign"} ${label.toLowerCase()}`}
      </button>
    );
  }

  if (field.type === "label") {
    return (
      <span className={variant === "overlay" ? "flex h-full w-full items-center px-0.5 text-[10px] font-semibold text-gray-800" : "block text-sm font-semibold text-gray-800"}>
        {label}
      </span>
    );
  }

  if (field.type === "checkbox") {
    const isChecked = value === "true";
    if (variant === "overlay") {
      return (
        <div className="flex h-full w-full items-center justify-center">
          <input
            type="checkbox"
            checked={isChecked}
            onChange={(e) => onChange(e.target.checked ? "true" : "")}
            onFocus={onFocus}
            aria-label={label}
            className="h-4 w-4 rounded border-slate-300 text-blue-600"
          />
        </div>
      );
    }
    return (
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={isChecked}
          onChange={(e) => onChange(e.target.checked ? "true" : "")}
          onFocus={onFocus}
          aria-label={label}
          className="h-4 w-4 rounded border-slate-300 text-blue-600"
        />
        <span className="text-sm text-gray-700">
          {label}
          {field.required && <span className="text-red-500">*</span>}
        </span>
      </label>
    );
  }

  if (field.type === "radio" && field.options?.length) {
    if (variant === "overlay") {
      return (
        <div className="flex h-full w-full flex-col justify-center gap-0.5 overflow-y-auto p-0.5">
          {field.options.map((opt) => (
            <label key={opt} className="flex items-center gap-0.5 text-[10px] leading-tight">
              <input
                type="radio"
                name={field.id}
                value={opt}
                checked={value === opt}
                onChange={() => onChange(opt)}
                onFocus={onFocus}
                aria-label={`${label}: ${opt}`}
                className="text-blue-600"
              />
              <span className="truncate">{opt}</span>
            </label>
          ))}
        </div>
      );
    }
    return (
      <div className="space-y-1">
        {field.options.map((opt) => (
          <label key={opt} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={field.id}
              value={opt}
              checked={value === opt}
              onChange={() => onChange(opt)}
              onFocus={onFocus}
              aria-label={`${label}: ${opt}`}
              className="text-blue-600"
            />
            {opt}
          </label>
        ))}
      </div>
    );
  }

  if (field.type === "dropdown" && field.options?.length) {
    const options = [
      <option key="" value="">
        {field.placeholder || "Select..."}
      </option>,
      ...field.options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      )),
    ];
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} onFocus={onFocus} aria-label={label} className={inputBase}>
        {options}
      </select>
    );
  }

  if (field.type === "date") {
    return (
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        placeholder={field.placeholder || label}
        aria-label={label}
        className={inputBase}
      />
    );
  }

  const inputType = field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text";
  return (
    <input
      type={inputType}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={onFocus}
      placeholder={field.placeholder || label}
      aria-label={label}
      className={inputBase}
    />
  );
}

function FallbackForm({
  fields,
  values,
  signatures,
  onChange,
  onOpenSignature,
  onFocusField,
}: {
  fields: PdfField[];
  values: Record<string, string>;
  signatures: Record<string, string>;
  onChange: (field: PdfField, val: string) => void;
  onOpenSignature: (field: PdfField) => void;
  onFocusField?: (field: PdfField) => void;
}) {
  return (
    <div className="mt-8 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-slate-900">Accessible form view</h2>
      <div className="space-y-4">
        {fields.map((f) => (
          <div key={f.id} className="rounded border border-slate-200 p-3">
            {f.type !== "label" && (
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {f.label || FIELD_DEFAULTS[f.type].label}
                {f.required && <span className="ml-1 text-red-500">*</span>}
              </label>
            )}
            <FieldInput
              field={f}
              value={values[f.id] || ""}
              signature={signatures[f.id] || ""}
              onChange={(val) => onChange(f, val)}
              onOpenSignature={() => onOpenSignature(f)}
              onFocus={onFocusField ? () => onFocusField(f) : undefined}
              variant="fallback"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function SignatureModal({
  field,
  current,
  onSave,
  onClose,
}: {
  field: PdfField;
  current?: string;
  onSave: (dataUrl: string) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const drawing = useRef(false);
  const blankSignature = useRef<string | null>(null);

  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#1e40af";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    blankSignature.current = c.toDataURL("image/png");
    if (current) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
      img.src = current;
    }
  }, [current]);

  function getPoint(e: React.MouseEvent | React.TouchEvent) {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function start(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      const p = getPoint(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }
  }

  function move(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      const p = getPoint(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }

  function end() {
    drawing.current = false;
  }

  function clear() {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    setError(null);
  }

  function accept() {
    const c = canvasRef.current;
    if (!c) return;
    const currentData = c.toDataURL("image/png");
    if (currentData === blankSignature.current) {
      setError("Please draw a signature before accepting.");
      return;
    }
    setError(null);
    onSave(currentData);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">{field.label || (field.type === "initials" ? "Initials" : "Signature")}</h3>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:text-gray-600">
            <span aria-hidden>&times;</span>
            <span className="sr-only">Close</span>
          </button>
        </div>
        <canvas
          ref={canvasRef}
          width={400}
          height={150}
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={end}
          className="w-full cursor-crosshair touch-none rounded border border-slate-300 bg-white"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={clear} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Clear
          </button>
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" onClick={accept} className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
