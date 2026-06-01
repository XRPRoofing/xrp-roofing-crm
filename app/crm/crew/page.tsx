"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { CheckCircle2, RotateCcw, Search, UsersRound, X } from "lucide-react";
import { leads } from "@/lib/crm-data";
import { createDefaultCrewAssignment, crewMembers, mergeJobsWithCrewAssignments, readCrewAssignments, readSavedJobs, saveCrewAssignments, type CrewAssignment, type CrewJob, type CrewJobStatus } from "@/lib/crew-workflow";

const filters: { label: string; value: "all" | CrewJobStatus }[] = [
  { label: "All Jobs", value: "all" },
  { label: "Assigned", value: "Assigned" },
  { label: "In Progress", value: "In Progress" },
  { label: "Pending Approval", value: "Done - Pending Approval" },
  { label: "Completed", value: "Completed" },
];

const statusStyles: Record<CrewJobStatus, string> = {
  Assigned: "bg-blue-50 text-blue-700 ring-blue-100",
  "In Progress": "bg-orange-50 text-orange-700 ring-orange-100",
  "Done - Pending Approval": "bg-violet-50 text-violet-700 ring-violet-100",
  Completed: "bg-emerald-50 text-emerald-700 ring-emerald-100",
};

function formatAddress(job: CrewJob) {
  return `${job.address}, ${job.city}, AZ`;
}

export default function CrewWorkflowPage() {
  const [jobs] = useState(() => readSavedJobs(leads));
  const [activeFilter, setActiveFilter] = useState<"all" | CrewJobStatus>("all");
  const [search, setSearch] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
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

  function updateAssignment(jobId: string, updates: Partial<CrewAssignment>) {
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

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-600">Production Workflow</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-[#07183f]">Roofing Crew Workflow</h1>
            <p className="mt-1 text-sm font-semibold text-slate-600">Compact daily operations view for assignments, crew status, completion review, and approvals.</p>
          </div>
          <div className="relative w-full lg:max-w-sm">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm font-bold outline-none focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50" placeholder="Search jobs, crews, scope..." />
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
          <table className="min-w-[980px] w-full text-left">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-black uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Customer Name</th>
                <th className="px-4 py-3">Property Address</th>
                <th className="px-4 py-3">Assigned Crew</th>
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
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {job.assignedCrew.map((member) => <span key={member} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">{member}</span>)}
                    </div>
                  </td>
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
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-black text-[#07183f]"><UsersRound className="h-4 w-4" />Assigned Crew</div>
                <div className="flex flex-wrap gap-2">
                  {crewMembers.map((member) => <button key={member} type="button" onClick={() => toggleCrew(selectedJob, member)} className={`rounded-full px-4 py-2 text-sm font-black transition ${selectedJob.assignedCrew.includes(member) ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-blue-50"}`}>{member}</button>)}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-black text-[#07183f]">Uploaded Photos</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[...selectedJob.completion.beforePhotos, ...selectedJob.completion.afterPhotos].map((photo) => <Image key={photo} src={photo} alt="Crew uploaded completion" width={400} height={240} unoptimized className="h-32 w-full rounded-xl object-cover" />)}
                </div>
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
                  {selectedJob.completion.submittedAt && <p>Submitted for approval: {new Date(selectedJob.completion.submittedAt).toLocaleString()}</p>}
                  {selectedJob.adminNotification && <p>{selectedJob.adminNotification}</p>}
                </div>
              </div>

              {selectedJob.status === "Done - Pending Approval" && (
                <div className="sticky bottom-0 -mx-5 border-t border-slate-200 bg-white p-5">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => updateAssignment(selectedJob.id, { status: "Completed", adminNotification: "Job approved by admin." })} className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-black text-white"><CheckCircle2 className="mr-2 inline h-4 w-4" />Approve Job</button>
                    <button type="button" onClick={() => updateAssignment(selectedJob.id, { status: "In Progress", adminNotification: "Returned to crew for revision." })} className="rounded-full bg-white px-4 py-2 text-sm font-black text-orange-700 ring-1 ring-orange-200"><RotateCcw className="mr-2 inline h-4 w-4" />Return To Crew</button>
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
