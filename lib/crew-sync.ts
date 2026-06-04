"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { leads } from "@/lib/crm-data";
import type { Lead } from "@/types/crm";
import {
  cleanAssignedCrewMembers,
  createDefaultCrewAssignment,
  jobsStorageKey,
  type CrewAssignment,
  type CrewJob,
  type CrewJobStatus,
} from "@/lib/crew-workflow";

/**
 * Supabase-backed crew workflow data layer.
 *
 * This is the single source of truth shared by the Crew Portal and the Admin
 * CRM. When Supabase is configured every read/write goes to the `jobs`,
 * `job_photos`, `job_notes` and `job_checklist_items` tables and changes are
 * broadcast to all connected clients in real time. When Supabase is not
 * configured it transparently falls back to the legacy localStorage behavior so
 * the app still works in local/dev environments without a database.
 */

export type JobRecord = Lead & {
  status: CrewJobStatus;
  assignedCrew: string[];
  scheduleDate: string;
  jobScope: string;
  jobNotes: string;
  completionNotes: string;
  materialsUsed: string;
  submittedAt?: string;
};

export type JobPhotoType = "Before" | "Progress" | "After" | "Job Photo";

export type JobPhoto = {
  id: string;
  jobId: string;
  photoType: JobPhotoType;
  name: string;
  dataUrl: string;
  uploadedBy: string;
  createdAt: string;
};

export type JobNote = {
  id: string;
  jobId: string;
  author: string;
  body: string;
  createdAt: string;
};

export type JobChecklistItem = {
  id: string;
  jobId: string;
  label: string;
  done: boolean;
  position: number;
  createdAt: string;
};

export type CrewDataset = {
  jobs: JobRecord[];
  photos: JobPhoto[];
  notes: JobNote[];
  checklist: JobChecklistItem[];
};

export const jobsTable = "jobs";
export const jobPhotosTable = "job_photos";
export const jobNotesTable = "job_notes";
export const jobChecklistTable = "job_checklist_items";
export const jobPhotoBucket = "job-photos";

const crewSyncPhotosKey = "xrp-crm-job-photos";
const crewSyncNotesKey = "xrp-crm-job-notes";
const crewSyncChecklistKey = "xrp-crm-job-checklist";
const crewAssignmentsKey = "xrp-crm-crew-workflow";
export const crewSyncUpdatedEvent = "crm-crew-sync-updated";

export const supabaseSyncEnabled = hasSupabaseConfig;

export function leadToJobRecord(lead: Lead, index = 0): JobRecord {
  const assignment = createDefaultCrewAssignment(lead, index);
  return {
    ...lead,
    nextAction: lead.nextAction || lead.lastActivity || "Review next step",
    dueDate: lead.dueDate || "2026-06-05",
    status: assignment.status,
    assignedCrew: assignment.assignedCrew,
    scheduleDate: assignment.scheduleDate,
    jobScope: assignment.jobScope,
    jobNotes: assignment.jobNotes,
    completionNotes: assignment.completion.notes,
    materialsUsed: assignment.completion.materialsUsed || "",
    submittedAt: assignment.completion.submittedAt,
  };
}

export function seedJobRecords(): JobRecord[] {
  return leads.map((lead, index) => leadToJobRecord(lead, index));
}

/** Assemble the flattened `CrewJob` shape the existing UI components expect. */
export function assembleCrewJob(record: JobRecord, photos: JobPhoto[]): CrewJob {
  const jobPhotos = photos.filter((photo) => photo.jobId === record.id);
  return {
    ...record,
    jobId: record.id,
    assignedCrew: cleanAssignedCrewMembers(record.assignedCrew),
    completion: {
      beforePhotos: jobPhotos.filter((photo) => photo.photoType === "Before").map((photo) => photo.dataUrl),
      progressPhotos: jobPhotos.filter((photo) => photo.photoType === "Progress").map((photo) => photo.dataUrl),
      afterPhotos: jobPhotos.filter((photo) => photo.photoType === "After").map((photo) => photo.dataUrl),
      notes: record.completionNotes,
      materialsUsed: record.materialsUsed,
      submittedAt: record.submittedAt,
    },
  };
}

