import { createClient } from "@supabase/supabase-js";

/** Result from querying agent availability. `configured` indicates whether the
 *  agent-status system is actively set up (Supabase + table exist). When
 *  `configured` is false the caller should skip the queue and dial directly. */
export type AgentStatusResult = { configured: boolean; agents: string[] };

/** Only count an admin as "online" if their presence heartbeat is newer than
 *  this. The browser refreshes presence every ~60s, so a crashed/closed tab
 *  drops out of the ring group within a couple of minutes instead of lingering
 *  as a stale "online" row that would ring a dead browser. */
const PRESENCE_FRESH_MS = 3 * 60 * 1000;

export async function getOnlineAgentIdentities(): Promise<AgentStatusResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { configured: false, agents: [] };
  const supabase = createClient(url, key);
  const freshSince = new Date(Date.now() - PRESENCE_FRESH_MS).toISOString();
  const { data, error } = await supabase
    .from("agent_status")
    .select("user_id")
    .eq("status", "online")
    .gte("updated_at", freshSince);
  // If the table doesn't exist or the query fails, treat as not configured
  if (error) return { configured: false, agents: [] };
  return {
    configured: true,
    agents: (data || []).map((row: { user_id: string }) => `agent-${row.user_id}`),
  };
}

/**
 * Return the Voice identities (`agent-<user_id>`) for every admin-access user.
 * Used so an inbound call rings ALL logged-in admins at once — the browser of
 * each admin registers under its own `agent-<id>` identity (see CrmShell), and
 * we dial every one of them. Offline admins simply produce a dead client leg
 * that no-answers harmlessly. Crew users are excluded (they never take calls).
 */
export async function getAdminAgentIdentities(): Promise<string[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  try {
    const supabase = createClient(url, key);
    const { data, error } = await supabase.from("profiles").select("id, role");
    if (error || !data) return [];
    return data
      .filter((row: { id: string; role: string | null }) => (row.role || "admin") !== "crew")
      .map((row: { id: string }) => `agent-${row.id}`)
      .slice(0, 25);
  } catch {
    return [];
  }
}
