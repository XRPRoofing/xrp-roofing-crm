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

function formatJobAddress(job: CrewJob) {
  return [job.address, job.city, "AZ"].filter(Boolean).join(", ");
}

export function ensureInvoiceTaskForCompletedJob(job: CrewJob) {
  if (typeof window === "undefined") return;
  if (job.status !== "Completed") return;

  const tasks = readOfficeTasks();
  const invoiceTaskId = `invoice-${job.id}`;
  if (tasks.some((task) => task.id === invoiceTaskId)) return;

  const now = new Date().toISOString();
  saveOfficeTasks([
    {
      id: invoiceTaskId,
      jobId: job.id,
      title: "Invoice Customer",
      customerName: job.name,
      jobAddress: formatJobAddress(job),
      invoiceAmount: job.value ? String(job.value) : "TBD",
      assignedUser: "Office Staff / Admin",
      dueDate: "Immediately",
      status: "For Invoice",
      jobLink: `/crm/crew?job=${encodeURIComponent(job.id)}`,
      createdAt: now,
      updatedAt: now,
    },
    ...tasks,
  ]);
}

export function updateOfficeTaskStatus(taskId: string, status: OfficeTaskStatus) {
  const tasks = readOfficeTasks();
  const now = new Date().toISOString();
  const nextTasks = tasks.map((task) => {
    if (task.id !== taskId) return task;
    const nextStatus = status === "Invoice Sent" ? "Invoice Follow Up" : status;
    return { ...task, status: nextStatus, updatedAt: now };
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
