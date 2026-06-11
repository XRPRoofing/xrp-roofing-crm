"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Camera, CheckCircle2, CheckSquare, Clock, DollarSign, Filter, GripVertical, History, Home, Image, ListChecks, Mail, Mic, Phone, Plus, Search, Square, StickyNote, Tag, Trash2, UploadCloud, User, X } from "lucide-react";
import LiveCameraCapture from "@/components/LiveCameraCapture";
import { leadStages } from "@/lib/crm-data";
import type { Lead, LeadStage } from "@/types/crm";
import { addJobPhotos, deleteJobRecord, ensureSeedJobs, leadToJobRecord, loadCrewDataset, loadJobPhotos, subscribeToCrewData, updateJobRecord, upsertJobRecord, type JobPhoto } from "@/lib/crew-sync";
import { compressImageToDataUrl } from "@/lib/image-compress";
import { ensureInvoiceTaskForJob } from "@/lib/office-tasks";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { findOrCreateCustomer } from "@/lib/customer-sync";
import { jobToBoardPayload, requestCreateEstimate, requestCreateInvoice, requestOpenEstimate, requestOpenInvoice } from "@/lib/crm-board-nav";

declare global {
  interface Window {
    google?: {
      maps?: {
        places?: {
          Autocomplete: new (
            input: HTMLInputElement,
            options: {
              bounds?: { north: number; south: number; east: number; west: number };
              componentRestrictions?: { country: string };
              fields?: string[];
              strictBounds?: boolean;
              types?: string[];
            }
          ) => {
            addListener: (eventName: string, callback: () => void) => void;
            getPlace: () => { formatted_address?: string; address_components?: { long_name: string; types: string[] }[] };
          };
        };
      };
    };
  }
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
  return {
    ...job,
    stage,
    nextAction: job.nextAction || job.lastActivity || "Review next step",
    dueDate: job.dueDate || "2026-06-05",
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

const LEAD_SOURCES = ["AZR", "Google", "Facebook", "Website", "Referral", "Door Knocking", "Yelp", "Angi", "Thumbtack", "Phone Call", "Other"] as const;

const SOURCE_COLORS: Record<string, string> = {
  AZR:           "bg-orange-100 text-orange-700",
  Google:        "bg-blue-100 text-blue-700",
  Facebook:      "bg-indigo-100 text-indigo-700",
  Website:       "bg-sky-100 text-sky-700",
  Referral:      "bg-emerald-100 text-emerald-700",
  "Door Knocking": "bg-amber-100 text-amber-700",
  Yelp:          "bg-red-100 text-red-700",
  Angi:          "bg-orange-100 text-orange-800",
  Thumbtack:     "bg-green-100 text-green-700",
  "Phone Call":  "bg-purple-100 text-purple-700",
  Other:         "bg-slate-100 text-slate-600",
};

function getSourceColor(source: string) {
  return SOURCE_COLORS[source] ?? "bg-slate-100 text-slate-600";
}

function getUrgency(job: Lead) {
  if (!job.dueDate || job.stage === "completed" || job.stage === "paid") return { label: "On Track", className: "border-l-emerald-500", dot: "bg-emerald-500", text: "text-emerald-700" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${job.dueDate}T00:00:00`);
  const diffDays = Math.ceil((due.getTime() - today.getTime()) / 86400000);
  if (diffDays <= 3) return { label: "Due Soon", className: "border-l-yellow-400", dot: "bg-yellow-400", text: "text-yellow-700" };
  return { label: "On Track", className: "border-l-emerald-500", dot: "bg-emerald-500", text: "text-emerald-700" };
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

export default function LeadsPage() {
  const [jobs, setJobs] = useState<Lead[]>([]);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draggedJobId, setDraggedJobId] = useState<string | null>(null);
  const [liveCamera, setLiveCamera] = useState<{ jobId: string; type: "Before" | "Progress" | "After" } | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobFiles, setJobFiles] = useState<JobPhoto[]>([]);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [photoChecklist, setPhotoChecklist] = useState<Record<string, boolean>>({});
  const router = useRouter();
  const addressInputRef = useRef<HTMLInputElement>(null);
  const [showCallPaste, setShowCallPaste] = useState(false);
  const [callPasteText, setCallPasteText] = useState("");
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

  // Load the selected job's saved files (photos + documents) from the shared
  // crew store so they show on the card and stay in sync with the Files board.
  useEffect(() => {
    if (!selectedJobId) {
      setJobFiles([]);
      setActivityOpen(false);
      setChecklistOpen(false);
      setPhotoChecklist({});
      setFileError(null);
      return;
    }
    let mounted = true;
    void loadJobPhotos(selectedJobId).then((photos) => { if (mounted) setJobFiles(photos); }).catch(() => {});
    return () => { mounted = false; };
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
  function openEstimateForJob(job: Lead) {
    const proposals = readStored<{ id: string; job?: { id?: string } }>("xrp-crm-proposals");
    const existing = proposals.find((proposal) => proposal?.job?.id === job.id);
    if (existing) requestOpenEstimate(existing.id);
    else requestCreateEstimate(jobToBoardPayload(job));
    openBoardFromJob("/crm/proposals");
  }

  // One-click from a Job to its Invoice editor: open the linked invoice if one
  // exists, otherwise create one from the job and open it (linked by jobReference).
  function openInvoiceForJob(job: Lead) {
    const invoices = readStored<{ id: string; jobReference?: string }>("xrp-crm-invoices");
    const existing = invoices.find((invoice) => invoice?.jobReference === job.id);
    if (existing) requestOpenInvoice(existing.id);
    else requestCreateInvoice(jobToBoardPayload(job));
    openBoardFromJob("/crm/invoices");
  }

  const filteredJobs = useMemo(() => {
    const query = search.toLowerCase().trim();

    const sourceFiltered = sourceFilter ? jobs.filter((job) => job.source === sourceFilter) : jobs;
    if (!query) return sourceFiltered;

    return sourceFiltered.filter((job) =>
      [job.name, job.address, job.city, job.roofType, job.source, job.assignedTo, job.lastActivity, job.nextAction || ""]
        .some((value) => value.toLowerCase().includes(query))
    );
  }, [jobs, search, sourceFilter]);

  const dashboardMetrics = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const weekEnd = new Date(now);
    weekEnd.setDate(now.getDate() + 7);
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    return [
      { label: "Due Soon", value: jobs.filter((job) => getUrgency(job).label === "Due Soon").length, tone: "text-yellow-700 bg-yellow-50 border-yellow-100" },
      { label: "Waiting Approval", value: jobs.filter((job) => job.stage === "waiting_approval").length, tone: "text-yellow-700 bg-yellow-50 border-yellow-100" },
      { label: "Scheduled This Week", value: jobs.filter((job) => {
        if (!job.dueDate || job.stage !== "scheduled") return false;
        const due = new Date(`${job.dueDate}T00:00:00`);
        return due >= now && due <= weekEnd;
      }).length, tone: "text-blue-700 bg-blue-50 border-blue-100" },
      { label: "Active Jobs", value: jobs.filter((job) => ["scheduled", "in_progress", "final_inspection"].includes(job.stage)).length, tone: "text-emerald-700 bg-emerald-50 border-emerald-100" },
      { label: "Completed This Month", value: jobs.filter((job) => {
        if (!["completed", "paid"].includes(job.stage) || !job.dueDate) return false;
        const due = new Date(`${job.dueDate}T00:00:00`);
        return due.getMonth() === currentMonth && due.getFullYear() === currentYear;
      }).length, tone: "text-slate-700 bg-white border-slate-200" },
    ];
  }, [jobs]);

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
    let mounted = true;
    async function loadJobs() {
      try {
        const data = await loadCrewDataset();
        const seededJobs = await ensureSeedJobs(data.jobs);
        if (mounted) setJobs(seededJobs.map(normalizeJob));
      } catch {
        /* leave jobs empty when the shared store is unavailable */
      }
    }
    loadJobs();

    const unsubscribe = subscribeToCrewData(() => {
      void loadCrewDataset().then((data) => {
        if (mounted) setJobs(data.jobs.map(normalizeJob));
      }).catch(() => {});
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  // No manual refresh: reload jobs when returning to this tab/device.
  useAutoRefresh(() => {
    void loadCrewDataset().then((data) => setJobs(data.jobs.map(normalizeJob))).catch(() => {});
  });

  useEffect(() => {
    if (!showForm || !addressInputRef.current) return;

    const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

    if (!googleMapsApiKey) return;

    function initializeAutocomplete() {
      if (!addressInputRef.current || !window.google?.maps?.places?.Autocomplete) return;

      const autocomplete = new window.google.maps.places.Autocomplete(addressInputRef.current, {
        bounds: arizonaBounds,
        componentRestrictions: { country: "us" },
        fields: ["formatted_address", "address_components"],
        strictBounds: true,
        types: ["address"],
      });

      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        if (place.formatted_address) {
          setForm((currentForm) => ({ ...currentForm, address: place.formatted_address || currentForm.address }));
        }
      });
    }

    if (window.google?.maps?.places?.Autocomplete) {
      initializeAutocomplete();
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>("script[data-google-maps-places]");

    if (existingScript) {
      existingScript.addEventListener("load", initializeAutocomplete, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${googleMapsApiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMapsPlaces = "true";
    script.addEventListener("load", initializeAutocomplete, { once: true });
    document.head.appendChild(script);
  }, [showForm]);

  function updateJob(jobId: string, updates: Partial<Lead>) {
    setJobs((currentJobs) => currentJobs.map((job) => job.id === jobId ? { ...job, ...updates } : job));
    void updateJobRecord(jobId, updates).catch(() => {});
  }

  function updateJobStage(jobId: string, stage: LeadStage) {
    updateJob(jobId, { stage, lastActivity: `Moved to ${leadStages.find((item) => item.id === stage)?.label || "workflow"}` });
    if (stage === "completed") {
      const job = jobs.find((item) => item.id === jobId);
      if (job) ensureInvoiceTaskForJob({ id: job.id, name: job.name, address: job.address, city: job.city, value: job.value, jobLink: "/crm/leads" });
    }
  }

  function deleteJob(job: Lead) {
    if (typeof window !== "undefined" && !window.confirm(`Delete "${job.name}"? This permanently removes the job and its photos, notes, and checklist for everyone. This cannot be undone.`)) return;
    const previousJobs = jobs;
    setSelectedJobId(null);
    setJobs((currentJobs) => currentJobs.filter((item) => item.id !== job.id));
    void deleteJobRecord(job.id).catch(() => setJobs(previousJobs));
  }

  function handleAddJob(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const newJob: Lead = {
      id: `J-${Date.now()}`,
      name: form.name,
      email: form.email || "crm@xrproofing.com",
      phone: form.phone || "(602) 555-0000",
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
    <div className="-mx-4 -my-6 min-h-[calc(100vh-5rem)] bg-slate-100 px-4 py-5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="sticky top-16 z-30 space-y-3 border-b border-slate-200/80 bg-slate-100/95 pb-3 backdrop-blur sm:space-y-4 sm:pb-4 lg:top-20">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-600">Roofing operations</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-[#07183f]">Jobs board</h1>
            <p className="crm-board-subtitle mt-1 max-w-3xl text-sm font-medium text-slate-600">Compact production tracking for owners and office staff: see urgency, value, rep, next action, and due date at a glance.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setSearch(""); setSourceFilter(null); }} className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm transition hover:border-blue-200 hover:text-blue-700"><Filter className="mr-2 h-4 w-4" />Clear filters</button>
            <button onClick={() => setShowForm(true)} className="inline-flex items-center rounded-xl bg-orange-500 px-4 py-2 text-xs font-black text-white shadow-lg shadow-orange-200 transition hover:bg-orange-600"><Plus className="mr-2 h-4 w-4" />Add job</button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5 sm:gap-2 lg:grid-cols-5">
          {dashboardMetrics.map((metric) => (
            <div key={metric.label} className={`rounded-xl border px-2 py-1.5 shadow-sm sm:rounded-2xl sm:px-4 sm:py-3 ${metric.tone}`}>
              <p className="text-base font-black leading-none sm:text-2xl">{metric.value}</p>
              <p className="mt-0.5 text-[9px] font-black uppercase leading-tight tracking-wide sm:mt-1 sm:text-[11px]">{metric.label}</p>
            </div>
          ))}
        </div>

        {sourceMetrics.length > 0 && (
          <div className="overflow-x-auto">
            <div className="flex min-w-max items-stretch gap-2">
              <div className="flex shrink-0 items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-500"><Tag className="h-3 w-3" />By Source</div>
              {sourceMetrics.map(({ src, total, closed, revenue, conversion }) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setSourceFilter(sourceFilter === src ? null : src)}
                  className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-1.5 text-[10px] font-black transition hover:opacity-80 ${
                    sourceFilter === src ? "bg-[#07183f] text-white border-[#07183f]" : `${getSourceColor(src)} border-transparent`
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
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/30 p-3 sm:items-center sm:p-4" onClick={() => setShowForm(false)}>
          <form onSubmit={handleAddJob} className="my-auto flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <h2 className="text-lg font-black text-[#07183f]">Add new job</h2>
              <button type="button" onClick={() => setShowForm(false)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-slate-100">

              {/* Add from Call */}
              <div className="p-4">
                <button type="button" onClick={() => setShowCallPaste((v) => !v)} className={`flex w-full items-center gap-2 rounded-xl px-4 py-3 text-sm font-black transition ${showCallPaste ? "bg-orange-500 text-white" : "bg-orange-50 text-orange-700 hover:bg-orange-100"}`}>
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
                      className="w-full rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:bg-white placeholder:text-slate-400"
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
                        className="rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-black text-white hover:bg-orange-600 disabled:opacity-40"
                      >
                        Auto-fill from call
                      </button>
                      <p className="text-xs font-semibold text-slate-500">Review fields below after filling.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Section: Customer Info */}
              <div className="p-4 space-y-3">
                <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-orange-600"><User className="h-3.5 w-3.5" />Customer Info</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-xs font-bold text-slate-500">Full Name <span className="text-red-400">*</span></span>
                    <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="e.g. John Smith" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-bold text-slate-500">Phone Number</span>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="(602) 555-0123" />
                    </div>
                  </label>
                  <label className="grid gap-1 sm:col-span-2">
                    <span className="text-xs font-bold text-slate-500">Email Address</span>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="customer@email.com" />
                    </div>
                  </label>
                </div>
              </div>

              {/* Section: Property & Job */}
              <div className="p-4 space-y-3">
                <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-orange-600"><Home className="h-3.5 w-3.5" />Property & Job</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 sm:col-span-2">
                    <span className="text-xs font-bold text-slate-500">Property Address <span className="text-red-400">*</span></span>
                    <input ref={addressInputRef} required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="Street, City, AZ" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-bold text-slate-500">Roof Type</span>
                    <input value={form.roofType} onChange={(e) => setForm({ ...form, roofType: e.target.value })} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="e.g. Tile, Shingle, Flat" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-bold text-slate-500">Year of Roof / House</span>
                    <input value={form.roofYear} onChange={(e) => setForm({ ...form, roofYear: e.target.value })} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="e.g. 2008" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-bold text-slate-500">Estimated Job Value ($)</span>
                    <input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="0" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-bold text-slate-500">Lead Source</span>
                    <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white">
                      {LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-bold text-slate-500">Assigned Rep</span>
                    <input value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="Office Coordinator" />
                  </label>
                </div>
              </div>

              {/* Section: Inspection Appointment */}
              <div className="p-4 space-y-3">
                <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-orange-600"><CalendarDays className="h-3.5 w-3.5" />Inspection Appointment</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-xs font-bold text-slate-500">Inspection Date</span>
                    <input value={form.inspectionDate} onChange={(e) => setForm({ ...form, inspectionDate: e.target.value })} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="e.g. June 12" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-bold text-slate-500">Due Date</span>
                    <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" />
                  </label>
                  <label className="grid gap-1 sm:col-span-2">
                    <span className="text-xs font-bold text-slate-500">Next Action</span>
                    <input value={form.nextAction} onChange={(e) => setForm({ ...form, nextAction: e.target.value })} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="e.g. Schedule inspection" />
                  </label>
                  <label className="grid gap-1 sm:col-span-2">
                    <span className="text-xs font-bold text-slate-500">Notes</span>
                    <textarea value={form.lastActivity} onChange={(e) => setForm({ ...form, lastActivity: e.target.value })} rows={2} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white resize-none" placeholder="Any additional notes..." />
                  </label>
                  {form.callNotes && (
                    <label className="grid gap-1 sm:col-span-2">
                      <span className="text-xs font-bold text-slate-500">Call Notes</span>
                      <textarea value={form.callNotes} onChange={(e) => setForm({ ...form, callNotes: e.target.value })} rows={2} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:bg-white resize-none" />
                    </label>
                  )}
                </div>
              </div>

            </div>
            <div className="flex items-center justify-between border-t border-slate-200 p-4">
              <button type="button" onClick={() => setShowForm(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button className="rounded-xl bg-orange-500 px-6 py-2.5 text-sm font-black text-white shadow-lg shadow-orange-200 hover:bg-orange-600">Save Job</button>
            </div>
          </form>
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm font-semibold text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-50" placeholder="Search customer, city, rep, source, next action..." />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-500"><Tag className="h-3 w-3" />Source:</span>
          {LEAD_SOURCES.map((src) => {
            const count = jobs.filter((j) => j.source === src).length;
            if (count === 0) return null;
            const active = sourceFilter === src;
            return (
              <button
                key={src}
                type="button"
                onClick={() => setSourceFilter(active ? null : src)}
                className={`rounded-full px-2.5 py-1 text-[10px] font-black transition ${active ? "bg-[#07183f] text-white" : getSourceColor(src)} hover:opacity-80`}
              >
                {src} <span className="opacity-70">({count})</span>
              </button>
            );
          })}
          {sourceFilter && (
            <button type="button" onClick={() => setSourceFilter(null)} className="flex items-center gap-1 rounded-full bg-slate-200 px-2 py-1 text-[10px] font-black text-slate-600 hover:bg-slate-300">
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 flex gap-3 overflow-x-auto pb-6">
        {leadStages.map((stage) => {
          const stageJobs = filteredJobs.filter((job) => job.stage === stage.id);
          const stageValue = stageJobs.reduce((total, job) => total + job.value, 0);
          return (
            <section key={stage.id} onDragOver={(event) => event.preventDefault()} onDrop={() => draggedJobId && updateJobStage(draggedJobId, stage.id)} className="flex max-h-[calc(100vh-19rem)] min-h-[30rem] w-[18rem] shrink-0 flex-col rounded-2xl border border-slate-200 bg-slate-50/90 p-2 shadow-sm">
              <div className="sticky top-0 z-10 mb-2 shrink-0 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
                <h2 className="truncate text-xs font-black uppercase tracking-wide text-[#07183f]">{stage.label}</h2>
                <p className="mt-1 text-xs font-bold text-slate-500">{stageJobs.length} Jobs • {formatMoney(stageValue)}</p>
              </div>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-0.5 pb-1">
                {stageJobs.map((job) => {
                  const urgency = getUrgency(job);
                  return (
                    <button key={job.id} type="button" draggable onDragStart={() => setDraggedJobId(job.id)} onDragEnd={() => setDraggedJobId(null)} onClick={() => setSelectedJobId(job.id)} className={`group w-full cursor-grab rounded-xl border border-l-4 bg-white p-3 text-left text-sm shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg active:cursor-grabbing ${urgency.className}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black leading-tight text-slate-950">{job.name}</p>
                          <p className="mt-0.5 truncate text-xs font-bold text-slate-500">{job.city}, AZ</p>
                        </div>
                        <GripVertical className="h-4 w-4 shrink-0 text-slate-300" />
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <p className="text-base font-black text-[#07183f]">{formatMoney(job.value)}</p>
                        {urgency.label !== "On Track" && (
                          <span className={`inline-flex items-center gap-1 text-[11px] font-black ${urgency.text}`}><span className={`h-2 w-2 rounded-full ${urgency.dot}`} />{urgency.label}</span>
                        )}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-1">
                        <p className="truncate text-xs font-black text-slate-700">{job.assignedTo || "Unassigned"}</p>
                        {job.source && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSourceFilter(sourceFilter === job.source ? null : job.source); }}
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black transition hover:opacity-80 ${getSourceColor(job.source)}`}
                          >
                            {job.source}
                          </button>
                        )}
                      </div>
                      <div className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5">
                        <p className="truncate text-xs font-bold text-slate-700">Next: {job.nextAction || "Review job"}</p>
                        {job.inspectionDate && <p className="mt-0.5 truncate text-xs font-semibold text-blue-600">Appt: {job.inspectionDate}</p>}
                        <p className="mt-0.5 text-xs font-black text-slate-500">Due: {formatDueDate(job.dueDate)}</p>
                      </div>
                      <div className="mt-2 flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-1.5 py-0.5 text-[10px] font-black text-blue-600"><Camera className="h-3 w-3" />B</span>
                        <span className="inline-flex items-center gap-1 rounded-lg bg-orange-50 px-1.5 py-0.5 text-[10px] font-black text-orange-600"><Camera className="h-3 w-3" />P</span>
                        <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-1.5 py-0.5 text-[10px] font-black text-emerald-600"><Camera className="h-3 w-3" />A</span>
                        <span className="ml-auto inline-flex items-center gap-1 rounded-lg bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500"><ListChecks className="h-3 w-3" />Checklist</span>
                      </div>
                    </button>
                  );
                })}
                {stageJobs.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-center text-xs font-bold text-slate-500">Drop jobs here</div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {selectedJob && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-sm" onClick={() => setSelectedJobId(null)}>
          <aside className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-600">Job details</p>
                  <h2 className="mt-1 text-2xl font-black text-[#07183f]">{selectedJob.name}</h2>
                  <p className="text-sm font-bold text-slate-500">{selectedJob.address}, {selectedJob.city}, AZ</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => deleteJob(selectedJob)} className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 transition hover:bg-red-100"><Trash2 className="h-4 w-4" />Delete Job</button>
                  <button type="button" onClick={() => setSelectedJobId(null)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
                </div>
              </div>
            </div>

            <div className="space-y-5 p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Customer Name<input value={selectedJob.name} onChange={(event) => updateJob(selectedJob.id, { name: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" /></label>
                <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">City<input value={selectedJob.city} onChange={(event) => updateJob(selectedJob.id, { city: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" /></label>
                <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Phone
                  <div className="flex items-center gap-1">
                    <input value={selectedJob.phone} onChange={(event) => updateJob(selectedJob.id, { phone: event.target.value })} className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" />
                    {selectedJob.phone && <a href={`tel:${selectedJob.phone.replace(/[^\d+]/g, "")}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white hover:bg-emerald-600"><Phone className="h-4 w-4" /></a>}
                  </div>
                </label>
                <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Email<input type="email" value={selectedJob.email} onChange={(event) => updateJob(selectedJob.id, { email: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" /></label>
                <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500 sm:col-span-2">Address<input value={selectedJob.address} onChange={(event) => updateJob(selectedJob.id, { address: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" /></label>
                <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Inspection Date<input value={selectedJob.inspectionDate || ""} onChange={(event) => updateJob(selectedJob.id, { inspectionDate: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" placeholder="e.g. June 12" /></label>
                <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Year of Roof / House<input value={selectedJob.roofYear || ""} onChange={(event) => updateJob(selectedJob.id, { roofYear: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" placeholder="e.g. 2008" /></label>
                <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Job Value<input type="number" value={selectedJob.value} onChange={(event) => updateJob(selectedJob.id, { value: Number(event.target.value) || 0 })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" /></label>
                <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Assigned Rep<input value={selectedJob.assignedTo} onChange={(event) => updateJob(selectedJob.id, { assignedTo: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" /></label>
                <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Lead Source<select value={selectedJob.source || ""} onChange={(event) => updateJob(selectedJob.id, { source: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none">{LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}</select></label>
                <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Status<select value={selectedJob.stage} onChange={(event) => updateJobStage(selectedJob.id, event.target.value as LeadStage)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none">{leadStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label>
                <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Due Date<input type="date" value={selectedJob.dueDate || ""} onChange={(event) => updateJob(selectedJob.id, { dueDate: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" /></label>
                <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500 sm:col-span-2">Next Action<input value={selectedJob.nextAction || ""} onChange={(event) => updateJob(selectedJob.id, { nextAction: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" /></label>
                <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500 sm:col-span-2">Notes<textarea value={selectedJob.lastActivity} onChange={(event) => updateJob(selectedJob.id, { lastActivity: event.target.value })} rows={3} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" /></label>
                {selectedJob.callNotes && (
                  <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500 sm:col-span-2">Call Notes<textarea value={selectedJob.callNotes} onChange={(event) => updateJob(selectedJob.id, { callNotes: event.target.value })} rows={3} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" /></label>
                )}
              </div>

              <div className="space-y-3">
                {fileError && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{fileError}</p>}

                {/* Photo Checklist */}
                <div className="rounded-2xl border border-slate-200 bg-white">
                  <button type="button" onClick={() => setChecklistOpen((v) => !v)} className="flex w-full items-center justify-between p-4">
                    <div className="flex items-center gap-2 text-sm font-black text-[#07183f]"><ListChecks className="h-4 w-4 text-orange-500" />Photo Checklist</div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-black ${checklistDone === PHOTO_CHECKLIST_ITEMS.length ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{checklistDone}/{PHOTO_CHECKLIST_ITEMS.length}</span>
                  </button>
                  {checklistOpen && (
                    <div className="border-t border-slate-100 px-4 pb-4">
                      <p className="pt-3 text-[11px] font-semibold text-slate-400">Tap each shot you&apos;ve taken on this job.</p>
                      <ul className="mt-2 space-y-1">
                        {PHOTO_CHECKLIST_ITEMS.map((item) => (
                          <li key={item}>
                            <button type="button" onClick={() => setPhotoChecklist((prev) => ({ ...prev, [item]: !prev[item] }))} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-sm transition hover:bg-slate-50">
                              {photoChecklist[item] ? <CheckSquare className="h-5 w-5 shrink-0 text-emerald-500" /> : <Square className="h-5 w-5 shrink-0 text-slate-300" />}
                              <span className={photoChecklist[item] ? "font-bold text-emerald-700 line-through" : "font-semibold text-slate-700"}>{item}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* CompanyCam-style Before / Progress / After */}
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-[#0f172a] shadow-xl">
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Camera className="h-4 w-4 text-orange-400" />
                      <span className="text-sm font-black text-white">Job Photos</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-black text-blue-300">{beforePhotos.length} Before</span>
                      <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] font-black text-orange-300">{progressPhotos.length} Progress</span>
                      <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black text-emerald-300">{afterPhotos.length} After</span>
                    </div>
                  </div>

                  {/* Stacked photo slots */}
                  {([
                    { type: "Before" as const, photos: beforePhotos, label: "BEFORE", labelBg: "bg-black/70", labelText: "text-white", addBg: "bg-slate-800 hover:bg-slate-700", camBg: "bg-blue-600 hover:bg-blue-700", border: "border-blue-900/40" },
                    { type: "Progress" as const, photos: progressPhotos, label: "PROGRESS", labelBg: "bg-black/70", labelText: "text-orange-300", addBg: "bg-slate-800 hover:bg-slate-700", camBg: "bg-orange-500 hover:bg-orange-600", border: "border-orange-900/40" },
                    { type: "After" as const, photos: afterPhotos, label: "AFTER", labelBg: "bg-black/70", labelText: "text-emerald-300", addBg: "bg-slate-800 hover:bg-slate-700", camBg: "bg-emerald-600 hover:bg-emerald-700", border: "border-emerald-900/40" },
                  ]).map(({ type, photos, label, labelBg, labelText, addBg, camBg, border }, slotIndex) => {
                    const latest = photos[photos.length - 1];
                    return (
                      <div key={type} className={`border-t ${slotIndex === 0 ? "border-slate-700" : border}`}>
                        {/* Photo slot */}
                        <div className="relative w-full" style={{ aspectRatio: "16/9" }}>
                          {latest?.dataUrl ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={latest.dataUrl} alt={label} className="h-full w-full object-cover" />
                              {/* Replace overlay on tap */}
                                  <button
                                type="button"
                                disabled={fileBusy}
                                onClick={() => selectedJobId && setLiveCamera({ jobId: selectedJobId, type })}
                                className={`absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition hover:bg-black/40 hover:opacity-100 ${fileBusy ? "pointer-events-none" : ""}`}
                              >
                                <span className="rounded-2xl bg-white/90 px-4 py-2 text-xs font-black text-slate-900">Tap to open camera</span>
                              </button>
                            </>
                          ) : (
                              <button
                              type="button"
                              disabled={fileBusy}
                              onClick={() => selectedJobId && setLiveCamera({ jobId: selectedJobId, type })}
                              className={`flex h-full w-full flex-col items-center justify-center gap-3 ${addBg} transition ${fileBusy ? "opacity-60 pointer-events-none" : ""}`}
                            >
                              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
                                <Camera className="h-7 w-7 text-slate-400" />
                              </div>
                              <span className="text-sm font-black text-slate-400">Tap to open camera</span>
                            </button>
                          )}
                          {/* Label badge */}
                          <span className={`absolute bottom-3 right-3 rounded-lg ${labelBg} px-2.5 py-1 text-[11px] font-black uppercase tracking-widest ${labelText} backdrop-blur-sm`}>{label}</span>
                          {/* Photo count badge */}
                          {photos.length > 1 && (
                            <span className="absolute left-3 top-3 rounded-lg bg-black/60 px-2 py-0.5 text-[10px] font-black text-white backdrop-blur-sm">{photos.length} photos</span>
                          )}
                        </div>
                        {/* Action row */}
                        <div className="grid grid-cols-2 gap-px bg-slate-700">
                          <button
                            type="button"
                            disabled={fileBusy}
                            onClick={() => selectedJobId && setLiveCamera({ jobId: selectedJobId, type })}
                            className={`flex items-center justify-center gap-2 py-3 text-xs font-black text-white transition ${camBg} ${fileBusy ? "pointer-events-none opacity-60" : ""}`}
                          >
                            <Camera className="h-4 w-4" /> Camera
                          </button>
                          <label className="flex cursor-pointer items-center justify-center gap-2 bg-slate-800 py-3 text-xs font-black text-slate-300 transition hover:bg-slate-700">
                            <UploadCloud className="h-4 w-4" /> Upload
                            <input type="file" accept="image/*" multiple className="hidden" disabled={fileBusy} onChange={(event) => { const input = event.currentTarget; void handleJobFileUpload(type, input.files).finally(() => { input.value = ""; }); }} />
                          </label>
                        </div>
                        {/* Thumbnails strip if multiple */}
                        {photos.length > 1 && (
                          <div className="flex gap-1.5 overflow-x-auto bg-slate-900 p-2">
                            {photos.map((photo) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={photo.id} src={photo.dataUrl} alt={photo.name} className="h-14 w-20 shrink-0 rounded-lg object-cover opacity-80 hover:opacity-100" />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* General job photos */}
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-black text-[#07183f]"><Image className="h-4 w-4" />General Photos</div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{otherPhotos.length}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={fileBusy}
                      onClick={() => selectedJobId && setLiveCamera({ jobId: selectedJobId, type: "After" })}
                      className={`flex items-center justify-center gap-2 rounded-xl bg-[#07183f] px-3 py-2.5 text-xs font-black text-white transition hover:bg-blue-900 active:scale-95 ${fileBusy ? "pointer-events-none opacity-60" : ""}`}
                    >
                      <Camera className="h-4 w-4" /> Camera
                    </button>
                    <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-100 ${fileBusy ? "pointer-events-none opacity-60" : ""}`}>
                      <UploadCloud className="h-4 w-4" /> Upload
                      <input type="file" accept="image/*" multiple className="hidden" disabled={fileBusy} onChange={(event) => { const input = event.currentTarget; void handleJobFileUpload("Job Photo", input.files).finally(() => { input.value = ""; }); }} />
                    </label>
                  </div>
                  {otherPhotos.length > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {otherPhotos.map((photo) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={photo.id} src={photo.dataUrl} alt={photo.name} className="h-20 w-full rounded-lg border border-slate-100 object-cover" />
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-[11px] font-bold text-slate-400">Auto-saved to Files → {selectedJob.address || "job"} folder.</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <button type="button" onClick={() => openEstimateForJob(selectedJob)} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left font-black text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                    <DollarSign className="h-5 w-5" />Estimate
                  </button>
                  <button type="button" onClick={() => openInvoiceForJob(selectedJob)} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left font-black text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                    <CheckCircle2 className="h-5 w-5" />Invoice
                  </button>
                  <button type="button" onClick={() => setActivityOpen((value) => !value)} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left font-black text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 sm:col-span-2">
                    <History className="h-5 w-5" />Activity History
                  </button>
                </div>

                {activityOpen && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-black uppercase tracking-wide text-slate-500">Activity History</p>
                    <ul className="mt-2 space-y-2">
                      {jobFiles.length === 0 && <li className="text-sm font-semibold text-slate-500">No document or photo activity yet.</li>}
                      {[...jobFiles].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((file) => (
                        <li key={file.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate font-bold text-slate-700">{file.name.startsWith("Document - ") ? file.name.replace("Document - ", "Document · ") : `Photo · ${file.name}`}</span>
                          <span className="shrink-0 text-xs font-semibold text-slate-400">{new Date(file.createdAt).toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-sm font-black text-[#07183f]"><StickyNote className="h-4 w-4" />Latest note</div>
                <p className="mt-2 text-sm font-medium text-slate-600">{selectedJob.lastActivity}</p>
                <div className="mt-3 flex items-center gap-2 text-xs font-black text-slate-500"><Clock className="h-4 w-4" /><CalendarDays className="h-4 w-4" />Next: {selectedJob.nextAction || "Review job"} • Due {formatDueDate(selectedJob.dueDate)}</div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Live Camera Overlay */}
      {liveCamera && (() => {
        const accentMap = { Before: "bg-blue-600", Progress: "bg-orange-500", After: "bg-emerald-600" } as const;
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
    </div>
  );
}
