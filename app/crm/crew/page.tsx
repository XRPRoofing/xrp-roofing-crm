"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Camera, CheckCircle2, Plus, RotateCcw, Search, UploadCloud, UsersRound, X } from "lucide-react";
import { leads } from "@/lib/crm-data";
import { syncCrewPhotosToFiles } from "@/lib/crm-files";
import { addCrmNotification } from "@/lib/crm-notifications";
import { createDefaultCrewAssignment, crewMembers, crewStatuses, mergeJobsWithCrewAssignments, readCrewAssignments, readSavedJobs, saveCrewAssignments, saveCrewJobs, type CrewAssignment, type CrewJob, type CrewJobStatus } from "@/lib/crew-workflow";

const filters: { label: string; value: "all" | CrewJobStatus }[] = [
  { label: "All Jobs", value: "all" },
  { label: "Assigned", value: "Assigned" },
  { label: "In Progress", value: "In Progress" },
  { label: "On Work", value: "On Work" },
  { label: "Mark Done", value: "Mark Done" },
  { label: "Completed", value: "Completed" },
  { label: "Proceed to Invoice", value: "Proceed to Invoice" },
  { label: "Done Payment", value: "Done Payment" },
];

const statusStyles: Record<CrewJobStatus, string> = {
  Assigned: "bg-blue-50 text-blue-700 ring-blue-100",
  "In Progress": "bg-orange-50 text-orange-700 ring-orange-100",
  "On Work": "bg-sky-50 text-sky-700 ring-sky-100",
  "Mark Done": "bg-violet-50 text-violet-700 ring-violet-100",
  Completed: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  "Proceed to Invoice": "bg-amber-50 text-amber-700 ring-amber-100",
  "Done Payment": "bg-slate-100 text-slate-700 ring-slate-200",
};

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function formatAddress(job: CrewJob) {
  return `${job.address}, ${job.city}, AZ`;
}

