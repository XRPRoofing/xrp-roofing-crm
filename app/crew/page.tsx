"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Camera, CheckCircle2, Hammer, UploadCloud, UsersRound, X } from "lucide-react";
import { addCrmNotification } from "@/lib/crm-notifications";
import { compressImageToDataUrl } from "@/lib/image-compress";
import { crewMembers, type CrewJob } from "@/lib/crew-workflow";
import {
  addJobPhotos,
  assembleCrewJobs,
  buildOptimisticPhotosFromData,
  ensureSeedJobs,
  joinCrewPresence,
  loadCrewDataset,
  loadJobPhotos,
  subscribeToCrewData,
  updateJobRecord,
  type CrewPresenceState,
  type JobPhoto,
  type JobRecord,
} from "@/lib/crew-sync";

export default function CrewPortalPage() {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [photos, setPhotos] = useState<JobPhoto[]>([]);
  const [selectedPhotos, setSelectedPhotos] = useState<JobPhoto[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedCrew, setSelectedCrew] = useState(crewMembers[0]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [presence, setPresence] = useState<CrewPresenceState[]>([]);
  const presenceRef = useRef<{ update: (next: Partial<CrewPresenceState>) => void; leave: () => void } | null>(null);

  const crewJobs = useMemo(
    () => assembleCrewJobs(jobs, photos).filter((job) => job.assignedCrew.includes(selectedCrew)),
    [jobs, photos, selectedCrew],
  );
  const selectedJob = crewJobs.find((job) => job.id === selectedJobId) || crewJobs[0];
  const activeJobId = selectedJob?.id ?? "";

  const refresh = useCallback(async () => {
    const data = await loadCrewDataset();
    setJobs(data.jobs);
    setPhotos(data.photos);
  }, []);

  // Fetch the heavy image data only for the job that's open, on demand.
  useEffect(() => {
    let active = true;
    async function loadSelected() {
      if (!activeJobId) {
        setSelectedPhotos([]);
        return;
      }
      setPhotosLoading(true);
      setSelectedPhotos([]);
      try {
        const jobPhotos = await loadJobPhotos(activeJobId);
        if (active) setSelectedPhotos(jobPhotos);
      } catch {
        if (active) setSelectedPhotos([]);
      } finally {
        if (active) setPhotosLoading(false);
      }
    }
    void loadSelected();
    return () => {
      active = false;
    };
  }, [activeJobId]);

  useEffect(() => {
    let mounted = true;
    async function init() {
      try {
        const data = await loadCrewDataset();
        const seededJobs = await ensureSeedJobs(data.jobs);
        if (!mounted) return;
        setJobs(seededJobs);
        setPhotos(data.photos);
      } catch (loadError) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : "Failed to load jobs.");
      }
    }
    init();

    const unsubscribe = subscribeToCrewData(() => {
      void refresh().catch(() => {});
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [refresh]);

  useEffect(() => {
    const presenceChannel = joinCrewPresence(
      "crew-presence",
      { name: selectedCrew, role: "Crew", action: "viewing", jobId: null },
      (states) => setPresence(states),
    );
    presenceRef.current = presenceChannel;
    return () => {
      presenceChannel.leave();
      presenceRef.current = null;
    };
  }, [selectedCrew]);

  useEffect(() => {
    presenceRef.current?.update({ name: selectedCrew, action: selectedJob ? "editing" : "viewing", jobId: selectedJob?.id ?? null });
  }, [selectedCrew, selectedJob]);

  const reportError = useCallback((message: string) => {
    setError(message);
    void refresh().catch(() => {});
  }, [refresh]);

  function updateJobFields(jobId: string, updates: Partial<JobRecord>) {
    const previousJobs = jobs;
    setJobs((current) => current.map((item) => (item.id === jobId ? { ...item, ...updates } : item)));
    void updateJobRecord(jobId, updates).catch((updateError) => {
      setJobs(previousJobs);
      reportError(updateError instanceof Error ? updateError.message : "Failed to save change.");
    });
  }

  // Capture/upload saves the photo instantly — no forced markup step. Crews can
  // add drawings/notes later per-photo from the job's Files folder.
  async function handlePhotoUpload(job: CrewJob, type: "Before" | "Progress" | "After", files: FileList | null) {
    if (!files?.length) return;

    const selectedFiles = Array.from(files);
    let uploadedPhotos: string[];
    try {
      uploadedPhotos = await Promise.all(selectedFiles.map((file) => compressImageToDataUrl(file)));
    } catch (compressError) {
      reportError(compressError instanceof Error ? compressError.message : "Failed to process photos.");
      return;
    }

    const items = selectedFiles.map((file, index) => ({ name: file.name || `photo-${Date.now()}-${index + 1}.jpg`, dataUrl: uploadedPhotos[index] }));

    // Show the photos immediately, then save/sync in the background.
    const optimisticPhotos = buildOptimisticPhotosFromData(job.id, type, items, selectedCrew);
    const previousPhotos = photos;
    const previousSelected = selectedPhotos;
    setPhotos((current) => [...current, ...optimisticPhotos.map((photo) => ({ ...photo, dataUrl: "" }))]);
    if (job.id === activeJobId) setSelectedPhotos((current) => [...current, ...optimisticPhotos]);

    try {
      await addJobPhotos(job.id, items.map((item) => ({ photoType: type, name: item.name, dataUrl: item.dataUrl, uploadedBy: selectedCrew })));
      await refresh();
      if (job.id === activeJobId) {
        setSelectedPhotos(await loadJobPhotos(job.id));
      }
      addCrmNotification({
        title: "Crew photos uploaded",
        message: `${selectedCrew} uploaded ${items.length} ${type.toLowerCase()} photo(s) for ${job.name}.`,
        actor: selectedCrew,
        module: "Crew Portal",
      });
    } catch (uploadError) {
      setPhotos(previousPhotos);
      setSelectedPhotos(previousSelected);
      reportError(uploadError instanceof Error ? uploadError.message : "Failed to upload photos.");
    }
  }

  function submitForApproval(job: CrewJob) {
    const hasPhoto = job.completion.beforePhotos.length + job.completion.progressPhotos.length + job.completion.afterPhotos.length > 0;
    if (!hasPhoto || !job.completion.notes.trim()) return;

    updateJobFields(job.id, { status: "Mark Done", submittedAt: new Date().toISOString() });
    addCrmNotification({
      title: "Crew job marked done",
      message: `${selectedCrew} marked ${job.name} done and ready for review.`,
      actor: selectedCrew,
      module: "Crew Portal",
    });
  }

  const otherViewers = presence.filter((entry) => entry.jobId && entry.jobId === selectedJob?.id && !(entry.role === "Crew" && entry.name === selectedCrew));

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-5 text-slate-950">
      <section className="mx-auto max-w-5xl space-y-5">
        {error && (
          <div className="flex items-start justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            <span>{error}</span>
            <button type="button" onClick={() => setError("")} className="rounded-lg p-1 hover:bg-red-100"><X className="h-4 w-4" /></button>
          </div>
        )}
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
                {otherViewers.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {otherViewers.map((viewer, index) => (
                      <span key={`${viewer.role}-${viewer.name}-${index}`} className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">
                        <UsersRound className="h-3.5 w-3.5" />{viewer.role} {viewer.name} is {viewer.action}
                      </span>
                    ))}
                  </div>
                )}
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
                <p className="mt-3 text-xs font-bold text-slate-500">Take photos directly from your phone camera or upload from your gallery. Each photo saves automatically to this job&apos;s folder.</p>
                <div className="mt-3 space-y-3">
                  {(["Before", "Progress", "After"] as const).map((type) => {
                    const count = type === "Before" ? selectedJob.completion.beforePhotos.length : type === "Progress" ? selectedJob.completion.progressPhotos.length : selectedJob.completion.afterPhotos.length;
                    return (
                      <div key={type} className="rounded-2xl border border-slate-200 bg-white p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-black uppercase tracking-wide text-slate-500">{type} Photos</p>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{count} photo(s)</span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[#07183f] px-3 py-3 text-sm font-black text-white transition hover:bg-blue-800">
                            <Camera className="h-5 w-5" /> Take Photo
                            <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(event) => void handlePhotoUpload(selectedJob, type, event.target.files)} />
                          </label>
                          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-blue-300 bg-blue-50 px-3 py-3 text-sm font-black text-blue-700 transition hover:bg-blue-100">
                            <UploadCloud className="h-5 w-5" /> Upload Photo
                            <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => void handlePhotoUpload(selectedJob, type, event.target.files)} />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {photosLoading ? (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">{Array.from({ length: 2 }).map((_, index) => <div key={index} className="h-36 w-full animate-pulse rounded-2xl bg-slate-200" />)}</div>
                ) : (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {selectedPhotos.map((photo) => <Image key={photo.id} src={photo.dataUrl} alt={photo.name || "Uploaded job completion"} width={400} height={260} loading="lazy" unoptimized className="h-36 w-full rounded-2xl object-cover" />)}
                  </div>
                )}

                <label className="mt-4 grid gap-2 text-xs font-black uppercase tracking-wide text-slate-500">
                  Completion Notes Required
                  <textarea value={selectedJob.completion.notes} onChange={(event) => updateJobFields(selectedJob.id, { completionNotes: event.target.value })} rows={5} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold normal-case leading-6 tracking-normal text-slate-800 outline-none" placeholder="Removed damaged shingles, replaced underlayment, installed new Owens Corning shingles, cleaned job site, customer notified." />
                </label>
                <label className="mt-4 grid gap-2 text-xs font-black uppercase tracking-wide text-slate-500">
                  Materials Used Optional
                  <input value={selectedJob.completion.materialsUsed || ""} onChange={(event) => updateJobFields(selectedJob.id, { materialsUsed: event.target.value })} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none" placeholder="Owens Corning shingles, underlayment, flashing..." />
                </label>

                <button type="button" disabled={(selectedJob.completion.beforePhotos.length + selectedJob.completion.progressPhotos.length + selectedJob.completion.afterPhotos.length === 0) || !selectedJob.completion.notes.trim()} onClick={() => submitForApproval(selectedJob)} className="mt-5 w-full rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black text-white shadow-lg shadow-emerald-200 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none">
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
