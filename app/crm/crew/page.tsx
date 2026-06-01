"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { CheckCircle2, ClipboardCheck, RotateCcw, UsersRound } from "lucide-react";
import { leads } from "@/lib/crm-data";
import { createDefaultCrewAssignment, crewMembers, crewStatuses, mergeJobsWithCrewAssignments, readCrewAssignments, readSavedJobs, saveCrewAssignments, type CrewAssignment, type CrewJob, type CrewJobStatus } from "@/lib/crew-workflow";

function formatAddress(job: CrewJob) {
  return `${job.address}, ${job.city}, AZ`;
}

export default function CrewWorkflowPage() {
  const [jobs] = useState(() => readSavedJobs(leads));
  const [assignments, setAssignments] = useState<CrewAssignment[]>(() => {
    const savedAssignments = readCrewAssignments();
    return jobs.map((job, index) => savedAssignments.find((assignment) => assignment.jobId === job.id) || createDefaultCrewAssignment(job, index));
  });
  const crewJobs = useMemo(() => mergeJobsWithCrewAssignments(jobs, assignments), [assignments, jobs]);
  const pendingApproval = crewJobs.filter((job) => job.status === "Done - Pending Approval");

  function updateAssignment(jobId: string, updates: Partial<CrewAssignment>) {
    setAssignments((currentAssignments) => {
      const nextAssignments = currentAssignments.map((assignment) => assignment.jobId === jobId ? { ...assignment, ...updates } : assignment);
      saveCrewAssignments(nextAssignments);
      return nextAssignments;
    });
  }

  function toggleCrew(job: CrewJob, member: string) {
    const assignedCrew = job.assignedCrew.includes(member)
      ? job.assignedCrew.filter((crewMember) => crewMember !== member)
      : [...job.assignedCrew, member];

    updateAssignment(job.id, { assignedCrew });
  }

  function updateStatus(job: CrewJob, status: CrewJobStatus) {
    updateAssignment(job.id, { status, adminNotification: status === "Completed" ? "Job approved by admin." : job.adminNotification });
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#07183f] via-[#0f2156] to-[#1d4ed8] p-6 text-white shadow-2xl shadow-blue-950/20">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-300">Production Workflow</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">Roofing Crew Workflow</h1>
            <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-blue-100">Assign crews, track field progress, review completion photos, and approve finished roofing jobs.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {crewStatuses.map((status) => (
              <div key={status} className="rounded-2xl border border-white/15 bg-white/10 p-3 text-center">
                <p className="text-2xl font-black">{crewJobs.filter((job) => job.status === status).length}</p>
                <p className="mt-1 text-[10px] font-black uppercase tracking-wide text-blue-100">{status}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {pendingApproval.length > 0 && (
        <section className="rounded-3xl border border-orange-200 bg-orange-50 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <ClipboardCheck className="h-5 w-5 text-orange-700" />
            <h2 className="text-lg font-black text-[#07183f]">Admin review needed</h2>
          </div>
          <p className="mt-2 text-sm font-semibold text-orange-900">{pendingApproval.length} job{pendingApproval.length === 1 ? "" : "s"} submitted by crew and waiting for approval.</p>
        </section>
      )}

      <section className="grid gap-4 xl:grid-cols-2">
        {crewJobs.map((job) => (
          <article key={job.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">{job.id}</p>
                <h2 className="mt-1 text-xl font-black text-[#07183f]">{job.name}</h2>
                <p className="mt-1 text-sm font-semibold text-slate-600">{formatAddress(job)}</p>
              </div>
              <select value={job.status} onChange={(event) => updateStatus(job, event.target.value as CrewJobStatus)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-800 outline-none">
                {crewStatuses.map((status) => <option key={status}>{status}</option>)}
              </select>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-xs font-black uppercase tracking-wide text-slate-500">
                Schedule Date
                <input type="date" value={job.scheduleDate} onChange={(event) => updateAssignment(job.id, { scheduleDate: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" />
              </label>
              <label className="grid gap-2 text-xs font-black uppercase tracking-wide text-slate-500">
                Job Scope
                <input value={job.jobScope} onChange={(event) => updateAssignment(job.id, { jobScope: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" />
              </label>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-[#07183f]"><UsersRound className="h-4 w-4" />Assigned Crew</div>
              <div className="flex flex-wrap gap-2">
                {crewMembers.map((member) => (
                  <button key={member} type="button" onClick={() => toggleCrew(job, member)} className={`rounded-full px-4 py-2 text-sm font-black transition ${job.assignedCrew.includes(member) ? "bg-blue-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>{member}</button>
                ))}
              </div>
            </div>

            <label className="mt-5 grid gap-2 text-xs font-black uppercase tracking-wide text-slate-500">
              Job Notes
              <textarea value={job.jobNotes} onChange={(event) => updateAssignment(job.id, { jobNotes: event.target.value })} rows={3} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold normal-case leading-6 tracking-normal text-slate-800 outline-none" />
            </label>

            {job.status === "Done - Pending Approval" && (
              <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <h3 className="font-black text-emerald-900">Completion Review</h3>
                <p className="mt-2 text-sm font-semibold text-emerald-800">{job.completion.notes}</p>
                {job.completion.materialsUsed && <p className="mt-2 text-sm text-emerald-800">Materials: {job.completion.materialsUsed}</p>}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[...job.completion.beforePhotos, ...job.completion.afterPhotos].map((photo) => <Image key={photo} src={photo} alt="Crew uploaded completion" width={400} height={240} unoptimized className="h-32 w-full rounded-xl object-cover" />)}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => updateAssignment(job.id, { status: "Completed", adminNotification: "Job approved by admin." })} className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-black text-white"><CheckCircle2 className="mr-2 inline h-4 w-4" />Approve Job</button>
                  <button type="button" onClick={() => updateAssignment(job.id, { status: "In Progress", adminNotification: "Returned to crew for revision." })} className="rounded-full bg-white px-4 py-2 text-sm font-black text-orange-700 ring-1 ring-orange-200"><RotateCcw className="mr-2 inline h-4 w-4" />Return To Crew</button>
                </div>
              </div>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
