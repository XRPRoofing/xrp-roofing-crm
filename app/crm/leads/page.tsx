"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Camera, CheckCircle2, Clock, DollarSign, FileText, Filter, GripVertical, History, Image, Plus, Search, StickyNote, Trash2, UploadCloud, X } from "lucide-react";
import { customers, leadStages } from "@/lib/crm-data";
import type { Customer, Lead, LeadStage } from "@/types/crm";
import { addJobPhotos, deleteJobRecord, ensureSeedJobs, leadToJobRecord, loadCrewDataset, loadJobPhotos, subscribeToCrewData, updateJobRecord, upsertJobRecord, type JobPhoto } from "@/lib/crew-sync";
import { compressImageToDataUrl } from "@/lib/image-compress";
import PhotoAnnotator, { type AnnotatedResult, type AnnotatorImage } from "@/components/crm/PhotoAnnotator";
import { ensureInvoiceTaskForJob } from "@/lib/office-tasks";
import { useAutoRefresh } from "@/lib/use-auto-refresh";

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
const customersStorageKey = "xrp-crm-customers";
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

function getUrgency(job: Lead) {
  if (!job.dueDate || job.stage === "completed" || job.stage === "paid") return { label: "On Track", className: "border-l-emerald-500", dot: "bg-emerald-500", text: "text-emerald-700" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${job.dueDate}T00:00:00`);
  const diffDays = Math.ceil((due.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return { label: "Overdue", className: "border-l-red-500", dot: "bg-red-500", text: "text-red-700" };
  if (diffDays <= 3) return { label: "Due Soon", className: "border-l-yellow-400", dot: "bg-yellow-400", text: "text-yellow-700" };
  return { label: "On Track", className: "border-l-emerald-500", dot: "bg-emerald-500", text: "text-emerald-700" };
}

function getCityFromAddress(address: string) {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : "Phoenix";
}

function getSavedCustomers() {
  const savedCustomers = window.localStorage.getItem(customersStorageKey);
  if (!savedCustomers) return customers;

  try {
    return JSON.parse(savedCustomers) as Customer[];
  } catch {
    return customers;
  }
}

function syncCustomerFromJob(job: Lead) {
  const customerFromJob: Customer = {
    id: `C-${job.id}`,
    name: job.name,
    email: job.email,
    phone: job.phone,
    propertyAddress: `${job.address}${job.city && !job.address.includes(job.city) ? `, ${job.city}, AZ` : ""}`,
    roofDetails: job.roofType || "Roof details pending",
    insuranceCarrier: "Not provided",
    status: "New job",
    lifetimeValue: job.value,
  };
  const currentCustomers = getSavedCustomers();
  const matchingCustomer = currentCustomers.find((customer) =>
    customer.id === customerFromJob.id ||
    (customer.email && customer.email === job.email) ||
    (customer.phone && customer.phone === job.phone)
  );
  const nextCustomers = matchingCustomer
    ? currentCustomers.map((customer) => customer.id === matchingCustomer.id ? { ...customer, ...customerFromJob, id: customer.id, insuranceCarrier: customer.insuranceCarrier || customerFromJob.insuranceCarrier } : customer)
    : [customerFromJob, ...currentCustomers];

  window.localStorage.setItem(customersStorageKey, JSON.stringify(nextCustomers));
  window.dispatchEvent(new StorageEvent("storage", { key: customersStorageKey, newValue: JSON.stringify(nextCustomers) }));
}

export default function LeadsPage() {
  const [jobs, setJobs] = useState<Lead[]>([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [draggedJobId, setDraggedJobId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobFiles, setJobFiles] = useState<JobPhoto[]>([]);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [annotatorImages, setAnnotatorImages] = useState<AnnotatorImage[] | null>(null);
  const [annotatorKind, setAnnotatorKind] = useState<"Documents" | "Photos">("Photos");
  const [annotatorKey, setAnnotatorKey] = useState(0);
  const [activityOpen, setActivityOpen] = useState(false);
  const router = useRouter();
  const addressInputRef = useRef<HTMLInputElement>(null);
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
  });

  const selectedJob = jobs.find((job) => job.id === selectedJobId) || null;
  const jobPhotosOnly = jobFiles.filter((file) => !file.name.startsWith("Document - "));
  const jobDocuments = jobFiles.filter((file) => file.name.startsWith("Document - "));

  // Load the selected job's saved files (photos + documents) from the shared
  // crew store so they show on the card and stay in sync with the Files board.
  useEffect(() => {
    if (!selectedJobId) {
      setJobFiles([]);
      setActivityOpen(false);
      setFileError(null);
      return;
    }
    let mounted = true;
    void loadJobPhotos(selectedJobId).then((photos) => { if (mounted) setJobFiles(photos); }).catch(() => {});
    return () => { mounted = false; };
  }, [selectedJobId]);

  async function handleJobFileUpload(kind: "Documents" | "Photos", files: FileList | null) {
    if (!selectedJob || !files?.length) return;
    setFileBusy(true);
    setFileError(null);
    try {
      const selected = Array.from(files);
      const dataUrls = await Promise.all(selected.map((file) => compressImageToDataUrl(file)));
      setAnnotatorKind(kind);
      setAnnotatorKey((key) => key + 1);
      setAnnotatorImages(selected.map((file, index) => ({ name: file.name, dataUrl: dataUrls[index] })));
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Failed to load file.");
    } finally {
      setFileBusy(false);
    }
  }

  async function handleAnnotatorComplete(results: AnnotatedResult[]) {
    setAnnotatorImages(null);
    if (!selectedJob || results.length === 0) return;
    setFileBusy(true);
    setFileError(null);
    try {
      await addJobPhotos(selectedJob.id, results.map((result) => ({
        photoType: "Job Photo",
        name: annotatorKind === "Documents" ? `Document - ${result.name}` : result.name,
        dataUrl: result.dataUrl,
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

  const filteredJobs = useMemo(() => {
    const query = search.toLowerCase().trim();

    if (!query) return jobs;

    return jobs.filter((job) =>
      [job.name, job.address, job.city, job.roofType, job.source, job.assignedTo, job.lastActivity, job.nextAction || ""]
        .some((value) => value.toLowerCase().includes(query))
    );
  }, [jobs, search]);

  const dashboardMetrics = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const weekEnd = new Date(now);
    weekEnd.setDate(now.getDate() + 7);
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    return [
      { label: "Overdue Jobs", value: jobs.filter((job) => getUrgency(job).label === "Overdue").length, tone: "text-red-700 bg-red-50 border-red-100" },
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
    };

    setJobs((currentJobs) => [newJob, ...currentJobs]);
    void upsertJobRecord(leadToJobRecord(newJob)).catch(() => {});
    syncCustomerFromJob(newJob);
    setForm({
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
    });
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
            <button onClick={() => setSearch("")} className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm transition hover:border-blue-200 hover:text-blue-700"><Filter className="mr-2 h-4 w-4" />Clear filters</button>
            <button onClick={() => setShowForm(true)} className="inline-flex items-center rounded-xl bg-orange-500 px-4 py-2 text-xs font-black text-white shadow-lg shadow-orange-200 transition hover:bg-orange-600"><Plus className="mr-2 h-4 w-4" />Add job</button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          {dashboardMetrics.map((metric) => (
            <div key={metric.label} className={`rounded-2xl border px-4 py-3 shadow-sm ${metric.tone}`}>
              <p className="text-2xl font-black leading-none">{metric.value}</p>
              <p className="mt-1 text-[11px] font-black uppercase tracking-wide">{metric.label}</p>
            </div>
          ))}
        </div>

        {showForm && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/40 p-4 backdrop-blur-sm sm:items-center" onClick={() => setShowForm(false)}>
          <form onSubmit={handleAddJob} className="my-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-black text-[#07183f]">Add new job</h2>
              <button type="button" onClick={() => setShowForm(false)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Customer / job name" />
              <input ref={addressInputRef} required value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none md:col-span-2" placeholder="Job address" />
              <input value={form.roofType} onChange={(event) => setForm({ ...form, roofType: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Roof type" />
              <input type="number" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Job value" />
              <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Email" />
              <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Phone" />
              <input value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Source" />
              <input value={form.assignedTo} onChange={(event) => setForm({ ...form, assignedTo: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Assigned to" />
              <input value={form.nextAction} onChange={(event) => setForm({ ...form, nextAction: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Next action" />
              <input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" />
              <input value={form.lastActivity} onChange={(event) => setForm({ ...form, lastActivity: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none md:col-span-2" placeholder="Current note" />
            </div>
            <button className="mt-3 rounded-xl bg-[#07183f] px-4 py-2 text-sm font-bold text-white">Save job</button>
          </form>
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm font-semibold text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-50" placeholder="Search customer, city, rep, roof type, next action..." />
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
                        <span className={`inline-flex items-center gap-1 text-[11px] font-black ${urgency.text}`}><span className={`h-2 w-2 rounded-full ${urgency.dot}`} />{urgency.label}</span>
                      </div>
                      <p className="mt-1 truncate text-xs font-black text-slate-700">{job.assignedTo}</p>
                      <div className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5">
                        <p className="truncate text-xs font-bold text-slate-700">Next: {job.nextAction || "Review job"}</p>
                        <p className="mt-0.5 text-xs font-black text-slate-500">Due: {formatDueDate(job.dueDate)}</p>
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
                <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Job Value<input type="number" value={selectedJob.value} onChange={(event) => updateJob(selectedJob.id, { value: Number(event.target.value) || 0 })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" /></label>
                <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Assigned Rep<input value={selectedJob.assignedTo} onChange={(event) => updateJob(selectedJob.id, { assignedTo: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" /></label>
                <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500 sm:col-span-2">Address<input value={selectedJob.address} onChange={(event) => updateJob(selectedJob.id, { address: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" /></label>
                <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Status<select value={selectedJob.stage} onChange={(event) => updateJobStage(selectedJob.id, event.target.value as LeadStage)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none">{leadStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label>
                <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500">Due Date<input type="date" value={selectedJob.dueDate || ""} onChange={(event) => updateJob(selectedJob.id, { dueDate: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" /></label>
                <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500 sm:col-span-2">Next Action<input value={selectedJob.nextAction || ""} onChange={(event) => updateJob(selectedJob.id, { nextAction: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" /></label>
                <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500 sm:col-span-2">Notes<textarea value={selectedJob.lastActivity} onChange={(event) => updateJob(selectedJob.id, { lastActivity: event.target.value })} rows={4} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" /></label>
              </div>

              <div className="space-y-3">
                {fileError && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{fileError}</p>}

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-black text-[#07183f]"><FileText className="h-4 w-4" />Documents</div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{jobDocuments.length} file(s)</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#07183f] px-3 py-2.5 text-xs font-black text-white transition hover:bg-blue-800 ${fileBusy ? "pointer-events-none opacity-60" : ""}`}>
                      <Camera className="h-4 w-4" /> Take Picture
                      <input type="file" accept="image/*" capture="environment" multiple className="hidden" disabled={fileBusy} onChange={(event) => { const input = event.currentTarget; void handleJobFileUpload("Documents", input.files).finally(() => { input.value = ""; }); }} />
                    </label>
                    <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-blue-300 bg-blue-50 px-3 py-2.5 text-xs font-black text-blue-700 transition hover:bg-blue-100 ${fileBusy ? "pointer-events-none opacity-60" : ""}`}>
                      <UploadCloud className="h-4 w-4" /> Upload
                      <input type="file" accept="image/*" multiple className="hidden" disabled={fileBusy} onChange={(event) => { const input = event.currentTarget; void handleJobFileUpload("Documents", input.files).finally(() => { input.value = ""; }); }} />
                    </label>
                  </div>
                  {jobDocuments.length > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {jobDocuments.map((file) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={file.id} src={file.dataUrl} alt={file.name} className="h-20 w-full rounded-lg border border-slate-200 object-cover" />
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-[11px] font-bold text-slate-400">Auto-saved to Files → {selectedJob.address || "job"} folder.</p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-black text-[#07183f]"><Image className="h-4 w-4" />Photos</div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{jobPhotosOnly.length} photo(s)</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#07183f] px-3 py-2.5 text-xs font-black text-white transition hover:bg-blue-800 ${fileBusy ? "pointer-events-none opacity-60" : ""}`}>
                      <Camera className="h-4 w-4" /> Take Photo
                      <input type="file" accept="image/*" capture="environment" multiple className="hidden" disabled={fileBusy} onChange={(event) => { const input = event.currentTarget; void handleJobFileUpload("Photos", input.files).finally(() => { input.value = ""; }); }} />
                    </label>
                    <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-blue-300 bg-blue-50 px-3 py-2.5 text-xs font-black text-blue-700 transition hover:bg-blue-100 ${fileBusy ? "pointer-events-none opacity-60" : ""}`}>
                      <UploadCloud className="h-4 w-4" /> Upload
                      <input type="file" accept="image/*" multiple className="hidden" disabled={fileBusy} onChange={(event) => { const input = event.currentTarget; void handleJobFileUpload("Photos", input.files).finally(() => { input.value = ""; }); }} />
                    </label>
                  </div>
                  {jobPhotosOnly.length > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {jobPhotosOnly.map((photo) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={photo.id} src={photo.dataUrl} alt={photo.name} className="h-20 w-full rounded-lg border border-slate-200 object-cover" />
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-[11px] font-bold text-slate-400">Shown here and auto-saved to Files → {selectedJob.address || "job"} folder.</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <button type="button" onClick={() => openBoardFromJob("/crm/proposals")} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left font-black text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                    <DollarSign className="h-5 w-5" />Estimates
                  </button>
                  <button type="button" onClick={() => openBoardFromJob("/crm/invoices")} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left font-black text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                    <CheckCircle2 className="h-5 w-5" />Invoices
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
      <PhotoAnnotator key={annotatorKey} images={annotatorImages} onComplete={handleAnnotatorComplete} onCancel={() => setAnnotatorImages(null)} />
    </div>
  );
}
