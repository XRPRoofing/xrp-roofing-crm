"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Mail,
  MessageSquare,
  RefreshCw,
  Settings2,
  Smartphone,
  Star,
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
  const [settings, setSettings] = useState<AutomationSettings>(DEFAULT_AUTOMATION_SETTINGS);
  const [log, setLog] = useState<AutomationLogEntry[]>([]);
  const [editingId, setEditingId] = useState<AutomationId | null>(null);
  const [draftTemplate, setDraftTemplate] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(AUTOMATION_GROUPS));
  const [showLog, setShowLog] = useState(false);
  const [testingId, setTestingId] = useState<AutomationId | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    setSettings(readAutomationSettings());
    setLog(readAutomationLog());
    const onUpdate = () => {
      setSettings(readAutomationSettings());
      setLog(readAutomationLog());
    };
    window.addEventListener("crm-automation-settings-updated", onUpdate);
    window.addEventListener("crm-automation-log-updated", onUpdate);
    window.addEventListener(AUTOMATION_LOG_KEY, onUpdate);
    return () => {
      window.removeEventListener("crm-automation-settings-updated", onUpdate);
      window.removeEventListener("crm-automation-log-updated", onUpdate);
      window.removeEventListener(AUTOMATION_LOG_KEY, onUpdate);
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#072C6B] via-[#0A3D91] to-[#2B6BC4] p-6 text-white shadow-2xl shadow-blue-950/20 sm:p-8">
        <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-orange-400/20 blur-3xl" />
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-orange-300">CRM Automations</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Automation Center</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-blue-100">
              Control all automated customer reminders, team notifications, review requests, and calendar summaries from one place.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1.5 rounded-full bg-blue-500/20 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-blue-200 ring-1 ring-blue-400/30">
                <span className="h-2 w-2 rounded-full bg-blue-400" />
                {enabledCount} automations active
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-blue-100 ring-1 ring-white/15">
                {Object.keys(AUTOMATION_META).length} total
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowLog((v) => !v)}
              className="flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold text-white hover:bg-white/20"
            >
              <Clock className="h-4 w-4" /> Automation Log ({log.length})
            </button>
          </div>
        </div>
      </section>

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
                  <tr className="border-b border-gray-100 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400">
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
                            <span key={c} className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">{c}</span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 pr-4">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${logStatusColor(entry.status)}`}>{entry.status}</span>
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
                <button type="button" onClick={() => enableAllInGroup(group, true)} className="rounded-lg px-3 py-1.5 text-[10px] font-bold text-blue-700 hover:bg-blue-50">Enable All</button>
                <button type="button" onClick={() => enableAllInGroup(group, false)} className="rounded-lg px-3 py-1.5 text-[10px] font-bold text-gray-500 hover:bg-gray-100">Disable All</button>
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
                              <p className="mt-1 text-[10px] text-gray-400">Last triggered: {fmt(rec.lastTriggered)}</p>
                            )}
                          </div>
                        </div>

                        {/* Controls */}
                        <div className="flex shrink-0 flex-wrap items-center gap-3">
                          {/* Channels */}
                          <button
                            type="button"
                            onClick={() => toggleChannel(id, "email", !rec.channels.email)}
                            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition ${rec.channels.email ? "border-blue-200 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-400"}`}
                          >
                            <Mail className="h-3.5 w-3.5" /> Email
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleChannel(id, "sms", !rec.channels.sms)}
                            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition ${rec.channels.sms ? "border-blue-200 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-400"}`}
                          >
                            <Smartphone className="h-3.5 w-3.5" /> SMS
                          </button>

                          {/* Timing */}
                          <select
                            value={rec.timing}
                            onChange={(e) => setTiming(id, e.target.value as AutomationTiming)}
                            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-gray-700 outline-none focus:border-blue-400"
                          >
                            {(Object.entries(TIMING_LABELS) as [AutomationTiming, string][]).map(([val, label]) => (
                              <option key={val} value={val}>{label}</option>
                            ))}
                          </select>

                          {/* Edit template */}
                          <button
                            type="button"
                            onClick={() => isEditing ? setEditingId(null) : openEditor(id)}
                            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-gray-600 hover:bg-gray-50"
                          >
                            <MessageSquare className="h-3.5 w-3.5" /> {isEditing ? "Close" : "Template"}
                          </button>

                          {/* Test send */}
                          <button
                            type="button"
                            onClick={() => void sendTestMessage(id)}
                            disabled={testingId === id}
                            className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
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
                            <button type="button" onClick={() => resetTemplate(id)} className="text-[10px] font-bold text-orange-600 hover:underline">Reset to default</button>
                          </div>
                          <textarea
                            value={draftTemplate}
                            onChange={(e) => setDraftTemplate(e.target.value)}
                            rows={4}
                            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700 outline-none focus:border-blue-400"
                          />
                          <p className="mt-2 text-[10px] font-semibold text-gray-400">
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
    </div>
  );
}
