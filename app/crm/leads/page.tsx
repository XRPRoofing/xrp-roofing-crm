"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Filter, GripVertical, MessageSquare, MoreHorizontal, Phone, Plus, Search, StickyNote, X } from "lucide-react";
import { customers, leadStages, leads } from "@/lib/crm-data";
import type { Customer, Lead, LeadStage } from "@/types/crm";

const jobAges = ["Now", "+ 1 day", "+ 5 days", "+ 12 days", "+ 47 days", "+ 94 days"];
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
const jobsStorageKey = "xrp-crm-jobs-board";
const customersStorageKey = "xrp-crm-customers";

const badgeStyles = [
  "bg-blue-50 text-blue-700 ring-blue-100",
  "bg-emerald-50 text-emerald-700 ring-emerald-100",
  "bg-orange-50 text-orange-700 ring-orange-100",
  "bg-violet-50 text-violet-700 ring-violet-100",
];

function getFundingType(job: Lead) {
  return job.source.toLowerCase().includes("insurance") || job.value > 30000 ? "Insurance" : "Cash";
}

function getPriority(job: Lead) {
  if (job.value >= 70000) return "Urgent";
  if (job.value >= 30000) return "High";
  if (job.stage === "in_progress") return "Active";
  return "Normal";
}

function JobBadge({ label, index }: { label: string; index: number }) {
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ring-1 ${badgeStyles[index % badgeStyles.length]}`}>{label}</span>;
}

function CardAction({ icon: Icon, label }: { icon: typeof Phone; label: string }) {
  return (
    <button type="button" className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1.5 text-[11px] font-black text-slate-600 ring-1 ring-slate-200 transition hover:bg-blue-50 hover:text-blue-700 hover:ring-blue-100">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function getCityFromAddress(address: string) {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : "Phoenix";
}

function saveJobs(nextJobs: Lead[]) {
  window.localStorage.setItem(jobsStorageKey, JSON.stringify(nextJobs));
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
  const [jobs, setJobs] = useState<Lead[]>(() => {
    if (typeof window === "undefined") return leads;

    const savedJobs = window.localStorage.getItem(jobsStorageKey);
    if (!savedJobs) return leads;

    try {
      return JSON.parse(savedJobs) as Lead[];
    } catch {
      return leads;
    }
  });
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [draggedJobId, setDraggedJobId] = useState<string | null>(null);
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
  });

  const filteredJobs = useMemo(() => {
    const query = search.toLowerCase().trim();

    if (!query) return jobs;

    return jobs.filter((job) =>
      [job.name, job.address, job.city, job.roofType, job.source, job.assignedTo, job.lastActivity]
        .some((value) => value.toLowerCase().includes(query))
    );
  }, [jobs, search]);

  useEffect(() => {
    window.localStorage.setItem(jobsStorageKey, JSON.stringify(jobs));
  }, [jobs]);

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

  function updateJobStage(jobId: string, stage: LeadStage) {
    setJobs((currentJobs) => {
      const nextJobs = currentJobs.map((job) => job.id === jobId ? { ...job, stage, lastActivity: `Moved to ${leadStages.find((item) => item.id === stage)?.label || "workflow"}` } : job);
      saveJobs(nextJobs);
      return nextJobs;
    });
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
    };

    setJobs((currentJobs) => {
      const nextJobs = [newJob, ...currentJobs];
      saveJobs(nextJobs);
      return nextJobs;
    });
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
    });
    setShowForm(false);
  }

  return (
    <div className="-mx-4 -my-6 min-h-[calc(100vh-5rem)] bg-slate-100 px-4 py-6 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="sticky top-20 z-30 space-y-5 border-b border-slate-200/80 bg-slate-100/95 pb-5 pt-1 backdrop-blur">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-600">Roofing operations</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-[#07183f]">Jobs board</h1>
            <p className="mt-2 max-w-2xl text-sm font-medium text-slate-600">A clean production pipeline for inspections, estimates, insurance review, active installs, and completed roofing jobs.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setSearch("")} className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 shadow-sm transition hover:border-blue-200 hover:text-blue-700"><Filter className="mr-2 h-4 w-4" />Clear filters</button>
            <button onClick={() => setShowForm(true)} className="inline-flex items-center rounded-2xl bg-orange-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-orange-200 transition hover:bg-orange-600"><Plus className="mr-2 h-4 w-4" />Add job</button>
          </div>
        </div>

        {showForm && (
          <form onSubmit={handleAddJob} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-black text-[#07183f]">Add new job</h2>
              <button type="button" onClick={() => setShowForm(false)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Customer / job name" />
              <input ref={addressInputRef} required value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none md:col-span-2" placeholder="Job address" />
              <input value={form.roofType} onChange={(event) => setForm({ ...form, roofType: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Roof type" />
              <input type="number" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Job value" />
              <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Email" />
              <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Phone" />
              <input value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Source" />
              <input value={form.assignedTo} onChange={(event) => setForm({ ...form, assignedTo: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Assigned to" />
              <input value={form.lastActivity} onChange={(event) => setForm({ ...form, lastActivity: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none md:col-span-2" placeholder="Current note" />
            </div>
            <button className="mt-4 rounded-2xl bg-[#07183f] px-5 py-3 font-bold text-white">Save job</button>
          </form>
        )}

        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_180px_180px]">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white py-3.5 pl-12 pr-4 text-sm font-semibold text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-50" placeholder="Search address, customer, city, roof type, source..." />
          </div>
          <select className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-bold text-slate-600 shadow-sm outline-none">
            <option>All roof types</option>
          </select>
          <select className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-bold text-slate-600 shadow-sm outline-none">
            <option>All assignees</option>
          </select>
        </div>
      </div>

      <div className="mt-6 flex gap-5 overflow-x-auto pb-6">
        {leadStages.map((stage) => {
          const stageJobs = filteredJobs.filter((job) => job.stage === stage.id);
          const stageValue = stageJobs.reduce((total, job) => total + job.value, 0);
          return (
            <section key={stage.id} onDragOver={(event) => event.preventDefault()} onDrop={() => draggedJobId && updateJobStage(draggedJobId, stage.id)} className="flex max-h-[calc(100vh-18rem)] min-h-[34rem] w-[22rem] shrink-0 flex-col rounded-[1.75rem] border border-slate-200 bg-slate-50/90 p-3 shadow-sm">
              <div className="sticky top-0 z-10 mb-3 shrink-0 rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-black uppercase tracking-wide text-[#07183f]">{stage.label}</h2>
                    <p className="mt-1 text-xs font-bold text-slate-500">{stageJobs.length} jobs · ${stageValue.toLocaleString()}</p>
                  </div>
                  <button className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><MoreHorizontal className="h-5 w-5" /></button>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-1 pb-1">
                {stageJobs.map((job, index) => (
                  <article key={job.id} draggable onDragStart={() => setDraggedJobId(job.id)} onDragEnd={() => setDraggedJobId(null)} className="group cursor-grab rounded-3xl border border-slate-200 bg-white p-4 text-sm shadow-sm transition hover:-translate-y-0.5 hover:border-blue-100 hover:shadow-xl active:cursor-grabbing">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base font-black leading-snug text-slate-950">{job.address}</p>
                        <p className="mt-1 truncate text-xs font-bold text-slate-500">{job.name} · {job.city}, AZ</p>
                      </div>
                      <GripVertical className="mt-1 h-4 w-4 shrink-0 text-slate-300" />
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <JobBadge label={job.roofType} index={0} />
                      <JobBadge label={job.source} index={1} />
                      <JobBadge label={getFundingType(job)} index={2} />
                      <JobBadge label={getPriority(job)} index={3} />
                    </div>

                    <div className="mt-4 grid gap-2 border-t border-slate-100 pt-3 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-bold text-slate-500">Assigned</span>
                        <span className="truncate font-black text-[#07183f]">{job.assignedTo}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-bold text-slate-500">Updated</span>
                        <span className={index % 3 === 0 ? "font-black text-orange-600" : "font-bold text-slate-600"}>{jobAges[index % jobAges.length]}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-bold text-slate-500">Value</span>
                        <span className="font-black text-slate-900">${job.value.toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2 opacity-100 transition md:opacity-0 md:group-hover:opacity-100">
                      <CardAction icon={Phone} label="Call" />
                      <CardAction icon={MessageSquare} label="SMS" />
                      <CardAction icon={CalendarDays} label="Schedule" />
                      <CardAction icon={StickyNote} label="Notes" />
                    </div>
                  </article>
                ))}
                {stageJobs.length === 0 && (
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">Drop jobs here</div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
