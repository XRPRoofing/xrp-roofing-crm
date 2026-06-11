"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckSquare, ChevronDown, ChevronRight, Clock, RefreshCw, Star, ThumbsDown, ThumbsUp, Trash2, X, Zap } from "lucide-react";
import {
  addTaskTimelineEntry,
  deleteOfficeTask,
  officeTaskStatusColors,
  officeTaskStatuses,
  readOfficeTasks,
  recordCustomerSatisfaction,
  recordReviewRequestSent,
  updateOfficeTaskStatus,
  type OfficeTask,
  type OfficeTaskStatus,
} from "@/lib/office-tasks";
import { deleteTaskFromSupabase, loadTasksFromSupabase, subscribeToTaskUpdates } from "@/lib/task-sync";

function fmt(iso: string) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
}

function MetricCard({ label, value, active, onClick, color }: { label: string; value: number; active: boolean; onClick: () => void; color: string }) {
  return (
    <button type="button" onClick={onClick} className={`flex flex-col items-start rounded-2xl border p-3 text-left transition hover:shadow-md ${active ? "ring-2 ring-blue-500 " + color : "border-slate-200 bg-white"}`}>
      <span className="text-2xl font-black text-[#07183f]">{value}</span>
      <span className="mt-0.5 text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</span>
    </button>
  );
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<OfficeTask[]>(() => readOfficeTasks());
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [filterStatus, setFilterStatus] = useState<OfficeTaskStatus | null>(null);
  const [selectedTask, setSelectedTask] = useState<OfficeTask | null>(null);
  const [satModal, setSatModal] = useState<OfficeTask | null>(null);
  const [satResult, setSatResult] = useState<"yes" | "no" | null>(null);
  const [satNotes, setSatNotes] = useState("");
  const [timelineOpen, setTimelineOpen] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [expandedCol, setExpandedCol] = useState<OfficeTaskStatus | null>(null);
  const dragOverCol = useRef<OfficeTaskStatus | null>(null);

  const refresh = useCallback(async () => {
    const fresh = await loadTasksFromSupabase();
    setTasks(fresh);
    setLastSync(new Date());
    setLoading(false);
  }, []);

  // Initial load from Supabase
  useEffect(() => { void refresh(); }, [refresh]);

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

  const groupedTasks = useMemo(() =>
    officeTaskStatuses.map((status) => ({
      status,
      tasks: tasks.filter((t) => t.status === status && (!filterStatus || t.status === filterStatus)),
    })), [tasks, filterStatus]);

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

  function deleteTask(task: OfficeTask) {
    if (!window.confirm(`Delete task for "${task.customerName}"? This cannot be undone.`)) return;
    deleteOfficeTask(task.id);
    void deleteTaskFromSupabase(task.id);
    setSelectedTask(null);
    setTasks((current) => current.filter((t) => t.id !== task.id));
  }

  function moveTask(taskId: string, status: OfficeTaskStatus) {
    updateOfficeTaskStatus(taskId, status);
    refresh();
    if (selectedTask?.id === taskId) setSelectedTask((prev) => prev ? { ...prev, status } : null);
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

  function submitSatisfaction() {
    if (!satModal || !satResult) return;
    recordCustomerSatisfaction(satModal.id, satResult === "yes", satNotes);
    if (satResult === "yes") {
      recordReviewRequestSent(satModal.id, true, true);
      addTaskTimelineEntry(satModal.id, "Review Request Sent via SMS + Email", undefined, "System");
    }
    setSatModal(null);
    refresh();
  }

  const colors = officeTaskStatusColors;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-600">Office Workflow</p>
          <h1 className="mt-1 text-2xl font-black text-[#07183f] sm:text-3xl">Task Board</h1>
          <div className="mt-1 flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${loading ? "bg-yellow-400 animate-pulse" : "bg-emerald-500"}`} />
            <p className="text-xs font-semibold text-slate-500">
              {loading ? "Syncing…" : `Live · ${tasks.length} tasks${lastSync ? ` · Updated ${lastSync.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}` : ""}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setLoading(true); void refresh(); }} className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 active:scale-95">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          {filterStatus && (
            <button onClick={() => setFilterStatus(null)} className="flex items-center gap-2 rounded-2xl bg-blue-600 px-3 py-2 text-xs font-black text-white">
              <X className="h-4 w-4" /> {filterStatus}
            </button>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-11">
        <MetricCard label="Scheduled"   value={metrics.scheduled}   active={filterStatus === "Job Scheduled"}         onClick={() => setFilterStatus(filterStatus === "Job Scheduled" ? null : "Job Scheduled")}         color="bg-blue-50 border-blue-300" />
        <MetricCard label="In Progress" value={metrics.inProgress}  active={filterStatus === "Job In Progress"}       onClick={() => setFilterStatus(filterStatus === "Job In Progress" ? null : "Job In Progress")}       color="bg-orange-50 border-orange-300" />
        <MetricCard label="Completed"   value={metrics.completed}   active={filterStatus === "Job Completed"}         onClick={() => setFilterStatus(filterStatus === "Job Completed" ? null : "Job Completed")}         color="bg-purple-50 border-purple-300" />
        <MetricCard label="For Invoice" value={metrics.forInvoice}  active={filterStatus === "For Invoice"}           onClick={() => setFilterStatus(filterStatus === "For Invoice" ? null : "For Invoice")}           color="bg-amber-50 border-amber-300" />
        <MetricCard label="Inv. Sent"   value={metrics.invoiceSent} active={filterStatus === "Invoice Sent"}          onClick={() => setFilterStatus(filterStatus === "Invoice Sent" ? null : "Invoice Sent")}          color="bg-sky-50 border-sky-300" />
        <MetricCard label="Follow Up"   value={metrics.followUp}    active={filterStatus === "Invoice Follow Up"}     onClick={() => setFilterStatus(filterStatus === "Invoice Follow Up" ? null : "Invoice Follow Up")}     color="bg-yellow-50 border-yellow-300" />
        <MetricCard label="Paid"         value={metrics.paid}        active={filterStatus === "Paid"}                  onClick={() => setFilterStatus(filterStatus === "Paid" ? null : "Paid")}                  color="bg-emerald-50 border-emerald-300" />
        <MetricCard label="Rev. Reqs"   value={metrics.reviewReqs}  active={filterStatus === "Review Request"}        onClick={() => setFilterStatus(filterStatus === "Review Request" ? null : "Review Request")}        color="bg-indigo-50 border-indigo-300" />
        <MetricCard label="Reviews"     value={metrics.reviewRcvd}  active={filterStatus === "Review Received"}       onClick={() => setFilterStatus(filterStatus === "Review Received" ? null : "Review Received")}       color="bg-green-50 border-green-300" />
        <MetricCard label="Unsatisfied" value={metrics.unsatisfied} active={false}                                    onClick={() => {}}                                                                                  color="bg-red-50 border-red-300" />
        <MetricCard label="Closed"      value={metrics.closed}      active={filterStatus === "Closed"}                onClick={() => setFilterStatus(filterStatus === "Closed" ? null : "Closed")}                color="bg-slate-100 border-slate-300" />
      </div>

      {/* Mobile Accordion (sm and below) */}
      <div className="space-y-2 lg:hidden">
        {groupedTasks.map(({ status, tasks: colTasks }) => {
          const c = colors[status];
          const isOpen = expandedCol === status;
          const hasAlert = (status === "Customer Satisfaction" && colTasks.some((t) => !t.satisfactionChecked))
            || (status === "Review Request" && colTasks.some((t) => !t.reviewRequestSentAt));
          return (
            <div key={status} className={`overflow-hidden rounded-2xl border ${c.border} bg-white shadow-sm`}>
              <button
                type="button"
                onClick={() => setExpandedCol(isOpen ? null : status)}
                className={`flex w-full items-center justify-between px-4 py-3.5 ${c.bg} active:opacity-80`}
              >
                <div className="flex items-center gap-2.5">
                  <span className={`h-2.5 w-2.5 rounded-full ${c.dot}`} />
                  <span className={`text-sm font-black ${c.text}`}>{status}</span>
                  {hasAlert && <span className="h-2 w-2 rounded-full bg-red-500" />}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-black ${c.bg} ${c.text}`}>{colTasks.length}</span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${c.text} ${isOpen ? "rotate-180" : ""}`} />
                </div>
              </button>
              {isOpen && (
                <div className="space-y-2 p-2">
                  {colTasks.length === 0 && (
                    <p className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-xs font-semibold text-slate-400">No tasks in this column</p>
                  )}
                  {colTasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => setSelectedTask(task)}
                      className={`w-full rounded-xl border bg-white p-3 text-left shadow-sm active:scale-[0.98] ${c.border}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-slate-900">{task.customerName}</p>
                          <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{task.jobAddress}</p>
                        </div>
                        <span className="shrink-0 text-sm font-black text-emerald-700">{task.invoiceAmount}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-xs text-slate-400">{task.assignedUser}</span>
                        <div className="flex items-center gap-1.5">
                          {task.satisfactionResult === "yes" && <ThumbsUp className="h-3.5 w-3.5 text-emerald-500" />}
                          {task.satisfactionResult === "no" && <ThumbsDown className="h-3.5 w-3.5 text-red-500" />}
                          {task.reviewSubmitted && <Star className="h-3.5 w-3.5 text-yellow-500" />}
                          {task.invoiceNumber && <span className="text-[10px] font-bold text-slate-400">#{task.invoiceNumber}</span>}
                        </div>
                      </div>
                      {status === "Customer Satisfaction" && !task.satisfactionChecked && (
                        <div className="mt-2 rounded-lg bg-teal-50 px-3 py-1.5 text-xs font-black text-teal-700">⚡ Satisfaction check needed</div>
                      )}
                      {status === "Review Request" && !task.reviewRequestSentAt && (
                        <div className="mt-2 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-black text-indigo-700">⚡ Review request not sent yet</div>
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
      <div className="hidden gap-3 overflow-x-auto pb-4 lg:flex">
        {groupedTasks.map(({ status, tasks: colTasks }) => {
          const c = colors[status];
          return (
            <section
              key={status}
              className="flex w-56 shrink-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm"
              onDragOver={(e) => { e.preventDefault(); dragOverCol.current = status; }}
              onDrop={() => handleDrop(status)}
            >
              {/* Column header */}
              <div className={`flex items-center justify-between rounded-t-2xl border-b px-3 py-2.5 ${c.bg} ${c.border}`}>
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${c.dot}`} />
                  <h2 className={`text-[11px] font-black uppercase tracking-wide ${c.text}`}>{status}</h2>
                </div>
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${c.bg} ${c.text}`}>{colTasks.length}</span>
              </div>

              {/* Cards */}
              <div className="flex min-h-[80px] flex-1 flex-col gap-1.5 overflow-y-auto p-1.5">
                {colTasks.map((task) => (
                  <article
                    key={task.id}
                    draggable
                    onDragStart={() => setDraggedId(task.id)}
                    onDragEnd={() => setDraggedId(null)}
                    onClick={() => setSelectedTask(task)}
                    className={`cursor-pointer rounded-xl border bg-white p-2.5 shadow-sm transition hover:shadow-md hover:-translate-y-0.5 ${draggedId === task.id ? "opacity-40" : ""} ${c.border}`}
                  >
                    <p className="truncate text-xs font-black text-slate-900">{task.customerName}</p>
                    <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-500">{task.jobAddress}</p>
                    <div className="mt-1.5 flex items-center justify-between gap-1">
                      <span className="text-[10px] font-black text-emerald-700">{task.invoiceAmount}</span>
                      {task.satisfactionResult === "yes" && <ThumbsUp className="h-3 w-3 text-emerald-500" />}
                      {task.satisfactionResult === "no" && <ThumbsDown className="h-3 w-3 text-red-500" />}
                      {task.reviewSubmitted && <Star className="h-3 w-3 text-yellow-500" />}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-1">
                      <span className="truncate text-[10px] text-slate-400">{task.assignedUser}</span>
                      {task.invoiceNumber && <span className="text-[9px] font-bold text-slate-400">#{task.invoiceNumber}</span>}
                    </div>
                    {/* Quick actions */}
                    {status === "Customer Satisfaction" && !task.satisfactionChecked && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); openSatModal(task); }} className="mt-2 w-full rounded-lg bg-teal-600 py-1 text-[10px] font-black text-white hover:bg-teal-700">
                        <CheckSquare className="mr-1 inline h-3 w-3" />Satisfaction Check
                      </button>
                    )}
                    {status === "Review Request" && !task.reviewRequestSentAt && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); recordReviewRequestSent(task.id, true, true); addTaskTimelineEntry(task.id, "Review Request Sent (SMS + Email)", undefined, "Office"); refresh(); }} className="mt-2 w-full rounded-lg bg-indigo-600 py-1 text-[10px] font-black text-white hover:bg-indigo-700">
                        <Zap className="mr-1 inline h-3 w-3" />Send Review Request
                      </button>
                    )}
                  </article>
                ))}
                {colTasks.length === 0 && (
                  <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200 py-6 text-[10px] font-semibold text-slate-400">Empty</div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* Task Detail Drawer */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" onClick={() => setSelectedTask(null)}>
          <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" />
          <div className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`text-[10px] font-black uppercase tracking-widest ${officeTaskStatusColors[selectedTask.status].text}`}>{selectedTask.status}</p>
                <h2 className="mt-1 text-lg font-black text-[#07183f]">{selectedTask.customerName}</h2>
                <p className="text-sm font-semibold text-slate-500">{selectedTask.jobAddress}</p>
              </div>
              <button onClick={() => setSelectedTask(null)} className="rounded-xl p-2 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              {[
                ["Invoice #", selectedTask.invoiceNumber || "—"],
                ["Amount", selectedTask.invoiceAmount],
                ["Inv. Status", selectedTask.invoiceStatus || "—"],
                ["Assigned", selectedTask.assignedUser],
                ["Due", selectedTask.dueDate],
                ["Created", fmt(selectedTask.createdAt)],
              ].map(([label, val]) => (
                <div key={label} className="rounded-xl bg-slate-50 px-3 py-2">
                  <p className="font-black uppercase tracking-wide text-slate-400" style={{ fontSize: "9px" }}>{label}</p>
                  <p className="mt-0.5 font-bold text-slate-800">{val}</p>
                </div>
              ))}
            </div>

            {/* Satisfaction */}
            {selectedTask.satisfactionChecked && (
              <div className={`mt-4 rounded-2xl p-3 ${selectedTask.satisfactionResult === "yes" ? "bg-emerald-50" : "bg-red-50"}`}>
                <p className="text-xs font-black text-slate-700">Customer Satisfaction</p>
                <p className={`mt-1 text-sm font-black ${selectedTask.satisfactionResult === "yes" ? "text-emerald-700" : "text-red-700"}`}>
                  {selectedTask.satisfactionResult === "yes" ? "✓ Satisfied" : "✗ Not Satisfied"}
                </p>
                {selectedTask.satisfactionNotes && <p className="mt-1 text-xs text-slate-600">{selectedTask.satisfactionNotes}</p>}
              </div>
            )}

            {/* Review tracking */}
            {selectedTask.reviewRequestSentAt && (
              <div className="mt-4 rounded-2xl bg-indigo-50 p-3">
                <p className="text-xs font-black text-indigo-700">Review Request Sent</p>
                <p className="mt-0.5 text-[11px] text-indigo-600">{fmt(selectedTask.reviewRequestSentAt)}</p>
                <div className="mt-1 flex gap-2 text-[10px] font-bold">
                  {selectedTask.reviewSmsSent && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-indigo-700">SMS ✓</span>}
                  {selectedTask.reviewEmailSent && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-indigo-700">Email ✓</span>}
                  {selectedTask.reviewSubmitted && <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">Review Received ✓</span>}
                </div>
              </div>
            )}

            {/* Move to column */}
            <div className="mt-4">
              <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Move to</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {officeTaskStatuses.filter((s) => s !== selectedTask.status).map((s) => {
                  const c = officeTaskStatusColors[s];
                  return (
                    <button key={s} type="button" onClick={() => { moveTask(selectedTask.id, s); setSelectedTask((prev) => prev ? { ...prev, status: s } : null); }} className={`rounded-xl px-2.5 py-1.5 text-[10px] font-black transition hover:opacity-80 ${c.bg} ${c.text}`}>{s}</button>
                  );
                })}
              </div>
            </div>

            {/* Satisfaction CTA */}
            {selectedTask.status === "Customer Satisfaction" && !selectedTask.satisfactionChecked && (
              <button type="button" onClick={() => openSatModal(selectedTask)} className="mt-4 w-full rounded-2xl bg-teal-600 py-3 text-sm font-black text-white hover:bg-teal-700">
                <CheckSquare className="mr-2 inline h-4 w-4" />Run Satisfaction Check
              </button>
            )}

            {/* Review request CTA */}
            {selectedTask.status === "Review Request" && !selectedTask.reviewRequestSentAt && (
              <button type="button" onClick={() => { recordReviewRequestSent(selectedTask.id, true, true); addTaskTimelineEntry(selectedTask.id, "Review Request Sent (SMS + Email)", undefined, "Office"); refresh(); setSelectedTask((prev) => prev ? { ...prev, reviewRequestSentAt: new Date().toISOString() } : null); }} className="mt-4 w-full rounded-2xl bg-indigo-600 py-3 text-sm font-black text-white hover:bg-indigo-700">
                <Zap className="mr-2 inline h-4 w-4" />Send Review Request (SMS + Email)
              </button>
            )}

            {/* Review received CTA */}
            {selectedTask.status === "Review Request" && selectedTask.reviewRequestSentAt && !selectedTask.reviewSubmitted && (
              <button type="button" onClick={() => { moveTask(selectedTask.id, "Review Received"); refresh(); setSelectedTask(null); }} className="mt-2 w-full rounded-2xl border border-green-300 bg-green-50 py-3 text-sm font-black text-green-700 hover:bg-green-100">
                <Star className="mr-2 inline h-4 w-4" />Mark Review Received
              </button>
            )}

            {/* Close task */}
            {!["Closed"].includes(selectedTask.status) && (
              <button type="button" onClick={() => { moveTask(selectedTask.id, "Closed"); setSelectedTask(null); }} className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 text-sm font-black text-slate-600 hover:bg-slate-100">
                Close Task
              </button>
            )}

            {/* Open job link */}
            <Link href={selectedTask.jobLink} className="mt-3 block text-center text-xs font-black text-blue-700 underline">Open Job Record</Link>

            {/* Delete task */}
            <button type="button" onClick={() => deleteTask(selectedTask)} className="mt-3 w-full rounded-2xl border border-red-200 bg-red-50 py-2.5 text-sm font-black text-red-700 transition hover:bg-red-100 flex items-center justify-center gap-2">
              <Trash2 className="h-4 w-4" />Delete Task
            </button>

            {/* Timeline */}
            <div className="mt-4">
              <button type="button" onClick={() => setTimelineOpen(timelineOpen === selectedTask.id ? null : selectedTask.id)} className="flex w-full items-center gap-2 text-xs font-black text-slate-500">
                {timelineOpen === selectedTask.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Activity Timeline ({selectedTask.timeline?.length || 0} events)
              </button>
              {timelineOpen === selectedTask.id && selectedTask.timeline && selectedTask.timeline.length > 0 && (
                <ol className="mt-2 space-y-2 border-l-2 border-slate-200 pl-4">
                  {[...selectedTask.timeline].reverse().map((entry) => (
                    <li key={entry.id} className="relative">
                      <span className="absolute -left-[1.35rem] top-1 h-2.5 w-2.5 rounded-full bg-blue-500 ring-2 ring-white" />
                      <p className="text-[11px] font-black text-slate-800">{entry.event}</p>
                      {entry.note && <p className="text-[10px] text-slate-500">{entry.note}</p>}
                      <p className="flex items-center gap-1 text-[10px] text-slate-400"><Clock className="h-3 w-3" />{fmt(entry.at)}{entry.by ? ` · ${entry.by}` : ""}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Customer Satisfaction Modal */}
      {satModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => setSatModal(null)}>
          <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" />
          <div className="relative z-10 w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-[10px] font-black uppercase tracking-widest text-teal-600">Customer Satisfaction Check</p>
            <h2 className="mt-2 text-lg font-black text-[#07183f]">Was the customer satisfied?</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">{satModal.customerName} — {satModal.jobAddress}</p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setSatResult("yes")} className={`flex items-center justify-center gap-2 rounded-2xl border-2 py-4 text-sm font-black transition ${satResult === "yes" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600 hover:border-emerald-300"}`}>
                <ThumbsUp className="h-5 w-5" /> Yes
              </button>
              <button type="button" onClick={() => setSatResult("no")} className={`flex items-center justify-center gap-2 rounded-2xl border-2 py-4 text-sm font-black transition ${satResult === "no" ? "border-red-500 bg-red-50 text-red-700" : "border-slate-200 text-slate-600 hover:border-red-300"}`}>
                <ThumbsDown className="h-5 w-5" /> No
              </button>
            </div>

            <textarea value={satNotes} onChange={(e) => setSatNotes(e.target.value)} placeholder="Optional notes..." rows={2} className="mt-4 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-teal-400" />

            {satResult === "yes" && (
              <div className="mt-3 rounded-2xl bg-indigo-50 p-3 text-xs font-semibold text-indigo-700">
                <p className="font-black">Will automatically:</p>
                <p className="mt-1">• Move to Review Request</p>
                <p>• Send Google Review SMS + Email</p>
                <p>• Log timeline entry</p>
              </div>
            )}
            {satResult === "no" && (
              <div className="mt-3 rounded-2xl bg-red-50 p-3 text-xs font-semibold text-red-700">
                <p className="font-black">Review request will NOT be sent.</p>
                <p className="mt-1">• Office staff will be notified</p>
                <p>• Follow-up task will be created</p>
              </div>
            )}

            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setSatModal(null)} className="flex-1 rounded-2xl border border-slate-200 py-3 text-sm font-black text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="button" disabled={!satResult} onClick={submitSatisfaction} className="flex-1 rounded-2xl bg-teal-600 py-3 text-sm font-black text-white transition hover:bg-teal-700 disabled:opacity-50">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
