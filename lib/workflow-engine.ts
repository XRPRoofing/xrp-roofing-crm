// Workflow Engine — frontend-only automation rules stored in localStorage.
// Admins create rules via the UI: WHEN trigger → IF condition → THEN action.
// The engine is invoked by CRM pages when events fire.

export type WorkflowTrigger =
  | "job_created"
  | "job_status_changed"
  | "proposal_sent"
  | "proposal_signed"
  | "proposal_not_signed"
  | "invoice_sent"
  | "invoice_paid"
  | "calendar_event_moved"
  | "schedule_updated";

export type WorkflowConditionField =
  | "schedule_date_exists"
  | "proposal_status"
  | "job_stage"
  | "days_since_sent"
  | "payment_amount"
  | "assigned_crew"
  | "always";

export type WorkflowConditionOp = "equals" | "not_equals" | "greater_than" | "less_than" | "exists" | "not_exists";

export type WorkflowCondition = {
  field: WorkflowConditionField;
  operator: WorkflowConditionOp;
  value: string;
};

export type WorkflowActionType =
  | "move_job_to_stage"
  | "create_calendar_event"
  | "send_notification"
  | "log_activity"
  | "mark_invoice_paid"
  | "assign_crew";

export type WorkflowAction = {
  type: WorkflowActionType;
  params: Record<string, string>;
};

export type WorkflowRule = {
  id: string;
  name: string;
  description: string;
  trigger: WorkflowTrigger;
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastTriggered?: string;
  triggerCount: number;
};

export const WORKFLOW_STORAGE_KEY = "xrp-crm-workflow-rules";
export const WORKFLOW_LOG_KEY = "xrp-crm-workflow-log";

export type WorkflowLogEntry = {
  id: string;
  ruleId: string;
  ruleName: string;
  trigger: WorkflowTrigger;
  actionsExecuted: string[];
  context: Record<string, string>;
  executedAt: string;
};

// ── Trigger metadata ─────────────────────────────────────────────────────────

export const TRIGGER_META: Record<WorkflowTrigger, { label: string; description: string; icon: string }> = {
  job_created:           { label: "Job Created",             description: "When a new job is added to the system",        icon: "➕" },
  job_status_changed:    { label: "Job Status Changed",      description: "When a job moves to a different stage",         icon: "🔄" },
  proposal_sent:         { label: "Proposal Sent",           description: "When a proposal is sent to a customer",         icon: "📤" },
  proposal_signed:       { label: "Proposal Signed",         description: "When a customer signs/approves a proposal",     icon: "✍️" },
  proposal_not_signed:   { label: "Proposal Not Signed",     description: "When proposal hasn't been signed after X time", icon: "⏰" },
  invoice_sent:          { label: "Invoice Sent",            description: "When an invoice is sent to a customer",         icon: "📧" },
  invoice_paid:          { label: "Payment Received",        description: "When customer payment is received",             icon: "💰" },
  calendar_event_moved:  { label: "Calendar Event Moved",    description: "When a calendar event is dragged to new date",  icon: "📅" },
  schedule_updated:      { label: "Schedule Updated",        description: "When a job schedule is changed",                icon: "🗓️" },
};

export const CONDITION_FIELD_META: Record<WorkflowConditionField, { label: string }> = {
  schedule_date_exists: { label: "Schedule Date Exists" },
  proposal_status:      { label: "Proposal Status" },
  job_stage:            { label: "Job Stage" },
  days_since_sent:      { label: "Days Since Sent" },
  payment_amount:       { label: "Payment Amount" },
  assigned_crew:        { label: "Assigned Crew" },
  always:               { label: "Always (no condition)" },
};

