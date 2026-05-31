"use client";

import { useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, CalendarCheck2, CalendarPlus, Edit3, FileText, Image as ImageIcon, Mail, MapPin, Phone, Plus, Search, ShieldCheck, UploadCloud, X } from "lucide-react";
import { customers, leadStages, leads } from "@/lib/crm-data";
import type { Customer, Lead } from "@/types/crm";

const customersStorageKey = "xrp-crm-customers";
const jobsStorageKey = "xrp-crm-jobs-board";

function saveCustomers(nextCustomers: Customer[]) {
  window.localStorage.setItem(customersStorageKey, JSON.stringify(nextCustomers));
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

function getSavedJobs() {
  const savedJobs = window.localStorage.getItem(jobsStorageKey);
  if (!savedJobs) return leads;

  try {
    return JSON.parse(savedJobs) as Lead[];
  } catch {
    return leads;
  }
}

function customerFromJob(job: Lead): Customer {
  return {
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
}

function mergeCustomerList(savedCustomers: Customer[], jobCustomers: Customer[]) {
  return [...jobCustomers, ...savedCustomers].reduce<Customer[]>((mergedCustomers, nextCustomer) => {
    const matchingIndex = mergedCustomers.findIndex((customer) =>
      customer.id === nextCustomer.id ||
      (customer.email && customer.email === nextCustomer.email) ||
      (customer.phone && customer.phone === nextCustomer.phone) ||
      customer.name.toLowerCase() === nextCustomer.name.toLowerCase()
    );

    if (matchingIndex === -1) return [...mergedCustomers, nextCustomer];

    const currentCustomer = mergedCustomers[matchingIndex];
    mergedCustomers[matchingIndex] = { ...nextCustomer, ...currentCustomer };
    return mergedCustomers;
  }, []);
}

function getCustomerJobs(customer: Customer, jobs: Lead[]) {
  return jobs.filter((job) =>
    customer.id === `C-${job.id}` ||
    job.email === customer.email ||
    job.phone === customer.phone ||
    job.name.toLowerCase() === customer.name.toLowerCase()
  );
}

function formatDate(value?: string) {
  if (!value) return "Not available";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getJobAddedDate(job?: Lead) {
  if (!job) return "Not available";
  const timestamp = Number(job.id.replace(/\D/g, ""));
  if (timestamp > 1000000000000) return formatDate(new Date(timestamp).toISOString().slice(0, 10));
  return job.dueDate ? formatDate(job.dueDate) : "Imported record";
}

function getJobCompletedDate(jobs: Lead[]) {
  const completedJob = jobs.find((job) => ["completed", "paid"].includes(job.stage));
  return completedJob?.dueDate ? formatDate(completedJob.dueDate) : "Not completed";
}

function getStageLabel(job: Lead) {
  return leadStages.find((stage) => stage.id === job.stage)?.label || job.stage.replace(/_/g, " ");
}

function loadCustomerDashboardRecords() {
  const savedCustomers = getSavedCustomers();
  const jobCustomers = getSavedJobs().map(customerFromJob);

  return mergeCustomerList(savedCustomers, jobCustomers);
}

export default function CustomersPage() {
  const [customerList, setCustomerList] = useState<Customer[]>(() => {
    if (typeof window === "undefined") return customers;
    return loadCustomerDashboardRecords();
  });
  const [jobList, setJobList] = useState<Lead[]>(() => {
    if (typeof window === "undefined") return leads;
    return getSavedJobs();
  });
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Customer | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    propertyAddress: "",
    roofDetails: "",
    insuranceCarrier: "",
    status: "New customer",
    lifetimeValue: "",
  });

  const selectedCustomer = customerList.find((customer) => customer.id === selectedCustomerId) || null;
  const selectedCustomerJobs = selectedCustomer ? getCustomerJobs(selectedCustomer, jobList) : [];

  const filteredCustomers = useMemo(() => {
    const query = search.toLowerCase().trim();

    if (!query) return customerList;

    return customerList.filter((customer) => {
      const relatedJobs = getCustomerJobs(customer, jobList);
      return [customer.name, ...relatedJobs.map((job) => `${job.name} ${job.city} ${job.stage} ${job.roofType}`)]
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [customerList, jobList, search]);

  useEffect(() => {
    function refreshCustomers() {
      setCustomerList(loadCustomerDashboardRecords());
      setJobList(getSavedJobs());
    }

    window.addEventListener("storage", refreshCustomers);
    window.addEventListener("focus", refreshCustomers);

    return () => {
      window.removeEventListener("storage", refreshCustomers);
      window.removeEventListener("focus", refreshCustomers);
    };
  }, []);

  function handleAddCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const shouldKeepAdding = submitter?.value === "add-another";

    const newCustomer: Customer = {
      id: `C-${Date.now()}`,
      name: form.name,
      email: form.email || "customer@xrproofing.com",
      phone: form.phone || "(602) 555-0000",
      propertyAddress: form.propertyAddress || "Address pending",
      roofDetails: form.roofDetails || "Roof details pending",
      insuranceCarrier: form.insuranceCarrier || "Not provided",
      status: form.status || "New customer",
      lifetimeValue: Number(form.lifetimeValue) || 0,
    };

    setCustomerList((currentCustomers) => {
      const nextCustomers = [newCustomer, ...currentCustomers];
      saveCustomers(nextCustomers);
      return nextCustomers;
    });
    setForm({
      name: "",
      email: "",
      phone: "",
      propertyAddress: "",
      roofDetails: "",
      insuranceCarrier: "",
      status: "New customer",
      lifetimeValue: "",
    });
    setShowForm(shouldKeepAdding);
  }

  function handleEditCustomer(customer: Customer) {
    setEditingCustomerId(customer.id);
    setEditForm(customer);
  }

  function handleSaveCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editForm) return;

    setCustomerList((currentCustomers) => {
      const nextCustomers = currentCustomers.map((customer) => customer.id === editForm.id ? editForm : customer);
      saveCustomers(nextCustomers);
      return nextCustomers;
    });
    setEditingCustomerId(null);
    setEditForm(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-orange-600">Customer Records</p>
          <h1 className="mt-2 text-3xl font-black text-[#07183f]">Customers</h1>
          <p className="mt-2 text-slate-600">Clean customer timeline tracking. Click any customer to drill into contact details, jobs, roof info, insurance, and files.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="w-fit rounded-2xl bg-orange-500 px-4 py-3 font-bold text-white shadow-lg shadow-orange-200"><Plus className="mr-2 inline h-4 w-4" />Add customer</button>
      </div>

      {showForm && (
        <form onSubmit={handleAddCustomer} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-black text-[#07183f]">Add new customer</h2>
            <button type="button" onClick={() => setShowForm(false)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Customer name" />
            <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Email" />
            <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Phone" />
            <input value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Status" />
            <input required value={form.propertyAddress} onChange={(event) => setForm({ ...form, propertyAddress: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none md:col-span-2" placeholder="Property address" />
            <input value={form.insuranceCarrier} onChange={(event) => setForm({ ...form, insuranceCarrier: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Insurance carrier" />
            <input type="number" value={form.lifetimeValue} onChange={(event) => setForm({ ...form, lifetimeValue: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Lifetime value" />
            <input value={form.roofDetails} onChange={(event) => setForm({ ...form, roofDetails: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none md:col-span-2" placeholder="Roof details" />
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button value="save" className="rounded-2xl bg-[#07183f] px-5 py-3 font-bold text-white">Save customer</button>
            <button value="add-another" className="rounded-2xl bg-orange-500 px-5 py-3 font-bold text-white">Save + add another</button>
          </div>
        </form>
      )}

      <div className="relative max-w-xl">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-12 pr-4 outline-none" placeholder="Search customer name or related jobs..." />
      </div>

      <div className="grid gap-3 lg:grid-cols-3 2xl:grid-cols-4">
        {filteredCustomers.map((customer) => {
          const relatedJobs = getCustomerJobs(customer, jobList);
          const primaryJob = relatedJobs[0];
          return (
            <button key={customer.id} type="button" onClick={() => setSelectedCustomerId(customer.id)} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-xl">
              <h2 className="text-lg font-black text-[#07183f]">{customer.name}</h2>
              <div className="mt-4 grid gap-3 text-sm">
                <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                  <CalendarPlus className="h-5 w-5 text-orange-500" />
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-slate-500">Date Job Added</p>
                    <p className="font-bold text-slate-900">{getJobAddedDate(primaryJob)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                  <CalendarCheck2 className="h-5 w-5 text-emerald-600" />
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-slate-500">Date Job Completed</p>
                    <p className="font-bold text-slate-900">{getJobCompletedDate(relatedJobs)}</p>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {selectedCustomer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-sm" onClick={() => setSelectedCustomerId(null)}>
          <aside className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-600">Customer profile</p>
                  <h2 className="mt-1 text-2xl font-black text-[#07183f]">{selectedCustomer.name}</h2>
                  <p className="text-sm font-bold text-slate-500">{selectedCustomerJobs.length} related job{selectedCustomerJobs.length === 1 ? "" : "s"}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => handleEditCustomer(selectedCustomer)} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-100"><Edit3 className="h-5 w-5" /></button>
                  <button type="button" onClick={() => setSelectedCustomerId(null)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
                </div>
              </div>
            </div>

            <div className="space-y-5 p-5">
              {editingCustomerId === selectedCustomer.id && editForm ? (
                <form onSubmit={handleSaveCustomer} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
                  <input required value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Customer name" />
                  <input type="email" value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Email" />
                  <input value={editForm.phone} onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Phone" />
                  <input value={editForm.status} onChange={(event) => setEditForm({ ...editForm, status: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Status" />
                  <input required value={editForm.propertyAddress} onChange={(event) => setEditForm({ ...editForm, propertyAddress: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none sm:col-span-2" placeholder="Property address" />
                  <input value={editForm.roofDetails} onChange={(event) => setEditForm({ ...editForm, roofDetails: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Roof details" />
                  <input value={editForm.insuranceCarrier} onChange={(event) => setEditForm({ ...editForm, insuranceCarrier: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Insurance carrier" />
                  <input type="number" value={editForm.lifetimeValue} onChange={(event) => setEditForm({ ...editForm, lifetimeValue: Number(event.target.value) || 0 })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Lifetime value" />
                  <button className="rounded-xl bg-[#07183f] px-4 py-2 text-sm font-bold text-white">Save changes</button>
                </form>
              ) : null}

              <section className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-4"><Phone className="h-5 w-5 text-orange-500" /><p className="mt-2 text-xs font-black uppercase text-slate-500">Phone Number</p><p className="font-bold text-slate-900">{selectedCustomer.phone}</p></div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4"><Mail className="h-5 w-5 text-orange-500" /><p className="mt-2 text-xs font-black uppercase text-slate-500">Email Address</p><p className="font-bold text-slate-900">{selectedCustomer.email}</p></div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:col-span-2"><MapPin className="h-5 w-5 text-orange-500" /><p className="mt-2 text-xs font-black uppercase text-slate-500">Full Property Address</p><p className="font-bold text-slate-900">{selectedCustomer.propertyAddress}</p></div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2"><BriefcaseBusiness className="h-5 w-5 text-blue-700" /><h3 className="text-lg font-black text-[#07183f]">Related Jobs</h3></div>
                <div className="mt-4 space-y-3">
                  {selectedCustomerJobs.length > 0 ? selectedCustomerJobs.map((job) => (
                    <div key={job.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                        <div>
                          <p className="font-black text-slate-900">{job.roofType}</p>
                          <p className="text-sm font-bold text-slate-500">{getStageLabel(job)} • {job.city}, AZ</p>
                        </div>
                        <p className="font-black text-[#07183f]">${job.value.toLocaleString()}</p>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs font-bold text-slate-600 sm:grid-cols-3">
                        <p>Added: {getJobAddedDate(job)}</p>
                        <p>Due: {formatDate(job.dueDate)}</p>
                        <p>Completed: {getJobCompletedDate([job])}</p>
                      </div>
                    </div>
                  )) : <p className="rounded-xl bg-slate-50 p-4 text-sm font-bold text-slate-500">No related jobs found yet.</p>}
                </div>
              </section>

              <section className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">Roof details</p><p className="mt-2 font-bold text-slate-900">{selectedCustomer.roofDetails}</p></div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><ShieldCheck className="h-5 w-5 text-orange-600" /><p className="mt-2 text-xs font-black uppercase text-slate-500">Insurance status</p><p className="font-bold text-slate-900">{selectedCustomer.insuranceCarrier}</p></div>
              </section>

              <section className="grid gap-3 sm:grid-cols-3">
                <button type="button" className="rounded-2xl border border-slate-200 bg-white p-4 text-left font-black text-slate-700 transition hover:border-blue-200 hover:bg-blue-50"><ImageIcon className="mb-2 h-5 w-5 text-blue-700" />Photos</button>
                <button type="button" className="rounded-2xl border border-slate-200 bg-white p-4 text-left font-black text-slate-700 transition hover:border-blue-200 hover:bg-blue-50"><FileText className="mb-2 h-5 w-5 text-blue-700" />Documents</button>
                <button type="button" className="rounded-2xl border border-slate-200 bg-white p-4 text-left font-black text-slate-700 transition hover:border-blue-200 hover:bg-blue-50"><UploadCloud className="mb-2 h-5 w-5 text-blue-700" />Upload Files</button>
              </section>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
