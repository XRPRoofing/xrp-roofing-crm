import { Activity, CalendarClock, CircleDollarSign, ClipboardCheck, Plus, TrendingUp, UsersRound } from "lucide-react";
import { customers, leads, tasks } from "@/lib/crm-data";

const revenue = leads.reduce((total, lead) => total + lead.value, 0);
const openEstimates = leads.filter((lead) => lead.stage === "estimate_sent" || lead.stage === "waiting_approval").length;
const monthlyBars = [35, 62, 48, 76, 58, 88, 71, 94, 67, 82, 91, 100];
const pipelineStages = [
  { label: "New Jobs", value: "32%", color: "bg-blue-500" },
  { label: "Estimates", value: "28%", color: "bg-orange-500" },
  { label: "Production", value: "24%", color: "bg-emerald-500" },
  { label: "Closed", value: "16%", color: "bg-[#07183f]" },
];

export default function CrmDashboardPage() {
  const cards = [
    { label: "Total Leads", value: leads.length.toString(), icon: UsersRound, detail: "+18% this month", tone: "bg-blue-50 text-blue-700" },
    { label: "Pipeline Revenue", value: revenue.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }), icon: CircleDollarSign, detail: "Active opportunities", tone: "bg-orange-50 text-orange-700" },
    { label: "Open Estimates", value: openEstimates.toString(), icon: ClipboardCheck, detail: "Needs follow-up", tone: "bg-emerald-50 text-emerald-700" },
    { label: "Upcoming Appointments", value: "9", icon: CalendarClock, detail: "Next 7 days", tone: "bg-violet-50 text-violet-700" },
  ];

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-blue-100/70 blur-3xl" />
        <div className="absolute bottom-0 right-24 h-32 w-32 rounded-full bg-indigo-100/70 blur-2xl" />
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="relative">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-blue-600">Operations Command Center</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-5xl">Good morning, XRP Roofing team.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">Track leads, roof inspections, estimates, tasks, uploads, and job progress from a single premium CRM workspace.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              {pipelineStages.map((stage) => (
                <span key={stage.label} className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-600">{stage.label} {stage.value}</span>
              ))}
            </div>
          </div>
          <div className="relative flex flex-wrap gap-3">
            <button className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"><Plus className="mr-2 inline h-4 w-4" />New lead</button>
            <button className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50">Schedule inspection</button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="group rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md">
              <div className="flex items-center justify-between">
                <div className={`rounded-2xl p-3 ${card.tone}`}><Icon className="h-6 w-6" /></div>
                <div className="rounded-full bg-emerald-50 p-2 text-emerald-500"><TrendingUp className="h-4 w-4" /></div>
              </div>
              <p className="mt-5 text-sm font-semibold text-slate-500">{card.label}</p>
              <p className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{card.value}</p>
              <p className="mt-1 text-sm text-slate-500">{card.detail}</p>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full w-2/3 rounded-full bg-blue-600 transition-all group-hover:w-5/6" />
              </div>
            </div>
          );
        })}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-slate-950">Revenue overview</h2>
              <p className="mt-1 text-sm text-slate-500">Monthly roofing pipeline performance</p>
            </div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-black text-emerald-700">+24%</span>
          </div>
          <div className="mt-8 flex h-64 items-end gap-3 rounded-3xl border border-slate-100 bg-slate-50 p-5">
            {monthlyBars.map((height, index) => (
              <div key={index} className="flex flex-1 items-end">
                <div className="w-full rounded-t-2xl bg-gradient-to-t from-blue-700 via-blue-600 to-blue-300 shadow-sm" style={{ height: `${height}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            {pipelineStages.map((stage) => (
              <div key={stage.label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className={`mb-3 h-2 rounded-full ${stage.color}`} />
                <p className="text-xs font-black uppercase tracking-wider text-slate-500">{stage.label}</p>
                <p className="mt-1 text-xl font-bold text-slate-950">{stage.value}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-slate-950">Priority reminders</h2>
              <p className="mt-1 text-sm text-slate-500">Today’s most important CRM tasks</p>
            </div>
            <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-black uppercase text-orange-700">{tasks.length} tasks</span>
          </div>
          <div className="mt-5 space-y-3">
            {tasks.map((task) => (
              <div key={task.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-200 hover:shadow-md">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-bold text-slate-900">{task.title}</p>
                    <p className="mt-1 text-sm text-slate-500">{task.relatedTo} • {task.assignedTo}</p>
                  </div>
                  <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-bold uppercase text-orange-700">{task.priority}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-950">Recent customer activity</h2>
            <p className="mt-1 text-sm text-slate-500">Latest customer updates, statuses, and roof details.</p>
          </div>
          <span className="rounded-full bg-blue-50 px-4 py-2 text-xs font-black uppercase text-blue-700">Live feed</span>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {customers.map((customer) => (
            <div key={customer.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><Activity className="h-5 w-5" /></div>
              <p className="mt-3 font-bold">{customer.name}</p>
              <p className="mt-1 text-sm text-slate-500">{customer.status} • {customer.roofDetails}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
