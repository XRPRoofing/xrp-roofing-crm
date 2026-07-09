"use client";

// Client data layer for the Automation Center.
//
// Talks to /api/automations/* (shared Supabase storage). Before the SQL
// migration is applied (or if Supabase is unconfigured), it transparently falls
// back to the existing localStorage engine so the page keeps working and nothing
// is lost. Existing localStorage rules are migrated into shared storage once.

import {
  readWorkflowRules,
  saveWorkflowRules,
  seedDefaultWorkflows,
  type WorkflowRule,
} from "@/lib/workflow-engine";
import type { AutomationRule, AutomationRun } from "@/lib/automation/types";

const MIGRATION_FLAG = "xrp-crm-automation-migrated-v1";

export type LoadResult = { rules: AutomationRule[]; mode: "server" | "local" };

function nowIso() {
  return new Date().toISOString();
}

/** Upgrade a legacy localStorage WorkflowRule into the richer AutomationRule shape. */
function toAutomationRule(r: WorkflowRule & Partial<AutomationRule>): AutomationRule {
  return {
    id: r.id,
    name: r.name,
    description: r.description || "",
    trigger: r.trigger,
    conditions: r.conditions || [],
    actions: r.actions || [],
    enabled: r.enabled ?? true,
    status: r.status ?? "active",
    createdAt: r.createdAt || nowIso(),
    updatedAt: r.updatedAt || nowIso(),
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
    lastTriggered: r.lastTriggered,
    lastRunAt: r.lastRunAt,
    lastSuccessAt: r.lastSuccessAt,
    lastFailedAt: r.lastFailedAt,
    lastError: r.lastError,
    triggerCount: r.triggerCount ?? 0,
    successCount: r.successCount ?? 0,
    failureCount: r.failureCount ?? 0,
  };
}

function localRules(): AutomationRule[] {
  return readWorkflowRules().map((r) => toAutomationRule(r as WorkflowRule & Partial<AutomationRule>));
}

function writeLocal(rules: AutomationRule[]) {
  saveWorkflowRules(rules as unknown as WorkflowRule[]);
}

/** Load rules, preferring shared storage; fall back to localStorage otherwise. */
export async function loadRules(): Promise<LoadResult> {
  seedDefaultWorkflows();
  try {
    const res = await fetch("/api/automations/rules", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { configured: boolean; applied: boolean; rules: AutomationRule[] };
      if (data.configured && data.applied) {
        await migrateLocalRulesOnce();
        const refreshed = await fetch("/api/automations/rules", { cache: "no-store" });
        const fresh = (await refreshed.json()) as { rules: AutomationRule[] };
        return { rules: fresh.rules || [], mode: "server" };
      }
    }
  } catch {
    // network/unconfigured — fall through to local
  }
  return { rules: localRules(), mode: "local" };
}

/** One-time push of existing localStorage rules into shared storage (as paused). */
async function migrateLocalRulesOnce() {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(MIGRATION_FLAG)) return;
  const rules = localRules();
  try {
    await fetch("/api/automations/rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rules }),
    });
    localStorage.setItem(MIGRATION_FLAG, nowIso());
  } catch {
    // leave the flag unset so migration retries next load
  }
}

export async function createRule(input: Partial<AutomationRule>, mode: LoadResult["mode"]): Promise<void> {
  if (mode === "server") {
    await fetch("/api/automations/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    return;
  }
  const rules = localRules();
  const rule = toAutomationRule({ ...(input as WorkflowRule), id: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
  writeLocal([rule, ...rules]);
}

export async function patchRule(id: string, patch: Partial<AutomationRule>, mode: LoadResult["mode"]): Promise<void> {
  if (mode === "server") {
    await fetch("/api/automations/rules", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...patch }) });
    return;
  }
  writeLocal(localRules().map((r) => (r.id === id ? { ...r, ...patch, updatedAt: nowIso() } : r)));
}

export async function removeRule(id: string, mode: LoadResult["mode"]): Promise<void> {
  if (mode === "server") {
    await fetch(`/api/automations/rules?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    return;
  }
  writeLocal(localRules().filter((r) => r.id !== id));
}

export async function duplicateRule(rule: AutomationRule, mode: LoadResult["mode"]): Promise<void> {
  const copy: Partial<AutomationRule> = {
    name: `${rule.name} (Copy)`,
    description: rule.description,
    trigger: rule.trigger,
    conditions: rule.conditions,
    actions: rule.actions,
    enabled: false,
    status: "paused",
  };
  await createRule(copy, mode);
}

export type TestResult = { run?: AutomationRun; error?: string };

export async function testRule(id: string): Promise<TestResult> {
  try {
    const res = await fetch("/api/automations/rules/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (!res.ok) return { error: (await res.json().catch(() => ({}))).error || `HTTP ${res.status}` };
    return (await res.json()) as TestResult;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Test failed" };
  }
}

export async function loadRuns(): Promise<AutomationRun[]> {
  try {
    const res = await fetch("/api/automations/runs?limit=200", { cache: "no-store" });
    if (!res.ok) return [];
    return ((await res.json()) as { runs: AutomationRun[] }).runs || [];
  } catch {
    return [];
  }
}