export function assembleCrewJobs(records: JobRecord[], photos: JobPhoto[]): CrewJob[] {
  return records.map((record) => assembleCrewJob(record, photos));
}

// ---------------------------------------------------------------------------
// Row mappers (snake_case Supabase rows <-> camelCase app types).
// ---------------------------------------------------------------------------

type JobRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  stage: string;
  value: number | string;
  assigned_to: string;
  roof_type: string;
  source: string;
  last_activity: string;
  next_action: string;
  due_date: string;
  status: string;
  assigned_crew: unknown;
  schedule_date: string;
  job_scope: string;
  job_notes: string;
  completion_notes: string;
  materials_used: string;
  submitted_at: string | null;
};

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

function rowToJobRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    stage: row.stage as Lead["stage"],
    value: Number(row.value) || 0,
    assignedTo: row.assigned_to,
    roofType: row.roof_type,
    source: row.source,
    lastActivity: row.last_activity,
    nextAction: row.next_action,
    dueDate: row.due_date,
    status: (row.status as CrewJobStatus) || "Assigned",
    assignedCrew: cleanAssignedCrewMembers(toStringArray(row.assigned_crew)),
    scheduleDate: row.schedule_date,
    jobScope: row.job_scope,
    jobNotes: row.job_notes,
    completionNotes: row.completion_notes,
    materialsUsed: row.materials_used,
    submittedAt: row.submitted_at || undefined,
  };
}

function jobRecordToRow(record: JobRecord) {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    phone: record.phone,
    address: record.address,
    city: record.city,
    stage: record.stage,
    value: record.value,
    assigned_to: record.assignedTo,
    roof_type: record.roofType,
    source: record.source,
    last_activity: record.lastActivity,
    next_action: record.nextAction || "",
    due_date: record.dueDate || "",
    status: record.status,
    assigned_crew: record.assignedCrew,
    schedule_date: record.scheduleDate,
    job_scope: record.jobScope,
    job_notes: record.jobNotes,
    completion_notes: record.completionNotes,
    materials_used: record.materialsUsed,
    submitted_at: record.submittedAt || null,
  };
}

// `data_url` is intentionally optional: board reads omit it so the heavy image
// payload is only fetched per-job, on demand (see loadJobPhotos).
type PhotoRow = { id: string; job_id: string; photo_type: string; name: string; data_url?: string; uploaded_by: string; created_at: string };
function rowToPhoto(row: PhotoRow): JobPhoto {
  return { id: row.id, jobId: row.job_id, photoType: (row.photo_type as JobPhotoType) || "Job Photo", name: row.name, dataUrl: row.data_url ?? "", uploadedBy: row.uploaded_by, createdAt: row.created_at };
}

// Columns needed to render the board (counts, sections) WITHOUT the image bytes.
const photoMetaColumns = "id, job_id, photo_type, name, uploaded_by, created_at";

type NoteRow = { id: string; job_id: string; author: string; body: string; created_at: string };
function rowToNote(row: NoteRow): JobNote {
  return { id: row.id, jobId: row.job_id, author: row.author, body: row.body, createdAt: row.created_at };
}

type ChecklistRow = { id: string; job_id: string; label: string; done: boolean; position: number; created_at: string };
function rowToChecklist(row: ChecklistRow): JobChecklistItem {
  return { id: row.id, jobId: row.job_id, label: row.label, done: row.done, position: row.position, createdAt: row.created_at };
}

// ---------------------------------------------------------------------------
// localStorage fallback helpers.
// ---------------------------------------------------------------------------

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const saved = window.localStorage.getItem(key);
  if (!saved) return fallback;
  try {
    return JSON.parse(saved) as T;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new Event(crewSyncUpdatedEvent));
}

