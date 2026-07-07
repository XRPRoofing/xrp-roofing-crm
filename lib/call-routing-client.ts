"use client";

import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { IVR_OPTIONS, normalizeSteps, type CallRoutingOption, type RoutingStep } from "@/lib/twilio/routing-types";

// Load routing config for every IVR option, filling in defaults for any option
// that has no saved row yet (so the Settings UI always shows all four options).
export async function loadCallRouting(): Promise<CallRoutingOption[]> {
  const base: CallRoutingOption[] = IVR_OPTIONS.map((o) => ({ option: o.option, label: o.label, enabled: true, steps: [] }));
  if (!hasSupabaseConfig()) return base;

  try {
    const supabase = createClient();
    const { data, error } = await supabase.from("call_routing").select("option, label, enabled, steps");
    if (error || !data) return base;
    const byOption = new Map<string, { label?: string | null; enabled?: boolean | null; steps?: unknown }>();
    for (const row of data) byOption.set(String(row.option), row);
    return base.map((opt) => {
      const row = byOption.get(opt.option);
      if (!row) return opt;
      return {
        option: opt.option,
        label: (typeof row.label === "string" && row.label) || opt.label,
        enabled: row.enabled !== false,
        steps: normalizeSteps(row.steps),
      };
    });
  } catch {
    return base;
  }
}

export async function saveCallRoutingOption(option: string, label: string, enabled: boolean, steps: RoutingStep[]): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("call_routing")
    .upsert({ option, label, enabled, steps, updated_at: new Date().toISOString() }, { onConflict: "option" });
  if (error) throw new Error(error.message);
}
