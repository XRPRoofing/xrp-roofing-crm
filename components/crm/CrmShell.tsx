"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, BriefcaseBusiness, CalendarDays, ChevronLeft, ChevronRight, ClipboardList, CreditCard, FileSignature, FileText, Hammer, LayoutDashboard, LogOut, Menu, MessageCircle, MessageSquareText, Phone, PhoneForwarded, Search, Settings, UploadCloud, UsersRound, X, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { deleteCrmNotification, markCrmNotificationsRead, readCrmNotifications, type CrmNotification } from "@/lib/crm-notifications";
import { incrementTeamChatUnreadCount, markTeamChatRead, readTeamChatUnreadCount, teamChatRoomId, teamChatTableName, type TeamChatMessage } from "@/lib/team-chat";
import { controlCall, createBrowserVoiceDevice, getVoiceToken, saveCallNotes, subscribeToConversationEvents, type BrowserVoiceCall, type BrowserVoiceDevice } from "@/lib/twilio/client";
import { addTwilioCrmNotification } from "@/lib/twilio/notifications";
import { VoiceDeviceProvider } from "@/lib/twilio/voice-device-context";
import { subscribeToCrewData } from "@/lib/crew-sync";
import { PhoneLink } from "@/components/ContactLinks";
import { azDateTime } from "@/lib/arizona-time";
import FloatingCallCard, { type CallerInfo } from "@/components/crm/FloatingCallCard";
import FloatingDialer from "@/components/crm/FloatingDialer";
import { AiChatProvider } from "@/components/crm/AiChatContext";
import { AiFloatingButton, AiChatPanel } from "@/components/crm/AiChatAssistant";
import { getTwilioLines } from "@/lib/twilio/numbers";
import { subscribeToInvoiceShares } from "@/lib/invoice-sync";
import { subscribeToProposalRecords } from "@/lib/proposal-sync";
import { subscribeToCustomerRecords, loadCustomerRecords } from "@/lib/customer-sync";
import { subscribeToTaskUpdates } from "@/lib/task-sync";
import { deleteNotificationFromSupabase, loadNotificationsFromSupabase, markNotificationsReadInSupabase, subscribeToNotifications } from "@/lib/notification-sync";
import { refreshCrewData, refreshInvoices, refreshProposals, refreshCustomers, getCachedCustomers } from "@/lib/data-cache";
import { logCrewActivity } from "@/lib/crew-activity";
import type { Customer } from "@/types/crm";

