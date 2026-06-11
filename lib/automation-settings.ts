// Automation settings — types, defaults, and localStorage persistence.
// All automations are opt-in. Each toggle can be enabled/disabled independently
// and timing/template values are editable from the Automations page.

export type AutomationTiming = "same_day" | "2h_before" | "24h_before" | "48h_before" | "on_event";

export type AutomationRecord = {
  id: string;
  enabled: boolean;
  channels: { email: boolean; sms: boolean };
  timing: AutomationTiming;
  template: string;
  lastTriggered?: string;
};

export type AutomationSettings = {
  // Customer Reminders
  inspectionDayReminder: AutomationRecord;
  installationDayReminder: AutomationRecord;
  unpaidInvoiceReminder: AutomationRecord;
  proposalFollowUp: AutomationRecord;
  // Review Requests
  reviewRequestAfterCompletion: AutomationRecord;
  // Internal Team Notifications
  notifyNewLead: AutomationRecord;
  notifyInspectionScheduled: AutomationRecord;
  notifyAppointmentRescheduled: AutomationRecord;
  notifyProposalViewed: AutomationRecord;
  notifyProposalSigned: AutomationRecord;
  notifyInvoicePaid: AutomationRecord;
  notifyJobStatusChanged: AutomationRecord;
  notifyCustomerReply: AutomationRecord;
  notifyReviewSubmitted: AutomationRecord;
  // Calendar & Scheduling
  customerAppointmentReminder: AutomationRecord;
  staffAppointmentReminder: AutomationRecord;
  dailyScheduleSummary: AutomationRecord;
  weeklyScheduleSummary: AutomationRecord;
};

export type AutomationId = keyof AutomationSettings;

export const AUTOMATION_STORAGE_KEY = "xrp-crm-automation-settings";
export const AUTOMATION_LOG_KEY = "xrp-crm-automation-log";

export type AutomationLogEntry = {
  id: string;
  automationId: AutomationId;
  automationLabel: string;
  recipientName: string;
  recipientEmail?: string;
  recipientPhone?: string;
  channels: string[];
  status: "sent" | "failed" | "skipped";
  detail?: string;
  triggeredAt: string;
};

function makeRecord(
  id: string,
  template: string,
  timing: AutomationTiming = "on_event",
  enabledByDefault = false,
): AutomationRecord {
  return { id, enabled: enabledByDefault, channels: { email: true, sms: false }, timing, template };
}