export default function CrewWorkflowPage() {
  const [jobs, setJobs] = useState(() => readSavedJobs(leads));
  const [activeFilter, setActiveFilter] = useState<"all" | CrewJobStatus>("all");
  const [search, setSearch] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [newJob, setNewJob] = useState({ name: "", email: "", phone: "", address: "", city: "", roofType: "", value: "", dueDate: "", jobScope: "", jobNotes: "", assignedCrew: crewMembers[0] });
  const [assignments, setAssignments] = useState<CrewAssignment[]>(() => {
    const savedAssignments = readCrewAssignments();
    return jobs.map((job, index) => savedAssignments.find((assignment) => assignment.jobId === job.id) || createDefaultCrewAssignment(job, index));
  });
  const crewJobs = useMemo(() => mergeJobsWithCrewAssignments(jobs, assignments), [assignments, jobs]);
  const filteredJobs = useMemo(() => {
    const query = search.toLowerCase().trim();
    return crewJobs.filter((job) => {
      const matchesStatus = activeFilter === "all" || job.status === activeFilter;
      const matchesSearch = !query || [job.name, formatAddress(job), job.assignedCrew.join(" "), job.jobScope, job.status].some((value) => value.toLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    });
  }, [activeFilter, crewJobs, search]);
  const selectedJob = crewJobs.find((job) => job.id === selectedJobId) || null;

  useEffect(() => {
    function refreshCrewWorkflow() {
      const nextJobs = readSavedJobs(leads);
      const nextAssignments = readCrewAssignments();
      setJobs(nextJobs);
      setAssignments(nextJobs.map((job, index) => nextAssignments.find((assignment) => assignment.jobId === job.id) || createDefaultCrewAssignment(job, index)));
    }

    window.addEventListener("crm-crew-workflow-updated", refreshCrewWorkflow);
    window.addEventListener("storage", refreshCrewWorkflow);
    return () => {
      window.removeEventListener("crm-crew-workflow-updated", refreshCrewWorkflow);
      window.removeEventListener("storage", refreshCrewWorkflow);
    };
  }, []);

  function updateAssignment(jobId: string, updates: Partial<CrewAssignment>) {
    const job = crewJobs.find((item) => item.id === jobId);
    if (job && updates.status && updates.status !== job.status) {
      addCrmNotification({
        title: "Crew job moved",
        message: `${job.name} moved from ${job.status} to ${updates.status}.`,
        actor: "CRM user",
        module: "Crew Workflow",
      });
    }
    setAssignments((currentAssignments) => {
      const nextAssignments = currentAssignments.map((assignment) => assignment.jobId === jobId ? { ...assignment, ...updates } : assignment);
      saveCrewAssignments(nextAssignments);
      return nextAssignments;
    });
  }

  function toggleCrew(job: CrewJob, member: string) {
    const assignedCrew = job.assignedCrew.includes(member) ? job.assignedCrew.filter((crewMember) => crewMember !== member) : [...job.assignedCrew, member];
    updateAssignment(job.id, { assignedCrew });
  }

  async function handlePhotoUpload(job: CrewJob, type: "beforePhotos" | "afterPhotos", files: FileList | null) {
    if (!files?.length) return;

    const selectedFiles = Array.from(files);
    const uploadedPhotos = await Promise.all(selectedFiles.map(fileToDataUrl));
    updateAssignment(job.id, {
      completion: {
        ...job.completion,
        [type]: [...job.completion[type], ...uploadedPhotos],
      },
    });
    syncCrewPhotosToFiles({
      jobId: job.id,
      customerName: job.name,
      address: formatAddress(job),
      workType: job.jobScope,
      uploadedBy: job.assignedCrew[0] || "Crew",
      photoType: type === "beforePhotos" ? "Before" : "After",
      photos: selectedFiles.map((file, index) => ({ name: file.name, dataUrl: uploadedPhotos[index] })),
    });
    addCrmNotification({
      title: "Crew photos uploaded",
      message: `${selectedFiles.length} ${type === "beforePhotos" ? "before" : "after"} photo(s) uploaded for ${job.name}.`,
      actor: job.assignedCrew[0] || "Crew",
      module: "Crew Workflow",
    });
  }

  function handleCreateJob() {
    if (!newJob.name.trim() || !newJob.address.trim()) return;

    const job = {
      id: `L-${Date.now()}`,
      name: newJob.name,
      email: newJob.email || "customer@example.com",
      phone: newJob.phone || "",
      address: newJob.address,
      city: newJob.city || "Phoenix",
      stage: "scheduled" as const,
      value: Number(newJob.value) || 0,
      assignedTo: "Crew",
      roofType: newJob.roofType || "Roofing",
      source: "Crew",
      lastActivity: newJob.jobNotes || "Created by crew",
      nextAction: "Complete job",
      dueDate: newJob.dueDate || new Date().toISOString().slice(0, 10),
    };
    const assignment = {
      ...createDefaultCrewAssignment(job, jobs.length),
      assignedCrew: [newJob.assignedCrew],
      scheduleDate: job.dueDate,
      jobScope: newJob.jobScope || job.roofType,
      jobNotes: newJob.jobNotes || "Crew-created job.",
    };
    const nextJobs = [job, ...jobs];
    const nextAssignments = [assignment, ...assignments];
    saveCrewJobs(nextJobs);
    saveCrewAssignments(nextAssignments);
    setJobs(nextJobs);
    setAssignments(nextAssignments);
    setSelectedJobId(job.id);
    addCrmNotification({
      title: "New crew job created",
      message: `${job.name} was created and assigned to ${newJob.assignedCrew}.`,
      actor: "CRM user",
      module: "Crew Workflow",
    });
    setNewJob({ name: "", email: "", phone: "", address: "", city: "", roofType: "", value: "", dueDate: "", jobScope: "", jobNotes: "", assignedCrew: crewMembers[0] });
    setShowCreateJob(false);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-600">Production Workflow</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-[#07183f]">Roofing Crew Workflow</h1>
            <p className="mt-1 text-sm font-semibold text-slate-600">Compact daily operations view for assignments, job status, completion review, and approvals.</p>
          </div>
          <div className="flex w-full flex-col gap-3 lg:max-w-lg lg:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm font-bold outline-none focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50" placeholder="Search jobs, team, scope..." />
            </div>
            <button type="button" onClick={() => setShowCreateJob(true)} className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-blue-700"><Plus className="mr-2 inline h-4 w-4" />New Job</button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {filters.map((filter) => {
            const count = filter.value === "all" ? crewJobs.length : crewJobs.filter((job) => job.status === filter.value).length;
            return (
              <button key={filter.value} type="button" onClick={() => setActiveFilter(filter.value)} className={`rounded-full px-4 py-2 text-xs font-black transition ${activeFilter === filter.value ? "bg-[#07183f] text-white shadow-lg shadow-blue-950/10" : "bg-slate-100 text-slate-700 hover:bg-blue-50 hover:text-blue-700"}`}>
                {filter.label} <span className="ml-1 opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[1080px] w-full text-left">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-black uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Customer Name</th>
                <th className="px-4 py-3">Property Address</th>
                <th className="px-4 py-3">Assigned Team</th>
                <th className="px-4 py-3">Schedule Date</th>
                <th className="px-4 py-3">Job Scope</th>
                <th className="px-4 py-3">Job Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredJobs.map((job) => (
                <tr key={job.id} onClick={() => setSelectedJobId(job.id)} className="cursor-pointer bg-white transition hover:bg-blue-50/60">
                  <td className="px-4 py-3 font-black text-[#07183f]">{job.name}</td>
                  <td className="max-w-xs truncate px-4 py-3 font-semibold text-slate-600">{formatAddress(job)}</td>
                  <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{job.assignedCrew.map((member) => <span key={member} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">{member}</span>)}</div></td>
                  <td className="px-4 py-3 font-bold text-slate-700">{job.scheduleDate}</td>
                  <td className="max-w-[180px] truncate px-4 py-3 font-semibold text-slate-600">{job.jobScope}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-3 py-1 text-xs font-black ring-1 ${statusStyles[job.status]}`}>{job.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredJobs.length === 0 && <div className="p-8 text-center text-sm font-bold text-slate-500">No crew jobs match this filter.</div>}
      </section>

      {showCreateJob && (
        <section className="rounded-3xl border border-blue-100 bg-blue-50 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-blue-700">Crew Created Job</p>
              <h2 className="mt-1 text-2xl font-black text-[#07183f]">Create New Job</h2>
            </div>
            <button type="button" onClick={() => setShowCreateJob(false)} className="rounded-xl p-2 text-slate-500 hover:bg-white"><X className="h-5 w-5" /></button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <input value={newJob.name} onChange={(event) => setNewJob({ ...newJob, name: event.target.value })} className="rounded-2xl border border-blue-100 px-4 py-3 text-sm font-bold outline-none md:col-span-1" placeholder="Customer name" />
            <input value={newJob.phone} onChange={(event) => setNewJob({ ...newJob, phone: event.target.value })} className="rounded-2xl border border-blue-100 px-4 py-3 text-sm font-bold outline-none" placeholder="Phone" />
            <input value={newJob.email} onChange={(event) => setNewJob({ ...newJob, email: event.target.value })} className="rounded-2xl border border-blue-100 px-4 py-3 text-sm font-bold outline-none" placeholder="Email" />
            <input value={newJob.address} onChange={(event) => setNewJob({ ...newJob, address: event.target.value })} className="rounded-2xl border border-blue-100 px-4 py-3 text-sm font-bold outline-none md:col-span-2" placeholder="Property address" />
            <input value={newJob.city} onChange={(event) => setNewJob({ ...newJob, city: event.target.value })} className="rounded-2xl border border-blue-100 px-4 py-3 text-sm font-bold outline-none" placeholder="City" />
            <input value={newJob.roofType} onChange={(event) => setNewJob({ ...newJob, roofType: event.target.value })} className="rounded-2xl border border-blue-100 px-4 py-3 text-sm font-bold outline-none" placeholder="Roof type" />
            <input value={newJob.value} onChange={(event) => setNewJob({ ...newJob, value: event.target.value })} type="number" className="rounded-2xl border border-blue-100 px-4 py-3 text-sm font-bold outline-none" placeholder="Job value" />
            <input value={newJob.dueDate} onChange={(event) => setNewJob({ ...newJob, dueDate: event.target.value })} type="date" className="rounded-2xl border border-blue-100 px-4 py-3 text-sm font-bold outline-none" />
            <select value={newJob.assignedCrew} onChange={(event) => setNewJob({ ...newJob, assignedCrew: event.target.value })} className="rounded-2xl border border-blue-100 px-4 py-3 text-sm font-bold outline-none">
              {crewMembers.map((member) => <option key={member}>{member}</option>)}
            </select>
            <input value={newJob.jobScope} onChange={(event) => setNewJob({ ...newJob, jobScope: event.target.value })} className="rounded-2xl border border-blue-100 px-4 py-3 text-sm font-bold outline-none md:col-span-3" placeholder="Job scope" />
            <textarea value={newJob.jobNotes} onChange={(event) => setNewJob({ ...newJob, jobNotes: event.target.value })} className="min-h-24 rounded-2xl border border-blue-100 px-4 py-3 text-sm font-bold outline-none md:col-span-3" placeholder="Job notes" />
          </div>
          <div className="mt-4 flex justify-end gap-3">
            <button type="button" onClick={() => setShowCreateJob(false)} className="rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-700">Cancel</button>
            <button type="button" onClick={handleCreateJob} className="rounded-2xl bg-orange-500 px-4 py-3 text-sm font-black text-white">Create Job</button>
          </div>
        </section>
      )}

      {selectedJob && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-sm" onClick={() => setSelectedJobId(null)}>
          <aside className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-600">Job Details</p>
                  <h2 className="mt-1 text-2xl font-black text-[#07183f]">{selectedJob.name}</h2>
                  <p className="mt-1 text-sm font-bold text-slate-500">{formatAddress(selectedJob)}</p>
                </div>
                <button type="button" onClick={() => setSelectedJobId(null)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
              </div>
            </div>

            <div className="space-y-5 p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">Customer Information</p><p className="mt-2 font-black text-slate-900">{selectedJob.name}</p><p className="text-sm font-semibold text-slate-600">{selectedJob.phone}</p><p className="text-sm font-semibold text-slate-600">{selectedJob.email}</p></div>
                <label className="grid gap-2 rounded-2xl bg-slate-50 p-4 text-xs font-black uppercase text-slate-500">Schedule Date<input type="date" value={selectedJob.scheduleDate} onChange={(event) => updateAssignment(selectedJob.id, { scheduleDate: event.target.value })} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold normal-case text-slate-800 outline-none" /></label>
                <label className="grid gap-2 rounded-2xl bg-slate-50 p-4 text-xs font-black uppercase text-slate-500 sm:col-span-2">Job Scope<input value={selectedJob.jobScope} onChange={(event) => updateAssignment(selectedJob.id, { jobScope: event.target.value })} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold normal-case text-slate-800 outline-none" /></label>
                <label className="grid gap-2 rounded-2xl bg-slate-50 p-4 text-xs font-black uppercase text-slate-500 sm:col-span-2">Job Notes<textarea value={selectedJob.jobNotes} onChange={(event) => updateAssignment(selectedJob.id, { jobNotes: event.target.value })} rows={3} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold normal-case leading-6 text-slate-800 outline-none" /></label>
                <label className="grid gap-2 rounded-2xl bg-slate-50 p-4 text-xs font-black uppercase text-slate-500 sm:col-span-2">Job Status<select value={selectedJob.status} onChange={(event) => updateAssignment(selectedJob.id, { status: event.target.value as CrewJobStatus })} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold normal-case text-slate-800 outline-none">{crewStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-black text-[#07183f]"><UsersRound className="h-4 w-4" />Assigned Team</div>
                <div className="flex flex-wrap gap-2">{crewMembers.map((member) => <button key={member} type="button" onClick={() => toggleCrew(selectedJob, member)} className={`rounded-full px-4 py-2 text-sm font-black transition ${selectedJob.assignedCrew.includes(member) ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-blue-50"}`}>{member}</button>)}</div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-black text-[#07183f]">Uploaded Photos</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-blue-300 bg-blue-50 p-4 text-center text-sm font-black text-blue-700">
                    <Camera className="mb-2 h-5 w-5" />Upload before photos
                    <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => void handlePhotoUpload(selectedJob, "beforePhotos", event.target.files)} />
                  </label>
                  <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-blue-300 bg-blue-50 p-4 text-center text-sm font-black text-blue-700">
                    <UploadCloud className="mb-2 h-5 w-5" />Upload after photos
                    <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => void handlePhotoUpload(selectedJob, "afterPhotos", event.target.files)} />
                  </label>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">{[...selectedJob.completion.beforePhotos, ...selectedJob.completion.afterPhotos].map((photo) => <Image key={photo} src={photo} alt="Crew uploaded completion" width={400} height={240} unoptimized className="h-32 w-full rounded-xl object-cover" />)}</div>
                {selectedJob.completion.beforePhotos.length + selectedJob.completion.afterPhotos.length === 0 && <p className="mt-2 text-sm font-semibold text-slate-500">No photos uploaded yet.</p>}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-black text-[#07183f]">Completion Notes</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">{selectedJob.completion.notes || "No completion notes submitted yet."}</p>
                <p className="mt-3 text-sm font-black text-[#07183f]">Materials Used</p>
                <p className="mt-1 text-sm font-semibold text-slate-700">{selectedJob.completion.materialsUsed || "No materials recorded."}</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-black text-[#07183f]">Status History</p>
                <div className="mt-3 space-y-2 text-sm font-semibold text-slate-600">
                  <p>Current status: <span className={`rounded-full px-3 py-1 text-xs font-black ring-1 ${statusStyles[selectedJob.status]}`}>{selectedJob.status}</span></p>
                  {selectedJob.completion.submittedAt && <p>Marked done: {new Date(selectedJob.completion.submittedAt).toLocaleString()}</p>}
                  {selectedJob.adminNotification && <p>{selectedJob.adminNotification}</p>}
                </div>
              </div>

              {selectedJob.status === "Mark Done" && (
                <div className="sticky bottom-0 -mx-5 border-t border-slate-200 bg-white p-5">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => updateAssignment(selectedJob.id, { status: "Completed", adminNotification: "Job marked completed by admin." })} className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-black text-white"><CheckCircle2 className="mr-2 inline h-4 w-4" />Approve Job</button>
                    <button type="button" onClick={() => updateAssignment(selectedJob.id, { status: "In Progress", adminNotification: "Returned to team for revision." })} className="rounded-full bg-white px-4 py-2 text-sm font-black text-orange-700 ring-1 ring-orange-200"><RotateCcw className="mr-2 inline h-4 w-4" />Return To Team</button>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

