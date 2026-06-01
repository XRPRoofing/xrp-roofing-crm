"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Camera, CheckCircle2, Hammer, UploadCloud } from "lucide-react";
import { leads } from "@/lib/crm-data";
import { syncCrewPhotosToFiles } from "@/lib/crm-files";
import { addCrmNotification } from "@/lib/crm-notifications";
import { crewMembers, createDefaultCrewAssignment, mergeJobsWithCrewAssignments, readCrewAssignments, readSavedJobs, saveCrewAssignments, type CrewAssignment, type CrewJob } from "@/lib/crew-workflow";

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function CrewPortalPage() {
  const [jobs] = useState(() => readSavedJobs(leads));
  const [selectedCrew, setSelectedCrew] = useState(crewMembers[0]);
  const [assignments, setAssignments] = useState<CrewAssignment[]>(() => {
    const savedAssignments = readCrewAssignments();
    return jobs.map((job, index) => savedAssignments.find((assignment) => assignment.jobId === job.id) || createDefaultCrewAssignment(job, index));
  });
  const crewJobs = useMemo(() => mergeJobsWithCrewAssignments(jobs, assignments).filter((job) => job.assignedCrew.includes(selectedCrew)), [assignments, jobs, selectedCrew]);
  const [selectedJobId, setSelectedJobId] = useState(crewJobs[0]?.id || "");
  const selectedJob = crewJobs.find((job) => job.id === selectedJobId) || crewJobs[0];

  function updateAssignment(jobId: string, updates: Partial<CrewAssignment>) {
    setAssignments((currentAssignments) => {
      const nextAssignments = currentAssignments.map((assignment) => assignment.jobId === jobId ? { ...assignment, ...updates } : assignment);
      saveCrewAssignments(nextAssignments);
      return nextAssignments;
    });
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
      address: `${job.address}, ${job.city}, AZ`,
      workType: job.jobScope,
      uploadedBy: selectedCrew,
      photoType: type === "beforePhotos" ? "Before" : "After",
      photos: selectedFiles.map((file, index) => ({ name: file.name, dataUrl: uploadedPhotos[index] })),
    });
    addCrmNotification({
      title: "Crew photos uploaded",
      message: `${selectedCrew} uploaded ${selectedFiles.length} ${type === "beforePhotos" ? "before" : "after"} photo(s) for ${job.name}.`,
      actor: selectedCrew,
      module: "Crew Portal",
    });
  }

  function submitForApproval(job: CrewJob) {
    const hasPhoto = job.completion.beforePhotos.length + job.completion.afterPhotos.length > 0;
    if (!hasPhoto || !job.completion.notes.trim()) return;

    updateAssignment(job.id, {
      status: "Mark Done",
      completion: { ...job.completion, submittedAt: new Date().toISOString() },
      adminNotification: `${selectedCrew} marked ${job.name} done.`,
    });
    addCrmNotification({
      title: "Crew job marked done",
      message: `${selectedCrew} marked ${job.name} done and ready for review.`,
      actor: selectedCrew,
      module: "Crew Portal",
    });
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-5 text-slate-950">
      <section className="mx-auto max-w-5xl space-y-5">
        <div className="rounded-[2rem] bg-gradient-to-br from-[#07183f] to-[#1d4ed8] p-5 text-white shadow-xl shadow-blue-950/20">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-300">Crew Portal</p>
          <h1 className="mt-2 text-3xl font-black">My Assigned Jobs</h1>
          <p className="mt-2 text-sm font-semibold leading-6 text-blue-100">Field-only job view for roofing teams. No proposals, invoices, payments, reports, settings, or other customer records.</p>
          <label className="mt-5 grid gap-2 text-xs font-black uppercase tracking-wide text-blue-100">
            Team Member
            <select value={selectedCrew} onChange={(event) => { setSelectedCrew(event.target.value); setSelectedJobId(""); }} className="rounded-2xl border border-white/20 bg-white px-4 py-3 text-sm font-black normal-case tracking-normal text-[#07183f] outline-none">
              {crewMembers.map((member) => <option key={member}>{member}</option>)}
            </select>
          </label>
        </div>

        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <aside className="space-y-3">
            {crewJobs.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
                <Hammer className="mx-auto h-8 w-8 text-slate-400" />
                <p className="mt-3 font-black text-[#07183f]">No assigned jobs</p>
                <p className="mt-1 text-sm text-slate-500">Ask an admin to assign jobs to this Team Member.</p>
              </div>
            ) : crewJobs.map((job) => (
              <button key={job.id} type="button" onClick={() => setSelectedJobId(job.id)} className={`w-full rounded-3xl border p-4 text-left shadow-sm transition ${selectedJob?.id === job.id ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"}`}>
                <p className="font-black text-[#07183f]">{job.name}</p>
                <p className="mt-1 text-sm font-semibold text-slate-600">{job.address}, {job.city}, AZ</p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-blue-700 ring-1 ring-blue-100">{job.status}</span>
                  <span className="text-xs font-black text-slate-500">{job.scheduleDate}</span>
                </div>
              </button>
            ))}
          </aside>

          {selectedJob && (
            <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="border-b border-slate-200 pb-5">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-600">Job Details</p>
                <h2 className="mt-2 text-2xl font-black text-[#07183f]">{selectedJob.name}</h2>
                <p className="mt-2 text-sm font-bold text-slate-600">{selectedJob.address}, {selectedJob.city}, AZ</p>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">Job Scope</p>
                  <p className="mt-2 text-sm font-bold leading-6 text-slate-800">{selectedJob.jobScope}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">Schedule Date</p>
                  <p className="mt-2 text-sm font-bold leading-6 text-slate-800">{selectedJob.scheduleDate}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4 sm:col-span-2">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">Job Notes</p>
                  <p className="mt-2 text-sm font-bold leading-6 text-slate-800">{selectedJob.jobNotes}</p>
                </div>
              </div>

              <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-lg font-black text-[#07183f]">Job Completion Form</h3>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-blue-300 bg-white p-4 text-center text-sm font-black text-blue-700">
                    <Camera className="mb-2 h-6 w-6" />Upload before photos
                    <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => void handlePhotoUpload(selectedJob, "beforePhotos", event.target.files)} />
                  </label>
                  <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-blue-300 bg-white p-4 text-center text-sm font-black text-blue-700">
                    <UploadCloud className="mb-2 h-6 w-6" />Upload after photos
                    <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => void handlePhotoUpload(selectedJob, "afterPhotos", event.target.files)} />
                  </label>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {[...selectedJob.completion.beforePhotos, ...selectedJob.completion.afterPhotos].map((photo) => <Image key={photo} src={photo} alt="Uploaded job completion" width={400} height={260} unoptimized className="h-36 w-full rounded-2xl object-cover" />)}
                </div>

                <label className="mt-4 grid gap-2 text-xs font-black uppercase tracking-wide text-slate-500">
                  Completion Notes Required
                  <textarea value={selectedJob.completion.notes} onChange={(event) => updateAssignment(selectedJob.id, { completion: { ...selectedJob.completion, notes: event.target.value } })} rows={5} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold normal-case leading-6 tracking-normal text-slate-800 outline-none" placeholder="Removed damaged shingles, replaced underlayment, installed new Owens Corning shingles, cleaned job site, customer notified." />
                </label>
                <label className="mt-4 grid gap-2 text-xs font-black uppercase tracking-wide text-slate-500">
                  Materials Used Optional
                  <input value={selectedJob.completion.materialsUsed || ""} onChange={(event) => updateAssignment(selectedJob.id, { completion: { ...selectedJob.completion, materialsUsed: event.target.value } })} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" placeholder="Owens Corning shingles, underlayment, flashing..." />
                </label>

                <button type="button" disabled={(selectedJob.completion.beforePhotos.length + selectedJob.completion.afterPhotos.length === 0) || !selectedJob.completion.notes.trim()} onClick={() => submitForApproval(selectedJob)} className="mt-5 w-full rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black text-white shadow-lg shadow-emerald-200 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none">
                  <CheckCircle2 className="mr-2 inline h-5 w-5" />Mark Done
                </button>
                <p className="mt-3 text-center text-xs font-bold text-slate-500">Requires at least one photo and completion notes before marking done.</p>
              </div>
            </section>
          )}
        </div>
      </section>
    </main>
  );
}