export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  inspectionDayReminder: makeRecord(
    "inspectionDayReminder",
    "Hi {customerName}, this is a reminder that your roof inspection is scheduled for today at {time}. Our team will arrive at {address}. Call us at (602) 555-0100 with any questions.",
    "same_day",
  ),
  installationDayReminder: makeRecord(
    "installationDayReminder",
    "Hi {customerName}, your roof installation is scheduled for today. Our crew will arrive at {address} around {time}. Thank you for choosing XRP Roofing!",
    "same_day",
  ),
  unpaidInvoiceReminder: makeRecord(
    "unpaidInvoiceReminder",
    "Hi {customerName}, this is a friendly reminder that invoice #{invoiceNumber} for {amount} is due. Please pay at: {paymentLink}. Contact us if you have questions.",
    "24h_before",
  ),
  proposalFollowUp: makeRecord(
    "proposalFollowUp",
    "Hi {customerName}, we wanted to follow up on the proposal we sent you. We'd love to answer any questions. Reply to this message or call us at (602) 555-0100.",
    "48h_before",
  ),
  reviewRequestAfterCompletion: makeRecord(
    "reviewRequestAfterCompletion",
    "Hi {customerName}, thank you for choosing XRP Roofing! We'd love to hear about your experience. Please leave us a Google review: {reviewLink}",
    "on_event",
    true,
  ),
  notifyNewLead: makeRecord("notifyNewLead", "New lead created: {customerName} — {phone} — {address}. Stage: New Lead.", "on_event", true),
  notifyInspectionScheduled: makeRecord("notifyInspectionScheduled", "Inspection scheduled for {customerName} at {address} on {date}.", "on_event", true),
  notifyAppointmentRescheduled: makeRecord("notifyAppointmentRescheduled", "Appointment rescheduled for {customerName} at {address}. New time: {date}.", "on_event", true),
  notifyProposalViewed: makeRecord("notifyProposalViewed", "Proposal viewed by {customerName} ({email}). Proposal: {proposalId}.", "on_event", true),
  notifyProposalSigned: makeRecord("notifyProposalSigned", "Proposal signed by {customerName}! Proposal: {proposalId}. Ready to schedule install.", "on_event", true),
  notifyInvoicePaid: makeRecord("notifyInvoicePaid", "Invoice #{invoiceNumber} paid by {customerName}. Amount: {amount}.", "on_event", true),
  notifyJobStatusChanged: makeRecord("notifyJobStatusChanged", "Job status updated: {customerName} — {address} moved to {status}.", "on_event", true),
  notifyCustomerReply: makeRecord("notifyCustomerReply", "Customer reply from {customerName} ({phone}): {messagePreview}", "on_event", true),
  notifyReviewSubmitted: makeRecord("notifyReviewSubmitted", "New review submitted by {customerName}. Check Google Business Profile.", "on_event", true),
  customerAppointmentReminder: makeRecord("customerAppointmentReminder", "Hi {customerName}, reminder: you have an appointment with XRP Roofing on {date} at {time} at {address}.", "24h_before"),
  staffAppointmentReminder: makeRecord("staffAppointmentReminder", "Team reminder: {appointmentTitle} for {customerName} at {address} on {date} at {time}. Assigned: {assignedTo}.", "2h_before"),
  dailyScheduleSummary: makeRecord("dailyScheduleSummary", "Good morning! Here is your XRP Roofing schedule for today ({date}):\n{scheduleList}", "same_day"),
  weeklyScheduleSummary: makeRecord("weeklyScheduleSummary", "Good morning! Here is your XRP Roofing schedule for the week of {weekStart}:\n{scheduleList}", "same_day"),
};

export const AUTOMATION_META: Record<AutomationId, { label: string; description: string; group: string; icon: string }> = {
  inspectionDayReminder:         { label: "Inspection Day Reminder",       description: "Send customer a reminder on the day of their roof inspection.",            group: "Customer Reminders",          icon: "🔔" },
  installationDayReminder:       { label: "Installation Day Reminder",     description: "Notify customer on the day their roof installation is scheduled.",          group: "Customer Reminders",          icon: "🏠" },
  unpaidInvoiceReminder:         { label: "Unpaid Invoice Reminder",       description: "Remind customers about outstanding invoices before or after due date.",      group: "Customer Reminders",          icon: "💰" },
  proposalFollowUp:              { label: "Proposal Follow-Up",            description: "Follow up with customers who haven't responded to a sent proposal.",         group: "Customer Reminders",          icon: "📋" },
  reviewRequestAfterCompletion:  { label: "Review Request After Job",      description: "Automatically request a Google review when a job is marked completed.",     group: "Review Requests",             icon: "⭐" },
  notifyNewLead:                 { label: "New Lead Created",              description: "Notify the team when a new lead enters the CRM.",                            group: "Internal Notifications",      icon: "👤" },
  notifyInspectionScheduled:     { label: "Inspection Scheduled",          description: "Alert team when an inspection is booked.",                                   group: "Internal Notifications",      icon: "📅" },
  notifyAppointmentRescheduled:  { label: "Appointment Rescheduled",       description: "Notify team when an appointment is moved to a new time.",                    group: "Internal Notifications",      icon: "🔄" },
  notifyProposalViewed:          { label: "Proposal Viewed",               description: "Alert team when a customer opens and views a proposal.",                     group: "Internal Notifications",      icon: "👁️" },
  notifyProposalSigned:          { label: "Proposal Signed",               description: "Notify team immediately when a customer signs a proposal.",                  group: "Internal Notifications",      icon: "✍️" },
  notifyInvoicePaid:             { label: "Invoice Paid",                  description: "Alert team when a customer completes payment on an invoice.",                group: "Internal Notifications",      icon: "✅" },
  notifyJobStatusChanged:        { label: "Job Status Changed",            description: "Notify team when any job moves to a new stage.",                             group: "Internal Notifications",      icon: "🔧" },
  notifyCustomerReply:           { label: "Customer Reply",                description: "Alert team when a customer responds to an email or SMS.",                    group: "Internal Notifications",      icon: "💬" },
  notifyReviewSubmitted:         { label: "Review Submitted",              description: "Notify team when a customer submits a new Google review.",                   group: "Internal Notifications",      icon: "🌟" },
  customerAppointmentReminder:   { label: "Customer Appointment Reminder", description: "Send customers a reminder before their scheduled appointment.",              group: "Calendar & Scheduling",       icon: "📆" },
  staffAppointmentReminder:      { label: "Staff Appointment Reminder",    description: "Remind assigned team members about upcoming appointments.",                  group: "Calendar & Scheduling",       icon: "👷" },
  dailyScheduleSummary:          { label: "Daily Schedule Summary",        description: "Email the team a summary of today's appointments every morning.",            group: "Calendar & Scheduling",       icon: "☀️" },
  weeklyScheduleSummary:         { label: "Weekly Schedule Summary",       description: "Email the team a full week overview every Monday morning.",                  group: "Calendar & Scheduling",       icon: "📊" },
};

