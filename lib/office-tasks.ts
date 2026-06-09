import type { CrewJob } from "@/lib/crew-workflow";

export type OfficeTaskStatus =
  | "Job Scheduled"
  | "Job In Progress"
  | "Job Completed"
  | "For Invoice"
  | "Invoice Sent"
  | "Invoice Follow Up"
  | "Paid"
  | "Customer Satisfaction"
  | "Review Request"
  | "Review Received"
  | "Closed";

export type TaskTimelineEntry = {
  id: string;
  event: string;
  note?: string;
  at: string;
  by?: string;
};

export type OfficeTask = {
  id: string;
  jobId: string;
  title: string;
  customerName: string;
  jobAddress: string;
  invoiceAmount: string;
  invoiceNumber?: string;
  invoiceStatus?: string;
  assignedUser: string;
  dueDate: string;
  status: OfficeTaskStatus;
  jobLink: string;
  createdAt: string;
  updatedAt: string;
  // Customer satisfaction
  satisfactionChecked?: boolean;
  satisfactionResult?: "yes" | "no";
  satisfactionNotes?: string;
  satisfactionAt?: string;
  // Review tracking
  reviewRequestSentAt?: string;
  reviewSmsSent?: boolean;
  reviewEmailSent?: boolean;
  reviewLinkClicked?: boolean;
  reviewSubmitted?: boolean;
  reviewReceivedAt?: string;
  // Activity timeline
  timeline?: TaskTimelineEntry[];
};

export const officeTaskStorageKey = "xrp-crm-office-tasks";

export const officeTaskStatuses: OfficeTaskStatus[] = [
  "Job Scheduled",
  "Job In Progress",
  "Job Completed",
  "For Invoice",
  "Invoice Sent",
  "Invoice Follow Up",
  "Paid",
  "Customer Satisfaction",
  "Review Request",
  "Review Received",
  "Closed",
];

