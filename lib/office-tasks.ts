import type { CrewJob } from "@/lib/crew-workflow";

export type OfficeTaskStatus = "For Invoice" | "Invoice Sent" | "Invoice Follow Up" | "Paid" | "Review Request" | "Closed";

export type OfficeTask = {
  id: string;
  jobId: string;
  title: string;
  customerName: string;
  jobAddress: string;
  invoiceAmount: string;
  assignedUser: string;
  dueDate: string;
  status: OfficeTaskStatus;
  jobLink: string;
  createdAt: string;
  updatedAt: string;
};

export const officeTaskStorageKey = "xrp-crm-office-tasks";
export const officeTaskStatuses: OfficeTaskStatus[] = ["For Invoice", "Invoice Sent", "Invoice Follow Up", "Paid", "Review Request", "Closed"];

export function readOfficeTasks() {
  if (typeof window === "undefined") return [] as OfficeTask[];

  try {
    return JSON.parse(window.localStorage.getItem(officeTaskStorageKey) || "[]") as OfficeTask[];
  } catch {
    return [] as OfficeTask[];
  }
}

export function saveOfficeTasks(tasks: OfficeTask[]) {
  window.localStorage.setItem(officeTaskStorageKey, JSON.stringify(tasks));
  window.dispatchEvent(new Event("crm-office-tasks-updated"));
}

function formatJobAddress(parts: { address?: string; city?: string }) {
  return [parts.address, parts.city, "AZ"].filter(Boolean).join(", ");
}

// Creates a "For Invoice" office task for a completed job (idempotent per job).
// Works for both crew-workflow jobs and Jobs-board leads.
export function ensureInvoiceTaskForJob(input: {
  id: string;
  name: string;
  address?: string;
  city?: string;
  value?: number;
  jobLink?: string;
}) {
  if (typeof window === "undefined") return;

  const tasks = readOfficeTasks();
  const invoiceTaskId = `invoice-${input.id}`;
  if (tasks.some((task) => task.id === invoiceTaskId)) return;

  const now = new Date().toISOString();
  saveOfficeTasks([
    {
      id: invoiceTaskId,
      jobId: input.id,
      title: "Invoice Customer",
      customerName: input.name,
      jobAddress: formatJobAddress(input),
      invoiceAmount: input.value ? String(input.value) : "TBD",
      assignedUser: "Office Staff / Admin",
      dueDate: "Immediately",
      status: "For Invoice",
      jobLink: input.jobLink || `/crm/crew?job=${encodeURIComponent(input.id)}`,
      createdAt: now,
      updatedAt: now,
    },
    ...tasks,
  ]);
}

export function ensureInvoiceTaskForCompletedJob(job: CrewJob) {
  if (job.status !== "Completed") return;
  ensureInvoiceTaskForJob({ id: job.id, name: job.name, address: job.address, city: job.city, value: job.value });
}

export function updateOfficeTaskStatus(taskId: string, status: OfficeTaskStatus) {
  const tasks = readOfficeTasks();
  const now = new Date().toISOString();
  const nextTasks = tasks.map((task) => {
    if (task.id !== taskId) return task;
    return { ...task, status, updatedAt: now };
  });

  const paidTask = nextTasks.find((task) => task.id === taskId && task.status === "Paid");
  const reviewTaskId = paidTask ? `review-${paidTask.jobId}` : "";
  const withReviewTask = paidTask && !nextTasks.some((task) => task.id === reviewTaskId) ? [
    {
      ...paidTask,
      id: reviewTaskId,
      title: "Request Review",
      status: "Review Request" as OfficeTaskStatus,
      dueDate: "Immediately",
      createdAt: now,
      updatedAt: now,
    },
    ...nextTasks,
  ] : nextTasks;

  saveOfficeTasks(withReviewTask);
}