function readLocalJobs(): JobRecord[] {
  const savedJobs = readLocal<Lead[] | null>(jobsStorageKey, null);
  const savedAssignments = readLocal<CrewAssignment[]>(crewAssignmentsKey, []);
  const baseJobs = savedJobs && savedJobs.length > 0 ? savedJobs : leads;
  return baseJobs.map((job, index) => {
    const record = leadToJobRecord(job, index);
    const assignment = savedAssignments.find((item) => item.jobId === job.id);
    if (!assignment) return record;
    return {
      ...record,
      status: assignment.status,
      assignedCrew: cleanAssignedCrewMembers(assignment.assignedCrew),
      scheduleDate: assignment.scheduleDate,
      jobScope: assignment.jobScope,
      jobNotes: assignment.jobNotes,
      completionNotes: assignment.completion.notes,
      materialsUsed: assignment.completion.materialsUsed || "",
      submittedAt: assignment.completion.submittedAt,
    };
  });
}

function writeLocalJobs(records: JobRecord[]) {
  if (typeof window === "undefined") return;
  const baseJobs: Lead[] = records.map(({ id, name, email, phone, address, city, stage, value, assignedTo, roofType, source, lastActivity, nextAction, dueDate }) => ({
    id, name, email, phone, address, city, stage, value, assignedTo, roofType, source, lastActivity, nextAction, dueDate,
  }));
  const assignments: CrewAssignment[] = records.map((record) => ({
    jobId: record.id,
    assignedCrew: record.assignedCrew,
    status: record.status,
    scheduleDate: record.scheduleDate,
    jobScope: record.jobScope,
    jobNotes: record.jobNotes,
    completion: {
      beforePhotos: [],
      progressPhotos: [],
      afterPhotos: [],
      notes: record.completionNotes,
      materialsUsed: record.materialsUsed,
      submittedAt: record.submittedAt,
    },
  }));
  window.localStorage.setItem(jobsStorageKey, JSON.stringify(baseJobs));
  window.localStorage.setItem(crewAssignmentsKey, JSON.stringify(assignments));
  window.dispatchEvent(new Event(crewSyncUpdatedEvent));
  window.dispatchEvent(new Event("crm-crew-workflow-updated"));
}

// ---------------------------------------------------------------------------
// Public reads.
// ---------------------------------------------------------------------------

export async function loadCrewDataset(): Promise<CrewDataset> {
  if (!hasSupabaseConfig()) {
    return {
      jobs: readLocalJobs(),
      // Strip the image bytes from the board dataset; the heavy `dataUrl` is
      // loaded per-job via loadJobPhotos when a job is opened. Counts/sections
      // still work because only the array length matters here.
      photos: readLocal<JobPhoto[]>(crewSyncPhotosKey, []).map((photo) => ({ ...photo, dataUrl: "" })),
      notes: readLocal<JobNote[]>(crewSyncNotesKey, []),
      checklist: readLocal<JobChecklistItem[]>(crewSyncChecklistKey, []),
    };
  }

  const supabase = createClient();
  const [jobsResult, photosResult, notesResult, checklistResult] = await Promise.all([
    supabase.from(jobsTable).select("*").order("created_at", { ascending: true }),
    // Metadata only — never download every photo's image bytes for the board.
    supabase.from(jobPhotosTable).select(photoMetaColumns).order("created_at", { ascending: true }),
    supabase.from(jobNotesTable).select("*").order("created_at", { ascending: true }),
    supabase.from(jobChecklistTable).select("*").order("position", { ascending: true }),
  ]);

  const firstError = jobsResult.error || photosResult.error || notesResult.error || checklistResult.error;
  if (firstError) {
    throw new Error(firstError.message);
  }

  return {
    jobs: (jobsResult.data as JobRow[]).map(rowToJobRecord),
    photos: (photosResult.data as PhotoRow[]).map(rowToPhoto),
    notes: (notesResult.data as NoteRow[]).map(rowToNote),
    checklist: (checklistResult.data as ChecklistRow[]).map(rowToChecklist),
  };
}

