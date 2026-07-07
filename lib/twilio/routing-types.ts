// Shared types for configurable inbound IVR call routing.
// Imported by both the browser (Settings UI) and the server (TwiML flow),
// so this file must stay free of client/server-only imports.

export type RoutingStepType = "ring_group" | "number";

export interface RoutingStep {
  // "ring_group" rings every admin browser at once (first to answer stops the
  // rest). "number" rings a single phone number (e.g. Customer Service).
  type: RoutingStepType;
  // Present for type === "number"; the destination phone number.
  number?: string;
  // How long to ring this step before failing over to the next one.
  seconds: number;
  // Display-only label (e.g. "Customer Service", "All Admins").
  label?: string;
}

export interface CallRoutingOption {
  option: string; // IVR key: "1" | "2" | "3" | "0"
  label?: string;
  enabled: boolean;
  steps: RoutingStep[];
}

// The four IVR keys, matching the (unchanged) greeting menu.
export const IVR_OPTIONS: { option: string; label: string }[] = [
  { option: "1", label: "Roofing Estimates / Scheduling" },
  { option: "2", label: "Current Customer" },
  { option: "3", label: "Billing" },
  { option: "0", label: "Operator" },
];

const MIN_SECONDS = 5;
const MAX_SECONDS = 120;

export function clampSeconds(value: number): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(value)));
}

// Normalize/validate arbitrary JSON (from DB or client) into safe steps.
export function normalizeSteps(raw: unknown): RoutingStep[] {
  if (!Array.isArray(raw)) return [];
  const steps: RoutingStep[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const type = rec.type === "number" ? "number" : rec.type === "ring_group" ? "ring_group" : null;
    if (!type) continue;
    const seconds = clampSeconds(Number(rec.seconds));
    if (type === "number") {
      const number = typeof rec.number === "string" ? rec.number.trim() : "";
      if (!number) continue;
      steps.push({ type, number, seconds, label: typeof rec.label === "string" ? rec.label : undefined });
    } else {
      steps.push({ type, seconds, label: typeof rec.label === "string" ? rec.label : undefined });
    }
  }
  return steps;
}
