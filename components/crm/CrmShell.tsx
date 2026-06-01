"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, BriefcaseBusiness, CalendarDays, ClipboardList, CreditCard, FileSignature, FileText, Hammer, LayoutDashboard, LogOut, Menu, MessageSquareText, Search, Settings, ShieldCheck, Sparkles, UploadCloud, UsersRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const navigation = [
  { href: "/crm", label: "Dashboard", icon: LayoutDashboard },
  { href: "/crm/conversations", label: "Conversation board", icon: MessageSquareText },
  { href: "/crm/leads", label: "Jobs", icon: BriefcaseBusiness },
  { href: "/crm/customers", label: "Customers", icon: UsersRound },
  { href: "/crm/crew", label: "Crew Workflow", icon: Hammer },
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

function getUserRole(metadata: Record<string, unknown> | undefined) {
  return typeof metadata?.role === "string" ? metadata.role : "admin";
}

export default function CrmShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [userRole, setUserRole] = useState("admin");
  const isCrewUser = userRole === "crew";
  const visibleNavigation = isCrewUser ? navigation.filter((item) => item.href === "/crm/crew") : navigation;

  useEffect(() => {
    let mounted = true;

    createClient().auth.getSession().then(({ data }) => {
      if (!mounted) return;

      if (!data.session) {
        router.replace(`/login?redirectedFrom=${encodeURIComponent(pathname)}`);
        return;
      }

      const role = getUserRole(data.session.user.user_metadata);
      setUserRole(role);

      if (role === "crew" && pathname !== "/crm/crew") {
        router.replace("/crm/crew");
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
    <div className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.22),transparent_30%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.28),transparent_32%),linear-gradient(135deg,#07183f_0%,#0f2156_42%,#1d4ed8_100%)] text-slate-900">
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col overflow-hidden bg-[#07183f] text-white shadow-2xl shadow-slate-950/30 transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.35),transparent_32%),radial-gradient(circle_at_bottom,rgba(59,130,246,0.35),transparent_35%)]" />
        <div className="relative flex h-24 items-center justify-between px-6">
          <Link href={isCrewUser ? "/crm/crew" : "/crm"} className="group flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-lg font-black text-[#07183f] shadow-lg shadow-slate-950/25">XR</span>
            <span>
              <span className="block text-xl font-black tracking-tight">XRP CRM</span>
              <span className="mt-0.5 block text-xs font-bold uppercase tracking-[0.2em] text-orange-200">Roofing OS</span>
            </span>
          </Link>
          <button onClick={() => setOpen(false)} className="rounded-xl p-2 text-blue-100 hover:bg-white/10 lg:hidden"><X className="h-6 w-6" /></button>
        </div>
        <div className="relative mx-4 mb-4 grid grid-cols-3 gap-2 rounded-3xl bg-white/10 p-2 ring-1 ring-white/10">
          {(isCrewUser ? [{ label: "Crew", value: "Portal" }, { label: "Access", value: "Field" }, { label: "Jobs", value: "Only" }] : quickStats).map((stat) => (
            <div key={stat.label} className="rounded-2xl bg-white/10 px-2 py-3 text-center">
              <p className="text-sm font-black text-white">{stat.value}</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-blue-100">{stat.label}</p>
            </div>
          ))}
        </div>
        <nav className="scrollbar-hide relative min-h-0 flex-1 space-y-1 overflow-y-auto px-4 pb-36 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {visibleNavigation.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || (item.href !== "/crm" && pathname.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} className={`group flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-bold transition ${active ? "bg-white text-[#07183f] shadow-lg shadow-slate-950/20" : "text-blue-100 hover:bg-white/10 hover:text-white"}`}>
                <span className="flex items-center gap-3">
                  <span className={`rounded-xl p-2 ${active ? "bg-orange-100 text-orange-600" : "bg-white/10 text-blue-100 group-hover:text-white"}`}><Icon className="h-4 w-4" /></span>
                  {item.label}
                </span>
                {active && <span className="h-2 w-2 rounded-full bg-orange-500" />}
              </Link>
            );
          })}
        </nav>
        <div className="relative mx-4 mb-6 mt-4 rounded-3xl bg-white/10 p-4 text-sm text-blue-100 ring-1 ring-white/10 backdrop-blur">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-orange-300" />
            <p className="font-bold text-white">Secure team workspace</p>
          </div>
          <p className="mt-2 leading-6">{isCrewUser ? "Crew access is limited to assigned roofing workflow only." : "Admin, sales, production, and office workflows in one professional CRM."}</p>
        </div>
      </aside>
      <div className="lg:pl-72">
        <header className="sticky top-0 z-40 border-b border-white/10 bg-[#07183f]/95 text-white shadow-xl shadow-slate-950/20 backdrop-blur-xl">
          <div className="flex h-20 items-center gap-4 px-4 sm:px-6 lg:px-8">
            <button onClick={() => setOpen(true)} className="rounded-xl border border-white/15 bg-white/10 p-2 text-white shadow-sm lg:hidden"><Menu className="h-5 w-5" /></button>
            <div className="hidden min-w-0 lg:block">
              <p className="text-xs font-black uppercase tracking-[0.25em] text-orange-300">{isCrewUser ? "Crew Workspace" : "Command Center"}</p>
              <p className="mt-1 text-sm font-semibold text-blue-100">{isCrewUser ? "Assigned jobs and completion workflow" : "Roofing operations dashboard"}</p>
            </div>
            <div className="relative max-w-2xl flex-1 lg:ml-6">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-blue-100" />
              <input className="w-full rounded-2xl border border-white/15 bg-white/10 py-3 pl-12 pr-4 text-sm text-white shadow-sm outline-none transition placeholder:text-blue-100 focus:border-orange-300 focus:bg-white/15 focus:shadow-md focus:ring-4 focus:ring-orange-300/10" placeholder={isCrewUser ? "Search assigned crew jobs..." : "Search jobs, customers, proposals, invoices..."} />
            </div>
            <button className="relative rounded-2xl border border-white/15 bg-white/10 p-3 text-white shadow-sm hover:bg-white/15">
              <Bell className="h-5 w-5" />
              <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-orange-500 ring-2 ring-white" />
            </button>
            <button className="hidden items-center gap-2 rounded-2xl border border-orange-300/40 bg-orange-400/15 px-4 py-3 text-sm font-black text-orange-100 xl:flex">
              <Sparkles className="h-4 w-4" /> Pro
            </button>
            <button onClick={logout} className="hidden items-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-orange-950/20 transition hover:bg-orange-600 sm:flex">
              <LogOut className="h-4 w-4" /> Logout
            </button>
          </div>
        </header>
        <main className="px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-[1600px] rounded-[2rem] bg-slate-50/95 p-4 shadow-2xl shadow-slate-950/20 backdrop-blur sm:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
