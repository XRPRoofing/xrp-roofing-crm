"use client";

import { hasSupabaseConfig } from "@/lib/supabase/client";
import { MANUAL_FOLDER_SOURCE, deleteJobRecord, upsertJobRecord, type JobRecord } from "@/lib/crew-sync";

/**
 * Manually-created Files folders.
 *
 * Auto folders are derived from crew jobs + their photos. Manual folders let
 * the office create an empty folder up front and then take/upload photos into
 * it. Metadata is stored server-side (shared across devices via the
 * `app_integrations` table) with a localStorage fallback for local/dev mode.
 * The photos themselves reuse the normal `job_photos` pipeline keyed by the
 * folder id, so they sync and show up exactly like crew photos.
 */
export type ManualFolder = {
  id: string;
  name: string;
  address: string;
  workType: string;
  customerName: string;
  createdAt: string;
};

const localKey = "xrp-crm-manual-folders";
export const manualFoldersUpdatedEvent = "crm-manual-folders-updated";

export function newManualFolderId() {
  return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// A manual folder is backed by a hidden job row so its photos satisfy the
// job_photos -> jobs foreign key and flow through the normal photo pipeline.
// The row is tagged MANUAL_FOLDER_SOURCE so loadCrewDataset hides it from every
// job board. Idempotent: also heals folders created before this backing existed.
export async function ensureManualFolderJob(folder: ManualFolder): Promise<void> {
  const backingJob: JobRecord = {
    id: folder.id,
    name: folder.customerName || folder.name,
    email: "",
    phone: "",
    address: folder.address || folder.name,
    city: "",
    stage: "new_lead",
    value: 0,
    assignedTo: "",
    roofType: folder.workType || "General",
    source: MANUAL_FOLDER_SOURCE,
    lastActivity: "Manual folder",
    nextAction: "",
    dueDate: "",
    status: "Assigned",
    assignedCrew: [],
    scheduleDate: "",
    jobScope: folder.workType || "General",
    jobNotes: "",
    completionNotes: "",
    materialsUsed: "",
  };
  await upsertJobRecord(backingJob);
}

function readLocal(): ManualFolder[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(localKey) || "[]") as ManualFolder[];
  } catch {
    return [];
  }
}

function writeLocal(folders: ManualFolder[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(localKey, JSON.stringify(folders));
  window.dispatchEvent(new Event(manualFoldersUpdatedEvent));
}

export async function loadManualFolders(): Promise<ManualFolder[]> {
  if (!hasSupabaseConfig()) return readLocal();
  try {
    const response = await fetch("/api/manual-folders", { cache: "no-store" });
    if (!response.ok) return readLocal();
    const data = (await response.json()) as { folders?: ManualFolder[] };
    return data.folders || [];
  } catch {
    return readLocal();
  }
}

export async function createManualFolder(input: {
  name: string;
  address?: string;
  workType?: string;
  customerName?: string;
}): Promise<ManualFolder> {
  const name = input.name.trim();
  const folder: ManualFolder = {
    id: newManualFolderId(),
    name,
    address: (input.address || name).trim(),
    workType: (input.workType || "General").trim(),
    customerName: (input.customerName || "").trim(),
    createdAt: new Date().toISOString(),
  };

  // Create the backing job row first so photos can be saved into the folder.
  await ensureManualFolderJob(folder);

  if (!hasSupabaseConfig()) {
    writeLocal([folder, ...readLocal()]);
    return folder;
  }

  try {
    const response = await fetch("/api/manual-folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(folder),
    });
    if (response.ok) {
      const data = (await response.json()) as { folder?: ManualFolder };
      window.dispatchEvent(new Event(manualFoldersUpdatedEvent));
      return data.folder || folder;
    }
  } catch {
    /* fall through to local fallback */
  }
  writeLocal([folder, ...readLocal()]);
  return folder;
}

export async function deleteManualFolder(id: string): Promise<void> {
  // Remove the backing job (cascades its photos) alongside the folder metadata.
  await deleteJobRecord(id).catch(() => {});
  if (!hasSupabaseConfig()) {
    writeLocal(readLocal().filter((folder) => folder.id !== id));
    return;
  }
  try {
    await fetch(`/api/manual-folders?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    window.dispatchEvent(new Event(manualFoldersUpdatedEvent));
  } catch {
    writeLocal(readLocal().filter((folder) => folder.id !== id));
  }
}
