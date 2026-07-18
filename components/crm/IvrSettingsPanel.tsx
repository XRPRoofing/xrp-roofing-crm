"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Clock,
  Info,
  Loader2,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Trash2,
  Users,
} from "lucide-react";
import { loadCallRouting, saveCallRoutingOption } from "@/lib/call-routing-client";
import { clampSeconds, type CallRoutingOption, type RoutingStep } from "@/lib/twilio/routing-types";

function newStep(type: RoutingStep["type"]): RoutingStep {
  return type === "ring_group"
    ? { type: "ring_group", seconds: 30, label: "All Admins" }
    : { type: "number", number: "", seconds: 20, label: "Customer Service" };
}

function moveStep(steps: RoutingStep[], index: number, delta: number): RoutingStep[] {
  const target = index + delta;
  if (target < 0 || target >= steps.length) return steps;
  const next = [...steps];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function cloneOption(opt: CallRoutingOption): CallRoutingOption {
  return JSON.parse(JSON.stringify(opt)) as CallRoutingOption;
}

function cloneOptions(opts: CallRoutingOption[]): CallRoutingOption[] {
  return opts.map(cloneOption);
}

function optionEqual(a: CallRoutingOption, b: CallRoutingOption): boolean {
  if (a.option !== b.option) return false;
  if (a.label !== b.label) return false;
  if (a.enabled !== b.enabled) return false;
  if (a.steps.length !== b.steps.length) return false;
  for (let i = 0; i < a.steps.length; i++) {
    const sa = a.steps[i];
    const sb = b.steps[i];
    if (sa.type !== sb.type) return false;
    if (sa.seconds !== sb.seconds) return false;
    if (sa.label !== sb.label) return false;
    if (sa.number !== sb.number) return false;
  }
  return true;
}

function optionsEqual(a: CallRoutingOption[], b: CallRoutingOption[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!optionEqual(a[i], b[i])) return false;
  }
  return true;
}

function validateOption(opt: CallRoutingOption, allOptions: CallRoutingOption[]): string | null {
  const label = opt.label?.trim() || "";
  if (!label) return "Label is required";
  if (label.length > 120) return "Label must be 120 characters or less";

  const enabledCount = allOptions.reduce(
    (count, o) => count + (o.option === opt.option ? (opt.enabled ? 1 : 0) : o.enabled ? 1 : 0),
    0
  );
  if (enabledCount === 0) return "At least one IVR option must be enabled";

  for (let i = 0; i < opt.steps.length; i++) {
    const step = opt.steps[i];
    if (step.type === "number") {
      const number = (step.number || "").trim();
      if (!number) return `Step ${i + 1}: phone number is required`;
      if (!/^[\d+\-\s().]+$/.test(number)) return `Step ${i + 1}: phone number is invalid`;
    }
    if (step.seconds < 5 || step.seconds > 120) {
      return `Step ${i + 1}: ring time must be 5-120 seconds`;
    }
  }

  return null;
}

interface IvrSettingsPanelProps {
  isAdmin?: boolean;
}

