// Server-side persistence for automation rules + run history (Supabase).
// Degrades gracefully (empty results / no-ops) when Supabase isn't configured,
// so the app never crashes before the automation-engine.sql migration is applied.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import type { AutomationRule, AutomationRun } from "@/lib/automation/types";

const RULES_TABLE = "automation_rules";
const RUNS_TABLE = "automation_runs";

export function getAutomationClient(): SupabaseClient | null {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function listRules(): Promise<AutomationRule[]> {
  const supabase = getAutomationClient();
  if (!supabase) return [];
  const { data, error } = await supabase.from(RULES_TABLE).select("payload").order("updated_at", { ascending: false });
  if (error || !data) return [];
  return data.map((row) => row.payload as AutomationRule).filter(Boolean);
}

/**
 * Reports whether shared storage is usable yet:
 *  - configured: Supabase env vars are present
 *  - applied: the automation_rules table exists (migration has been run)
 * Lets the client fall back to localStorage before the SQL migration is applied.
 */
export async function getRulesStatus(): Promise<{ configured: boolean; applied: boolean; rules: AutomationRule[] }> {
  const supabase = getAutomationClient();
  if (!supabase) return { configured: false, applied: false, rules: [] };
  const { data, error } = await supabase.from(RULES_TABLE).select("payload").order("updated_at", { ascending: false });
  if (error) {
    // 42P01 = undefined_table → migration not applied yet.
    const applied = error.code !== "42P01" && !/does not exist/i.test(error.message || "");
    return { configured: true, applied, rules: [] };
  }
  return { configured: true, applied: true, rules: (data || []).map((row) => row.payload as AutomationRule).filter(Boolean) };
}

export async function getRule(id: string): Promise<AutomationRule | null> {
  const supabase = getAutomationClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from(RULES_TABLE).select("payload").eq("id", id).single();
  if (error || !data) return null;
  return (data.payload as AutomationRule) ?? null;
}

export async function upsertRule(rule: AutomationRule): Promise<{ ok: boolean; reason?: string }> {
  const supabase = getAutomationClient();
  if (!supabase) return { ok: false, reason: "Supabase is not configured" };
  const { error } = await supabase.from(RULES_TABLE).upsert({ id: rule.id, payload: rule, updated_at: rule.updatedAt });
  return error ? { ok: false, reason: error.message } : { ok: true };
}

export async function deleteRule(id: string): Promise<{ ok: boolean; reason?: string }> {
  const supabase = getAutomationClient();
  if (!supabase) return { ok: false, reason: "Supabase is not configured" };
  const { error } = await supabase.from(RULES_TABLE).delete().eq("id", id);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

export async function appendRun(run: AutomationRun): Promise<void> {
  const supabase = getAutomationClient();
  if (!supabase) return;
  try {
    await supabase.from(RUNS_TABLE).insert({ id: run.id, rule_id: run.ruleId, payload: run, created_at: run.executedAt });
  } catch {
    // best-effort logging
  }
}

export async function listRuns(limit = 200): Promise<AutomationRun[]> {
  const supabase = getAutomationClient();
  if (!supabase) return [];
  const { data, error } = await supabase.from(RUNS_TABLE).select("payload").order("created_at", { ascending: false }).limit(limit);
  if (error || !data) return [];
  return data.map((row) => row.payload as AutomationRun).filter(Boolean);
}
