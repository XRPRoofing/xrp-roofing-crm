"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  Check,
  Download,
  Eye,
  FileSignature,
  FileUp,
  MoreHorizontal,
  Pencil,
  PlusCircle,
  Search,
  Send,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  readDocuments,
  readTemplates,
  upsertDocument,
  deleteDocument,
  upsertTemplate,
  deleteTemplate,
  newDocId,
  newTemplateId,
  formatShortDate,
  type PdfDocument,
  type PdfDocStatus,
  type PdfTemplate,
} from "@/lib/pdf-signer-sync";

/* ── Status helpers ──────────────────────────────────────────────────── */

const statusColors: Record<PdfDocStatus, { bg: string; text: string; icon: string }> = {
  Draft:     { bg: "bg-orange-50", text: "text-orange-700", icon: "text-orange-500" },
  Sent:      { bg: "bg-blue-50",   text: "text-blue-700",   icon: "text-blue-500" },
  Viewed:    { bg: "bg-purple-50", text: "text-purple-700", icon: "text-purple-500" },
  Completed: { bg: "bg-green-50",  text: "text-green-700",  icon: "text-green-500" },
};

const filterTabs: ("All docs" | PdfDocStatus)[] = ["All docs", "Draft", "Sent", "Viewed", "Completed"];

/* ── Seed data for demo ──────────────────────────────────────────────── */

function seedDocumentsIfEmpty(): PdfDocument[] {
  const existing = readDocuments();
  if (existing.length > 0) return existing;
  const now = new Date().toISOString();
  const seeds: PdfDocument[] = [
    { id: newDocId(), jobAddress: "10008 West Madrugada Court, Phoenix AZ", customerName: "Jonathan Gonzalez", documentName: "ACORD Form 2025", dateCreated: "2025-04-30", dateCompleted: null, createdBy: "Jonathan Gonzalez", status: "Draft" },
    { id: newDocId(), jobAddress: "10008 West Madrugada Court, Phoenix AZ", customerName: "Jonathan Gonzalez", documentName: "ACORD Form 2025", dateCreated: "2025-04-30", dateCompleted: "2025-04-30", createdBy: "Jonathan Gonzalez", status: "Completed", signedAt: now, signedBy: "Jonathan Gonzalez" },
    { id: newDocId(), jobAddress: "2148 E Camelback Rd, Phoenix AZ", customerName: "Maria Hernandez", documentName: "Roof Inspection Agreement", dateCreated: "2025-05-10", dateCompleted: null, createdBy: "Johnny Roofer", status: "Sent", sentAt: now },
    { id: newDocId(), jobAddress: "8800 N Scottsdale Rd, Scottsdale AZ", customerName: "Desert Plaza HOA", documentName: "TPO Warranty Authorization", dateCreated: "2025-05-14", dateCompleted: null, createdBy: "Admin User", status: "Viewed", viewedAt: now },
    { id: newDocId(), jobAddress: "944 W Ocotillo Rd, Glendale AZ", customerName: "Ryan Mitchell", documentName: "Shingle Repair Contract", dateCreated: "2025-05-18", dateCompleted: "2025-05-20", createdBy: "Johnny Roofer", status: "Completed", signedAt: now, signedBy: "Ryan Mitchell" },
  ];
  seeds.forEach((s) => upsertDocument(s));
  return seeds;
}

/* ── Signature pad (canvas) ──────────────────────────────────────────── */

function SignaturePad({ onSave, onCancel }: { onSave: (dataUrl: string) => void; onCancel: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#1e40af";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
  }, []);

  const pos = (e: React.MouseEvent | React.TouchEvent) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const start = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) { const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  };

  const move = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) { const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }
  };

  const end = () => { drawing.current = false; };

  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-700">Draw your signature below</p>
      <canvas
        ref={canvasRef}
        width={400}
        height={150}
        className="w-full cursor-crosshair rounded-lg border-2 border-dashed border-gray-300 bg-white touch-none"
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
      />
      <div className="flex gap-2">
        <button type="button" onClick={clear} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Clear</button>
        <button type="button" onClick={() => onSave(canvasRef.current?.toDataURL("image/png") || "")} className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">Accept & Sign</button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
      </div>
    </div>
  );
}

