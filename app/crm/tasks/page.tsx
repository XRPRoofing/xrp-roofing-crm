import { tasks } from "@/lib/crm-data";

export default function TasksPage() {
  return <div className="space-y-5"><h1 className="text-3xl font-black text-[#07183f]">Tasks</h1>{tasks.map((task) => <div key={task.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-4"><div><p className="font-black">{task.title}</p><p className="mt-1 text-sm text-slate-500">{task.relatedTo} • {task.assignedTo} • Due {task.dueDate}</p></div><span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-bold uppercase text-orange-700">{task.priority}</span></div></div>)}</div>;
}