export const officeTaskStatusColors: Record<OfficeTaskStatus, { bg: string; text: string; border: string; dot: string }> = {
  "Job Scheduled":       { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200",    dot: "bg-blue-500" },
  "Job In Progress":     { bg: "bg-orange-50",  text: "text-orange-700",  border: "border-orange-200",  dot: "bg-orange-500" },
  "Job Completed":       { bg: "bg-purple-50",  text: "text-purple-700",  border: "border-purple-200",  dot: "bg-purple-500" },
  "For Invoice":         { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200",   dot: "bg-amber-500" },
  "Invoice Sent":        { bg: "bg-sky-50",     text: "text-sky-700",     border: "border-sky-200",     dot: "bg-sky-500" },
  "Invoice Follow Up":   { bg: "bg-yellow-50",  text: "text-yellow-700",  border: "border-yellow-200",  dot: "bg-yellow-500" },
  "Paid":                { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-500" },
  "Customer Satisfaction": { bg: "bg-teal-50",  text: "text-teal-700",    border: "border-teal-200",    dot: "bg-teal-500" },
  "Review Request":      { bg: "bg-indigo-50",  text: "text-indigo-700",  border: "border-indigo-200",  dot: "bg-indigo-500" },
  "Review Received":     { bg: "bg-green-50",   text: "text-green-700",   border: "border-green-200",   dot: "bg-green-600" },
  "Closed":              { bg: "bg-slate-100",  text: "text-slate-600",   border: "border-slate-200",   dot: "bg-slate-400" },
};

export function readOfficeTasks(): OfficeTask[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(officeTaskStorageKey) || "[]") as OfficeTask[];
  } catch {
    return [];
  }
}

export function saveOfficeTasks(tasks: OfficeTask[]) {
  window.localStorage.setItem(officeTaskStorageKey, JSON.stringify(tasks));
  window.dispatchEvent(new Event("crm-office-tasks-updated"));
  // Fire-and-forget Supabase sync so all devices update in real time
  if (typeof window !== "undefined") {
    import("@/lib/task-sync").then(({ saveAllTasksToSupabase }) => {
      void saveAllTasksToSupabase(tasks);
    }).catch(() => {});
  }
}

function formatJobAddress(parts: { address?: string; city?: string }) {
  return [parts.address, parts.city, "AZ"].filter(Boolean).join(", ");
}

function addTimelineEntry(task: OfficeTask, event: string, note?: string, by?: string): OfficeTask {
  const entry: TaskTimelineEntry = { id: `${Date.now()}-${Math.random()}`, event, note, at: new Date().toISOString(), by };
  return { ...task, timeline: [...(task.timeline || []), entry] };
}

export function ensureInvoiceTaskForJob(input: {
  id: string;
  name: string;
  address?: string;
  city?: string;
  value?: number;
  jobLink?: string;
  assignedTo?: string;
}) {
  if (typeof window === "undefined") return;
  const tasks = readOfficeTasks();
  const invoiceTaskId = `invoice-${input.id}`;
  if (tasks.some((t) => t.id === invoiceTaskId)) return;

  const now = new Date().toISOString();
  const task: OfficeTask = {
    id: invoiceTaskId,
    jobId: input.id,
    title: "Invoice Customer",
    customerName: input.name,
    jobAddress: formatJobAddress(input),
    invoiceAmount: input.value ? `$${Number(input.value).toLocaleString()}` : "TBD",
    assignedUser: input.assignedTo || "Office Staff",
    dueDate: "Immediately",
    status: "For Invoice",
    jobLink: input.jobLink || `/crm/crew?job=${encodeURIComponent(input.id)}`,
    createdAt: now,
    updatedAt: now,
    timeline: [{ id: `${Date.now()}`, event: "Job Completed — Invoice Task Created", at: now }],
  };
  saveOfficeTasks([task, ...tasks]);
}

export function ensureInvoiceTaskForCompletedJob(job: CrewJob) {
  if (job.status !== "Completed") return;
  ensureInvoiceTaskForJob({ id: job.id, name: job.name, address: job.address, city: job.city, value: job.value });
}

// Sync invoice status → task board column automatically
export function syncInvoiceStatusToTask(jobId: string, invoiceStatus: string, invoiceNumber?: string, invoiceAmount?: string) {
  if (typeof window === "undefined") return;
  const tasks = readOfficeTasks();
  const now = new Date().toISOString();
  const statusMap: Record<string, OfficeTaskStatus> = {
    Draft: "For Invoice",
    Sent: "Invoice Sent",
    Viewed: "Invoice Sent",
    "Follow Up": "Invoice Follow Up",
    "Due Soon": "Invoice Follow Up",
    Overdue: "Invoice Follow Up",
    "Partially Paid": "Invoice Follow Up",
    Paid: "Paid",
  };
  const nextStatus = statusMap[invoiceStatus];
  if (!nextStatus) return;

  const updated = tasks.map((task) => {
    if (task.jobId !== jobId) return task;
    const withUpdate = {
      ...task,
      status: nextStatus,
      updatedAt: now,
      ...(invoiceNumber ? { invoiceNumber } : {}),
      ...(invoiceAmount ? { invoiceAmount } : {}),
      invoiceStatus,
    };
    return addTimelineEntry(withUpdate, `Invoice Status → ${invoiceStatus}`, undefined, "System");
  });
  saveOfficeTasks(updated);
}

export function updateOfficeTaskStatus(taskId: string, status: OfficeTaskStatus, by?: string) {
  const tasks = readOfficeTasks();
  const now = new Date().toISOString();
  const updated = tasks.map((task) => {
    if (task.id !== taskId) return task;
    const next = { ...task, status, updatedAt: now };
    return addTimelineEntry(next, `Moved to ${status}`, undefined, by || "Office");
  });

  // Auto-create Customer Satisfaction card when moved to Paid
  const paidTask = updated.find((t) => t.id === taskId && t.status === "Paid");
  const satId = paidTask ? `sat-${paidTask.jobId}` : "";
  const withSat = paidTask && !updated.some((t) => t.id === satId)
    ? [{ ...paidTask, id: satId, status: "Customer Satisfaction" as OfficeTaskStatus, satisfactionChecked: false, dueDate: "Immediately", createdAt: now, updatedAt: now, timeline: [{ id: `${Date.now()}`, event: "Payment Received — Satisfaction Check Required", at: now }] }, ...updated]
    : updated;

  saveOfficeTasks(withSat);
}

export function recordCustomerSatisfaction(taskId: string, satisfied: boolean, notes?: string) {
  const tasks = readOfficeTasks();
  const now = new Date().toISOString();
  const updated = tasks.map((task) => {
    if (task.id !== taskId) return task;
    const result: "yes" | "no" = satisfied ? "yes" : "no";
    const nextStatus: OfficeTaskStatus = satisfied ? "Review Request" : "Customer Satisfaction";
    const event = satisfied ? "Customer Marked Satisfied — Review Request Queued" : "Customer Not Satisfied — Review Request Blocked";
    const next = { ...task, status: nextStatus, satisfactionChecked: true, satisfactionResult: result, satisfactionNotes: notes, satisfactionAt: now, updatedAt: now };
    return addTimelineEntry(next, event, notes, "Office");
  });
  saveOfficeTasks(updated);
}

export function recordReviewRequestSent(taskId: string, smsSent: boolean, emailSent: boolean) {
  const tasks = readOfficeTasks();
  const now = new Date().toISOString();
  const updated = tasks.map((task) => {
    if (task.id !== taskId) return task;
    const next = { ...task, reviewRequestSentAt: now, reviewSmsSent: smsSent, reviewEmailSent: emailSent, updatedAt: now };
    return addTimelineEntry(next, `Review Request Sent${smsSent ? " (SMS)" : ""}${emailSent ? " (Email)" : ""}`, undefined, "System");
  });
  saveOfficeTasks(updated);
}

export function recordReviewReceived(taskId: string) {
  const tasks = readOfficeTasks();
  const now = new Date().toISOString();
  const updated = tasks.map((task) => {
    if (task.id !== taskId) return task;
    const next = { ...task, status: "Review Received" as OfficeTaskStatus, reviewSubmitted: true, reviewReceivedAt: now, updatedAt: now };
    return addTimelineEntry(next, "Review Received", undefined, "System");
  });
  saveOfficeTasks(updated);
}

export function addTaskTimelineEntry(taskId: string, event: string, note?: string, by?: string) {
  const tasks = readOfficeTasks();
  const updated = tasks.map((task) => {
    if (task.id !== taskId) return task;
    return addTimelineEntry(task, event, note, by);
  });
  saveOfficeTasks(updated);
}
