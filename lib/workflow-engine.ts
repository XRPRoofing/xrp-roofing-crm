// Workflow Engine — frontend-only automation rules stored in localStorage.
// Admins create rules via the UI: WHEN trigger → IF condition → THEN action.
// The engine is invoked by CRM pages when events fire.

export type WorkflowTrigger =
  // Jobs
  | "job_created"
  | "job_scheduled"
  | "job_status_changed"
  | "job_completed"
  // Proposals
  | "proposal_created"
  | "proposal_sent"
  | "proposal_viewed"
  | "proposal_signed"
  | "proposal_not_signed"
  | "proposal_expired"
  // Invoices
  | "invoice_created"
  | "invoice_sent"
  | "invoice_viewed"
  | "invoice_paid"
  | "invoice_overdue"
  // Calls
  | "call_missed"
  | "call_incoming"
  | "call_completed"
  | "voicemail_received"
  // Messages
  | "sms_sent"
  | "sms_received"
  | "no_reply"
  // Customers
  | "customer_added"
  | "customer_no_response"
  // Calendar
  | "calendar_event_moved"
  | "schedule_updated"
  | "appointment_created"
  // Files
  | "photos_uploaded"
  | "video_uploaded"
  // Estimates
  | "estimate_sent"
  | "estimate_created";

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
  | "send_sms"
  | "send_email"
  | "log_activity"
  | "mark_invoice_paid"
  | "assign_crew"
  | "create_reminder"
  | "notify_admin";

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

export type TriggerCategory = "Jobs" | "Proposals" | "Invoices" | "Calls" | "Messages" | "Customers" | "Calendar" | "Files" | "Estimates";