/**
 * Load the full photos (including image data) for a single job. Called only
 * when a job is opened, so the board itself never pays the cost of downloading
 * every image. Works in both Supabase and localStorage modes.
 */
export async function loadJobPhotos(jobId: string): Promise<JobPhoto[]> {
  if (!jobId) return [];
  if (!hasSupabaseConfig()) {
    return readLocal<JobPhoto[]>(crewSyncPhotosKey, []).filter((photo) => photo.jobId === jobId);
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from(jobPhotosTable)
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as PhotoRow[]).map(rowToPhoto);
}

/** Seed Supabase with the demo jobs if the table is empty (best effort). */
export async function ensureSeedJobs(existing: JobRecord[]): Promise<JobRecord[]> {
  if (!hasSupabaseConfig() || existing.length > 0) return existing;
  const supabase = createClient();
  const seeded = seedJobRecords();
  const { error } = await supabase.from(jobsTable).upsert(seeded.map(jobRecordToRow), { onConflict: "id", ignoreDuplicates: true });
  if (error) return existing;
  return seeded;
}

// ---------------------------------------------------------------------------
// Public writes.
// ---------------------------------------------------------------------------

export async function upsertJobRecord(record: JobRecord): Promise<void> {
  if (!hasSupabaseConfig()) {
    const records = readLocalJobs();
    const exists = records.some((item) => item.id === record.id);
    writeLocalJobs(exists ? records.map((item) => (item.id === record.id ? record : item)) : [record, ...records]);
    return;
  }
  const supabase = createClient();
  const { error } = await supabase.from(jobsTable).upsert(jobRecordToRow(record), { onConflict: "id" });
  if (error) throw new Error(error.message);
}

export async function updateJobRecord(jobId: string, patch: Partial<JobRecord>): Promise<void> {
  if (!hasSupabaseConfig()) {
    writeLocalJobs(readLocalJobs().map((item) => (item.id === jobId ? { ...item, ...patch } : item)));
    return;
  }
  const supabase = createClient();
  const fullPatch = jobRecordToRow({ id: jobId, ...patch } as JobRecord);
  const dbPatch: Record<string, unknown> = {};
  const keyMap: Record<keyof JobRecord, string> = {
    id: "id", name: "name", email: "email", phone: "phone", address: "address", city: "city",
    stage: "stage", value: "value", assignedTo: "assigned_to", roofType: "roof_type", source: "source",
    lastActivity: "last_activity", nextAction: "next_action", dueDate: "due_date", status: "status",
    assignedCrew: "assigned_crew", scheduleDate: "schedule_date", jobScope: "job_scope", jobNotes: "job_notes",
    completionNotes: "completion_notes", materialsUsed: "materials_used", submittedAt: "submitted_at",
  };
  (Object.keys(patch) as (keyof JobRecord)[]).forEach((key) => {
    const column = keyMap[key];
    if (column) dbPatch[column] = (fullPatch as Record<string, unknown>)[column];
  });
  const { error } = await supabase.from(jobsTable).update(dbPatch).eq("id", jobId);
  if (error) throw new Error(error.message);
}

export async function deleteJobRecord(jobId: string): Promise<void> {
  if (!hasSupabaseConfig()) {
    writeLocalJobs(readLocalJobs().filter((item) => item.id !== jobId));
    writeLocal(crewSyncPhotosKey, readLocal<JobPhoto[]>(crewSyncPhotosKey, []).filter((photo) => photo.jobId !== jobId));
    writeLocal(crewSyncNotesKey, readLocal<JobNote[]>(crewSyncNotesKey, []).filter((note) => note.jobId !== jobId));
    writeLocal(crewSyncChecklistKey, readLocal<JobChecklistItem[]>(crewSyncChecklistKey, []).filter((item) => item.jobId !== jobId));
    return;
  }
  // Child rows (photos, notes, checklist) are removed automatically via the
  // ON DELETE CASCADE foreign keys defined in supabase/crew-workflow.sql.
  const supabase = createClient();
  const { error } = await supabase.from(jobsTable).delete().eq("id", jobId);
  if (error) throw new Error(error.message);
}

