"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  GitBranch,
  Mail,
  MessageSquare,
  Plus,
  RefreshCw,
  Settings2,
  Smartphone,
  Star,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  AUTOMATION_GROUPS,
  AUTOMATION_LOG_KEY,
  AUTOMATION_META,
  DEFAULT_AUTOMATION_SETTINGS,
  TIMING_LABELS,
  appendAutomationLog,
  readAutomationLog,
  readAutomationSettings,
  saveAutomationSettings,
  updateAutomation,
  type AutomationId,
  type AutomationLogEntry,
  type AutomationRecord,
  type AutomationSettings,
  type AutomationTiming,
} from "@/lib/automation-settings";
import {
  ACTION_TYPE_META,
  CONDITION_FIELD_META,
  TRIGGER_META,
  WORKFLOW_TEMPLATES,
  addWorkflowRule,
  deleteWorkflowRule,
  readWorkflowLog,
  readWorkflowRules,
  seedDefaultWorkflows,
  toggleWorkflowRule,
  updateWorkflowRule,
  type WorkflowAction,
  type WorkflowActionType,
  type WorkflowCondition,
  type WorkflowConditionField,
  type WorkflowConditionOp,
  type WorkflowLogEntry,
  type WorkflowRule,
  type WorkflowTrigger,
} from "@/lib/workflow-engine";

const GROUP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "Customer Reminders":     Bell,
  "Review Requests":        Star,
  "Internal Notifications": Users,
  "Calendar & Scheduling":  Calendar,
};

const GROUP_COLORS: Record<string, string> = {
  "Customer Reminders":     "blue",
  "Review Requests":        "orange",
  "Internal Notifications": "blue",
  "Calendar & Scheduling":  "blue",
};

function colorClasses(color: string) {
  if (color === "blue")    return { badge: "bg-blue-50 text-blue-700 border-blue-100",    dot: "bg-blue-500",    icon: "bg-blue-100 text-blue-600",    ring: "ring-blue-200" };
  if (color === "orange") return { badge: "bg-orange-50 text-orange-700 border-orange-100", dot: "bg-orange-500", icon: "bg-orange-100 text-orange-600", ring: "ring-orange-200" };
  return { badge: "bg-gray-50 text-gray-700 border-gray-200", dot: "bg-gray-400", icon: "bg-gray-100 text-gray-600", ring: "ring-gray-200" };
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? "bg-blue-600" : "bg-gray-300"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
}

function fmt(iso?: string) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return iso; }
}

