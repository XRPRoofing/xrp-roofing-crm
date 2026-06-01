"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, BriefcaseBusiness, CalendarDays, ClipboardList, CreditCard, FileSignature, FileText, Hammer, LayoutDashboard, LogOut, Menu, MessageCircle, MessageSquareText, Search, Settings, ShieldCheck, Sparkles, UploadCloud, UsersRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { markCrmNotificationsRead, readCrmNotifications, type CrmNotification } from "@/lib/crm-notifications";

const navigation = [
  { href: "/crm", label: "Dashboard", shortLabel: "Home", icon: LayoutDashboard },
  { href: "/crm/conversations", label: "Conversation board", shortLabel: "Messages", icon: MessageSquareText },
  { href: "/crm/team-chat", label: "Team Chat", shortLabel: "Chat", icon: MessageCircle },
  { href: "/crm/leads", label: "Jobs", shortLabel: "Jobs", icon: BriefcaseBusiness },
  { href: "/crm/customers", label: "Customers", shortLabel: "Clients", icon: UsersRound },
  { href: "/crm/crew", label: "Crew Workflow", shortLabel: "Crew", icon: Hammer },
  { href: "/crm/proposals", label: "Proposal", shortLabel: "Proposal", icon: FileText },
  { href: "/crm/invoices", label: "Invoice", shortLabel: "Invoice", icon: ClipboardList },
  { href: "/crm/payments", label: "Payments", shortLabel: "Pay", icon: CreditCard },
  { href: "/crm/tasks", label: "Tasks", shortLabel: "Tasks", icon: ClipboardList },
  { href: "/crm/calendar", label: "Calendar", shortLabel: "Calendar", icon: CalendarDays },
  { href: "/crm/pdf-signer-board", label: "PDF Signer Board", shortLabel: "PDF", icon: FileSignature },
  { href: "/crm/files", label: "Files", shortLabel: "Files", icon: UploadCloud },
  { href: "/crm/settings", label: "Settings", shortLabel: "Settings", icon: Settings },
];