const navigation = [
  { href: "/crm", label: "Dashboard", shortLabel: "Home", icon: LayoutDashboard },
  { href: "/crm/phone", label: "Phone", shortLabel: "Phone", icon: Phone },
  { href: "/crm/conversations", label: "Messaging", shortLabel: "Messages", icon: MessageSquareText },
  { href: "/crm/tasks", label: "Tasks", shortLabel: "Tasks", icon: ClipboardList },
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
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("xrp-sidebar-collapsed") === "true";
    }
    return false;
  });
  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("xrp-sidebar-collapsed", String(next));
      return next;
    });
  }
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [userRole, setUserRole] = useState("admin");
  const [currentUserId, setCurrentUserId] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<CrmNotification[]>([]);
  const [unreadTeamChatCount, setUnreadTeamChatCount] = useState(0);
  const voiceDeviceRef = useRef<BrowserVoiceDevice | null>(null);
  const incomingCallRef = useRef<BrowserVoiceCall | null>(null);
  const [globalIncomingCall, setGlobalIncomingCall] = useState<{ name: string; phone: string } | null>(null);
  const [globalActiveIncomingCall, setGlobalActiveIncomingCall] = useState(false);
  const [globalIncomingMuted, setGlobalIncomingMuted] = useState(false);
  const [globalIncomingHeld, setGlobalIncomingHeld] = useState(false);
  const [globalIncomingCaller, setGlobalIncomingCaller] = useState<{ name: string; phone: string }>({ name: "", phone: "" });
  const [globalIncomingTwilioNumber, setGlobalIncomingTwilioNumber] = useState("");

  // Forwarding status tracking for incoming call transfers
  type ForwardingStatus = "forwarding" | "ringing" | "connected" | "no-answer" | "busy" | "failed" | "ended";
  const [fwdStatus, setFwdStatus] = useState<ForwardingStatus | null>(null);
  const [fwdDest, setFwdDest] = useState("");
  const fwdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function clearFwdState() {
    setFwdStatus(null);
    setFwdDest("");
    if (fwdTimerRef.current) clearTimeout(fwdTimerRef.current);
  }
  const [globalDialerOpen, setGlobalDialerOpen] = useState(false);
  const [globalCallActive, setGlobalCallActive] = useState(false);
  const [dialerCustomers, setDialerCustomers] = useState<Customer[]>([]);
  const [pendingDialNumber, setPendingDialNumber] = useState<string | undefined>();
  const [pendingCallerId, setPendingCallerId] = useState<string | undefined>();

  // Post-call disposition modal state
  const [showPostCallDisposition, setShowPostCallDisposition] = useState(false);
  const [postCallSid, setPostCallSid] = useState<string | undefined>();
  const [postCallDisposition, setPostCallDisposition] = useState("");
  const [postCallNotes, setPostCallNotes] = useState("");
  const [postCallSaving, setPostCallSaving] = useState(false);
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

    // Warm the data cache so pages render instantly once auth completes.
    // On mobile, stagger fetches to avoid saturating the connection; on
    // desktop fire them all at once.
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    void refreshCrewData().catch(() => {});
    if (mobile) {
      setTimeout(() => void refreshInvoices().catch(() => {}), 800);
      setTimeout(() => void refreshProposals().catch(() => {}), 1600);
      setTimeout(() => void refreshCustomers().catch(() => {}), 2400);
    } else {
      void refreshInvoices().catch(() => {});
      void refreshProposals().catch(() => {});
      void refreshCustomers().catch(() => {});
    }

    // Pre-download JS bundles for nav pages so transitions are instant.
    // On mobile, only prefetch the most-used pages to save bandwidth.
    const prefetchTargets = mobile
      ? navigation.filter((item) => ["/crm", "/crm/leads", "/crm/customers", "/crm/invoices", "/crm/calendar"].includes(item.href))
      : navigation;
    for (const item of prefetchTargets) {
      router.prefetch(item.href);
    }

    // Pre-warm the Twilio Voice SDK bundle — defer on mobile to prioritize
    // page rendering.
    if (mobile) {
      setTimeout(() => void import("@twilio/voice-sdk").catch(() => {}), 5000);
    } else {
      void import("@twilio/voice-sdk").catch(() => {});
    }

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

        // NOTE: Do NOT trigger the ringing UI from the Supabase
        // `incoming_call` event — that event fires at IVR start, before
        // the customer selects a menu option.  The Twilio SDK `incoming`
        // event (registered in registerGlobalVoiceDevice below) is the
        // correct trigger because it only fires when `<Dial><Client>`
        // executes after IVR selection.
      });
    } catch {
      return undefined;
    }
  }, [isCrewUser]);


  useEffect(() => {
    if (isCrewUser) return;
    let mounted = true;
    let delayTimer: ReturnType<typeof setTimeout> | null = null;

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
          // Prevent duplicate popups — ignore if a call is already ringing or active
          if (incomingCallRef.current) {
            try { incoming.reject(); } catch {}
            return;
          }
          const phone = incoming.parameters?.From || "Unknown number";
          incomingCallRef.current = incoming;
          setGlobalIncomingCall({ name: phone, phone });
          incoming.on("cancel", () => {
            incomingCallRef.current = null;
            setGlobalIncomingCall(null);
            setGlobalActiveIncomingCall(false);
          });
        });
        device.on("unregistered", () => {
          void getVoiceToken("crm-agent")
            .then(({ token }) => { device.updateToken?.(token); return device.register(); })
            .catch(() => undefined);
        });
        await device.register();
      } catch {
        voiceDeviceRef.current = null;
      }
    }

    // Defer voice device registration on mobile to prioritize page rendering
    const mobileDelay = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 4000 : 0;
    if (mobileDelay > 0) {
      delayTimer = setTimeout(() => { if (mounted) registerGlobalVoiceDevice(); }, mobileDelay);
    } else {
      registerGlobalVoiceDevice();
    }

    return () => {
      mounted = false;
      if (delayTimer) clearTimeout(delayTimer);
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
    if (!currentUserId) return;

    const supabase = createClient();
    const channel = supabase
      .channel("team-chat-global-unread")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: teamChatTableName, filter: `room_id=eq.${teamChatRoomId}` },
        (payload) => {
          if (pathnameRef.current === "/crm/team-chat") return;
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
  }, [currentUserId]);

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

  // --- Ringtone + vibration when ringing ---
  const ringtoneAudioRef = useRef<HTMLAudioElement | null>(null);
  const vibrateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (globalIncomingCall) {
      const audio = new Audio("/sounds/ringtone.mp3");
      audio.loop = true;
      audio.volume = 0.8;
      audio.play().catch(() => undefined);
      ringtoneAudioRef.current = audio;
      if ("vibrate" in navigator) {
        navigator.vibrate([300, 200, 300, 200, 300]);
        vibrateTimerRef.current = setInterval(() => navigator.vibrate([300, 200, 300, 200, 300]), 2000);
      }
    } else {
      ringtoneAudioRef.current?.pause();
      ringtoneAudioRef.current = null;
      if (vibrateTimerRef.current) { clearInterval(vibrateTimerRef.current); vibrateTimerRef.current = null; }
      navigator.vibrate?.(0);
    }
    return () => {
      ringtoneAudioRef.current?.pause();
      ringtoneAudioRef.current = null;
      if (vibrateTimerRef.current) { clearInterval(vibrateTimerRef.current); vibrateTimerRef.current = null; }
      navigator.vibrate?.(0);
    };
  }, [globalIncomingCall]);

  // --- BroadcastChannel for cross-tab call state sync ---
  const callChannelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    const ch = new BroadcastChannel("xrp-call-state");
    callChannelRef.current = ch;
    ch.onmessage = (ev) => {
      const msg = ev.data as { type: string };
      if (msg.type === "answered") {
        // Another tab answered — clear ringing state
        setGlobalIncomingCall(null);
      } else if (msg.type === "declined" || msg.type === "ended") {
        setGlobalIncomingCall(null);
        setGlobalActiveIncomingCall(false);
        setGlobalIncomingMuted(false);
      }
    };
    return () => { ch.close(); };
  }, []);

  function handleAnswerGlobalIncomingCall() {
    const incoming = incomingCallRef.current;
    if (!incoming) return;

    try {
      // Register disconnect/error handlers BEFORE accept() so we never miss
      // a hangup that fires between accept and listener registration.
      incoming.on("disconnect", () => {
        const endedSid = incoming.parameters?.CallSid;
        setGlobalActiveIncomingCall(false);
        setGlobalIncomingMuted(false);
        setGlobalIncomingHeld(false);
        incomingCallRef.current = null;
        callChannelRef.current?.postMessage({ type: "ended" });
        if (endedSid && pathnameRef.current !== "/crm/conversations") { setPostCallSid(endedSid); setShowPostCallDisposition(true); }
      });
      incoming.on("error", () => {
        setGlobalActiveIncomingCall(false);
        setGlobalIncomingMuted(false);
        setGlobalIncomingHeld(false);
        incomingCallRef.current = null;
        callChannelRef.current?.postMessage({ type: "ended" });
      });

      // Accept while audio context is still active (ringtone playing).
      // Clearing globalIncomingCall stops the ringtone which can suspend the
      // browser audio context and cause the WebRTC stream to fail.
      incoming.accept();

      // Now safe to clear ringing state and transition to active card
      setGlobalIncomingCall(null);
      setGlobalActiveIncomingCall(true);
      setGlobalIncomingMuted(false);
      setGlobalIncomingCaller({ name: incoming.parameters?.From || "Unknown", phone: incoming.parameters?.From || "" });
      setGlobalIncomingTwilioNumber(incoming.parameters?.To || "");
      void logCrewActivity({ jobId: "", jobName: incoming.parameters?.From || "Unknown", actor: "Office", action: "Incoming call answered", details: `Answered call from ${incoming.parameters?.From || "Unknown"}`, module: "Calls" }).catch(() => {});

      callChannelRef.current?.postMessage({ type: "answered" });
    } catch {
      incomingCallRef.current = null;
      setGlobalIncomingCall(null);
    }
  }

  function handleDeclineGlobalIncomingCall() {
    try {
      incomingCallRef.current?.reject();
    } catch {}
    incomingCallRef.current = null;
    setGlobalIncomingCall(null);
    callChannelRef.current?.postMessage({ type: "declined" });
  }

  function handleEndGlobalIncomingCall() {
    const endedSid = incomingCallRef.current?.parameters?.CallSid;
    try {
      incomingCallRef.current?.disconnect();
    } catch {}
    incomingCallRef.current = null;
    setGlobalActiveIncomingCall(false);
    setGlobalIncomingMuted(false);
    setGlobalIncomingHeld(false);
    callChannelRef.current?.postMessage({ type: "ended" });
    if (endedSid && pathnameRef.current !== "/crm/conversations") { setPostCallSid(endedSid); setShowPostCallDisposition(true); }
  }

  function handleMuteGlobalIncomingCall() {
    const call = incomingCallRef.current;
    if (!call) return;
    const next = !globalIncomingMuted;
    try { call.mute?.(next); } catch {}
    setGlobalIncomingMuted(next);
  }

  function handleIncomingCallSaveNotes(notes: string, disposition: string, info: CallerInfo) {
    const callSid = incomingCallRef.current?.parameters?.CallSid || "";
    void saveCallNotes({ callSid, notes, disposition }).catch(() => {});
    if (disposition) void logCrewActivity({ jobId: "", jobName: info.name || info.phone || "Unknown", actor: "Office", action: `Call disposition: ${disposition}`, details: notes || disposition, module: "Calls" }).catch(() => {});
  }

  function handleIncomingCallCreateLead(info: CallerInfo) {
    const params = new URLSearchParams();
    params.set("name", info.name);
    params.set("phone", info.phone);
    params.set("address", info.address);
    params.set("email", info.email);
    params.set("source", info.leadSource);
    params.set("notes", info.serviceNeeded);
    router.push(`/crm/leads?newLead=1&${params.toString()}`);
  }

  function handleIncomingCallSchedule(type: string, info: CallerInfo) {
    const params = new URLSearchParams();
    params.set("type", type);
    if (info.name) params.set("name", info.name);
    if (info.phone) params.set("phone", info.phone);
    router.push(`/crm/calendar?schedule=1&${params.toString()}`);
  }

  async function handleTransferGlobalIncomingCall(number: string) {
    const callSid = incomingCallRef.current?.parameters?.CallSid;
    if (!callSid || !number.trim()) return;
    const dest = number.trim();
    setFwdDest(dest);
    setFwdStatus("forwarding");
    try {
      await controlCall({ callSid, action: "forward", forwardTo: dest });
      incomingCallRef.current = null;
      setGlobalActiveIncomingCall(false);
      setGlobalIncomingMuted(false);
      callChannelRef.current?.postMessage({ type: "ended" });
      void logCrewActivity({ jobId: "", jobName: globalIncomingCaller?.name || globalIncomingCaller?.phone || "Unknown", actor: "Office", action: "Call forwarded", details: `Forwarded to ${dest}`, module: "Calls" }).catch(() => {});
      setFwdStatus("ringing");
      fwdTimerRef.current = setTimeout(() => {
        setFwdStatus("connected");
        fwdTimerRef.current = setTimeout(() => clearFwdState(), 4000);
      }, 3000);
    } catch {
      setFwdStatus("failed");
      fwdTimerRef.current = setTimeout(() => clearFwdState(), 3000);
    }
  }

  async function handleHoldGlobalIncomingCall() {
    const call = incomingCallRef.current;
    const callSid = call?.parameters?.CallSid;
    if (!callSid) return;
    try {
      const action = globalIncomingHeld ? "resume" : "hold";
      await controlCall({ callSid, action });
      // Mute/unmute audio via the SDK as a local hold indicator
      try { call?.mute?.(!globalIncomingHeld); } catch {}
      setGlobalIncomingHeld(!globalIncomingHeld);
    } catch {}
  }

  // Load customers for the floating dialer contacts tab
  useEffect(() => {
    const cached = getCachedCustomers<Customer>();
    if (cached) setDialerCustomers(cached); // eslint-disable-line react-hooks/set-state-in-effect
    else refreshCustomers<Customer>().then(setDialerCustomers).catch(() => {});
  }, []);

  // Disposition modal handlers (shared by incoming calls + global dialer)
  function handleDialerCallEnd(sid: string) {
    if (pathnameRef.current === "/crm/conversations") return; // ConversationBoard has its own modal
    setPostCallSid(sid);
    setShowPostCallDisposition(true);
  }
  async function handleSavePostCallDisposition() {
    if (!postCallSid || !postCallDisposition) return;
    setPostCallSaving(true);
    try {
      await saveCallNotes({ callSid: postCallSid, notes: postCallNotes.trim(), disposition: postCallDisposition });
      void logCrewActivity({ jobId: "", jobName: globalIncomingCaller?.name || "Unknown", actor: "Office", action: `Call disposition: ${postCallDisposition}`, details: postCallNotes.trim() || postCallDisposition, module: "Calls" }).catch(() => {});
    } catch {}
    setPostCallSaving(false);
    closePostCallDisposition();
  }
  function closePostCallDisposition() {
    setShowPostCallDisposition(false);
    setPostCallSid(undefined);
    setPostCallDisposition("");
    setPostCallNotes("");
  }

  // Phone numbers available for caller ID selection — driven by centralized registry
  const dialerPhoneNumbers = useMemo(() => {
    return getTwilioLines().map((line) => ({ label: line.label, number: line.number }));
  }, []);

  // Listen for "crm:open-dialer" custom events from child pages (e.g. calendar click-to-call)
  useEffect(() => {
    function handleOpenDialer(e: Event) {
      const detail = (e as CustomEvent).detail as { phone?: string; callerId?: string } | undefined;
      if (detail?.phone) setPendingDialNumber(detail.phone);
      if (detail?.callerId) setPendingCallerId(detail.callerId);
      setGlobalDialerOpen(true);
    }
    window.addEventListener("crm:open-dialer", handleOpenDialer);
    return () => window.removeEventListener("crm:open-dialer", handleOpenDialer);
  }, []);

  const [syncActive, setSyncActive] = useState(false);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Central realtime hub: every Supabase realtime event refreshes the shared
  // data cache AND dispatches a window event so every mounted page picks up
  // changes instantly — no per-page Supabase subscription required.
  useEffect(() => {
    if (!hasSupabaseConfig()) return;
    function flash() {
      setSyncActive(true);
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = setTimeout(() => setSyncActive(false), 2000);
    }
    const unsubs = [
      subscribeToCrewData(() => { flash(); void refreshCrewData(true).catch(() => {}); }),
      subscribeToInvoiceShares(() => { flash(); void refreshInvoices(true).catch(() => {}); }),
      subscribeToProposalRecords(() => { flash(); void refreshProposals(true).catch(() => {}); }),
      subscribeToCustomerRecords(() => { flash(); void refreshCustomers(true).catch(() => {}); }),
      subscribeToTaskUpdates(() => flash()),
    ];
    return () => {
      unsubs.forEach((unsub) => unsub());
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, []);

  useEffect(() => { void loadCustomerRecords(); }, []);

  const unreadNotifications = notifications.filter((notification) => !notification.read && notification.status !== "archived").length;
  const showTeamChatFloatingButton = pathname !== "/crm/team-chat" && pathname !== "/crm/conversations" && pathname !== "/crm/calendar";

  const mobileBottomNav = isCrewUser ? [] : [
    { href: "/crm", label: "Home", icon: LayoutDashboard },
    { href: "/crm/leads", label: "Jobs", icon: BriefcaseBusiness },
    { href: "/crm/customers", label: "Clients", icon: UsersRound },
    { href: "/crm/calendar", label: "Calendar", icon: CalendarDays },
    { href: "/crm/payments", label: "Pay", icon: CreditCard },
    { href: "/crm/invoices", label: "Invoices", icon: ClipboardList },
    { href: "/crm/files", label: "Files", icon: UploadCloud },
  ];

  const voiceDeviceCtx = useMemo(() => ({ deviceRef: voiceDeviceRef }), []);

  if (checkingAuth) {
    return (
      <div className="flex min-h-screen min-h-[100dvh] bg-gray-50">
        {/* Skeleton sidebar — desktop only */}
        <aside className="hidden w-[220px] shrink-0 border-r border-gray-200 bg-white lg:block">
          <div className="flex h-16 items-center gap-3 border-b border-gray-100 px-5">
            <div className="h-8 w-8 animate-pulse rounded-lg bg-gray-200" />
            <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
          </div>
          <div className="mt-4 space-y-2 px-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
                <div className="h-4 w-4 animate-pulse rounded bg-gray-200" />
                <div className="h-3.5 animate-pulse rounded bg-gray-100" style={{ width: `${60 + (i * 13) % 40}%` }} />
              </div>
            ))}
          </div>
        </aside>
        {/* Skeleton content area */}
        <div className="flex flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-gray-200 bg-white px-4 lg:px-6">
            <div className="h-5 w-32 animate-pulse rounded bg-gray-200" />
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 animate-pulse rounded-full bg-gray-200" />
              <div className="h-8 w-8 animate-pulse rounded-full bg-gray-200" />
            </div>
          </header>
          <main className="flex-1 p-4 lg:p-6">
            <div className="space-y-4">
              <div className="h-24 animate-pulse rounded-xl bg-white shadow-sm" />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-20 animate-pulse rounded-lg bg-white shadow-sm" />
                ))}
              </div>
              <div className="h-48 animate-pulse rounded-xl bg-white shadow-sm" />
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <AiChatProvider>
    <div className="flex min-h-screen min-h-[100dvh] overflow-x-hidden bg-gray-50">
      {/* Floating Call Card — ringing */}
      {globalIncomingCall && !isCrewUser && (
        <FloatingCallCard
          state="ringing"
          caller={globalIncomingCall}
          muted={false}
          customers={dialerCustomers}
          onAnswer={handleAnswerGlobalIncomingCall}
          onDecline={handleDeclineGlobalIncomingCall}
          onEnd={handleDeclineGlobalIncomingCall}
          onMute={() => {}}
        />
      )}

      {/* Floating Call Card — active incoming call */}
      {globalActiveIncomingCall && !globalIncomingCall && !isCrewUser && (
        <FloatingCallCard
          state={globalIncomingHeld ? "held" : "active"}
          caller={globalIncomingCaller}
          muted={globalIncomingMuted}
          twilioNumber={globalIncomingTwilioNumber}
          customers={dialerCustomers}
          onAnswer={() => {}}
          onDecline={() => {}}
          onEnd={handleEndGlobalIncomingCall}
          onMute={handleMuteGlobalIncomingCall}
          onHold={handleHoldGlobalIncomingCall}
          onTransfer={handleTransferGlobalIncomingCall}
          onSendDtmf={(digit: string) => {
            const call = incomingCallRef.current;
            if (!call) return;
            const c = call as unknown as { sendDigits?: (d: string) => void };
            c.sendDigits?.(digit);
          }}
          onSaveNotes={handleIncomingCallSaveNotes}
          onCreateLead={handleIncomingCallCreateLead}
          onSchedule={handleIncomingCallSchedule}
        />
      )}

      {/* Forwarding status overlay */}
      {fwdStatus && (
        <div className="fixed bottom-4 right-4 z-[9999] w-80 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
          <div className="flex items-center gap-3 p-4">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              fwdStatus === "connected" ? "bg-green-100" :
              fwdStatus === "failed" ? "bg-red-100" :
              fwdStatus === "no-answer" || fwdStatus === "busy" ? "bg-orange-100" :
              "bg-blue-100"
            }`}>
              <PhoneForwarded className={`h-5 w-5 ${
                fwdStatus === "connected" ? "text-green-600" :
                fwdStatus === "failed" ? "text-red-600" :
                fwdStatus === "no-answer" || fwdStatus === "busy" ? "text-orange-600" :
                "text-blue-600"
              }`} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-gray-900">
                {fwdStatus === "forwarding" && "Forwarding Call..."}
                {fwdStatus === "ringing" && "Ringing External Number..."}
                {fwdStatus === "connected" && "Forwarded Successfully"}
                {fwdStatus === "no-answer" && "No Answer"}
                {fwdStatus === "busy" && "Busy"}
                {fwdStatus === "failed" && "Forwarding Failed"}
                {fwdStatus === "ended" && "Call Ended"}
              </p>
              <p className="text-xs text-gray-500">{fwdDest}</p>
            </div>
            {(fwdStatus === "forwarding" || fwdStatus === "ringing") && (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
            )}
            {fwdStatus !== "forwarding" && fwdStatus !== "ringing" && (
              <button type="button" onClick={clearFwdState} className="rounded p-1 text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
            )}
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-gray-200 bg-white transition-all duration-200 lg:translate-x-0 ${collapsed ? "lg:w-[68px]" : "lg:w-64"} w-64 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-gray-100 px-5">
          <Link href={isCrewUser ? "/crm/crew" : "/crm"} className="flex items-center gap-3" onClick={() => setOpen(false)}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">XR</span>
            <span className={`text-base font-bold text-gray-900 transition-opacity duration-200 ${collapsed ? "lg:hidden" : ""}`}>XRP Roofing</span>
          </Link>
          <button onClick={() => setOpen(false)} className="ml-auto rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 lg:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="space-y-1">
            {visibleNavigation.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || (item.href !== "/crm" && pathname.startsWith(item.href));
              const showChatBadge = item.href === "/crm/team-chat" && unreadTeamChatCount > 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  title={collapsed ? item.label : undefined}
                  className={`group relative flex items-center gap-3 rounded-lg px-3.5 py-3 text-sm font-medium transition-colors ${active ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"} ${collapsed ? "lg:justify-center lg:px-0" : ""}`}
                >
                  <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-blue-600" : "text-gray-400 group-hover:text-gray-600"}`} />
                  <span className={`flex-1 transition-opacity duration-200 ${collapsed ? "lg:hidden" : ""}`}>{item.label}</span>
                  {showChatBadge && (
                    <span className={`flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1.5 text-[10px] font-bold text-white ${collapsed ? "lg:absolute lg:-right-0.5 lg:-top-0.5 lg:h-4 lg:min-w-4 lg:px-1" : ""}`}>{unreadTeamChatCount}</span>
                  )}
                  {active && !showChatBadge && <span className={`h-1.5 w-1.5 rounded-full bg-blue-600 ${collapsed ? "lg:absolute lg:-right-0.5 lg:-top-0.5" : ""}`} />}
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Sidebar Footer */}
        <div className="border-t border-gray-100 px-3 py-3">
          <button onClick={() => { logout(); setOpen(false); }} title={collapsed ? "Log out" : undefined} className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 ${collapsed ? "lg:justify-center lg:px-0" : ""}`}>
            <LogOut className="h-[18px] w-[18px] text-gray-400" />
            <span className={`transition-opacity duration-200 ${collapsed ? "lg:hidden" : ""}`}>Log out</span>
          </button>
        </div>

        {/* Collapse toggle (desktop only) */}
        <button
          onClick={toggleCollapsed}
          className="absolute -right-3 top-20 z-50 hidden h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 shadow-sm transition hover:bg-gray-50 hover:text-gray-700 lg:flex"
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      </aside>

      {/* Mobile Overlay */}
      {open && <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main Content Area */}
      <div className={`flex min-w-0 flex-1 flex-col overflow-x-clip transition-all duration-200 ${collapsed ? "lg:pl-[68px]" : "lg:pl-64"}`}>
        {/* Top Header */}
        <header className="sticky top-0 z-40 border-b border-gray-200 bg-white">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
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

              {/* Global Dialer Toggle */}
              {!isCrewUser && (
                <button type="button" onClick={() => setGlobalDialerOpen((v) => !v)} className={`relative rounded-lg p-2 transition ${globalCallActive ? "bg-green-100 text-green-700 animate-pulse" : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"}`} aria-label="Open dialer">
                  <Phone className="h-5 w-5" />
                </button>
              )}

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
                              <p className="text-xs text-gray-400">{notification.actor} · {notification.module} · {azDateTime(notification.createdAt)}</p>
                              <button onClick={() => handleDeleteNotification(notification.id)} className="text-xs font-medium text-red-500 hover:text-red-700">Delete</button>
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
        <main className={`crm-main flex flex-1 flex-col px-3 py-3 sm:px-5 sm:py-4 ${mobileBottomNav.length > 0 ? "pb-20 lg:pb-4" : ""}`}>
          <VoiceDeviceProvider value={voiceDeviceCtx}><div className="flex min-h-0 max-w-full flex-1 flex-col">{children}</div></VoiceDeviceProvider>
        </main>
      </div>

      {/* Mobile Bottom Navigation — rendered at root level so no parent transform/flex can break fixed positioning */}
      {mobileBottomNav.length > 0 && (
        <nav className="fixed inset-x-0 bottom-0 z-[9999] border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" style={{ transform: "translateZ(0)", WebkitTransform: "translateZ(0)", willChange: "transform", touchAction: "none", WebkitBackfaceVisibility: "hidden", backfaceVisibility: "hidden" }}>
          <div className="flex items-center justify-around px-1 py-1.5">
            {mobileBottomNav.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || (item.href !== "/crm" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-2 text-xs font-medium transition-colors ${
                    active ? "text-blue-600" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  <Icon className={`h-6 w-6 shrink-0 ${active ? "text-blue-600" : "text-gray-400"}`} />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      {/* Global Floating Dialer */}
      {!isCrewUser && (
        <FloatingDialer
          open={globalDialerOpen}
          onClose={() => { setGlobalDialerOpen(false); setPendingDialNumber(undefined); setPendingCallerId(undefined); }}
          voiceDeviceRef={voiceDeviceRef}
          phoneNumbers={dialerPhoneNumbers}
          customers={dialerCustomers}
          onCallStateChange={setGlobalCallActive}
          onCallEnd={handleDialerCallEnd}
          initialDialNumber={pendingDialNumber}
          initialCallerId={pendingCallerId}
        />
      )}

      {/* Team Chat FAB */}
      {showTeamChatFloatingButton && (
        <Link href="/crm/team-chat" className={`fixed right-6 z-50 hidden h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition hover:bg-blue-700 hover:shadow-xl sm:flex sm:h-auto sm:w-auto sm:gap-2 sm:rounded-lg sm:px-4 sm:py-3 ${mobileBottomNav.length > 0 ? "bottom-[72px] lg:bottom-6" : "bottom-6"}`}>
          <span className="relative">
            <MessageCircle className="h-5 w-5" />
            {unreadTeamChatCount > 0 && <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white">{unreadTeamChatCount}</span>}
          </span>
          <span className="hidden text-sm font-medium sm:block">{unreadTeamChatCount > 0 ? `${unreadTeamChatCount} unread` : "Team Chat"}</span>
        </Link>
      )}

      {/* Post-call disposition modal (incoming calls + global dialer) */}
      {showPostCallDisposition && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-2xl">
            <div className="border-b border-gray-100 px-5 py-4">
              <h3 className="text-lg font-bold text-gray-900">Call Disposition</h3>
              <p className="mt-0.5 text-sm text-gray-500">Select the outcome of this call</p>
            </div>
            <div className="max-h-[50vh] overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-2 gap-2">
                {(["No Answer","Left Voicemail","Interested","Not Interested","Call Back Requested","Follow-Up Needed","Appointment Scheduled","Estimate Scheduled","Proposal Sent","Proposal Signed","Job Won","Wrong Number","Spam","Do Not Call","Customer Unavailable","Other"] as const).map((d) => {
                  const colorMap: Record<string, string> = { Interested: "bg-green-500", "Appointment Scheduled": "bg-green-500", "Estimate Scheduled": "bg-green-500", "Job Won": "bg-green-500", "Proposal Sent": "bg-blue-500", "Proposal Signed": "bg-blue-500", "Follow-Up Needed": "bg-blue-500", "Call Back Requested": "bg-blue-500", "Left Voicemail": "bg-yellow-500", "No Answer": "bg-yellow-500", "Customer Unavailable": "bg-yellow-500", "Not Interested": "bg-red-500", "Wrong Number": "bg-red-500", Spam: "bg-red-500", "Do Not Call": "bg-red-500" };
                  return (
                    <button key={d} type="button" onClick={() => setPostCallDisposition(d)} className={`rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition ${postCallDisposition === d ? "border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-200" : "border-gray-200 bg-white text-gray-700 hover:border-blue-200 hover:bg-blue-50"}`}>
                      <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${colorMap[d] || "bg-gray-400"}`} />
                      {d}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4">
                <label className="text-xs font-bold uppercase tracking-wide text-gray-500">Notes (optional)</label>
                <textarea value={postCallNotes} onChange={(e) => setPostCallNotes(e.target.value)} className="mt-1 min-h-[72px] w-full rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm outline-none placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100" placeholder="Add call notes..." />
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
              <button type="button" onClick={closePostCallDisposition} className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-500 transition hover:bg-gray-100">Skip</button>
              <button type="button" onClick={handleSavePostCallDisposition} disabled={!postCallDisposition || postCallSaving} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-50">
                {postCallSaving ? "Saving..." : "Save Disposition"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Global AI Assistant — admin/office only, hidden from crew users */}
      {!isCrewUser && <AiFloatingButton />}
      {!isCrewUser && <AiChatPanel />}
    </div>
    </AiChatProvider>
  );
}
