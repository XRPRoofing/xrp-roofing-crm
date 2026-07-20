"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpDown, Check, Download, Eye, FileSignature, FileUp, MoreHorizontal, Pencil, PlusCircle, Search, Send, Trash2, Upload, X, AlertTriangle } from "lucide-react";
import {
  loadDocuments,
  loadTemplates,
  loadDocument,
  createDocument,
  createTemplate,
  deleteDocument as deletePdfDocument,
  deleteTemplate as deletePdfTemplate,
  sendDocument,
  adminSignDocument,
  voidDocument,
  uploadPdfFile,
  updateDocumentFields,
  getLegacyMigrationStats,
  migrateLegacyDocuments,
  clearMigrationFlag,
  subscribeToPdfDocuments,
  subscribeToPdfTemplates,
  newDocId,
  newTemplateId,
  formatShortDate,
  type PdfDocument,
  type PdfDocStatus,
  type PdfTemplate,
  type PdfField,
  type FieldType,
} from "@/lib/pdf-signer-db";

const statusColors: Record<PdfDocStatus, { bg: string; text: string; icon: string }> = {
  Draft: { bg: "bg-orange-50", text: "text-orange-700", icon: "text-orange-500" },
  Sent: { bg: "bg-blue-50", text: "text-blue-700", icon: "text-blue-500" },
  Viewed: { bg: "bg-purple-50", text: "text-purple-700", icon: "text-purple-500" },
  "Partially Completed": { bg: "bg-amber-50", text: "text-amber-700", icon: "text-amber-500" },
  Completed: { bg: "bg-green-50", text: "text-green-700", icon: "text-green-500" },
  Declined: { bg: "bg-red-50", text: "text-red-700", icon: "text-red-500" },
  Expired: { bg: "bg-gray-100", text: "text-gray-700", icon: "text-gray-500" },
  Voided: { bg: "bg-gray-100", text: "text-gray-700", icon: "text-gray-500" },
};

const filterTabs: ("All docs" | PdfDocStatus)[] = ["All docs", "Draft", "Sent", "Viewed", "Partially Completed", "Completed", "Voided"];
const fieldTypeOptions: FieldType[] = ["signature", "initials", "text", "date", "full_name", "phone", "email", "address", "checkbox", "radio", "dropdown", "label"];

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

function SignaturePad({ onSave, onCancel }: { onSave: (dataUrl: string) => void; onCancel: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  useEffect(() => {
    const c = canvasRef.current; const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#1e40af"; ctx.lineWidth = 2; ctx.lineCap = "round";
  }, []);
  const pos = (e: React.MouseEvent | React.TouchEvent) => {
    const c = canvasRef.current!; const rect = c.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };
  const start = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); drawing.current = true; const ctx = canvasRef.current?.getContext("2d"); if (ctx) { const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); } };
  const move = (e: React.MouseEvent | React.TouchEvent) => { if (!drawing.current) return; e.preventDefault(); const ctx = canvasRef.current?.getContext("2d"); if (ctx) { const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); } };
  const end = () => { drawing.current = false; };
  const clear = () => { const c = canvasRef.current; const ctx = c?.getContext("2d"); if (c && ctx) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); } };
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-700">Draw signature below</p>
      <canvas ref={canvasRef} width={400} height={150} className="w-full cursor-crosshair rounded-lg border-2 border-dashed border-gray-300 bg-white touch-none" onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end} onTouchStart={start} onTouchMove={move} onTouchEnd={end} />
      <div className="flex gap-2">
        <button type="button" onClick={clear} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Clear</button>
        <button type="button" onClick={() => onSave(canvasRef.current?.toDataURL("image/png") || "")} className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">Accept & Sign</button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
      </div>
    </div>
  );
}

