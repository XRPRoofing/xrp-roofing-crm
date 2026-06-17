"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Camera, CheckCircle2, CheckSquare, Clock, DollarSign, FileText, Filter, GripVertical, History, Home, Image, ListChecks, Mail, MapPin, Mic, Phone, Plus, Search, Square, StickyNote, Tag, Trash2, UploadCloud, User, X } from "lucide-react";
import LiveCameraCapture from "@/components/LiveCameraCapture";
import { AddressLink } from "@/components/ContactLinks";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { leadStages } from "@/lib/crm-data";
import type { Lead, LeadStage } from "@/types/crm";
import { addJobNote, addJobPhotos, deleteJobRecord, ensureSeedJobs, leadToJobRecord, loadCrewDataset, loadJobPhotos, migrateStaleDueDates, subscribeToCrewData, updateJobRecord, upsertJobRecord, type JobNote, type JobPhoto } from "@/lib/crew-sync";
import { createClient } from "@/lib/supabase/client";
import { createManualFolder } from "@/lib/manual-folders";
import { compressImageToDataUrl } from "@/lib/image-compress";
import { ensureInvoiceTaskForJob } from "@/lib/office-tasks";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { findOrCreateCustomer } from "@/lib/customer-sync";
import { jobToBoardPayload, requestCreateEstimate, requestCreateInvoice, requestOpenEstimate, requestOpenInvoice } from "@/lib/crm-board-nav";
import { loadProposalRecords, subscribeToProposalRecords } from "@/lib/proposal-sync";

type ProposalSnap = { id: string; job?: { id?: string }; status: string; deletedAt?: string };

const PROPOSAL_STATUS_STYLES: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-600",
  Sent: "bg-sky-100 text-sky-700",
  Viewed: "bg-amber-100 text-amber-700",
  Approved: "bg-emerald-100 text-emerald-700",
  Won: "bg-emerald-100 text-emerald-700",
  Signed: "bg-emerald-100 text-emerald-700",
  "Signed Offline": "bg-emerald-100 text-emerald-700",
  Rejected: "bg-red-100 text-red-700",
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

const LEAD_SOURCES = ["AZR", "Google", "Facebook", "Website", "Referral", "Door Knocking", "Yelp", "Angi", "Thumbtack", "Phone Call", "Other"] as const;

