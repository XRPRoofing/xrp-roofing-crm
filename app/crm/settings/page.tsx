import { Building2, CreditCard, Mail, PhoneCall, PlugZap, ShieldCheck, UsersRound } from "lucide-react";

const settingsSections = [
  {
    title: "Company Profile",
    description: "Manage XRP Roofing business details, logo, address, licenses, and proposal branding.",
    icon: Building2,
    status: "Ready",
    items: ["Business name", "Logo and brand colors", "ROC/license details"],
  },
  {
    title: "Team",
    description: "Control team members, roles, permissions, and who can access each CRM workspace.",
    icon: UsersRound,
    status: "Admin",
    items: ["Users", "Roles", "Access permissions"],
  },
  {
    title: "Phone Integration",
    description: "Connect calling, SMS, voicemail, and conversation tracking for the communication center.",
    icon: PhoneCall,
    status: "Twilio",
    items: ["Outbound calls", "SMS messaging", "Call notes"],
  },
  {
    title: "System Email",
    description: "Configure proposal emails, invoice emails, notification senders, and email templates.",
    icon: Mail,
    status: "Email",
    items: ["Proposal sender", "Invoice sender", "Templates"],
  },
  {
    title: "Stripe",
    description: "Manage payment checkout, invoice payment links, payment status, and webhook settings.",
    icon: CreditCard,
    status: "Payments",
    items: ["Checkout", "Webhooks", "Payment status"],
  },
  {
    title: "Integrations",
    description: "Connect external tools like Google Calendar, Supabase, forms, and production workflows.",
    icon: PlugZap,
    status: "Apps",
    items: ["Google Calendar", "Supabase", "External tools"],
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#07183f] via-[#0f2156] to-[#1d4ed8] p-6 text-white shadow-2xl shadow-blue-950/20">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-300">Admin Center</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">Settings</h1>
            <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-blue-100">Manage company setup, users, communication tools, email, payments, and CRM integrations from one place.</p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-black text-white">
            <ShieldCheck className="mr-2 inline h-4 w-4 text-orange-300" />
            Secure workspace
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="px-3 pb-3 pt-2 text-xs font-black uppercase tracking-[0.2em] text-slate-500">Settings Menu</p>
          <div className="space-y-1">
            {settingsSections.map((section) => {
              const Icon = section.icon;

              return (
                <button key={section.title} type="button" className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-black text-slate-700 transition hover:bg-blue-50 hover:text-blue-700">
                  <span className="rounded-xl bg-slate-100 p-2 text-slate-600"><Icon className="h-4 w-4" /></span>
                  {section.title}
                </button>
              );
            })}
          </div>
        </aside>

        <section className="grid gap-4 md:grid-cols-2">
          {settingsSections.map((section) => {
            const Icon = section.icon;

            return (
              <div key={section.title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
                <div className="flex items-start justify-between gap-4">
                  <span className="rounded-2xl bg-blue-50 p-3 text-blue-700"><Icon className="h-6 w-6" /></span>
                  <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-black text-orange-700">{section.status}</span>
                </div>
                <h2 className="mt-5 text-xl font-black text-[#07183f]">{section.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{section.description}</p>
                <div className="mt-5 space-y-2">
                  {section.items.map((item) => (
                    <div key={item} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
                      <span>{item}</span>
                      <span className="text-blue-600">Open</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
