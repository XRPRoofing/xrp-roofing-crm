"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Plus, X } from "lucide-react";
import { appointmentTypes } from "@/lib/crm-conversations";
import { findOrCreateCustomer } from "@/lib/customer-sync";

const emptyLead = { name: "", phone: "", email: "", propertyAddress: "", roofDetails: "", insuranceCarrier: "" };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function emptySchedule() {
  return { title: "", name: "", phone: "", address: "", jobKind: appointmentTypes[0], date: todayIso(), startTime: "09:00", endTime: "10:00", notes: "" };
}

export default function DashboardHeroActions() {
  const router = useRouter();

  const [leadOpen, setLeadOpen] = useState(false);
  const [leadForm, setLeadForm] = useState(emptyLead);
  const [leadSaving, setLeadSaving] = useState(false);
  const [leadError, setLeadError] = useState("");

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleForm, setScheduleForm] = useState(emptySchedule);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [scheduleDone, setScheduleDone] = useState("");

  function openLead() {
    setLeadForm(emptyLead);
    setLeadError("");
    setLeadOpen(true);
  }

  async function handleSaveLead(event?: React.FormEvent) {
    event?.preventDefault();
    if (!leadForm.name.trim()) {
      setLeadError("Please enter the customer name.");
      return;
    }
    setLeadSaving(true);
    setLeadError("");
    try {
      // Find-or-create so a New lead never duplicates an existing customer
      // (matched by phone -> email -> address) and lands on the Customer board.
      await findOrCreateCustomer({
        name: leadForm.name.trim(),
        email: leadForm.email.trim(),
        phone: leadForm.phone.trim(),
        propertyAddress: leadForm.propertyAddress.trim(),
        roofDetails: leadForm.roofDetails.trim(),
        insuranceCarrier: leadForm.insuranceCarrier.trim(),
        status: "New lead",
        source: "Dashboard",
      });
      setLeadOpen(false);
      router.push("/crm/customers");
    } catch {
      setLeadError("Unable to save the lead. Please try again.");
    } finally {
      setLeadSaving(false);
    }
  }

  function openSchedule() {
    setScheduleForm(emptySchedule());
    setScheduleError("");
    setScheduleDone("");
    setScheduleOpen(true);
  }

  async function handleSaveSchedule(event?: React.FormEvent) {
    event?.preventDefault();
    setScheduleSaving(true);
    setScheduleError("");
    setScheduleDone("");
    try {
      const response = await fetch("/api/google-calendar/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: scheduleForm.title.trim() || `Roof inspection — ${scheduleForm.name.trim() || "New lead"}`,
          name: scheduleForm.name.trim(),
          phone: scheduleForm.phone.trim(),
          address: scheduleForm.address.trim() || scheduleForm.name.trim(),
          jobKind: scheduleForm.jobKind,
          date: scheduleForm.date,
          startTime: scheduleForm.startTime,
          endTime: scheduleForm.endTime,
          notes: scheduleForm.notes,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setScheduleError(data.error || "Unable to create the appointment. Connect Google Calendar on the Calendar board first.");
        return;
      }
      setScheduleDone("Appointment added to the CRM calendar.");
      setTimeout(() => setScheduleOpen(false), 900);
    } catch {
      setScheduleError("Unable to create the appointment.");
    } finally {
      setScheduleSaving(false);
    }
  }

  const inputClass = "rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-300 focus:bg-white";

  return (
    <div className="relative flex flex-wrap gap-3">
      <button type="button" onClick={openLead} className="rounded-2xl bg-orange-500 px-5 py-3 font-bold text-white shadow-lg shadow-orange-950/30 transition hover:bg-orange-600"><Plus className="mr-2 inline h-4 w-4" />New lead</button>
      <button type="button" onClick={openSchedule} className="rounded-2xl bg-white/10 px-5 py-3 font-bold text-white ring-1 ring-white/15 transition hover:bg-white/15">Schedule inspection</button>

      {leadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setLeadOpen(false)}>
          <form onClick={(event) => event.stopPropagation()} onSubmit={handleSaveLead} className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white text-left shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <p className="text-base font-bold text-slate-950">New lead</p>
              <button type="button" onClick={() => setLeadOpen(false)} className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <p className="text-xs text-slate-500">Add a customer — it goes straight to your shared Customers list across all devices.</p>
              <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Name</span><input value={leadForm.name} onChange={(event) => setLeadForm((form) => ({ ...form, name: event.target.value }))} className={inputClass} placeholder="Customer name" autoFocus /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Phone</span><input value={leadForm.phone} onChange={(event) => setLeadForm((form) => ({ ...form, phone: event.target.value }))} className={inputClass} placeholder="(602) 555-0123" /></label>
                <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</span><input value={leadForm.email} onChange={(event) => setLeadForm((form) => ({ ...form, email: event.target.value }))} className={inputClass} placeholder="name@email.com" /></label>
              </div>
              <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Property address</span><input value={leadForm.propertyAddress} onChange={(event) => setLeadForm((form) => ({ ...form, propertyAddress: event.target.value }))} className={inputClass} placeholder="Street, city, AZ" /></label>
              <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Roof details</span><input value={leadForm.roofDetails} onChange={(event) => setLeadForm((form) => ({ ...form, roofDetails: event.target.value }))} className={inputClass} placeholder="Optional" /></label>
              <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Insurance carrier</span><input value={leadForm.insuranceCarrier} onChange={(event) => setLeadForm((form) => ({ ...form, insuranceCarrier: event.target.value }))} className={inputClass} placeholder="Optional" /></label>
              {leadError && <p className="text-sm font-medium text-red-600">{leadError}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button type="button" onClick={() => setLeadOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Cancel</button>
              <button type="submit" className={`rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 ${leadSaving ? "pointer-events-none opacity-60" : ""}`}>{leadSaving ? "Saving…" : "Add lead"}</button>
            </div>
          </form>
        </div>
      )}

      {scheduleOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setScheduleOpen(false)}>
          <form onClick={(event) => event.stopPropagation()} onSubmit={handleSaveSchedule} className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white text-left shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <p className="text-base font-bold text-slate-950"><CalendarPlus className="mr-2 inline h-4 w-4 text-blue-600" />Schedule inspection</p>
              <button type="button" onClick={() => setScheduleOpen(false)} className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <p className="text-xs text-slate-500">Creates an appointment on your CRM Google Calendar — synced to phone, laptop, and computer.</p>
              <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Title</span><input value={scheduleForm.title} onChange={(event) => setScheduleForm((form) => ({ ...form, title: event.target.value }))} className={inputClass} placeholder="Appointment title" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</span><input value={scheduleForm.name} onChange={(event) => setScheduleForm((form) => ({ ...form, name: event.target.value }))} className={inputClass} placeholder="Name" /></label>
                <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Phone</span><input value={scheduleForm.phone} onChange={(event) => setScheduleForm((form) => ({ ...form, phone: event.target.value }))} className={inputClass} placeholder="(602) 555-0123" /></label>
              </div>
              <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Address</span><input value={scheduleForm.address} onChange={(event) => setScheduleForm((form) => ({ ...form, address: event.target.value }))} className={inputClass} placeholder="Property address" /></label>
              <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Type</span><select value={scheduleForm.jobKind} onChange={(event) => setScheduleForm((form) => ({ ...form, jobKind: event.target.value }))} className={inputClass}>{appointmentTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
              <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date</span><input type="date" value={scheduleForm.date} onChange={(event) => setScheduleForm((form) => ({ ...form, date: event.target.value }))} className={inputClass} /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Start</span><input type="time" value={scheduleForm.startTime} onChange={(event) => setScheduleForm((form) => ({ ...form, startTime: event.target.value }))} className={inputClass} /></label>
                <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">End</span><input type="time" value={scheduleForm.endTime} onChange={(event) => setScheduleForm((form) => ({ ...form, endTime: event.target.value }))} className={inputClass} /></label>
              </div>
              <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</span><textarea value={scheduleForm.notes} onChange={(event) => setScheduleForm((form) => ({ ...form, notes: event.target.value }))} rows={3} className={`${inputClass} resize-none`} placeholder="Optional details" /></label>
              {scheduleError && <p className="text-sm font-medium text-red-600">{scheduleError}</p>}
              {scheduleDone && <p className="text-sm font-medium text-emerald-600">{scheduleDone}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button type="button" onClick={() => setScheduleOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Cancel</button>
              <button type="submit" className={`rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 ${scheduleSaving ? "pointer-events-none opacity-60" : ""}`}>{scheduleSaving ? "Saving…" : "Save appointment"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
