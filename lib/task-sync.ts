"use client";

/**
 * Supabase-backed task sync for the Office Task Board.
 * Falls back to localStorage when Supabase is not available.
 * Table: office_tasks  (id text PK, payload jsonb, updated_at timestamptz)
 */

import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { readOfficeTasks, saveOfficeTasks, type OfficeTask } from "@/lib/office-tasks";

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
    // Also keep localStorage in sync for offline fallback
    saveOfficeTasks(tasks);
    return tasks;
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

export function subscribeToTaskUpdates(onUpdate: (tasks: OfficeTask[]) => void): () => void {
  if (!hasSupabaseConfig()) return () => {};
  try {
    const supabase = createClient();
    const channel = supabase
      .channel("office-tasks-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, async () => {
        const tasks = await loadTasksFromSupabase();
        onUpdate(tasks);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  } catch {
    return () => {};
  }
}
