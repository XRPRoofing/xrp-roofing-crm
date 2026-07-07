"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp, Loader2, Phone, Plus, Save, Trash2, Users } from "lucide-react";
import { loadCallRouting, saveCallRoutingOption } from "@/lib/call-routing-client";
import { clampSeconds, type CallRoutingOption, type RoutingStep } from "@/lib/twilio/routing-types";

function newStep(type: RoutingStep["type"]): RoutingStep {
  return type === "ring_group"
    ? { type: "ring_group", seconds: 30, label: "All Admins" }
    : { type: "number", number: "", seconds: 20, label: "Customer Service" };
}

export default function CallRoutingSettingsPage() {
  const [options, setOptions] = useState<CallRoutingOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingOption, setSavingOption] = useState<string | null>(null);
  const [savedOption, setSavedOption] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCallRouting()
      .then(setOptions)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  const updateOption = useCallback((option: string, mutate: (opt: CallRoutingOption) => CallRoutingOption) => {
    setSavedOption(null);
    setOptions((prev) => prev.map((o) => (o.option === option ? mutate(o) : o)));
  }, []);

  const updateSteps = useCallback(
    (option: string, mutate: (steps: RoutingStep[]) => RoutingStep[]) => {
      updateOption(option, (o) => ({ ...o, steps: mutate(o.steps) }));
    },
    [updateOption],
  );

  const handleSave = useCallback(async (opt: CallRoutingOption) => {
    setSavingOption(opt.option);
    setError(null);
    setSavedOption(null);
    try {
      await saveCallRoutingOption(opt.option, opt.label || "", opt.enabled, opt.steps);
      setSavedOption(opt.option);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingOption(null);
    }
  }, []);

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#072C6B] via-[#0A3D91] to-[#2B6BC4] p-6 text-white shadow-2xl shadow-blue-950/20">
        <Link href="/crm/settings" className="mb-3 inline-flex items-center gap-1 text-xs font-bold text-blue-100 transition hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Back to Settings
        </Link>
        <p className="text-xs font-bold uppercase tracking-wide text-orange-300">Phone Integration</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Incoming Call Routing</h1>
        <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-blue-100">
          When a caller presses a menu key, ring these destinations in order. Each step rings for its set seconds; if
          no one answers, the call automatically moves to the next step. The IVR greeting and menu keys are unchanged.
          Leave an option empty to keep the current default (ring everyone at once).
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-6 text-sm font-bold text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading routing…
        </div>
      ) : (
        <div className="space-y-4">
          {options.map((opt) => (
            <section key={opt.option} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-lg font-bold text-white">{opt.option}</span>
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">Press {opt.option}</h2>
                    <p className="text-xs font-semibold text-gray-500">{opt.label}</p>
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
                    No steps yet — this option uses the current default (rings all admins and the office line at once).
                    Add a step below to control the order.
                  </p>
                )}
                {opt.steps.map((step, index) => (
                  <div key={index} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">{index + 1}</span>

                      <select
                        value={step.type}
                        onChange={(e) =>
                          updateSteps(opt.option, (steps) =>
                            steps.map((s, i) => (i === index ? { ...newStep(e.target.value as RoutingStep["type"]), seconds: s.seconds } : s)),
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
                            onChange={(e) => updateSteps(opt.option, (steps) => steps.map((s, i) => (i === index ? { ...s, number: e.target.value } : s)))}
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
                          onChange={(e) => updateSteps(opt.option, (steps) => steps.map((s, i) => (i === index ? { ...s, seconds: clampSeconds(Number(e.target.value)) } : s)))}
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
                  {savingOption === opt.option ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save Press {opt.option}
                </button>
                {savedOption === opt.option && <span className="text-sm font-bold text-green-600">Saved</span>}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function moveStep(steps: RoutingStep[], index: number, delta: number): RoutingStep[] {
  const target = index + delta;
  if (target < 0 || target >= steps.length) return steps;
  const next = [...steps];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