export const ACTION_TYPE_META: Record<WorkflowActionType, { label: string; description: string; icon: string; paramFields: { key: string; label: string; type: "text" | "select"; options?: string[] }[] }> = {
  move_job_to_stage: {
    label: "Move Job to Stage",
    description: "Automatically move the job card to a specific stage",
    icon: "📋",
    paramFields: [{ key: "stage", label: "Target Stage", type: "select", options: ["new_lead", "inspection_scheduled", "inspection_complete", "proposal_created", "proposal_sent", "follow_up", "approved", "scheduled", "in_progress", "final_inspection", "completed", "paid"] }],
  },
  create_calendar_event: {
    label: "Create Calendar Event",
    description: "Add a new event to the CRM calendar",
    icon: "📅",
    paramFields: [{ key: "title", label: "Event Title", type: "text" }, { key: "duration", label: "Duration (hours)", type: "text" }],
  },
  send_notification: {
    label: "Send Notification",
    description: "Send a notification to the team or customer",
    icon: "🔔",
    paramFields: [{ key: "message", label: "Message", type: "text" }, { key: "recipient", label: "Recipient", type: "select", options: ["office", "assigned_crew", "customer"] }],
  },
  log_activity: {
    label: "Log Activity",
    description: "Add an entry to the job activity history",
    icon: "📝",
    paramFields: [{ key: "message", label: "Activity Message", type: "text" }],
  },
  mark_invoice_paid: {
    label: "Mark Invoice Paid",
    description: "Mark the linked invoice as paid",
    icon: "✅",
    paramFields: [],
  },
  assign_crew: {
    label: "Assign Crew",
    description: "Assign a crew member to the job",
    icon: "👷",
    paramFields: [{ key: "crew", label: "Crew / User", type: "text" }],
  },
};

// ── Pre-built Templates ──────────────────────────────────────────────────────

export const WORKFLOW_TEMPLATES: Omit<WorkflowRule, "id" | "createdAt" | "updatedAt" | "lastTriggered" | "triggerCount">[] = [
  {
    name: "Auto-Schedule to Calendar",
    description: "When a new job is created with a schedule date, automatically create a calendar event",
    trigger: "job_created",
    conditions: [{ field: "schedule_date_exists", operator: "exists", value: "" }],
    actions: [
      { type: "create_calendar_event", params: { title: "{roofType} — {customerName}", duration: "2" } },
      { type: "log_activity", params: { message: "Job automatically added to calendar" } },
    ],
    enabled: true,
  },
  {
    name: "Proposal Follow-Up (24h)",
    description: "When a proposal is not signed after 24 hours, move job to Follow Up and notify office",
    trigger: "proposal_not_signed",
    conditions: [{ field: "days_since_sent", operator: "greater_than", value: "1" }],
    actions: [
      { type: "move_job_to_stage", params: { stage: "follow_up" } },
      { type: "send_notification", params: { message: "Proposal not signed after 24h — moved to Follow Up", recipient: "office" } },
      { type: "log_activity", params: { message: "Auto-moved to Follow Up — proposal unsigned after 24h" } },
    ],
    enabled: true,
  },
  {
    name: "Proposal Signed → Approved",
    description: "When a customer signs a proposal, move the job to Approved/Won and notify office",
    trigger: "proposal_signed",
    conditions: [{ field: "always", operator: "exists", value: "" }],
    actions: [
      { type: "move_job_to_stage", params: { stage: "approved" } },
      { type: "send_notification", params: { message: "Proposal signed! Job moved to Approved.", recipient: "office" } },
      { type: "log_activity", params: { message: "Job auto-moved to Approved — proposal signed by customer" } },
    ],
    enabled: true,
  },
  {
    name: "Calendar Drag → Update Job",
    description: "When an event is dragged on the calendar, update the job schedule automatically",
    trigger: "calendar_event_moved",
    conditions: [{ field: "always", operator: "exists", value: "" }],
    actions: [
      { type: "log_activity", params: { message: "Schedule updated via calendar drag" } },
      { type: "send_notification", params: { message: "Job schedule updated — calendar synced", recipient: "assigned_crew" } },
    ],
    enabled: true,
  },
  {
    name: "Invoice Sent → Update Status",
    description: "When an invoice is sent, mark the job as Invoice Sent",
    trigger: "invoice_sent",
    conditions: [{ field: "always", operator: "exists", value: "" }],
    actions: [
      { type: "log_activity", params: { message: "Invoice sent — job status updated" } },
    ],
    enabled: true,
  },
  {
    name: "Payment Received → Mark Paid",
    description: "When payment is received, move job to Paid and mark invoice as paid",
    trigger: "invoice_paid",
    conditions: [{ field: "always", operator: "exists", value: "" }],
    actions: [
      { type: "move_job_to_stage", params: { stage: "paid" } },
      { type: "mark_invoice_paid", params: {} },
      { type: "log_activity", params: { message: "Payment received — job and invoice marked as Paid" } },
    ],
    enabled: true,
  },
  {
    name: "Missed Proposal (3 days)",
    description: "When a proposal is not signed after 3 days, move to Follow Up and send reminder",
    trigger: "proposal_not_signed",
    conditions: [{ field: "days_since_sent", operator: "greater_than", value: "3" }],
    actions: [
      { type: "move_job_to_stage", params: { stage: "follow_up" } },
      { type: "send_notification", params: { message: "Proposal unsigned after 3 days — follow up needed", recipient: "office" } },
      { type: "log_activity", params: { message: "Auto-moved to Follow Up — proposal unsigned after 3 days" } },
    ],
    enabled: false,
  },
];

