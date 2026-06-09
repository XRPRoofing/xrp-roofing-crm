"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { officeTaskStatuses, readOfficeTasks, updateOfficeTaskStatus, type OfficeTask, type OfficeTaskStatus } from "@/lib/office-tasks";

const statusStyles: Record<OfficeTaskStatus, string> = {
  "For Invoice": "bg-amber-50 text-amber-700 ring-amber-100",
  "Invoice Sent": "bg-blue-50 text-blue-700 ring-blue-100",
  "Invoice Follow Up": "bg-orange-50 text-orange-700 ring-orange-100",
  Paid: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  "Review Request": "bg-violet-50 text-violet-700 ring-violet-100",
  Closed: "bg-slate-100 text-slate-700 ring-slate-200",
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<OfficeTask[]>(() => readOfficeTasks());
  const groupedTasks = useMemo(() => officeTaskStatuses.map((status) => ({ status, tasks: tasks.filter((task) => task.status === status) })), [tasks]);

  useEffect(() => {
    function refreshTasks() {
      setTasks(readOfficeTasks());
    }

    window.addEventListener("crm-office-tasks-updated", refreshTasks);
    window.addEventListener("storage", refreshTasks);
    return () => {
      window.removeEventListener("crm-office-tasks-updated", refreshTasks);
      window.removeEventListener("storage", refreshTasks);
    };
  }, []);

  function handleStatusChange(taskId: string, status: OfficeTaskStatus) {
    updateOfficeTaskStatus(taskId, status);
    setTasks(readOfficeTasks());
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-600">Office Workflow</p>
        <h1 className="mt-1 text-3xl font-black text-[#07183f]">Task Board</h1>
        <p className="crm-board-subtitle mt-2 text-sm font-semibold text-slate-600">Completed jobs (from Jobs or Crew Workflow) automatically create invoice tasks. Use each card&apos;s dropdown to move it through Invoice Sent, Follow Up, Paid, and beyond.</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-3 2xl:grid-cols-6">
        {groupedTasks.map((group) => (
          <section key={group.status} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-black text-slate-950">{group.status}</h2>
              <span className={"rounded-full px-2.5 py-1 text-xs font-black ring-1 " + statusStyles[group.status]}>{group.tasks.length}</span>
            </div>
            <div className="mt-4 space-y-3">
              {group.tasks.map((task) => (
                <article key={task.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-black text-slate-950">{task.title}</p>
                  <div className="mt-2 space-y-1 text-xs font-semibold text-slate-600">
                    <p>Customer: {task.customerName}</p>
                    <p>Address: {task.jobAddress}</p>
                    <p>Invoice: {task.invoiceAmount}</p>
                    <p>Assigned: {task.assignedUser}</p>
                    <p>Due: {task.dueDate}</p>
                    <p>Current Status: {task.status}</p>
                  </div>
                  <div className="mt-3 flex flex-col gap-2">
                    <select value={task.status} onChange={(event) => handleStatusChange(task.id, event.target.value as OfficeTaskStatus)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold outline-none">
                      {officeTaskStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                    <Link href={task.jobLink} className="text-xs font-black text-blue-700 underline">Open Job Workflow</Link>
                  </div>
                </article>
              ))}
              {group.tasks.length === 0 && <p className="rounded-2xl border border-dashed border-slate-200 p-4 text-center text-xs font-semibold text-slate-500">No tasks</p>}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