/**
 * Build local JobPhoto records for optimistic UI so captured photos appear
 * instantly while the real save/sync happens in the background. These get
 * replaced by the canonical records on the next refresh.
 */
export function buildOptimisticPhotos(
  jobId: string,
  photoType: JobPhotoType,
  files: File[],
  dataUrls: string[],
  uploadedBy: string,
): JobPhoto[] {
  const now = Date.now();
  return files.map((file, index) => ({
    id: `local-${now}-${index}`,
    jobId,
    photoType,
    name: file.name,
    dataUrl: dataUrls[index],
    uploadedBy,
    createdAt: new Date(now + index).toISOString(),
  }));
}

export async function addJobPhotos(jobId: string, photos: { photoType: JobPhotoType; name: string; dataUrl: string; uploadedBy: string }[]): Promise<void> {
  if (photos.length === 0) return;
  if (!hasSupabaseConfig()) {
    const now = Date.now();
    const records: JobPhoto[] = photos.map((photo, index) => ({
      id: `${jobId}-${now}-${index}`,
      jobId,
      photoType: photo.photoType,
      name: photo.name,
      dataUrl: photo.dataUrl,
      uploadedBy: photo.uploadedBy,
      createdAt: new Date(now + index).toISOString(),
    }));
    writeLocal(crewSyncPhotosKey, [...readLocal<JobPhoto[]>(crewSyncPhotosKey, []), ...records]);
    return;
  }
  const supabase = createClient();
  // Store each image as a file in Supabase Storage and keep only its (small)
  // URL in the row, so reads stay tiny. If Storage isn't set up yet (bucket
  // missing / upload fails) we fall back to the base64 value so saving never
  // breaks — the row just stays heavy until migrated.
  const rows = await Promise.all(
    photos.map(async (photo) => ({
      job_id: jobId,
      photo_type: photo.photoType,
      name: photo.name,
      data_url: await uploadPhotoToStorage(supabase, jobId, photo.photoType, photo.dataUrl),
      uploaded_by: photo.uploadedBy,
    })),
  );
  const { error } = await supabase.from(jobPhotosTable).insert(rows);
  if (error) throw new Error(error.message);
}

type StorageClient = Pick<ReturnType<typeof createClient>, "storage">;

/**
 * Upload a base64 data URL to the job-photos Storage bucket and return its
 * public URL. Returns the original value unchanged if it isn't base64 (already
 * a URL) or if the upload fails for any reason (e.g. bucket not created yet).
 */
async function uploadPhotoToStorage(
  supabase: StorageClient,
  jobId: string,
  photoType: JobPhotoType,
  dataUrl: string,
): Promise<string> {
  const parsed = dataUrlToBytes(dataUrl);
  if (!parsed) return dataUrl;
  try {
    const ext = parsed.mime.split("/")[1]?.split("+")[0] || "jpg";
    const safeType = photoType.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const path = `${jobId}/${safeType}-${unique}.${ext}`;
    const { error } = await supabase.storage
      .from(jobPhotoBucket)
      .upload(path, parsed.bytes, { contentType: parsed.mime, upsert: false });
    if (error) return dataUrl;
    const { data } = supabase.storage.from(jobPhotoBucket).getPublicUrl(path);
    return data.publicUrl || dataUrl;
  } catch {
    return dataUrl;
  }
}

/** Decode a `data:<mime>;base64,<payload>` URL into raw bytes, or null if not base64. */
function dataUrlToBytes(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  try {
    const mime = match[1];
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { mime, bytes };
  } catch {
    return null;
  }
}

export async function addJobNote(jobId: string, author: string, body: string): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) return;
  if (!hasSupabaseConfig()) {
    const note: JobNote = { id: `${jobId}-${Date.now()}`, jobId, author, body: trimmed, createdAt: new Date().toISOString() };
    writeLocal(crewSyncNotesKey, [...readLocal<JobNote[]>(crewSyncNotesKey, []), note]);
    return;
  }
  const supabase = createClient();
  const { error } = await supabase.from(jobNotesTable).insert({ job_id: jobId, author, body: trimmed });
  if (error) throw new Error(error.message);
}