export const TRIGGER_META: Record<WorkflowTrigger, { label: string; description: string; icon: string; category: TriggerCategory }> = {
  // Jobs
  job_created:           { label: "Job Created",             description: "When a new job is added to the system",               icon: "➕", category: "Jobs" },
  job_scheduled:         { label: "Job Scheduled",           description: "When a job gets a scheduled date/time",               icon: "📅", category: "Jobs" },
  job_status_changed:    { label: "Job Status Changed",      description: "When a job moves to a different stage",               icon: "🔄", category: "Jobs" },
  job_completed:         { label: "Job Completed",           description: "When a job is marked as completed",                   icon: "✅", category: "Jobs" },
  // Proposals
  proposal_created:      { label: "Proposal Created",        description: "When a new proposal is created",                      icon: "📋", category: "Proposals" },
  proposal_sent:         { label: "Proposal Sent",           description: "When a proposal is sent to a customer",               icon: "📤", category: "Proposals" },
  proposal_viewed:       { label: "Proposal Viewed",         description: "When a customer views the proposal",                  icon: "👁️", category: "Proposals" },
  proposal_signed:       { label: "Proposal Signed",         description: "When a customer signs/approves a proposal",           icon: "✍️", category: "Proposals" },
  proposal_not_signed:   { label: "Proposal Not Signed",     description: "When proposal hasn't been signed after X time",       icon: "⏰", category: "Proposals" },
  proposal_expired:      { label: "Proposal Expired",        description: "When a proposal passes its expiration date",          icon: "❌", category: "Proposals" },
  // Invoices
  invoice_created:       { label: "Invoice Created",         description: "When a new invoice is generated",                     icon: "🧾", category: "Invoices" },
  invoice_sent:          { label: "Invoice Sent",            description: "When an invoice is sent to a customer",               icon: "📧", category: "Invoices" },
  invoice_viewed:        { label: "Invoice Viewed",          description: "When a customer opens the invoice link",              icon: "👁️", category: "Invoices" },
  invoice_paid:          { label: "Payment Received",        description: "When customer payment is received",                   icon: "💰", category: "Invoices" },
  invoice_overdue:       { label: "Invoice Overdue",         description: "When an invoice passes its due date unpaid",          icon: "🚨", category: "Invoices" },
  // Calls
  call_missed:           { label: "Missed Call",             description: "When an incoming call is missed",                     icon: "📵", category: "Calls" },
  call_incoming:         { label: "Incoming Call",           description: "When a new call comes in",                            icon: "📞", category: "Calls" },
  call_completed:        { label: "Call Completed",          description: "When a call ends",                                    icon: "☎️", category: "Calls" },
  voicemail_received:    { label: "Voicemail Received",      description: "When a voicemail is left",                            icon: "🎤", category: "Calls" },
  // Messages
  sms_sent:              { label: "SMS Sent",                description: "When an SMS is sent to a customer",                   icon: "💬", category: "Messages" },
  sms_received:          { label: "SMS Received",            description: "When a customer sends an SMS",                        icon: "📩", category: "Messages" },
  no_reply:              { label: "No Reply",                description: "When a customer doesn't respond after X hours",       icon: "🔕", category: "Messages" },
  // Customers
  customer_added:        { label: "New Customer Added",      description: "When a new customer is created in the CRM",           icon: "👤", category: "Customers" },
  customer_no_response:  { label: "Customer No Response",    description: "When a customer hasn't responded for X days",         icon: "😶", category: "Customers" },
  // Calendar
  calendar_event_moved:  { label: "Calendar Event Moved",    description: "When a calendar event is dragged to a new date",      icon: "📅", category: "Calendar" },
  schedule_updated:      { label: "Schedule Updated",        description: "When a job schedule date/time is changed",            icon: "🗓️", category: "Calendar" },
  appointment_created:   { label: "Appointment Created",     description: "When a new appointment is added to the calendar",     icon: "📆", category: "Calendar" },
  // Files
  photos_uploaded:       { label: "Photos Uploaded",         description: "When photos are uploaded to a job",                   icon: "📷", category: "Files" },
  video_uploaded:        { label: "Video Uploaded",          description: "When a video is uploaded to a job",                   icon: "🎥", category: "Files" },
  // Estimates
  estimate_sent:         { label: "Estimate Sent",           description: "When an estimate is sent to a customer",              icon: "📨", category: "Estimates" },
  estimate_created:      { label: "Estimate Created",        description: "When a new estimate is created",                      icon: "📝", category: "Estimates" },
};

