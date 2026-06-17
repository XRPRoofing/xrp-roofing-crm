"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  CalendarPlus,
  ChevronDown,
  ClipboardList,
  FileText,
  Plus,
  Ruler,
  UserPlus,
  X,
} from "lucide-react";
import { appointmentTypes } from "@/lib/crm-conversations";
import { findOrCreateCustomer } from "@/lib/customer-sync";
import { leadToJobRecord, upsertJobRecord } from "@/lib/crew-sync";
import { createManualFolder } from "@/lib/manual-folders";
import { upsertTaskToSupabase } from "@/lib/task-sync";
import type { Lead } from "@/types/crm";
import type { OfficeTask } from "@/lib/office-tasks";

/* ── Blank form states ─────────────────────────────────────────────── */

const emptyLead = { name: "", phone: "", email: "", propertyAddress: "", roofDetails: "", insuranceCarrier: "" };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function emptySchedule() {
  return { title: "", name: "", phone: "", address: "", jobKind: appointmentTypes[0], date: todayIso(), startTime: "09:00", endTime: "10:00", notes: "" };
}

const emptyJob = {
  name: "", email: "", phone: "", address: "", roofType: "", source: "Website",
  assignedTo: "", value: "", dueDate: "", notes: "",
};

const emptyProposal = {
  customerName: "", customerEmail: "", customerPhone: "", address: "",
  scope: "Roofing", total: "",
};

const emptyTask = {
  title: "", customerName: "", jobAddress: "", assignedUser: "", dueDate: todayIso(), notes: "",
};

const LEAD_SOURCES = ["AZR", "Google", "Facebook", "Website", "Referral", "Door Knocking", "Yelp", "Angi", "Thumbtack", "Phone Call", "Other"] as const;

/* ── Shared input class ────────────────────────────────────────────── */

const inputClass = "w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100";

/* ── "New" dropdown menu items (Roofr-style) ───────────────────────── */

type NewAction = "job" | "report" | "proposal" | "contact" | "task";

const newActions: { id: NewAction; label: string; description: string; icon: typeof Briefcase }[] = [
  { id: "job",      label: "Job",      description: "Create a card on the CRM board", icon: Briefcase },
  { id: "report",   label: "Report",   description: "Get a measurement report in hours", icon: Ruler },
  { id: "proposal", label: "Proposal", description: "Convert reports into customer proposals", icon: FileText },
  { id: "contact",  label: "Contact",  description: "Add new contacts to XRP Roofing", icon: UserPlus },
  { id: "task",     label: "Task",     description: "Create a new task for a team member", icon: ClipboardList },
];

/* ── Component ─────────────────────────────────────────────────────── */