export default function IvrSettingsPanel({ isAdmin = false }: IvrSettingsPanelProps) {
  const [options, setOptions] = useState<CallRoutingOption[]>([]);
  const [liveOptions, setLiveOptions] = useState<CallRoutingOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingOption, setSavingOption] = useState<string | null>(null);
  const [savedOption, setSavedOption] = useState<string | null>(null);
  const [optionErrors, setOptionErrors] = useState<Record<string, string | null>>({});
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const data = await loadCallRouting();
      setLiveOptions(data);
      setOptions(cloneOptions(data));
      setLastRefreshedAt(new Date().toLocaleString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const hasUnsavedChanges = !optionsEqual(options, liveOptions);

  async function refresh() {
    if (hasUnsavedChanges && !window.confirm("You have unsaved changes. Refresh will discard them and load the latest configuration. Continue?")) {
      return;
    }
    await loadData();
  }

  const updateOption = useCallback((option: string, mutate: (opt: CallRoutingOption) => CallRoutingOption) => {
    setSavedOption(null);
    setOptionErrors((prev) => ({ ...prev, [option]: null }));
    setOptions((prev) => prev.map((o) => (o.option === option ? mutate(o) : o)));
  }, []);

  const updateSteps = useCallback(
    (option: string, mutate: (steps: RoutingStep[]) => RoutingStep[]) => {
      updateOption(option, (o) => ({ ...o, steps: mutate(o.steps) }));
    },
    [updateOption]
  );

  async function handleSave(opt: CallRoutingOption) {
    const validation = validateOption(opt, options);
    if (validation) {
      setOptionErrors((prev) => ({ ...prev, [opt.option]: validation }));
      return;
    }

    setSavingOption(opt.option);
    setSavedOption(null);
    setOptionErrors((prev) => ({ ...prev, [opt.option]: null }));

    try {
      // Re-load the latest live configuration before writing to detect concurrent edits.
      const fresh = await loadCallRouting();
      const liveOpt = liveOptions.find((o) => o.option === opt.option);
      const freshOpt = fresh.find((o) => o.option === opt.option);

      if (liveOpt && freshOpt && !optionEqual(liveOpt, freshOpt)) {
        setOptionErrors((prev) => ({
          ...prev,
          [opt.option]:
            "Another admin changed this option since you last refreshed. Please refresh to load the latest configuration before saving.",
        }));
        return;
      }

      const confirmed = window.confirm(
        "This will change live inbound call routing and apply only to new calls. Active calls will continue using the current routing. Continue?"
      );
      if (!confirmed) return;

      await saveCallRoutingOption(opt.option, opt.label || "", opt.enabled, opt.steps);

      // Reload and display the saved configuration so the UI matches the live routing.
      const refreshed = await loadCallRouting();
      setLiveOptions(refreshed);
      setOptions((prev) => {
        const savedFresh = refreshed.find((o) => o.option === opt.option)!;
        return prev.map((o) => (o.option === opt.option ? cloneOption(savedFresh) : o));
      });
      setSavedOption(opt.option);
    } catch (err) {
      setOptionErrors((prev) => ({
        ...prev,
        [opt.option]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setSavingOption(null);
    }
  }

  if (!isAdmin) {
    return (
      <div className="p-4 lg:p-6">
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-12 text-center shadow-sm">
          <Settings className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm font-semibold text-gray-600">Admin access required</p>
          <p className="text-xs text-gray-400">Only admins can view or edit IVR routing settings.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 lg:p-6">
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-6 text-sm font-semibold text-gray-500 shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading IVR routing...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 lg:p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#072C6B] via-[#0A3D91] to-[#2B6BC4] p-6 text-white shadow-2xl shadow-blue-950/20">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-orange-300">Phone Integration</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">IVR Call Routing</h1>
            <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-blue-100">
              Edit the live inbound IVR routing configuration. Changes take effect only after you click Save, and they
              apply only to new incoming calls.
            </p>
            {hasUnsavedChanges && (
              <p className="mt-1 text-xs font-bold text-orange-300">You have unsaved changes</p>
            )}
            {lastRefreshedAt && (
              <p className="mt-1 text-xs font-semibold text-blue-200">Last refreshed: {lastRefreshedAt}</p>
            )}
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 self-start rounded-lg bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/20 disabled:opacity-60"
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 shrink-0 pt-0.5" />
          <p>
            This panel edits the live{" "}
            <code className="rounded bg-blue-100 px-1 py-0.5 font-mono">call_routing</code> table. Active calls continue
            using the routing that was in effect when they started; any saved changes only affect new calls reaching the
            IVR menu.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {options.map((opt) => (
          <section key={opt.option} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-lg font-bold text-white">
                  {opt.option}
                </span>
                <div className="flex-1">
                  <label className="block text-xs font-bold text-gray-500">Press {opt.option} label</label>
                  <input
                    type="text"
                    value={opt.label || ""}
                    onChange={(e) => updateOption(opt.option, (o) => ({ ...o, label: e.target.value }))}
                    className="mt-0.5 w-full min-w-[12rem] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 sm:w-auto"
                    placeholder="Option label"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm font-bold text-gray-600">
                <input
                  type="checkbox"
                  checked={opt.enabled}
                  onChange={(e) => updateOption(opt.option, (o) => ({ ...o, enabled: e.target.checked }))}
                  className="h-4 w-4"
                />
                Routing enabled
              </label>
            </div>

            <div className="mt-4 space-y-3">
              {opt.steps.length === 0 && (
                <p className="rounded-lg bg-gray-50 p-3 text-sm font-semibold text-gray-500">
                  No custom steps — this option uses the current default (rings all admins and the office line at once).
                </p>
              )}
              {opt.steps.map((step, index) => (
                <div key={index} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                      {index + 1}
                    </span>

                    <select
                      value={step.type}
                      onChange={(e) =>
                        updateSteps(opt.option, (steps) =>
                          steps.map((s, i) =>
                            i === index ? { ...newStep(e.target.value as RoutingStep["type"]), seconds: s.seconds } : s
                          )
                        )
                      }
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700"
                    >
                      <option value="number">Specific number</option>
                      <option value="ring_group">Ring group (all admins)</option>
                    </select>

                    {step.type === "number" ? (
                      <span className="flex items-center gap-2 text-sm font-semibold text-gray-600">
                        <Phone className="h-4 w-4 text-gray-400" />
                        <input
                          type="tel"
                          value={step.number || ""}
                          placeholder="+16233008097"
                          onChange={(e) =>
                            updateSteps(opt.option, (steps) =>
                              steps.map((s, i) => (i === index ? { ...s, number: e.target.value } : s))
                            )
                          }
                          className="w-44 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700"
                        />
                      </span>
                    ) : (
                      <span className="flex items-center gap-2 text-sm font-bold text-blue-700">
                        <Users className="h-4 w-4" /> All admin browsers ring at once
                      </span>
                    )}

                    <span className="flex items-center gap-2 text-sm font-semibold text-gray-600">
                      Ring for
                      <input
                        type="number"
                        min={5}
                        max={120}
                        value={step.seconds}
                        onChange={(e) =>
                          updateSteps(opt.option, (steps) =>
                            steps.map((s, i) =>
                              i === index ? { ...s, seconds: clampSeconds(Number(e.target.value)) } : s
                            )
                          )
                        }
                        className="w-20 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700"
                      />
                      sec
                    </span>

                    <span className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => updateSteps(opt.option, (steps) => moveStep(steps, index, -1))}
                        className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 transition hover:bg-gray-100 disabled:opacity-30"
                        aria-label="Move up"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={index === opt.steps.length - 1}
                        onClick={() => updateSteps(opt.option, (steps) => moveStep(steps, index, 1))}
                        className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 transition hover:bg-gray-100 disabled:opacity-30"
                        aria-label="Move down"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => updateSteps(opt.option, (steps) => steps.filter((_, i) => i !== index))}
                        className="rounded-lg border border-red-200 bg-white p-2 text-red-500 transition hover:bg-red-50"
                        aria-label="Remove step"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => updateSteps(opt.option, (steps) => [...steps, newStep("number")])}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-50"
              >
                <Plus className="h-4 w-4" /> Add number step
              </button>
              <button
                type="button"
                onClick={() => updateSteps(opt.option, (steps) => [...steps, newStep("ring_group")])}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-50"
              >
                <Plus className="h-4 w-4" /> Add ring group step
              </button>
              <button
                type="button"
                onClick={() => handleSave(opt)}
                disabled={savingOption === opt.option}
                className="ml-auto inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
              >
                {savingOption === opt.option ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Press {opt.option}
              </button>
              {savedOption === opt.option && (
                <span className="inline-flex items-center gap-1 text-sm font-bold text-green-600">
                  <Check className="h-4 w-4" /> Saved
                </span>
              )}
            </div>

            {optionErrors[opt.option] && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">
                {optionErrors[opt.option]}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