// ── Storage helpers ──────────────────────────────────────────────────────────

export function readWorkflowRules(): WorkflowRule[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(WORKFLOW_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as WorkflowRule[];
  } catch {
    return [];
  }
}

export function saveWorkflowRules(rules: WorkflowRule[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(rules));
  window.dispatchEvent(new Event("crm-workflow-rules-updated"));
}

export function addWorkflowRule(rule: Omit<WorkflowRule, "id" | "createdAt" | "updatedAt" | "triggerCount">): WorkflowRule {
  const now = new Date().toISOString();
  const newRule: WorkflowRule = {
    ...rule,
    id: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: now,
    updatedAt: now,
    triggerCount: 0,
  };
  const rules = readWorkflowRules();
  saveWorkflowRules([newRule, ...rules]);
  return newRule;
}

export function updateWorkflowRule(id: string, patch: Partial<WorkflowRule>): void {
  const rules = readWorkflowRules();
  const updated = rules.map((r) => r.id === id ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r);
  saveWorkflowRules(updated);
}

export function deleteWorkflowRule(id: string): void {
  const rules = readWorkflowRules();
  saveWorkflowRules(rules.filter((r) => r.id !== id));
}

export function toggleWorkflowRule(id: string, enabled: boolean): void {
  updateWorkflowRule(id, { enabled });
}

// ── Workflow Log ─────────────────────────────────────────────────────────────

export function readWorkflowLog(): WorkflowLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(WORKFLOW_LOG_KEY) || "[]") as WorkflowLogEntry[];
  } catch {
    return [];
  }
}

export function appendWorkflowLog(entry: Omit<WorkflowLogEntry, "id" | "executedAt">): void {
  if (typeof window === "undefined") return;
  const log = readWorkflowLog();
  const next: WorkflowLogEntry = {
    ...entry,
    id: `wflog-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    executedAt: new Date().toISOString(),
  };
  const trimmed = [next, ...log].slice(0, 500);
  window.localStorage.setItem(WORKFLOW_LOG_KEY, JSON.stringify(trimmed));
  window.dispatchEvent(new Event("crm-workflow-log-updated"));
}

// ── Seed default templates ───────────────────────────────────────────────────

export function seedDefaultWorkflows(): void {
  const existing = readWorkflowRules();
  if (existing.length > 0) return;
  const now = new Date().toISOString();
  const seeded: WorkflowRule[] = WORKFLOW_TEMPLATES.map((t, i) => ({
    ...t,
    id: `wf-seed-${i}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: now,
    updatedAt: now,
    triggerCount: 0,
  }));
  saveWorkflowRules(seeded);
}

// ── Execution engine ─────────────────────────────────────────────────────────