const mobilePrimaryNavigation = ["/crm", "/crm/leads", "/crm/crew", "/crm/team-chat", "/crm/files"];

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
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<CrmNotification[]>([]);
  const isCrewUser = userRole === "crew";
  const visibleNavigation = isCrewUser ? navigation.filter((item) => ["/crm/crew", "/crm/team-chat"].includes(item.href)) : navigation;
  const mobileNavigation = isCrewUser ? visibleNavigation : navigation.filter((item) => mobilePrimaryNavigation.includes(item.href));
  const activeModule = visibleNavigation.find((item) => pathname === item.href || (item.href !== "/crm" && pathname.startsWith(item.href)));

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

      if (role === "crew" && !["/crm/crew", "/crm/team-chat"].includes(pathname)) {
        router.replace("/crm/crew");
        return;
      }

      setCheckingAuth(false);
    });

    return () => {
      mounted = false;
    };
  }, [pathname, router]);

  useEffect(() => {
    if (isCrewUser) return;

    function refreshNotifications() {
      setNotifications(readCrmNotifications());
    }

    refreshNotifications();
    window.addEventListener("crm-notifications-updated", refreshNotifications);
    window.addEventListener("storage", refreshNotifications);
    return () => {
      window.removeEventListener("crm-notifications-updated", refreshNotifications);
      window.removeEventListener("storage", refreshNotifications);
    };
  }, [isCrewUser]);

  async function logout() {
    await createClient().auth.signOut();
    router.push("/login");
  }

  function handleToggleNotifications() {
    setNotificationsOpen((current) => !current);
    markCrmNotificationsRead();
    setNotifications(readCrmNotifications());
  }

  const unreadNotifications = notifications.filter((notification) => !notification.read).length;

  if (checkingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#dbeafe,transparent_32%),#f8fafc] text-sm font-semibold text-slate-600">
        <div className="rounded-3xl border border-white/70 bg-white/80 px-6 py-5 shadow-xl shadow-slate-200 backdrop-blur">Opening CRM app...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-100 text-slate-900 lg:bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.22),transparent_30%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.28),transparent_32%),linear-gradient(135deg,#07183f_0%,#0f2156_42%,#1d4ed8_100%)]">
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col overflow-hidden bg-[#07183f] text-white shadow-2xl shadow-slate-950/30 transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.35),transparent_32%),radial-gradient(circle_at_bottom,rgba(59,130,246,0.35),transparent_35%)]" />
        <div className="relative flex h-24 items-center justify-between px-6">
          <Link href={isCrewUser ? "/crm/crew" : "/crm"} className="group flex items-center gap-3" onClick={() => setOpen(false)}>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-lg font-black text-[#07183f] shadow-lg shadow-slate-950/25">XR</span>
            <span>
              <span className="block text-xl font-black tracking-tight">XRP CRM</span>
              <span className="mt-0.5 block text-xs font-bold uppercase tracking-[0.2em] text-orange-200">Roofing OS</span>
            </span>
          </Link>
          <button onClick={() => setOpen(false)} className="rounded-xl p-2 text-blue-100 hover:bg-white/10 lg:hidden"><X className="h-6 w-6" /></button>
        </div>
        <div className="relative mx-4 mb-4 hidden grid-cols-3 gap-2 rounded-3xl bg-white/10 p-2 ring-1 ring-white/10 sm:grid">
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
              <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={`group flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-bold transition ${active ? "bg-white text-[#07183f] shadow-lg shadow-slate-950/20" : "text-blue-100 hover:bg-white/10 hover:text-white"}`}>
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
      {open && <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm lg:hidden" />}
      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 text-slate-900 shadow-sm backdrop-blur-xl lg:border-white/10 lg:bg-[#07183f]/95 lg:text-white lg:shadow-xl lg:shadow-slate-950/20">
          <div className="flex h-16 items-center gap-3 px-3 sm:px-5 lg:h-20 lg:px-8">
            <button onClick={() => setOpen(true)} className="rounded-2xl border border-slate-200 bg-slate-50 p-2.5 text-[#07183f] shadow-sm lg:hidden"><Menu className="h-5 w-5" /></button>
            <div className="min-w-0 flex-1 lg:hidden">
              <p className="truncate text-xs font-black uppercase tracking-[0.18em] text-orange-600">XRP CRM App</p>
              <p className="truncate text-sm font-black text-[#07183f]">{activeModule?.label || "Dashboard"}</p>
            </div>
            <div className="hidden min-w-0 lg:block">
              <p className="text-xs font-black uppercase tracking-[0.25em] text-orange-300">{isCrewUser ? "Crew Workspace" : "Command Center"}</p>
              <p className="mt-1 text-sm font-semibold text-blue-100">{isCrewUser ? "Assigned jobs and completion workflow" : "Roofing operations dashboard"}</p>
            </div>
            <div className="relative hidden max-w-2xl flex-1 lg:ml-6 lg:block">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-blue-100" />
              <input className="w-full rounded-2xl border border-white/15 bg-white/10 py-3 pl-12 pr-4 text-sm text-white shadow-sm outline-none transition placeholder:text-blue-100 focus:border-orange-300 focus:bg-white/15 focus:shadow-md focus:ring-4 focus:ring-orange-300/10" placeholder={isCrewUser ? "Search assigned crew jobs..." : "Search jobs, customers, proposals, invoices..."} />
            </div>
            {!isCrewUser && (
              <div className="relative">
                <button onClick={handleToggleNotifications} className="relative rounded-2xl border border-slate-200 bg-slate-50 p-2.5 text-[#07183f] shadow-sm hover:bg-white lg:border-white/15 lg:bg-white/10 lg:p-3 lg:text-white lg:hover:bg-white/15">
                  <Bell className="h-5 w-5" />
                  {unreadNotifications > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1.5 text-[10px] font-black text-white ring-2 ring-white">{unreadNotifications}</span>}
                </button>
                {notificationsOpen && (
                  <div className="absolute right-0 top-14 z-50 w-80 overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-900 shadow-2xl shadow-slate-950/20">
                    <div className="border-b border-slate-200 p-4">
                      <p className="text-sm font-black text-[#07183f]">Notifications</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">Recent CRM changes and movements</p>
                    </div>
                    <div className="max-h-96 overflow-y-auto p-2">
                      {notifications.map((notification) => (
                        <div key={notification.id} className="rounded-2xl p-3 hover:bg-slate-50">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-black text-slate-900">{notification.title}</p>
                            {!notification.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-orange-500" />}
                          </div>
                          <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">{notification.message}</p>
                          <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">{notification.actor} · {notification.module} · {new Date(notification.createdAt).toLocaleString()}</p>
                        </div>
                      ))}
                      {notifications.length === 0 && <p className="p-5 text-center text-sm font-semibold text-slate-500">No notifications yet.</p>}
                    </div>
                  </div>
                )}
              </div>
            )}
            <button className="hidden items-center gap-2 rounded-2xl border border-orange-300/40 bg-orange-400/15 px-4 py-3 text-sm font-black text-orange-100 xl:flex">
              <Sparkles className="h-4 w-4" /> Pro
            </button>
            <button onClick={logout} className="hidden items-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-orange-950/20 transition hover:bg-orange-600 sm:flex">
              <LogOut className="h-4 w-4" /> Logout
            </button>
          </div>
        </header>
        <main className="px-2 pb-24 pt-3 sm:px-5 sm:py-6 lg:px-8">
          <div className="mx-auto max-w-[1600px] rounded-3xl bg-slate-50 p-3 sm:p-6 lg:rounded-[2rem] lg:bg-slate-50/95 lg:shadow-2xl lg:shadow-slate-950/20 lg:backdrop-blur">{children}</div>
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 shadow-[0_-12px_30px_rgba(15,23,42,0.12)] backdrop-blur-xl lg:hidden">
          <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
            {mobileNavigation.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || (item.href !== "/crm" && pathname.startsWith(item.href));
              return (
                <Link key={item.href} href={item.href} className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-black transition ${active ? "bg-[#07183f] text-white" : "text-slate-500 hover:bg-slate-100 hover:text-[#07183f]"}`}>
                  <Icon className="h-5 w-5" />
                  <span>{item.shortLabel}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