export default function DashboardHeroActions() {
  const router = useRouter();

  /* Dropdown state */
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /* Contact modal */
  const [leadOpen, setLeadOpen] = useState(false);
  const [leadForm, setLeadForm] = useState(emptyLead);
  const [leadSaving, setLeadSaving] = useState(false);
  const [leadError, setLeadError] = useState("");

  /* Schedule modal */
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleForm, setScheduleForm] = useState(emptySchedule);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [scheduleDone, setScheduleDone] = useState("");

  /* Job modal */
  const [jobOpen, setJobOpen] = useState(false);
  const [jobForm, setJobForm] = useState(emptyJob);
  const [jobSaving, setJobSaving] = useState(false);
  const [jobError, setJobError] = useState("");

  /* Proposal modal */
  const [proposalOpen, setProposalOpen] = useState(false);
  const [proposalForm, setProposalForm] = useState(emptyProposal);
  const [proposalSaving, setProposalSaving] = useState(false);
  const [proposalError, setProposalError] = useState("");

  /* Task modal */
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskForm, setTaskForm] = useState(emptyTask);
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskError, setTaskError] = useState("");

  /* Close dropdown on outside click */
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  /* ── Action handlers ───────────────────────────────────────────── */

  function handleNewAction(action: NewAction) {
    setMenuOpen(false);
    if (action === "job") {
      setJobForm(emptyJob);
      setJobError("");
      setJobOpen(true);
    } else if (action === "report") {
      router.push("/crm/estimates");
    } else if (action === "proposal") {
      setProposalForm(emptyProposal);
      setProposalError("");
      setProposalOpen(true);
    } else if (action === "contact") {
      openLead();
    } else if (action === "task") {
      setTaskForm({ ...emptyTask, dueDate: todayIso() });
      setTaskError("");
      setTaskOpen(true);
    }
  }

  /* Contact (existing lead flow) */
  function openLead() {
    setLeadForm(emptyLead);
    setLeadError("");
    setLeadOpen(true);
  }

  async function handleSaveLead(event?: React.FormEvent) {
    event?.preventDefault();
    if (!leadForm.name.trim()) { setLeadError("Please enter the customer name."); return; }
    setLeadSaving(true);
    setLeadError("");
    try {
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
      setLeadError("Unable to save the contact. Please try again.");
    } finally {
      setLeadSaving(false);
    }
  }

  /* Schedule inspection */
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

  /* Job creation */
  async function handleSaveJob(event?: React.FormEvent) {
    event?.preventDefault();
    if (!jobForm.name.trim()) { setJobError("Customer name is required."); return; }
    setJobSaving(true);
    setJobError("");
    try {
      const newJob: Lead = {
        id: `J-${Date.now()}`,
        name: jobForm.name.trim(),
        email: jobForm.email.trim() || "crm@xrproofing.com",
        phone: jobForm.phone.trim() || "(602) 555-0000",
        address: jobForm.address.trim() || "Address pending",
        city: "",
        stage: "new_lead",
        value: Number(jobForm.value) || 0,
        assignedTo: jobForm.assignedTo.trim(),
        roofType: jobForm.roofType.trim() || "Roofing",
        source: jobForm.source || "Website",
        lastActivity: "New job created",
        nextAction: "Schedule inspection",
        dueDate: jobForm.dueDate || undefined,
      };
      await upsertJobRecord(leadToJobRecord(newJob));
      const folderName = `${newJob.name} - ${newJob.address}`.trim();
      void createManualFolder({ name: folderName, address: newJob.address, customerName: newJob.name, workType: newJob.roofType }).catch(() => {});
      await findOrCreateCustomer({
        name: newJob.name,
        email: newJob.email,
        phone: newJob.phone,
        propertyAddress: newJob.address,
        roofDetails: newJob.roofType,
        status: "New lead",
        source: "Dashboard",
      });
      setJobOpen(false);
      router.push("/crm/leads");
    } catch {
      setJobError("Unable to create job. Please try again.");
    } finally {
      setJobSaving(false);
    }
  }

  /* Proposal creation */
  async function handleSaveProposal(event?: React.FormEvent) {
    event?.preventDefault();
    if (!proposalForm.customerName.trim()) { setProposalError("Customer name is required."); return; }
    setProposalSaving(true);
    setProposalError("");
    try {
      const proposalId = `P-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const proposal = {
        id: proposalId,
        customerName: proposalForm.customerName.trim(),
        customerEmail: proposalForm.customerEmail.trim(),
        customerPhone: proposalForm.customerPhone.trim(),
        address: proposalForm.address.trim(),
        scope: proposalForm.scope.trim() || "Roofing",
        title: `Proposal — ${proposalForm.customerName.trim()}`,
        total: Number(proposalForm.total) || 0,
        status: "Draft",
        createdAt: new Date().toISOString(),
      };
      await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proposal),
      });
      await findOrCreateCustomer({
        name: proposal.customerName,
        email: proposal.customerEmail,
        phone: proposal.customerPhone,
        propertyAddress: proposal.address,
        status: "Proposal sent",
        source: "Dashboard",
      });
      setProposalOpen(false);
      router.push("/crm/proposals");
    } catch {
      setProposalError("Unable to create proposal. Please try again.");
    } finally {
      setProposalSaving(false);
    }
  }

  /* Task creation */
  async function handleSaveTask(event?: React.FormEvent) {
    event?.preventDefault();
    if (!taskForm.title.trim()) { setTaskError("Task title is required."); return; }
    setTaskSaving(true);
    setTaskError("");
    try {
      const now = new Date().toISOString();
      const task: OfficeTask = {
        id: `T-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        jobId: "",
        title: taskForm.title.trim(),
        customerName: taskForm.customerName.trim(),
        jobAddress: taskForm.jobAddress.trim(),
        invoiceAmount: "",
        assignedUser: taskForm.assignedUser.trim(),
        dueDate: taskForm.dueDate || todayIso(),
        status: "Job Scheduled",
        jobLink: "",
        createdAt: now,
        updatedAt: now,
        timeline: [{ id: `te-${Date.now()}`, event: "Task created from Dashboard", at: now }],
      };
      await upsertTaskToSupabase(task);
      setTaskOpen(false);
      router.push("/crm/tasks");
    } catch {
      setTaskError("Unable to create task. Please try again.");
    } finally {
      setTaskSaving(false);
    }
  }

  /* ── Render ────────────────────────────────────────────────────── */

  return (
    <div className="relative flex flex-wrap gap-2">
      {/* Roofr-style "+ New" dropdown */}
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.97]"
        >
          <Plus className="h-4 w-4" />
          New
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
        </button>

        {menuOpen && (
          <div className="absolute left-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl animate-in fade-in slide-in-from-top-2">
            {newActions.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => handleNewAction(a.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-gray-50 active:bg-gray-100"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-gray-900">{a.label}</span>
                    <span className="block text-xs text-gray-500">{a.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick action: Schedule Inspection */}
      <button type="button" onClick={openSchedule} className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 active:scale-[0.97]">
        <CalendarPlus className="mr-1.5 inline h-4 w-4" />Schedule inspection
      </button>

      {/* ── Contact modal ──────────────────────────────────────────── */}
      {leadOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-8 sm:items-center sm:pt-4" onClick={() => setLeadOpen(false)}>
          <form onClick={(event) => event.stopPropagation()} onSubmit={handleSaveLead} className="flex max-h-[85vh] w-full max-w-md shrink-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-xl sm:max-h-[88vh]">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <p className="text-base font-semibold text-gray-900"><UserPlus className="mr-2 inline h-4 w-4 text-blue-600" />New Contact</p>
              <button type="button" onClick={() => setLeadOpen(false)} className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <p className="text-xs text-gray-500">Add a customer — syncs to Customers across all devices.</p>
              <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Name *</span><input value={leadForm.name} onChange={(event) => setLeadForm((f) => ({ ...f, name: event.target.value }))} className={inputClass} placeholder="Customer name" autoFocus /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Phone</span><input value={leadForm.phone} onChange={(event) => setLeadForm((f) => ({ ...f, phone: event.target.value }))} className={inputClass} placeholder="(602) 555-0123" /></label>
                <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Email</span><input value={leadForm.email} onChange={(event) => setLeadForm((f) => ({ ...f, email: event.target.value }))} className={inputClass} placeholder="name@email.com" /></label>
              </div>
              <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Property address</span><input value={leadForm.propertyAddress} onChange={(event) => setLeadForm((f) => ({ ...f, propertyAddress: event.target.value }))} className={inputClass} placeholder="Street, city, AZ" /></label>
              <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Roof details</span><input value={leadForm.roofDetails} onChange={(event) => setLeadForm((f) => ({ ...f, roofDetails: event.target.value }))} className={inputClass} placeholder="Optional" /></label>
              <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Insurance carrier</span><input value={leadForm.insuranceCarrier} onChange={(event) => setLeadForm((f) => ({ ...f, insuranceCarrier: event.target.value }))} className={inputClass} placeholder="Optional" /></label>
              {leadError && <p className="text-sm font-medium text-red-600">{leadError}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
              <button type="button" onClick={() => setLeadOpen(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50">Cancel</button>
              <button type="submit" className={`rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 ${leadSaving ? "pointer-events-none opacity-60" : ""}`}>{leadSaving ? "Saving…" : "Add contact"}</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Schedule modal ─────────────────────────────────────────── */}
      {scheduleOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-8 sm:items-center sm:pt-4" onClick={() => setScheduleOpen(false)}>
          <form onClick={(event) => event.stopPropagation()} onSubmit={handleSaveSchedule} className="flex max-h-[85vh] w-full max-w-md shrink-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-xl sm:max-h-[88vh]">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <p className="text-base font-semibold text-gray-900"><CalendarPlus className="mr-2 inline h-4 w-4 text-blue-600" />Schedule Inspection</p>
              <button type="button" onClick={() => setScheduleOpen(false)} className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <p className="text-xs text-gray-500">Creates an appointment on your CRM Google Calendar — synced across devices.</p>
              <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Title</span><input value={scheduleForm.title} onChange={(event) => setScheduleForm((f) => ({ ...f, title: event.target.value }))} className={inputClass} placeholder="Appointment title" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Customer</span><input value={scheduleForm.name} onChange={(event) => setScheduleForm((f) => ({ ...f, name: event.target.value }))} className={inputClass} placeholder="Name" /></label>
                <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Phone</span><input value={scheduleForm.phone} onChange={(event) => setScheduleForm((f) => ({ ...f, phone: event.target.value }))} className={inputClass} placeholder="(602) 555-0123" /></label>
              </div>
              <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Address</span><input value={scheduleForm.address} onChange={(event) => setScheduleForm((f) => ({ ...f, address: event.target.value }))} className={inputClass} placeholder="Property address" /></label>
              <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Type</span><select value={scheduleForm.jobKind} onChange={(event) => setScheduleForm((f) => ({ ...f, jobKind: event.target.value }))} className={inputClass}>{appointmentTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
              <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Date</span><input type="date" value={scheduleForm.date} onChange={(event) => setScheduleForm((f) => ({ ...f, date: event.target.value }))} className={inputClass} /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Start</span><input type="time" value={scheduleForm.startTime} onChange={(event) => setScheduleForm((f) => ({ ...f, startTime: event.target.value }))} className={inputClass} /></label>
                <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">End</span><input type="time" value={scheduleForm.endTime} onChange={(event) => setScheduleForm((f) => ({ ...f, endTime: event.target.value }))} className={inputClass} /></label>
              </div>
              <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Notes</span><textarea value={scheduleForm.notes} onChange={(event) => setScheduleForm((f) => ({ ...f, notes: event.target.value }))} rows={3} className={`${inputClass} resize-none`} placeholder="Optional details" /></label>
              {scheduleError && <p className="text-sm font-medium text-red-600">{scheduleError}</p>}
              {scheduleDone && <p className="text-sm font-medium text-green-600">{scheduleDone}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
              <button type="button" onClick={() => setScheduleOpen(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50">Cancel</button>
              <button type="submit" className={`rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 ${scheduleSaving ? "pointer-events-none opacity-60" : ""}`}>{scheduleSaving ? "Saving…" : "Save appointment"}</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Job modal ──────────────────────────────────────────────── */}
      {jobOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-8 sm:items-center sm:pt-4" onClick={() => setJobOpen(false)}>
          <form onClick={(event) => event.stopPropagation()} onSubmit={handleSaveJob} className="flex max-h-[85vh] w-full max-w-md shrink-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-xl sm:max-h-[88vh]">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <p className="text-base font-semibold text-gray-900"><Briefcase className="mr-2 inline h-4 w-4 text-blue-600" />New Job</p>
              <button type="button" onClick={() => setJobOpen(false)} className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <p className="text-xs text-gray-500">Creates a job card on the Jobs Board and a matching customer record.</p>
              <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Customer name *</span><input value={jobForm.name} onChange={(e) => setJobForm((f) => ({ ...f, name: e.target.value }))} className={inputClass} placeholder="Customer name" autoFocus /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Phone</span><input value={jobForm.phone} onChange={(e) => setJobForm((f) => ({ ...f, phone: e.target.value }))} className={inputClass} placeholder="(602) 555-0123" /></label>
                <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Email</span><input value={jobForm.email} onChange={(e) => setJobForm((f) => ({ ...f, email: e.target.value }))} className={inputClass} placeholder="name@email.com" /></label>
              </div>
              <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Property address</span><input value={jobForm.address} onChange={(e) => setJobForm((f) => ({ ...f, address: e.target.value }))} className={inputClass} placeholder="Street, city, AZ" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Roof type</span><input value={jobForm.roofType} onChange={(e) => setJobForm((f) => ({ ...f, roofType: e.target.value }))} className={inputClass} placeholder="Tile, Shingle, Flat…" /></label>
                <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Source</span>
                  <select value={jobForm.source} onChange={(e) => setJobForm((f) => ({ ...f, source: e.target.value }))} className={inputClass}>
                    {LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Job value ($)</span><input type="number" value={jobForm.value} onChange={(e) => setJobForm((f) => ({ ...f, value: e.target.value }))} className={inputClass} placeholder="0" /></label>
                <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Due date</span><input type="date" value={jobForm.dueDate} onChange={(e) => setJobForm((f) => ({ ...f, dueDate: e.target.value }))} className={inputClass} /></label>
              </div>
              <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Assigned to</span><input value={jobForm.assignedTo} onChange={(e) => setJobForm((f) => ({ ...f, assignedTo: e.target.value }))} className={inputClass} placeholder="Rep name" /></label>
              {jobError && <p className="text-sm font-medium text-red-600">{jobError}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
              <button type="button" onClick={() => setJobOpen(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50">Cancel</button>
              <button type="submit" className={`rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 ${jobSaving ? "pointer-events-none opacity-60" : ""}`}>{jobSaving ? "Saving…" : "Create job"}</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Proposal modal ─────────────────────────────────────────── */}
      {proposalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-8 sm:items-center sm:pt-4" onClick={() => setProposalOpen(false)}>
          <form onClick={(event) => event.stopPropagation()} onSubmit={handleSaveProposal} className="flex max-h-[85vh] w-full max-w-md shrink-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-xl sm:max-h-[88vh]">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <p className="text-base font-semibold text-gray-900"><FileText className="mr-2 inline h-4 w-4 text-blue-600" />New Proposal</p>
              <button type="button" onClick={() => setProposalOpen(false)} className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <p className="text-xs text-gray-500">Creates a draft proposal and syncs to the Proposals board.</p>
              <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Customer name *</span><input value={proposalForm.customerName} onChange={(e) => setProposalForm((f) => ({ ...f, customerName: e.target.value }))} className={inputClass} placeholder="Customer name" autoFocus /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Email</span><input value={proposalForm.customerEmail} onChange={(e) => setProposalForm((f) => ({ ...f, customerEmail: e.target.value }))} className={inputClass} placeholder="name@email.com" /></label>
                <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Phone</span><input value={proposalForm.customerPhone} onChange={(e) => setProposalForm((f) => ({ ...f, customerPhone: e.target.value }))} className={inputClass} placeholder="(602) 555-0123" /></label>
              </div>
              <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Property address</span><input value={proposalForm.address} onChange={(e) => setProposalForm((f) => ({ ...f, address: e.target.value }))} className={inputClass} placeholder="Street, city, AZ" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Scope</span><input value={proposalForm.scope} onChange={(e) => setProposalForm((f) => ({ ...f, scope: e.target.value }))} className={inputClass} placeholder="Roofing" /></label>
                <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Total ($)</span><input type="number" value={proposalForm.total} onChange={(e) => setProposalForm((f) => ({ ...f, total: e.target.value }))} className={inputClass} placeholder="0" /></label>
              </div>
              {proposalError && <p className="text-sm font-medium text-red-600">{proposalError}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
              <button type="button" onClick={() => setProposalOpen(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50">Cancel</button>
              <button type="submit" className={`rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 ${proposalSaving ? "pointer-events-none opacity-60" : ""}`}>{proposalSaving ? "Saving…" : "Create proposal"}</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Task modal ─────────────────────────────────────────────── */}
      {taskOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-8 sm:items-center sm:pt-4" onClick={() => setTaskOpen(false)}>
          <form onClick={(event) => event.stopPropagation()} onSubmit={handleSaveTask} className="flex max-h-[85vh] w-full max-w-md shrink-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-xl sm:max-h-[88vh]">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <p className="text-base font-semibold text-gray-900"><ClipboardList className="mr-2 inline h-4 w-4 text-blue-600" />New Task</p>
              <button type="button" onClick={() => setTaskOpen(false)} className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <p className="text-xs text-gray-500">Creates a task on the Tasks board for team follow-up.</p>
              <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Task title *</span><input value={taskForm.title} onChange={(e) => setTaskForm((f) => ({ ...f, title: e.target.value }))} className={inputClass} placeholder="e.g. Follow up with insurance" autoFocus /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Customer</span><input value={taskForm.customerName} onChange={(e) => setTaskForm((f) => ({ ...f, customerName: e.target.value }))} className={inputClass} placeholder="Customer name" /></label>
                <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Job address</span><input value={taskForm.jobAddress} onChange={(e) => setTaskForm((f) => ({ ...f, jobAddress: e.target.value }))} className={inputClass} placeholder="Address" /></label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Assigned to</span><input value={taskForm.assignedUser} onChange={(e) => setTaskForm((f) => ({ ...f, assignedUser: e.target.value }))} className={inputClass} placeholder="Team member" /></label>
                <label className="grid gap-1"><span className="text-xs font-medium text-gray-500">Due date</span><input type="date" value={taskForm.dueDate} onChange={(e) => setTaskForm((f) => ({ ...f, dueDate: e.target.value }))} className={inputClass} /></label>
              </div>
              {taskError && <p className="text-sm font-medium text-red-600">{taskError}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
              <button type="button" onClick={() => setTaskOpen(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50">Cancel</button>
              <button type="submit" className={`rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 ${taskSaving ? "pointer-events-none opacity-60" : ""}`}>{taskSaving ? "Saving…" : "Create task"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
