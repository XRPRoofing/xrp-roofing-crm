"use client";

/**
 * Crew activity log — tracks every action crew members and admins take on jobs.
 *
 * Supabase table: crew_activity_log (id uuid PK, job_id text, job_name text,
 *   actor text, action text, details text, module text, created_at timestamptz)
 *
 * Falls back to localStorage when Supabase is not configured.
 */

import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { addCrmNotification } from "@/lib/crm-notifications";
import { broadcastCrmUpdate } from "@/lib/use-auto-refresh";

export type CrewActivity = {
  id: string;
  jobId: string;
  jobName: string;
  actor: string;
  action: string;
  details: string;
  module: string;
  createdAt: string;
};

const TABLE = "crew_activity_log";
const STORAGE_KEY = "xrp-crm-crew-activity";

// ---------------------------------------------------------------------------
// localStorage fallback
// ---------------------------------------------------------------------------

function readLocalActivities(): CrewActivity[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]") as CrewActivity[];
  } catch {
    return [];
  }
}

function writeLocalActivities(items: CrewActivity[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 500)));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Log a crew/admin action and simultaneously push a CRM notification so
 * office users see it in the notification bell in real time.
 */
export async function logCrewActivity(input: {
  jobId: string;
  jobName: string;
  actor: string;
  action: string;
  details: string;
  module: "Crew Portal" | "Crew Workflow" | "Jobs" | "Invoice" | "Proposal" | "SMS" | "Notes" | "Calendar" | "Calls" | "Emails" | "Customers" | "Estimates";
}): Promise<void> {
  const activity: CrewActivity = {
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    jobId: input.jobId,
    jobName: input.jobName,
    actor: input.actor,
    action: input.action,
    details: input.details,
    module: input.module,
    createdAt: new Date().toISOString(),
  };

  // Push a CRM notification so office/admin users see it in the bell
  addCrmNotification({
    title: `${input.actor}: ${input.action}`,
    message: `${input.details} — ${input.jobName}`,
    actor: input.actor,
    module: input.module,
  });

  // Notify other tabs so activity history refreshes without manual reload
  broadcastCrmUpdate();

  // Persist the activity to Supabase or localStorage
  if (!hasSupabaseConfig()) {
    writeLocalActivities([activity, ...readLocalActivities()]);
    return;
  }

  try {
    const supabase = createClient();
    await supabase.from(TABLE).insert({
      id: activity.id,
      job_id: activity.jobId,
      job_name: activity.jobName,
      actor: activity.actor,
      action: activity.action,
      details: activity.details,
      module: activity.module,
      created_at: activity.createdAt,
    });
  } catch {
    // Fall back to localStorage if Supabase insert fails
    writeLocalActivities([activity, ...readLocalActivities()]);
  }
}

/** Load activity log for a specific job, newest first. */
export async function loadJobActivities(jobId: string): Promise<CrewActivity[]> {
  if (!hasSupabaseConfig()) {
    return readLocalActivities().filter((a) => a.jobId === jobId);
  }

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("id, job_id, job_name, actor, action, details, module, created_at")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error || !data?.length) {
      return readLocalActivities().filter((a) => a.jobId === jobId);
    }
    return (data as { id: string; job_id: string; job_name: string; actor: string; action: string; details: string; module: string; created_at: string }[]).map((row) => ({
      id: row.id,
      jobId: row.job_id,
      jobName: row.job_name,
      actor: row.actor,
      action: row.action,
      details: row.details,
      module: row.module,
      createdAt: row.created_at,
    }));
  } catch {
    return readLocalActivities().filter((a) => a.jobId === jobId);
  }
}

/** Load all recent activity across all jobs, newest first. */
export async function loadRecentActivities(limit = 100): Promise<CrewActivity[]> {
  if (!hasSupabaseConfig()) {
    return readLocalActivities().slice(0, limit);
  }

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("id, job_id, job_name, actor, action, details, module, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data?.length) {
      return readLocalActivities().slice(0, limit);
    }
    return (data as { id: string; job_id: string; job_name: string; actor: string; action: string; details: string; module: string; created_at: string }[]).map((row) => ({
      id: row.id,
      jobId: row.job_id,
      jobName: row.job_name,
      actor: row.actor,
      action: row.action,
      details: row.details,
      module: row.module,
      createdAt: row.created_at,
    }));
  } catch {
    return readLocalActivities().slice(0, limit);
  }
}

/** Subscribe to real-time activity log changes from Supabase. */
export function subscribeToCrewActivities(onUpdate: () => void): () => void {
  if (!hasSupabaseConfig()) return () => {};

  try {
    const supabase = createClient();
    const channel = supabase
      .channel("crew-activity-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: TABLE }, () => {
        onUpdate();
      })
      .subscribe();

    return () => {
      try { supabase.removeChannel(channel); } catch { /* ignore */ }
    };
  } catch {
    return () => {};
  }
}
