// Shared types for the flexible Automation Engine.
// Rule/run shape is stored verbatim in Supabase JSONB, so extending these with
// new fields (or the trigger/condition/action unions) never needs a migration.

import type {
  WorkflowTrigger,
  WorkflowCondition,
  WorkflowAction,
} from "@/lib/workflow-engine";

export type { WorkflowTrigger, WorkflowCondition, WorkflowAction };

export type AutomationStatus = "active" | "paused";

export type AutomationRule = {
  id: string;
  name: string;
  description: string;
  trigger: WorkflowTrigger;
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
  /** Master ON/OFF switch. A rule only runs when enabled AND status === "active". */
  enabled: boolean;
  /** Softer temporary state, controlled by Pause/Resume. */
  status: AutomationStatus;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  lastTriggered?: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastFailedAt?: string;
  lastError?: string;
  triggerCount: number;
  successCount: number;
  failureCount: number;
};

export type AutomationRunStatus = "success" | "failed" | "skipped";

export type AutomationRun = {
  id: string;
  ruleId: string;
  ruleName: string;
  trigger: WorkflowTrigger;
  status: AutomationRunStatus;
  actionsExecuted: string[];
  error?: string;
  context: Record<string, string>;
  /** "trigger" (live event), "test" (Run Now), or "manual". */
  source: string;
  executedAt: string;
};

/** Runtime context passed to the engine when a trigger fires. */
export type AutomationContext = {
  trigger: WorkflowTrigger;
  jobId?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  address?: string;
  roofType?: string;
  proposalStatus?: string;
  jobStage?: string;
  daysSinceSent?: number;
  paymentAmount?: number;
  assignedCrew?: string;
  scheduleDate?: string;
  [key: string]: string | number | undefined;
};

export function newRuleId(): string {
  return `wf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function newRunId(): string {
  return `wfrun-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Fill {placeholders} in action params from the trigger context. */
export function resolveTemplate(value: string, ctx: AutomationContext): string {
  return value
    .replaceAll("{customerName}", String(ctx.customerName ?? ""))
    .replaceAll("{address}", String(ctx.address ?? ""))
    .replaceAll("{roofType}", String(ctx.roofType ?? ""))
    .replaceAll("{jobStage}", String(ctx.jobStage ?? ""))
    .replaceAll("{assignedCrew}", String(ctx.assignedCrew ?? ""))
    .replaceAll("{proposalStatus}", String(ctx.proposalStatus ?? ""));
}
