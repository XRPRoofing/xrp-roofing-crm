"use client";

/**
 * Supabase-backed task sync for the Office Task Board.
 * Falls back to localStorage when Supabase is not available.
 * Table: office_tasks  (id text PK, payload jsonb, updated_at timestamptz)
 */

import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { officeTaskStatuses, readOfficeTasks, saveOfficeTasks, type OfficeTask } from "@/lib/office-tasks";

const TABLE = "office_tasks";

export async function loadTasksFromSupabase(): Promise<OfficeTask[]> {
  if (!hasSupabaseConfig()) return readOfficeTasks();
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("id, payload, updated_at")
      .order("updated_at", { ascending: false });
    if (error || !data?.length) return readOfficeTasks();
    const tasks = (data as { id: string; payload: OfficeTask }[]).map((row) => ({ ...row.payload, id: row.id }));

    // Dedup helper: pick the task that is more advanced in the workflow.
    function isBetter(candidate: OfficeTask, incumbent: OfficeTask): boolean {
      const cIdx = officeTaskStatuses.indexOf(candidate.status);
      const iIdx = officeTaskStatuses.indexOf(incumbent.status);
      return cIdx > iIdx || (cIdx === iIdx && candidate.updatedAt > incumbent.updatedAt);
    }

    // Pass 1: dedup by jobId
    const bestPerJob = new Map<string, OfficeTask>();
    for (const t of tasks) {
      if (!t.jobId) continue;
      const existing = bestPerJob.get(t.jobId);
      if (!existing) { bestPerJob.set(t.jobId, t); continue; }
      if (isBetter(t, existing)) bestPerJob.set(t.jobId, t);
    }
    const duplicateIds: string[] = [];
    const afterJobDedup = tasks.filter((t) => {
      if (!t.jobId) return true;
      const best = bestPerJob.get(t.jobId);
      if (best && best.id !== t.id) { duplicateIds.push(t.id); return false; }
      return true;
    });

    // Pass 2: dedup by customerName + jobAddress (catches cross-jobId duplicates)
    const bestPerCustomer = new Map<string, OfficeTask>();
    for (const t of afterJobDedup) {
      const key = t.customerName && t.jobAddress ? `${t.customerName}|||${t.jobAddress}` : "";
      if (!key) continue;
      const existing = bestPerCustomer.get(key);
      if (!existing) { bestPerCustomer.set(key, t); continue; }
      if (isBetter(t, existing)) bestPerCustomer.set(key, t);
    }
    const deduped = afterJobDedup.filter((t) => {
      const key = t.customerName && t.jobAddress ? `${t.customerName}|||${t.jobAddress}` : "";
      if (!key) return true;
      const best = bestPerCustomer.get(key);
      if (best && best.id !== t.id) { duplicateIds.push(t.id); return false; }
      return true;
    });

    // Fire-and-forget cleanup of duplicate rows from Supabase
    if (duplicateIds.length > 0) {
      void supabase.from(TABLE).delete().in("id", duplicateIds).then(() => {});
    }

    // Also keep localStorage in sync for offline fallback
    saveOfficeTasks(deduped);
    return deduped;
  } catch {
    return readOfficeTasks();
  }
}

export async function upsertTaskToSupabase(task: OfficeTask): Promise<void> {
  if (!hasSupabaseConfig()) return;
  try {
    const supabase = createClient();
    await supabase.from(TABLE).upsert({ id: task.id, payload: task, updated_at: new Date().toISOString() });
  } catch {
    // silently fall back to localStorage-only
  }
}

export async function saveAllTasksToSupabase(tasks: OfficeTask[]): Promise<void> {
  if (!hasSupabaseConfig()) return;
  try {
    const supabase = createClient();
    const rows = tasks.map((t) => ({ id: t.id, payload: t, updated_at: t.updatedAt || new Date().toISOString() }));
    await supabase.from(TABLE).upsert(rows);
  } catch {
    // silently ignore
  }
}

export async function deleteTaskFromSupabase(taskId: string): Promise<void> {
  if (!hasSupabaseConfig()) return;
  try {
    const supabase = createClient();
    await supabase.from(TABLE).delete().eq("id", taskId);
  } catch {
    // silently fall back to localStorage-only
  }
}

const taskListeners = new Set<(tasks: OfficeTask[]) => void>();
let taskChannel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;

/**
 * Subscribe to realtime INSERT/UPDATE/DELETE on `office_tasks`. Uses a shared
 * channel so multiple callers don't create duplicate Supabase connections.
 */
export function subscribeToTaskUpdates(onUpdate: (tasks: OfficeTask[]) => void): () => void {
  if (!hasSupabaseConfig()) return () => {};

  taskListeners.add(onUpdate);

  if (!taskChannel) {
    try {
      const supabase = createClient();
      taskChannel = supabase
        .channel("office-tasks-realtime-shared")
        .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, async () => {
          const tasks = await loadTasksFromSupabase();
          taskListeners.forEach((cb) => cb(tasks));
        })
        .subscribe();
    } catch {
      taskChannel = null;
      return () => {};
    }
  }

  return () => {
    taskListeners.delete(onUpdate);
    if (taskListeners.size === 0 && taskChannel) {
      try { createClient().removeChannel(taskChannel); } catch { /* ignore */ }
      taskChannel = null;
    }
  };
}
