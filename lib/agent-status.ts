"use client";

import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";

export type AgentStatus = "online" | "offline" | "busy";

export interface AgentStatusRecord {
  user_id: string;
  status: AgentStatus;
  updated_at: string;
}

const STATUS_KEY = "xrp-agent-status";

/** Read cached local status (for instant UI before Supabase responds) */
export function readLocalAgentStatus(): AgentStatus {
  if (typeof window === "undefined") return "offline";
  return (localStorage.getItem(STATUS_KEY) as AgentStatus) || "offline";
}

/** Update agent status in Supabase and cache locally */
export async function setAgentStatus(userId: string, status: AgentStatus): Promise<void> {
  if (typeof window !== "undefined") localStorage.setItem(STATUS_KEY, status);

  if (!hasSupabaseConfig()) return;

  const supabase = createClient();
  await supabase.from("agent_status").upsert(
    { user_id: userId, status, updated_at: new Date().toISOString() },
    { onConflict: "user_id" }
  );
}

/** Load all agent statuses from Supabase */
export async function loadAllAgentStatuses(): Promise<AgentStatusRecord[]> {
  if (!hasSupabaseConfig()) return [];

  const supabase = createClient();
  const { data } = await supabase.from("agent_status").select("*");
  return (data as AgentStatusRecord[]) || [];
}

/** Subscribe to real-time agent status changes */
export function subscribeToAgentStatuses(
  callback: (statuses: AgentStatusRecord[]) => void
): () => void {
  if (!hasSupabaseConfig()) return () => undefined;

  const supabase = createClient();

  // Initial load
  void loadAllAgentStatuses().then(callback);

  // Real-time subscription
  const channel = supabase
    .channel("agent-status-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "agent_status" },
      () => {
        void loadAllAgentStatuses().then(callback);
      }
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