export async function addChecklistItem(jobId: string, label: string, position: number): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) return;
  if (!hasSupabaseConfig()) {
    const item: JobChecklistItem = { id: `${jobId}-${Date.now()}`, jobId, label: trimmed, done: false, position, createdAt: new Date().toISOString() };
    writeLocal(crewSyncChecklistKey, [...readLocal<JobChecklistItem[]>(crewSyncChecklistKey, []), item]);
    return;
  }
  const supabase = createClient();
  const { error } = await supabase.from(jobChecklistTable).insert({ job_id: jobId, label: trimmed, position });
  if (error) throw new Error(error.message);
}

export async function setChecklistItemDone(itemId: string, done: boolean): Promise<void> {
  if (!hasSupabaseConfig()) {
    writeLocal(crewSyncChecklistKey, readLocal<JobChecklistItem[]>(crewSyncChecklistKey, []).map((item) => (item.id === itemId ? { ...item, done } : item)));
    return;
  }
  const supabase = createClient();
  const { error } = await supabase.from(jobChecklistTable).update({ done }).eq("id", itemId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Realtime subscriptions + presence.
// ---------------------------------------------------------------------------

export type CrewPresenceState = {
  name: string;
  role: "Admin" | "Crew";
  action: "viewing" | "editing";
  jobId: string | null;
};

/**
 * Subscribe to realtime INSERT/UPDATE/DELETE on all crew tables. The callback
 * fires whenever any client changes the shared data. Returns an unsubscribe
 * function. In localStorage fallback mode it listens for same-browser events.
 */
export function subscribeToCrewData(onChange: () => void): () => void {
  if (!hasSupabaseConfig()) {
    if (typeof window === "undefined") return () => {};
    const handler = () => onChange();
    window.addEventListener(crewSyncUpdatedEvent, handler);
    window.addEventListener("crm-crew-workflow-updated", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(crewSyncUpdatedEvent, handler);
      window.removeEventListener("crm-crew-workflow-updated", handler);
      window.removeEventListener("storage", handler);
    };
  }

  const supabase = createClient();
  const channel = supabase.channel("crew-workflow-data");
  [jobsTable, jobPhotosTable, jobNotesTable, jobChecklistTable].forEach((table) => {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, () => onChange());
  });
  channel.subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Join a per-page presence channel so users can see who else is viewing or
 * editing a job (Google-Docs style). Returns helpers to update the local
 * presence state and to leave. Presence requires Supabase; without it the
 * callback is invoked once with an empty roster.
 */
export function joinCrewPresence(
  channelName: string,
  initialState: CrewPresenceState,
  onSync: (states: CrewPresenceState[]) => void,
): { update: (next: Partial<CrewPresenceState>) => void; leave: () => void } {
  if (!hasSupabaseConfig()) {
    onSync([]);
    return { update: () => {}, leave: () => {} };
  }

  const supabase = createClient();
  const presenceKey = `${initialState.role}-${initialState.name}-${Math.random().toString(36).slice(2, 8)}`;
  const channel: RealtimeChannel = supabase.channel(channelName, { config: { presence: { key: presenceKey } } });
  let currentState = initialState;

  channel.on("presence", { event: "sync" }, () => {
    const rawState = channel.presenceState<CrewPresenceState>();
    const states = Object.values(rawState).flat().map((entry) => ({
      name: entry.name,
      role: entry.role,
      action: entry.action,
      jobId: entry.jobId,
    }));
    onSync(states);
  });

  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      void channel.track(currentState);
    }
  });

  return {
    update: (next) => {
      currentState = { ...currentState, ...next };
      void channel.track(currentState);
    },
    leave: () => {
      void channel.untrack();
      supabase.removeChannel(channel);
    },
  };
}
