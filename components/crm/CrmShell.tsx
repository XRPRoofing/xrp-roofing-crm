"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, BriefcaseBusiness, CalendarDays, ClipboardList, CreditCard, FileSignature, FileText, Hammer, LayoutDashboard, LogOut, Menu, MessageCircle, MessageSquareText, Search, Settings, UploadCloud, UsersRound, X, Zap } from "lucide-react";
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
import { subscribeToCustomerRecords, loadCustomerRecords } from "@/lib/customer-sync";
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
  const activeModule = visibleNavigation.find((item) => pathname === item.href || (item.href !== "/crm" && pathname.startsWith(item.href)));

  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    let mounted = true;

    if (process.env.NEXT_PUBLIC_TEST_BYPASS_AUTH === "1") {
      setUserRole("admin");
      setCheckingAuth(false);
      return () => { mounted = false; };
    }

    createClient().auth.getSession().then(({ data }) => {
      if (!mounted) return;

      if (!data.session) {
        router.replace(`/login?redirectedFrom=${encodeURIComponent(pathnameRef.current)}`);
        return;
      }

      const role = getUserRole(data.session.user.user_metadata);
      setCurrentUserId(data.session.user.id);
      setUserRole(role);

      if (role === "crew" && !["/crm/crew", "/crm/team-chat"].includes(pathnameRef.current)) {
        router.replace("/crm/crew");
        return;
      }

      setCheckingAuth(false);
    });

    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (isCrewUser) return;

    function refreshNotifications() {
      setNotifications(readCrmNotifications());
    }

    void loadNotificationsFromSupabase().then((n) => setNotifications(n)).catch(() => refreshNotifications());

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

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }, []);

  const runSearch = useCallback((query: string) => {
    if (!query.trim()) { setSearchResults([]); setSearchOpen(false); return; }
    const q = query.toLowerCase();
    function normPhone(raw: string): string {
      const digits = raw.replace(/\D/g, "");
      return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    }
    const qPhone = normPhone(query);
    const results: SearchResult[] = [];
    const MAX = 20;

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

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedSearch = useCallback((query: string) => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!query.trim()) { setSearchResults([]); setSearchOpen(false); return; }
    searchDebounceRef.current = setTimeout(() => runSearch(query), 200);
  }, [runSearch]);

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
      subscribeToCustomerRecords(() => { flash(); void loadCustomerRecords(); }),
      subscribeToTaskUpdates(() => flash()),
    ];
    return () => {
      unsubs.forEach((unsub) => unsub());
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, []);

  useEffect(() => { void loadCustomerRecords(); }, []);

  const unreadNotifications = notifications.filter((notification) => !notification.read && notification.status !== "archived").length;
  const showTeamChatFloatingButton = pathname !== "/crm/team-chat" && pathname !== "/crm/conversations";

  const mobileBottomNav = isCrewUser ? [] : [
    { href: "/crm", label: "Home", icon: LayoutDashboard },
    { href: "/crm/leads", label: "Jobs", icon: BriefcaseBusiness },
    { href: "/crm/customers", label: "Clients", icon: UsersRound },
    { href: "/crm/calendar", label: "Calendar", icon: CalendarDays },
    { href: "/crm/payments", label: "Pay", icon: CreditCard },
    { href: "/crm/invoices", label: "Invoices", icon: ClipboardList },
    { href: "/crm/files", label: "Files", icon: UploadCloud },
  ];

  if (checkingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-5 py-4 text-sm font-medium text-gray-600 shadow-sm">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen min-h-[100dvh] overflow-x-hidden bg-gray-50">
      {/* Incoming Call Banner */}
      {globalIncomingCall && !isCrewUser && (
        <div className="fixed right-4 top-4 z-[80] w-[min(92vw,360px)] rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">Incoming Call</p>
          <p className="mt-1 text-lg font-bold text-gray-900">{globalIncomingCall.name}</p>
          <p className="mt-0.5 text-sm text-gray-500"><PhoneLink value={globalIncomingCall.phone} /></p>
          <div className="mt-3 flex gap-2">
            <button onClick={handleAnswerGlobalIncomingCall} className="flex-1 rounded-lg bg-green-600 px-3 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-green-700">Answer</button>
            <button onClick={handleDeclineGlobalIncomingCall} className="flex-1 rounded-lg bg-red-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700">Decline</button>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-gray-200 bg-white transition-transform duration-200 lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-gray-100 px-5">
          <Link href={isCrewUser ? "/crm/crew" : "/crm"} className="flex items-center gap-3" onClick={() => setOpen(false)}>
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">XR</span>
            <span className="text-base font-bold text-gray-900">XRP Roofing</span>
          </Link>
          <button onClick={() => setOpen(false)} className="ml-auto rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 lg:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="space-y-0.5">
            {visibleNavigation.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || (item.href !== "/crm" && pathname.startsWith(item.href));
              const showChatBadge = item.href === "/crm/team-chat" && unreadTeamChatCount > 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${active ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
                >
                  <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-blue-600" : "text-gray-400 group-hover:text-gray-600"}`} />
                  <span className="flex-1">{item.label}</span>
                  {showChatBadge && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1.5 text-[10px] font-bold text-white">{unreadTeamChatCount}</span>
                  )}
                  {active && !showChatBadge && <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />}
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Sidebar Footer */}
        <div className="border-t border-gray-100 px-3 py-3">
          <button onClick={() => { logout(); setOpen(false); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900">
            <LogOut className="h-[18px] w-[18px] text-gray-400" />
            <span>Log out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Overlay */}
      {open && <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-x-clip lg:pl-64">
        {/* Top Header */}
        <header className="sticky top-0 z-30 border-b border-gray-200 bg-white">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            {/* Hamburger (mobile) */}
            <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 lg:hidden">
              <Menu className="h-5 w-5" />
            </button>

            {/* Page Title (mobile) */}
            <div className="min-w-0 flex-1 lg:hidden">
              <p className="truncate text-sm font-semibold text-gray-900">{activeModule?.label || "Dashboard"}</p>
            </div>

            {/* Desktop Search */}
            <div ref={searchRef} className="relative hidden max-w-lg flex-1 lg:block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); debouncedSearch(e.target.value); }}
                onKeyDown={handleSearchKeyDown}
                onFocus={() => { if (searchResults.length > 0) setSearchOpen(true); }}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-4 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
                placeholder={isCrewUser ? "Search crew jobs..." : "Search jobs, customers, proposals, invoices..."}
              />
              {searchOpen && searchResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                  {(["Jobs", "Customers", "Proposals", "Invoices"] as const).map((cat) => {
                    const items = searchResults.filter((r) => r.category === cat);
                    if (items.length === 0) return null;
                    return (
                      <div key={cat}>
                        <p className="sticky top-0 bg-gray-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{cat}</p>
                        {items.map((result, i) => {
                          const globalIdx = searchResults.indexOf(result);
                          return (
                            <button key={`${result.category}-${i}`} type="button" onClick={() => navigateToResult(result)} className={`flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-gray-50 ${globalIdx === searchIndex ? "bg-blue-50" : ""}`}>
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-500">
                                {result.icon === "job" && <BriefcaseBusiness className="h-3.5 w-3.5" />}
                                {result.icon === "customer" && <UsersRound className="h-3.5 w-3.5" />}
                                {result.icon === "proposal" && <FileText className="h-3.5 w-3.5" />}
                                {result.icon === "invoice" && <ClipboardList className="h-3.5 w-3.5" />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-gray-900">{result.label}</span>
                                {result.sub && <span className="block truncate text-xs text-gray-500">{result.sub}</span>}
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

            {/* Right Actions */}
            <div className="flex items-center gap-2">
              {/* Sync indicator */}
              <div className="hidden items-center gap-1.5 rounded-md border border-gray-100 px-2.5 py-1.5 text-xs font-medium text-gray-500 sm:flex">
                <span className={`inline-block h-2 w-2 rounded-full ${syncActive ? "bg-green-500 animate-pulse" : "bg-gray-300"}`} />
                <span>{syncActive ? "Syncing" : "Live"}</span>
              </div>

              {/* Mobile Search Toggle */}
              <button type="button" onClick={() => { setMobileSearchOpen((v) => !v); setTimeout(() => mobileSearchInputRef.current?.focus(), 100); }} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 lg:hidden">
                <Search className="h-5 w-5" />
              </button>

              {/* Notifications */}
              {!isCrewUser && (
                <div className="relative">
                  <button onClick={handleToggleNotifications} className="relative rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700">
                    <Bell className="h-5 w-5" />
                    {unreadNotifications > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unreadNotifications}</span>}
                  </button>
                  {notificationsOpen && (
                    <div className="absolute right-0 top-12 z-50 w-80 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                      <div className="border-b border-gray-100 px-4 py-3">
                        <p className="text-sm font-semibold text-gray-900">Notifications</p>
                      </div>
                      <div className="max-h-80 overflow-y-auto">
                        {notifications.map((notification) => (
                          <div key={notification.id} className="border-b border-gray-50 px-4 py-3 hover:bg-gray-50">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-medium text-gray-900">{notification.title}</p>
                              {!notification.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
                            </div>
                            <p className="mt-0.5 text-xs text-gray-500">{notification.message}</p>
                            <div className="mt-2 flex items-center justify-between">
                              <p className="text-[11px] text-gray-400">{notification.actor} · {notification.module} · {new Date(notification.createdAt).toLocaleString()}</p>
                              <button onClick={() => handleDeleteNotification(notification.id)} className="text-[11px] font-medium text-red-500 hover:text-red-700">Delete</button>
                            </div>
                          </div>
                        ))}
                        {notifications.length === 0 && <p className="p-5 text-center text-sm text-gray-400">No notifications yet.</p>}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Logout (desktop) */}
              <button onClick={logout} className="hidden items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-gray-800 sm:flex lg:flex">
                <LogOut className="h-4 w-4" /> Log out
              </button>
            </div>
          </div>

          {/* Mobile Search Expanded */}
          {mobileSearchOpen && (
            <div ref={mobileSearchRef} className="border-t border-gray-100 px-4 py-2 lg:hidden">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  ref={mobileSearchInputRef}
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); debouncedSearch(e.target.value); }}
                  onKeyDown={handleSearchKeyDown}
                  onFocus={() => { if (searchResults.length > 0) setSearchOpen(true); }}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-4 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
                  placeholder={isCrewUser ? "Search crew jobs..." : "Search jobs, customers, proposals, invoices..."}
                />
              </div>
              {searchOpen && searchResults.length > 0 && (
                <div className="mt-1 max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                  {(["Jobs", "Customers", "Proposals", "Invoices"] as const).map((cat) => {
                    const items = searchResults.filter((r) => r.category === cat);
                    if (items.length === 0) return null;
                    return (
                      <div key={cat}>
                        <p className="sticky top-0 bg-gray-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{cat}</p>
                        {items.map((result, i) => {
                          const globalIdx = searchResults.indexOf(result);
                          return (
                            <button key={`${result.category}-${i}`} type="button" onClick={() => { navigateToResult(result); setMobileSearchOpen(false); }} className={`flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-gray-50 ${globalIdx === searchIndex ? "bg-blue-50" : ""}`}>
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-500">
                                {result.icon === "job" && <BriefcaseBusiness className="h-3.5 w-3.5" />}
                                {result.icon === "customer" && <UsersRound className="h-3.5 w-3.5" />}
                                {result.icon === "proposal" && <FileText className="h-3.5 w-3.5" />}
                                {result.icon === "invoice" && <ClipboardList className="h-3.5 w-3.5" />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-gray-900">{result.label}</span>
                                {result.sub && <span className="block truncate text-xs text-gray-500">{result.sub}</span>}
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

        {/* Main Content */}
        <main className={`crm-main flex flex-1 flex-col overflow-x-clip px-3 py-2 sm:px-6 sm:py-6 ${mobileBottomNav.length > 0 ? "pb-20 lg:pb-6" : ""}`}>
          <div className="mx-auto flex min-h-0 max-w-full flex-1 flex-col lg:max-w-[1400px]">{children}</div>
        </main>
      </div>

      {/* Mobile Bottom Navigation — rendered at root level so no parent transform/flex can break fixed positioning */}
      {mobileBottomNav.length > 0 && (
        <nav className="fixed inset-x-0 bottom-0 z-[9999] border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" style={{ transform: "translateZ(0)", WebkitTransform: "translateZ(0)", willChange: "transform", touchAction: "none", WebkitBackfaceVisibility: "hidden", backfaceVisibility: "hidden" }}>
          <div className="flex items-center justify-around px-1 py-1">
            {mobileBottomNav.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || (item.href !== "/crm" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] font-medium transition-colors ${
                    active ? "text-blue-600" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  <Icon className={`h-5 w-5 shrink-0 ${active ? "text-blue-600" : "text-gray-400"}`} />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      {/* Team Chat FAB */}
      {showTeamChatFloatingButton && (
        <Link href="/crm/team-chat" className={`fixed right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition hover:bg-blue-700 hover:shadow-xl sm:h-auto sm:w-auto sm:gap-2 sm:rounded-lg sm:px-4 sm:py-3 ${mobileBottomNav.length > 0 ? "bottom-[72px] lg:bottom-6" : "bottom-6"}`}>
          <span className="relative">
            <MessageCircle className="h-5 w-5" />
            {unreadTeamChatCount > 0 && <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white">{unreadTeamChatCount}</span>}
          </span>
          <span className="hidden text-sm font-medium sm:block">{unreadTeamChatCount > 0 ? `${unreadTeamChatCount} unread` : "Team Chat"}</span>
        </Link>
      )}
    </div>
  );
}