/* ── Toasts ───────────────────────────────────────────────────────────── */

function Toast({ message, type, onDismiss }: { message: string; type: "success" | "error"; onDismiss: () => void }) {
  useEffect(() => { const t = setTimeout(onDismiss, 4000); return () => clearTimeout(t); }, [onDismiss]);
  return (
    <div className={`fixed right-4 top-4 z-[100] flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white"}`}>
      {type === "success" ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
      {message}
      <button type="button" onClick={onDismiss} className="ml-2 opacity-70 hover:opacity-100"><X className="h-3 w-3" /></button>
    </div>
  );
}

/* ── input class ──────────────────────────────────────────────────────── */

const inputClass = "w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100";

/* ══════════════════════════════════════════════════════════════════════ */
/*  Main page component                                                  */
/* ══════════════════════════════════════════════════════════════════════ */

export default function PdfSignerBoardPage() {
  /* ── State ──────────────────────────────────────────────────────── */
  const [activeTab, setActiveTab] = useState<"documents" | "templates">("documents");
  const [filter, setFilter] = useState<"All docs" | PdfDocStatus>("All docs");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<"dateCreated" | "dateCompleted">("dateCreated");
  const [sortAsc, setSortAsc] = useState(false);
  const [documents, setDocuments] = useState<PdfDocument[]>([]);
  const [templates, setTemplates] = useState<PdfTemplate[]>([]);

  /* Modals */
  const [createDocOpen, setCreateDocOpen] = useState(false);
  const [createTplOpen, setCreateTplOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<PdfDocument | null>(null);
  const [signingDoc, setSigningDoc] = useState<PdfDocument | null>(null);
  const [actionsOpenId, setActionsOpenId] = useState<string | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  /* Toast */
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const showToast = useCallback((message: string, type: "success" | "error" = "success") => setToast({ message, type }), []);

  /* Forms */
  const [docForm, setDocForm] = useState({ jobAddress: "", customerName: "", documentName: "", createdBy: "" });
  const [docFile, setDocFile] = useState<{ name: string; dataUrl: string } | null>(null);
  const [tplForm, setTplForm] = useState({ name: "", description: "", createdBy: "" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const quickUploadRef = useRef<HTMLInputElement>(null);

  /* Upload state */
  const [uploadError, setUploadError] = useState<string | null>(null);
  const MAX_PDF_SIZE = 5 * 1024 * 1024; // 5 MB

  /* ── Load data ──────────────────────────────────────────────────── */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load from localStorage
    setDocuments(seedDocumentsIfEmpty());
    setTemplates(readTemplates());
  }, []);

  /* Close actions menu on outside click */
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) setActionsOpenId(null);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  /* ── Filtered & sorted documents ─────────────────────────────── */
  const filteredDocs = useMemo(() => {
    let list = documents;
    if (filter !== "All docs") list = list.filter((d) => d.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((d) =>
        d.jobAddress.toLowerCase().includes(q) ||
        d.customerName.toLowerCase().includes(q) ||
        d.documentName.toLowerCase().includes(q)
      );
    }
    list = [...list].sort((a, b) => {
      const av = a[sortField] || "";
      const bv = b[sortField] || "";
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return list;
  }, [documents, filter, search, sortField, sortAsc]);

  /* ── Handlers ───────────────────────────────────────────────────── */

  function handleFileSelect(file: File, isQuickUpload: boolean = false) {
    setUploadError(null);
    if (file.type !== "application/pdf") {
      setUploadError("Only PDF files are accepted.");
      return;
    }
    if (file.size > MAX_PDF_SIZE) {
      setUploadError(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 5 MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (isQuickUpload) {
        const docName = file.name.replace(/\.pdf$/i, "");
        const doc: PdfDocument = {
          id: newDocId(),
          jobAddress: "",
          customerName: "",
          documentName: docName,
          dateCreated: new Date().toISOString().slice(0, 10),
          dateCompleted: null,
          createdBy: "XRP Roofing",
          status: "Draft",
          pdfDataUrl: dataUrl,
          pdfFileName: file.name,
        };
        setDocuments(upsertDocument(doc));
        showToast(`"${docName}" uploaded successfully`);
      } else {
        setDocFile({ name: file.name, dataUrl });
        if (!docForm.documentName.trim()) {
          setDocForm((prev) => ({ ...prev, documentName: file.name.replace(/\.pdf$/i, "") }));
        }
      }
    };
    reader.onerror = () => setUploadError("Failed to read file.");
    reader.readAsDataURL(file);
  }

  function handleCreateDoc() {
    if (!docForm.documentName.trim()) return;
    const doc: PdfDocument = {
      id: newDocId(),
      jobAddress: docForm.jobAddress.trim(),
      customerName: docForm.customerName.trim(),
      documentName: docForm.documentName.trim(),
      dateCreated: new Date().toISOString().slice(0, 10),
      dateCompleted: null,
      createdBy: docForm.createdBy.trim() || "XRP Roofing",
      status: "Draft",
      pdfDataUrl: docFile?.dataUrl,
      pdfFileName: docFile?.name,
    };
    setDocuments(upsertDocument(doc));
    setDocForm({ jobAddress: "", customerName: "", documentName: "", createdBy: "" });
    setDocFile(null);
    setUploadError(null);
    setCreateDocOpen(false);
    showToast("Document created successfully");
  }

  function handleCreateTemplate() {
    if (!tplForm.name.trim()) return;
    const tpl: PdfTemplate = {
      id: newTemplateId(),
      name: tplForm.name.trim(),
      description: tplForm.description.trim(),
      createdBy: tplForm.createdBy.trim() || "XRP Roofing",
      dateCreated: new Date().toISOString().slice(0, 10),
      fields: [],
    };
    setTemplates(upsertTemplate(tpl));
    setTplForm({ name: "", description: "", createdBy: "" });
    setCreateTplOpen(false);
    showToast("Template created successfully");
  }

  function handleDeleteDoc(id: string) {
    setDocuments(deleteDocument(id));
    setActionsOpenId(null);
    showToast("Document deleted");
  }

  function handleDeleteTemplate(id: string) {
    setTemplates(deleteTemplate(id));
    showToast("Template deleted");
  }

  function handleSendDoc(doc: PdfDocument) {
    const updated: PdfDocument = { ...doc, status: "Sent", sentAt: new Date().toISOString() };
    setDocuments(upsertDocument(updated));
    setActionsOpenId(null);
    showToast("Document sent for signature");
  }

  function handleMarkViewed(doc: PdfDocument) {
    const updated: PdfDocument = { ...doc, status: "Viewed", viewedAt: new Date().toISOString() };
    setDocuments(upsertDocument(updated));
    setActionsOpenId(null);
    showToast("Document marked as viewed");
  }

  function handleSignDoc(dataUrl: string) {
    if (!signingDoc) return;
    const updated: PdfDocument = {
      ...signingDoc,
      status: "Completed",
      signatureDataUrl: dataUrl,
      signedBy: signingDoc.customerName,
      signedAt: new Date().toISOString(),
      dateCompleted: new Date().toISOString().slice(0, 10),
    };
    setDocuments(upsertDocument(updated));
    setSigningDoc(null);
    showToast("Document signed successfully");
  }

  function handlePreview(doc: PdfDocument) {
    setPreviewDoc(doc);
    setActionsOpenId(null);
    if (doc.status === "Sent") {
      const updated: PdfDocument = { ...doc, status: "Viewed", viewedAt: new Date().toISOString() };
      setDocuments(upsertDocument(updated));
    }
  }

  function handleDownload(doc: PdfDocument) {
    if (doc.pdfDataUrl) {
      const a = document.createElement("a");
      a.href = doc.pdfDataUrl;
      a.download = doc.pdfFileName || `${doc.documentName.replace(/\s+/g, "_")}.pdf`;
      a.click();
    } else {
      const content = `PDF Signer Document\n\nDocument: ${doc.documentName}\nCustomer: ${doc.customerName}\nAddress: ${doc.jobAddress}\nStatus: ${doc.status}\nCreated: ${doc.dateCreated}\n${doc.signedBy ? `Signed by: ${doc.signedBy}\nSigned at: ${doc.signedAt}\n` : ""}`;
      const blob = new Blob([content], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${doc.documentName.replace(/\s+/g, "_")}.txt`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
    showToast("Document downloaded");
  }

  function toggleSort(field: "dateCreated" | "dateCompleted") {
    if (sortField === field) setSortAsc((v) => !v);
    else { setSortField(field); setSortAsc(false); }
  }

  /* ── Render ─────────────────────────────────────────────────────── */

  return (
    <div className="space-y-0">
      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">PDF Signer</h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => quickUploadRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
          >
            <FileUp className="h-4 w-4" />
            Upload PDF
          </button>
          <input ref={quickUploadRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f, true); e.target.value = ""; }} />
          <button
            type="button"
            onClick={() => { setCreateTplOpen(true); setActiveTab("templates"); }}
            className="inline-flex items-center gap-1.5 rounded-full border border-blue-600 px-4 py-2 text-sm font-semibold text-blue-600 transition hover:bg-blue-50"
          >
            <PlusCircle className="h-4 w-4" />
            Create template
          </button>
          <button
            type="button"
            onClick={() => { setCreateDocOpen(true); setActiveTab("documents"); }}
            className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            <PlusCircle className="h-4 w-4" />
            Create document
          </button>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────── */}
      <div className="mt-4 border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          <button
            type="button"
            onClick={() => setActiveTab("documents")}
            className={`whitespace-nowrap border-b-2 pb-3 text-sm font-semibold transition ${activeTab === "documents" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
          >
            Documents
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("templates")}
            className={`whitespace-nowrap border-b-2 pb-3 text-sm font-semibold transition ${activeTab === "templates" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
          >
            Templates
          </button>
        </nav>
      </div>

      {/* ── Documents tab ───────────────────────────────────────── */}
      {activeTab === "documents" && (
        <div className="mt-6 space-y-4">
          {/* Search + Filter bar */}
          <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search for documents, addresses, or customers..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 pl-10 pr-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {filterTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setFilter(tab)}
                  className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                    filter === tab
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-blue-600 hover:bg-blue-50"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {/* Document table (desktop) */}
          <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Job address</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Customer name</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Document name</th>
                  <th className="cursor-pointer px-4 py-3 font-semibold text-gray-600" onClick={() => toggleSort("dateCreated")}>
                    <span className="inline-flex items-center gap-1">Date created <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="cursor-pointer px-4 py-3 font-semibold text-gray-600" onClick={() => toggleSort("dateCompleted")}>
                    <span className="inline-flex items-center gap-1">Date completed <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Created by</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocs.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-gray-400">No documents found.</td></tr>
                )}
                {filteredDocs.map((doc) => {
                  const sc = statusColors[doc.status];
                  return (
                    <tr key={doc.id} className="border-b border-gray-50 transition hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${sc.bg} ${sc.text}`}>
                          <Pencil className={`h-3 w-3 ${sc.icon}`} />
                          {doc.status}
                        </span>
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3 text-gray-700" title={doc.jobAddress}>{doc.jobAddress}</td>
                      <td className="max-w-[140px] truncate px-4 py-3 text-gray-700" title={doc.customerName}>{doc.customerName}</td>
                      <td className="max-w-[160px] px-4 py-3 text-gray-700" title={doc.documentName}>
                        <span className="flex items-center gap-1.5 truncate">
                          {doc.pdfDataUrl && <FileUp className="h-3.5 w-3.5 shrink-0 text-blue-500" />}
                          {doc.documentName}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{formatShortDate(doc.dateCreated)}</td>
                      <td className="px-4 py-3 text-gray-500">{doc.dateCompleted ? formatShortDate(doc.dateCompleted) : ""}</td>
                      <td className="px-4 py-3 text-gray-700">{doc.createdBy}</td>
                      <td className="px-4 py-3">
                        <div className="relative flex items-center justify-end gap-2" ref={actionsOpenId === doc.id ? actionsRef : undefined}>
                          <button type="button" onClick={() => handlePreview(doc)} className="text-sm font-semibold text-blue-600 hover:text-blue-800">Preview</button>
                          <button type="button" onClick={() => setActionsOpenId(actionsOpenId === doc.id ? null : doc.id)} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                          {actionsOpenId === doc.id && (
                            <div className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl">
                              {doc.status === "Draft" && (
                                <button type="button" onClick={() => handleSendDoc(doc)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                                  <Send className="h-3.5 w-3.5" /> Send for signature
                                </button>
                              )}
                              {(doc.status === "Draft" || doc.status === "Sent" || doc.status === "Viewed") && (
                                <button type="button" onClick={() => { setSigningDoc(doc); setActionsOpenId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                                  <FileSignature className="h-3.5 w-3.5" /> Sign now
                                </button>
                              )}
                              {doc.status === "Sent" && (
                                <button type="button" onClick={() => handleMarkViewed(doc)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                                  <Eye className="h-3.5 w-3.5" /> Mark as viewed
                                </button>
                              )}
                              {(doc.status === "Completed" || doc.pdfDataUrl) && (
                                <button type="button" onClick={() => handleDownload(doc)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                                  <Download className="h-3.5 w-3.5" /> Download
                                </button>
                              )}
                              <button type="button" onClick={() => handleDeleteDoc(doc.id)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50">
                                <Trash2 className="h-3.5 w-3.5" /> Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Document cards (mobile) */}
          <div className="space-y-3 md:hidden">
            {filteredDocs.length === 0 && (
              <p className="py-12 text-center text-sm text-gray-400">No documents found.</p>
            )}
            {filteredDocs.map((doc) => {
              const sc = statusColors[doc.status];
              return (
                <div key={doc.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${sc.bg} ${sc.text}`}>
                        <Pencil className={`h-3 w-3 ${sc.icon}`} />
                        {doc.status}
                      </span>
                      <p className="mt-2 truncate font-semibold text-gray-900">{doc.documentName}</p>
                      <p className="truncate text-sm text-gray-500">{doc.customerName}</p>
                      <p className="truncate text-xs text-gray-400">{doc.jobAddress}</p>
                    </div>
                    <div className="ml-2 flex shrink-0 gap-1">
                      <button type="button" onClick={() => handlePreview(doc)} className="rounded-md p-1.5 text-blue-600 hover:bg-blue-50">
                        <Eye className="h-4 w-4" />
                      </button>
                      {(doc.status === "Draft" || doc.status === "Sent" || doc.status === "Viewed") && (
                        <button type="button" onClick={() => setSigningDoc(doc)} className="rounded-md p-1.5 text-green-600 hover:bg-green-50">
                          <FileSignature className="h-4 w-4" />
                        </button>
                      )}
                      {(doc.status === "Completed" || doc.pdfDataUrl) && (
                        <button type="button" onClick={() => handleDownload(doc)} className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100">
                          <Download className="h-4 w-4" />
                        </button>
                      )}
                      <button type="button" onClick={() => handleDeleteDoc(doc.id)} className="rounded-md p-1.5 text-red-500 hover:bg-red-50">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-4 border-t border-gray-100 pt-2 text-xs text-gray-400">
                    <span>Created {formatShortDate(doc.dateCreated)}</span>
                    {doc.dateCompleted && <span>Completed {formatShortDate(doc.dateCompleted)}</span>}
                    <span className="ml-auto">{doc.createdBy}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Templates tab ───────────────────────────────────────── */}
      {activeTab === "templates" && (
        <div className="mt-6 space-y-4">
          {templates.length === 0 && !createTplOpen && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
              <Upload className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm font-medium text-gray-500">No templates yet</p>
              <p className="mt-1 text-xs text-gray-400">Create a template to reuse across documents</p>
              <button type="button" onClick={() => setCreateTplOpen(true)} className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                <PlusCircle className="h-4 w-4" /> Create template
              </button>
            </div>
          )}

          {templates.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {templates.map((tpl) => (
                <div key={tpl.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900">{tpl.name}</h3>
                      <p className="mt-1 text-sm text-gray-500">{tpl.description || "No description"}</p>
                    </div>
                    <button type="button" onClick={() => handleDeleteTemplate(tpl.id)} className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-500">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3 text-xs text-gray-400">
                    <span>{tpl.createdBy}</span>
                    <span>{formatShortDate(tpl.dateCreated)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDocForm({ jobAddress: "", customerName: "", documentName: tpl.name, createdBy: tpl.createdBy });
                      setCreateDocOpen(true);
                      setActiveTab("documents");
                    }}
                    className="mt-3 w-full rounded-lg bg-blue-50 py-2 text-xs font-semibold text-blue-600 transition hover:bg-blue-100"
                  >
                    Use template
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Create Document modal ───────────────────────────────── */}
      {createDocOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCreateDocOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Create Document</h2>
              <button type="button" onClick={() => setCreateDocOpen(false)} className="rounded-md p-1 text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-4 space-y-3">
              {/* PDF File Upload */}
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Upload PDF file</label>
                <div
                  className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-6 transition hover:border-blue-400 hover:bg-blue-50/30"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f); }}
                >
                  <Upload className="h-8 w-8 text-gray-400" />
                  {docFile ? (
                    <div className="mt-2 text-center">
                      <p className="text-sm font-medium text-blue-600">{docFile.name}</p>
                      <button type="button" onClick={(e) => { e.stopPropagation(); setDocFile(null); }} className="mt-1 text-xs text-red-500 hover:text-red-700">Remove</button>
                    </div>
                  ) : (
                    <div className="mt-2 text-center">
                      <p className="text-sm font-medium text-gray-600">Click to upload or drag & drop</p>
                      <p className="text-xs text-gray-400">PDF files only, max 5 MB</p>
                    </div>
                  )}
                  <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); e.target.value = ""; }} />
                </div>
                {uploadError && <p className="mt-1 text-xs font-medium text-red-500">{uploadError}</p>}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Document name *</label>
                <input className={inputClass} placeholder="e.g. ACORD Form 2025" value={docForm.documentName} onChange={(e) => setDocForm({ ...docForm, documentName: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Customer name</label>
                <input className={inputClass} placeholder="e.g. John Smith" value={docForm.customerName} onChange={(e) => setDocForm({ ...docForm, customerName: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Job address</label>
                <input className={inputClass} placeholder="e.g. 123 Main St, Phoenix AZ" value={docForm.jobAddress} onChange={(e) => setDocForm({ ...docForm, jobAddress: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Created by</label>
                <input className={inputClass} placeholder="Your name" value={docForm.createdBy} onChange={(e) => setDocForm({ ...docForm, createdBy: e.target.value })} />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setCreateDocOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={handleCreateDoc} disabled={!docForm.documentName.trim()} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Template modal ───────────────────────────────── */}
      {createTplOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCreateTplOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Create Template</h2>
              <button type="button" onClick={() => setCreateTplOpen(false)} className="rounded-md p-1 text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Template name *</label>
                <input className={inputClass} placeholder="e.g. Standard Roofing Contract" value={tplForm.name} onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Description</label>
                <textarea className={inputClass} rows={3} placeholder="Describe this template..." value={tplForm.description} onChange={(e) => setTplForm({ ...tplForm, description: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Created by</label>
                <input className={inputClass} placeholder="Your name" value={tplForm.createdBy} onChange={(e) => setTplForm({ ...tplForm, createdBy: e.target.value })} />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setCreateTplOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={handleCreateTemplate} disabled={!tplForm.name.trim()} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Preview modal ───────────────────────────────────────── */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPreviewDoc(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">{previewDoc.documentName}</h2>
              <button type="button" onClick={() => setPreviewDoc(null)} className="rounded-md p-1 text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>

            <div className="mt-4 space-y-3">
              <div className="rounded-lg bg-gray-50 p-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-gray-500">Status:</span> <span className={`ml-1 font-semibold ${statusColors[previewDoc.status].text}`}>{previewDoc.status}</span></div>
                  <div><span className="text-gray-500">Created:</span> <span className="ml-1 font-medium text-gray-900">{formatShortDate(previewDoc.dateCreated)}</span></div>
                  <div className="col-span-2"><span className="text-gray-500">Customer:</span> <span className="ml-1 font-medium text-gray-900">{previewDoc.customerName}</span></div>
                  <div className="col-span-2"><span className="text-gray-500">Address:</span> <span className="ml-1 font-medium text-gray-900">{previewDoc.jobAddress}</span></div>
                  <div className="col-span-2"><span className="text-gray-500">Created by:</span> <span className="ml-1 font-medium text-gray-900">{previewDoc.createdBy}</span></div>
                  {previewDoc.signedBy && (
                    <div className="col-span-2"><span className="text-gray-500">Signed by:</span> <span className="ml-1 font-medium text-green-700">{previewDoc.signedBy}</span> on {previewDoc.signedAt ? formatShortDate(previewDoc.signedAt) : ""}</div>
                  )}
                </div>
              </div>

              {/* Signature display */}
              {previewDoc.signatureDataUrl && (
                <div>
                  <p className="mb-1 text-xs font-medium text-gray-500">Signature</p>
                  <div className="rounded-lg border border-gray-200 bg-white p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewDoc.signatureDataUrl} alt="Signature" className="h-20 w-auto" />
                  </div>
                </div>
              )}

              {/* PDF viewer / placeholder */}
              {previewDoc.pdfDataUrl ? (
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <iframe
                    src={previewDoc.pdfDataUrl}
                    title={previewDoc.documentName}
                    className="h-[400px] w-full"
                  />
                </div>
              ) : (
                <div className="flex h-48 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50">
                  <div className="text-center">
                    <FileSignature className="mx-auto h-10 w-10 text-gray-300" />
                    <p className="mt-2 text-sm text-gray-400">No PDF file attached</p>
                    <p className="text-xs text-gray-300">{previewDoc.documentName}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              {(previewDoc.status === "Completed" || previewDoc.pdfDataUrl) && (
                <button type="button" onClick={() => { handleDownload(previewDoc); setPreviewDoc(null); }} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  <Download className="h-4 w-4" /> Download
                </button>
              )}
              {previewDoc.status !== "Completed" && (
                <button type="button" onClick={() => { setSigningDoc(previewDoc); setPreviewDoc(null); }} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                  <FileSignature className="h-4 w-4" /> Sign now
                </button>
              )}
              <button type="button" onClick={() => setPreviewDoc(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Signing modal ───────────────────────────────────────── */}
      {signingDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSigningDoc(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Sign: {signingDoc.documentName}</h2>
              <button type="button" onClick={() => setSigningDoc(null)} className="rounded-md p-1 text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
              Customer <strong>{signingDoc.customerName || "(no customer)"}</strong>{signingDoc.jobAddress ? ` — ${signingDoc.jobAddress}` : ""}
            </div>
            {signingDoc.pdfDataUrl && (
              <div className="mt-3 overflow-hidden rounded-lg border border-gray-200">
                <iframe
                  src={signingDoc.pdfDataUrl}
                  title={signingDoc.documentName}
                  className="h-[250px] w-full"
                />
              </div>
            )}
            <div className="mt-4">
              <SignaturePad onSave={handleSignDoc} onCancel={() => setSigningDoc(null)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