export default function PdfSignerBoardPage() {
  const [activeTab, setActiveTab] = useState<"documents" | "templates">("documents");
  const [filter, setFilter] = useState<"All docs" | PdfDocStatus>("All docs");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<"dateCreated" | "dateCompleted">("dateCreated");
  const [sortAsc, setSortAsc] = useState(false);
  const [documents, setDocuments] = useState<PdfDocument[]>([]);
  const [templates, setTemplates] = useState<PdfTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const showToast = useCallback((message: string, type: "success" | "error" = "success") => setToast({ message, type }), []);

  const [actionsOpenId, setActionsOpenId] = useState<string | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  /* Modals */
  const [createDocOpen, setCreateDocOpen] = useState(false);
  const [createTplOpen, setCreateTplOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<PdfDocument | null>(null);
  const [signingDoc, setSigningDoc] = useState<PdfDocument | null>(null);
  const [sendDoc, setSendDoc] = useState<PdfDocument | null>(null);
  const [fieldEditorDoc, setFieldEditorDoc] = useState<PdfDocument | null>(null);
  const [fieldEditorFields, setFieldEditorFields] = useState<PdfField[]>([]);

  const [docForm, setDocForm] = useState({ jobAddress: "", customerName: "", documentName: "", createdBy: "" });
  const [docFile, setDocFile] = useState<{ name: string; path: string } | null>(null);
  const [docUploading, setDocUploading] = useState(false);
  const [tplForm, setTplForm] = useState({ name: "", description: "", createdBy: "" });
  const [tplFile, setTplFile] = useState<{ name: string; path: string } | null>(null);
  const [tplUploading, setTplUploading] = useState(false);
  const [sendForm, setSendForm] = useState({ name: "", email: "", phone: "" });
  const [sendBusy, setSendBusy] = useState(false);
  const [signBusy, setSignBusy] = useState(false);

  /* Migration */
  const [migrationStats, setMigrationStats] = useState<{ documentCount: number; templateCount: number; hasMigrated: boolean }>({ documentCount: 0, templateCount: 0, hasMigrated: true });
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState({ done: 0, total: 0, item: "" });
  const [migrationBusy, setMigrationBusy] = useState(false);

  const inputClass = "w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100";

  const refresh = useCallback(async () => {
    try {
      const [docs, tpls] = await Promise.all([loadDocuments(), loadTemplates()]);
      setDocuments(docs); setTemplates(tpls);
    } catch (err) { showToast(err instanceof Error ? err.message : "Failed to load data", "error"); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { refresh(); setMigrationStats(getLegacyMigrationStats()); }, [refresh]);
  useEffect(() => { const unsubDoc = subscribeToPdfDocuments(refresh); const unsubTpl = subscribeToPdfTemplates(refresh); return () => { unsubDoc(); unsubTpl(); }; }, [refresh]);
  useEffect(() => { function onClick(e: MouseEvent) { if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) setActionsOpenId(null); } document.addEventListener("mousedown", onClick); return () => document.removeEventListener("mousedown", onClick); }, []);

  const filteredDocs = useMemo(() => {
    let list = documents;
    if (filter !== "All docs") list = list.filter((d) => d.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((d) => (d.jobAddress || "").toLowerCase().includes(q) || (d.customerName || "").toLowerCase().includes(q) || d.title.toLowerCase().includes(q));
    }
    list = [...list].sort((a, b) => {
      const av = (sortField === "dateCreated" ? a.dateCreated : (a.dateCompleted || "")) || "";
      const bv = (sortField === "dateCreated" ? b.dateCreated : (b.dateCompleted || "")) || "";
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return list;
  }, [documents, filter, search, sortField, sortAsc]);

  async function handleFileSelect(file: File, isQuickUpload = false, isTemplate = false) {
    if (file.type !== "application/pdf") { showToast("Only PDF files are accepted", "error"); return; }
    if (file.size > 5 * 1024 * 1024) { showToast("File too large (max 5 MB)", "error"); return; }
    if (isTemplate) { setTplUploading(true); } else { setDocUploading(true); }
    try {
      const result = await uploadPdfFile(file, isTemplate ? "templates" : "originals");
      const info = { name: file.name, path: result.path };
      if (isTemplate) { setTplFile(info); setTplUploading(false); }
      else {
        setDocFile(info); setDocUploading(false);
        if (!docForm.documentName.trim()) setDocForm((p) => ({ ...p, documentName: file.name.replace(/\.pdf$/i, "") }));
        if (isQuickUpload) {
          const doc = await createDocument({ title: info.name.replace(/\.pdf$/i, ""), originalPdfPath: result.path, pdfFileName: file.name, createdBy: "XRP Roofing" });
          setDocuments((prev) => [doc, ...prev]);
          showToast(`"${doc.title}" uploaded`);
        }
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Upload failed", "error");
      if (isTemplate) setTplUploading(false); else setDocUploading(false);
    }
  }

  async function handleCreateDoc() {
    if (!docForm.documentName.trim() || !docFile) return;
    try {
      const doc = await createDocument({
        title: docForm.documentName.trim(),
        customerName: docForm.customerName.trim() || undefined,
        jobAddress: docForm.jobAddress.trim() || undefined,
        createdBy: docForm.createdBy.trim() || "XRP Roofing",
        originalPdfPath: docFile.path,
        pdfFileName: docFile.name,
      });
      setDocuments((prev) => [doc, ...prev]);
      setDocForm({ jobAddress: "", customerName: "", documentName: "", createdBy: "" }); setDocFile(null); setCreateDocOpen(false);
      showToast("Document created");
    } catch (err) { showToast(err instanceof Error ? err.message : "Failed to create document", "error"); }
  }

  async function handleCreateTemplate() {
    if (!tplForm.name.trim() || !tplFile) return;
    try {
      const tpl = await createTemplate({ name: tplForm.name.trim(), description: tplForm.description.trim() || undefined, pdfPath: tplFile.path, createdBy: tplForm.createdBy.trim() || "XRP Roofing" });
      setTemplates((prev) => [tpl, ...prev]);
      setTplForm({ name: "", description: "", createdBy: "" }); setTplFile(null); setCreateTplOpen(false);
      showToast("Template created");
    } catch (err) { showToast(err instanceof Error ? err.message : "Failed to create template", "error"); }
  }

  async function handleDeleteDoc(id: string) {
    try { await deletePdfDocument(id); setDocuments((prev) => prev.filter((d) => d.id !== id)); showToast("Document deleted"); } catch (err) { showToast(err instanceof Error ? err.message : "Delete failed", "error"); }
    setActionsOpenId(null);
  }

  async function handleDeleteTemplate(id: string) {
    try { await deletePdfTemplate(id); setTemplates((prev) => prev.filter((t) => t.id !== id)); showToast("Template deleted"); } catch (err) { showToast(err instanceof Error ? err.message : "Delete failed", "error"); }
  }

  async function handleSendDoc() {
    if (!sendDoc) return;
    setSendBusy(true);
    try {
      const { signingUrl } = await sendDocument(sendDoc.id, { name: sendForm.name.trim() || undefined, email: sendForm.email.trim() || undefined, phone: sendForm.phone.trim() || undefined });
      setSendDoc(null); setSendForm({ name: "", email: "", phone: "" });
      await refresh();
      if (navigator.clipboard) await navigator.clipboard.writeText(signingUrl);
      showToast(`Signing link created${navigator.clipboard ? " and copied" : ""}`);
    } catch (err) { showToast(err instanceof Error ? err.message : "Send failed", "error"); }
    setSendBusy(false);
  }

  async function handleSignDoc(dataUrl: string) {
    if (!signingDoc) return;
    setSignBusy(true);
    try {
      const doc = await adminSignDocument(signingDoc.id, dataUrl);
      setDocuments((prev) => prev.map((d) => (d.id === doc.id ? doc : d)));
      setSigningDoc(null); showToast("Document signed");
    } catch (err) { showToast(err instanceof Error ? err.message : "Signing failed", "error"); }
    setSignBusy(false);
  }

  async function handleVoidDoc(doc: PdfDocument) {
    try { const updated = await voidDocument(doc.id); setDocuments((prev) => prev.map((d) => (d.id === updated.id ? updated : d))); showToast("Document voided"); } catch (err) { showToast(err instanceof Error ? err.message : "Void failed", "error"); }
    setActionsOpenId(null);
  }

  function handleDownload(doc: PdfDocument) {
    const url = doc.signedPdfUrl || doc.originalPdfUrl;
    if (url) window.open(url, "_blank");
    else showToast("No PDF available to download", "error");
  }

  async function openFieldEditor(doc: PdfDocument) {
    try {
      const full = await loadDocument(doc.id);
      setFieldEditorDoc(full);
      setFieldEditorFields(full.fields || []);
    } catch (err) { showToast(err instanceof Error ? err.message : "Failed to load fields", "error"); }
  }

  async function saveFieldEditor() {
    if (!fieldEditorDoc) return;
    try {
      const saved = await updateDocumentFields(fieldEditorDoc.id, fieldEditorFields);
      setFieldEditorDoc((prev) => (prev ? { ...prev, fields: saved } : prev));
      showToast("Fields saved");
      await refresh();
    } catch (err) { showToast(err instanceof Error ? err.message : "Failed to save fields", "error"); }
  }

  async function handleMigrate() {
    setMigrationBusy(true);
    setMigrationProgress({ done: 0, total: migrationStats.documentCount + migrationStats.templateCount, item: "Starting..." });
    try {
      const result = await migrateLegacyDocuments((done, total, item) => setMigrationProgress({ done, total, item }));
      if (result.errors.length) showToast(`Migrated with ${result.errors.length} errors`, "error");
      else showToast(`Migrated ${result.documents} documents and ${result.templates} templates`);
      setMigrationStats(getLegacyMigrationStats());
      await refresh();
      setMigrationOpen(false);
    } catch (err) { showToast(err instanceof Error ? err.message : "Migration failed", "error"); }
    setMigrationBusy(false);
  }

  function toggleSort(field: "dateCreated" | "dateCompleted") { if (sortField === field) setSortAsc((v) => !v); else { setSortField(field); setSortAsc(false); } }

  function addField() {
    const last = fieldEditorFields[fieldEditorFields.length - 1];
    setFieldEditorFields((prev) => [...prev, { id: newDocId(), documentId: fieldEditorDoc?.id || "", type: "text", label: "New field", page: last?.page ?? 0, x: 50, y: (last?.y ?? 0) + 50, width: 200, height: 30, required: true, options: [] }]);
  }

  function updateField(index: number, patch: Partial<PdfField>) {
    setFieldEditorFields((prev) => { const next = [...prev]; next[index] = { ...next[index], ...patch } as PdfField; return next; });
  }

  function removeField(index: number) { setFieldEditorFields((prev) => prev.filter((_, i) => i !== index)); }

  return (
    <div className="space-y-0">
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}

      {!migrationStats.hasMigrated && (migrationStats.documentCount > 0 || migrationStats.templateCount > 0) && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="flex-1">
              <p className="font-semibold">Legacy PDF Signer data detected</p>
              <p className="mt-1">{migrationStats.documentCount} documents and {migrationStats.templateCount} templates can be migrated to Supabase.</p>
            </div>
            <button onClick={() => setMigrationOpen(true)} className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700">Migrate now</button>
            <button onClick={() => { clearMigrationFlag(); setMigrationStats(getLegacyMigrationStats()); }} className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100">Dismiss</button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">PDF Signer</h1>
        <div className="flex gap-2">
          <button onClick={() => { const fi = document.getElementById("pdf-quick-upload"); fi?.click(); }} className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"><FileUp className="h-4 w-4" /> Upload PDF</button>
          <input id="pdf-quick-upload" type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f, true); e.target.value = ""; }} />
          <button onClick={() => setCreateTplOpen(true)} className="inline-flex items-center gap-1.5 rounded-full border border-blue-600 px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50"><PlusCircle className="h-4 w-4" /> Create template</button>
          <button onClick={() => setCreateDocOpen(true)} className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"><PlusCircle className="h-4 w-4" /> Create document</button>
        </div>
      </div>

      <div className="mt-4 border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          <button onClick={() => setActiveTab("documents")} className={`whitespace-nowrap border-b-2 pb-3 text-sm font-semibold transition ${activeTab === "documents" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>Documents</button>
          <button onClick={() => setActiveTab("templates")} className={`whitespace-nowrap border-b-2 pb-3 text-sm font-semibold transition ${activeTab === "templates" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>Templates</button>
        </nav>
      </div>

      {activeTab === "documents" && (
        <div className="mt-6 space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
            <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search documents, addresses, customers..." className={inputClass + " pl-10"} /></div>
            <div className="flex flex-wrap gap-1">{filterTabs.map((tab) => <button key={tab} onClick={() => setFilter(tab)} className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${filter === tab ? "bg-blue-600 text-white shadow-sm" : "text-blue-600 hover:bg-blue-50"}`}>{tab}</button>)}</div>
          </div>

          {loading ? <p className="py-12 text-center text-sm text-gray-400">Loading...</p> : (
            <>
              <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm md:block">
                <table className="w-full text-left text-sm">
                  <thead><tr className="border-b border-gray-100 bg-gray-50/60">
                    <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                    <th className="px-4 py-3 font-semibold text-gray-600">Job address</th>
                    <th className="px-4 py-3 font-semibold text-gray-600">Customer</th>
                    <th className="px-4 py-3 font-semibold text-gray-600">Document</th>
                    <th className="cursor-pointer px-4 py-3 font-semibold text-gray-600" onClick={() => toggleSort("dateCreated")}><span className="inline-flex items-center gap-1">Date created <ArrowUpDown className="h-3 w-3" /></span></th>
                    <th className="cursor-pointer px-4 py-3 font-semibold text-gray-600" onClick={() => toggleSort("dateCompleted")}><span className="inline-flex items-center gap-1">Completed <ArrowUpDown className="h-3 w-3" /></span></th>
                    <th className="px-4 py-3 font-semibold text-gray-600">Created by</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600">Actions</th>
                  </tr></thead>
                  <tbody>
                    {filteredDocs.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-gray-400">No documents found.</td></tr>}
                    {filteredDocs.map((doc) => {
                      const sc = statusColors[doc.status];
                      return (
                        <tr key={doc.id} className="border-b border-gray-50 transition hover:bg-gray-50/50">
                          <td className="px-4 py-3"><span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${sc.bg} ${sc.text}`}><Pencil className={`h-3 w-3 ${sc.icon}`} />{doc.status}</span></td>
                          <td className="max-w-[200px] truncate px-4 py-3 text-gray-700" title={doc.jobAddress}>{doc.jobAddress}</td>
                          <td className="max-w-[140px] truncate px-4 py-3 text-gray-700" title={doc.customerName}>{doc.customerName}</td>
                          <td className="max-w-[160px] truncate px-4 py-3 text-gray-700" title={doc.title}>{doc.title}</td>
                          <td className="px-4 py-3 text-gray-500">{formatShortDate(doc.dateCreated)}</td>
                          <td className="px-4 py-3 text-gray-500">{doc.dateCompleted ? formatShortDate(doc.dateCompleted) : ""}</td>
                          <td className="px-4 py-3 text-gray-700">{doc.createdBy}</td>
                          <td className="px-4 py-3">
                            <div className="relative flex items-center justify-end gap-2" ref={actionsOpenId === doc.id ? actionsRef : undefined}>
                              <button onClick={() => setPreviewDoc(doc)} className="text-sm font-semibold text-blue-600 hover:text-blue-800">Preview</button>
                              <button onClick={() => setActionsOpenId(actionsOpenId === doc.id ? null : doc.id)} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"><MoreHorizontal className="h-4 w-4" /></button>
                              {actionsOpenId === doc.id && (
                                <div className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl">
                                  {doc.status === "Draft" && <button onClick={() => { setSendDoc(doc); setActionsOpenId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><Send className="h-3.5 w-3.5" /> Send for signature</button>}
                                  {doc.status !== "Completed" && doc.status !== "Voided" && <button onClick={() => { setSigningDoc(doc); setActionsOpenId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><FileSignature className="h-3.5 w-3.5" /> Sign now</button>}
                                  {(doc.status === "Completed" || doc.originalPdfUrl) && <button onClick={() => { handleDownload(doc); setActionsOpenId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><Download className="h-3.5 w-3.5" /> Download</button>}
                                  <button onClick={() => { openFieldEditor(doc); setActionsOpenId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><Pencil className="h-3.5 w-3.5" /> Edit fields</button>
                                  {doc.status !== "Voided" && doc.status !== "Completed" && <button onClick={() => handleVoidDoc(doc)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><X className="h-3.5 w-3.5" /> Void</button>}
                                  {doc.status === "Draft" && <button onClick={() => handleDeleteDoc(doc.id)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /> Delete</button>}
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

              <div className="space-y-3 md:hidden">
                {filteredDocs.length === 0 && <p className="py-12 text-center text-sm text-gray-400">No documents found.</p>}
                {filteredDocs.map((doc) => {
                  const sc = statusColors[doc.status];
                  return (
                    <div key={doc.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${sc.bg} ${sc.text}`}><Pencil className={`h-3 w-3 ${sc.icon}`} />{doc.status}</span>
                          <p className="mt-2 truncate font-semibold text-gray-900">{doc.title}</p>
                          <p className="truncate text-sm text-gray-500">{doc.customerName}</p>
                          <p className="truncate text-xs text-gray-400">{doc.jobAddress}</p>
                        </div>
                        <div className="ml-2 flex shrink-0 gap-1">
                          <button onClick={() => setPreviewDoc(doc)} className="rounded-md p-1.5 text-blue-600 hover:bg-blue-50"><Eye className="h-4 w-4" /></button>
                          {doc.status !== "Completed" && doc.status !== "Voided" && <button onClick={() => setSigningDoc(doc)} className="rounded-md p-1.5 text-green-600 hover:bg-green-50"><FileSignature className="h-4 w-4" /></button>}
                          {(doc.status === "Completed" || doc.originalPdfUrl) && <button onClick={() => handleDownload(doc)} className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100"><Download className="h-4 w-4" /></button>}
                          {doc.status === "Draft" && <button onClick={() => handleDeleteDoc(doc.id)} className="rounded-md p-1.5 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>}
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-4 border-t border-gray-100 pt-2 text-xs text-gray-400"><span>Created {formatShortDate(doc.dateCreated)}</span>{doc.dateCompleted && <span>Completed {formatShortDate(doc.dateCompleted)}</span>}<span className="ml-auto">{doc.createdBy}</span></div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === "templates" && (
        <div className="mt-6 space-y-4">
          {templates.length === 0 && !loading ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
              <Upload className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm font-medium text-gray-500">No templates yet</p>
              <button onClick={() => setCreateTplOpen(true)} className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"><PlusCircle className="h-4 w-4" /> Create template</button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {templates.map((tpl) => (
                <div key={tpl.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900">{tpl.name}</h3>
                      <p className="mt-1 text-sm text-gray-500">{tpl.description || "No description"}</p>
                    </div>
                    <button onClick={() => handleDeleteTemplate(tpl.id)} className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3 text-xs text-gray-400"><span>{tpl.createdBy}</span><span>{formatShortDate(tpl.createdAt)}</span></div>
                  <button onClick={() => { setDocForm({ jobAddress: "", customerName: "", documentName: tpl.name, createdBy: tpl.createdBy || "" }); setCreateDocOpen(true); setActiveTab("documents"); }} className="mt-3 w-full rounded-lg bg-blue-50 py-2 text-xs font-semibold text-blue-600 transition hover:bg-blue-100">Use template</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {createDocOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCreateDocOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-gray-900">Create Document</h2><button onClick={() => setCreateDocOpen(false)} className="rounded-md p-1 text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button></div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Upload PDF file *</label>
                <div className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 ${docFile ? "border-blue-400 bg-blue-50/30" : "border-dashed border-gray-300 bg-gray-50"} px-4 py-6 transition hover:border-blue-400 hover:bg-blue-50/30`} onClick={() => document.getElementById("doc-upload")?.click()} onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f, false, false); }}>
                  <Upload className="h-8 w-8 text-gray-400" />
                  {docFile ? <p className="mt-2 text-sm font-medium text-blue-600">{docFile.name}</p> : <div className="mt-2 text-center"><p className="text-sm font-medium text-gray-600">Click or drag & drop PDF</p><p className="text-xs text-gray-400">Max 5 MB</p></div>}
                  <input id="doc-upload" type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); e.target.value = ""; }} />
                </div>
                {docUploading && <p className="mt-1 text-xs text-blue-600">Uploading...</p>}
              </div>
              <div><label className="mb-1 block text-xs font-medium text-gray-600">Document name *</label><input className={inputClass} value={docForm.documentName} onChange={(e) => setDocForm({ ...docForm, documentName: e.target.value })} placeholder="e.g. ACORD Form 2025" /></div>
              <div><label className="mb-1 block text-xs font-medium text-gray-600">Customer name</label><input className={inputClass} value={docForm.customerName} onChange={(e) => setDocForm({ ...docForm, customerName: e.target.value })} placeholder="e.g. John Smith" /></div>
              <div><label className="mb-1 block text-xs font-medium text-gray-600">Job address</label><input className={inputClass} value={docForm.jobAddress} onChange={(e) => setDocForm({ ...docForm, jobAddress: e.target.value })} placeholder="e.g. 123 Main St, Phoenix AZ" /></div>
              <div><label className="mb-1 block text-xs font-medium text-gray-600">Created by</label><input className={inputClass} value={docForm.createdBy} onChange={(e) => setDocForm({ ...docForm, createdBy: e.target.value })} placeholder="Your name" /></div>
            </div>
            <div className="mt-6 flex justify-end gap-2"><button onClick={() => setCreateDocOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button><button onClick={handleCreateDoc} disabled={!docForm.documentName.trim() || !docFile || docUploading} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">Create</button></div>
          </div>
        </div>
      )}

      {createTplOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCreateTplOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-gray-900">Create Template</h2><button onClick={() => setCreateTplOpen(false)} className="rounded-md p-1 text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button></div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Upload PDF file *</label>
                <div className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 ${tplFile ? "border-blue-400 bg-blue-50/30" : "border-dashed border-gray-300 bg-gray-50"} px-4 py-6 transition hover:border-blue-400 hover:bg-blue-50/30`} onClick={() => document.getElementById("tpl-upload")?.click()} onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f, false, true); }}>
                  <Upload className="h-8 w-8 text-gray-400" />
                  {tplFile ? <p className="mt-2 text-sm font-medium text-blue-600">{tplFile.name}</p> : <div className="mt-2 text-center"><p className="text-sm font-medium text-gray-600">Click or drag & drop PDF</p><p className="text-xs text-gray-400">Max 5 MB</p></div>}
                  <input id="tpl-upload" type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f, false, true); e.target.value = ""; }} />
                </div>
                {tplUploading && <p className="mt-1 text-xs text-blue-600">Uploading...</p>}
              </div>
              <div><label className="mb-1 block text-xs font-medium text-gray-600">Template name *</label><input className={inputClass} value={tplForm.name} onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })} placeholder="e.g. Standard Roofing Contract" /></div>
              <div><label className="mb-1 block text-xs font-medium text-gray-600">Description</label><textarea className={inputClass} rows={3} value={tplForm.description} onChange={(e) => setTplForm({ ...tplForm, description: e.target.value })} placeholder="Describe this template..." /></div>
              <div><label className="mb-1 block text-xs font-medium text-gray-600">Created by</label><input className={inputClass} value={tplForm.createdBy} onChange={(e) => setTplForm({ ...tplForm, createdBy: e.target.value })} placeholder="Your name" /></div>
            </div>
            <div className="mt-6 flex justify-end gap-2"><button onClick={() => setCreateTplOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button><button onClick={handleCreateTemplate} disabled={!tplForm.name.trim() || !tplFile || tplUploading} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">Create</button></div>
          </div>
        </div>
      )}

      {sendDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSendDoc(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-gray-900">Send {sendDoc.title}</h2><button onClick={() => setSendDoc(null)} className="rounded-md p-1 text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button></div>
            <div className="mt-4 space-y-3">
              <div><label className="mb-1 block text-xs font-medium text-gray-600">Recipient name</label><input className={inputClass} value={sendForm.name} onChange={(e) => setSendForm({ ...sendForm, name: e.target.value })} placeholder="e.g. John Smith" /></div>
              <div><label className="mb-1 block text-xs font-medium text-gray-600">Email</label><input className={inputClass} type="email" value={sendForm.email} onChange={(e) => setSendForm({ ...sendForm, email: e.target.value })} placeholder="john@example.com" /></div>
              <div><label className="mb-1 block text-xs font-medium text-gray-600">Phone</label><input className={inputClass} value={sendForm.phone} onChange={(e) => setSendForm({ ...sendForm, phone: e.target.value })} placeholder="(623) 555-1234" /></div>
            </div>
            <div className="mt-6 flex justify-end gap-2"><button onClick={() => setSendDoc(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button><button onClick={handleSendDoc} disabled={sendBusy || (!sendForm.email.trim() && !sendForm.phone.trim())} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">{sendBusy ? "Sending..." : "Send link"}</button></div>
          </div>
        </div>
      )}

      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPreviewDoc(null)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-gray-900">{previewDoc.title}</h2><button onClick={() => setPreviewDoc(null)} className="rounded-md p-1 text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button></div>
            <div className="mt-4 space-y-3">
              <div className="rounded-lg bg-gray-50 p-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-gray-500">Status:</span> <span className={`ml-1 font-semibold ${statusColors[previewDoc.status].text}`}>{previewDoc.status}</span></div>
                  <div><span className="text-gray-500">Created:</span> <span className="ml-1 font-medium text-gray-900">{formatShortDate(previewDoc.dateCreated)}</span></div>
                  <div className="col-span-2"><span className="text-gray-500">Customer:</span> <span className="ml-1 font-medium text-gray-900">{previewDoc.customerName}</span></div>
                  <div className="col-span-2"><span className="text-gray-500">Address:</span> <span className="ml-1 font-medium text-gray-900">{previewDoc.jobAddress}</span></div>
                  {previewDoc.signedBy && <div className="col-span-2"><span className="text-gray-500">Signed by:</span> <span className="ml-1 font-medium text-green-700">{previewDoc.signedBy}</span> on {previewDoc.signedAt ? formatShortDate(previewDoc.signedAt) : ""}</div>}
                </div>
              </div>
              {(previewDoc.signedPdfUrl || previewDoc.originalPdfUrl) ? (
                <div className="overflow-hidden rounded-lg border border-gray-200"><iframe src={previewDoc.signedPdfUrl || previewDoc.originalPdfUrl} title={previewDoc.title} className="h-[400px] w-full" /></div>
              ) : <div className="flex h-48 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50"><p className="text-sm text-gray-400">No PDF available</p></div>}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              {(previewDoc.signedPdfUrl || previewDoc.originalPdfUrl) && <button onClick={() => handleDownload(previewDoc)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><Download className="h-4 w-4" /> Download</button>}
              {previewDoc.status !== "Completed" && previewDoc.status !== "Voided" && <button onClick={() => { setSigningDoc(previewDoc); setPreviewDoc(null); }} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"><FileSignature className="h-4 w-4" /> Sign now</button>}
              <button onClick={() => setPreviewDoc(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Close</button>
            </div>
          </div>
        </div>
      )}

      {signingDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSigningDoc(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-gray-900">Sign: {signingDoc.title}</h2><button onClick={() => setSigningDoc(null)} className="rounded-md p-1 text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button></div>
            {signBusy ? <p className="py-4 text-center text-sm text-gray-500">Processing signature...</p> : <div className="mt-4"><SignaturePad onSave={handleSignDoc} onCancel={() => setSigningDoc(null)} /></div>}
          </div>
        </div>
      )}

      {fieldEditorDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setFieldEditorDoc(null)}>
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-gray-900">Edit fields: {fieldEditorDoc.title}</h2><button onClick={() => setFieldEditorDoc(null)} className="rounded-md p-1 text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button></div>
            <div className="mt-4 space-y-3">
              {fieldEditorFields.length === 0 && <p className="text-sm text-gray-500">No fields. Add a signature or text field below.</p>}
              {fieldEditorFields.map((field, i) => (
                <div key={field.id} className="grid gap-2 rounded border border-gray-200 p-3 text-sm sm:grid-cols-12">
                  <div className="sm:col-span-2"><label className="text-xs text-gray-500">Type</label><select value={field.type} onChange={(e) => updateField(i, { type: e.target.value as FieldType })} className={inputClass}>{fieldTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
                  <div className="sm:col-span-3"><label className="text-xs text-gray-500">Label</label><input className={inputClass} value={field.label || ""} onChange={(e) => updateField(i, { label: e.target.value })} /></div>
                  <div className="sm:col-span-1"><label className="text-xs text-gray-500">Page</label><input type="number" min={0} className={inputClass} value={field.page} onChange={(e) => updateField(i, { page: Number(e.target.value) || 0 })} /></div>
                  <div className="sm:col-span-1"><label className="text-xs text-gray-500">X</label><input type="number" className={inputClass} value={field.x} onChange={(e) => updateField(i, { x: Number(e.target.value) || 0 })} /></div>
                  <div className="sm:col-span-1"><label className="text-xs text-gray-500">Y</label><input type="number" className={inputClass} value={field.y} onChange={(e) => updateField(i, { y: Number(e.target.value) || 0 })} /></div>
                  <div className="sm:col-span-1"><label className="text-xs text-gray-500">W</label><input type="number" className={inputClass} value={field.width || 200} onChange={(e) => updateField(i, { width: Number(e.target.value) || 0 })} /></div>
                  <div className="sm:col-span-1"><label className="text-xs text-gray-500">H</label><input type="number" className={inputClass} value={field.height || 60} onChange={(e) => updateField(i, { height: Number(e.target.value) || 0 })} /></div>
                  <div className="sm:col-span-2"><label className="text-xs text-gray-500">Options</label><input className={inputClass} value={(field.options || []).join(", ")} onChange={(e) => updateField(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="opt1, opt2" /></div>
                  <div className="flex items-end gap-2 sm:col-span-12">
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={field.required} onChange={(e) => updateField(i, { required: e.target.checked })} className="rounded" /> Required</label>
                    <button onClick={() => removeField(i)} className="ml-auto text-xs text-red-600 hover:underline">Remove</button>
                  </div>
                </div>
              ))}
              <button onClick={addField} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">+ Add field</button>
            </div>
            <div className="mt-6 flex justify-end gap-2"><button onClick={() => setFieldEditorDoc(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button><button onClick={saveFieldEditor} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700">Save fields</button></div>
          </div>
        </div>
      )}

      {migrationOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMigrationOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-gray-900">Migrate legacy PDF Signer data</h2><button onClick={() => setMigrationOpen(false)} className="rounded-md p-1 text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button></div>
            <p className="mt-3 text-sm text-gray-600">This will import {migrationStats.documentCount} documents and {migrationStats.templateCount} templates from your browser&apos;s legacy storage into Supabase.</p>
            {migrationBusy ? (
              <div className="mt-4">
                <p className="text-sm text-gray-700">{migrationProgress.item} ({migrationProgress.done} / {migrationProgress.total})</p>
                <div className="mt-2 h-2 w-full rounded-full bg-gray-200"><div className="h-2 rounded-full bg-blue-600 transition-all" style={{ width: `${migrationProgress.total ? (migrationProgress.done / migrationProgress.total) * 100 : 0}%` }} /></div>
              </div>
            ) : (
              <div className="mt-6 flex justify-end gap-2">
                <button onClick={() => setMigrationOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
                <button onClick={handleMigrate} className="rounded-lg bg-amber-600 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-700">Start migration</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
