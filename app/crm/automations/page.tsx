"use client";

import { useEffect, useMemo, useState } from "react";
import { azDateTime } from "@/lib/arizona-time";
import {
  Bell,
  Clock,
  Copy,
  GitBranch,
  Pause,
  Play,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  AUTOMATION_LOG_KEY,
  AUTOMATION_META,
  DEFAULT_AUTOMATION_SETTINGS,
  TIMING_LABELS,
  readAutomationSettings,
  updateAutomation,
  type AutomationId,
  type AutomationSettings,
} from "@/lib/automation-settings";
import {
  ACTION_TYPE_META,
  CONDITION_FIELD_META,
  TRIGGER_CATEGORIES,
  TRIGGER_META,
  WORKFLOW_TEMPLATES,
  type WorkflowAction,
  type WorkflowActionType,
  type WorkflowCondition,
  type WorkflowConditionField,
  type WorkflowConditionOp,
  type WorkflowTrigger,
} from "@/lib/workflow-engine";
import {
  createRule,
  duplicateRule,
  loadRules,
  loadRuns,
  patchRule,
  removeRule,
  testRule,
  type LoadResult,
} from "@/lib/automation/client";
import type { AutomationRule, AutomationRun } from "@/lib/automation/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!enabled)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? "bg-blue-600" : "bg-gray-300"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
}

