"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, BriefcaseBusiness, CalendarDays, ClipboardList, CreditCard, FileSignature, FileText, Hammer, LayoutDashboard, LogOut, Menu, MessageCircle, MessageSquareText, Search, Settings, ShieldCheck, UploadCloud, UsersRound, X, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { deleteCrmNotification, markCrmNotificationsRead, readCrmNotifications, type CrmNotification } from "@/lib/crm-notifications";
import { incrementTeamChatUnreadCount, markTeamChatRead, readTeamChatUnreadCount, teamChatRoomId, teamChatTableName, type TeamChatMessage } from "@/lib/team-chat";
import { createBrowserVoiceDevice, subscribeToConversationEvents, type BrowserVoiceCall, type BrowserVoiceDevice } from "@/lib/twilio/client";
import { addTwilioCrmNotification, getTwilioEventPhone } from "@/lib/twilio/notifications";
import { subscribeToCrewData } from "@/lib/crew-sync";
import { PhoneLink } from "@/components/ContactLinks";
import { subscribeToInvoiceShares } from "@/lib/invoice-sync";
import { subscribeToProposalRecords } from "@/lib/proposal-sync";
import { subscribeToCustomerRecords } from "@/lib/customer-sync";
import { subscribeToTaskUpdates } from "@/lib/task-sync";
import { deleteNotificationFromSupabase, loadNotificationsFromSupabase, markNotificationsReadInSupabase, subscribeToNotifications } from "@/lib/notification-sync";

const navigation = [
  { href: "/crm", label: "Dashboard", shortLabel: "Home", icon: LayoutDashboard },
  { href: "/crm/tasks", label: "Tasks", shortLabel: "Tasks", icon: ClipboardList },
  { href: "/crm/conversations", label: "Conversation board", shortLabel: "Messages", icon: MessageSquareText },
  { href: "/crm/team-chat", label: "Team Chat", shortLabel: "Chat", icon: MessageCircle },
  { href: "/crm/leads", label: "Jobs", shortLabel: "Jobs", icon: BriefcaseBusiness },
  { href: "/crm/customers", label: "Customers", shortLabel: "Clients", icon: UsersRound },
  { href: "/crm/crew", label: "Crew Workflow", shortLabel: "Crew", icon: Hammer },
  { href: "/crm/proposals", label: "Proposal", shortLabel: "Proposal", icon: FileText },
  { href: "/crm/invoices", label: "Invoice", shortLabel: "Invoice", icon: ClipboardList },
  { href: "/crm/payments", label: "Payments", shortLabel: "Pay", icon: CreditCard },
  { href: "/crm/calendar", label: "Calendar", shortLabel: "Calendar", icon: CalendarDays },
  { href: "/crm/pdf-signer-board", label: "PDF Signer Board", shortLabel: "PDF", icon: FileSignature },
  { href: "/crm/files", label: "Files", shortLabel: "Files", icon: UploadCloud },
  { href: "/crm/automations", label: "Automations", shortLabel: "Auto", icon: Zap },
  { href: "/crm/settings", label: "Settings", shortLabel: "Settings", icon: Settings },
];

const mobilePrimaryNavigation = ["/crm", "/crm/team-chat", "/crm/leads", "/crm/calendar", "/crm/crew", "/crm/payments", "/crm/files"];

const quickStats = [
  { label: "Live jobs", value: "24" },
  { label: "Pipeline", value: "$1.2M" },
  { label: "Tasks", value: "18" },
];

type SearchResult = {
  category: "Jobs" | "Customers" | "Proposals" | "Invoices";
  label: string;
  sub: string;
  href: string;
  icon: "job" | "customer" | "proposal" | "invoice";
};

function getUserRole(metadata: Record<string, unknown> | undefined) {
  return typeof metadata?.role === "string" ? metadata.role : "admin";
}

