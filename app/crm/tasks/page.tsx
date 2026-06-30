"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Briefcase, CheckSquare, ChevronDown, ChevronRight, Clock, ClipboardList, Filter, MessageSquare, Plus, RefreshCw, Settings, Star, ThumbsDown, ThumbsUp, Trash2, X } from "lucide-react";
import {
  addTaskTimelineEntry,
  archiveOfficeTask,
  deleteOfficeTask,
  officeTaskStatusColors,
  officeTaskStatuses,
  readOfficeTasks,
  recordCustomerSatisfaction,
  recordReviewRequestSent,
  saveOfficeTasks,
  updateOfficeTaskStatus,
  type OfficeTask,
  type OfficeTaskStatus,
} from "@/lib/office-tasks";
import { deleteTaskFromSupabase, loadTasksFromSupabase, subscribeToTaskUpdates, upsertTaskToSupabase } from "@/lib/task-sync";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { logCrewActivity } from "@/lib/crew-activity";
import { sendSms } from "@/lib/twilio/client";
import { getCachedCrewData } from "@/lib/data-cache";
import { readAutomationSettings, updateAutomation } from "@/lib/automation-settings";
import { getTwilioLines } from "@/lib/twilio/numbers";

function fmt(iso: string) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
}

function MetricCard({ label, value, active, onClick, color }: { label: string; value: number; active: boolean; onClick: () => void; color: string }) {
  return (
    <button type="button" onClick={onClick} className={`flex flex-col items-start rounded-md border p-2 sm:p-3.5 text-left transition hover:shadow-md ${active ? "ring-2 ring-blue-500 " + color : "border-gray-200 bg-white"}`}>
      <span className="text-base sm:text-2xl font-bold text-blue-700">{value}</span>
      <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wide text-gray-500 leading-tight">{label}</span>
    </button>
  );
}

type TaskTypeFilter = "all" | "job" | "manual";