function fmt(iso?: string) {
  if (!iso) return "—";
  try { return azDateTime(new Date(iso), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return iso; }
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function AutomationsPage() {
  const [activeTab, setActiveTab] = useState<"workflows" | "notifications">("workflows");
  const [search, setSearch] = useState("");

  // Notification state
  const [settings, setSettings] = useState<AutomationSettings>(DEFAULT_AUTOMATION_SETTINGS);

  // Workflow state
  const [workflowRules, setWorkflowRules] = useState<AutomationRule[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<AutomationRun[]>([]);
  const [storageMode, setStorageMode] = useState<LoadResult["mode"]>("local");
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ruleId: string; text: string; ok: boolean } | null>(null);

  // Builder form
  const [builderName, setBuilderName] = useState("");
  const [builderDescription, setBuilderDescription] = useState("");
  const [builderTrigger, setBuilderTrigger] = useState<WorkflowTrigger>("job_created");
  const [builderConditions, setBuilderConditions] = useState<WorkflowCondition[]>([{ field: "always", operator: "exists", value: "" }]);
  const [builderActions, setBuilderActions] = useState<WorkflowAction[]>([{ type: "log_activity", params: { message: "" } }]);

  async function refreshRules() {
    const result = await loadRules();
    setWorkflowRules(result.rules);
    setStorageMode(result.mode);
  }

  async function refreshRuns() {
    setWorkflowRuns(await loadRuns());
  }

  useEffect(() => {
    const loadNotifications = () => setSettings(readAutomationSettings());
    loadNotifications();
    refreshRules();
    refreshRuns();
    window.addEventListener("crm-automation-settings-updated", loadNotifications);
    window.addEventListener(AUTOMATION_LOG_KEY, loadNotifications);
    return () => {
      window.removeEventListener("crm-automation-settings-updated", loadNotifications);
      window.removeEventListener(AUTOMATION_LOG_KEY, loadNotifications);
    };
  }, []);

  const enabledCount = useMemo(() => (Object.keys(settings) as AutomationId[]).filter((id) => settings[id].enabled).length, [settings]);
  const enabledWorkflows = workflowRules.filter((r) => r.enabled && r.status !== "paused").length;

  // Filter rules by search
  const filteredRules = useMemo(() => {
    if (!search.trim()) return workflowRules;
    const q = search.toLowerCase();
    return workflowRules.filter((r) =>
      r.name.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      TRIGGER_META[r.trigger]?.label.toLowerCase().includes(q) ||
      TRIGGER_META[r.trigger]?.category.toLowerCase().includes(q)
    );
  }, [workflowRules, search]);

  // ── Builder functions ──────────────────────────────────────────────────────

  function openBuilder(rule?: AutomationRule) {
    if (rule) {
      setEditingRule(rule);
      setBuilderName(rule.name);
      setBuilderDescription(rule.description);
      setBuilderTrigger(rule.trigger);
      setBuilderConditions([...rule.conditions]);
      setBuilderActions([...rule.actions]);
    } else {
      setEditingRule(null);
      setBuilderName("");
      setBuilderDescription("");
      setBuilderTrigger("job_created");
      setBuilderConditions([{ field: "always", operator: "exists", value: "" }]);
      setBuilderActions([{ type: "log_activity", params: { message: "" } }]);
    }
    setShowBuilder(true);
  }

  async function saveRule() {
    if (!builderName.trim()) return;
    if (editingRule) {
      await patchRule(editingRule.id, { name: builderName, description: builderDescription, trigger: builderTrigger, conditions: builderConditions, actions: builderActions }, storageMode);
    } else {
      await createRule({ name: builderName, description: builderDescription, trigger: builderTrigger, conditions: builderConditions, actions: builderActions, enabled: true, status: "active" }, storageMode);
    }
    await refreshRules();
    setShowBuilder(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this automation rule?")) return;
    await removeRule(id, storageMode);
    await refreshRules();
  }

  async function handleToggle(rule: AutomationRule, enabled: boolean) {
    await patchRule(rule.id, { enabled }, storageMode);
    await refreshRules();
  }

  async function handlePauseResume(rule: AutomationRule) {
    await patchRule(rule.id, { status: rule.status === "paused" ? "active" : "paused" }, storageMode);
    await refreshRules();
  }

  async function handleDuplicate(rule: AutomationRule) {
    await duplicateRule(rule, storageMode);
    await refreshRules();
  }

  async function handleRunNow(rule: AutomationRule) {
    if (storageMode !== "server") {
      setTestResult({ ruleId: rule.id, text: "Run Now needs shared storage — apply supabase/automation-engine.sql first.", ok: false });
      return;
    }
    setBusyRuleId(rule.id);
    setTestResult(null);
    const res = await testRule(rule.id);
    setBusyRuleId(null);
    if (res.error) {
      setTestResult({ ruleId: rule.id, text: res.error, ok: false });
    } else if (res.run) {
      const ok = res.run.status !== "failed";
      setTestResult({ ruleId: rule.id, text: res.run.status === "skipped" ? "Conditions not met — nothing ran." : res.run.actionsExecuted.join(", ") || "Ran with no actions.", ok });
    }
    await refreshRules();
    await refreshRuns();
  }

  async function addFromTemplate(idx: number) {
    const t = WORKFLOW_TEMPLATES[idx];
    if (!t) return;
    await createRule({ ...t, status: "active" }, storageMode);
    await refreshRules();
  }

  // ── Notification helpers ───────────────────────────────────────────────────

  function toggleNotification(id: AutomationId, enabled: boolean) {
    const next = updateAutomation(id, { enabled });
    setSettings(next);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      {/* Header */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#072C6B] via-[#0A3D91] to-[#2B6BC4] p-5 text-white shadow-xl sm:p-7">
        <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-orange-400/15 blur-3xl" />
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-orange-300">Settings</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Automation Center</h1>
            <p className="mt-2 max-w-xl text-xs leading-5 text-blue-200">
              Control how your CRM works. Create rules, automate workflows, and manage notifications — no coding needed.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white ring-1 ring-white/20">
              <Zap className="h-3 w-3 text-orange-300" /> {enabledWorkflows} rules &middot; {enabledCount} notifications
            </span>
            <button type="button" onClick={() => setShowLog(!showLog)} className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white ring-1 ring-white/20 hover:bg-white/20">
              <Clock className="h-3 w-3" /> Log
            </button>
          </div>
        </div>
      </section>

      {/* Tabs + Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
          <button type="button" onClick={() => setActiveTab("workflows")} className={`flex items-center gap-1.5 rounded-md px-4 py-2 text-xs font-bold transition ${activeTab === "workflows" ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            <GitBranch className="h-3.5 w-3.5" /> Workflow Rules
          </button>
          <button type="button" onClick={() => setActiveTab("notifications")} className={`flex items-center gap-1.5 rounded-md px-4 py-2 text-xs font-bold transition ${activeTab === "notifications" ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            <Bell className="h-3.5 w-3.5" /> Notifications
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search automations..." className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-xs font-semibold outline-none focus:border-blue-400 sm:w-64" />
        </div>
      </div>

      {/* Local-only notice (shared storage not yet active) */}
      {activeTab === "workflows" && storageMode === "local" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-[11px] font-semibold text-amber-800">
          Rules are saved on this device only. To share automations across all admins and run them from live events, apply <span className="font-mono">supabase/automation-engine.sql</span> once in Supabase.
        </div>
      )}

      {/* Activity Log */}
      {showLog && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-800">Activity Log</h2>
            <button type="button" onClick={() => setShowLog(false)} className="rounded p-1 hover:bg-gray-100"><X className="h-4 w-4 text-gray-400" /></button>
          </div>
          {workflowRuns.length === 0 ? (
            <p className="py-6 text-center text-xs font-semibold text-gray-400">No workflow activity yet.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-gray-100 text-left font-bold uppercase tracking-wider text-gray-400">
                    <th className="pb-2 pr-3">Rule</th>
                    <th className="pb-2 pr-3">Trigger</th>
                    <th className="pb-2 pr-3">Status</th>
                    <th className="pb-2 pr-3">Actions / Error</th>
                    <th className="pb-2">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {workflowRuns.slice(0, 50).map((e) => (
                    <tr key={e.id}>
                      <td className="py-1.5 pr-3 font-bold text-gray-700">{e.ruleName}</td>
                      <td className="py-1.5 pr-3 text-gray-500">{TRIGGER_META[e.trigger]?.label || e.trigger}</td>
                      <td className="py-1.5 pr-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${e.status === "success" ? "bg-green-50 text-green-700" : e.status === "failed" ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-500"}`}>
                          {e.status}{e.source === "test" ? " · test" : ""}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3">
                        {e.error ? <span className="text-red-600">{e.error}</span> : <span className="text-blue-600">{e.actionsExecuted.join(", ")}</span>}
                      </td>
                      <td className="py-1.5 text-gray-400">{fmt(e.executedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ══════════ WORKFLOWS TAB ══════════ */}
      {activeTab === "workflows" && (
        <>
          {/* Builder Modal */}
          {showBuilder && (
            <section className="rounded-xl border border-blue-100 bg-white p-6 shadow-lg">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-base font-bold text-gray-800">{editingRule ? "Edit Rule" : "New Automation Rule"}</h2>
                <button type="button" onClick={() => setShowBuilder(false)} className="rounded p-1 hover:bg-gray-100"><X className="h-4 w-4 text-gray-500" /></button>
              </div>

              <div className="space-y-5">
                {/* Name */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Name</span>
                    <input value={builderName} onChange={(e) => setBuilderName(e.target.value)} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-400 focus:bg-white" placeholder="e.g. Missed Call Auto Text" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Description</span>
                    <input value={builderDescription} onChange={(e) => setBuilderDescription(e.target.value)} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-400 focus:bg-white" placeholder="What does this rule do?" />
                  </label>
                </div>

                {/* WHEN */}
                <div className="rounded-xl border-2 border-blue-100 bg-gradient-to-b from-blue-50/50 to-white p-4">
                  <p className="mb-2 flex items-center gap-2 text-xs font-bold text-blue-700"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">1</span> WHEN this happens</p>
                  <select value={builderTrigger} onChange={(e) => setBuilderTrigger(e.target.value as WorkflowTrigger)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-blue-400">
                    {TRIGGER_CATEGORIES.map((cat) => (
                      <optgroup key={cat} label={cat}>
                        {(Object.entries(TRIGGER_META) as [WorkflowTrigger, (typeof TRIGGER_META)[WorkflowTrigger]][]).filter(([, m]) => m.category === cat).map(([k, m]) => (
                          <option key={k} value={k}>{m.icon} {m.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <p className="mt-2 text-[11px] text-gray-500">{TRIGGER_META[builderTrigger]?.description}</p>
                </div>

                {/* IF */}
                <div className="rounded-xl border-2 border-orange-100 bg-gradient-to-b from-orange-50/50 to-white p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="flex items-center gap-2 text-xs font-bold text-orange-700"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white">2</span> IF condition is met</p>
                    <button type="button" onClick={() => setBuilderConditions([...builderConditions, { field: "always", operator: "exists", value: "" }])} className="rounded-md bg-orange-100 px-2 py-1 text-[11px] font-bold text-orange-700 hover:bg-orange-200">+ Add</button>
                  </div>
                  <div className="space-y-2">
                    {builderConditions.map((c, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <select value={c.field} onChange={(e) => { const n = [...builderConditions]; n[i] = { ...c, field: e.target.value as WorkflowConditionField }; setBuilderConditions(n); }} className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-bold outline-none flex-1">
                          {(Object.entries(CONDITION_FIELD_META) as [WorkflowConditionField, { label: string }][]).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                        </select>
                        {c.field !== "always" && c.field !== "schedule_date_exists" && (
                          <>
                            <select value={c.operator} onChange={(e) => { const n = [...builderConditions]; n[i] = { ...c, operator: e.target.value as WorkflowConditionOp }; setBuilderConditions(n); }} className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-bold outline-none w-28">
                              <option value="equals">equals</option>
                              <option value="not_equals">not equals</option>
                              <option value="greater_than">greater than</option>
                              <option value="less_than">less than</option>
                            </select>
                            <input value={c.value} onChange={(e) => { const n = [...builderConditions]; n[i] = { ...c, value: e.target.value }; setBuilderConditions(n); }} className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-semibold outline-none flex-1" placeholder="Value (e.g. 24)" />
                          </>
                        )}
                        {builderConditions.length > 1 && (
                          <button type="button" onClick={() => setBuilderConditions(builderConditions.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500"><X className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* THEN */}
                <div className="rounded-xl border-2 border-green-100 bg-gradient-to-b from-green-50/50 to-white p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="flex items-center gap-2 text-xs font-bold text-green-700"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-600 text-[10px] font-bold text-white">3</span> THEN do this</p>
                    <button type="button" onClick={() => setBuilderActions([...builderActions, { type: "log_activity", params: { message: "" } }])} className="rounded-md bg-green-100 px-2 py-1 text-[11px] font-bold text-green-700 hover:bg-green-200">+ Add Action</button>
                  </div>
                  <div className="space-y-3">
                    {builderActions.map((a, i) => {
                      const meta = ACTION_TYPE_META[a.type];
                      return (
                        <div key={i} className="rounded-lg border border-gray-100 bg-white p-3">
                          <div className="flex items-center gap-2">
                            <select value={a.type} onChange={(e) => { const n = [...builderActions]; n[i] = { type: e.target.value as WorkflowActionType, params: {} }; setBuilderActions(n); }} className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs font-bold outline-none">
                              {(Object.entries(ACTION_TYPE_META) as [WorkflowActionType, typeof meta][]).map(([k, m]) => <option key={k} value={k}>{m.icon} {m.label}</option>)}
                            </select>
                            {builderActions.length > 1 && (
                              <button type="button" onClick={() => setBuilderActions(builderActions.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500"><X className="h-3.5 w-3.5" /></button>
                            )}
                          </div>
                          {meta.paramFields.length > 0 && (
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              {meta.paramFields.map((pf) => (
                                <label key={pf.key} className="grid gap-0.5">
                                  <span className="text-[10px] font-bold text-gray-400">{pf.label}</span>
                                  {pf.type === "select" ? (
                                    <select value={a.params[pf.key] || ""} onChange={(e) => { const n = [...builderActions]; n[i] = { ...a, params: { ...a.params, [pf.key]: e.target.value } }; setBuilderActions(n); }} className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs font-bold outline-none">
                                      <option value="">Select...</option>
                                      {pf.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                                    </select>
                                  ) : (
                                    <input value={a.params[pf.key] || ""} onChange={(e) => { const n = [...builderActions]; n[i] = { ...a, params: { ...a.params, [pf.key]: e.target.value } }; setBuilderActions(n); }} className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs font-semibold outline-none" placeholder={pf.label} />
                                  )}
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Audit (edit only) */}
                {editingRule && (
                  <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-[11px] text-gray-500">
                    <span className="font-bold text-gray-600">Audit:</span>{" "}
                    Created {fmt(editingRule.createdAt)}{editingRule.createdBy ? ` by ${editingRule.createdBy}` : ""} ·
                    {" "}Last edited {fmt(editingRule.updatedAt)}{editingRule.updatedBy ? ` by ${editingRule.updatedBy}` : ""}
                    {editingRule.lastError ? <span className="ml-1 text-red-600">· Last error: {editingRule.lastError}</span> : null}
                  </div>
                )}

                {/* Save */}
                <div className="flex gap-2 pt-2">
                  <button type="button" onClick={saveRule} disabled={!builderName.trim()} className="rounded-lg bg-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
                    {editingRule ? "Save Changes" : "Create Rule"}
                  </button>
                  {editingRule && (
                    <button type="button" onClick={() => handleRunNow(editingRule)} disabled={busyRuleId === editingRule.id} className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-2.5 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50">
                      {busyRuleId === editingRule.id ? "Running…" : "Run Now / Test"}
                    </button>
                  )}
                  <button type="button" onClick={() => setShowBuilder(false)} className="rounded-lg border border-gray-200 px-5 py-2.5 text-xs font-bold text-gray-600 hover:bg-gray-50">Cancel</button>
                </div>
              </div>
            </section>
          )}

          {/* Toolbar */}
          {!showBuilder && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => openBuilder()} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700">
                <Plus className="h-3.5 w-3.5" /> New Rule
              </button>
              <button type="button" onClick={() => setShowTemplates(!showTemplates)} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50">
                <Zap className="h-3.5 w-3.5 text-orange-500" /> Templates
              </button>
            </div>
          )}

          {/* Templates Grid */}
          {showTemplates && !showBuilder && (
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-800">Roofing Templates</h3>
                <button type="button" onClick={() => setShowTemplates(false)} className="text-[11px] font-bold text-gray-400 hover:text-gray-600">Close</button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {WORKFLOW_TEMPLATES.map((t, i) => (
                  <button key={i} type="button" onClick={() => { addFromTemplate(i); setShowTemplates(false); }} className="group rounded-lg border border-gray-100 bg-gray-50 p-3 text-left transition hover:border-blue-200 hover:bg-blue-50/50">
                    <div className="flex items-start gap-2">
                      <span className="text-sm">{TRIGGER_META[t.trigger]?.icon}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-gray-800 group-hover:text-blue-700">{t.name}</p>
                        <p className="mt-0.5 text-[11px] text-gray-500 line-clamp-1">{t.description}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Rules Table */}
          {!showBuilder && (
            <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              {filteredRules.length === 0 ? (
                <div className="p-10 text-center">
                  <GitBranch className="mx-auto h-8 w-8 text-gray-200" />
                  <p className="mt-3 text-sm font-bold text-gray-500">{search ? "No rules match your search" : "No automation rules yet"}</p>
                  <p className="mt-1 text-xs text-gray-400">Create your first rule or use a template.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/80 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">
                        <th className="px-4 py-3">Automation</th>
                        <th className="px-4 py-3 hidden sm:table-cell">Trigger</th>
                        <th className="px-4 py-3 hidden md:table-cell">Actions</th>
                        <th className="px-4 py-3 hidden lg:table-cell">Last Run</th>
                        <th className="px-4 py-3 text-center">Status</th>
                        <th className="px-4 py-3 text-right">Manage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filteredRules.map((rule) => (
                        <tr key={rule.id} className={`transition hover:bg-gray-50/50 ${!rule.enabled ? "opacity-50" : ""}`}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-gray-800">{rule.name}</p>
                              {rule.status === "paused" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Paused</span>}
                            </div>
                            <p className="mt-0.5 text-[11px] text-gray-400 line-clamp-1">{rule.description}</p>
                            {testResult && testResult.ruleId === rule.id && (
                              <p className={`mt-1 text-[11px] font-semibold ${testResult.ok ? "text-green-600" : "text-red-600"}`}>{testResult.ok ? "Test: " : "Test failed: "}{testResult.text}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
                              {TRIGGER_META[rule.trigger]?.icon} {TRIGGER_META[rule.trigger]?.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell">
                            <div className="flex flex-wrap gap-1">
                              {rule.actions.slice(0, 2).map((a, i) => (
                                <span key={i} className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-bold text-green-700">{ACTION_TYPE_META[a.type]?.icon} {ACTION_TYPE_META[a.type]?.label}</span>
                              ))}
                              {rule.actions.length > 2 && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">+{rule.actions.length - 2}</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3 hidden lg:table-cell text-[11px] text-gray-400">
                            <div>{rule.lastRunAt || rule.lastTriggered ? fmt(rule.lastRunAt || rule.lastTriggered) : "Never"}
                              {rule.triggerCount > 0 && <span className="ml-1 text-gray-300">({rule.triggerCount}x)</span>}</div>
                            <div className="mt-0.5 flex items-center gap-2">
                              {rule.lastSuccessAt && <span className="text-green-600">✓ {fmt(rule.lastSuccessAt)}</span>}
                              {rule.lastFailedAt && <span className="text-red-500" title={rule.lastError}>✕ {fmt(rule.lastFailedAt)}</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Toggle enabled={rule.enabled} onChange={(v) => handleToggle(rule, v)} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-0.5">
                              <button type="button" onClick={() => handleRunNow(rule)} disabled={busyRuleId === rule.id} className="rounded-md px-2 py-1.5 text-[11px] font-bold text-blue-600 hover:bg-blue-50 disabled:opacity-50" title="Run now / test">{busyRuleId === rule.id ? "…" : "Run"}</button>
                              <button type="button" onClick={() => openBuilder(rule)} className="rounded-md px-2 py-1.5 text-[11px] font-bold text-gray-600 hover:bg-gray-100">Edit</button>
                              <button type="button" onClick={() => handlePauseResume(rule)} className="rounded-md p-1.5 text-gray-400 hover:bg-amber-50 hover:text-amber-600" title={rule.status === "paused" ? "Resume" : "Pause"}>
                                {rule.status === "paused" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                              </button>
                              <button type="button" onClick={() => handleDuplicate(rule)} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600" title="Duplicate"><Copy className="h-3.5 w-3.5" /></button>
                              <button type="button" onClick={() => handleDelete(rule.id)} className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* Trigger Library */}
          {!showBuilder && (
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h3 className="mb-1 text-sm font-bold text-gray-800">Available Triggers</h3>
              <p className="mb-4 text-[11px] text-gray-500">Everything inside your CRM can be automated. Click a trigger to create a rule.</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {TRIGGER_CATEGORIES.map((cat) => {
                  const triggers = (Object.entries(TRIGGER_META) as [WorkflowTrigger, (typeof TRIGGER_META)[WorkflowTrigger]][]).filter(([, m]) => m.category === cat);
                  return (
                    <div key={cat} className="rounded-lg border border-gray-100 bg-gray-50/50 p-3">
                      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-500">{cat}</p>
                      <div className="space-y-1">
                        {triggers.map(([key, meta]) => (
                          <button key={key} type="button" onClick={() => { setBuilderTrigger(key); openBuilder(); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] font-semibold text-gray-700 transition hover:bg-blue-50 hover:text-blue-700">
                            <span>{meta.icon}</span> {meta.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {/* ══════════ NOTIFICATIONS TAB ══════════ */}
      {activeTab === "notifications" && (
        <>
          <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/80 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">
                    <th className="px-4 py-3">Notification</th>
                    <th className="px-4 py-3 hidden sm:table-cell">Group</th>
                    <th className="px-4 py-3 hidden md:table-cell">Timing</th>
                    <th className="px-4 py-3 hidden lg:table-cell">Last Triggered</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(Object.keys(AUTOMATION_META) as AutomationId[])
                    .filter((id) => {
                      if (!search.trim()) return true;
                      const q = search.toLowerCase();
                      const m = AUTOMATION_META[id];
                      return m.label.toLowerCase().includes(q) || m.description.toLowerCase().includes(q) || m.group.toLowerCase().includes(q);
                    })
                    .map((id) => {
                      const meta = AUTOMATION_META[id];
                      const rec = settings[id];
                      return (
                        <tr key={id} className={`transition hover:bg-gray-50/50 ${!rec.enabled ? "opacity-50" : ""}`}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="text-sm">{meta.icon}</span>
                              <div>
                                <p className="font-bold text-gray-800">{meta.label}</p>
                                <p className="text-[11px] text-gray-400 line-clamp-1">{meta.description}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-600">{meta.group}</span>
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell text-[11px] font-bold text-gray-600">{TIMING_LABELS[rec.timing]}</td>
                          <td className="px-4 py-3 hidden lg:table-cell text-[11px] text-gray-400">{fmt(rec.lastTriggered)}</td>
                          <td className="px-4 py-3 text-center">
                            <Toggle enabled={rec.enabled} onChange={(v) => toggleNotification(id, v)} />
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Info */}
          <section className="rounded-xl border border-blue-50 bg-blue-50/50 p-4">
            <div className="flex items-start gap-2.5">
              <Settings2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
              <p className="text-[11px] leading-5 font-semibold text-blue-700">
                Notifications are triggered by CRM events and sent via Email (Resend) or SMS (Twilio). Toggle them on/off instantly. Use the Workflow Rules tab for advanced logic-based automations.
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
