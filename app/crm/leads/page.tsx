"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Camera, CheckCircle2, CheckSquare, ChevronLeft, ChevronRight, Clock, DollarSign, Download, FileText, Filter, GripVertical, History, Home, Image, Link2, ListChecks, Mail, MapPin, MessageSquare, Mic, Pencil, Phone, Plus, RotateCcw, Save, Search, Square, StickyNote, Tag, Trash2, UploadCloud, User, Users, X } from "lucide-react";
import QuickSmsModal from "@/components/crm/QuickSmsModal";
import LiveCameraCapture from "@/components/LiveCameraCapture";
import { AddressLink } from "@/components/ContactLinks";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { leadStages } from "@/lib/crm-data";
import type { Lead, LeadStage } from "@/types/crm";
import { addJobNote, addJobPhotos, deleteJobPhoto, deleteJobRecord, ensureSeedJobs, leadToJobRecord, loadCrewDataset, loadJobPhotos, migrateStaleDueDates, subscribeToCrewData, updateJobRecord, upsertJobRecord, type JobNote, type JobPhoto } from "@/lib/crew-sync";
import { createClient } from "@/lib/supabase/client";
import { createManualFolder } from "@/lib/manual-folders";
import { compressImageToDataUrl } from "@/lib/image-compress";
import { azDateTime } from "@/lib/arizona-time";
import { ensureInvoiceTaskForJob } from "@/lib/office-tasks";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { findOrCreateCustomer } from "@/lib/customer-sync";
import { jobToBoardPayload, requestCreateEstimate, requestCreateInvoice, requestOpenEstimate, requestOpenInvoice } from "@/lib/crm-board-nav";
import { subscribeToProposalRecords } from "@/lib/proposal-sync";
import { upsertProposalRecord } from "@/lib/proposal-sync";
import { upsertInvoiceRecord } from "@/lib/invoice-sync";
import { getCachedCrewData, getCachedProposals, getCachedInvoices, getCachedCustomers, refreshCrewData, refreshProposals, refreshInvoices, refreshCustomers, CACHE_EVENTS } from "@/lib/data-cache";
import type { Customer } from "@/types/crm";
import { loadJobActivities, logCrewActivity, subscribeToCrewActivities, type CrewActivity } from "@/lib/crew-activity";

type ProposalSnap = { id: string; job?: { id?: string }; status: string; deletedAt?: string };

type InvoiceSnap = {
  id: string;
  jobReference?: string;
  clientName?: string;
  propertyAddress?: string;
  status: string;
  dueDate: string;
  viewedAt?: string;
  sentAt?: string;
  isDeleted?: boolean;
  lineItems: { quantity: number; unitPrice: number; tax: number }[];
  discount: number;
  payments: { amount: number }[];
  activity: string[];
};

function getInvoiceDisplayStatus(inv: InvoiceSnap): string {
  if (inv.status === "Voided") return "Voided";
  if (inv.status === "Draft") return "Draft";
  if (inv.status === "Paid Mail Check") return "Paid";
  const total = inv.lineItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0) +
    inv.lineItems.reduce((s, i) => s + i.quantity * i.unitPrice * (i.tax / 100), 0) - inv.discount;
  const paid = inv.payments.reduce((s, p) => s + p.amount, 0);
  if (paid >= total && total > 0) return "Paid";
  if (paid > 0) return "Partially Paid";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(`${inv.dueDate}T00:00:00`);
  if (due < today) return "Overdue";
  if (inv.viewedAt) return "Viewed";
  if (inv.sentAt) return "Sent";
  return "Draft";
}

const INVOICE_STATUS_STYLES: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-600",
  Sent: "bg-sky-100 text-sky-700",
  Viewed: "bg-amber-100 text-amber-700",
  Overdue: "bg-red-100 text-red-700",
  "Partially Paid": "bg-orange-100 text-orange-700",
  Paid: "bg-emerald-100 text-emerald-700",
  Voided: "bg-gray-100 text-gray-500",
};

function getInvoiceStatusStyle(status: string) {
  return INVOICE_STATUS_STYLES[status] ?? "bg-gray-100 text-gray-600";
}

const PROPOSAL_STATUS_STYLES: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-600",
  Sent: "bg-sky-100 text-sky-700",
  Viewed: "bg-amber-100 text-amber-700",
  Approved: "bg-emerald-100 text-emerald-700",
  Won: "bg-emerald-100 text-emerald-700",
  Signed: "bg-emerald-100 text-emerald-700",
  "Signed Offline": "bg-emerald-100 text-emerald-700",
  Rejected: "bg-red-100 text-red-700",
  Declined: "bg-red-100 text-red-700",
  Expired: "bg-gray-100 text-gray-500",
};

function getProposalStatusStyle(status: string) {
  return PROPOSAL_STATUS_STYLES[status] ?? "bg-gray-100 text-gray-600";
}

function getProposalStatusLabel(status: string) {
  if (status === "Won" || status === "Approved" || status === "Signed" || status === "Signed Offline") return "Won";
  return status;
}

const arizonaBounds = {
  north: 37.0043,
  south: 31.3322,
  east: -109.0452,
  west: -114.8184,
};

const legacyStageMap: Partial<Record<string, LeadStage>> = {
  insurance_review: "waiting_approval",
};

function normalizeJob(job: Lead) {
  const stage = legacyStageMap[job.stage] || job.stage;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDateValid = job.dueDate && new Date(`${job.dueDate}T00:00:00`) >= today ? job.dueDate : undefined;
  return {
    ...job,
    stage,
    nextAction: job.nextAction || job.lastActivity || "Review next step",
    dueDate: dueDateValid,
    originalDueDate: job.dueDate,
  };
}

function formatMoney(value: number) {
  return `$${value.toLocaleString()}`;
}