const SOURCE_COLORS: Record<string, string> = {
  AZR:           "bg-orange-100 text-orange-700",
  Google:        "bg-blue-100 text-blue-700",
  Facebook:      "bg-blue-100 text-blue-700",
  Website:       "bg-sky-100 text-sky-700",
  Referral:      "bg-blue-100 text-blue-700",
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

export default function LeadsPage() {
  const [jobs, setJobs] = useState<Lead[]>([]);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draggedJobId, setDraggedJobId] = useState<string | null>(null);
  const [liveCamera, setLiveCamera] = useState<{ jobId: string; type: "Before" | "Progress" | "After" } | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [proposalStatusMap, setProposalStatusMap] = useState<Record<string, string>>({});

  const [jobFiles, setJobFiles] = useState<JobPhoto[]>([]);
  const [jobNotes, setJobNotes] = useState<JobNote[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [currentUserName, setCurrentUserName] = useState("Office");
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [photoChecklist, setPhotoChecklist] = useState<Record<string, boolean>>({});
  const router = useRouter();
  const searchParams = useSearchParams();
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

  const jobCardHashRef = useRef(false);

  const closeJobCard = useCallback(() => {
    setSelectedJobId(null);
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

  // Load the selected job's saved files (photos + documents) from the shared
  // crew store so they show on the card and stay in sync with the Files board.
  useEffect(() => {
    if (!selectedJobId) {
      setJobFiles([]);
      setJobNotes([]);
      setNoteDraft("");
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

  async function handleAddJobNote() {
    if (!selectedJob || !noteDraft.trim()) return;
    const body = noteDraft.trim();
    setNoteDraft("");
    try {
      await addJobNote(selectedJob.id, currentUserName, body);
      const data = await loadCrewDataset();
      setJobNotes(data.notes);
    } catch {
      setNoteDraft(body);
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
    async function loadJobs() {
      try {
        const data = await loadCrewDataset();
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
      void loadCrewDataset().then((data) => {
        if (mounted) {
          setJobs(data.jobs.map(normalizeJob));
          setJobNotes(data.notes);
        }
      }).catch(() => {});
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  // No manual refresh: reload jobs when returning to this tab/device.
  useAutoRefresh(() => {
    void loadCrewDataset().then((data) => {
      setJobs(data.jobs.map(normalizeJob));
      setJobNotes(data.notes);
    }).catch(() => {});
    void loadProposalRecords<ProposalSnap>().then((proposals) => {
      const map: Record<string, string> = {};
      for (const p of proposals) {
        if (!p.deletedAt && p.job?.id) map[p.job.id] = p.status;
      }
      setProposalStatusMap(map);
    }).catch(() => {});
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
    void loadProposalRecords<ProposalSnap>().then(buildMap).catch(() => {});
    const unsub = subscribeToProposalRecords(() => {
      void loadProposalRecords<ProposalSnap>().then(buildMap).catch(() => {});
    });
    return () => { mounted = false; unsub(); };
  }, []);


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
      <div className="sticky top-16 z-20 -mx-4 space-y-1.5 border-b border-gray-200 bg-white/95 px-4 pb-2 pt-1 backdrop-blur-sm sm:-mx-8 sm:space-y-3 sm:px-8 sm:pb-3">
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
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/20 p-3 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setShowForm(false)}>
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
                  <label className="grid gap-1">
                    <span className="text-xs font-bold text-gray-500">Full Name <span className="text-orange-400">*</span></span>
                    <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="e.g. John Smith" />
                  </label>
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
                        {pStatus ? (
                          <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold leading-none ${getProposalStatusStyle(pStatus)}`}><FileText className="h-3 w-3" />{getProposalStatusLabel(pStatus)}</span>
                        ) : urgency.label !== "On Track" ? (
                          <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold leading-none ${urgency.text}`}><span className={`h-1.5 w-1.5 rounded-full ${urgency.dot}`} />{urgency.label}</span>
                        ) : null}
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
                <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-gray-500 sm:col-span-2">Notes<textarea value={selectedJob.lastActivity} onChange={(event) => updateJob(selectedJob.id, { lastActivity: event.target.value })} rows={3} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium normal-case tracking-normal text-gray-900 outline-none" /></label>
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
                            {photos.map((photo) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={photo.id} src={photo.dataUrl} alt={photo.name} className="h-12 w-16 shrink-0 rounded-md object-cover" />
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
                      {otherPhotos.map((photo) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={photo.id} src={photo.dataUrl} alt={photo.name} className="h-20 w-full rounded-lg border border-gray-100 object-cover" />
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-xs font-bold text-gray-400">Auto-saved to Files → {selectedJob.address || "job"} folder.</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <button type="button" onClick={() => openEstimateForJob(selectedJob)} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-left font-bold text-gray-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                    <DollarSign className="h-5 w-5" />Estimate
                  </button>
                  <button type="button" onClick={() => openInvoiceForJob(selectedJob)} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-left font-bold text-gray-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                    <CheckCircle2 className="h-5 w-5" />Invoice
                  </button>
                  <button type="button" onClick={() => setActivityOpen((value) => !value)} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-left font-bold text-gray-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 sm:col-span-2">
                    <History className="h-5 w-5" />Activity History
                  </button>
                </div>

                {activityOpen && (
                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Activity History</p>
                    <ul className="mt-2 space-y-2">
                      {jobFiles.length === 0 && <li className="text-sm font-semibold text-gray-500">No document or photo activity yet.</li>}
                      {[...jobFiles].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((file) => (
                        <li key={file.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate font-bold text-gray-700">{file.name.startsWith("Document - ") ? file.name.replace("Document - ", "Document · ") : `Photo · ${file.name}`}</span>
                          <span className="shrink-0 text-xs font-semibold text-gray-400">{new Date(file.createdAt).toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-blue-700"><StickyNote className="h-4 w-4" />Notes</div>
                <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                  {jobNotes.filter((n) => n.jobId === selectedJobId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((note) => (
                    <div key={note.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
                      <p className="font-semibold text-gray-700">{note.body}</p>
                      <p className="mt-1 text-xs font-bold text-gray-400">{note.author} • {new Date(note.createdAt).toLocaleString()}</p>
                    </div>
                  ))}
                  {jobNotes.filter((n) => n.jobId === selectedJobId).length === 0 && <p className="text-sm font-semibold text-gray-500">No notes yet.</p>}
                </div>
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
    </div>
  );
}