export const TRIGGER_CATEGORIES: TriggerCategory[] = ["Jobs", "Proposals", "Invoices", "Calls", "Messages", "Customers", "Calendar", "Files", "Estimates"];

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
    description: "Send an in-app notification to the team",
    icon: "🔔",
    paramFields: [{ key: "message", label: "Message", type: "text" }, { key: "recipient", label: "Recipient", type: "select", options: ["office", "assigned_crew", "all_admins"] }],
  },
  send_sms: {
    label: "Send SMS",
    description: "Send an automatic SMS to customer or team",
    icon: "💬",
    paramFields: [{ key: "message", label: "SMS Message", type: "text" }, { key: "recipient", label: "Recipient", type: "select", options: ["customer", "office", "assigned_crew"] }],
  },
  send_email: {
    label: "Send Email",
    description: "Send an automatic email",
    icon: "📧",
    paramFields: [{ key: "subject", label: "Subject", type: "text" }, { key: "message", label: "Body", type: "text" }, { key: "recipient", label: "Recipient", type: "select", options: ["customer", "office", "assigned_crew"] }],
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
  create_reminder: {
    label: "Create Reminder",
    description: "Create a follow-up reminder after X hours",
    icon: "⏰",
    paramFields: [{ key: "message", label: "Reminder Message", type: "text" }, { key: "delay_hours", label: "Delay (hours)", type: "text" }],
  },
  notify_admin: {
    label: "Notify Admin",
    description: "Send an urgent notification to all admins",
    icon: "🚨",
    paramFields: [{ key: "message", label: "Alert Message", type: "text" }],
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
  {
    name: "Missed Call → Auto Text",
    description: "When a call is missed, automatically send an SMS to the customer",
    trigger: "call_missed",
    conditions: [{ field: "always", operator: "exists", value: "" }],
    actions: [
      { type: "send_sms", params: { message: "Hi {customerName}, we missed your call. We'll call you back shortly! — XRP Roofing", recipient: "customer" } },
      { type: "log_activity", params: { message: "Missed call — auto-text sent to customer" } },
    ],
    enabled: true,
  },
  {
    name: "Inspection Reminder",
    description: "When a job is scheduled, create a calendar event and notify crew",
    trigger: "job_scheduled",
    conditions: [{ field: "always", operator: "exists", value: "" }],
    actions: [
      { type: "create_calendar_event", params: { title: "Inspection — {customerName}", duration: "1" } },
      { type: "send_notification", params: { message: "New job scheduled: {customerName} at {address}", recipient: "assigned_crew" } },
    ],
    enabled: true,
  },
  {
    name: "Invoice Overdue Reminder",
    description: "When an invoice becomes overdue, notify the office and log it",
    trigger: "invoice_overdue",
    conditions: [{ field: "always", operator: "exists", value: "" }],
    actions: [
      { type: "notify_admin", params: { message: "Invoice overdue for {customerName}" } },
      { type: "create_reminder", params: { message: "Follow up on overdue invoice", delay_hours: "24" } },
      { type: "log_activity", params: { message: "Invoice overdue — reminder created" } },
    ],
    enabled: true,
  },
  {
    name: "Photos Uploaded → Notify Admin",
    description: "When crew uploads photos, notify the admin team",
    trigger: "photos_uploaded",
    conditions: [{ field: "always", operator: "exists", value: "" }],
    actions: [
      { type: "notify_admin", params: { message: "New photos uploaded for {customerName}" } },
      { type: "log_activity", params: { message: "Photos uploaded by crew" } },
    ],
    enabled: false,
  },
  {
    name: "No Reply 48h → Follow Up",
    description: "When a customer doesn't respond for 48 hours, move to Follow Up",
    trigger: "customer_no_response",
    conditions: [{ field: "days_since_sent", operator: "greater_than", value: "2" }],
    actions: [
      { type: "move_job_to_stage", params: { stage: "follow_up" } },
      { type: "send_notification", params: { message: "No customer response after 48h — moved to Follow Up", recipient: "office" } },
      { type: "log_activity", params: { message: "Auto-moved to Follow Up — no response after 48h" } },
    ],
    enabled: true,
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
    sendSms?: (message: string, recipient: string) => void;
    sendEmail?: (subject: string, message: string, recipient: string) => void;
    logActivity?: (message: string) => void;
    markInvoicePaid?: () => void;
    assignCrew?: (crew: string) => void;
    createReminder?: (message: string, delayHours: string) => void;
    notifyAdmin?: (message: string) => void;
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
        case "send_sms":
          if (callbacks?.sendSms) {
            callbacks.sendSms(resolvedParams.message || "", resolvedParams.recipient || "customer");
          }
          actionsExecuted.push(`SMS → ${resolvedParams.recipient}`);
          break;
        case "send_email":
          if (callbacks?.sendEmail) {
            callbacks.sendEmail(resolvedParams.subject || "", resolvedParams.message || "", resolvedParams.recipient || "customer");
          }
          actionsExecuted.push(`Email → ${resolvedParams.recipient}`);
          break;
        case "create_reminder":
          if (callbacks?.createReminder) {
            callbacks.createReminder(resolvedParams.message || "", resolvedParams.delay_hours || "24");
          }
          actionsExecuted.push(`Reminder in ${resolvedParams.delay_hours || "24"}h`);
          break;
        case "notify_admin":
          if (callbacks?.notifyAdmin) {
            callbacks.notifyAdmin(resolvedParams.message || "");
          }
          actionsExecuted.push("Admin notified");
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