function formatDueDate(value?: string) {
  if (!value) return "No date";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const LEAD_SOURCES = ["AZR", "Google", "Facebook", "Website", "Referral", "Partner Referral", "Door Knocking", "Yelp", "Angi", "Thumbtack", "Phone Call", "Other"] as const;

const SOURCE_COLORS: Record<string, string> = {
  AZR:           "bg-orange-100 text-orange-700",
  Google:        "bg-blue-100 text-blue-700",
  Facebook:      "bg-blue-100 text-blue-700",
  Website:       "bg-sky-100 text-sky-700",
  Referral:      "bg-blue-100 text-blue-700",
  "Partner Referral": "bg-purple-100 text-purple-700",
  "Door Knocking": "bg-orange-100 text-orange-700",
  Yelp:          "bg-orange-100 text-orange-700",
  Angi:          "bg-orange-100 text-orange-800",
  Thumbtack:     "bg-blue-100 text-blue-700",
  "Phone Call":  "bg-blue-100 text-blue-700",
  Other:         "bg-gray-100 text-gray-600",
};

function getSourceColor(source: string) {
  return SOURCE_COLORS[source] ?? "bg-gray-100 text-gray-600";
}

function getUrgency(job: Lead) {
  if (!job.dueDate || job.stage === "completed" || job.stage === "paid") return { label: "On Track", className: "border-l-blue-500", dot: "bg-blue-500", text: "text-blue-700" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${job.dueDate}T00:00:00`);
  const diffDays = Math.ceil((due.getTime() - today.getTime()) / 86400000);
  if (diffDays >= 0 && diffDays <= 3) return { label: "Due Soon", className: "border-l-orange-400", dot: "bg-orange-400", text: "text-orange-700" };
  return { label: "On Track", className: "border-l-blue-500", dot: "bg-blue-500", text: "text-blue-700" };
}

function parseCallNotes(text: string): Partial<{
  name: string; phone: string; email: string; address: string;
  inspectionDate: string; roofYear: string; callNotes: string;
}> {
  const result: ReturnType<typeof parseCallNotes> = { callNotes: text.trim() };

  // Phone: (602) 555-1234 or 602-555-1234 or 6025551234
  const phoneMatch = text.match(/(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/);
  if (phoneMatch) result.phone = phoneMatch[1].trim();

  // Email
  const emailMatch = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) result.email = emailMatch[0];

  // Roof year: 4-digit year between 1950 and current year, preceded by keywords
  const yearMatch = text.match(/(?:roof(?:ed)?|built|installed|year|since|from)[\s:]+(?:in\s+)?((?:19|20)\d{2})/i)
    || text.match(/\b((?:19|20)\d{2})\b(?=.*(?:roof|built|install|house))/i);
  if (yearMatch) result.roofYear = yearMatch[1];

  // Inspection date: "June 12", "6/12", "June 12th", "next Monday the 15th"
  const dateMatch = text.match(/(?:inspection|appointment|scheduled?|meeting|come\s+out|set\s+for|on)\s+(?:for\s+)?([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i);
  if (dateMatch) result.inspectionDate = dateMatch[1].replace(/(?:st|nd|rd|th)/gi, "").trim();

  // Name: look for "name is X", "this is X", "speaking with X", "customer X", "for X"
  const nameMatch = text.match(/(?:name\s+is|this\s+is|speaking\s+with|customer\s+is|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/)
    || text.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/);
  if (nameMatch) result.name = nameMatch[1].trim();

  // Address: look for street number + street name
  const addressMatch = text.match(/(\d+\s+[A-Za-z0-9 .,'#-]+(?:St(?:reet)?|Ave(?:nue)?|Blvd|Rd|Road|Dr(?:ive)?|Ln|Lane|Ct|Court|Way|Pl(?:ace)?|Loop|Circle|Cir|Trail|Trl)[.\s,]+(?:[A-Za-z ]+,?\s*AZ)?(?:\s*\d{5})?)/i);
  if (addressMatch) result.address = addressMatch[1].trim();

  return result;
}

function getCityFromAddress(address: string) {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : "Phoenix";
}

// Auto-create/update the shared customer for a new job/lead. Uses the central
// find-or-create helper (match by phone -> email -> address, no duplicates) so
// the customer lands on the Customer board across every device. Placeholder
// contact defaults are passed through as blanks to avoid false matches.
function syncCustomerFromJob(contact: { name: string; email?: string; phone?: string; address?: string; city?: string; roofType?: string; value?: number; source?: string }) {
  const address = contact.address || "";
  const propertyAddress = `${address}${contact.city && address && !address.includes(contact.city) ? `, ${contact.city}, AZ` : ""}`;
  void findOrCreateCustomer({
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    propertyAddress,
    roofDetails: contact.roofType,
    status: "New lead",
    lifetimeValue: contact.value,
    source: contact.source,
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Photo Lightbox with draw/annotate
// ---------------------------------------------------------------------------

type DrawPath = { points: { x: number; y: number }[]; color: string; width: number };

function PhotoLightbox({ photos, initialIndex, onClose, onSaveAnnotated, onDelete }: {
  photos: JobPhoto[];
  initialIndex: number;
  onClose: () => void;
  onSaveAnnotated: (dataUrl: string, name: string, photoType: JobPhoto["photoType"]) => void;
  onDelete: (photoId: string) => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [drawColor, setDrawColor] = useState("#ef4444");
  const [drawWidth, setDrawWidth] = useState(3);
  const [paths, setPaths] = useState<DrawPath[]>([]);
  const [currentPath, setCurrentPath] = useState<DrawPath | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const photo = photos[index];
  const hasPrev = index > 0;
  const hasNext = index < photos.length - 1;

  const drawColors = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#ffffff", "#000000"];

  useEffect(() => { setPaths([]); setCurrentPath(null); setDrawMode(false); }, [index]); // eslint-disable-line react-hooks/set-state-in-effect

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && hasPrev) setIndex((i) => i - 1);
      if (e.key === "ArrowRight" && hasNext) setIndex((i) => i + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasPrev, hasNext, onClose]);

  function redrawCanvas() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const path of paths) {
      if (path.points.length < 2) continue;
      ctx.strokeStyle = path.color;
      ctx.lineWidth = path.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(path.points[0].x, path.points[0].y);
      for (let i = 1; i < path.points.length; i++) ctx.lineTo(path.points[i].x, path.points[i].y);
      ctx.stroke();
    }
  }

  useEffect(() => { redrawCanvas(); });

  function getCanvasPoint(e: React.MouseEvent | React.TouchEvent): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0]?.clientX ?? 0 : e.clientX;
    const clientY = "touches" in e ? e.touches[0]?.clientY ?? 0 : e.clientY;
    return { x: ((clientX - rect.left) / rect.width) * canvas.width, y: ((clientY - rect.top) / rect.height) * canvas.height };
  }

  function handlePointerDown(e: React.MouseEvent | React.TouchEvent) {
    if (!drawMode) return;
    const pt = getCanvasPoint(e);
    if (!pt) return;
    setIsDrawing(true);
    setCurrentPath({ points: [pt], color: drawColor, width: drawWidth });
  }

  function handlePointerMove(e: React.MouseEvent | React.TouchEvent) {
    if (!isDrawing || !currentPath) return;
    const pt = getCanvasPoint(e);
    if (!pt) return;
    setCurrentPath({ ...currentPath, points: [...currentPath.points, pt] });
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    redrawCanvas();
    ctx.strokeStyle = currentPath.color;
    ctx.lineWidth = currentPath.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(currentPath.points[0].x, currentPath.points[0].y);
    for (const p of currentPath.points) ctx.lineTo(p.x, p.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  }

  function handlePointerUp() {
    if (!isDrawing || !currentPath) return;
    setIsDrawing(false);
    if (currentPath.points.length > 1) setPaths((prev) => [...prev, currentPath]);
    setCurrentPath(null);
  }

  function handleSave() {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const offscreen = document.createElement("canvas");
    offscreen.width = img.naturalWidth;
    offscreen.height = img.naturalHeight;
    const ctx = offscreen.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    const scaleX = img.naturalWidth / canvas.width;
    const scaleY = img.naturalHeight / canvas.height;
    for (const path of paths) {
      if (path.points.length < 2) continue;
      ctx.strokeStyle = path.color;
      ctx.lineWidth = path.width * Math.max(scaleX, scaleY);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(path.points[0].x * scaleX, path.points[0].y * scaleY);
      for (let i = 1; i < path.points.length; i++) ctx.lineTo(path.points[i].x * scaleX, path.points[i].y * scaleY);
      ctx.stroke();
    }
    const dataUrl = offscreen.toDataURL("image/jpeg", 0.92);
    onSaveAnnotated(dataUrl, `annotated-${photo.name}`, photo.photoType);
    setPaths([]);
    setDrawMode(false);
  }

  function handleImageLoad() {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const container = canvas.parentElement;
    if (!container) return;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
  }

  function handleDelete() {
    if (!window.confirm("Delete this photo?")) return;
    const id = photo.id;
    if (photos.length <= 1) { onDelete(id); onClose(); return; }
    if (index >= photos.length - 1) setIndex((i) => i - 1);
    onDelete(id);
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-gray-950/80 p-2 sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="relative flex max-h-[95vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl sm:max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 sm:px-4 sm:py-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500">{index + 1} / {photos.length}</span>
            <span className="text-sm font-semibold text-gray-700 truncate max-w-[120px] sm:max-w-[200px]">{photo.name}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${photo.photoType === "Before" ? "bg-blue-100 text-blue-700" : photo.photoType === "Progress" ? "bg-orange-100 text-orange-700" : photo.photoType === "After" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>{photo.photoType}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => setDrawMode((v) => !v)} className={`rounded-lg p-2 transition ${drawMode ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-100"}`} title="Draw / Annotate"><Pencil className="h-4 w-4" /></button>
            <a href={photo.dataUrl} download={photo.name} className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100" title="Download"><Download className="h-4 w-4" /></a>
            <button type="button" onClick={handleDelete} className="rounded-lg p-2 text-red-400 transition hover:bg-red-50 hover:text-red-600" title="Delete photo"><Trash2 className="h-4 w-4" /></button>
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100"><X className="h-5 w-5" /></button>
          </div>
        </div>

        {/* Draw toolbar — stacks vertically on mobile */}
        {drawMode && (
          <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 sm:px-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-gray-500">Color:</span>
              {drawColors.map((c) => <button key={c} type="button" onClick={() => setDrawColor(c)} className={`h-6 w-6 rounded-full border-2 transition ${drawColor === c ? "border-gray-900 scale-110" : "border-gray-300"}`} style={{ backgroundColor: c }} />)}
              <span className="text-xs font-bold text-gray-500 sm:ml-2">Size:</span>
              <input type="range" min={1} max={10} value={drawWidth} onChange={(e) => setDrawWidth(Number(e.target.value))} className="w-16 sm:w-20" />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={() => setPaths((prev) => prev.slice(0, -1))} disabled={paths.length === 0} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-100 disabled:opacity-40"><RotateCcw className="mr-1 inline h-3 w-3" />Undo</button>
              <button type="button" onClick={handleSave} disabled={paths.length === 0} className="flex-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-blue-700 disabled:opacity-40 sm:flex-none"><Save className="mr-1 inline h-3 w-3" />Save annotated</button>
            </div>
          </div>
        )}

        {/* Image + canvas */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-gray-100 p-2">
          {hasPrev && <button type="button" onClick={() => setIndex((i) => i - 1)} className="absolute left-2 z-10 rounded-full bg-white/90 p-2 text-gray-700 shadow transition hover:bg-white"><ChevronLeft className="h-5 w-5" /></button>}
          {hasNext && <button type="button" onClick={() => setIndex((i) => i + 1)} className="absolute right-2 z-10 rounded-full bg-white/90 p-2 text-gray-700 shadow transition hover:bg-white"><ChevronRight className="h-5 w-5" /></button>}
          <div className="relative max-h-[70vh] max-w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={imgRef} src={photo.dataUrl} alt={photo.name} className="max-h-[70vh] max-w-full rounded-lg object-contain" onLoad={handleImageLoad} />
            <canvas
              ref={canvasRef}
              className={`absolute inset-0 h-full w-full rounded-lg ${drawMode ? "cursor-crosshair" : "pointer-events-none"}`}
              onMouseDown={handlePointerDown}
              onMouseMove={handlePointerMove}
              onMouseUp={handlePointerUp}
              onMouseLeave={handlePointerUp}
              onTouchStart={handlePointerDown}
              onTouchMove={handlePointerMove}
              onTouchEnd={handlePointerUp}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LeadsPage() {
  const [jobs, setJobs] = useState<Lead[]>(() => (getCachedCrewData()?.jobs ?? []).map(normalizeJob));
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draggedJobId, setDraggedJobId] = useState<string | null>(null);
  const [liveCamera, setLiveCamera] = useState<{ jobId: string; type: "Before" | "Progress" | "After" } | null>(null);
  const [lightbox, setLightbox] = useState<{ photos: JobPhoto[]; index: number } | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [proposalStatusMap, setProposalStatusMap] = useState<Record<string, string>>({});
  const [invoiceStatusMap, setInvoiceStatusMap] = useState<Record<string, string>>({});

  const [jobFiles, setJobFiles] = useState<JobPhoto[]>([]);
  const [jobNotes, setJobNotes] = useState<JobNote[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [currentUserName, setCurrentUserName] = useState("Office");
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [jobActivities, setJobActivities] = useState<CrewActivity[]>([]);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [photoChecklist, setPhotoChecklist] = useState<Record<string, boolean>>({});
  const [noteToast, setNoteToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const pendingUpdatesRef = useRef<Record<string, Partial<Lead>>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showCallPaste, setShowCallPaste] = useState(false);
  const [callPasteText, setCallPasteText] = useState("");
  const [smsTarget, setSmsTarget] = useState<{ phone: string; name?: string } | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    roofType: "",
    source: "Website",
    assignedTo: "Office Coordinator",
    value: "",
    lastActivity: "New job created",
    nextAction: "Schedule inspection",
    dueDate: "",
    inspectionDate: "",
    roofYear: "",
    callNotes: "",
  });

  // Client identification: suggest existing customers as user types name
  const [customerSuggestions, setCustomerSuggestions] = useState<Customer[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Link-document picker state for job card
  const [showLinkPicker, setShowLinkPicker] = useState<"proposal" | "invoice" | null>(null);

  const PHOTO_CHECKLIST_ITEMS = [
    "Front of house",
    "Roof overview (full)",
    "Gutters & downspouts",
    "Damage close-up",
    "Ridge & hip",
    "Flashing & vents",
    "Skylights / chimney",
    "Inside attic (if applicable)",
    "Neighbor fence / property line",
    "Street view",
  ];

  const selectedJob = jobs.find((job) => job.id === selectedJobId) || null;
  const beforePhotos = jobFiles.filter((f) => f.photoType === "Before");
  const progressPhotos = jobFiles.filter((f) => f.photoType === "Progress");
  const afterPhotos = jobFiles.filter((f) => f.photoType === "After");
  const otherPhotos = jobFiles.filter((f) => f.photoType === "Job Photo");
  const checklistDone = PHOTO_CHECKLIST_ITEMS.filter((item) => photoChecklist[item]).length;

  const jobCardHashRef = useRef(false);

  const closeJobCard = useCallback(() => {
    flushPendingUpdates();
    setSelectedJobId(null);
    setShowLinkPicker(null);
    jobCardHashRef.current = false;
    const url = new URL(window.location.href);
    url.searchParams.delete("job");
    url.hash = "";
    history.replaceState(history.state, "", url.pathname + url.search);
  }, []);

  function openJobCard(jobId: string) {
    setSelectedJobId(jobId);
    window.location.hash = "#card";
    jobCardHashRef.current = true;
  }

  useEffect(() => {
    function handleHashChange() {
      if (jobCardHashRef.current && !window.location.hash.includes("card")) {
        closeJobCard();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeJobCard();
    }
    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeJobCard]);

  // Flush pending debounced saves on unmount
  useEffect(() => {
    return () => { flushPendingUpdates(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select a job when navigated from global search with ?job=<id>
  useEffect(() => {
    const jobId = searchParams.get("job");
    if (jobId && jobs.length > 0 && !selectedJobId) {
      const match = jobs.find((j) => j.id === jobId);
      if (match) {
        setSelectedJobId(match.id);
        window.location.hash = "#card";
        jobCardHashRef.current = true;
      }
    }
  }, [searchParams, jobs, selectedJobId]);

  // Resolve the current user's display name for note attribution.
  useEffect(() => {
    createClient().auth.getSession().then(({ data }) => {
      if (!data.session) return;
      const meta = data.session.user.user_metadata;
      const name = (meta?.full_name || meta?.name || data.session.user.email?.split("@")[0] || "Office") as string;
      setCurrentUserName(name);
    }).catch(() => {});
  }, []);

  // Ensure customer data is loaded for client identification suggestions
  useEffect(() => {
    void refreshCustomers().catch(() => {});
  }, []);

  // Search existing customers as user types in the name field
  function handleNameChange(value: string) {
    setForm((prev) => ({ ...prev, name: value }));
    if (value.trim().length < 2) {
      setCustomerSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const customers = getCachedCustomers<Customer>() ?? [];
    const query = value.toLowerCase().trim();
    const matches = customers.filter((c) => {
      if (!c.name) return false;
      return c.name.toLowerCase().includes(query) ||
        (c.phone && c.phone.includes(query)) ||
        (c.email && c.email.toLowerCase().includes(query)) ||
        (c.propertyAddress && c.propertyAddress.toLowerCase().includes(query));
    }).slice(0, 5);
    setCustomerSuggestions(matches);
    setShowSuggestions(matches.length > 0);
  }

  function selectCustomer(customer: Customer) {
    const address = customer.propertyAddress?.split(",")[0]?.trim() || "";
    setForm((prev) => ({
      ...prev,
      name: customer.name,
      email: customer.email || prev.email,
      phone: customer.phone || prev.phone,
      address: address || prev.address,
      roofType: customer.roofDetails || prev.roofType,
    }));
    setShowSuggestions(false);
    setCustomerSuggestions([]);
  }

  // Close suggestions when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Load the selected job's saved files (photos + documents) from the shared
  // crew store so they show on the card and stay in sync with the Files board.
  useEffect(() => {
    if (!selectedJobId) {
      setJobFiles([]);
      setJobNotes([]);
      setJobActivities([]);
      setNoteDraft("");
      setActivityOpen(false);
      setChecklistOpen(false);
      setPhotoChecklist({});
      setFileError(null);
      return;
    }
    let mounted = true;
    void loadJobPhotos(selectedJobId).then((photos) => { if (mounted) setJobFiles(photos); }).catch(() => {});
    void loadJobActivities(selectedJobId).then((acts) => { if (mounted) setJobActivities(acts); }).catch(() => {});
    return () => { mounted = false; };
  }, [selectedJobId]);

  // Subscribe to real-time crew activity updates
  useEffect(() => {
    const unsub = subscribeToCrewActivities(() => {
      if (selectedJobId) void loadJobActivities(selectedJobId).then(setJobActivities).catch(() => {});
    });
    return unsub;
  }, [selectedJobId]);

  // Capture/upload saves instantly — no forced markup step. Drawings and notes
  // can be added later per-photo from the job's Files folder.
  async function handleJobFileUpload(photoType: "Before" | "Progress" | "After" | "Job Photo", files: FileList | null) {
    if (!selectedJob || !files?.length) return;
    setFileBusy(true);
    setFileError(null);
    try {
      const selected = Array.from(files);
      const dataUrls = await Promise.all(selected.map((file) => compressImageToDataUrl(file)));
      await addJobPhotos(selectedJob.id, selected.map((file, index) => ({
        photoType,
        name: file.name || `photo-${Date.now()}-${index + 1}.jpg`,
        dataUrl: dataUrls[index],
        uploadedBy: "Office",
      })));
      const refreshed = await loadJobPhotos(selectedJob.id);
      setJobFiles(refreshed);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Failed to save file.");
    } finally {
      setFileBusy(false);
    }
  }

  async function handleAddJobNote() {
    if (!selectedJob || !noteDraft.trim()) return;
    const body = noteDraft.trim();
    setNoteDraft("");
    setNoteToast(null);
    try {
      await addJobNote(selectedJob.id, currentUserName, body);
      const data = await loadCrewDataset();
      setJobNotes(data.notes);
      setNoteToast({ type: "success", message: "Note saved" });
      setTimeout(() => setNoteToast(null), 3000);
      void logCrewActivity({
        jobId: selectedJob.id,
        jobName: selectedJob.name,
        actor: currentUserName || "Office",
        action: "Note added",
        details: body.length > 120 ? body.slice(0, 120) + "…" : body,
        module: "Notes",
      }).catch(() => {});
    } catch {
      setNoteDraft(body);
      setNoteToast({ type: "error", message: "Failed to save note" });
      setTimeout(() => setNoteToast(null), 5000);
    }
  }

  function openBoardFromJob(path: string) {
    if (typeof window !== "undefined") window.sessionStorage.setItem("crm-return-to-jobs", "1");
    router.push(path);
  }

  function readStored<T>(key: string): T[] {
    try {
      return JSON.parse(window.localStorage.getItem(key) || "[]") as T[];
    } catch {
      return [];
    }
  }

  // One-click from a Job to its Estimate editor: open the linked estimate if one
  // exists, otherwise create one from the job and open it (linked by job id).
  // Prefers the shared data cache (synced across devices) over localStorage.
  function openEstimateForJob(job: Lead) {
    const cached = getCachedProposals<{ id: string; job?: { id?: string } }>();
    const proposals = cached ?? readStored<{ id: string; job?: { id?: string } }>("xrp-crm-proposals");
    const existing = proposals.find((proposal) => proposal?.job?.id === job.id);
    if (existing) requestOpenEstimate(existing.id);
    else requestCreateEstimate(jobToBoardPayload(job));
    openBoardFromJob("/crm/proposals");
  }

  // One-click from a Job to its Invoice editor: open the linked invoice if one
  // exists, otherwise create one from the job and open it (linked by jobReference).
  // Prefers the shared data cache (synced across devices) over localStorage.
  function openInvoiceForJob(job: Lead) {
    const cached = getCachedInvoices<{ id: string; jobReference?: string }>();
    const invoices = cached ?? readStored<{ id: string; jobReference?: string }>("xrp-crm-invoices");
    const existing = invoices.find((invoice) => invoice?.jobReference === job.id);
    if (existing) requestOpenInvoice(existing.id);
    else requestCreateInvoice(jobToBoardPayload(job));
    openBoardFromJob("/crm/invoices");
  }

  // Get linked proposals for a job
  function getLinkedProposals(jobId: string): ProposalSnap[] {
    const cached = getCachedProposals<ProposalSnap>();
    const proposals = cached ?? [];
    return proposals.filter((p) => p.job?.id === jobId && !p.deletedAt);
  }

  // Get linked invoices for a job
  function getLinkedInvoices(jobId: string): InvoiceSnap[] {
    const cached = getCachedInvoices<InvoiceSnap>();
    const invoices = cached ?? [];
    return invoices.filter((inv) => inv.jobReference === jobId && !inv.isDeleted);
  }

  // Get unlinked proposals (not connected to any job)
  function getUnlinkedProposals(): (ProposalSnap & { customerName?: string; address?: string; total?: number })[] {
    const cached = getCachedProposals<ProposalSnap & { customerName?: string; address?: string; total?: number }>();
    const proposals = cached ?? [];
    return proposals.filter((p) => !p.job?.id && !p.deletedAt);
  }

  // Get unlinked invoices (not connected to any job)
  function getUnlinkedInvoices(): InvoiceSnap[] {
    const cached = getCachedInvoices<InvoiceSnap>();
    const invoices = cached ?? [];
    return invoices.filter((inv) => !inv.jobReference && !inv.isDeleted);
  }

  // Link a proposal to the selected job
  function linkProposalToJob(proposalId: string, jobId: string) {
    const cached = getCachedProposals<ProposalSnap & Record<string, unknown>>();
    const proposal = cached?.find((p) => p.id === proposalId);
    if (!proposal) return;
    const updated = { ...proposal, job: { id: jobId } };
    void upsertProposalRecord(updated as { id: string } & Record<string, unknown>).catch(() => {});
    setProposalStatusMap((prev) => ({ ...prev, [jobId]: proposal.status }));
    setShowLinkPicker(null);
    void refreshProposals<ProposalSnap>().then((proposals) => {
      const map: Record<string, string> = {};
      for (const p of proposals) {
        if (!p.deletedAt && p.job?.id) map[p.job.id] = p.status;
      }
      setProposalStatusMap(map);
    }).catch(() => {});
  }

  // Link an invoice to the selected job
  function linkInvoiceToJob(invoiceId: string, jobId: string) {
    const cached = getCachedInvoices<InvoiceSnap & Record<string, unknown>>();
    const invoice = cached?.find((inv) => inv.id === invoiceId);
    if (!invoice) return;
    const updated = { ...invoice, jobReference: jobId };
    void upsertInvoiceRecord(updated as { id: string } & Record<string, unknown>).catch(() => {});
    const status = getInvoiceDisplayStatus(invoice);
    setInvoiceStatusMap((prev) => ({ ...prev, [jobId]: status }));
    setShowLinkPicker(null);
    void refreshInvoices<InvoiceSnap>().catch(() => {});
  }

  const filteredJobs = useMemo(() => {
    const query = search.toLowerCase().trim();

    const sourceFiltered = sourceFilter ? jobs.filter((job) => job.source === sourceFilter) : jobs;
    if (!query) return sourceFiltered;

    const queryDigits = query.replace(/\D/g, "");
    const queryPhone = queryDigits.length === 11 && queryDigits.startsWith("1") ? queryDigits.slice(1) : queryDigits;

    return sourceFiltered.filter((job) => {
      const textMatch = [job.name, job.email, job.phone, job.address, job.city, job.roofType, job.source, job.assignedTo, job.lastActivity, job.nextAction || ""]
        .some((value) => value.toLowerCase().includes(query));
      if (textMatch) return true;
      if (queryPhone.length >= 2 && job.phone) {
        const jobDigits = job.phone.replace(/\D/g, "");
        const jobPhone = jobDigits.length === 11 && jobDigits.startsWith("1") ? jobDigits.slice(1) : jobDigits;
        if (jobPhone.includes(queryPhone)) return true;
      }
      return false;
    });
  }, [jobs, search, sourceFilter]);

  const dashboardMetrics = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const weekEnd = new Date(now);
    weekEnd.setDate(now.getDate() + 7);
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    return [
      { label: "Due Soon", value: filteredJobs.filter((job) => getUrgency(job).label === "Due Soon").length, tone: "text-orange-700 bg-orange-50 border-orange-100" },
      { label: "Waiting Approval", value: filteredJobs.filter((job) => job.stage === "waiting_approval").length, tone: "text-orange-700 bg-orange-50 border-orange-100" },
      { label: "Scheduled This Week", value: filteredJobs.filter((job) => {
        if (!job.dueDate || job.stage !== "scheduled") return false;
        const due = new Date(`${job.dueDate}T00:00:00`);
        return due >= now && due <= weekEnd;
      }).length, tone: "text-blue-700 bg-blue-50 border-blue-100" },
      { label: "Active Jobs", value: filteredJobs.filter((job) => !["completed", "paid"].includes(job.stage)).length, tone: "text-blue-700 bg-blue-50 border-blue-100" },
      { label: "Completed This Month", value: filteredJobs.filter((job) => {
        if (!["completed", "paid"].includes(job.stage)) return false;
        const dateStr = (job as Lead & { originalDueDate?: string }).originalDueDate;
        if (!dateStr) return false;
        const due = new Date(`${dateStr}T00:00:00`);
        return due.getMonth() === currentMonth && due.getFullYear() === currentYear;
      }).length, tone: "text-gray-700 bg-white border-gray-200" },
    ];
  }, [filteredJobs]);

  const sourceMetrics = useMemo(() => {
    return LEAD_SOURCES.map((src) => {
      const srcJobs = jobs.filter((j) => j.source === src);
      const closed = srcJobs.filter((j) => ["completed", "paid"].includes(j.stage));
      const revenue = closed.reduce((t, j) => t + j.value, 0);
      const conversion = srcJobs.length > 0 ? Math.round((closed.length / srcJobs.length) * 100) : 0;
      return { src, total: srcJobs.length, closed: closed.length, revenue, conversion };
    }).filter((m) => m.total > 0);
  }, [jobs]);

  useEffect(() => {
    migrateStaleDueDates();
    let mounted = true;

    // Show cached data instantly, then refresh in background
    const cached = getCachedCrewData();
    if (cached) {
      setJobs(cached.jobs.map(normalizeJob));
      setJobNotes(cached.notes);
    }

    async function loadJobs() {
      try {
        const data = await refreshCrewData();
        const seededJobs = await ensureSeedJobs(data.jobs);
        if (mounted) {
          setJobs(seededJobs.map(normalizeJob));
          setJobNotes(data.notes);
        }
      } catch {
        /* leave jobs empty when the shared store is unavailable */
      }
    }
    loadJobs();

    const unsubscribe = subscribeToCrewData(() => {
      void refreshCrewData().then((data) => {
        if (mounted) {
          setJobs(data.jobs.map(normalizeJob));
          setJobNotes(data.notes);
        }
      }).catch(() => {});
    });
    function onCrewCache() {
      void refreshCrewData().then((data) => {
        if (mounted) { setJobs(data.jobs.map(normalizeJob)); setJobNotes(data.notes); }
      }).catch(() => {});
    }
    window.addEventListener(CACHE_EVENTS.crew, onCrewCache);
    return () => {
      mounted = false;
      unsubscribe();
      window.removeEventListener(CACHE_EVENTS.crew, onCrewCache);
    };
  }, []);

  useAutoRefresh(() => {
    void refreshCrewData().then((data) => {
      setJobs(data.jobs.map(normalizeJob));
      setJobNotes(data.notes);
    }).catch(() => {});
    void refreshProposals<ProposalSnap>().then((proposals) => {
      const map: Record<string, string> = {};
      for (const p of proposals) {
        if (!p.deletedAt && p.job?.id) map[p.job.id] = p.status;
      }
      setProposalStatusMap(map);
    }).catch(() => {});
    void refreshInvoices<InvoiceSnap>().catch(() => {});
  });

  useEffect(() => {
    let mounted = true;
    function buildMap(proposals: ProposalSnap[]) {
      const map: Record<string, string> = {};
      for (const p of proposals) {
        if (!p.deletedAt && p.job?.id) map[p.job.id] = p.status;
      }
      if (mounted) setProposalStatusMap(map);
    }
    void refreshProposals<ProposalSnap>().then(buildMap).catch(() => {});
    const unsub = subscribeToProposalRecords(() => {
      void refreshProposals<ProposalSnap>().then(buildMap).catch(() => {});
    });
    return () => { mounted = false; unsub(); };
  }, []);

  useEffect(() => {
    let mounted = true;
    function buildInvoiceMap(invoices: InvoiceSnap[]) {
      const map: Record<string, string> = {};
      for (const inv of invoices) {
        if (inv.isDeleted) continue;
        const status = getInvoiceDisplayStatus(inv);
        if (inv.jobReference) {
          map[inv.jobReference] = status;
        } else if (inv.clientName) {
          const matched = jobs.find((j) => {
            const nameMatch = j.name.toLowerCase().trim() === inv.clientName!.toLowerCase().trim();
            if (!nameMatch) return false;
            if (inv.propertyAddress && j.address) {
              return inv.propertyAddress.toLowerCase().includes(j.address.toLowerCase());
            }
            return true;
          });
          if (matched) map[matched.id] = status;
        }
      }
      if (mounted) setInvoiceStatusMap(map);
    }
    void refreshInvoices<InvoiceSnap>().then(buildInvoiceMap).catch(() => {});
    function onInvoiceCache() {
      const cached = getCachedInvoices<InvoiceSnap>();
      if (cached && mounted) buildInvoiceMap(cached);
    }
    window.addEventListener(CACHE_EVENTS.invoices, onInvoiceCache);
    return () => { mounted = false; window.removeEventListener(CACHE_EVENTS.invoices, onInvoiceCache); };
  }, [jobs]);

  function flushPendingUpdates() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const pending = pendingUpdatesRef.current;
    pendingUpdatesRef.current = {};
    Object.entries(pending).forEach(([id, patch]) => {
      void updateJobRecord(id, patch).catch(() => {});
      // Log meaningful field updates to activity history
      const job = jobs.find((j) => j.id === id);
      if (job) {
        const fields = Object.keys(patch).filter((k) => k !== "lastActivity");
        if (fields.length > 0) {
          void logCrewActivity({
            jobId: id,
            jobName: job.name || "Unknown Job",
            actor: currentUserName || "Office",
            action: "Job updated",
            details: `Updated: ${fields.join(", ")}`,
            module: "Jobs",
          });
        }
      }
    });
  }

  function updateJob(jobId: string, updates: Partial<Lead>) {
    setJobs((currentJobs) => currentJobs.map((job) => job.id === jobId ? { ...job, ...updates } : job));
    pendingUpdatesRef.current[jobId] = { ...pendingUpdatesRef.current[jobId], ...updates };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushPendingUpdates, 500);
  }

  function updateJobStage(jobId: string, stage: LeadStage) {
    const stageLabel = leadStages.find((item) => item.id === stage)?.label || "workflow";
    updateJob(jobId, { stage, lastActivity: `Moved to ${stageLabel}` });
    const job = jobs.find((item) => item.id === jobId);
    if (job) {
      void logCrewActivity({
        jobId: job.id,
        jobName: job.name,
        actor: currentUserName || "Office",
        action: `Job moved to ${stageLabel}`,
        details: `Stage updated to ${stageLabel}`,
        module: "Jobs",
      }).catch(() => {});
    }
    if (stage === "completed" && job) {
      ensureInvoiceTaskForJob({ id: job.id, name: job.name, address: job.address, city: job.city, value: job.value, jobLink: "/crm/leads" });
    }
  }

  function deleteJob(job: Lead) {
    if (typeof window !== "undefined" && !window.confirm(`Delete "${job.name}"? This permanently removes the job and its photos, notes, and checklist for everyone. This cannot be undone.`)) return;
    const previousJobs = jobs;
    setSelectedJobId(null);
    jobCardHashRef.current = false;
    const url = new URL(window.location.href);
    url.searchParams.delete("job");
    url.hash = "";
    history.replaceState(history.state, "", url.pathname + url.search);
    setJobs((currentJobs) => currentJobs.filter((item) => item.id !== job.id));
    void deleteJobRecord(job.id).catch(() => setJobs(previousJobs));
  }

  function handleAddJob(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const newJob: Lead = {
      id: `J-${Date.now()}`,
      name: form.name,
      email: form.email || "",
      phone: form.phone || "",
      address: form.address || "Address pending",
      city: getCityFromAddress(form.address),
      stage: "new_lead",
      value: Number(form.value) || 0,
      assignedTo: form.assignedTo,
      roofType: form.roofType || "Roofing",
      source: form.source || "Website",
      lastActivity: form.lastActivity || "New job created",
      nextAction: form.nextAction || "Schedule inspection",
      dueDate: form.dueDate,
      inspectionDate: form.inspectionDate || undefined,
      roofYear: form.roofYear || undefined,
      callNotes: form.callNotes || undefined,
    };

    setJobs((currentJobs) => [newJob, ...currentJobs]);
    void upsertJobRecord(leadToJobRecord(newJob)).catch(() => {});
    void logCrewActivity({
      jobId: newJob.id,
      jobName: newJob.name,
      actor: currentUserName || "Office",
      action: "Job created",
      details: `${newJob.address}, ${newJob.city} — ${newJob.roofType}`,
      module: "Jobs",
    }).catch(() => {});

    // Auto-create folder in Files Dashboard for this job
    const folderName = `${form.name} - ${form.address || "Address pending"}`.trim();
    void createManualFolder({
      name: folderName,
      address: form.address || "Address pending",
      customerName: form.name,
      workType: form.roofType || "Roofing",
    }).catch(() => {});

    syncCustomerFromJob({
      name: form.name,
      email: form.email,
      phone: form.phone,
      address: form.address,
      city: getCityFromAddress(form.address),
      roofType: form.roofType,
      value: Number(form.value) || 0,
      source: form.source,
    });
    setForm({
      name: "",
      email: "",
      phone: "",
      address: "",
      roofType: "",
      source: "Website",
      assignedTo: "",
      value: "",
      lastActivity: "New job created",
      nextAction: "Schedule inspection",
      dueDate: "",
      inspectionDate: "",
      roofYear: "",
      callNotes: "",
    });
    setShowCallPaste(false);
    setCallPasteText("");
    setShowForm(false);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 sm:gap-5">
      <div className="sticky top-16 z-20 -mx-3 space-y-1.5 border-b border-gray-200 bg-white/95 px-3 pb-2 pt-1 backdrop-blur-sm sm:-mx-5 sm:space-y-3 sm:px-5 sm:pb-3">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end sm:gap-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900 sm:text-2xl">Jobs Board</h1>
            <p className="crm-board-subtitle mt-1 hidden max-w-3xl text-sm text-gray-500 sm:block">Production tracking: urgency, value, rep, next action, and due date at a glance.</p>
          </div>
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            <button onClick={() => { setSearch(""); setSourceFilter(null); }} className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition hover:border-blue-200 hover:text-blue-700"><Filter className="mr-2 h-4 w-4" />Clear filters</button>
            <button onClick={() => setShowForm(true)} className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-blue-700"><Plus className="mr-2 h-4 w-4" />Add job</button>
          </div>
        </div>

        {/* KPI summary cards hidden for cleaner Kanban focus — logic preserved */}
        <div className="hidden">
          {dashboardMetrics.map((metric) => (
            <div key={metric.label} className={`rounded-lg border px-2 py-1.5 sm:px-4 sm:py-3 ${metric.tone}`}>
              <p className="text-base font-bold leading-none sm:text-2xl">{metric.value}</p>
              <p className="mt-0.5 text-[10px] font-semibold uppercase leading-tight tracking-wide sm:mt-1 sm:text-xs">{metric.label}</p>
            </div>
          ))}
        </div>

        {sourceMetrics.length > 0 && (
          <div className="overflow-x-auto">
            <div className="flex min-w-max items-stretch gap-2">
              <div className="flex shrink-0 items-center gap-1 text-xs font-semibold uppercase tracking-wider text-gray-500"><Tag className="h-3.5 w-3.5" />By Source</div>
              {sourceMetrics.map(({ src, total, closed, revenue, conversion }) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setSourceFilter(sourceFilter === src ? null : src)}
                  className={`flex shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition hover:opacity-80 ${
                    sourceFilter === src ? "bg-blue-600 text-white border-blue-600" : `${getSourceColor(src)} border-transparent`
                  }`}
                >
                  <span>{src}</span>
                  <span className="opacity-70">{total} jobs</span>
                  <span className="opacity-70">${revenue.toLocaleString()}</span>
                  <span className="opacity-70">{conversion}% closed</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-3 backdrop-blur-sm sm:p-4" onClick={() => setShowForm(false)}>
          <form onSubmit={handleAddJob} className="my-auto flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-gray-200 bg-white shadow-lg" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 p-4">
              <h2 className="text-lg font-bold text-gray-900">Add new job</h2>
              <button type="button" onClick={() => setShowForm(false)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-gray-100">

              {/* Add from Call */}
              <div className="p-4">
                <button type="button" onClick={() => setShowCallPaste((v) => !v)} className={`flex w-full items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition ${showCallPaste ? "bg-orange-500 text-white" : "bg-orange-50 text-orange-700 hover:bg-orange-100"}`}>
                  <Mic className="h-4 w-4 shrink-0" />
                  <span>{showCallPaste ? "Hide — type details manually below" : "Add from Call — auto-fill from notes or transcript"}</span>
                </button>
                {showCallPaste && (
                  <div className="mt-3 space-y-3">
                    <textarea
                      value={callPasteText}
                      onChange={(e) => setCallPasteText(e.target.value)}
                      rows={4}
                      autoFocus
                      className="w-full rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:bg-white placeholder:text-gray-400"
                      placeholder={`Paste call notes or transcript — e.g.\n"John Smith, (602) 555-1234, 4521 W Oak St Phoenix AZ, roof from 2008, inspection June 12"`}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!callPasteText.trim()}
                        onClick={() => {
                          const parsed = parseCallNotes(callPasteText);
                          setForm((f) => ({
                            ...f,
                            name: parsed.name || f.name,
                            phone: parsed.phone || f.phone,
                            email: parsed.email || f.email,
                            address: parsed.address || f.address,
                            inspectionDate: parsed.inspectionDate || f.inspectionDate,
                            roofYear: parsed.roofYear || f.roofYear,
                            callNotes: parsed.callNotes || f.callNotes,
                            source: "Phone Call",
                          }));
                          setShowCallPaste(false);
                        }}
                        className="rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-40"
                      >
                        Auto-fill from call
                      </button>
                      <p className="text-xs font-semibold text-gray-500">Review fields below after filling.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Section: Customer Info */}
              <div className="p-4 space-y-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-orange-600"><User className="h-3.5 w-3.5" />Customer Info</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="relative grid gap-1" ref={suggestionsRef}>
                    <span className="text-xs font-bold text-gray-500">Full Name <span className="text-orange-400">*</span></span>
                    <input required value={form.name} onChange={(e) => handleNameChange(e.target.value)} onFocus={() => { if (customerSuggestions.length > 0) setShowSuggestions(true); }} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="e.g. John Smith" autoComplete="off" />
                    {showSuggestions && customerSuggestions.length > 0 && (
                      <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border border-blue-200 bg-white shadow-lg">
                        <p className="border-b border-gray-100 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-blue-600"><Users className="mb-0.5 mr-1 inline h-3 w-3" />Existing Customers</p>
                        {customerSuggestions.map((c) => (
                          <button key={c.id} type="button" onClick={() => selectCustomer(c)} className="flex w-full flex-col gap-0.5 border-b border-gray-50 px-3 py-2 text-left transition hover:bg-blue-50">
                            <span className="text-sm font-bold text-gray-800">{c.name}</span>
                            <span className="text-xs text-gray-500">
                              {[c.propertyAddress, c.phone, c.email].filter(Boolean).join(" · ") || "No contact info"}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <label className="grid gap-1">
                    <span className="text-xs font-bold text-gray-500">Phone Number</span>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <input type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="(602) 555-0123" />
                    </div>
                  </label>
                  <label className="grid gap-1 sm:col-span-2">
                    <span className="text-xs font-bold text-gray-500">Email Address</span>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="customer@email.com" />
                    </div>
                  </label>
                </div>
              </div>

              {/* Section: Property & Job */}
              <div className="p-4 space-y-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-orange-600"><Home className="h-3.5 w-3.5" />Property & Job</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 sm:col-span-2">
                    <span className="text-xs font-bold text-gray-500">Property Address <span className="text-orange-400">*</span></span>
                    <AddressAutocomplete
                      value={form.address}
                      onChange={(address) => setForm({ ...form, address })}
                      placeholder="Start typing address..."
                      required
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-bold text-gray-500">Roof Type</span>
                    <input value={form.roofType} onChange={(e) => setForm({ ...form, roofType: e.target.value })} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="e.g. Tile, Shingle, Flat" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-bold text-gray-500">Year of Roof / House</span>
                    <input value={form.roofYear} onChange={(e) => setForm({ ...form, roofYear: e.target.value })} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="e.g. 2008" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-bold text-gray-500">Estimated Job Value ($)</span>
                    <input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="0" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-bold text-gray-500">Lead Source</span>
                    <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white">
                      {LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-bold text-gray-500">Assigned Rep</span>
                    <input value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="Office Coordinator" />
                  </label>
                </div>
              </div>

              {/* Section: Inspection Appointment */}
              <div className="p-4 space-y-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-orange-600"><CalendarDays className="h-3.5 w-3.5" />Inspection Appointment</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-xs font-bold text-gray-500">Inspection Date</span>
                    <input value={form.inspectionDate} onChange={(e) => setForm({ ...form, inspectionDate: e.target.value })} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="e.g. June 12" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-bold text-gray-500">Due Date</span>
                    <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white" />
                  </label>
                  <label className="grid gap-1 sm:col-span-2">
                    <span className="text-xs font-bold text-gray-500">Next Action</span>
                    <input value={form.nextAction} onChange={(e) => setForm({ ...form, nextAction: e.target.value })} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="e.g. Schedule inspection" />
                  </label>
                  <label className="grid gap-1 sm:col-span-2">
                    <span className="text-xs font-bold text-gray-500">Notes</span>
                    <textarea value={form.lastActivity} onChange={(e) => setForm({ ...form, lastActivity: e.target.value })} rows={2} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white resize-none" placeholder="Any additional notes..." />
                  </label>
                  {form.callNotes && (
                    <label className="grid gap-1 sm:col-span-2">
                      <span className="text-xs font-bold text-gray-500">Call Notes</span>
                      <textarea value={form.callNotes} onChange={(e) => setForm({ ...form, callNotes: e.target.value })} rows={2} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white resize-none" />
                    </label>
                  )}
                </div>
              </div>

            </div>
            <div className="flex items-center justify-between border-t border-gray-200 p-4">
              <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50">Cancel</button>
              <button className="rounded-lg bg-orange-500 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-orange-600">Save Job</button>
            </div>
          </form>
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-11 pr-4 text-sm font-semibold text-gray-700 shadow-sm outline-none transition placeholder:text-gray-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-50 sm:py-3" placeholder="Search customer, city, rep, source, next action..." />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-gray-500"><Tag className="h-3.5 w-3.5" />Source:</span>
          {LEAD_SOURCES.map((src) => {
            const count = jobs.filter((j) => j.source === src).length;
            if (count === 0) return null;
            const active = sourceFilter === src;
            return (
              <button
                key={src}
                type="button"
                onClick={() => setSourceFilter(active ? null : src)}
                className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${active ? "bg-blue-600 text-white" : getSourceColor(src)} hover:opacity-80`}
              >
                {src} <span className="opacity-70">({count})</span>
              </button>
            );
          })}
          {sourceFilter && (
            <button type="button" onClick={() => setSourceFilter(null)} className="flex items-center gap-1 rounded-full bg-gray-200 px-2.5 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-300">
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 flex min-h-0 flex-1 gap-3 overflow-x-auto pb-4">
        {leadStages.map((stage) => {
          const stageJobs = filteredJobs.filter((job) => job.stage === stage.id);
          const stageValue = stageJobs.reduce((total, job) => total + job.value, 0);
          return (
            <section key={stage.id} onDragOver={(event) => event.preventDefault()} onDrop={() => draggedJobId && updateJobStage(draggedJobId, stage.id)} className="flex max-h-[calc(100vh-16rem)] w-[17.5rem] shrink-0 flex-col rounded-lg border border-gray-200 bg-gray-50/90 p-2 shadow-sm">
              <div className="sticky top-0 z-10 mb-1.5 shrink-0 rounded-md border border-gray-200 bg-white/95 px-2.5 py-2 shadow-sm backdrop-blur">
                <div className="flex items-center justify-between gap-1">
                  <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-blue-700">{stage.label}</h2>
                  <span className="shrink-0 text-xs font-medium text-gray-400">{stageJobs.length}</span>
                </div>
                <p className="mt-0.5 text-xs text-gray-500">{formatMoney(stageValue)}</p>
              </div>

              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-0.5 pb-1">
                {stageJobs.map((job) => {
                  const urgency = getUrgency(job);
                  const pStatus = proposalStatusMap[job.id];
                  const iStatus = invoiceStatusMap[job.id];
                  return (
                    <button key={job.id} type="button" draggable onDragStart={() => setDraggedJobId(job.id)} onDragEnd={() => setDraggedJobId(null)} onClick={() => openJobCard(job.id)} className={`group w-full cursor-grab rounded-md border border-l-[3px] bg-white px-2.5 py-2 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md active:cursor-grabbing ${urgency.className}`}>
                      <div className="flex items-center justify-between gap-1">
                        <p className="min-w-0 truncate text-xs font-bold leading-tight text-gray-900">{job.name}</p>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button type="button" onClick={(e) => { e.stopPropagation(); deleteJob(job); }} className="hidden rounded p-0.5 text-gray-300 transition hover:bg-red-50 hover:text-red-500 group-hover:flex" aria-label="Delete job"><Trash2 className="h-3 w-3" /></button>
                          <GripVertical className="h-3.5 w-3.5 text-gray-300" />
                        </div>
                      </div>
                      <p className="mt-0.5 truncate text-xs leading-tight text-gray-500">{job.address}, {job.city}, AZ</p>
                      <div className="mt-1 flex items-center justify-between gap-1">
                        <span className="text-sm font-bold leading-none text-blue-700">{formatMoney(job.value)}</span>
                        <div className="flex shrink-0 items-center gap-1">
                          {pStatus && (
                            <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold leading-none ${getProposalStatusStyle(pStatus)}`}><FileText className="h-3 w-3" />{getProposalStatusLabel(pStatus)}</span>
                          )}
                          {iStatus && (
                            <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold leading-none ${getInvoiceStatusStyle(iStatus)}`}><DollarSign className="h-3 w-3" />{iStatus}</span>
                          )}
                          {!pStatus && !iStatus && urgency.label !== "On Track" && (
                            <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold leading-none ${urgency.text}`}><span className={`h-1.5 w-1.5 rounded-full ${urgency.dot}`} />{urgency.label}</span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {stageJobs.length === 0 && (
                  <div className="rounded-md border border-dashed border-gray-300 bg-white p-4 text-center text-xs font-bold text-gray-400">Drop jobs here</div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {selectedJob && (
        <div className="fixed inset-0 z-[60] flex justify-end bg-black/20 backdrop-blur-sm" onClick={closeJobCard}>
          <aside className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 border-b border-gray-200 bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-orange-600">Job details</p>
                  <h2 className="mt-1 text-xl font-bold text-gray-900 sm:text-2xl">{selectedJob.name}</h2>
                  <p className="text-sm font-bold text-gray-500"><AddressLink value={`${selectedJob.address}, ${selectedJob.city}, AZ`} /></p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => deleteJob(selectedJob)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 transition hover:bg-red-100"><Trash2 className="h-4 w-4" />Delete Job</button>
                  <button type="button" onClick={closeJobCard} className="pointer-events-auto relative rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
                </div>
              </div>
            </div>

            <div className="space-y-5 p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-gray-500">Customer Name<input value={selectedJob.name} onChange={(event) => updateJob(selectedJob.id, { name: event.target.value })} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium normal-case tracking-normal text-gray-900 outline-none" /></label>
                <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-gray-500">City<input value={selectedJob.city} onChange={(event) => updateJob(selectedJob.id, { city: event.target.value })} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium normal-case tracking-normal text-gray-900 outline-none" /></label>
                <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-gray-500">Phone
                  <div className="flex items-center gap-1">
                    <input value={selectedJob.phone} onChange={(event) => updateJob(selectedJob.id, { phone: event.target.value })} className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium normal-case tracking-normal text-gray-900 outline-none" />
                    {selectedJob.phone && <a href={`tel:${selectedJob.phone.replace(/[^\d+]/g, "")}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500 text-white hover:bg-blue-600"><Phone className="h-4 w-4" /></a>}
                    {selectedJob.phone && <button onClick={() => setSmsTarget({ phone: selectedJob.phone, name: selectedJob.name })} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-500 text-white hover:bg-green-600"><MessageSquare className="h-4 w-4" /></button>}
                  </div>
                </label>
                <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-gray-500">Email
                  <div className="flex items-center gap-1">
                    <input type="email" value={selectedJob.email} onChange={(event) => updateJob(selectedJob.id, { email: event.target.value })} className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium normal-case tracking-normal text-gray-900 outline-none" />
                    {selectedJob.email && <a href={`mailto:${selectedJob.email}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500 text-white hover:bg-blue-600"><Mail className="h-4 w-4" /></a>}
                  </div>
                </label>
                <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-gray-500 sm:col-span-2">Address
                  <div className="flex items-center gap-1">
                    <input value={selectedJob.address} onChange={(event) => updateJob(selectedJob.id, { address: event.target.value })} className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium normal-case tracking-normal text-gray-900 outline-none" />
                    {selectedJob.address && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selectedJob.address}, ${selectedJob.city}, AZ`)}`} target="_blank" rel="noopener noreferrer" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500 text-white hover:bg-blue-600"><MapPin className="h-4 w-4" /></a>}
                  </div>
                </label>
                <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-gray-500">Inspection Date<input value={selectedJob.inspectionDate || ""} onChange={(event) => updateJob(selectedJob.id, { inspectionDate: event.target.value })} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium normal-case tracking-normal text-gray-900 outline-none" placeholder="e.g. June 12" /></label>
                <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-gray-500">Year of Roof / House<input value={selectedJob.roofYear || ""} onChange={(event) => updateJob(selectedJob.id, { roofYear: event.target.value })} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium normal-case tracking-normal text-gray-900 outline-none" placeholder="e.g. 2008" /></label>
                <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-gray-500">Job Value<input type="number" value={selectedJob.value} onChange={(event) => updateJob(selectedJob.id, { value: Number(event.target.value) || 0 })} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium normal-case tracking-normal text-gray-900 outline-none" /></label>
                <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-gray-500">Assigned Rep<input value={selectedJob.assignedTo} onChange={(event) => updateJob(selectedJob.id, { assignedTo: event.target.value })} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium normal-case tracking-normal text-gray-900 outline-none" /></label>
                <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-gray-500">Lead Source<select value={selectedJob.source || ""} onChange={(event) => updateJob(selectedJob.id, { source: event.target.value })} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium normal-case tracking-normal text-gray-900 outline-none">{LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}</select></label>
                <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-gray-500">Status<select value={selectedJob.stage} onChange={(event) => updateJobStage(selectedJob.id, event.target.value as LeadStage)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium normal-case tracking-normal text-gray-900 outline-none">{leadStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label>
                <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-gray-500">Due Date<input type="date" value={selectedJob.dueDate || ""} onChange={(event) => updateJob(selectedJob.id, { dueDate: event.target.value })} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium normal-case tracking-normal text-gray-900 outline-none" /></label>
                <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-gray-500 sm:col-span-2">Next Action<input value={selectedJob.nextAction || ""} onChange={(event) => updateJob(selectedJob.id, { nextAction: event.target.value })} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium normal-case tracking-normal text-gray-900 outline-none" /></label>
                {selectedJob.callNotes && (
                  <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-gray-500 sm:col-span-2">Call Notes<textarea value={selectedJob.callNotes} onChange={(event) => updateJob(selectedJob.id, { callNotes: event.target.value })} rows={3} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium normal-case tracking-normal text-gray-900 outline-none" /></label>
                )}
              </div>

              <div className="space-y-3">
                {fileError && <p className="rounded-lg bg-orange-50 px-3 py-2 text-xs font-bold text-orange-700">{fileError}</p>}

                {/* Photo Checklist */}
                <div className="rounded-lg border border-gray-200 bg-white">
                  <button type="button" onClick={() => setChecklistOpen((v) => !v)} className="flex w-full items-center justify-between p-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-blue-700"><ListChecks className="h-4 w-4 text-orange-500" />Photo Checklist</div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${checklistDone === PHOTO_CHECKLIST_ITEMS.length ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"}`}>{checklistDone}/{PHOTO_CHECKLIST_ITEMS.length}</span>
                  </button>
                  {checklistOpen && (
                    <div className="border-t border-gray-100 px-4 pb-4">
                      <p className="pt-3 text-xs font-semibold text-gray-400">Tap each shot you&apos;ve taken on this job.</p>
                      <ul className="mt-2 space-y-1">
                        {PHOTO_CHECKLIST_ITEMS.map((item) => (
                          <li key={item}>
                            <button type="button" onClick={() => setPhotoChecklist((prev) => ({ ...prev, [item]: !prev[item] }))} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm transition hover:bg-gray-50">
                              {photoChecklist[item] ? <CheckSquare className="h-5 w-5 shrink-0 text-blue-500" /> : <Square className="h-5 w-5 shrink-0 text-gray-300" />}
                              <span className={photoChecklist[item] ? "font-bold text-blue-700 line-through" : "font-semibold text-gray-700"}>{item}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Compact Before / Progress / After */}
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-blue-700"><Camera className="h-4 w-4" />Job Photos</div>
                  <div className="mt-2 space-y-2">
                    {([
                      { type: "Before" as const, photos: beforePhotos, color: "bg-blue-600 hover:bg-blue-700", badge: "bg-blue-100 text-blue-700" },
                      { type: "Progress" as const, photos: progressPhotos, color: "bg-orange-500 hover:bg-orange-600", badge: "bg-orange-100 text-orange-700" },
                      { type: "After" as const, photos: afterPhotos, color: "bg-blue-600 hover:bg-blue-700", badge: "bg-blue-100 text-blue-700" },
                    ]).map(({ type, photos, color, badge }) => (
                      <div key={type} className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">{type}</p>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${badge}`}>{photos.length}</span>
                        </div>
                        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            disabled={fileBusy}
                            onClick={() => selectedJobId && setLiveCamera({ jobId: selectedJobId, type })}
                            className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold text-white transition active:scale-95 ${color} ${fileBusy ? "pointer-events-none opacity-60" : ""}`}
                          >
                            <Camera className="h-3.5 w-3.5" /> Camera
                          </button>
                          <label className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-bold text-gray-700 transition hover:bg-gray-100 ${fileBusy ? "pointer-events-none opacity-60" : ""}`}>
                            <UploadCloud className="h-3.5 w-3.5" /> Upload
                            <input type="file" accept="image/*" multiple className="hidden" disabled={fileBusy} onChange={(event) => { const input = event.currentTarget; void handleJobFileUpload(type, input.files).finally(() => { input.value = ""; }); }} />
                          </label>
                        </div>
                        {photos.length > 0 && (
                          <div className="mt-1.5 flex gap-1 overflow-x-auto">
                            {photos.map((photo, photoIdx) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={photo.id} src={photo.dataUrl} alt={photo.name} className="h-12 w-16 shrink-0 cursor-pointer rounded-md object-cover transition hover:ring-2 hover:ring-blue-400" onClick={() => setLightbox({ photos, index: photoIdx })} />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* General job photos */}
                <div className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-bold text-blue-700"><Image className="h-4 w-4" />General Photos</div>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500">{otherPhotos.length}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={fileBusy}
                      onClick={() => selectedJobId && setLiveCamera({ jobId: selectedJobId, type: "After" })}
                      className={`flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-blue-900 active:scale-95 ${fileBusy ? "pointer-events-none opacity-60" : ""}`}
                    >
                      <Camera className="h-4 w-4" /> Camera
                    </button>
                    <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs font-bold text-gray-700 transition hover:bg-gray-100 ${fileBusy ? "pointer-events-none opacity-60" : ""}`}>
                      <UploadCloud className="h-4 w-4" /> Upload
                      <input type="file" accept="image/*" multiple className="hidden" disabled={fileBusy} onChange={(event) => { const input = event.currentTarget; void handleJobFileUpload("Job Photo", input.files).finally(() => { input.value = ""; }); }} />
                    </label>
                  </div>
                  {otherPhotos.length > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {otherPhotos.map((photo, photoIdx) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={photo.id} src={photo.dataUrl} alt={photo.name} className="h-20 w-full cursor-pointer rounded-lg border border-gray-100 object-cover transition hover:ring-2 hover:ring-blue-400" onClick={() => setLightbox({ photos: otherPhotos, index: photoIdx })} />
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-xs font-bold text-gray-400">Auto-saved to Files → {selectedJob.address || "job"} folder.</p>
                </div>

                {/* Linked Documents */}
                <div className="rounded-lg border border-gray-200 bg-white">
                  <div className="flex items-center justify-between border-b border-gray-100 p-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-blue-700"><Link2 className="h-4 w-4" />Linked Documents</div>
                  </div>
                  <div className="p-4 space-y-3">
                    {/* Linked Proposals/Estimates */}
                    {(() => {
                      const linked = getLinkedProposals(selectedJob.id);
                      return linked.length > 0 ? (
                        <div className="space-y-2">
                          {linked.map((p) => (
                            <button key={p.id} type="button" onClick={() => { requestOpenEstimate(p.id); openBoardFromJob("/crm/proposals"); }} className="flex w-full items-center justify-between rounded-lg border border-purple-100 bg-purple-50 px-3 py-2 text-left transition hover:bg-purple-100">
                              <div className="flex items-center gap-2">
                                <DollarSign className="h-4 w-4 text-purple-600" />
                                <span className="text-sm font-bold text-purple-800">Estimate</span>
                              </div>
                              <span className="rounded-full bg-purple-200 px-2 py-0.5 text-xs font-bold text-purple-700">{p.status}</span>
                            </button>
                          ))}
                        </div>
                      ) : null;
                    })()}

                    {/* Linked Invoices */}
                    {(() => {
                      const linked = getLinkedInvoices(selectedJob.id);
                      return linked.length > 0 ? (
                        <div className="space-y-2">
                          {linked.map((inv) => (
                            <button key={inv.id} type="button" onClick={() => { requestOpenInvoice(inv.id); openBoardFromJob("/crm/invoices"); }} className="flex w-full items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-left transition hover:bg-emerald-100">
                              <div className="flex items-center gap-2">
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                <span className="text-sm font-bold text-emerald-800">Invoice{inv.clientName ? ` — ${inv.clientName}` : ""}</span>
                              </div>
                              <span className="rounded-full bg-emerald-200 px-2 py-0.5 text-xs font-bold text-emerald-700">{getInvoiceDisplayStatus(inv)}</span>
                            </button>
                          ))}
                        </div>
                      ) : null;
                    })()}

                    {/* No linked documents message */}
                    {getLinkedProposals(selectedJob.id).length === 0 && getLinkedInvoices(selectedJob.id).length === 0 && (
                      <p className="text-xs font-semibold text-gray-400">No proposals or invoices linked to this job yet.</p>
                    )}

                    {/* Action buttons */}
                    <div className="grid gap-2 sm:grid-cols-2 pt-2 border-t border-gray-100">
                      <button type="button" onClick={() => openEstimateForJob(selectedJob)} className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-bold text-gray-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                        <Plus className="h-4 w-4" />{getLinkedProposals(selectedJob.id).length > 0 ? "Open Estimate" : "New Estimate"}
                      </button>
                      <button type="button" onClick={() => openInvoiceForJob(selectedJob)} className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-bold text-gray-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                        <Plus className="h-4 w-4" />{getLinkedInvoices(selectedJob.id).length > 0 ? "Open Invoice" : "New Invoice"}
                      </button>
                    </div>

                    {/* Link existing documents */}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button type="button" onClick={() => setShowLinkPicker(showLinkPicker === "proposal" ? null : "proposal")} className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs font-bold text-gray-500 transition hover:border-blue-300 hover:text-blue-600">
                        <Link2 className="h-3.5 w-3.5" />Link Existing Estimate
                      </button>
                      <button type="button" onClick={() => setShowLinkPicker(showLinkPicker === "invoice" ? null : "invoice")} className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs font-bold text-gray-500 transition hover:border-blue-300 hover:text-blue-600">
                        <Link2 className="h-3.5 w-3.5" />Link Existing Invoice
                      </button>
                    </div>

                    {/* Link picker dropdown */}
                    {showLinkPicker === "proposal" && (() => {
                      const unlinked = getUnlinkedProposals();
                      return (
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-blue-600">Select an estimate to link</p>
                          {unlinked.length === 0 ? (
                            <p className="text-xs text-gray-500">No unlinked estimates found.</p>
                          ) : (
                            <div className="max-h-40 space-y-1 overflow-y-auto">
                              {unlinked.map((p) => (
                                <button key={p.id} type="button" onClick={() => linkProposalToJob(p.id, selectedJob.id)} className="flex w-full items-center justify-between rounded-lg bg-white px-3 py-2 text-left transition hover:bg-blue-100">
                                  <span className="text-sm font-semibold text-gray-700">{p.customerName || p.id}</span>
                                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500">{p.status}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {showLinkPicker === "invoice" && (() => {
                      const unlinked = getUnlinkedInvoices();
                      return (
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-blue-600">Select an invoice to link</p>
                          {unlinked.length === 0 ? (
                            <p className="text-xs text-gray-500">No unlinked invoices found.</p>
                          ) : (
                            <div className="max-h-40 space-y-1 overflow-y-auto">
                              {unlinked.map((inv) => (
                                <button key={inv.id} type="button" onClick={() => linkInvoiceToJob(inv.id, selectedJob.id)} className="flex w-full items-center justify-between rounded-lg bg-white px-3 py-2 text-left transition hover:bg-blue-100">
                                  <span className="text-sm font-semibold text-gray-700">{inv.clientName || inv.id}</span>
                                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500">{getInvoiceDisplayStatus(inv)}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div className="grid gap-3">
                  <button type="button" onClick={() => setActivityOpen((value) => !value)} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-left font-bold text-gray-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                    <History className="h-5 w-5" />Activity History
                  </button>
                </div>

                {activityOpen && (
                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Activity History</p>
                    <div className="mt-3 max-h-72 space-y-3 overflow-y-auto">
                      {jobActivities.length === 0 && jobFiles.length === 0 && <p className="text-sm font-semibold text-gray-400">No activity recorded yet.</p>}

                      {/* All activities sorted newest first */}
                      {jobActivities.map((act) => {
                        const moduleColors: Record<string, { bg: string; text: string; badge: string; badgeText: string }> = {
                          Invoice: { bg: "bg-emerald-100", text: "text-emerald-700", badge: "bg-emerald-50", badgeText: "text-emerald-600" },
                          Proposal: { bg: "bg-purple-100", text: "text-purple-700", badge: "bg-purple-50", badgeText: "text-purple-600" },
                          SMS: { bg: "bg-green-100", text: "text-green-700", badge: "bg-green-50", badgeText: "text-green-600" },
                          Notes: { bg: "bg-amber-100", text: "text-amber-700", badge: "bg-amber-50", badgeText: "text-amber-600" },
                          Jobs: { bg: "bg-blue-100", text: "text-blue-700", badge: "bg-blue-50", badgeText: "text-blue-600" },
                        };
                        const colors = moduleColors[act.module] ?? { bg: "bg-blue-100", text: "text-blue-700", badge: "bg-blue-50", badgeText: "text-blue-600" };
                        return (
                          <div key={act.id} className="flex items-start gap-3 rounded-lg bg-gray-50 px-3 py-2">
                            <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${colors.bg} text-xs font-black ${colors.text}`}>{act.actor.charAt(0).toUpperCase()}</div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-gray-900">{act.actor}</span>
                                <span className={`rounded-full ${colors.badge} px-2 py-0.5 text-[10px] font-bold ${colors.badgeText}`}>{act.module}</span>
                              </div>
                              <p className="mt-0.5 text-sm font-semibold text-gray-700">{act.action}</p>
                              {act.details && <p className="mt-0.5 text-xs text-gray-500">{act.details}</p>}
                              <p className="mt-1 text-[11px] font-semibold text-gray-400">{azDateTime(act.createdAt)}</p>
                            </div>
                          </div>
                        );
                      })}

                      {/* File / photo activities */}
                      {[...jobFiles].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((file) => (
                        <div key={file.id} className="flex items-start gap-3 rounded-lg bg-gray-50 px-3 py-2">
                          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-black text-orange-700">{file.uploadedBy ? file.uploadedBy.charAt(0).toUpperCase() : "?"}</div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-gray-900">{file.uploadedBy || "Unknown"}</span>
                              <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-bold text-orange-600">{file.photoType || "File"}</span>
                            </div>
                            <p className="mt-0.5 text-sm font-semibold text-gray-700">{file.name.startsWith("Document - ") ? file.name.replace("Document - ", "Uploaded document: ") : `Uploaded photo: ${file.name}`}</p>
                            <p className="mt-1 text-[11px] font-semibold text-gray-400">{azDateTime(file.createdAt)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-blue-700"><StickyNote className="h-4 w-4" />Notes</div>
                <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                  {jobNotes.filter((n) => n.jobId === selectedJobId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((note) => (
                    <div key={note.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
                      <p className="font-semibold text-gray-700">{note.body}</p>
                      <p className="mt-1 text-xs font-bold text-gray-400">{note.author} • {azDateTime(note.createdAt)}</p>
                    </div>
                  ))}
                  {jobNotes.filter((n) => n.jobId === selectedJobId).length === 0 && <p className="text-sm font-semibold text-gray-500">No notes yet.</p>}
                </div>
                {noteToast && (
                  <p className={`mt-2 rounded-lg px-3 py-2 text-xs font-bold ${noteToast.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{noteToast.message}</p>
                )}
                <div className="mt-3 flex gap-2">
                  <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleAddJobNote(); } }} className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold outline-none" placeholder="Add a note..." />
                  <button type="button" onClick={() => void handleAddJobNote()} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700">Save</button>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs font-bold text-gray-500"><Clock className="h-4 w-4" /><CalendarDays className="h-4 w-4" />Next: {selectedJob.nextAction || "Review job"} • Due {formatDueDate(selectedJob.dueDate)}</div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Photo Lightbox */}
      {lightbox && (
        <PhotoLightbox
          photos={lightbox.photos}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
          onSaveAnnotated={async (dataUrl, name, photoType) => {
            if (!selectedJobId) return;
            await addJobPhotos(selectedJobId, [{ photoType, name, dataUrl, uploadedBy: currentUserName }]);
            const refreshed = await loadJobPhotos(selectedJobId);
            setJobFiles(refreshed);
          }}
          onDelete={async (photoId) => {
            await deleteJobPhoto(photoId);
            if (selectedJobId) {
              const refreshed = await loadJobPhotos(selectedJobId);
              setJobFiles(refreshed);
              setLightbox((prev) => prev && refreshed.length > 0 ? { ...prev, photos: refreshed, index: Math.min(prev.index, refreshed.length - 1) } : null);
            }
          }}
        />
      )}

      {/* Live Camera Overlay */}
      {liveCamera && (() => {
        const accentMap = { Before: "bg-blue-600", Progress: "bg-orange-500", After: "bg-blue-600" } as const;
        const existingCount = jobFiles.filter((f) => f.photoType === liveCamera.type).length;
        return (
          <LiveCameraCapture
            label={liveCamera.type}
            accentColor={accentMap[liveCamera.type]}
            existingCount={existingCount}
            onCapture={async (photo) => {
              const blob = await fetch(photo.dataUrl).then((r) => r.blob());
              const file = new File([blob], photo.name, { type: "image/jpeg" });
              const dt = new DataTransfer();
              dt.items.add(file);
              await handleJobFileUpload(liveCamera.type, dt.files);
            }}
            onClose={() => setLiveCamera(null)}
          />
        );
      })()}
      {smsTarget && <QuickSmsModal phone={smsTarget.phone} name={smsTarget.name} onClose={() => setSmsTarget(null)} onSent={(msgBody) => {
        const job = jobs.find((j) => j.phone === smsTarget.phone) || (selectedJob?.phone === smsTarget.phone ? selectedJob : null);
        if (job) {
          void logCrewActivity({
            jobId: job.id,
            jobName: job.name,
            actor: currentUserName || "Office",
            action: "SMS sent",
            details: msgBody.length > 120 ? msgBody.slice(0, 120) + "…" : msgBody,
            module: "SMS",
          }).catch(() => {});
        }
      }} />}
    </div>
  );
}
