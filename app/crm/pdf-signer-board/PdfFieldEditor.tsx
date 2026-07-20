"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, PageViewport, RenderTask } from "pdfjs-dist";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
}
import {
  Calendar,
  CheckSquare,
  CircleDot,
  GripVertical,
  Heading,
  List,
  Mail,
  MapPin,
  MousePointer,
  Phone,
  Plus,
  Signature,
  Trash2,
  Type,
  User,
  X,
} from "lucide-react";
import {
  FIELD_TYPES,
  RECIPIENT_ROLES,
  type FieldType,
  type PdfDocument,
  type PdfRecipient,
  type PdfTemplateField,
  type RecipientRole,
} from "@/lib/pdf-signer-types";
import { newDocId } from "@/lib/pdf-signer-db";

const DEFAULT_WIDTH = 150;
const DEFAULT_HEIGHT = 40;

const FIELD_TYPE_META: Record<
  FieldType,
  { label: string; icon: React.ReactNode; width: number; height: number }
> = {
  signature: { label: "Signature", icon: <Signature className="h-4 w-4" />, width: 200, height: 60 },
  initials: { label: "Initials", icon: <Signature className="h-4 w-4" />, width: 100, height: 50 },
  text: { label: "Text", icon: <Type className="h-4 w-4" />, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
  date: { label: "Date", icon: <Calendar className="h-4 w-4" />, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
  full_name: { label: "Full name", icon: <User className="h-4 w-4" />, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
  phone: { label: "Phone", icon: <Phone className="h-4 w-4" />, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
  email: { label: "Email", icon: <Mail className="h-4 w-4" />, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
  address: { label: "Address", icon: <MapPin className="h-4 w-4" />, width: 200, height: DEFAULT_HEIGHT },
  checkbox: { label: "Checkbox", icon: <CheckSquare className="h-4 w-4" />, width: 20, height: 20 },
  radio: { label: "Radio", icon: <CircleDot className="h-4 w-4" />, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
  dropdown: { label: "Dropdown", icon: <List className="h-4 w-4" />, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
  label: { label: "Label", icon: <Heading className="h-4 w-4" />, width: 200, height: 30 },
};

const RECIPIENT_PALETTE = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
];

interface PageView {
  page: PDFPageProxy;
  baseViewport: PageViewport;
  viewport: PageViewport;
  cssScale: number;
  cssWidth: number;
  cssHeight: number;
}

type FieldItem = PdfTemplateField & { localId: string };

interface PdfFieldEditorProps {
  document: PdfDocument;
  recipients?: PdfRecipient[];
  onSave: (fields: PdfTemplateField[]) => void | Promise<void>;
  onCancel: () => void;
  onCreateRecipient?: (input: {
    name?: string;
    email?: string;
    phone?: string;
    role?: RecipientRole;
    label?: string;
  }) => Promise<PdfRecipient>;
}

export default function PdfFieldEditor({
  document,
  recipients: recipientsProp = [],
  onSave,
  onCancel,
  onCreateRecipient,
}: PdfFieldEditorProps) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageViews, setPageViews] = useState<PageView[]>([]);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const [fields, setFields] = useState<FieldItem[]>([]);
  const [selectedLocalId, setSelectedLocalId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<FieldType | null>(null);
  const [recipients, setRecipients] = useState<PdfRecipient[]>(recipientsProp);

  const [drag, setDrag] = useState<{
    localId: string;
    pageIndex: number;
    startX: number;
    startY: number;
    startMouseX: number;
    startMouseY: number;
  } | null>(null);

  const [resize, setResize] = useState<{
    localId: string;
    pageIndex: number;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    startMouseX: number;
    startMouseY: number;
  } | null>(null);

  const [saving, setSaving] = useState(false);

  const [recipientForm, setRecipientForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: "Customer" as RecipientRole,
    label: "",
  });
  const [showRecipientForm, setShowRecipientForm] = useState(false);
  const [recipientBusy, setRecipientBusy] = useState(false);

  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  // Initialise fields from the document.
  useEffect(() => {
    setRecipients(recipientsProp);
    setFields(
      (document.fields || []).map((f) => ({ ...f, localId: f.id || newDocId() })),
    );
  }, [document, recipientsProp]);

  // Measure container width.
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

  // Load PDF.
  useEffect(() => {
    if (!document.originalPdfUrl) {
      setPdfLoading(false);
      setPdfError("No PDF preview URL available");
      return;
    }
    let cancelled = false;
    setPdfLoading(true);
    setPdfError(null);
    fetch(document.originalPdfUrl)
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
  }, [document.originalPdfUrl]);

  // Build page view data when PDF or container width changes.
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

  // Render each page into its canvas.
  useEffect(() => {
    if (!pageViews.length) return;
    const tasks: RenderTask[] = [];
    pageViews.forEach((view, i) => {
      const canvas = canvasRefs.current[i];
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // Ensure canvas size matches viewport.
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

  // Global drag/resize handlers.
  useEffect(() => {
    if (!drag && !resize) return;
    const handleMove = (e: MouseEvent) => {
      if (drag) {
        const view = pageViews[drag.pageIndex];
        if (!view) return;
        const deltaX = e.clientX - drag.startMouseX;
        const deltaY = e.clientY - drag.startMouseY;
        const item = fields.find((f) => f.localId === drag.localId);
        if (!item) return;
        const w = item.width ?? FIELD_TYPE_META[item.type].width;
        const h = item.height ?? FIELD_TYPE_META[item.type].height;
        let newX = drag.startX + deltaX / view.cssScale;
        let newY = drag.startY - deltaY / view.cssScale;
        const pageW = view.baseViewport.width;
        const pageH = view.baseViewport.height;
        newX = Math.max(0, Math.min(newX, pageW - w));
        newY = Math.max(0, Math.min(newY, pageH - h));
        updateField(drag.localId, { x: newX, y: newY });
      } else if (resize) {
        const view = pageViews[resize.pageIndex];
        if (!view) return;
        const deltaX = e.clientX - resize.startMouseX;
        const deltaY = e.clientY - resize.startMouseY;
        let newW = resize.startW + deltaX / view.cssScale;
        let newH = resize.startH + deltaY / view.cssScale;
        let newY = resize.startY - deltaY / view.cssScale;
        newW = Math.max(20, newW);
        newH = Math.max(20, newH);
        newY = Math.max(0, newY);
        updateField(resize.localId, { width: newW, height: newH, y: newY });
      }
    };
    const handleUp = () => {
      setDrag(null);
      setResize(null);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [drag, resize, pageViews, fields]);

  const updateField = useCallback((localId: string, patch: Partial<FieldItem>) => {
    setFields((prev) => prev.map((f) => (f.localId === localId ? { ...f, ...patch } : f)));
  }, []);

  const addField = useCallback(
    (type: FieldType, pageIndex: number, cssX: number, cssY: number) => {
      const view = pageViews[pageIndex];
      if (!view) return;
      const meta = FIELD_TYPE_META[type];
      const pageW = view.baseViewport.width;
      const pageH = view.baseViewport.height;
      const pdfX = cssX / view.cssScale;
      const pdfY = pageH - cssY / view.cssScale;
      let x = pdfX - meta.width / 2;
      let y = pdfY - meta.height / 2;
      x = Math.max(0, Math.min(x, pageW - meta.width));
      y = Math.max(0, Math.min(y, pageH - meta.height));
      const newField: FieldItem = {
        localId: newDocId(),
        type,
        page: pageIndex,
        x,
        y,
        width: meta.width,
        height: meta.height,
        label: meta.label,
        required: type !== "label",
        options: type === "radio" || type === "dropdown" ? [] : undefined,
      };
      setFields((prev) => [...prev, newField]);
      setSelectedLocalId(newField.localId);
      setActiveTool(null);
    },
    [pageViews],
  );

  const handleOverlayMouseDown = (pageIndex: number, e: React.MouseEvent) => {
    if (activeTool && e.target === e.currentTarget) {
      const rect = e.currentTarget.getBoundingClientRect();
      addField(activeTool, pageIndex, e.clientX - rect.left, e.clientY - rect.top);
      e.preventDefault();
      e.stopPropagation();
    } else if (e.target === e.currentTarget) {
      setSelectedLocalId(null);
    }
  };

  const startDrag = (
    localId: string,
    pageIndex: number,
    e: React.MouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedLocalId(localId);
    const f = fields.find((x) => x.localId === localId);
    if (!f) return;
    setDrag({
      localId,
      pageIndex,
      startX: f.x,
      startY: f.y,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
    });
  };

  const startResize = (
    localId: string,
    pageIndex: number,
    e: React.MouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const f = fields.find((x) => x.localId === localId);
    if (!f) return;
    setResize({
      localId,
      pageIndex,
      startX: f.x,
      startY: f.y,
      startW: f.width ?? FIELD_TYPE_META[f.type].width,
      startH: f.height ?? FIELD_TYPE_META[f.type].height,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
    });
  };

  const selectedField = fields.find((f) => f.localId === selectedLocalId) || null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const toSave: PdfTemplateField[] = fields.map(({ localId, ...rest }) => rest);
      await onSave(toSave);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateRecipient = async () => {
    if (!onCreateRecipient) return;
    setRecipientBusy(true);
    try {
      const created = await onCreateRecipient(recipientForm);
      setRecipients((prev) => [...prev, created]);
      setShowRecipientForm(false);
      setRecipientForm({ name: "", email: "", phone: "", role: "Customer", label: "" });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create recipient");
    } finally {
      setRecipientBusy(false);
    }
  };

  const getRecipientColor = (recipientId?: string) => {
    if (!recipientId) return "#9ca3af";
    const idx = recipients.findIndex((r) => r.id === recipientId);
    if (idx === -1) return "#9ca3af";
    return RECIPIENT_PALETTE[idx % RECIPIENT_PALETTE.length];
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 md:p-6">
      <div className="flex h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex flex-col gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Edit fields: {document.title}</h2>
            <p className="text-xs text-gray-500">
              Select a tool, then click on the PDF to place a field. Drag to move. Use the sidebar to edit details.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onCancel}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || pdfLoading}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save fields"}
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-200 bg-white px-4 py-2">
          <span className="mr-2 text-xs font-semibold text-gray-500">Add field:</span>
          {FIELD_TYPES.map((type) => {
            const meta = FIELD_TYPE_META[type];
            const active = activeTool === type;
            return (
              <button
                key={type}
                onClick={() => setActiveTool(active ? null : type)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition ${
                  active
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              >
                {meta.icon}
                {meta.label}
              </button>
            );
          })}
          {activeTool && (
            <span className="ml-2 text-xs text-blue-600">Click on a PDF page to place a {FIELD_TYPE_META[activeTool].label} field</span>
          )}
        </div>

        <div className="flex min-h-0 flex-1">
          {/* PDF canvas area */}
          <div className="relative flex flex-1 flex-col overflow-hidden bg-gray-100" ref={containerRef}>
            {pdfLoading && (
              <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
                Loading PDF…
              </div>
            )}
            {pdfError && (
              <div className="flex flex-1 items-center justify-center p-6 text-sm text-red-600">
                {pdfError}
              </div>
            )}
            {!pdfLoading && !pdfError && pageViews.length === 0 && (
              <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
                No pages to display.
              </div>
            )}
            <div className="flex flex-1 flex-col items-center overflow-y-auto p-4">
              {pageViews.map((view, i) => (
                <div
                  key={i}
                  className="relative mb-6 inline-block rounded border border-gray-300 bg-white shadow-sm"
                  style={{ width: view.cssWidth, height: view.cssHeight }}
                >
                  <canvas
                    ref={(el) => {
                      canvasRefs.current[i] = el;
                    }}
                    className="block"
                  />
                  <div
                    className="absolute inset-0 cursor-crosshair"
                    style={{ width: view.cssWidth, height: view.cssHeight }}
                    onMouseDown={(e) => handleOverlayMouseDown(i, e)}
                  >
                    {fields
                      .filter((f) => f.page === i)
                      .map((f) => {
                        const w = f.width ?? FIELD_TYPE_META[f.type].width;
                        const h = f.height ?? FIELD_TYPE_META[f.type].height;
                        const left = f.x * view.cssScale;
                        const top = (view.baseViewport.height - f.y - h) * view.cssScale;
                        const color = getRecipientColor(f.recipientId);
                        const selected = selectedLocalId === f.localId;
                        return (
                          <div
                            key={f.localId}
                            className={`absolute flex flex-col overflow-hidden rounded border-2 bg-white/90 text-xs transition ${
                              selected ? "shadow-lg" : ""
                            }`}
                            style={{
                              left,
                              top,
                              width: w * view.cssScale,
                              height: h * view.cssScale,
                              borderColor: color,
                              color,
                              cursor: activeTool ? "crosshair" : "move",
                              zIndex: selected ? 20 : 10,
                            }}
                            onMouseDown={(e) => startDrag(f.localId, i, e)}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedLocalId(f.localId);
                            }}
                          >
                            <div className="flex items-center gap-1 bg-white/80 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                              {FIELD_TYPE_META[f.type].icon}
                              <span className="truncate">{f.label || f.type}</span>
                            </div>
                            {selected && (
                              <div
                                className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize bg-current"
                                style={{ opacity: 0.6 }}
                                onMouseDown={(e) => startResize(f.localId, i, e)}
                              />
                            )}
                          </div>
                        );
                      })}
                  </div>
                  <div className="absolute bottom-1 right-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
                    Page {i + 1}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sidebar */}
          <div className="w-80 flex-shrink-0 overflow-y-auto border-l border-gray-200 bg-white p-4">
            {selectedField ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">Field properties</h3>
                  <button
                    onClick={() => {
                      setFields((prev) => prev.filter((f) => f.localId !== selectedLocalId));
                      setSelectedLocalId(null);
                    }}
                    className="rounded p-1 text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Type</label>
                  <select
                    value={selectedField.type}
                    onChange={(e) => {
                      const type = e.target.value as FieldType;
                      const meta = FIELD_TYPE_META[type];
                      updateField(selectedField.localId, {
                        type,
                        width: meta.width,
                        height: meta.height,
                        options:
                          type === "radio" || type === "dropdown"
                            ? selectedField.options?.length
                              ? selectedField.options
                              : []
                            : undefined,
                      });
                    }}
                    className="w-full rounded-lg border border-gray-300 p-2 text-sm"
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {FIELD_TYPE_META[t].label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Label</label>
                  <input
                    value={selectedField.label || ""}
                    onChange={(e) => updateField(selectedField.localId, { label: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 p-2 text-sm"
                    placeholder="e.g. Customer signature"
                  />
                </div>

                {(selectedField.type === "text" ||
                  selectedField.type === "full_name" ||
                  selectedField.type === "phone" ||
                  selectedField.type === "email" ||
                  selectedField.type === "address") && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Placeholder</label>
                    <input
                      value={selectedField.placeholder || ""}
                      onChange={(e) =>
                        updateField(selectedField.localId, { placeholder: e.target.value })
                      }
                      className="w-full rounded-lg border border-gray-300 p-2 text-sm"
                    />
                  </div>
                )}

                {(selectedField.type === "radio" || selectedField.type === "dropdown") && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Options (comma separated)</label>
                    <input
                      value={(selectedField.options || []).join(", ")}
                      onChange={(e) =>
                        updateField(selectedField.localId, {
                          options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                        })
                      }
                      className="w-full rounded-lg border border-gray-300 p-2 text-sm"
                      placeholder="Yes, No, Maybe"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Width (pt)</label>
                    <input
                      type="number"
                      value={Math.round(selectedField.width ?? FIELD_TYPE_META[selectedField.type].width)}
                      onChange={(e) =>
                        updateField(selectedField.localId, { width: Number(e.target.value) || 1 })
                      }
                      className="w-full rounded-lg border border-gray-300 p-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Height (pt)</label>
                    <input
                      type="number"
                      value={Math.round(selectedField.height ?? FIELD_TYPE_META[selectedField.type].height)}
                      onChange={(e) =>
                        updateField(selectedField.localId, { height: Number(e.target.value) || 1 })
                      }
                      className="w-full rounded-lg border border-gray-300 p-2 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Page</label>
                  <input
                    type="number"
                    min={0}
                    max={pageViews.length - 1}
                    value={selectedField.page}
                    onChange={(e) =>
                      updateField(selectedField.localId, {
                        page: Math.max(0, Math.min(pageViews.length - 1, Number(e.target.value) || 0)),
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 p-2 text-sm"
                  />
                  <p className="mt-1 text-[10px] text-gray-400">0 = first page</p>
                </div>

                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={selectedField.required}
                    onChange={(e) => updateField(selectedField.localId, { required: e.target.checked })}
                    className="rounded"
                  />
                  Required field
                </label>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Assigned recipient</label>
                  <select
                    value={selectedField.recipientId || ""}
                    onChange={(e) =>
                      updateField(selectedField.localId, { recipientId: e.target.value || undefined })
                    }
                    className="w-full rounded-lg border border-gray-300 p-2 text-sm"
                  >
                    <option value="">Unassigned</option>
                    {recipients.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label || r.name || r.email || r.role} {r.email ? `(${r.email})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-500">Select a field to edit its properties.</div>
            )}

            <hr className="my-6 border-gray-200" />

            {/* Recipients */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">Recipients</h3>
                {onCreateRecipient && (
                  <button
                    onClick={() => setShowRecipientForm((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Plus className="h-3 w-3" /> Add
                  </button>
                )}
              </div>
              {recipients.length === 0 && (
                <p className="text-xs text-gray-500">No recipients yet. Fields can be sent to a customer later.</p>
              )}
              <ul className="space-y-2">
                {recipients.map((r, i) => (
                  <li key={r.id} className="rounded border border-gray-200 p-2 text-xs">
                    <div className="font-medium text-gray-900">
                      {r.label || r.name || r.role}{" "}
                      <span style={{ color: RECIPIENT_PALETTE[i % RECIPIENT_PALETTE.length] }}>
                        ●
                      </span>
                    </div>
                    {r.email && <div className="text-gray-500">{r.email}</div>}
                    {r.phone && <div className="text-gray-500">{r.phone}</div>}
                  </li>
                ))}
              </ul>

              {showRecipientForm && (
                <div className="mt-3 space-y-2 rounded border border-gray-200 bg-gray-50 p-3">
                  <input
                    value={recipientForm.name}
                    onChange={(e) => setRecipientForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Name"
                    className="w-full rounded border border-gray-300 p-1.5 text-xs"
                  />
                  <input
                    value={recipientForm.email}
                    onChange={(e) => setRecipientForm((p) => ({ ...p, email: e.target.value }))}
                    placeholder="Email"
                    className="w-full rounded border border-gray-300 p-1.5 text-xs"
                  />
                  <input
                    value={recipientForm.phone}
                    onChange={(e) => setRecipientForm((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="Phone"
                    className="w-full rounded border border-gray-300 p-1.5 text-xs"
                  />
                  <input
                    value={recipientForm.label}
                    onChange={(e) => setRecipientForm((p) => ({ ...p, label: e.target.value }))}
                    placeholder="Label (e.g. Customer 1)"
                    className="w-full rounded border border-gray-300 p-1.5 text-xs"
                  />
                  <select
                    value={recipientForm.role}
                    onChange={(e) =>
                      setRecipientForm((p) => ({ ...p, role: e.target.value as RecipientRole }))
                    }
                    className="w-full rounded border border-gray-300 p-1.5 text-xs"
                  >
                    {RECIPIENT_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowRecipientForm(false)}
                      className="flex-1 rounded border border-gray-300 bg-white py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateRecipient}
                      disabled={recipientBusy}
                      className="flex-1 rounded bg-blue-600 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {recipientBusy ? "Adding…" : "Add recipient"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <hr className="my-6 border-gray-200" />

            <div className="text-xs text-gray-500">
              <p className="font-medium text-gray-700">{fields.length} field(s)</p>
              <p className="mt-1">Drag fields to reposition. Use the resize handle in the bottom-right corner of a selected field.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
