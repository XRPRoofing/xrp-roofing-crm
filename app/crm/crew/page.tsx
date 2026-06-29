"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Calendar, Camera, CheckCircle2, CircleDot, MessageSquare, Plus, RotateCcw, Search, Trash2, UploadCloud, UsersRound, X } from "lucide-react";
import LiveCameraCapture from "@/components/LiveCameraCapture";
import { PhoneLink, EmailLink, AddressLink } from "@/components/ContactLinks";
import QuickSmsModal from "@/components/crm/QuickSmsModal";
import { logCrewActivity, loadJobActivities, subscribeToCrewActivities, type CrewActivity } from "@/lib/crew-activity";
import { compressImageToDataUrl } from "@/lib/image-compress";
import { azDateTime } from "@/lib/arizona-time";
import { createClient } from "@/lib/supabase/client";
import { ensureInvoiceTaskForCompletedJob, syncCrewJobToTaskBoard } from "@/lib/office-tasks";
import { crewMembers, crewStatuses, type CrewJob, type CrewJobStatus } from "@/lib/crew-workflow";
import {
  addChecklistItem,
  addJobNote,
  addJobPhotos,
  assembleCrewJobs,
  buildOptimisticPhotosFromData,
  deleteJobRecord,
  ensureSeedJobs,
  joinCrewPresence,
  loadJobPhotos,
  setChecklistItemDone,
  subscribeToCrewData,
  supabaseSyncEnabled,
  updateJobPhotoType,
  updateJobRecord,
  upsertJobRecord,
  type CrewPresenceState,
  type JobChecklistItem,
  type JobNote,
  type JobPhoto,
  type JobPhotoType,
  type JobRecord,
} from "@/lib/crew-sync";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { getCachedCrewData, refreshCrewData } from "@/lib/data-cache";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";

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
  "Mark Done": "bg-blue-50 text-blue-700 ring-blue-100",
  Completed: "bg-blue-50 text-blue-700 ring-blue-100",
  "Proceed to Invoice": "bg-orange-50 text-orange-700 ring-orange-100",
  "Done Payment": "bg-gray-100 text-gray-700 ring-gray-200",
};

function formatAddress(job: CrewJob) {
  return `${job.address}, ${job.city}, AZ`;
}