function TaskBadge({ isManual }: { isManual?: boolean }) {
  if (isManual) {
    return <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[11px] font-bold text-violet-700"><ClipboardList className="h-2.5 w-2.5" />Daily</span>;
  }
  return <span className="inline-flex items-center gap-0.5 rounded-full bg-cyan-100 px-1.5 py-0.5 text-[11px] font-bold text-cyan-700"><Briefcase className="h-2.5 w-2.5" />Job</span>;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<OfficeTask[]>(() => readOfficeTasks());
  const [loading, setLoading] = useState(() => tasks.length === 0);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [filterStatus, setFilterStatus] = useState<OfficeTaskStatus | null>(null);
  const [filterType, setFilterType] = useState<TaskTypeFilter>("all");
  const [selectedTask, setSelectedTask] = useState<OfficeTask | null>(null);
  const [satModal, setSatModal] = useState<OfficeTask | null>(null);
  const [satResult, setSatResult] = useState<"yes" | "no" | null>(null);
  const [satNotes, setSatNotes] = useState("");
  const [timelineOpen, setTimelineOpen] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [expandedCols, setExpandedCols] = useState<Set<OfficeTaskStatus>>(new Set());
  const dragOverCol = useRef<OfficeTaskStatus | null>(null);

  // Manual task modal
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newAssigned, setNewAssigned] = useState("Office Staff");
  const [newDueDate, setNewDueDate] = useState("");
  const [newStatus, setNewStatus] = useState<OfficeTaskStatus>("Job Scheduled");

  const refresh = useCallback(async () => {
    const fresh = await loadTasksFromSupabase();
    setTasks(fresh);
    setLastSync(new Date());
    setLoading(false);
  }, []);

  // Initial load from Supabase
  useEffect(() => { void refresh(); }, [refresh]); // eslint-disable-line react-hooks/set-state-in-effect

  // Real-time subscription — fires on any device change
  useEffect(() => {
    const unsub = subscribeToTaskUpdates((fresh) => {
      setTasks(fresh);
      setLastSync(new Date());
    });
    return unsub;
  }, []);

  // localStorage fallback sync
  useEffect(() => {
    const onLocal = () => setTasks(readOfficeTasks());
    window.addEventListener("crm-office-tasks-updated", onLocal);
    window.addEventListener("storage", onLocal);
    return () => {
      window.removeEventListener("crm-office-tasks-updated", onLocal);
      window.removeEventListener("storage", onLocal);
    };
  }, []);

  useAutoRefresh(() => { void refresh(); });

  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (filterType === "job") result = result.filter((t) => !t.isManual);
    if (filterType === "manual") result = result.filter((t) => t.isManual);
    return result;
  }, [tasks, filterType]);

  const groupedTasks = useMemo(() =>
    officeTaskStatuses.map((status) => ({
      status,
      tasks: filteredTasks.filter((t) => t.status === status && (!filterStatus || t.status === filterStatus)),
    })), [filteredTasks, filterStatus]);

  const metrics = useMemo(() => ({
    scheduled:    tasks.filter((t) => t.status === "Job Scheduled").length,
    inProgress:   tasks.filter((t) => t.status === "Job In Progress").length,
    completed:    tasks.filter((t) => t.status === "Job Completed").length,
    forInvoice:   tasks.filter((t) => t.status === "For Invoice").length,
    invoiceSent:  tasks.filter((t) => t.status === "Invoice Sent").length,
    followUp:     tasks.filter((t) => t.status === "Invoice Follow Up").length,
    paid:         tasks.filter((t) => t.status === "Paid").length,
    reviewReqs:   tasks.filter((t) => t.status === "Review Request").length,
    reviewRcvd:   tasks.filter((t) => t.status === "Review Received").length,
    unsatisfied:  tasks.filter((t) => t.satisfactionResult === "no").length,
    closed:       tasks.filter((t) => t.status === "Closed").length,
  }), [tasks]);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTaskTarget, setDeleteTaskTarget] = useState<OfficeTask | null>(null);

  function deleteTask(task: OfficeTask) {
    setDeleteTaskTarget(task);
    setShowDeleteConfirm(true);
  }

  function confirmDeleteTask() {
    if (!deleteTaskTarget) return;
    deleteOfficeTask(deleteTaskTarget.id);
    void deleteTaskFromSupabase(deleteTaskTarget.id);
    void logCrewActivity({ jobId: deleteTaskTarget.jobId || deleteTaskTarget.id, jobName: deleteTaskTarget.customerName, actor: "Office", action: "Task deleted", details: deleteTaskTarget.title, module: "Jobs" }).catch(() => {});
    setSelectedTask(null);
    setTasks((current) => current.filter((t) => t.id !== deleteTaskTarget.id));
    setShowDeleteConfirm(false);
    setDeleteTaskTarget(null);
  }

  function archiveTask(task: OfficeTask) {
    if (!window.confirm(`Archive task for "${task.customerName}"? It will be hidden from the board.`)) return;
    archiveOfficeTask(task.id);
    void upsertTaskToSupabase({ ...task, archived: true });
    void logCrewActivity({ jobId: task.jobId || task.id, jobName: task.customerName, actor: "Office", action: "Task archived", details: task.title, module: "Jobs" }).catch(() => {});
    setSelectedTask(null);
    setTasks((current) => current.filter((t) => t.id !== task.id));
  }

  function moveTask(taskId: string, status: OfficeTaskStatus) {
    updateOfficeTaskStatus(taskId, status);
    const fresh = readOfficeTasks();
    setTasks(fresh);
    if (selectedTask?.id === taskId) setSelectedTask((prev) => prev ? { ...prev, status } : null);
    const moved = fresh.find((t) => t.id === taskId);
    if (moved) {
      void upsertTaskToSupabase(moved);
      void logCrewActivity({ jobId: moved.jobId || moved.id, jobName: moved.customerName, actor: "Office", action: `Task moved to ${status}`, details: moved.title, module: "Jobs" }).catch(() => {});
    }
  }

  function handleDrop(status: OfficeTaskStatus) {
    if (!draggedId) return;
    moveTask(draggedId, status);
    setDraggedId(null);
  }

  function openSatModal(task: OfficeTask) {
    setSatModal(task);
    setSatResult(null);
    setSatNotes("");
  }

  // Review Request SMS modal state
  const [reviewModal, setReviewModal] = useState<OfficeTask | null>(null);
  const [reviewMessage, setReviewMessage] = useState("");
  const [reviewPhone, setReviewPhone] = useState("");
  const [reviewSending, setReviewSending] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewSent, setReviewSent] = useState(false);
  const [showReviewSettings, setShowReviewSettings] = useState(false);
  const [reviewTemplate, setReviewTemplate] = useState("");

  function getCustomerPhone(task: OfficeTask): string {
    const crewData = getCachedCrewData();
    if (!crewData) return "";
    const job = crewData.jobs.find((j) => j.id === task.jobId);
    return job?.phone || "";
  }

  function buildReviewMessage(task: OfficeTask): string {
    const settings = readAutomationSettings();
    const template = settings.reviewRequestAfterCompletion.template;
    return template
      .replace(/\{customerName\}/g, task.customerName)
      .replace(/\{address\}/g, task.jobAddress)
      .replace(/\{reviewLink\}/g, "https://g.page/r/xrproofing/review")
      .replace(/\{companyName\}/g, "XRP Roofing");
  }

  function openReviewModal(task: OfficeTask) {
    const phone = getCustomerPhone(task);
    setReviewModal(task);
    setReviewPhone(phone);
    setReviewMessage(buildReviewMessage(task));
    setReviewSending(false);
    setReviewError("");
    setReviewSent(false);
  }

  async function sendReviewRequest() {
    if (!reviewModal || !reviewMessage.trim() || !reviewPhone) return;
    setReviewSending(true);
    setReviewError("");
    try {
      const lines = getTwilioLines();
      const fromNumber = lines[0]?.number || "";
      await sendSms({ to: reviewPhone, body: reviewMessage.trim(), from: fromNumber, jobId: reviewModal.jobId });
      recordReviewRequestSent(reviewModal.id, true, false);
      addTaskTimelineEntry(reviewModal.id, "Review Request SMS Sent", reviewMessage.trim().slice(0, 80), "Office");
      void logCrewActivity({ jobId: reviewModal.jobId || reviewModal.id, jobName: reviewModal.customerName, actor: "Office", action: "Review Request SMS Sent", details: `Sent to ${reviewPhone}`, module: "Jobs" }).catch(() => {});
      setReviewSent(true);
      setTasks(readOfficeTasks());
      setTimeout(() => { setReviewModal(null); setSelectedTask((prev) => prev ? { ...prev, reviewRequestSentAt: new Date().toISOString(), reviewSmsSent: true } : null); }, 1200);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : "Failed to send SMS");
    } finally {
      setReviewSending(false);
    }
  }

  function openReviewSettings() {
    const settings = readAutomationSettings();
    setReviewTemplate(settings.reviewRequestAfterCompletion.template);
    setShowReviewSettings(true);
  }

  function saveReviewTemplate() {
    updateAutomation("reviewRequestAfterCompletion", { template: reviewTemplate });
    setShowReviewSettings(false);
  }

  function submitSatisfaction() {
    if (!satModal || !satResult) return;
    recordCustomerSatisfaction(satModal.id, satResult === "yes", satNotes);
    void logCrewActivity({ jobId: satModal.jobId || satModal.id, jobName: satModal.customerName, actor: "Office", action: `Satisfaction: ${satResult === "yes" ? "Satisfied" : "Not Satisfied"}`, details: satNotes || (satResult === "yes" ? "Customer is satisfied" : "Customer is not satisfied"), module: "Jobs" }).catch(() => {});
    if (satResult === "yes") {
      openReviewModal(satModal);
    }
    setSatModal(null);
    setTasks(readOfficeTasks());
  }

  function createManualTask() {
    if (!newTitle.trim()) return;
    const now = new Date().toISOString();
    const task: OfficeTask = {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      jobId: "",
      title: newTitle.trim(),
      customerName: newTitle.trim(),
      jobAddress: newDescription.trim() || "Daily Task",
      invoiceAmount: "",
      assignedUser: newAssigned.trim() || "Office Staff",
      dueDate: newDueDate || "No due date",
      status: newStatus,
      jobLink: "",
      createdAt: now,
      updatedAt: now,
      isManual: true,
      timeline: [{ id: `${Date.now()}`, event: "Daily task created", at: now, by: "Office" }],
    };
    const existing = readOfficeTasks();
    saveOfficeTasks([task, ...existing]);
    void upsertTaskToSupabase(task);
    void logCrewActivity({ jobId: task.jobId || task.id, jobName: task.customerName, actor: "Office", action: "Task created", details: task.title, module: "Jobs" }).catch(() => {});
    setTasks(readOfficeTasks());
    setShowNewTask(false);
    setNewTitle("");
    setNewDescription("");
    setNewAssigned("Office Staff");
    setNewDueDate("");
    setNewStatus("Job Scheduled");
  }

  const colors = officeTaskStatusColors;

  const manualCount = tasks.filter((t) => t.isManual).length;
  const jobCount = tasks.filter((t) => !t.isManual).length;

  // Auto-expand sections that have tasks, collapse empty ones
  useEffect(() => {
    const withTasks = new Set<OfficeTaskStatus>();
    for (const { status, tasks: colTasks } of groupedTasks) {
      if (colTasks.length > 0) withTasks.add(status);
    }
    setExpandedCols(withTasks); // eslint-disable-line react-hooks/set-state-in-effect
  }, [groupedTasks]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 sm:gap-5">
      {/* Sticky Header */}
      <div className="sticky top-16 z-20 -mx-3 -mt-2 space-y-1.5 border-b border-gray-200 bg-white/95 px-3 pb-2 pt-2 backdrop-blur-sm sm:-mx-5 sm:space-y-3 sm:px-5 sm:pb-3 sm:pt-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600 sm:text-xs">Office Workflow</p>
            <h1 className="text-lg font-bold text-blue-700 sm:text-3xl">Task Board</h1>
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${loading ? "bg-orange-400 animate-pulse" : "bg-blue-500"}`} />
              <p className="text-xs font-semibold text-gray-500">
                {loading ? "Syncing…" : `Live · ${tasks.length} tasks${lastSync ? ` · Updated ${lastSync.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}` : ""}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowNewTask(true)} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 active:scale-95">
              <Plus className="h-4 w-4" /> New Task
            </button>
            <button onClick={() => { setLoading(true); void refresh(); }} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50 active:scale-95">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
            {filterStatus && (
              <button onClick={() => setFilterStatus(null)} className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">
                <X className="h-4 w-4" /> {filterStatus}
              </button>
            )}
          </div>
        </div>

        {/* Type Filter */}
        <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-gray-400" />
        <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
          {([
            { key: "all" as TaskTypeFilter, label: "All Tasks", count: tasks.length },
            { key: "job" as TaskTypeFilter, label: "Job Tasks", count: jobCount },
            { key: "manual" as TaskTypeFilter, label: "Daily Tasks", count: manualCount },
          ]).map(({ key, label, count }) => (
            <button key={key} type="button" onClick={() => setFilterType(key)} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition ${filterType === key ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:bg-gray-50"}`}>
              {label} <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${filterType === key ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-500"}`}>{count}</span>
            </button>
          ))}
        </div>
      </div>

        {/* Metrics */}
        <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-4 sm:gap-2.5 lg:grid-cols-6 xl:grid-cols-11">
          <MetricCard label="Scheduled"   value={metrics.scheduled}   active={filterStatus === "Job Scheduled"}         onClick={() => setFilterStatus(filterStatus === "Job Scheduled" ? null : "Job Scheduled")}         color="bg-blue-50 border-blue-300" />
          <MetricCard label="In Progress" value={metrics.inProgress}  active={filterStatus === "Job In Progress"}       onClick={() => setFilterStatus(filterStatus === "Job In Progress" ? null : "Job In Progress")}       color="bg-orange-50 border-orange-300" />
          <MetricCard label="Completed"   value={metrics.completed}   active={filterStatus === "Job Completed"}         onClick={() => setFilterStatus(filterStatus === "Job Completed" ? null : "Job Completed")}         color="bg-blue-50 border-blue-300" />
          <MetricCard label="For Invoice" value={metrics.forInvoice}  active={filterStatus === "For Invoice"}           onClick={() => setFilterStatus(filterStatus === "For Invoice" ? null : "For Invoice")}           color="bg-orange-50 border-orange-300" />
          <MetricCard label="Inv. Sent"   value={metrics.invoiceSent} active={filterStatus === "Invoice Sent"}          onClick={() => setFilterStatus(filterStatus === "Invoice Sent" ? null : "Invoice Sent")}          color="bg-sky-50 border-sky-300" />
          <MetricCard label="Follow Up"   value={metrics.followUp}    active={filterStatus === "Invoice Follow Up"}     onClick={() => setFilterStatus(filterStatus === "Invoice Follow Up" ? null : "Invoice Follow Up")}     color="bg-orange-50 border-orange-300" />
          <MetricCard label="Paid"         value={metrics.paid}        active={filterStatus === "Paid"}                  onClick={() => setFilterStatus(filterStatus === "Paid" ? null : "Paid")}                  color="bg-blue-50 border-blue-300" />
          <MetricCard label="Rev. Reqs"   value={metrics.reviewReqs}  active={filterStatus === "Review Request"}        onClick={() => setFilterStatus(filterStatus === "Review Request" ? null : "Review Request")}        color="bg-blue-50 border-blue-300" />
          <MetricCard label="Reviews"     value={metrics.reviewRcvd}  active={filterStatus === "Review Received"}       onClick={() => setFilterStatus(filterStatus === "Review Received" ? null : "Review Received")}       color="bg-blue-50 border-blue-300" />
          <MetricCard label="Unsatisfied" value={metrics.unsatisfied} active={false}                                    onClick={() => {}}                                                                                  color="bg-orange-50 border-orange-300" />
          <MetricCard label="Closed"      value={metrics.closed}      active={filterStatus === "Closed"}                onClick={() => setFilterStatus(filterStatus === "Closed" ? null : "Closed")}                color="bg-gray-100 border-gray-300" />
        </div>
      </div>

      {/* Mobile Accordion (sm and below) */}
      <div className="space-y-2 lg:hidden">
        {groupedTasks.map(({ status, tasks: colTasks }) => {
          const c = colors[status];
          const isOpen = expandedCols.has(status);
          const hasAlert = (status === "Customer Satisfaction" && colTasks.some((t) => !t.satisfactionChecked))
            || (status === "Review Request" && colTasks.some((t) => !t.reviewRequestSentAt));
          return (
            <div key={status} className={`overflow-hidden rounded-lg border ${c.border} bg-white shadow-sm`}>
              <button
                type="button"
                onClick={() => setExpandedCols((prev) => {
                  const next = new Set(prev);
                  if (next.has(status)) next.delete(status);
                  else next.add(status);
                  return next;
                })}
                className={`flex w-full items-center justify-between px-3 py-2.5 ${c.bg} active:opacity-80`}
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${c.dot}`} />
                  <span className={`text-xs font-bold ${c.text}`}>{status}</span>
                  {hasAlert && <span className="h-2 w-2 rounded-full bg-orange-500" />}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${c.bg} ${c.text}`}>{colTasks.length}</span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${c.text} ${isOpen ? "rotate-180" : ""}`} />
                </div>
              </button>
              {isOpen && (
                <div className="max-h-[60vh] space-y-2 overflow-y-auto p-2">
                  {colTasks.length === 0 && (
                    <p className="rounded-lg border border-dashed border-gray-200 py-4 text-center text-xs font-semibold text-gray-400">No tasks</p>
                  )}
                  {colTasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => setSelectedTask(task)}
                      className={`group w-full rounded-lg border bg-white p-3.5 text-left shadow-sm active:scale-[0.98] ${c.border}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="mb-1"><TaskBadge isManual={task.isManual} /></div>
                          <p className="truncate text-sm font-bold text-gray-900">{task.isManual ? task.title : task.customerName}</p>
                          <p className="mt-0.5 truncate text-xs font-semibold text-gray-500">{task.isManual ? (task.jobAddress !== "Daily Task" && task.jobAddress !== "Manual Task" ? task.jobAddress : "") : task.jobAddress}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {!task.isManual && (
                            <button type="button" onClick={(e) => { e.stopPropagation(); archiveTask(task); }} className="hidden rounded-lg p-1 text-gray-300 transition hover:bg-amber-50 hover:text-amber-600 group-hover:flex" aria-label="Archive task"><Archive className="h-3.5 w-3.5" /></button>
                          )}
                          <button type="button" onClick={(e) => { e.stopPropagation(); deleteTask(task); }} className="hidden rounded-lg p-1 text-gray-300 transition hover:bg-red-50 hover:text-red-500 group-hover:flex" aria-label="Delete task"><Trash2 className="h-3.5 w-3.5" /></button>
                          {!task.isManual && <span className="text-sm font-bold text-blue-700">{task.invoiceAmount}</span>}
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-xs text-gray-400">{task.assignedUser}</span>
                        <div className="flex items-center gap-1.5">
                          {task.satisfactionResult === "yes" && <ThumbsUp className="h-3.5 w-3.5 text-blue-500" />}
                          {task.satisfactionResult === "no" && <ThumbsDown className="h-3.5 w-3.5 text-orange-500" />}
                          {task.reviewSubmitted && <Star className="h-3.5 w-3.5 text-orange-500" />}
                          {task.invoiceNumber && <span className="text-[10px] font-bold text-gray-400">#{task.invoiceNumber}</span>}
                        </div>
                      </div>
                      {status === "Customer Satisfaction" && !task.satisfactionChecked && !task.isManual && (
                        <div className="mt-2 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">⚡ Satisfaction check needed</div>
                      )}
                      {status === "Review Request" && !task.reviewRequestSentAt && !task.isManual && (
                        <div className="mt-2 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">⚡ Review request not sent yet</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop Kanban Board (lg and above) */}
      <div className="hidden min-h-0 flex-1 gap-3.5 overflow-x-auto pb-4 lg:flex">
        {groupedTasks.map(({ status, tasks: colTasks }) => {
          const c = colors[status];
          return (
            <section
              key={status}
              className="flex w-60 shrink-0 flex-col rounded-lg border border-gray-200 bg-white shadow-sm"
              style={{ maxHeight: "calc(100vh - 260px)" }}
              onDragOver={(e) => { e.preventDefault(); dragOverCol.current = status; }}
              onDrop={() => handleDrop(status)}
            >
              {/* Column header */}
              <div className={`flex items-center justify-between rounded-t-2xl border-b px-3 py-2.5 ${c.bg} ${c.border}`}>
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${c.dot}`} />
                  <h2 className={`text-xs font-bold uppercase tracking-wide ${c.text}`}>{status}</h2>
                </div>
                <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${c.bg} ${c.text}`}>{colTasks.length}</span>
              </div>

              {/* Cards — fully scrollable */}
              <div className="flex min-h-[80px] flex-1 flex-col gap-1.5 overflow-y-auto p-1.5">
                {colTasks.map((task) => (
                  <article
                    key={task.id}
                    draggable
                    onDragStart={() => setDraggedId(task.id)}
                    onDragEnd={() => setDraggedId(null)}
                    onClick={() => setSelectedTask(task)}
                    className={`group cursor-pointer rounded-lg border bg-white p-2.5 shadow-sm transition hover:shadow-md hover:-translate-y-0.5 ${draggedId === task.id ? "opacity-40" : ""} ${c.border}`}
                  >
                    <div className="mb-1"><TaskBadge isManual={task.isManual} /></div>
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-gray-900">{task.isManual ? task.title : task.customerName}</p>
                        <p className="mt-0.5 truncate text-xs font-semibold text-gray-500">{task.isManual ? (task.jobAddress !== "Daily Task" && task.jobAddress !== "Manual Task" ? task.jobAddress : "") : task.jobAddress}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        {!task.isManual && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); archiveTask(task); }} className="hidden shrink-0 rounded-lg p-0.5 text-gray-300 transition hover:bg-amber-50 hover:text-amber-600 group-hover:flex" aria-label="Archive task"><Archive className="h-3 w-3" /></button>
                        )}
                        <button type="button" onClick={(e) => { e.stopPropagation(); deleteTask(task); }} className="hidden shrink-0 rounded-lg p-0.5 text-gray-300 transition hover:bg-red-50 hover:text-red-500 group-hover:flex" aria-label="Delete task"><Trash2 className="h-3 w-3" /></button>
                      </div>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-1">
                      {!task.isManual && <span className="text-[11px] font-bold text-blue-700">{task.invoiceAmount}</span>}
                      {task.isManual && task.dueDate && task.dueDate !== "No due date" && <span className="text-[11px] font-bold text-violet-600">{task.dueDate}</span>}
                      {task.satisfactionResult === "yes" && <ThumbsUp className="h-3 w-3 text-blue-500" />}
                      {task.satisfactionResult === "no" && <ThumbsDown className="h-3 w-3 text-orange-500" />}
                      {task.reviewSubmitted && <Star className="h-3 w-3 text-orange-500" />}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-1">
                      <span className="truncate text-[11px] text-gray-400">{task.assignedUser}</span>
                      {task.invoiceNumber && <span className="text-[11px] font-bold text-gray-400">#{task.invoiceNumber}</span>}
                    </div>
                    {/* Quick actions */}
                    {status === "Customer Satisfaction" && !task.satisfactionChecked && !task.isManual && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); openSatModal(task); }} className="mt-2 w-full rounded-lg bg-blue-600 py-1 text-[11px] font-bold text-white hover:bg-blue-700">
                        <CheckSquare className="mr-1 inline h-3 w-3" />Satisfaction Check
                      </button>
                    )}
                    {status === "Review Request" && !task.reviewRequestSentAt && !task.isManual && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); openReviewModal(task); }} className="mt-2 w-full rounded-lg bg-blue-600 py-1 text-[11px] font-bold text-white hover:bg-blue-700">
                        <MessageSquare className="mr-1 inline h-3 w-3" />Send Review Request
                      </button>
                    )}
                  </article>
                ))}
                {colTasks.length === 0 && (
                  <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-gray-200 py-6 text-xs font-semibold text-gray-400">Empty</div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* Task Detail Drawer */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" onClick={() => setSelectedTask(null)}>
          <div className="absolute inset-0 bg-gray-950/40 backdrop-blur-sm" />
          <div className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <p className={`text-xs font-bold uppercase tracking-widest ${officeTaskStatusColors[selectedTask.status].text}`}>{selectedTask.status}</p>
                  <TaskBadge isManual={selectedTask.isManual} />
                </div>
                <h2 className="mt-1 text-lg font-bold text-blue-700">{selectedTask.isManual ? selectedTask.title : selectedTask.customerName}</h2>
                <p className="text-sm font-semibold text-gray-500">{selectedTask.isManual ? (selectedTask.jobAddress !== "Daily Task" && selectedTask.jobAddress !== "Manual Task" ? selectedTask.jobAddress : "") : selectedTask.jobAddress}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {!selectedTask.isManual && (
                  <button type="button" onClick={() => archiveTask(selectedTask)} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 transition hover:bg-amber-100"><Archive className="h-4 w-4" />Archive</button>
                )}
                <button type="button" onClick={() => deleteTask(selectedTask)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 transition hover:bg-red-100"><Trash2 className="h-4 w-4" />Delete</button>
                <button onClick={() => setSelectedTask(null)} className="rounded-lg p-2 hover:bg-gray-100"><X className="h-5 w-5" /></button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              {(selectedTask.isManual
                ? [
                    ["Title", selectedTask.title],
                    ["Assigned", selectedTask.assignedUser],
                    ["Due", selectedTask.dueDate],
                    ["Created", fmt(selectedTask.createdAt)],
                  ]
                : [
                    ["Invoice #", selectedTask.invoiceNumber || "—"],
                    ["Amount", selectedTask.invoiceAmount],
                    ["Inv. Status", selectedTask.invoiceStatus || "—"],
                    ["Assigned", selectedTask.assignedUser],
                    ["Due", selectedTask.dueDate],
                    ["Created", fmt(selectedTask.createdAt)],
                  ]
              ).map(([label, val]) => (
                <div key={label} className="rounded-lg bg-gray-50 px-3 py-2">
                  <p className="font-bold uppercase tracking-wide text-gray-400" style={{ fontSize: "9px" }}>{label}</p>
                  <p className="mt-0.5 font-bold text-gray-800">{val}</p>
                </div>
              ))}
            </div>

            {/* Satisfaction */}
            {selectedTask.satisfactionChecked && !selectedTask.isManual && (
              <div className={`mt-4 rounded-lg p-3 ${selectedTask.satisfactionResult === "yes" ? "bg-blue-50" : "bg-orange-50"}`}>
                <p className="text-xs font-bold text-gray-700">Customer Satisfaction</p>
                <p className={`mt-1 text-sm font-bold ${selectedTask.satisfactionResult === "yes" ? "text-blue-700" : "text-orange-700"}`}>
                  {selectedTask.satisfactionResult === "yes" ? "✓ Satisfied" : "✗ Not Satisfied"}
                </p>
                {selectedTask.satisfactionNotes && <p className="mt-1 text-xs text-gray-600">{selectedTask.satisfactionNotes}</p>}
              </div>
            )}

            {/* Review tracking */}
            {selectedTask.reviewRequestSentAt && !selectedTask.isManual && (
              <div className="mt-4 rounded-lg bg-blue-50 p-3">
                <p className="text-xs font-bold text-blue-700">Review Request Sent</p>
                <p className="mt-0.5 text-xs text-blue-600">{fmt(selectedTask.reviewRequestSentAt)}</p>
                <div className="mt-1 flex gap-2 text-[11px] font-bold">
                  {selectedTask.reviewSmsSent && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">SMS ✓</span>}
                  {selectedTask.reviewEmailSent && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">Email ✓</span>}
                  {selectedTask.reviewSubmitted && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">Review Received ✓</span>}
                </div>
              </div>
            )}

            {/* Move to column */}
            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Move to</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {officeTaskStatuses.filter((s) => s !== selectedTask.status).map((s) => {
                  const c = officeTaskStatusColors[s];
                  return (
                    <button key={s} type="button" onClick={() => { moveTask(selectedTask.id, s); setSelectedTask((prev) => prev ? { ...prev, status: s } : null); }} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition hover:opacity-80 ${c.bg} ${c.text}`}>{s}</button>
                  );
                })}
              </div>
            </div>

            {/* Satisfaction CTA */}
            {selectedTask.status === "Customer Satisfaction" && !selectedTask.satisfactionChecked && !selectedTask.isManual && (
              <button type="button" onClick={() => openSatModal(selectedTask)} className="mt-4 w-full rounded-lg bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700">
                <CheckSquare className="mr-2 inline h-4 w-4" />Run Satisfaction Check
              </button>
            )}

            {/* Review request CTA */}
            {selectedTask.status === "Review Request" && !selectedTask.reviewRequestSentAt && !selectedTask.isManual && (
              <button type="button" onClick={() => { openReviewModal(selectedTask); }} className="mt-4 w-full rounded-lg bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700">
                <MessageSquare className="mr-2 inline h-4 w-4" />Send Review Request SMS
              </button>
            )}

            {/* Review received CTA */}
            {selectedTask.status === "Review Request" && selectedTask.reviewRequestSentAt && !selectedTask.reviewSubmitted && !selectedTask.isManual && (
              <button type="button" onClick={() => { moveTask(selectedTask.id, "Review Received"); setSelectedTask(null); }} className="mt-2 w-full rounded-lg border border-blue-300 bg-blue-50 py-3 text-sm font-bold text-blue-700 hover:bg-blue-100">
                <Star className="mr-2 inline h-4 w-4" />Mark Review Received
              </button>
            )}

            {/* Close task */}
            {!["Closed"].includes(selectedTask.status) && (
              <button type="button" onClick={() => { moveTask(selectedTask.id, "Closed"); setSelectedTask(null); }} className="mt-2 w-full rounded-lg border border-gray-200 bg-gray-50 py-3 text-sm font-bold text-gray-600 hover:bg-gray-100">
                Close Task
              </button>
            )}

            {/* Open job link */}
            {!selectedTask.isManual && selectedTask.jobLink && (
              <Link href={selectedTask.jobLink} className="mt-3 block text-center text-xs font-bold text-blue-700 underline">Open Job Record</Link>
            )}

            {/* Archive for job tasks */}
            {!selectedTask.isManual && (
              <button type="button" onClick={() => archiveTask(selectedTask)} className="mt-3 w-full rounded-lg border border-amber-200 bg-amber-50 py-2.5 text-sm font-bold text-amber-700 transition hover:bg-amber-100 flex items-center justify-center gap-2">
                <Archive className="h-4 w-4" />Archive Task
              </button>
            )}

            {/* Delete task */}
            <button type="button" onClick={() => deleteTask(selectedTask)} className="mt-2 w-full rounded-lg border border-red-200 bg-red-50 py-2.5 text-sm font-bold text-red-700 transition hover:bg-red-100 flex items-center justify-center gap-2">
              <Trash2 className="h-4 w-4" />Delete Task
            </button>

            {/* Timeline */}
            <div className="mt-4">
              <button type="button" onClick={() => setTimelineOpen(timelineOpen === selectedTask.id ? null : selectedTask.id)} className="flex w-full items-center gap-2 text-xs font-bold text-gray-500">
                {timelineOpen === selectedTask.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Activity Timeline ({selectedTask.timeline?.length || 0} events)
              </button>
              {timelineOpen === selectedTask.id && selectedTask.timeline && selectedTask.timeline.length > 0 && (
                <ol className="mt-2 space-y-2 border-l-2 border-gray-200 pl-4">
                  {[...selectedTask.timeline].reverse().map((entry) => (
                    <li key={entry.id} className="relative">
                      <span className="absolute -left-[1.35rem] top-1 h-2.5 w-2.5 rounded-full bg-blue-500 ring-2 ring-white" />
                      <p className="text-xs font-bold text-gray-800">{entry.event}</p>
                      {entry.note && <p className="text-[11px] text-gray-500">{entry.note}</p>}
                      <p className="flex items-center gap-1 text-[11px] text-gray-400"><Clock className="h-3 w-3" />{fmt(entry.at)}{entry.by ? ` · ${entry.by}` : ""}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New Daily Task Modal */}
      {showNewTask && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => setShowNewTask(false)}>
          <div className="absolute inset-0 bg-gray-950/50 backdrop-blur-sm" />
          <div className="relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-violet-600">New Daily Task</p>
                <h2 className="mt-1 text-lg font-bold text-blue-700">Create Task</h2>
              </div>
              <button onClick={() => setShowNewTask(false)} className="rounded-lg p-2 hover:bg-gray-100"><X className="h-5 w-5" /></button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Task Title *</label>
                <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g., Follow up with supplier, Office meeting..." className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400" autoFocus />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Description</label>
                <textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Optional description or notes..." rows={2} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Assigned To</label>
                  <input type="text" value={newAssigned} onChange={(e) => setNewAssigned(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Due Date</label>
                  <input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Initial Status</label>
                <select value={newStatus} onChange={(e) => setNewStatus(e.target.value as OfficeTaskStatus)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400">
                  {officeTaskStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setShowNewTask(false)} className="flex-1 rounded-lg border border-gray-200 py-3 text-sm font-bold text-gray-600 hover:bg-gray-50">Cancel</button>
              <button type="button" disabled={!newTitle.trim()} onClick={createManualTask} className="flex-1 rounded-lg bg-blue-600 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">
                <Plus className="h-4 w-4" />Create Task
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Satisfaction Modal */}
      {satModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => setSatModal(null)}>
          <div className="absolute inset-0 bg-gray-950/50 backdrop-blur-sm" />
          <div className="relative z-10 w-full max-w-sm rounded-lg bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-xs font-bold uppercase tracking-widest text-blue-600">Customer Satisfaction Check</p>
            <h2 className="mt-2 text-lg font-bold text-blue-700">Was the customer satisfied?</h2>
            <p className="mt-1 text-sm font-semibold text-gray-500">{satModal.customerName} — {satModal.jobAddress}</p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setSatResult("yes")} className={`flex items-center justify-center gap-2 rounded-lg border-2 py-4 text-sm font-bold transition ${satResult === "yes" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600 hover:border-blue-300"}`}>
                <ThumbsUp className="h-5 w-5" /> Yes
              </button>
              <button type="button" onClick={() => setSatResult("no")} className={`flex items-center justify-center gap-2 rounded-lg border-2 py-4 text-sm font-bold transition ${satResult === "no" ? "border-orange-500 bg-orange-50 text-orange-700" : "border-gray-200 text-gray-600 hover:border-orange-300"}`}>
                <ThumbsDown className="h-5 w-5" /> No
              </button>
            </div>

            <textarea value={satNotes} onChange={(e) => setSatNotes(e.target.value)} placeholder="Optional notes..." rows={2} className="mt-4 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-400" />

            {satResult === "yes" && (
              <div className="mt-3 rounded-lg bg-blue-50 p-3 text-xs font-semibold text-blue-700">
                <p className="font-bold">Next steps:</p>
                <p className="mt-1">• Move to Review Request</p>
                <p>• Open Review Request SMS for your confirmation</p>
                <p>• You can edit the message before sending</p>
              </div>
            )}
            {satResult === "no" && (
              <div className="mt-3 rounded-lg bg-orange-50 p-3 text-xs font-semibold text-orange-700">
                <p className="font-bold">Review request will NOT be sent.</p>
                <p className="mt-1">• Office staff will be notified</p>
                <p>• Follow-up task will be created</p>
              </div>
            )}

            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setSatModal(null)} className="flex-1 rounded-lg border border-gray-200 py-3 text-sm font-bold text-gray-600 hover:bg-gray-50">Cancel</button>
              <button type="button" disabled={!satResult} onClick={submitSatisfaction} className="flex-1 rounded-lg bg-blue-600 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-50">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {showDeleteConfirm && deleteTaskTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" onClick={() => { setShowDeleteConfirm(false); setDeleteTaskTarget(null); }}>
          <div className="w-full max-w-sm rounded-xl border border-red-200 bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600 text-lg">⚠</div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Delete Task</h2>
                <p className="text-sm text-gray-600">This action cannot be undone.</p>
              </div>
            </div>
            <div className="mt-4 rounded-lg bg-red-50 p-3">
              <p className="text-sm font-semibold text-red-900">{deleteTaskTarget.isManual ? deleteTaskTarget.title : deleteTaskTarget.customerName}</p>
              <p className="text-xs text-red-700 mt-1">{deleteTaskTarget.isManual ? "Daily Task" : "Job Task"} · {deleteTaskTarget.status}</p>
            </div>
            <p className="mt-3 text-xs text-gray-500">This will permanently remove the task from all devices. It will not reappear after refresh or synchronization.</p>
            <div className="mt-5 flex gap-3">
              <button onClick={() => { setShowDeleteConfirm(false); setDeleteTaskTarget(null); }} className="flex-1 rounded-lg border border-gray-200 px-4 py-3 text-sm font-bold text-gray-700 transition hover:bg-gray-50">Cancel</button>
              <button onClick={confirmDeleteTask} className="flex-1 rounded-lg bg-red-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-red-700 active:scale-95">Delete Permanently</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Review Request SMS Modal ── */}
      {reviewModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setReviewModal(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                  <MessageSquare className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">Review Request SMS</p>
                  <p className="text-xs text-gray-500">To: {reviewModal.customerName}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={openReviewSettings} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600" title="Template Settings">
                  <Settings className="h-4 w-4" />
                </button>
                <button onClick={() => setReviewModal(null)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="space-y-4 px-5 py-4">
              {/* Phone */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">Recipient Phone</label>
                <input type="tel" value={reviewPhone} onChange={(e) => setReviewPhone(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400" placeholder="Customer phone number" />
              </div>

              {/* Message */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">Message</label>
                <textarea value={reviewMessage} onChange={(e) => setReviewMessage(e.target.value)} rows={5} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 resize-none" placeholder="Review request message..." />
                <p className="mt-1 text-[11px] text-gray-400">{reviewMessage.length} characters</p>
              </div>

              {/* Template variables hint */}
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1">Template Variables</p>
                <p className="text-xs text-gray-500">{"{customerName}"} · {"{reviewLink}"} · {"{companyName}"} · {"{address}"}</p>
              </div>

              {/* Error */}
              {reviewError && (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{reviewError}</div>
              )}

              {/* Success */}
              {reviewSent && (
                <div className="rounded-lg bg-green-50 px-3 py-2 text-xs font-bold text-green-700">SMS sent successfully! This message will appear in the Conversation Board.</div>
              )}

              {/* Warning if no phone */}
              {!reviewPhone && (
                <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">No phone number found for this customer. Please enter a number above.</div>
              )}
            </div>

            {/* Footer */}
            <div className="flex gap-3 border-t border-gray-100 px-5 py-4">
              <button type="button" onClick={() => setReviewModal(null)} className="flex-1 rounded-lg border border-gray-200 py-3 text-sm font-bold text-gray-600 hover:bg-gray-50">Cancel</button>
              <button type="button" disabled={reviewSending || !reviewMessage.trim() || !reviewPhone || reviewSent} onClick={() => { void sendReviewRequest(); }} className="flex-1 rounded-lg bg-blue-600 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-50">
                {reviewSending ? "Sending..." : "Confirm & Send SMS"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Review Request Settings Modal ── */}
      {showReviewSettings && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setShowReviewSettings(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                  <Settings className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">Review Request Settings</p>
                  <p className="text-xs text-gray-500">Customize the default SMS template</p>
                </div>
              </div>
              <button onClick={() => setShowReviewSettings(false)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="space-y-4 px-5 py-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">Default SMS Template</label>
                <textarea value={reviewTemplate} onChange={(e) => setReviewTemplate(e.target.value)} rows={5} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 resize-none" />
                <p className="mt-1 text-[11px] text-gray-400">{reviewTemplate.length} characters · Changes apply to future review requests only</p>
              </div>

              <div className="rounded-lg bg-blue-50 p-3">
                <p className="text-xs font-bold text-blue-700 mb-1">Available Variables</p>
                <div className="grid grid-cols-2 gap-1 text-xs text-blue-600">
                  <span><code className="rounded bg-blue-100 px-1">{"{customerName}"}</code> — Customer name</span>
                  <span><code className="rounded bg-blue-100 px-1">{"{reviewLink}"}</code> — Google review URL</span>
                  <span><code className="rounded bg-blue-100 px-1">{"{companyName}"}</code> — Company name</span>
                  <span><code className="rounded bg-blue-100 px-1">{"{address}"}</code> — Job address</span>
                </div>
              </div>

              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs font-bold text-gray-500 mb-1">Preview</p>
                <p className="text-sm text-gray-700">{reviewTemplate.replace(/\{customerName\}/g, "John Smith").replace(/\{reviewLink\}/g, "https://g.page/r/xrproofing/review").replace(/\{companyName\}/g, "XRP Roofing").replace(/\{address\}/g, "123 Main St")}</p>
              </div>
            </div>

            {/* Footer */}
            <div className="flex gap-3 border-t border-gray-100 px-5 py-4">
              <button type="button" onClick={() => setShowReviewSettings(false)} className="flex-1 rounded-lg border border-gray-200 py-3 text-sm font-bold text-gray-600 hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={saveReviewTemplate} className="flex-1 rounded-lg bg-blue-600 py-3 text-sm font-bold text-white transition hover:bg-blue-700">
                Save Template
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