export type WorkflowContext = {
  trigger: WorkflowTrigger;
  jobId?: string;
  customerName?: string;
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

function evaluateCondition(condition: WorkflowCondition, context: WorkflowContext): boolean {
  if (condition.field === "always") return true;

  if (condition.field === "schedule_date_exists") {
    const exists = !!context.scheduleDate;
    return condition.operator === "exists" ? exists : !exists;
  }

  if (condition.field === "days_since_sent") {
    const days = context.daysSinceSent ?? 0;
    const target = Number(condition.value) || 0;
    if (condition.operator === "greater_than") return days > target;
    if (condition.operator === "less_than") return days < target;
    if (condition.operator === "equals") return days === target;
    return true;
  }

  if (condition.field === "proposal_status") {
    const val = context.proposalStatus || "";
    if (condition.operator === "equals") return val === condition.value;
    if (condition.operator === "not_equals") return val !== condition.value;
    return !!val;
  }

  if (condition.field === "job_stage") {
    const val = context.jobStage || "";
    if (condition.operator === "equals") return val === condition.value;
    if (condition.operator === "not_equals") return val !== condition.value;
    return !!val;
  }

  if (condition.field === "payment_amount") {
    const amt = context.paymentAmount ?? 0;
    const target = Number(condition.value) || 0;
    if (condition.operator === "greater_than") return amt > target;
    if (condition.operator === "less_than") return amt < target;
    if (condition.operator === "equals") return amt === target;
    return true;
  }

  if (condition.field === "assigned_crew") {
    const val = context.assignedCrew || "";
    if (condition.operator === "exists") return !!val;
    if (condition.operator === "not_exists") return !val;
    if (condition.operator === "equals") return val === condition.value;
    return true;
  }

  return true;
}

export function executeWorkflows(
  context: WorkflowContext,
  callbacks?: {
    moveJobToStage?: (jobId: string, stage: string) => void;
    createCalendarEvent?: (title: string, duration: string) => void;
    sendNotification?: (message: string, recipient: string) => void;
    logActivity?: (message: string) => void;
    markInvoicePaid?: () => void;
    assignCrew?: (crew: string) => void;
  },
): WorkflowLogEntry[] {
  const rules = readWorkflowRules();
  const matchingRules = rules.filter((r) => r.enabled && r.trigger === context.trigger);
  const logs: WorkflowLogEntry[] = [];

  for (const rule of matchingRules) {
    const allConditionsMet = rule.conditions.every((c) => evaluateCondition(c, context));
    if (!allConditionsMet) continue;

    const actionsExecuted: string[] = [];

    for (const action of rule.actions) {
      const resolvedParams: Record<string, string> = {};
      for (const [k, v] of Object.entries(action.params)) {
        resolvedParams[k] = v
          .replace("{customerName}", context.customerName || "")
          .replace("{address}", context.address || "")
          .replace("{roofType}", context.roofType || "")
          .replace("{jobStage}", context.jobStage || "")
          .replace("{assignedCrew}", context.assignedCrew || "");
      }

      switch (action.type) {
        case "move_job_to_stage":
          if (callbacks?.moveJobToStage && context.jobId) {
            callbacks.moveJobToStage(context.jobId, resolvedParams.stage || "");
          }
          actionsExecuted.push(`Moved job to ${resolvedParams.stage}`);
          break;
        case "create_calendar_event":
          if (callbacks?.createCalendarEvent) {
            callbacks.createCalendarEvent(resolvedParams.title || "", resolvedParams.duration || "2");
          }
          actionsExecuted.push("Created calendar event");
          break;
        case "send_notification":
          if (callbacks?.sendNotification) {
            callbacks.sendNotification(resolvedParams.message || "", resolvedParams.recipient || "office");
          }
          actionsExecuted.push(`Notification → ${resolvedParams.recipient}`);
          break;
        case "log_activity":
          if (callbacks?.logActivity) {
            callbacks.logActivity(resolvedParams.message || "Workflow action executed");
          }
          actionsExecuted.push("Logged activity");
          break;
        case "mark_invoice_paid":
          if (callbacks?.markInvoicePaid) {
            callbacks.markInvoicePaid();
          }
          actionsExecuted.push("Marked invoice paid");
          break;
        case "assign_crew":
          if (callbacks?.assignCrew) {
            callbacks.assignCrew(resolvedParams.crew || "");
          }
          actionsExecuted.push(`Assigned crew: ${resolvedParams.crew}`);
          break;
      }
    }

    // Update trigger count
    updateWorkflowRule(rule.id, { lastTriggered: new Date().toISOString(), triggerCount: rule.triggerCount + 1 });

    // Log execution
    const logEntry: Omit<WorkflowLogEntry, "id" | "executedAt"> = {
      ruleId: rule.id,
      ruleName: rule.name,
      trigger: context.trigger,
      actionsExecuted,
      context: Object.fromEntries(Object.entries(context).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])),
    };
    appendWorkflowLog(logEntry);
    logs.push({ ...logEntry, id: "", executedAt: new Date().toISOString() });
  }

  return logs;
}