export default function CrmShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [userRole, setUserRole] = useState("admin");
  const [currentUserId, setCurrentUserId] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<CrmNotification[]>([]);
  const [unreadTeamChatCount, setUnreadTeamChatCount] = useState(0);
  const voiceDeviceRef = useRef<BrowserVoiceDevice | null>(null);
  const incomingCallRef = useRef<BrowserVoiceCall | null>(null);
  const [globalIncomingCall, setGlobalIncomingCall] = useState<{ name: string; phone: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchIndex, setSearchIndex] = useState(-1);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const mobileSearchRef = useRef<HTMLDivElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);
  const isCrewUser = userRole === "crew";
  const visibleNavigation = isCrewUser ? navigation.filter((item) => ["/crm/crew", "/crm/team-chat"].includes(item.href)) : navigation;
  const mobileNavigation = isCrewUser
    ? visibleNavigation
    : mobilePrimaryNavigation
        .map((href) => navigation.find((item) => item.href === href))
        .filter((item): item is (typeof navigation)[number] => Boolean(item));
  const activeModule = visibleNavigation.find((item) => pathname === item.href || (item.href !== "/crm" && pathname.startsWith(item.href)));

  useEffect(() => {
    let mounted = true;

    if (process.env.NEXT_PUBLIC_TEST_BYPASS_AUTH === "1") {
      setUserRole("admin");
      setCheckingAuth(false);
      return () => {
        mounted = false;
      };
    }

    createClient().auth.getSession().then(({ data }) => {
      if (!mounted) return;

      if (!data.session) {
        router.replace(`/login?redirectedFrom=${encodeURIComponent(pathname)}`);
        return;
      }

      const role = getUserRole(data.session.user.user_metadata);
      setCurrentUserId(data.session.user.id);
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

    // Load from Supabase first for cross-device sync, then fall back to localStorage
    void loadNotificationsFromSupabase().then((n) => setNotifications(n)).catch(() => refreshNotifications());

    // Subscribe to real-time notification changes from Supabase
    const unsubRemote = subscribeToNotifications((n) => setNotifications(n));

    window.addEventListener("crm-notifications-updated", refreshNotifications);
    window.addEventListener("storage", refreshNotifications);
    return () => {
      unsubRemote();
      window.removeEventListener("crm-notifications-updated", refreshNotifications);
      window.removeEventListener("storage", refreshNotifications);
    };
  }, [isCrewUser]);

  useEffect(() => {
    if (isCrewUser) return;

    try {
      return subscribeToConversationEvents((event) => {
        addTwilioCrmNotification(event);
        setNotifications(readCrmNotifications());

        if (event.type === "incoming_call") {
          const phone = getTwilioEventPhone(event);
          setGlobalIncomingCall({ name: phone || "Unknown caller", phone: phone || "Unknown number" });
          window.setTimeout(() => setGlobalIncomingCall(null), 30000);
        }
      });
    } catch {
      return undefined;
    }
  }, [isCrewUser]);


  useEffect(() => {
    if (isCrewUser) return;
    let mounted = true;

    async function registerGlobalVoiceDevice() {
      try {
        const device = await createBrowserVoiceDevice("crm-agent");
        if (!mounted) {
          device.destroy();
          return;
        }

        voiceDeviceRef.current = device;
        device.on("incoming", (call) => {
          const incoming = call as BrowserVoiceCall;
          const phone = incoming.parameters?.From || "Unknown number";
          incomingCallRef.current = incoming;
          setGlobalIncomingCall({ name: phone, phone });
          incoming.on("cancel", () => {
            incomingCallRef.current = null;
            setGlobalIncomingCall(null);
          });
          incoming.on("disconnect", () => {
            incomingCallRef.current = null;
            setGlobalIncomingCall(null);
          });
        });
        device.on("unregistered", () => {
          void device.register().catch(() => undefined);
        });
        await device.register();
      } catch {
        voiceDeviceRef.current = null;
      }
    }

    registerGlobalVoiceDevice();

    return () => {
      mounted = false;
      voiceDeviceRef.current?.destroy();
      voiceDeviceRef.current = null;
      incomingCallRef.current = null;
    };
  }, [isCrewUser]);

  useEffect(() => {
    function refreshUnreadTeamChatCount() {
      setUnreadTeamChatCount(readTeamChatUnreadCount());
    }

    refreshUnreadTeamChatCount();
    window.addEventListener("team-chat-unread-updated", refreshUnreadTeamChatCount);
    window.addEventListener("storage", refreshUnreadTeamChatCount);
    return () => {
      window.removeEventListener("team-chat-unread-updated", refreshUnreadTeamChatCount);
      window.removeEventListener("storage", refreshUnreadTeamChatCount);
    };
  }, []);

  useEffect(() => {
    if (!currentUserId || pathname === "/crm/team-chat") return;

    const supabase = createClient();
    const channel = supabase
      .channel("team-chat-global-unread")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: teamChatTableName, filter: `room_id=eq.${teamChatRoomId}` },
        (payload) => {
          const nextMessage = payload.new as TeamChatMessage;
          if (nextMessage.user_id !== currentUserId) {
            incrementTeamChatUnreadCount();
            if (Notification.permission === "granted" && typeof document !== "undefined" && document.visibilityState !== "visible") {
              new Notification("XRP Team Chat", {
                body: nextMessage.message ? nextMessage.message.slice(0, 80) : "New message",
                icon: "/icons/icon-192.png",
                badge: "/icons/icon-192.png",
                tag: "team-chat",
              });
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, pathname]);

  useEffect(() => {
    if (pathname === "/crm/team-chat") {
      markTeamChatRead();
    }
  }, [pathname]);

  // Sync unread count to the PWA app icon badge (Works on installed PWA —
  // Android Chrome + iOS Safari 16.4+).
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if ("setAppBadge" in navigator) {
      if (unreadTeamChatCount > 0) {
        void (navigator as Navigator & { setAppBadge: (n: number) => Promise<void> }).setAppBadge(unreadTeamChatCount);
      } else {
        void (navigator as Navigator & { clearAppBadge: () => Promise<void> }).clearAppBadge();
      }
    }
  }, [unreadTeamChatCount]);

  // Request notification permission once so OS push toasts work.
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }, []);

  const runSearch = useCallback((query: string) => {
    if (!query.trim()) { setSearchResults([]); setSearchOpen(false); return; }
    const q = query.toLowerCase();
    // Normalize a phone string to digits, stripping US country code "1" from 11-digit numbers
    function normPhone(raw: string): string {
      const digits = raw.replace(/\D/g, "");
      return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    }
    const qPhone = normPhone(query);
    const results: SearchResult[] = [];
    const MAX = 20;

    // Match against standard haystack OR normalized phone digits
    function hit(fields: (string | undefined)[], phones: (string | undefined)[]): boolean {
      const haystack = fields.filter(Boolean).join(" ").toLowerCase();
      if (haystack.includes(q)) return true;
      if (qPhone.length >= 2) {
        const phonesNorm = phones.filter(Boolean).map((p) => normPhone(p!)).join(" ");
        if (phonesNorm.includes(qPhone)) return true;
      }
      return false;
    }

    try {
      const jobs = JSON.parse(window.localStorage.getItem("xrp-crm-jobs-board") || "[]") as { id: string; name?: string; email?: string; phone?: string; address?: string; city?: string; stage?: string; roofType?: string; assignedTo?: string; source?: string }[];
      for (const job of jobs) {
        if (results.length >= MAX) break;
        if (hit([job.name, job.email, job.phone, job.address, job.city, job.stage, job.roofType, job.assignedTo, job.source], [job.phone]))
          results.push({ category: "Jobs", label: job.name || job.id, sub: [job.address, job.city].filter(Boolean).join(", "), href: `/crm/leads?job=${encodeURIComponent(job.id)}`, icon: "job" });
      }
    } catch {}

    try {
      const customers = JSON.parse(window.localStorage.getItem("xrp-crm-customers") || "[]") as { id: string; name?: string; email?: string; phone?: string; propertyAddress?: string; roofDetails?: string; insuranceCarrier?: string; status?: string }[];
      for (const c of customers) {
        if (results.length >= MAX) break;
        if (hit([c.name, c.email, c.phone, c.propertyAddress, c.roofDetails, c.insuranceCarrier, c.status], [c.phone]))
          results.push({ category: "Customers", label: c.name || c.id, sub: c.email || c.phone || c.propertyAddress || "", href: `/crm/customers?customer=${encodeURIComponent(c.id)}`, icon: "customer" });
      }
    } catch {}

    try {
      const proposals = JSON.parse(window.localStorage.getItem("xrp-crm-proposals") || "[]") as { id: string; customerName?: string; customerEmail?: string; customerPhone?: string; address?: string; scope?: string; title?: string; total?: number; status?: string; deletedAt?: string }[];
      for (const p of proposals) {
        if (results.length >= MAX) break;
        if (p.deletedAt) continue;
        if (hit([p.customerName, p.customerEmail, p.customerPhone, p.address, p.scope, p.title, p.status], [p.customerPhone]))
          results.push({ category: "Proposals", label: p.title || p.customerName || p.id, sub: p.address || p.customerEmail || "", href: `/crm/proposals?proposal=${encodeURIComponent(p.id)}`, icon: "proposal" });
      }
    } catch {}

    try {
      const invoices = JSON.parse(window.localStorage.getItem("xrp-crm-invoices") || "[]") as { id: string; invoiceNumber?: string; clientName?: string; email?: string; phone?: string; propertyAddress?: string; jobName?: string; status?: string; isDeleted?: boolean }[];
      for (const inv of invoices) {
        if (results.length >= MAX) break;
        if (inv.isDeleted) continue;
        if (hit([inv.invoiceNumber, inv.clientName, inv.email, inv.phone, inv.propertyAddress, inv.jobName, inv.status], [inv.phone]))
          results.push({ category: "Invoices", label: inv.invoiceNumber || inv.id, sub: [inv.clientName, inv.propertyAddress].filter(Boolean).join(" — "), href: `/crm/invoices?invoice=${encodeURIComponent(inv.id)}`, icon: "invoice" });
      }
    } catch {}

    setSearchResults(results);
    setSearchOpen(results.length > 0);
    setSearchIndex(-1);
  }, []);

  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setSearchOpen(false); return; }
    if (!searchOpen || searchResults.length === 0) {
      if (e.key === "Enter") { runSearch(searchQuery); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setSearchIndex((i) => Math.min(i + 1, searchResults.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSearchIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && searchIndex >= 0) { e.preventDefault(); navigateToResult(searchResults[searchIndex]); }
  }

  function navigateToResult(result: SearchResult) {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    setMobileSearchOpen(false);
    router.push(result.href);
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const inDesktop = searchRef.current?.contains(e.target as Node);
      const inMobile = mobileSearchRef.current?.contains(e.target as Node);
      if (!inDesktop && !inMobile) setSearchOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function logout() {
    await createClient().auth.signOut();
    router.push("/login");
  }

  function handleToggleNotifications() {
    setNotificationsOpen((current) => !current);
    markCrmNotificationsRead();
    const updated = readCrmNotifications();
    setNotifications(updated);
    void markNotificationsReadInSupabase(updated);
  }

  function handleDeleteNotification(notificationId: string) {
    deleteCrmNotification(notificationId);
    setNotifications(readCrmNotifications());
    void deleteNotificationFromSupabase(notificationId);
  }

  function handleAnswerGlobalIncomingCall() {
    const incoming = incomingCallRef.current;
    if (!incoming) {
      router.push("/crm/conversations");
      return;
    }

    incoming.accept();
    (window as unknown as { __xrpActiveIncomingCall?: BrowserVoiceCall }).__xrpActiveIncomingCall = incoming;
    setGlobalIncomingCall(null);
    router.push("/crm/conversations?activeCall=1");
  }

  function handleDeclineGlobalIncomingCall() {
    incomingCallRef.current?.reject();
    incomingCallRef.current = null;
    setGlobalIncomingCall(null);
  }

  const [syncActive, setSyncActive] = useState(false);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Global real-time sync indicator — flashes when any Supabase table changes
  useEffect(() => {
    if (!hasSupabaseConfig()) return;
    function flash() {
      setSyncActive(true);
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = setTimeout(() => setSyncActive(false), 2000);
    }
    const unsubs = [
      subscribeToCrewData(flash),
      subscribeToInvoiceShares(() => flash()),
      subscribeToProposalRecords(flash),
      subscribeToCustomerRecords(flash),
      subscribeToTaskUpdates(() => flash()),
    ];
    return () => {
      unsubs.forEach((unsub) => unsub());
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, []);

  const unreadNotifications = notifications.filter((notification) => !notification.read && notification.status !== "archived").length;
  const showTeamChatFloatingButton = pathname !== "/crm/team-chat" && pathname !== "/crm/conversations";

  if (checkingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#dbeafe,transparent_32%),#f8fafc] text-sm font-semibold text-slate-600">
        <div className="rounded-3xl border border-white/70 bg-white/80 px-6 py-5 shadow-xl shadow-slate-200 backdrop-blur">Opening CRM app...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-clip bg-slate-100 text-slate-900 lg:bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.22),transparent_30%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.28),transparent_32%),linear-gradient(135deg,#07183f_0%,#0f2156_42%,#1d4ed8_100%)]">
      {globalIncomingCall && !isCrewUser && (
        <div className="fixed right-4 top-24 z-[80] w-[min(92vw,380px)] rounded-3xl border border-orange-200 bg-white p-5 text-slate-950 shadow-2xl shadow-slate-950/25">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-600">Incoming Call</p>
          <p className="mt-2 text-xl font-black">{globalIncomingCall.name}</p>
          <p className="mt-1 text-sm font-bold text-slate-600"><PhoneLink value={globalIncomingCall.phone} /></p>
          <div className="mt-4 flex gap-2">
            <button onClick={handleAnswerGlobalIncomingCall} className="flex-1 rounded-2xl bg-emerald-600 px-4 py-3 text-center text-sm font-black text-white transition hover:bg-emerald-700">Answer</button>
            <button onClick={handleDeclineGlobalIncomingCall} className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white transition hover:bg-slate-800">Decline</button>
          </div>
        </div>
      )}
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
            const showChatBadge = item.href === "/crm/team-chat" && unreadTeamChatCount > 0;
            return (
              <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={`group flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-bold transition ${active ? "bg-white text-[#07183f] shadow-lg shadow-slate-950/20" : "text-blue-100 hover:bg-white/10 hover:text-white"}`}>
                <span className="flex items-center gap-3">
                  <span className={`relative rounded-xl p-2 ${active ? "bg-orange-100 text-orange-600" : "bg-white/10 text-blue-100 group-hover:text-white"}`}>
                    <Icon className="h-4 w-4" />
                    {showChatBadge && <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-black text-white ring-2 ring-[#07183f]">{unreadTeamChatCount}</span>}
                  </span>
                  {item.label}
                </span>
                {showChatBadge ? <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-black text-white">{unreadTeamChatCount}</span> : active && <span className="h-2 w-2 rounded-full bg-orange-500" />}
              </Link>
            );
          })}
        </nav>
        <button onClick={() => { logout(); setOpen(false); }} className="relative mx-4 mb-2 flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold text-red-300 transition hover:bg-white/10 hover:text-red-200">
          <span className="rounded-xl bg-white/10 p-2 text-red-300"><LogOut className="h-4 w-4" /></span>
          Logout
        </button>
        <div className="relative mx-4 mb-6 mt-2 rounded-3xl bg-white/10 p-4 text-sm text-blue-100 ring-1 ring-white/10 backdrop-blur">
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
              <div className="flex items-center gap-2">
                <p className="truncate text-xs font-black uppercase tracking-[0.18em] text-orange-600">XRP CRM App</p>
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${syncActive ? "bg-emerald-500 animate-pulse" : "bg-emerald-400/60"}`} title={syncActive ? "Syncing" : "Live"} />
              </div>
              <p className="truncate text-sm font-black text-[#07183f]">{activeModule?.label || "Dashboard"}</p>
            </div>
            <button type="button" onClick={() => { setMobileSearchOpen((v) => !v); setTimeout(() => mobileSearchInputRef.current?.focus(), 100); }} className="rounded-2xl border border-slate-200 bg-slate-50 p-2.5 text-[#07183f] shadow-sm hover:bg-white lg:hidden"><Search className="h-5 w-5" /></button>
            <div className="hidden min-w-0 lg:block">
              <p className="text-xs font-black uppercase tracking-[0.25em] text-orange-300">{isCrewUser ? "Crew Workspace" : "Command Center"}</p>
              <p className="mt-1 text-sm font-semibold text-blue-100">{isCrewUser ? "Assigned jobs and completion workflow" : "Roofing operations dashboard"}</p>
            </div>
            <div ref={searchRef} className="relative hidden max-w-2xl flex-1 lg:ml-6 lg:block">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-blue-100" />
              <input value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); runSearch(e.target.value); }} onKeyDown={handleSearchKeyDown} onFocus={() => { if (searchResults.length > 0) setSearchOpen(true); }} className="w-full rounded-2xl border border-white/15 bg-white/10 py-3 pl-12 pr-4 text-sm text-white shadow-sm outline-none transition placeholder:text-blue-100 focus:border-orange-300 focus:bg-white/15 focus:shadow-md focus:ring-4 focus:ring-orange-300/10" placeholder={isCrewUser ? "Search assigned crew jobs..." : "Search jobs, customers, proposals, invoices..."} />
              {searchOpen && searchResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-96 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
                  {(["Jobs", "Customers", "Proposals", "Invoices"] as const).map((cat) => {
                    const items = searchResults.filter((r) => r.category === cat);
                    if (items.length === 0) return null;
                    return (
                      <div key={cat}>
                        <p className="sticky top-0 bg-slate-50 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{cat}</p>
                        {items.map((result, i) => {
                          const globalIdx = searchResults.indexOf(result);
                          return (
                            <button key={`${result.category}-${i}`} type="button" onClick={() => navigateToResult(result)} className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-50 ${globalIdx === searchIndex ? "bg-blue-50" : ""}`}>
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                                {result.icon === "job" && <BriefcaseBusiness className="h-4 w-4" />}
                                {result.icon === "customer" && <UsersRound className="h-4 w-4" />}
                                {result.icon === "proposal" && <FileText className="h-4 w-4" />}
                                {result.icon === "invoice" && <ClipboardList className="h-4 w-4" />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-bold text-slate-900">{result.label}</span>
                                {result.sub && <span className="block truncate text-xs text-slate-500">{result.sub}</span>}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
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
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{notification.actor} · {notification.module} · {new Date(notification.createdAt).toLocaleString()}</p>
                            <button onClick={() => handleDeleteNotification(notification.id)} className="rounded-full px-2 py-1 text-[11px] font-black text-red-600 hover:bg-red-50">Delete</button>
                          </div>
                        </div>
                      ))}
                      {notifications.length === 0 && <p className="p-5 text-center text-sm font-semibold text-slate-500">No notifications yet.</p>}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="hidden items-center gap-2 rounded-2xl border border-emerald-300/40 bg-emerald-400/15 px-3 py-2 text-xs font-black text-emerald-100 xl:flex" title="Real-time sync active across all devices">
              <span className={`inline-block h-2 w-2 rounded-full ${syncActive ? "bg-emerald-400 animate-pulse" : "bg-emerald-400/60"}`} />
              <span>{syncActive ? "Syncing" : "Live"}</span>
            </div>
            <button onClick={logout} className="hidden items-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-orange-950/20 transition hover:bg-orange-600 sm:flex">
              <LogOut className="h-4 w-4" /> Logout
            </button>
          </div>
          {mobileSearchOpen && (
            <div ref={mobileSearchRef} className="relative border-t border-slate-200 px-3 py-2 lg:hidden">
              <Search className="absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input ref={mobileSearchInputRef} value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); runSearch(e.target.value); }} onKeyDown={handleSearchKeyDown} onFocus={() => { if (searchResults.length > 0) setSearchOpen(true); }} className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:ring-2 focus:ring-orange-300/20" placeholder={isCrewUser ? "Search crew jobs..." : "Search jobs, customers, proposals, invoices..."} />
              {searchOpen && searchResults.length > 0 && (
                <div className="absolute left-3 right-3 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
                  {(["Jobs", "Customers", "Proposals", "Invoices"] as const).map((cat) => {
                    const items = searchResults.filter((r) => r.category === cat);
                    if (items.length === 0) return null;
                    return (
                      <div key={cat}>
                        <p className="sticky top-0 bg-slate-50 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{cat}</p>
                        {items.map((result, i) => {
                          const globalIdx = searchResults.indexOf(result);
                          return (
                            <button key={`${result.category}-${i}`} type="button" onClick={() => { navigateToResult(result); setMobileSearchOpen(false); }} className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-50 ${globalIdx === searchIndex ? "bg-blue-50" : ""}`}>
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                                {result.icon === "job" && <BriefcaseBusiness className="h-4 w-4" />}
                                {result.icon === "customer" && <UsersRound className="h-4 w-4" />}
                                {result.icon === "proposal" && <FileText className="h-4 w-4" />}
                                {result.icon === "invoice" && <ClipboardList className="h-4 w-4" />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-bold text-slate-900">{result.label}</span>
                                {result.sub && <span className="block truncate text-xs text-slate-500">{result.sub}</span>}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </header>
        <main className="crm-main px-2 pb-24 pt-3 sm:px-5 sm:py-6 lg:px-8">
          <div className="mx-auto max-w-[1600px] rounded-3xl bg-slate-50 p-3 sm:p-6 lg:rounded-[2rem] lg:bg-slate-50/95 lg:shadow-2xl lg:shadow-slate-950/20 lg:backdrop-blur">{children}</div>
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 shadow-[0_-12px_30px_rgba(15,23,42,0.12)] backdrop-blur-xl lg:hidden">
          <div className={`mx-auto grid max-w-md gap-1 ${mobileNavigation.length >= 7 ? "grid-cols-7" : mobileNavigation.length >= 6 ? "grid-cols-6" : "grid-cols-5"}`}>
            {mobileNavigation.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || (item.href !== "/crm" && pathname.startsWith(item.href));
              const showChatBadge = item.href === "/crm/team-chat" && unreadTeamChatCount > 0;
              return (
                <Link key={item.href} href={item.href} className={`relative flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-black transition ${active ? "bg-[#07183f] text-white" : "text-slate-500 hover:bg-slate-100 hover:text-[#07183f]"}`}>
                  <span className="relative">
                    <Icon className="h-5 w-5" />
                    {showChatBadge && <span className="absolute -right-3 -top-3 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-black text-white ring-2 ring-white">{unreadTeamChatCount}</span>}
                  </span>
                  <span>{item.shortLabel}</span>
                </Link>
              );
            })}

          </div>
        </nav>
        {showTeamChatFloatingButton && (
          <Link href="/crm/team-chat" className="fixed bottom-24 right-5 z-40 flex items-center gap-3 rounded-full bg-[#07183f] px-4 py-3 text-sm font-black text-white shadow-2xl shadow-blue-950/30 ring-4 ring-white/80 transition hover:-translate-y-0.5 hover:bg-blue-800 lg:bottom-8">
            <span className="relative rounded-full bg-orange-500 p-2">
              <MessageCircle className="h-5 w-5" />
              {unreadTeamChatCount > 0 && <span className="absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-black text-white ring-2 ring-white">{unreadTeamChatCount}</span>}
            </span>
            <span className="hidden sm:block">{unreadTeamChatCount > 0 ? `${unreadTeamChatCount} unread` : "Team Chat"}</span>
          </Link>
        )}
      </div>
    </div>
  );
}
