import { createClient } from "@supabase/supabase-js";
import { normalizeSteps, type RoutingStep } from "@/lib/twilio/routing-types";

// Read the configured failover steps for one IVR option (server-side, via the
// service role). Returns [] when the table/config is missing or empty — the
// call flow then falls back to its current simultaneous-ring behavior, so a
// missing config never breaks inbound calls.
export async function getCallRoutingForOption(option: string): Promise<RoutingStep[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  try {
    const supabase = createClient(url, key);
    const { data, error } = await supabase
      .from("call_routing")
      .select("enabled, steps")
      .eq("option", option)
      .maybeSingle();
    if (error || !data) return [];
    if (data.enabled === false) return [];
    return normalizeSteps(data.steps);
  } catch {
    return [];
  }
}