export const AUTOMATION_GROUPS = ["Customer Reminders", "Review Requests", "Internal Notifications", "Calendar & Scheduling"] as const;

export const TIMING_LABELS: Record<AutomationTiming, string> = {
  on_event:   "Immediately on event",
  same_day:   "Same day (morning)",
  "2h_before":  "2 hours before",
  "24h_before": "24 hours before",
  "48h_before": "48 hours before",
};

// ── Storage helpers ──────────────────────────────────────────────────────────

export function readAutomationSettings(): AutomationSettings {
  if (typeof window === "undefined") return DEFAULT_AUTOMATION_SETTINGS;
  try {
    const raw = window.localStorage.getItem(AUTOMATION_STORAGE_KEY);
    if (!raw) return DEFAULT_AUTOMATION_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AutomationSettings>;
    // Merge with defaults so new automations added in code are always present
    const merged = { ...DEFAULT_AUTOMATION_SETTINGS };
    for (const key of Object.keys(DEFAULT_AUTOMATION_SETTINGS) as AutomationId[]) {
      if (parsed[key]) merged[key] = { ...DEFAULT_AUTOMATION_SETTINGS[key], ...parsed[key] };
    }
    return merged;
  } catch {
    return DEFAULT_AUTOMATION_SETTINGS;
  }
}

export function saveAutomationSettings(settings: AutomationSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTOMATION_STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(new Event("crm-automation-settings-updated"));
}

export function updateAutomation(id: AutomationId, patch: Partial<AutomationRecord>): AutomationSettings {
  const current = readAutomationSettings();
  const next = { ...current, [id]: { ...current[id], ...patch } };
  saveAutomationSettings(next);
  return next;
}

// ── Log helpers ──────────────────────────────────────────────────────────────

export function readAutomationLog(): AutomationLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(AUTOMATION_LOG_KEY) || "[]") as AutomationLogEntry[];
  } catch {
    return [];
  }
}

export function appendAutomationLog(entry: Omit<AutomationLogEntry, "id" | "triggeredAt">): void {
  if (typeof window === "undefined") return;
  const log = readAutomationLog();
  const next: AutomationLogEntry = {
    ...entry,
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    triggeredAt: new Date().toISOString(),
  };
  const trimmed = [next, ...log].slice(0, 200);
  window.localStorage.setItem(AUTOMATION_LOG_KEY, JSON.stringify(trimmed));
  window.dispatchEvent(new Event("crm-automation-log-updated"));
}
