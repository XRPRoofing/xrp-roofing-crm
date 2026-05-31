"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, BriefcaseBusiness, CalendarDays, ClipboardList, CreditCard, FileSignature, FileText, LayoutDashboard, LogOut, Menu, MessageSquareText, Search, Settings, ShieldCheck, Sparkles, UploadCloud, UsersRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const navigation = [
  { href: "/crm", label: "Dashboard", icon: LayoutDashboard },
  { href: "/crm/conversations", label: "Conversation board", icon: MessageSquareText },
  { href: "/crm/leads", label: "Jobs", icon: BriefcaseBusiness },
  { href: "/crm/customers", label: "Customers", icon: UsersRound },
  { href: "/crm/proposals", label: "Proposal", icon: FileText },
  { href: "/crm/invoices", label: "Invoice", icon: ClipboardList },
  { href: "/crm/payments", label: "Payments", icon: CreditCard },
  { href: "/crm/tasks", label: "Tasks", icon: ClipboardList },
  { href: "/crm/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/crm/pdf-signer-board", label: "PDF Signer Board", icon: FileSignature },
  { href: "/crm/files", label: "Files", icon: UploadCloud },
  { href: "/crm/settings", label: "Settings", icon: Settings },
];

const quickStats = [
  { label: "Live jobs", value: "24" },
  { label: "Pipeline", value: "$1.2M" },
  { label: "Tasks", value: "18" },
];

export default function CrmShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    let mounted = true;

    createClient().auth.getSession().then(({ data }) => {
      if (!mounted) return;

      if (!data.session) {
        router.replace(`/login?redirectedFrom=${encodeURIComponent(pathname)}`);
        return;
      }

      setCheckingAuth(false);
    });

    return () => {
      mounted = false;
    };
  }, [pathname, router]);

  async function logout() {
    await createClient().auth.signOut();
    router.push("/login");
  }

  if (checkingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#dbeafe,transparent_32%),#f8fafc] text-sm font-semibold text-slate-600">
        <div className="rounded-3xl border border-white/70 bg-white/80 px-6 py-5 shadow-xl shadow-slate-200 backdrop-blur">Opening CRM workspace...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <aside className={`fixed inset-y-0 left-0 z-50 w-72 overflow-hidden border-r border-slate-200 bg-white text-slate-900 shadow-xl shadow-slate-200/70 transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="relative flex h-24 items-center justify-between px-6">
          <Link href="/crm" className="group flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-lg font-black text-white shadow-lg shadow-blue-200">XR</span>
            <span>
              <span className="block text-xl font-black tracking-tight text-slate-950">XRP CRM</span>
              <span className="mt-0.5 block text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Roofing OS</span>
            </span>
          </Link>
          <button onClick={() => setOpen(false)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 lg:hidden"><X className="h-6 w-6" /></button>
        </div>
        <div className="relative mx-4 mb-4 grid grid-cols-3 gap-2 rounded-3xl border border-slate-200 bg-slate-50 p-2">
          {quickStats.map((stat) => (
            <div key={stat.label} className="rounded-2xl bg-white px-2 py-3 text-center shadow-sm">
              <p className="text-sm font-black text-slate-950">{stat.value}</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{stat.label}</p>
            </div>
          ))}
        </div>
        <nav className="relative space-y-1 px-4">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || (item.href !== "/crm" && pathname.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} className={`group flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-bold transition ${active ? "bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-100" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}>
                <span className="flex items-center gap-3">
                  <span className={`rounded-xl p-2 ${active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500 group-hover:bg-white group-hover:text-blue-600"}`}><Icon className="h-4 w-4" /></span>
                  {item.label}
                </span>
                {active && <span className="h-2 w-2 rounded-full bg-blue-600" />}
              </Link>
            );
          })}
        </nav>
        <div className="absolute bottom-6 left-4 right-4 rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-blue-600" />
            <p className="font-bold text-slate-950">Secure team workspace</p>
          </div>
          <p className="mt-2 leading-6">Admin, sales, production, and office workflows in one professional CRM.</p>
        </div>
      </aside>
      <div className="lg:pl-72">
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 shadow-sm shadow-slate-200/60 backdrop-blur-xl">
          <div className="flex h-20 items-center gap-4 px-4 sm:px-6 lg:px-8">
            <button onClick={() => setOpen(true)} className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm lg:hidden"><Menu className="h-5 w-5" /></button>
            <div className="hidden min-w-0 lg:block">
              <p className="text-xs font-black uppercase tracking-[0.25em] text-blue-600">Command Center</p>
              <p className="mt-1 text-sm font-semibold text-slate-500">Roofing operations dashboard</p>
            </div>
            <div className="relative max-w-2xl flex-1 lg:ml-6">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-12 pr-4 text-sm shadow-sm outline-none transition focus:border-blue-300 focus:bg-white focus:shadow-md focus:ring-4 focus:ring-blue-50" placeholder="Search jobs, customers, proposals, invoices..." />
            </div>
            <button className="relative rounded-2xl border border-slate-200 bg-white p-3 text-slate-600 shadow-sm hover:bg-slate-50">
              <Bell className="h-5 w-5" />
              <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-orange-500 ring-2 ring-white" />
            </button>
            <button className="hidden items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-black text-blue-700 xl:flex">
              <Sparkles className="h-4 w-4" /> Pro
            </button>
            <button onClick={logout} className="hidden items-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700 sm:flex">
              <LogOut className="h-4 w-4" /> Logout
            </button>
          </div>
        </header>
        <main className="px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
