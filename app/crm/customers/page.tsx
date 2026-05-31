"use client";

import { useEffect, useMemo, useState } from "react";
import { Edit3, Mail, MapPin, Phone, Plus, Search, ShieldCheck, UploadCloud, X } from "lucide-react";
import { customers } from "@/lib/crm-data";
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
  if (!savedJobs) return [];

  try {
    return JSON.parse(savedJobs) as Lead[];
  } catch {
    return [];
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
      (customer.phone && customer.phone === nextCustomer.phone)
    );

    if (matchingIndex === -1) return [...mergedCustomers, nextCustomer];

    const currentCustomer = mergedCustomers[matchingIndex];
    mergedCustomers[matchingIndex] = { ...nextCustomer, ...currentCustomer };
    return mergedCustomers;
  }, []);
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
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
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

  const filteredCustomers = useMemo(() => {
    const query = search.toLowerCase().trim();

    if (!query) return customerList;

    return customerList.filter((customer) =>
      [customer.name, customer.email, customer.phone, customer.propertyAddress, customer.roofDetails, customer.insuranceCarrier, customer.status]
        .some((value) => value.toLowerCase().includes(query))
    );
  }, [customerList, search]);

  useEffect(() => {
    function refreshCustomers() {
      setCustomerList(loadCustomerDashboardRecords());
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
          <p className="mt-2 text-slate-600">Central profiles for contact details, property data, roof details, insurance, notes, files, and timelines.</p>
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
        <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-12 pr-4 outline-none" placeholder="Search customers, addresses, carriers..." />
      </div>

      <div className="grid gap-3 lg:grid-cols-3 2xl:grid-cols-4">
        {filteredCustomers.map((customer) => (
          <article key={customer.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-xl">
            {editingCustomerId === customer.id && editForm ? (
              <form onSubmit={handleSaveCustomer} className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-black text-[#07183f]">Edit customer</h2>
                  <button type="button" onClick={() => { setEditingCustomerId(null); setEditForm(null); }} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
                </div>
                <input required value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Customer name" />
                <input type="email" value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Email" />
                <input value={editForm.phone} onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Phone" />
                <input required value={editForm.propertyAddress} onChange={(event) => setEditForm({ ...editForm, propertyAddress: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Property address" />
                <input value={editForm.roofDetails} onChange={(event) => setEditForm({ ...editForm, roofDetails: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Roof details" />
                <input value={editForm.insuranceCarrier} onChange={(event) => setEditForm({ ...editForm, insuranceCarrier: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Insurance carrier" />
                <input value={editForm.status} onChange={(event) => setEditForm({ ...editForm, status: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Status" />
                <input type="number" value={editForm.lifetimeValue} onChange={(event) => setEditForm({ ...editForm, lifetimeValue: Number(event.target.value) || 0 })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Lifetime value" />
                <button className="w-full rounded-xl bg-[#07183f] px-4 py-2 text-sm font-bold text-white">Save changes</button>
              </form>
            ) : (
            <>
            <div className="bg-gradient-to-br from-[#07183f] to-[#173c8f] p-3 text-white">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold text-orange-300">{customer.id}</p>
                  <h2 className="mt-0.5 text-base font-black">{customer.name}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold ring-1 ring-white/15">{customer.status}</span>
                  <button type="button" onClick={() => handleEditCustomer(customer)} className="rounded-lg bg-white/10 p-1.5 text-white hover:bg-white/20"><Edit3 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            </div>
            <div className="space-y-2 p-3">
              <div className="space-y-1 text-[11px] text-slate-600">
                <p className="flex items-center gap-1.5"><Mail className="h-3 w-3 text-orange-500" />{customer.email}</p>
                <p className="flex items-center gap-1.5"><Phone className="h-3 w-3 text-orange-500" />{customer.phone}</p>
                <p className="flex items-start gap-1.5"><MapPin className="mt-0.5 h-3 w-3 text-orange-500" />{customer.propertyAddress}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Roof details</p>
                <p className="mt-1 text-xs font-semibold text-slate-900">{customer.roofDetails}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-lg bg-orange-50 p-2.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-orange-600" />
                  <p className="mt-1 text-slate-500">Insurance</p>
                  <p className="font-black text-[#07183f]">{customer.insuranceCarrier}</p>
                </div>
                <div className="rounded-lg bg-blue-50 p-2.5">
                  <UploadCloud className="h-3.5 w-3.5 text-blue-700" />
                  <p className="mt-1 text-slate-500">Files</p>
                  <p className="font-black text-[#07183f]">Photos + docs</p>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                <span className="text-[11px] text-slate-500">Lifetime value</span>
                <span className="text-base font-black text-[#07183f]">${customer.lifetimeValue.toLocaleString()}</span>
              </div>
            </div>
            </>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