export default function CrewWorkflowPage() {
  const cachedCrew = getCachedCrewData();
  const [jobs, setJobs] = useState<JobRecord[]>(() => (cachedCrew?.jobs as JobRecord[]) ?? []);
  const [photos, setPhotos] = useState<JobPhoto[]>(() => cachedCrew?.photos ?? []);
  const [selectedPhotos, setSelectedPhotos] = useState<JobPhoto[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [notes, setNotes] = useState<JobNote[]>(() => cachedCrew?.notes ?? []);
  const [checklist, setChecklist] = useState<JobChecklistItem[]>(() => cachedCrew?.checklist ?? []);
  const [loading, setLoading] = useState(() => cachedCrew === null);
  const [error, setError] = useState("");
  const [presence, setPresence] = useState<CrewPresenceState[]>([]);
  const [activeFilter, setActiveFilter] = useState<"all" | CrewJobStatus>("all");
  const [search, setSearch] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [checklistDraft, setChecklistDraft] = useState("");
  const [newJob, setNewJob] = useState({ name: "", email: "", phone: "", address: "", city: "", roofType: "", value: "", dueDate: "", jobScope: "", jobNotes: "", assignedCrew: crewMembers[0] });
  const [liveCamera, setLiveCamera] = useState<{ jobId: string; type: "Before" | "Progress" | "After" } | null>(null);
  const [currentUserName, setCurrentUserName] = useState("CRM user");
  const [jobActivities, setJobActivities] = useState<CrewActivity[]>([]);
  const [smsTarget, setSmsTarget] = useState<{ phone: string; name?: string } | null>(null);
  const [labelPickerPhoto, setLabelPickerPhoto] = useState<JobPhoto | null>(null);
  const presenceRef = useRef<{ update: (next: Partial<CrewPresenceState>) => void; leave: () => void } | null>(null);

  const crewJobs = useMemo(() => assembleCrewJobs(jobs, photos), [jobs, photos]);
  const filteredJobs = useMemo(() => {
    const query = search.toLowerCase().trim();
    const queryDigits = query.replace(/\D/g, "");
    const queryPhone = queryDigits.length === 11 && queryDigits.startsWith("1") ? queryDigits.slice(1) : queryDigits;
    return crewJobs.filter((job) => {
      const matchesStatus = activeFilter === "all" || job.status === activeFilter;
      if (!query) return matchesStatus;
      const textMatch = [job.name, job.phone, formatAddress(job), job.assignedCrew.join(" "), job.jobScope, job.status].some((value) => value.toLowerCase().includes(query));
      if (textMatch) return matchesStatus;
      if (queryPhone.length >= 2 && job.phone) {
        const jobDigits = job.phone.replace(/\D/g, "");
        const jobPhone = jobDigits.length === 11 && jobDigits.startsWith("1") ? jobDigits.slice(1) : jobDigits;
        if (jobPhone.includes(queryPhone)) return matchesStatus;
      }
      return false;
    });
  }, [activeFilter, crewJobs, search]);
  const selectedJob = crewJobs.find((job) => job.id === selectedJobId) || null;
  const selectedNotes = useMemo(() => notes.filter((note) => note.jobId === selectedJobId), [notes, selectedJobId]);
  const selectedChecklist = useMemo(() => checklist.filter((item) => item.jobId === selectedJobId), [checklist, selectedJobId]);

  const refresh = useCallback(async () => {
    const data = await refreshCrewData();
    setJobs(data.jobs);
    setPhotos(data.photos);
    setNotes(data.notes);
    setChecklist(data.checklist);
  }, []);

  useEffect(() => {
    createClient().auth.getSession().then(({ data }) => {
      if (!data.session) return;
      const meta = data.session.user.user_metadata;
      const name = (meta?.full_name || meta?.name || data.session.user.email?.split("@")[0] || "CRM user") as string;
      setCurrentUserName(name);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let mounted = true;
    async function init() {
      try {
        const data = await refreshCrewData();
        const seededJobs = await ensureSeedJobs(data.jobs);
        if (!mounted) return;
        setJobs(seededJobs);
        setPhotos(data.photos);
        setNotes(data.notes);
        setChecklist(data.checklist);
        setLoading(false);
      } catch (loadError) {
        if (!mounted) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load crew jobs.");
        setLoading(false);
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

  useAutoRefresh(() => { void refresh().catch(() => {}); });

  useEffect(() => {
    const presenceChannel = joinCrewPresence(
      "crew-presence",
      { name: "Admin", role: "Admin", action: "viewing", jobId: null },
      (states) => setPresence(states),
    );
    presenceRef.current = presenceChannel;
    return () => {
      presenceChannel.leave();
      presenceRef.current = null;
    };
  }, []);

  useEffect(() => {
    presenceRef.current?.update({ action: selectedJobId ? "editing" : "viewing", jobId: selectedJobId });
  }, [selectedJobId]);

  // Fetch the heavy image data only for the job that's open, on demand.
  useEffect(() => {
    let active = true;
    async function loadSelected() {
      if (!selectedJobId) {
        setSelectedPhotos([]);
        setJobActivities([]);
        return;
      }
      setPhotosLoading(true);
      setSelectedPhotos([]);
      try {
        const jobPhotos = await loadJobPhotos(selectedJobId);
        if (active) setSelectedPhotos(jobPhotos);
      } catch {
        if (active) setSelectedPhotos([]);
      } finally {
        if (active) setPhotosLoading(false);
      }
      void loadJobActivities(selectedJobId).then((acts) => { if (active) setJobActivities(acts); }).catch(() => {});
    }
    void loadSelected();
    return () => {
      active = false;
    };
  }, [selectedJobId]);

  // Subscribe to real-time crew activity updates
  useEffect(() => {
    const unsub = subscribeToCrewActivities(() => {
      if (selectedJobId) void loadJobActivities(selectedJobId).then(setJobActivities).catch(() => {});
    });
    return unsub;
  }, [selectedJobId]);

  const reportError = useCallback((message: string) => {
    setError(message);
    void refresh().catch(() => {});
  }, [refresh]);

  function updateAssignment(jobId: string, updates: Partial<JobRecord>) {
    const job = crewJobs.find((item) => item.id === jobId);
    if (job && updates.status === "Completed" && updates.status !== job.status) {
      ensureInvoiceTaskForCompletedJob({ ...job, ...updates, status: "Completed" });
    }
    if (job && updates.status && updates.status !== job.status) {
      void logCrewActivity({
        jobId: job.id,
        jobName: job.name,
        actor: currentUserName,
        action: "Changed job status",
        details: `Moved from ${job.status} to ${updates.status}`,
        module: "Crew Workflow",
      });
    }
    // Sync every status change to the Task Board in real time
    if (job) {
      const assembled = crewJobs.find((cj) => cj.id === jobId);
      syncCrewJobToTaskBoard({
        id: job.id,
        name: job.name,
        address: job.address,
        city: job.city,
        value: job.value,
        assignedCrew: Array.isArray(updates.assignedCrew ?? job.assignedCrew) ? (updates.assignedCrew ?? job.assignedCrew) : [],
        status: (updates.status ?? job.status) as string,
        beforePhotoCount: assembled?.completion?.beforePhotos?.length,
        afterPhotoCount: assembled?.completion?.afterPhotos?.length,
        progressPhotoCount: assembled?.completion?.progressPhotos?.length,
        jobLink: `/crm/crew?job=${encodeURIComponent(job.id)}`,
      });
    }

    const previousJobs = jobs;
    setJobs((current) => current.map((item) => (item.id === jobId ? { ...item, ...updates } : item)));
    void updateJobRecord(jobId, updates).catch((updateError) => {
      setJobs(previousJobs);
      reportError(updateError instanceof Error ? updateError.message : "Failed to save change.");
    });
  }

  function toggleCrew(job: CrewJob, member: string) {
    const removing = job.assignedCrew.includes(member);
    const assignedCrew = removing ? job.assignedCrew.filter((crewMember) => crewMember !== member) : [...job.assignedCrew, member];
    updateAssignment(job.id, { assignedCrew });
    void logCrewActivity({
      jobId: job.id,
      jobName: job.name,
      actor: currentUserName,
      action: removing ? "Removed crew member" : "Assigned crew member",
      details: `${member} ${removing ? "removed from" : "assigned to"} job`,
      module: "Crew Workflow",
    });
  }

  // Capture/upload saves the photo instantly — no forced markup step. Drawings
  // and notes can be added later per-photo from the job's Files folder.
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
    const uploadedBy = job.assignedCrew[0] || "Crew";

    // Show the photos immediately, then save/sync in the background.
    const optimisticPhotos = buildOptimisticPhotosFromData(job.id, type, items, uploadedBy);
    const previousPhotos = photos;
    const previousSelected = selectedPhotos;
    setPhotos((current) => [...current, ...optimisticPhotos.map((photo) => ({ ...photo, dataUrl: "" }))]);
    if (job.id === selectedJobId) setSelectedPhotos((current) => [...current, ...optimisticPhotos]);

    try {
      await addJobPhotos(job.id, items.map((item) => ({ photoType: type, name: item.name, dataUrl: item.dataUrl, uploadedBy })));
      // Load only the affected job's photos instead of refreshing all crew data.
      // The realtime subscription will reconcile the full dataset in the background.
      if (job.id === selectedJobId) {
        setSelectedPhotos(await loadJobPhotos(job.id));
      }
      void logCrewActivity({
        jobId: job.id,
        jobName: job.name,
        actor: uploadedBy,
        action: "Uploaded photos",
        details: `Uploaded ${items.length} ${type.toLowerCase()} photo(s)`,
        module: "Crew Workflow",
      });
      // Sync photo counts to Task Board
      const assembled = crewJobs.find((cj) => cj.id === job.id);
      syncCrewJobToTaskBoard({
        id: job.id,
        name: job.name,
        address: job.address,
        city: job.city,
        assignedCrew: Array.isArray(job.assignedCrew) ? job.assignedCrew : [],
        status: job.status as string,
        beforePhotoCount: type === "Before" ? (assembled?.completion?.beforePhotos?.length || 0) + items.length : assembled?.completion?.beforePhotos?.length,
        afterPhotoCount: type === "After" ? (assembled?.completion?.afterPhotos?.length || 0) + items.length : assembled?.completion?.afterPhotos?.length,
        progressPhotoCount: type === "Progress" ? (assembled?.completion?.progressPhotos?.length || 0) + items.length : assembled?.completion?.progressPhotos?.length,
      }, `${items.length} ${type} photo(s) uploaded`);
    } catch (uploadError) {
      setPhotos(previousPhotos);
      setSelectedPhotos(previousSelected);
      reportError(uploadError instanceof Error ? uploadError.message : "Failed to upload photos.");
    }
  }

  async function handleChangePhotoLabel(photo: JobPhoto, newType: JobPhotoType) {
    if (photo.photoType === newType) return;
    const prevPhotos = photos;
    const prevSelected = selectedPhotos;
    const updated = { ...photo, photoType: newType };
    setPhotos((cur) => cur.map((p) => (p.id === photo.id ? updated : p)));
    setSelectedPhotos((cur) => cur.map((p) => (p.id === photo.id ? updated : p)));
    try {
      await updateJobPhotoType(photo.id, newType);
    } catch {
      setPhotos(prevPhotos);
      setSelectedPhotos(prevSelected);
      reportError("Failed to update photo label.");
    }
  }

  async function handleAddNote(job: CrewJob) {
    const body = noteDraft.trim();
    if (!body) return;
    setNoteDraft("");
    try {
      await addJobNote(job.id, currentUserName, body);
      await refresh();
      void logCrewActivity({ jobId: job.id, jobName: job.name, actor: currentUserName, action: "Added note", details: body.slice(0, 120), module: "Crew Workflow" });
      syncCrewJobToTaskBoard({ id: job.id, name: job.name, address: job.address, city: job.city, assignedCrew: Array.isArray(job.assignedCrew) ? job.assignedCrew : [], status: job.status as string }, "Note added by crew");
    } catch (noteError) {
      setNoteDraft(body);
      reportError(noteError instanceof Error ? noteError.message : "Failed to add note.");
    }
  }

  async function handleAddChecklistItem(job: CrewJob) {
    const label = checklistDraft.trim();
    if (!label) return;
    setChecklistDraft("");
    try {
      await addChecklistItem(job.id, label, selectedChecklist.length);
      await refresh();
    } catch (checklistError) {
      setChecklistDraft(label);
      reportError(checklistError instanceof Error ? checklistError.message : "Failed to add checklist item.");
    }
  }

  function handleToggleChecklist(item: JobChecklistItem) {
    const previous = checklist;
    setChecklist((current) => current.map((entry) => (entry.id === item.id ? { ...entry, done: !entry.done } : entry)));
    void setChecklistItemDone(item.id, !item.done).catch((toggleError) => {
      setChecklist(previous);
      reportError(toggleError instanceof Error ? toggleError.message : "Failed to update checklist.");
    });
  }

  async function handleCreateJob() {
    if (!newJob.name.trim() || !newJob.address.trim()) return;

    const record: JobRecord = {
      id: `L-${Date.now()}`,
      name: newJob.name,
      email: newJob.email || "customer@example.com",
      phone: newJob.phone || "",
      address: newJob.address,
      city: newJob.city || "Phoenix",
      stage: "scheduled",
      value: Number(newJob.value) || 0,
      assignedTo: "Crew",
      roofType: newJob.roofType || "Roofing",
      source: "Crew",
      lastActivity: newJob.jobNotes || "Created by crew",
      nextAction: "Complete job",
      dueDate: newJob.dueDate || new Date().toISOString().slice(0, 10),
      status: "Assigned",
      assignedCrew: [newJob.assignedCrew],
      scheduleDate: newJob.dueDate || "",
      jobScope: newJob.jobScope || newJob.roofType || "Roofing",
      jobNotes: newJob.jobNotes || "Crew-created job.",
      completionNotes: "",
      materialsUsed: "",
    };

    try {
      await upsertJobRecord(record);
      await refresh();
      setSelectedJobId(record.id);
      void logCrewActivity({
        jobId: record.id,
        jobName: record.name,
        actor: currentUserName,
        action: "Created new job",
        details: `Assigned to ${newJob.assignedCrew}`,
        module: "Crew Workflow",
      });
      // Auto-create task card on job creation
      syncCrewJobToTaskBoard({
        id: record.id,
        name: record.name,
        address: record.address,
        city: record.city,
        value: record.value,
        assignedCrew: record.assignedCrew,
        status: record.status as string,
        jobLink: `/crm/crew?job=${encodeURIComponent(record.id)}`,
      }, "New job created by crew");
      setNewJob({ name: "", email: "", phone: "", address: "", city: "", roofType: "", value: "", dueDate: "", jobScope: "", jobNotes: "", assignedCrew: crewMembers[0] });
      setShowCreateJob(false);
    } catch (createError) {
      reportError(createError instanceof Error ? createError.message : "Failed to create job.");
    }
  }

  async function handleDeleteJob(job: CrewJob) {
    if (typeof window !== "undefined" && !window.confirm(`Delete "${job.name}"? This permanently removes the job and its photos, notes, and checklist for everyone. This cannot be undone.`)) return;

    const previousJobs = jobs;
    setSelectedJobId(null);
    setJobs((current) => current.filter((item) => item.id !== job.id));
    try {
      await deleteJobRecord(job.id);
      void logCrewActivity({
        jobId: job.id,
        jobName: job.name,
        actor: currentUserName,
        action: "Deleted job",
        details: `${job.name} permanently removed`,
        module: "Crew Workflow",
      });
    } catch (deleteError) {
      setJobs(previousJobs);
      reportError(deleteError instanceof Error ? deleteError.message : "Failed to delete job.");
    }
  }

  const viewersForSelectedJob = presence.filter((entry) => entry.jobId === selectedJobId);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      {error && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-bold text-orange-700">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} className="rounded-lg p-1 hover:bg-orange-100"><X className="h-4 w-4" /></button>
        </div>
      )}

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-orange-600">Production Workflow</p>
            <h1 className="mt-0.5 text-xl font-bold tracking-tight text-blue-700 sm:text-3xl">Roofing Crew Workflow</h1>
            <p className="crm-board-subtitle mt-1 hidden text-sm font-semibold text-gray-600 sm:block">Compact daily operations view for assignments, job status, completion review, and approvals.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${supabaseSyncEnabled() ? "bg-blue-50 text-blue-700" : "bg-orange-50 text-orange-700"}`}>
                <CircleDot className="h-3.5 w-3.5" />{supabaseSyncEnabled() ? "Live sync on" : "Local mode (configure Supabase for live sync)"}
              </span>
              {presence.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                  <UsersRound className="h-3.5 w-3.5" />{presence.length} viewing now
                </span>
              )}
            </div>
          </div>
          <div className="flex w-full flex-col gap-3 lg:max-w-lg lg:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-lg border border-gray-200 bg-gray-50 py-3 pl-11 pr-4 text-sm font-bold outline-none focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50" placeholder="Search jobs, team, scope..." />
            </div>
            <button type="button" onClick={() => setShowCreateJob(true)} className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"><Plus className="mr-2 inline h-4 w-4" />New Job</button>
          </div>
        </div>

        <div className="crm-filter-scroll mt-3 flex gap-2 overflow-x-auto pb-1">
          {filters.map((filter) => {
            const count = filter.value === "all" ? crewJobs.length : crewJobs.filter((job) => job.status === filter.value).length;
            return (
              <button key={filter.value} type="button" onClick={() => setActiveFilter(filter.value)} className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold transition ${activeFilter === filter.value ? "bg-blue-600 text-white shadow-sm" : "bg-gray-100 text-gray-700 hover:bg-blue-50 hover:text-blue-700"}`}>
                {filter.label} <span className="ml-1 opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="min-h-0 flex-1 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="h-full overflow-x-auto overflow-y-auto">
          <table className="min-w-[1080px] w-full text-left">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs font-bold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-5 py-3.5">Customer Name</th>
                <th className="px-5 py-3.5">Property Address</th>
                <th className="px-5 py-3.5">Assigned Team</th>
                <th className="px-5 py-3.5">Schedule Date</th>
                <th className="px-5 py-3.5">Job Scope</th>
                <th className="px-5 py-3.5">Job Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm">
              {filteredJobs.map((job) => {
                const jobViewers = presence.filter((entry) => entry.jobId === job.id);
                return (
                  <tr key={job.id} onClick={() => setSelectedJobId(job.id)} className="cursor-pointer bg-white transition hover:bg-blue-50/60">
                    <td className="px-5 py-3.5 font-bold text-blue-700">
                      <span className="flex items-center gap-2">{job.name}{jobViewers.length > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-700"><UsersRound className="h-3 w-3" />{jobViewers.length}</span>}</span>
                    </td>
                    <td className="max-w-xs truncate px-5 py-3.5 font-semibold text-gray-600"><AddressLink value={formatAddress(job)} /></td>
                    <td className="px-5 py-3.5"><div className="flex flex-wrap gap-1">{job.assignedCrew.map((member) => <span key={member} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-700">{member}</span>)}</div></td>
                    <td className="px-4 py-3 font-bold text-gray-700">{job.scheduleDate ? job.scheduleDate : <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedJobId(job.id); }} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-400 transition hover:border-blue-400 hover:text-blue-600"><Calendar className="h-3.5 w-3.5" />Set date</button>}</td>
                    <td className="max-w-[180px] truncate px-5 py-3.5 font-semibold text-gray-600">{job.jobScope}</td>
                    <td className="px-5 py-3.5"><span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${statusStyles[job.status]}`}>{job.status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {loading && <div className="p-8 text-center text-sm font-bold text-gray-500">Loading crew jobs…</div>}
        {!loading && filteredJobs.length === 0 && <div className="p-8 text-center text-sm font-bold text-gray-500">No crew jobs match this filter.</div>}
      </section>

      {showCreateJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-4 backdrop-blur-sm" onClick={() => setShowCreateJob(false)}>
        <section className="my-auto w-full max-w-2xl rounded-lg border border-blue-100 bg-blue-50 p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Crew Created Job</p>
              <h2 className="mt-1 text-2xl font-bold text-blue-700">Create New Job</h2>
            </div>
            <button type="button" onClick={() => setShowCreateJob(false)} className="rounded-lg p-2 text-gray-500 hover:bg-white"><X className="h-5 w-5" /></button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <input value={newJob.name} onChange={(event) => setNewJob({ ...newJob, name: event.target.value })} className="rounded-lg border border-blue-100 px-4 py-3 text-sm font-bold outline-none md:col-span-1" placeholder="Customer name" />
            <input value={newJob.phone} onChange={(event) => setNewJob({ ...newJob, phone: event.target.value })} className="rounded-lg border border-blue-100 px-4 py-3 text-sm font-bold outline-none" placeholder="Phone" />
            <input value={newJob.email} onChange={(event) => setNewJob({ ...newJob, email: event.target.value })} className="rounded-lg border border-blue-100 px-4 py-3 text-sm font-bold outline-none" placeholder="Email" />
            <AddressAutocomplete value={newJob.address} onChange={(address) => setNewJob({ ...newJob, address })} placeholder="Start typing address..." className="md:col-span-2" />
            <input value={newJob.city} onChange={(event) => setNewJob({ ...newJob, city: event.target.value })} className="rounded-lg border border-blue-100 px-4 py-3 text-sm font-bold outline-none" placeholder="City" />
            <input value={newJob.roofType} onChange={(event) => setNewJob({ ...newJob, roofType: event.target.value })} className="rounded-lg border border-blue-100 px-4 py-3 text-sm font-bold outline-none" placeholder="Roof type" />
            <input value={newJob.value} onChange={(event) => setNewJob({ ...newJob, value: event.target.value })} type="number" className="rounded-lg border border-blue-100 px-4 py-3 text-sm font-bold outline-none" placeholder="Job value" />
            <input value={newJob.dueDate} onChange={(event) => setNewJob({ ...newJob, dueDate: event.target.value })} type="date" className="rounded-lg border border-blue-100 px-4 py-3 text-sm font-bold outline-none" />
            <select value={newJob.assignedCrew} onChange={(event) => setNewJob({ ...newJob, assignedCrew: event.target.value })} className="rounded-lg border border-blue-100 px-4 py-3 text-sm font-bold outline-none">
              {crewMembers.map((member) => <option key={member}>{member}</option>)}
            </select>
            <input value={newJob.jobScope} onChange={(event) => setNewJob({ ...newJob, jobScope: event.target.value })} className="rounded-lg border border-blue-100 px-4 py-3 text-sm font-bold outline-none md:col-span-3" placeholder="Job scope" />
            <textarea value={newJob.jobNotes} onChange={(event) => setNewJob({ ...newJob, jobNotes: event.target.value })} className="min-h-24 rounded-lg border border-blue-100 px-4 py-3 text-sm font-bold outline-none md:col-span-3" placeholder="Job notes" />
          </div>
          <div className="mt-4 flex justify-end gap-3">
            <button type="button" onClick={() => setShowCreateJob(false)} className="rounded-lg bg-white px-4 py-3 text-sm font-bold text-gray-700">Cancel</button>
            <button type="button" onClick={() => void handleCreateJob()} className="rounded-lg bg-orange-500 px-4 py-3 text-sm font-bold text-white">Create Job</button>
          </div>
        </section>
        </div>
      )}

      {selectedJob && (
        <div className="fixed inset-0 z-50 flex justify-end bg-gray-950/30 backdrop-blur-sm" onClick={() => setSelectedJobId(null)}>
          <aside className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 border-b border-gray-200 bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-orange-600">Job Details</p>
                  <h2 className="mt-1 text-2xl font-bold text-blue-700">{selectedJob.name}</h2>
                  <p className="mt-1 text-sm font-bold text-gray-500"><AddressLink value={formatAddress(selectedJob)} /></p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => void handleDeleteJob(selectedJob)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 transition hover:bg-red-100"><Trash2 className="h-4 w-4" />Delete Job</button>
                  <button type="button" onClick={() => setSelectedJobId(null)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
                </div>
              </div>
              {viewersForSelectedJob.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {viewersForSelectedJob.map((viewer, index) => (
                    <span key={`${viewer.role}-${viewer.name}-${index}`} className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                      <UsersRound className="h-3.5 w-3.5" />{viewer.role} {viewer.name} is {viewer.action}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-5 p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-gray-50 p-4"><p className="text-xs font-bold uppercase text-gray-500">Customer Information</p><p className="mt-2 font-bold text-gray-900">{selectedJob.name}</p><p className="flex items-center gap-2 text-sm font-semibold text-gray-600"><PhoneLink value={selectedJob.phone} />{selectedJob.phone && <button onClick={() => setSmsTarget({ phone: selectedJob.phone, name: selectedJob.name })} className="inline-flex h-6 items-center gap-1 rounded bg-green-500 px-2 text-xs font-bold text-white hover:bg-green-600"><MessageSquare className="h-3 w-3" />SMS</button>}</p><p className="text-sm font-semibold text-gray-600"><EmailLink value={selectedJob.email} /></p></div>
                <label className="grid gap-2 rounded-lg bg-gray-50 p-4 text-xs font-bold uppercase text-gray-500">Schedule Date<input type="date" value={selectedJob.scheduleDate} onChange={(event) => { updateAssignment(selectedJob.id, { scheduleDate: event.target.value }); if (event.target.value) void logCrewActivity({ jobId: selectedJob.id, jobName: selectedJob.name, actor: currentUserName, action: "Updated schedule", details: `Schedule date set to ${event.target.value}`, module: "Crew Workflow" }); }} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold normal-case text-gray-800 outline-none" /></label>
                <label className="grid gap-2 rounded-lg bg-gray-50 p-4 text-xs font-bold uppercase text-gray-500 sm:col-span-2">Job Scope<input value={selectedJob.jobScope} onChange={(event) => updateAssignment(selectedJob.id, { jobScope: event.target.value })} onBlur={(event) => { if (event.target.value.trim()) void logCrewActivity({ jobId: selectedJob.id, jobName: selectedJob.name, actor: currentUserName, action: "Updated job scope", details: event.target.value.trim().slice(0, 120), module: "Crew Workflow" }); }} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold normal-case text-gray-800 outline-none" /></label>
                <label className="grid gap-2 rounded-lg bg-gray-50 p-4 text-xs font-bold uppercase text-gray-500 sm:col-span-2">Job Notes<textarea value={selectedJob.jobNotes} onChange={(event) => updateAssignment(selectedJob.id, { jobNotes: event.target.value })} onBlur={(event) => { if (event.target.value.trim()) void logCrewActivity({ jobId: selectedJob.id, jobName: selectedJob.name, actor: currentUserName, action: "Updated job notes", details: event.target.value.trim().slice(0, 120), module: "Crew Workflow" }); }} rows={3} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold normal-case leading-6 text-gray-800 outline-none" /></label>
                <label className="grid gap-2 rounded-lg bg-gray-50 p-4 text-xs font-bold uppercase text-gray-500 sm:col-span-2">Job Status<select value={selectedJob.status} onChange={(event) => updateAssignment(selectedJob.id, { status: event.target.value as CrewJobStatus })} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold normal-case text-gray-800 outline-none">{crewStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-bold text-blue-700"><UsersRound className="h-4 w-4" />Assigned Team</div>
                <div className="flex flex-wrap gap-2">{crewMembers.map((member) => <button key={member} type="button" onClick={() => toggleCrew(selectedJob, member)} className={`rounded-full px-4 py-2 text-sm font-bold transition ${selectedJob.assignedCrew.includes(member) ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-blue-50"}`}>{member}</button>)}</div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <p className="text-sm font-bold text-blue-700">Uploaded Photos</p>
                <div className="mt-2 space-y-2">
                  {(["Before", "Progress", "After"] as const).map((type) => {
                    const count = type === "Before" ? selectedJob.completion.beforePhotos.length : type === "Progress" ? selectedJob.completion.progressPhotos.length : selectedJob.completion.afterPhotos.length;
                    return (
                      <div key={type} className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">{type}</p>
                          <span className="rounded-full bg-white px-1.5 py-0.5 text-[11px] font-bold text-gray-500 ring-1 ring-gray-200">{count}</span>
                        </div>
                        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() => setLiveCamera({ jobId: selectedJob.id, type })}
                            className="flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-2 py-2 text-xs font-bold text-white transition hover:bg-blue-800 active:scale-95"
                          >
                            <Camera className="h-4 w-4" /> Camera
                          </button>
                          <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-2 py-2 text-xs font-bold text-blue-700 transition hover:bg-blue-100">
                            <UploadCloud className="h-4 w-4" /> Upload
                            <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => void handlePhotoUpload(selectedJob, type, event.target.files)} />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {photosLoading ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">{Array.from({ length: 2 }).map((_, index) => <div key={index} className="h-20 w-full animate-pulse rounded-lg bg-gray-200" />)}</div>
                ) : (
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">{selectedPhotos.map((photo) => (
                    <button key={photo.id} type="button" onClick={() => setLabelPickerPhoto(photo)} className="group relative h-20 w-full overflow-hidden rounded-lg">
                      <Image src={photo.dataUrl} alt={photo.name || "Crew uploaded completion"} width={400} height={240} loading="lazy" unoptimized className="h-full w-full object-cover" />
                      {photo.photoType && photo.photoType !== "Job Photo" && (
                        <span className={`absolute left-1 top-1 rounded px-1.5 py-0.5 text-[9px] font-black uppercase text-white ${photo.photoType === "Before" ? "bg-blue-600" : photo.photoType === "After" ? "bg-emerald-600" : "bg-orange-500"}`}>{photo.photoType}</span>
                      )}
                      <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-[10px] font-bold text-white opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">Change Label</span>
                    </button>
                  ))}</div>
                )}
                {!photosLoading && selectedPhotos.length === 0 && <p className="mt-1.5 text-xs font-semibold text-gray-500">No photos uploaded yet.</p>}
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <p className="text-sm font-bold text-blue-700">Checklist</p>
                <div className="mt-3 space-y-2">
                  {selectedChecklist.map((item) => (
                    <label key={item.id} className="flex cursor-pointer items-center gap-3 rounded-lg bg-gray-50 px-3 py-2 text-sm font-bold text-gray-700">
                      <input type="checkbox" checked={item.done} onChange={() => handleToggleChecklist(item)} className="h-4 w-4 rounded border-gray-300" />
                      <span className={item.done ? "line-through text-gray-400" : ""}>{item.label}</span>
                    </label>
                  ))}
                  {selectedChecklist.length === 0 && <p className="text-sm font-semibold text-gray-500">No checklist items yet.</p>}
                </div>
                <div className="mt-3 flex gap-2">
                  <input value={checklistDraft} onChange={(event) => setChecklistDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void handleAddChecklistItem(selectedJob); } }} className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold outline-none" placeholder="Add checklist item" />
                  <button type="button" onClick={() => void handleAddChecklistItem(selectedJob)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white">Add</button>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <p className="text-sm font-bold text-blue-700">Notes</p>
                <div className="mt-3 space-y-2">
                  {selectedNotes.map((note) => (
                    <div key={note.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
                      <p className="font-semibold text-gray-700">{note.body}</p>
                      <p className="mt-1 text-xs font-bold text-gray-400">{note.author} • {azDateTime(note.createdAt)}</p>
                    </div>
                  ))}
                  {selectedNotes.length === 0 && <p className="text-sm font-semibold text-gray-500">No notes yet.</p>}
                </div>
                <div className="mt-3 flex gap-2">
                  <input value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void handleAddNote(selectedJob); } }} className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold outline-none" placeholder="Add a note" />
                  <button type="button" onClick={() => void handleAddNote(selectedJob)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white">Add</button>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm font-bold text-blue-700">Completion Notes</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-gray-700">{selectedJob.completion.notes || "No completion notes submitted yet."}</p>
                <p className="mt-3 text-sm font-bold text-blue-700">Materials Used</p>
                <p className="mt-1 text-sm font-semibold text-gray-700">{selectedJob.completion.materialsUsed || "No materials recorded."}</p>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <p className="text-sm font-bold text-blue-700">Activity History</p>
                <div className="mt-3 space-y-2 text-sm font-semibold text-gray-600">
                  <p>Current status: <span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${statusStyles[selectedJob.status]}`}>{selectedJob.status}</span></p>
                  {selectedJob.completion.submittedAt && <p>Marked done: {azDateTime(selectedJob.completion.submittedAt)}</p>}
                  {selectedJob.adminNotification && <p>{selectedJob.adminNotification}</p>}
                </div>
                <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
                  {jobActivities.length === 0 && <p className="text-sm text-gray-400">No activity recorded yet.</p>}
                  {jobActivities.map((act) => (
                    <div key={act.id} className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2">
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-black text-blue-700">{act.actor.charAt(0).toUpperCase()}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-gray-900">{act.actor}</span>
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600">{act.module}</span>
                        </div>
                        <p className="text-sm text-gray-700">{act.action}{act.details ? ` — ${act.details}` : ""}</p>
                        <p className="text-[11px] text-gray-400">{azDateTime(act.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {selectedJob.status === "Mark Done" && (
                <div className="sticky bottom-0 -mx-5 border-t border-gray-200 bg-white p-5">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => updateAssignment(selectedJob.id, { status: "Completed" })} className="rounded-full bg-blue-600 px-4 py-2 text-sm font-bold text-white"><CheckCircle2 className="mr-2 inline h-4 w-4" />Approve Job</button>
                    <button type="button" onClick={() => updateAssignment(selectedJob.id, { status: "In Progress" })} className="rounded-full bg-white px-4 py-2 text-sm font-bold text-orange-700 ring-1 ring-orange-200"><RotateCcw className="mr-2 inline h-4 w-4" />Return To Team</button>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Live Camera Overlay */}
      {liveCamera && (() => {
        const camJob = crewJobs.find((j) => j.id === liveCamera.jobId);
        if (!camJob) return null;
        const accentMap = { Before: "bg-blue-600", Progress: "bg-orange-500", After: "bg-blue-600" } as const;
        const existingCount = liveCamera.type === "Before"
          ? camJob.completion.beforePhotos.length
          : liveCamera.type === "Progress"
          ? camJob.completion.progressPhotos.length
          : camJob.completion.afterPhotos.length;
        return (
          <LiveCameraCapture
            label={liveCamera.type}
            accentColor={accentMap[liveCamera.type]}
            existingCount={existingCount}
            onCapture={async (photo) => {
              const uploadedBy = camJob.assignedCrew[0] || "Crew";
              const optimistic = buildOptimisticPhotosFromData(camJob.id, liveCamera.type, [{ name: photo.name, dataUrl: photo.dataUrl }], uploadedBy);
              setPhotos((cur) => [...cur, ...optimistic.map((p) => ({ ...p, dataUrl: "" }))]);
              if (camJob.id === selectedJobId) setSelectedPhotos((cur) => [...cur, ...optimistic]);
              await addJobPhotos(camJob.id, [{ photoType: liveCamera.type, name: photo.name, dataUrl: photo.dataUrl, uploadedBy }]);
              await refresh();
              if (camJob.id === selectedJobId) setSelectedPhotos(await loadJobPhotos(camJob.id));
            }}
            onClose={() => setLiveCamera(null)}
          />
        );
      })()}
      {smsTarget && <QuickSmsModal phone={smsTarget.phone} name={smsTarget.name} onClose={() => setSmsTarget(null)} />}

      {/* Photo Label Picker Modal */}
      {labelPickerPhoto && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" onClick={() => setLabelPickerPhoto(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-xs rounded-t-2xl bg-white p-5 pb-8 shadow-xl sm:rounded-2xl sm:pb-5" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 text-center text-sm font-black text-gray-800">Change Photo Label</p>
            <div className="space-y-1.5">
              {([["Before", "bg-blue-600"], ["Progress", "bg-orange-500"], ["After", "bg-emerald-600"], ["Job Photo", "bg-gray-500"]] as const).map(([type, color]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => { void handleChangePhotoLabel(labelPickerPhoto, type); setLabelPickerPhoto(null); }}
                  className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold transition active:scale-[0.98] ${labelPickerPhoto.photoType === type ? "bg-blue-50 text-blue-700 ring-2 ring-blue-500" : "bg-gray-50 text-gray-700 hover:bg-gray-100"}`}
                >
                  <span className={`h-3 w-3 rounded-full ${color}`} />
                  {type === "Job Photo" ? "No Label" : type}
                  {labelPickerPhoto.photoType === type && <span className="ml-auto text-xs text-blue-500">Current</span>}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setLabelPickerPhoto(null)} className="mt-3 w-full rounded-xl py-2.5 text-center text-sm font-bold text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
