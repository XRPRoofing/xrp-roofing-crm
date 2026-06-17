import { createClient } from "@supabase/supabase-js";

/** Query Supabase for agents with status 'online' and return their ring identities */
export async function getOnlineAgentIdentities(): Promise<string[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return [];

  const supabase = createClient(url, key);
  const { data } = await supabase
    .from("agent_status")
    .select("user_id")
    .eq("status", "online");

  if (!data || data.length === 0) return [];

  return data.map((row: { user_id: string }) => `agent-${row.user_id}`);
}
