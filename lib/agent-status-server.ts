import { createClient } from "@supabase/supabase-js";

/** Result from querying agent availability. `configured` indicates whether the
 *  agent-status system is actively set up (Supabase + table exist). When
 *  `configured` is false the caller should skip the queue and dial directly. */
export type AgentStatusResult = { configured: boolean; agents: string[] };

export async function getOnlineAgentIdentities(): Promise<AgentStatusResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { configured: false, agents: [] };
  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from("agent_status")
    .select("user_id")
    .eq("status", "online");
  // If the table doesn't exist or the query fails, treat as not configured
  if (error) return { configured: false, agents: [] };
  return {
    configured: true,
    agents: (data || []).map((row: { user_id: string }) => `agent-${row.user_id}`),
  };
}