export default function AutomationsPage() {
  const [activeTab, setActiveTab] = useState<"workflows" | "notifications">("workflows");
  const [settings, setSettings] = useState<AutomationSettings>(DEFAULT_AUTOMATION_SETTINGS);
  const [log, setLog] = useState<AutomationLogEntry[]>([]);
  const [editingId, setEditingId] = useState<AutomationId | null>(null);
  const [draftTemplate, setDraftTemplate] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(AUTOMATION_GROUPS));
  const [showLog, setShowLog] = useState(false);
  const [testingId, setTestingId] = useState<AutomationId | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Workflow state
  const [workflowRules, setWorkflowRules] = useState<WorkflowRule[]>([]);
  const [workflowLog, setWorkflowLog] = useState<WorkflowLogEntry[]>([]);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingRule, setEditingRule] = useState<WorkflowRule | null>(null);
  const [showWorkflowLog, setShowWorkflowLog] = useState(false);

  // Builder form state
  const [builderName, setBuilderName] = useState("");
  const [builderDescription, setBuilderDescription] = useState("");
  const [builderTrigger, setBuilderTrigger] = useState<WorkflowTrigger>("job_created");
  const [builderConditions, setBuilderConditions] = useState<WorkflowCondition[]>([{ field: "always", operator: "exists", value: "" }]);
  const [builderActions, setBuilderActions] = useState<WorkflowAction[]>([{ type: "log_activity", params: { message: "" } }]);

  useEffect(() => {
    setSettings(readAutomationSettings());
    setLog(readAutomationLog());
    seedDefaultWorkflows();
    setWorkflowRules(readWorkflowRules());
    setWorkflowLog(readWorkflowLog());
    const onUpdate = () => {
      setSettings(readAutomationSettings());
      setLog(readAutomationLog());
    };
    const onWfUpdate = () => {
      setWorkflowRules(readWorkflowRules());
      setWorkflowLog(readWorkflowLog());
    };
    window.addEventListener("crm-automation-settings-updated", onUpdate);
    window.addEventListener("crm-automation-log-updated", onUpdate);
    window.addEventListener(AUTOMATION_LOG_KEY, onUpdate);
    window.addEventListener("crm-workflow-rules-updated", onWfUpdate);
    window.addEventListener("crm-workflow-log-updated", onWfUpdate);
    return () => {
      window.removeEventListener("crm-automation-settings-updated", onUpdate);
      window.removeEventListener("crm-automation-log-updated", onUpdate);
      window.removeEventListener(AUTOMATION_LOG_KEY, onUpdate);
      window.removeEventListener("crm-workflow-rules-updated", onWfUpdate);
      window.removeEventListener("crm-workflow-log-updated", onWfUpdate);
    };
  }, []);

  const enabledCount = useMemo(
    () => (Object.keys(settings) as AutomationId[]).filter((id) => settings[id].enabled).length,
    [settings],
  );

  function toggle(id: AutomationId, enabled: boolean) {
    const next = updateAutomation(id, { enabled });
    setSettings(next);
  }

  function toggleChannel(id: AutomationId, channel: "email" | "sms", value: boolean) {
    const current = settings[id];
    const next = updateAutomation(id, { channels: { ...current.channels, [channel]: value } });
    setSettings(next);
  }

  function setTiming(id: AutomationId, timing: AutomationTiming) {
    const next = updateAutomation(id, { timing });
    setSettings(next);
  }

  function openEditor(id: AutomationId) {
    setEditingId(id);
    setDraftTemplate(settings[id].template);
    setTestResult(null);
  }

  function saveTemplate() {
    if (!editingId) return;
    const next = updateAutomation(editingId, { template: draftTemplate });
    setSettings(next);
    setEditingId(null);
  }

  function resetTemplate(id: AutomationId) {
    const next = updateAutomation(id, { template: DEFAULT_AUTOMATION_SETTINGS[id].template });
    setSettings(next);
    if (editingId === id) setDraftTemplate(DEFAULT_AUTOMATION_SETTINGS[id].template);
  }

  async function sendTestMessage(id: AutomationId) {
    setTestingId(id);
    setTestResult(null);
    const rec = settings[id];
    const meta = AUTOMATION_META[id];
    try {
      const res = await fetch("/api/automations/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          automationId: id,
          automationLabel: meta.label,
          channels: rec.channels,
          template: rec.template,
          recipient: { name: "Test Customer", email: "test@xrproofing.com", phone: "+16025550100" },
          variables: {
            customerName: "Test Customer", time: "10:00 AM", address: "123 Test St, Phoenix AZ",
            date: new Date().toLocaleDateString(), invoiceNumber: "INV-0001", amount: "$1,000.00",
            paymentLink: "https://xrproofing.com/pay", proposalId: "P-TEST-001",
            phone: "+16025550100", email: "test@xrproofing.com", status: "Completed",
            messagePreview: "Test message preview", reviewLink: "https://g.page/r/test",
            weekStart: new Date().toLocaleDateString(), scheduleList: "• 9:00 AM — Test Job",
            appointmentTitle: "Roof Inspection", assignedTo: "Jonathan",
          },
        }),
      });
      const json = await res.json() as { status: string; results?: { channel: string; ok: boolean; error?: string }[] };
      appendAutomationLog({
        automationId: id,
        automationLabel: meta.label,
        recipientName: "Test Customer",
        recipientEmail: "test@xrproofing.com",
        channels: Object.entries(rec.channels).filter(([, v]) => v).map(([k]) => k),
        status: json.status as "sent" | "failed" | "skipped",
        detail: `Test send — ${json.status}`,
      });
      setLog(readAutomationLog());
      setTestResult(json.status === "sent" ? "✓ Test sent successfully!" : json.status === "skipped" ? "⚠ Skipped — no channel configured" : `✗ Failed: ${json.results?.map((r) => r.error).filter(Boolean).join(", ") || "unknown error"}`);
    } catch {
      setTestResult("✗ Network error — could not reach server.");
    } finally {
      setTestingId(null);
    }
  }

  function toggleGroup(group: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(group) ? next.delete(group) : next.add(group);
      return next;
    });
  }

  function enableAllInGroup(group: string, enabled: boolean) {
    const ids = (Object.keys(AUTOMATION_META) as AutomationId[]).filter((id) => AUTOMATION_META[id].group === group);
    let next = settings;
    for (const id of ids) {
      next = { ...next, [id]: { ...next[id], enabled } };
    }
    saveAutomationSettings(next);
    setSettings(next);
  }

  const logStatusColor = (s: string) =>
    s === "sent" ? "text-blue-700 bg-blue-50" : s === "failed" ? "text-orange-700 bg-orange-50" : "text-gray-600 bg-gray-100";

  const enabledWorkflows = workflowRules.filter((r) => r.enabled).length;

  function openBuilder(rule?: WorkflowRule) {
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

  function saveRule() {
    if (!builderName.trim()) return;
    if (editingRule) {
      updateWorkflowRule(editingRule.id, {
        name: builderName,
        description: builderDescription,
        trigger: builderTrigger,
        conditions: builderConditions,
        actions: builderActions,
      });
    } else {
      addWorkflowRule({
        name: builderName,
        description: builderDescription,
        trigger: builderTrigger,
        conditions: builderConditions,
        actions: builderActions,
        enabled: true,
      });
    }
    setWorkflowRules(readWorkflowRules());
    setShowBuilder(false);
  }

  function handleDeleteRule(id: string) {
    if (!confirm("Delete this workflow rule?")) return;
    deleteWorkflowRule(id);
    setWorkflowRules(readWorkflowRules());
  }

  function addFromTemplate(templateIndex: number) {
    const t = WORKFLOW_TEMPLATES[templateIndex];
    if (!t) return;
    addWorkflowRule({ ...t });
    setWorkflowRules(readWorkflowRules());
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      {/* Header */}
      <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#072C6B] via-[#0A3D91] to-[#2B6BC4] p-6 text-white shadow-2xl shadow-blue-950/20 sm:p-8">
        <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-orange-400/20 blur-3xl" />
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-orange-300">CRM Automations & Workflows</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Automation Center</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-blue-100">
              Control workflow logic, automation rules, reminders, and notifications directly from here. No coding required.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1.5 rounded-full bg-blue-500/20 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-blue-200 ring-1 ring-blue-400/30">
                <span className="h-2 w-2 rounded-full bg-blue-400" />
                {enabledWorkflows} workflows active
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-orange-500/20 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-orange-200 ring-1 ring-orange-400/30">
                <span className="h-2 w-2 rounded-full bg-orange-400" />
                {enabledCount} notifications active
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowWorkflowLog((v) => !v)} className="flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold text-white hover:bg-white/20">
              <Clock className="h-4 w-4" /> Activity Log ({workflowLog.length})
            </button>
          </div>
        </div>
      </section>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
        <button type="button" onClick={() => setActiveTab("workflows")} className={`flex-1 flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-bold transition ${activeTab === "workflows" ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
          <GitBranch className="h-4 w-4" /> Workflow Rules
        </button>
        <button type="button" onClick={() => setActiveTab("notifications")} className={`flex-1 flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-bold transition ${activeTab === "notifications" ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
          <Bell className="h-4 w-4" /> Notifications
        </button>
      </div>

      {/* Workflow Log */}
      {showWorkflowLog && (
        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-blue-700">Workflow Activity Log</h2>
            <button type="button" onClick={() => setShowWorkflowLog(false)} className="rounded-lg p-1.5 hover:bg-gray-100"><X className="h-4 w-4 text-gray-500" /></button>
          </div>
          {workflowLog.length === 0 ? (
            <p className="py-8 text-center text-sm font-semibold text-gray-400">No workflow activity yet. Rules will log here when triggered.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-[11px] font-bold uppercase tracking-wider text-gray-400">
                    <th className="pb-2 pr-4">Rule</th>
                    <th className="pb-2 pr-4">Trigger</th>
                    <th className="pb-2 pr-4">Actions</th>
                    <th className="pb-2">Executed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {workflowLog.slice(0, 50).map((entry) => (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="py-2 pr-4 font-bold text-gray-800">{entry.ruleName}</td>
                      <td className="py-2 pr-4 text-gray-600">{TRIGGER_META[entry.trigger]?.label || entry.trigger}</td>
                      <td className="py-2 pr-4">
                        <div className="flex flex-wrap gap-1">
                          {entry.actionsExecuted.map((a, i) => (
                            <span key={i} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">{a}</span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 text-gray-400">{fmt(entry.executedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ═══ WORKFLOW RULES TAB ═══ */}
      {activeTab === "workflows" && (
        <>
          {/* Workflow Builder Modal */}
          {showBuilder && (
            <section className="rounded-lg border border-blue-200 bg-white p-6 shadow-lg">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-bold text-blue-700">{editingRule ? "Edit Workflow Rule" : "Create Workflow Rule"}</h2>
                <button type="button" onClick={() => setShowBuilder(false)} className="rounded-lg p-1.5 hover:bg-gray-100"><X className="h-4 w-4 text-gray-500" /></button>
              </div>

              <div className="space-y-5">
                {/* Name & Description */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-xs font-bold uppercase tracking-wide text-gray-500">Rule Name</span>
                    <input value={builderName} onChange={(e) => setBuilderName(e.target.value)} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-blue-400 focus:bg-white" placeholder="e.g. Auto-Schedule to Calendar" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-bold uppercase tracking-wide text-gray-500">Description</span>
                    <input value={builderDescription} onChange={(e) => setBuilderDescription(e.target.value)} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-blue-400 focus:bg-white" placeholder="What does this rule do?" />
                  </label>
                </div>

                {/* WHEN (Trigger) */}
                <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4">
                  <p className="mb-3 text-xs font-bold uppercase tracking-wider text-blue-700">WHEN this happens:</p>
                  <select value={builderTrigger} onChange={(e) => setBuilderTrigger(e.target.value as WorkflowTrigger)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-gray-800 outline-none focus:border-blue-400">
                    {(Object.entries(TRIGGER_META) as [WorkflowTrigger, { label: string; description: string; icon: string }][]).map(([key, meta]) => (
                      <option key={key} value={key}>{meta.icon} {meta.label} — {meta.description}</option>
                    ))}
                  </select>
                </div>

                {/* IF (Conditions) */}
                <div className="rounded-lg border border-orange-100 bg-orange-50/50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-wider text-orange-700">IF these conditions are met:</p>
                    <button type="button" onClick={() => setBuilderConditions([...builderConditions, { field: "always", operator: "exists", value: "" }])} className="flex items-center gap-1 rounded-lg bg-orange-100 px-2.5 py-1.5 text-xs font-bold text-orange-700 hover:bg-orange-200">
                      <Plus className="h-3 w-3" /> Add Condition
                    </button>
                  </div>
                  <div className="space-y-2">
                    {builderConditions.map((cond, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <select value={cond.field} onChange={(e) => { const next = [...builderConditions]; next[idx] = { ...cond, field: e.target.value as WorkflowConditionField }; setBuilderConditions(next); }} className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold outline-none">
                          {(Object.entries(CONDITION_FIELD_META) as [WorkflowConditionField, { label: string }][]).map(([k, m]) => (
                            <option key={k} value={k}>{m.label}</option>
                          ))}
                        </select>
                        {cond.field !== "always" && cond.field !== "schedule_date_exists" && (
                          <>
                            <select value={cond.operator} onChange={(e) => { const next = [...builderConditions]; next[idx] = { ...cond, operator: e.target.value as WorkflowConditionOp }; setBuilderConditions(next); }} className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-bold outline-none">
                              <option value="equals">equals</option>
                              <option value="not_equals">not equals</option>
                              <option value="greater_than">greater than</option>
                              <option value="less_than">less than</option>
                              <option value="exists">exists</option>
                              <option value="not_exists">not exists</option>
                            </select>
                            <input value={cond.value} onChange={(e) => { const next = [...builderConditions]; next[idx] = { ...cond, value: e.target.value }; setBuilderConditions(next); }} className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold outline-none" placeholder="Value" />
                          </>
                        )}
                        {builderConditions.length > 1 && (
                          <button type="button" onClick={() => setBuilderConditions(builderConditions.filter((_, i) => i !== idx))} className="rounded-lg p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* THEN (Actions) */}
                <div className="rounded-lg border border-green-100 bg-green-50/50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-wider text-green-700">THEN do this:</p>
                    <button type="button" onClick={() => setBuilderActions([...builderActions, { type: "log_activity", params: { message: "" } }])} className="flex items-center gap-1 rounded-lg bg-green-100 px-2.5 py-1.5 text-xs font-bold text-green-700 hover:bg-green-200">
                      <Plus className="h-3 w-3" /> Add Action
                    </button>
                  </div>
                  <div className="space-y-3">
                    {builderActions.map((action, idx) => {
                      const meta = ACTION_TYPE_META[action.type];
                      return (
                        <div key={idx} className="rounded-lg border border-gray-200 bg-white p-3">
                          <div className="flex items-center gap-2">
                            <select value={action.type} onChange={(e) => { const next = [...builderActions]; next[idx] = { type: e.target.value as WorkflowActionType, params: {} }; setBuilderActions(next); }} className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold outline-none">
                              {(Object.entries(ACTION_TYPE_META) as [WorkflowActionType, typeof meta][]).map(([k, m]) => (
                                <option key={k} value={k}>{m.icon} {m.label}</option>
                              ))}
                            </select>
                            {builderActions.length > 1 && (
                              <button type="button" onClick={() => setBuilderActions(builderActions.filter((_, i) => i !== idx))} className="rounded-lg p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
                            )}
                          </div>
                          {meta.paramFields.length > 0 && (
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              {meta.paramFields.map((pf) => (
                                <label key={pf.key} className="grid gap-1">
                                  <span className="text-[11px] font-bold text-gray-500">{pf.label}</span>
                                  {pf.type === "select" ? (
                                    <select value={action.params[pf.key] || ""} onChange={(e) => { const next = [...builderActions]; next[idx] = { ...action, params: { ...action.params, [pf.key]: e.target.value } }; setBuilderActions(next); }} className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs font-bold outline-none">
                                      <option value="">Select...</option>
                                      {pf.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                                    </select>
                                  ) : (
                                    <input value={action.params[pf.key] || ""} onChange={(e) => { const next = [...builderActions]; next[idx] = { ...action, params: { ...action.params, [pf.key]: e.target.value } }; setBuilderActions(next); }} className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs font-semibold outline-none" placeholder={pf.label} />
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

                {/* Save */}
                <div className="flex gap-3">
                  <button type="button" onClick={saveRule} disabled={!builderName.trim()} className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                    <CheckCircle className="h-4 w-4" /> {editingRule ? "Update Rule" : "Create Rule"}
                  </button>
                  <button type="button" onClick={() => setShowBuilder(false)} className="rounded-lg border border-gray-200 px-5 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50">Cancel</button>
                </div>
              </div>
            </section>
          )}

          {/* Toolbar */}
          {!showBuilder && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button type="button" onClick={() => openBuilder()} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700">
                <Plus className="h-4 w-4" /> Create New Rule
              </button>
              <p className="text-xs font-semibold text-gray-500">{workflowRules.length} rules total &middot; {enabledWorkflows} active</p>
            </div>
          )}

          {/* Workflow Rules List */}
          {!showBuilder && workflowRules.length > 0 && (
            <div className="space-y-3">
              {workflowRules.map((rule) => (
                <section key={rule.id} className={`rounded-lg border bg-white p-5 shadow-sm transition ${rule.enabled ? "border-gray-200" : "border-gray-100 opacity-60"}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{TRIGGER_META[rule.trigger]?.icon || "⚡"}</span>
                        <p className="text-sm font-bold text-blue-700">{rule.name}</p>
                        {!rule.enabled && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">PAUSED</span>}
                      </div>
                      <p className="mt-1 text-xs font-semibold text-gray-500">{rule.description}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">WHEN: {TRIGGER_META[rule.trigger]?.label}</span>
                        {rule.conditions.filter((c) => c.field !== "always").map((c, i) => (
                          <span key={i} className="rounded-full bg-orange-50 px-2.5 py-1 text-[11px] font-bold text-orange-700">IF: {CONDITION_FIELD_META[c.field]?.label} {c.operator} {c.value}</span>
                        ))}
                        {rule.actions.map((a, i) => (
                          <span key={i} className="rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-bold text-green-700">THEN: {ACTION_TYPE_META[a.type]?.label}</span>
                        ))}
                      </div>
                      {rule.lastTriggered && (
                        <p className="mt-2 text-[11px] text-gray-400">Last triggered: {fmt(rule.lastTriggered)} &middot; Ran {rule.triggerCount} time{rule.triggerCount !== 1 ? "s" : ""}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button type="button" onClick={() => openBuilder(rule)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50">Edit</button>
                      <button type="button" onClick={() => handleDeleteRule(rule.id)} className="rounded-lg p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                      <Toggle enabled={rule.enabled} onChange={(v) => { toggleWorkflowRule(rule.id, v); setWorkflowRules(readWorkflowRules()); }} />
                    </div>
                  </div>
                </section>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!showBuilder && workflowRules.length === 0 && (
            <section className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
              <GitBranch className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm font-bold text-gray-600">No workflow rules yet</p>
              <p className="mt-1 text-xs text-gray-500">Create your first automation rule or use a template below.</p>
            </section>
          )}

          {/* Templates */}
          {!showBuilder && (
            <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 text-sm font-bold text-blue-700">Quick-Add Templates</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {WORKFLOW_TEMPLATES.map((tmpl, idx) => (
                  <button key={idx} type="button" onClick={() => addFromTemplate(idx)} className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-left transition hover:border-blue-200 hover:bg-blue-50">
                    <p className="text-xs font-bold text-blue-700">{tmpl.name}</p>
                    <p className="mt-1 text-[11px] font-semibold text-gray-500 line-clamp-2">{tmpl.description}</p>
                    <div className="mt-2 flex items-center gap-1">
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-600">{TRIGGER_META[tmpl.trigger]?.label}</span>
                      <span className="text-[10px] text-gray-400">→</span>
                      <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-bold text-green-600">{tmpl.actions.length} action{tmpl.actions.length > 1 ? "s" : ""}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Visual Pipeline */}
          {!showBuilder && (
            <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 text-sm font-bold text-blue-700">Visual Workflow Pipeline</h3>
              <p className="mb-4 text-xs font-semibold text-gray-500">Cards move automatically based on your active workflow rules</p>
              <div className="flex overflow-x-auto gap-2 pb-3">
                {["New Lead", "Inspection Scheduled", "Inspection Complete", "Proposal Created", "Proposal Sent", "Follow Up", "Won/Approved", "Scheduled", "In Progress", "Invoice Sent", "Paid", "Completed"].map((stage, idx) => (
                  <div key={stage} className="flex shrink-0 items-center gap-1.5">
                    <div className="rounded-lg border border-gray-200 bg-gradient-to-b from-white to-gray-50 px-3 py-2 text-center shadow-sm">
                      <p className="whitespace-nowrap text-[11px] font-bold text-gray-700">{stage}</p>
                    </div>
                    {idx < 11 && <span className="text-gray-300">→</span>}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-gray-400">Active rules that move jobs between stages will execute automatically when trigger conditions are met.</p>
            </section>
          )}

          {/* Info */}
          <section className="rounded-lg border border-blue-100 bg-blue-50 p-5">
            <div className="flex items-start gap-3">
              <Settings2 className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
              <div className="text-sm text-blue-800">
                <p className="font-bold">How Workflow Rules Work</p>
                <p className="mt-1 leading-6 font-semibold">
                  Workflow rules run automatically when CRM events happen. Each rule has a <strong>trigger</strong> (when something happens),
                  optional <strong>conditions</strong> (only if these are true), and <strong>actions</strong> (what to do).
                  Rules execute in real-time — all users see updates instantly. You can create, edit, enable, disable, or delete rules at any time without touching code.
                </p>
              </div>
            </div>
          </section>
        </>
      )}

      {/* ═══ NOTIFICATIONS TAB ═══ */}
      {activeTab === "notifications" && (
        <>

      {/* Automation Log */}
      {showLog && (
        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-blue-700">Automation History</h2>
            <button type="button" onClick={() => setShowLog(false)} className="rounded-lg p-1.5 hover:bg-gray-100"><X className="h-4 w-4 text-gray-500" /></button>
          </div>
          {log.length === 0 ? (
            <p className="py-8 text-center text-sm font-semibold text-gray-400">No automation activity yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-[11px] font-bold uppercase tracking-wider text-gray-400">
                    <th className="pb-2 pr-4">Automation</th>
                    <th className="pb-2 pr-4">Recipient</th>
                    <th className="pb-2 pr-4">Channels</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2">Triggered</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {log.map((entry) => (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="py-2 pr-4 font-bold text-gray-800">{entry.automationLabel}</td>
                      <td className="py-2 pr-4 text-gray-600">{entry.recipientName}</td>
                      <td className="py-2 pr-4">
                        <div className="flex gap-1">
                          {entry.channels.map((c) => (
                            <span key={c} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">{c}</span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 pr-4">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ${logStatusColor(entry.status)}`}>{entry.status}</span>
                      </td>
                      <td className="py-2 text-gray-400">{fmt(entry.triggeredAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Groups */}
      {AUTOMATION_GROUPS.map((group) => {
        const GroupIcon = GROUP_ICONS[group] ?? Settings2;
        const color = GROUP_COLORS[group] ?? "slate";
        const c = colorClasses(color);
        const ids = (Object.keys(AUTOMATION_META) as AutomationId[]).filter((id) => AUTOMATION_META[id].group === group);
        const enabledInGroup = ids.filter((id) => settings[id].enabled).length;
        const isExpanded = expandedGroups.has(group);

        return (
          <section key={group} className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            {/* Group header */}
            <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-5 py-4">
              <button type="button" onClick={() => toggleGroup(group)} className="flex flex-1 items-center gap-3 text-left">
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${c.icon}`}>
                  <GroupIcon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-bold text-blue-700">{group}</p>
                  <p className="text-xs font-semibold text-gray-500">{enabledInGroup}/{ids.length} enabled</p>
                </div>
                {isExpanded ? <ChevronUp className="ml-2 h-4 w-4 text-gray-400" /> : <ChevronDown className="ml-2 h-4 w-4 text-gray-400" />}
              </button>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => enableAllInGroup(group, true)} className="rounded-lg px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50">Enable All</button>
                <button type="button" onClick={() => enableAllInGroup(group, false)} className="rounded-lg px-3 py-1.5 text-xs font-bold text-gray-500 hover:bg-gray-100">Disable All</button>
              </div>
            </div>

            {/* Automation rows */}
            {isExpanded && (
              <div className="divide-y divide-gray-50">
                {ids.map((id) => {
                  const meta = AUTOMATION_META[id];
                  const rec: AutomationRecord = settings[id];
                  const isEditing = editingId === id;

                  return (
                    <div key={id} className={`px-5 py-4 transition ${rec.enabled ? "" : "opacity-60"}`}>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        {/* Info */}
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 text-lg">{meta.icon}</span>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-blue-700">{meta.label}</p>
                            <p className="mt-0.5 text-xs font-semibold text-gray-500">{meta.description}</p>
                            {rec.lastTriggered && (
                              <p className="mt-1 text-[11px] text-gray-400">Last triggered: {fmt(rec.lastTriggered)}</p>
                            )}
                          </div>
                        </div>

                        {/* Controls */}
                        <div className="flex shrink-0 flex-wrap items-center gap-3">
                          {/* Channels */}
                          <button
                            type="button"
                            onClick={() => toggleChannel(id, "email", !rec.channels.email)}
                            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition ${rec.channels.email ? "border-blue-200 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-400"}`}
                          >
                            <Mail className="h-3.5 w-3.5" /> Email
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleChannel(id, "sms", !rec.channels.sms)}
                            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition ${rec.channels.sms ? "border-blue-200 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-400"}`}
                          >
                            <Smartphone className="h-3.5 w-3.5" /> SMS
                          </button>

                          {/* Timing */}
                          <select
                            value={rec.timing}
                            onChange={(e) => setTiming(id, e.target.value as AutomationTiming)}
                            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-bold text-gray-700 outline-none focus:border-blue-400"
                          >
                            {(Object.entries(TIMING_LABELS) as [AutomationTiming, string][]).map(([val, label]) => (
                              <option key={val} value={val}>{label}</option>
                            ))}
                          </select>

                          {/* Edit template */}
                          <button
                            type="button"
                            onClick={() => isEditing ? setEditingId(null) : openEditor(id)}
                            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50"
                          >
                            <MessageSquare className="h-3.5 w-3.5" /> {isEditing ? "Close" : "Template"}
                          </button>

                          {/* Test send */}
                          <button
                            type="button"
                            onClick={() => void sendTestMessage(id)}
                            disabled={testingId === id}
                            className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                          >
                            {testingId === id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                            {testingId === id ? "Sending…" : "Test"}
                          </button>

                          {/* Toggle */}
                          <Toggle enabled={rec.enabled} onChange={(v) => toggle(id, v)} />
                        </div>
                      </div>

                      {/* Test result */}
                      {testResult && testingId === null && editingId !== id && (
                        <p className={`mt-2 rounded-lg px-3 py-2 text-xs font-bold ${testResult.startsWith("✓") ? "bg-blue-50 text-blue-700" : testResult.startsWith("⚠") ? "bg-orange-50 text-orange-700" : "bg-orange-50 text-orange-700"}`}>
                          {testResult}
                        </p>
                      )}

                      {/* Template editor */}
                      {isEditing && (
                        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Message Template</p>
                            <button type="button" onClick={() => resetTemplate(id)} className="text-[11px] font-bold text-orange-600 hover:underline">Reset to default</button>
                          </div>
                          <textarea
                            value={draftTemplate}
                            onChange={(e) => setDraftTemplate(e.target.value)}
                            rows={4}
                            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700 outline-none focus:border-blue-400"
                          />
                          <p className="mt-2 text-[11px] font-semibold text-gray-400">
                            Variables: {"{customerName}"} {"{date}"} {"{time}"} {"{address}"} {"{invoiceNumber}"} {"{amount}"} {"{paymentLink}"} {"{proposalId}"} {"{reviewLink}"} {"{status}"} {"{assignedTo}"}
                          </p>
                          <div className="mt-3 flex gap-2">
                            <button type="button" onClick={saveTemplate} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700">
                              <CheckCircle className="h-3.5 w-3.5" /> Save Template
                            </button>
                            <button type="button" onClick={() => setEditingId(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100">Cancel</button>
                          </div>
                          {testResult && (
                            <p className={`mt-2 rounded-lg px-3 py-2 text-xs font-bold ${testResult.startsWith("✓") ? "bg-blue-50 text-blue-700" : testResult.startsWith("⚠") ? "bg-orange-50 text-orange-700" : "bg-orange-50 text-orange-700"}`}>
                              {testResult}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {/* Notification Log Toggle */}
      <div className="flex justify-end">
        <button type="button" onClick={() => setShowLog((v) => !v)} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50">
          <Clock className="h-3.5 w-3.5" /> Notification Log ({log.length})
        </button>
      </div>

      {/* Info strip */}
      <section className="rounded-lg border border-blue-100 bg-blue-50 p-5">
        <div className="flex items-start gap-3">
          <Settings2 className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
          <div className="text-sm text-blue-800">
            <p className="font-bold">How automations work</p>
            <p className="mt-1 leading-6 font-semibold">
              Automations are triggered by CRM events (lead creation, job status changes, proposal views, etc.).
              Email is sent via <strong>Resend</strong> (requires <code className="rounded bg-blue-100 px-1 font-mono text-xs">RESEND_API_KEY</code>).
              SMS is sent via <strong>Twilio</strong> (requires Twilio credentials).
              Internal notification automations appear in the CRM bell notification panel.
              Use the <strong>Test</strong> button to send a sample message to your configured office email/phone.
            </p>
          </div>
        </div>
      </section>

        </>
      )}
    </div>
  );
}
