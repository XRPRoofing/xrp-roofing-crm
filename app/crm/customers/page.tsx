"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BriefcaseBusiness, CalendarCheck2, Edit3, FileSignature, FileText, Image as ImageIcon, Mail, MapPin, MessageSquare, Phone, Plus, Receipt, Search, ShieldCheck, StickyNote, Trash2, UploadCloud, Voicemail, X } from "lucide-react";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { PhoneLink, EmailLink, AddressLink } from "@/components/ContactLinks";
import QuickSmsModal from "@/components/crm/QuickSmsModal";
import { leadStages } from "@/lib/crm-data";
import { subscribeToCrewData } from "@/lib/crew-sync";
import { listConversationEvents, subscribeToConversationEvents } from "@/lib/twilio/client";
import type { TwilioConversationEvent } from "@/types/twilio-conversations";
import { customerSyncEnabled, deleteCustomerRecord, loadCustomerRecords, loadCustomerRecordsResult, subscribeToCustomerRecords, upsertCustomerRecord } from "@/lib/customer-sync";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import type { ConversationChannel, ConversationMessage } from "@/types/conversations";
import { proxyRecordingUrl } from "@/lib/twilio/client";
import type { Customer, Lead } from "@/types/crm";
import { jobToBoardPayload, requestCreateEstimate, requestCreateInvoice, requestOpenEstimate, requestOpenInvoice, type BoardJobPayload } from "@/lib/crm-board-nav";
import { getCachedCrewData, refreshCrewData, CACHE_EVENTS } from "@/lib/data-cache";

const customersStorageKey = "xrp-crm-customers";
const jobsStorageKey = "xrp-crm-jobs-board";

function readRawLocalCustomers(): Customer[] {
  if (typeof window === "undefined") return [];
  const saved = window.localStorage.getItem(customersStorageKey);
  if (!saved) return [];
  try {
    return JSON.parse(saved) as Customer[];
  } catch {
    return [];
  }
}

// Real crew jobs power the profile tabs (Jobs / Communication History) and the
// active-job count on each card. Falls back to an empty list (never demo data)
// until the live crew dataset loads.
function getSavedJobs(): Lead[] {
  const savedJobs = window.localStorage.getItem(jobsStorageKey);
  if (!savedJobs) return [];

  try {
    return JSON.parse(savedJobs) as Lead[];
  } catch {
    return [];
  }
}

function getCustomerJobs(customer: Customer, jobs: Lead[]) {
  return jobs.filter((job) =>
    customer.id === `C-${job.id}` ||
    job.email === customer.email ||
    job.phone === customer.phone ||
    job.name.toLowerCase() === customer.name.toLowerCase()
  );
}

// A real communication entry shown on the customer profile. Only the few
// fields the renderer needs are kept (no fabricated ConversationRecord).
type CommunicationEntry = {
  conversation: { id: string; jobId?: string; customerId?: string };
  message: ConversationMessage;
};

function eventChannel(event: TwilioConversationEvent): ConversationChannel {
  if (event.type === "incoming_sms" || event.type === "message_status") return "sms";
  if (event.type === "call_note") return "note";
  return "call";
}

function eventBody(event: TwilioConversationEvent): string {
  if (event.body) return event.body;
  if (event.type === "call_recording") return "Call recording";
  if (event.type === "incoming_call") return event.direction === "outbound" ? "Outbound call" : "Inbound call";
  if (event.type === "call_status") return `Call ${event.status || "update"}`;
  return "Communication";
}

// Build the customer's communication history from REAL Twilio conversation
// events (calls, SMS, recordings, notes), matched by phone number. Returns an
// empty list when there is no real activity — never fabricated/sample data.
function getCustomerCommunications(customer: Customer, events: TwilioConversationEvent[]): CommunicationEntry[] {
  const phone = digitsOnly(customer.phone);
  if (!phone) return [];
  return events
    .filter((event) => digitsOnly(event.from) === phone || digitsOnly(event.to) === phone)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((event) => ({
      conversation: { id: event.conversationId || event.id, jobId: event.jobId, customerId: event.customerId },
      message: {
        id: event.id,
        channel: eventChannel(event),
        direction: event.direction === "outbound" ? "outbound" : "inbound",
        author: event.from || customer.name,
        body: eventBody(event),
        timestamp: new Date(event.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
        recordingUrl: event.recordingUrl,
      },
    }));
}

function getCommunicationLabel(message: ConversationMessage) {
  if (message.recordingUrl) return "Recording";
  if (message.channel === "call") return "Call";
  if (message.channel === "sms") return "Message";
  return "CRM Note";
}

function getCommunicationIcon(message: ConversationMessage) {
  if (message.recordingUrl || message.channel === "call") return Voicemail;
  if (message.channel === "sms") return MessageSquare;
  return FileText;
}

function formatDate(value?: string) {
  if (!value) return "Not available";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getJobAddedDate(job?: Lead) {
  if (!job) return "Not available";
  const timestamp = Number(job.id.replace(/\D/g, ""));
  if (timestamp > 1000000000000) return formatDate(new Date(timestamp).toISOString().slice(0, 10));
  return job.dueDate ? formatDate(job.dueDate) : "Imported record";
}

function getJobCompletedDate(jobs: Lead[]) {
  const completedJob = jobs.find((job) => ["completed", "paid"].includes(job.stage));
  return completedJob?.dueDate ? formatDate(completedJob.dueDate) : "Not completed";
}

function getStageLabel(job: Lead) {
  return leadStages.find((stage) => stage.id === job.stage)?.label || job.stage.replace(/_/g, " ");
}

const profileTabs = ["Contact Info", "Jobs", "Estimates", "Invoices", "Files", "Notes", "Communication History"] as const;
type ProfileTab = (typeof profileTabs)[number];

const customerNotesKey = "xrp-crm-customer-notes";

type StoredProposal = {
  id: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  address?: string;
  title?: string;
  scope?: string;
  total?: number;
  status?: string;
};
type StoredInvoiceLineItem = { quantity?: number; unitPrice?: number; tax?: number };
type StoredInvoice = {
  id: string;
  invoiceNumber?: string;
  clientName?: string;
  email?: string;
  phone?: string;
  propertyAddress?: string;
  status?: string;
  discount?: number;
  lineItems?: StoredInvoiceLineItem[];
};

function normalizeText(value?: string) {
  return (value || "").toLowerCase().trim();
}

function digitsOnly(value?: string) {
  return (value || "").replace(/\D/g, "");
}

// Match an external record (invoice / proposal / search field) to a customer by
// email, phone, or name so the profile tabs show only that customer's records.
function customerMatchesContact(customer: Customer, fields: { name?: string; email?: string; phone?: string }) {
  const customerPhone = digitsOnly(customer.phone);
  const customerEmail = normalizeText(customer.email);
  if (fields.email && customerEmail && normalizeText(fields.email) === customerEmail) return true;
  if (fields.phone && customerPhone && digitsOnly(fields.phone) === customerPhone) return true;
  if (fields.name && normalizeText(fields.name) === normalizeText(customer.name)) return true;
  return false;
}

function getActiveJobCount(customer: Customer, jobs: Lead[]) {
  return getCustomerJobs(customer, jobs).filter((job) => !["completed", "paid"].includes(job.stage)).length;
}

function readStoredInvoices(): StoredInvoice[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem("xrp-crm-invoices") || "[]") as StoredInvoice[];
  } catch {
    return [];
  }
}

function readStoredProposals(): StoredProposal[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem("xrp-crm-proposals") || "[]") as StoredProposal[];
  } catch {
    return [];
  }
}

function invoiceTotal(invoice: StoredInvoice) {
  const items = invoice.lineItems || [];
  const subtotal = items.reduce((sum, item) => sum + (item.quantity || 0) * (item.unitPrice || 0), 0);
  const tax = items.reduce((sum, item) => sum + (item.quantity || 0) * (item.unitPrice || 0) * ((item.tax || 0) / 100), 0);
  return Math.max(subtotal + tax - (invoice.discount || 0), 0);
}

function getCustomerInvoices(customer: Customer, invoices: StoredInvoice[]) {
  return invoices.filter((invoice) => customerMatchesContact(customer, { name: invoice.clientName, email: invoice.email, phone: invoice.phone }));
}

function getCustomerProposals(customer: Customer, proposals: StoredProposal[]) {
  return proposals.filter((proposal) => customerMatchesContact(customer, { name: proposal.customerName, email: proposal.customerEmail, phone: proposal.customerPhone }));
}

function readCustomerNotes(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(customerNotesKey) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function writeCustomerNote(id: string, note: string) {
  if (typeof window === "undefined") return;
  const all = readCustomerNotes();
  if (note.trim()) all[id] = note;
  else delete all[id];
  window.localStorage.setItem(customerNotesKey, JSON.stringify(all));
}

function statusTone(status?: string) {
  const value = normalizeText(status);
  if (!value) return "bg-gray-100 text-gray-600";
  if (["paid", "won", "complete", "completed"].some((token) => value.includes(token))) return "bg-blue-100 text-blue-700";
  if (["progress", "active", "scheduled"].some((token) => value.includes(token))) return "bg-blue-100 text-blue-700";
  if (["overdue", "failed", "void", "lost"].some((token) => value.includes(token))) return "bg-red-100 text-red-700";
  if (value.includes("new")) return "bg-orange-100 text-orange-700";
  return "bg-gray-100 text-gray-600";
}

export default function CustomersPage() {
  const [savedCustomers, setSavedCustomers] = useState<Customer[]>(() => {
    if (typeof window === "undefined") return [];
    return readRawLocalCustomers();
  });
  const [jobList, setJobList] = useState<Lead[]>(() => getCachedCrewData()?.jobs ?? getSavedJobs());
  // Customer board shows ONLY live Supabase customer records (newest first from
  // /api/customers) — never seeded/demo customers derived from jobs.
  const customerList = savedCustomers;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>("Contact Info");
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Customer | null>(null);
  const [storedInvoices, setStoredInvoices] = useState<StoredInvoice[]>([]);
  const [storedProposals, setStoredProposals] = useState<StoredProposal[]>([]);
  const [customerNotes, setCustomerNotes] = useState<Record<string, string>>({});
  const [noteDraft, setNoteDraft] = useState("");
  // Real Twilio conversation events (calls/SMS/recordings) powering the profile
  // Communication History tab — matched to a customer by phone number.
  const [conversationEvents, setConversationEvents] = useState<TwilioConversationEvent[]>([]);
  // Surfaced to the user when Supabase can't load/save (e.g. the customer_records
  // table hasn't been created yet) so saves never fail silently.
  const [customersError, setCustomersError] = useState<string | null>(null);
  const [smsTarget, setSmsTarget] = useState<{ phone: string; name?: string } | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    propertyAddress: "",
    roofDetails: "",
    insuranceCarrier: "",
    status: "New customer",
    lifetimeValue: "",
  });

  const selectedCustomer = customerList.find((customer) => customer.id === selectedCustomerId) || null;
  const selectedCustomerJobs = selectedCustomer ? getCustomerJobs(selectedCustomer, jobList) : [];
  const selectedCustomerCommunications = selectedCustomer ? getCustomerCommunications(selectedCustomer, conversationEvents) : [];
  const selectedCustomerInvoices = selectedCustomer ? getCustomerInvoices(selectedCustomer, storedInvoices) : [];
  const selectedCustomerProposals = selectedCustomer ? getCustomerProposals(selectedCustomer, storedProposals) : [];

  // Build a job payload for create-and-link: prefer the customer's first job (so
  // the new estimate/invoice links by job id), otherwise synthesize from the
  // customer's own contact details.
  function customerBoardPayload(customer: Customer): BoardJobPayload {
    const job = getCustomerJobs(customer, jobList)[0];
    if (job) return jobToBoardPayload(job);
    return {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      address: customer.propertyAddress,
      city: "",
      roofType: customer.roofDetails || "Roofing",
      value: customer.lifetimeValue || 0,
    };
  }

  function openEstimate(id: string) {
    requestOpenEstimate(id);
    router.push("/crm/proposals");
  }

  function createEstimate(customer: Customer) {
    requestCreateEstimate(customerBoardPayload(customer));
    router.push("/crm/proposals");
  }

  function openInvoice(id: string) {
    requestOpenInvoice(id);
    router.push("/crm/invoices");
  }

  function createInvoice(customer: Customer) {
    requestCreateInvoice(customerBoardPayload(customer));
    router.push("/crm/invoices");
  }

  const cardHashRef = useRef(false);

  const closeCustomerCard = useCallback(() => {
    setSelectedCustomerId(null);
    cardHashRef.current = false;
    const url = new URL(window.location.href);
    url.searchParams.delete("customer");
    url.hash = "";
    history.replaceState(history.state, "", url.pathname + url.search);
  }, []);

  function openCustomer(customer: Customer) {
    setSelectedCustomerId(customer.id);
    setActiveTab("Contact Info");
    setEditingCustomerId(null);
    setEditForm(null);
    setNoteDraft(readCustomerNotes()[customer.id] || "");
    window.location.hash = "#card";
    cardHashRef.current = true;
  }

  useEffect(() => {
    function handleHashChange() {
      if (cardHashRef.current && !window.location.hash.includes("card")) {
        closeCustomerCard();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeCustomerCard();
    }
    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeCustomerCard]);

  const filteredCustomers = useMemo(() => {
    const query = search.toLowerCase().trim();

    if (!query) return customerList;

    const queryDigits = query.replace(/\D/g, "");
    const queryPhone = queryDigits.length === 11 && queryDigits.startsWith("1") ? queryDigits.slice(1) : queryDigits;

    return customerList.filter((customer) => {
      const relatedJobs = getCustomerJobs(customer, jobList);
      const textMatch = [
        customer.name,
        customer.phone,
        customer.email,
        customer.propertyAddress,
        ...relatedJobs.map((job) => `${job.name} ${job.city} ${job.stage} ${job.roofType} ${job.address}`),
      ].some((value) => normalizeText(value).includes(query));
      if (textMatch) return true;
      if (queryPhone.length >= 2 && customer.phone) {
        const custDigits = digitsOnly(customer.phone);
        const custPhone = custDigits.length === 11 && custDigits.startsWith("1") ? custDigits.slice(1) : custDigits;
        if (custPhone.includes(queryPhone)) return true;
      }
      return false;
    });
  }, [customerList, jobList, search]);

  // Auto-select a customer when navigated from global search with ?customer=<id>
  useEffect(() => {
    const customerId = searchParams.get("customer");
    if (customerId && customerList.length > 0 && !selectedCustomerId) {
      const match = customerList.find((c) => c.id === customerId);
      if (match) {
        setSelectedCustomerId(match.id);
        setActiveTab("Contact Info");
        window.location.hash = "#card";
        cardHashRef.current = true;
      }
    }
  }, [searchParams, customerList, selectedCustomerId]);

  // Estimates (proposals), invoices, and per-customer notes power the profile
  // tabs. They are re-read on mount, on window focus, and on cross-tab storage
  // changes so the profile always reflects the latest records without a refresh.
  useEffect(() => {
    function refreshRecords() {
      setStoredInvoices(readStoredInvoices());
      setStoredProposals(readStoredProposals());
      setCustomerNotes(readCustomerNotes());
    }
    refreshRecords();
    window.addEventListener("focus", refreshRecords);
    window.addEventListener("storage", refreshRecords);
    return () => {
      window.removeEventListener("focus", refreshRecords);
      window.removeEventListener("storage", refreshRecords);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    function refreshFromStore() {
      void refreshCrewData().then((data) => { if (mounted) setJobList(data.jobs); }).catch(() => {});
    }
    refreshFromStore();

    const unsubscribe = subscribeToCrewData(refreshFromStore);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  // Load + live-subscribe to real conversation events so the Communication
  // History reflects actual calls/messages across devices (never sample data).
  useEffect(() => {
    let mounted = true;
    void listConversationEvents().then((events) => { if (mounted) setConversationEvents(events); }).catch(() => {});
    const unsubscribe = subscribeToConversationEvents(() => {
      void listConversationEvents().then((events) => { if (mounted) setConversationEvents(events); }).catch(() => {});
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  // Shared, device-synced customer records (manually added / edited). Loads from
  // the server, migrates any local-only customers up once, and live-updates via
  // realtime so a change on one device appears on every device.
  useEffect(() => {
    let mounted = true;
    async function refreshCustomers() {
      const result = await loadCustomerRecordsResult();
      if (!mounted) return;
      setSavedCustomers(result.customers);
      setCustomersError(result.error ?? null);
    }
    async function init() {
      const result = await loadCustomerRecordsResult();
      if (!mounted) return;
      setCustomersError(result.error ?? null);
      if (customerSyncEnabled() && result.customers.length === 0) {
        const local = readRawLocalCustomers();
        if (local.length) {
          await Promise.all(local.map(upsertCustomerRecord));
          if (mounted) setSavedCustomers(local);
          return;
        }
      }
      setSavedCustomers(result.customers);
    }
    void init();

    const unsubscribe = subscribeToCustomerRecords(refreshCustomers);
    function onCustomerCache() { void refreshCustomers(); }
    window.addEventListener(CACHE_EVENTS.customers, onCustomerCache);
    return () => {
      mounted = false;
      unsubscribe();
      window.removeEventListener(CACHE_EVENTS.customers, onCustomerCache);
    };
  }, []);

  useAutoRefresh(() => {
    void refreshCrewData().then((data) => setJobList(data.jobs)).catch(() => {});
    void loadCustomerRecordsResult().then((result) => {
      setSavedCustomers(result.customers);
      setCustomersError(result.error ?? null);
    }).catch(() => {});
    void listConversationEvents().then((events) => setConversationEvents(events)).catch(() => {});
  });

  // After every create/update/delete we await persistence then re-fetch the
  // authoritative list from Supabase so the board never shows stale data. The
  // optimistic update keeps the change instant; the re-fetch reconciles it.
  async function syncFromServer(expectId?: string, keepIfMissing = false) {
    const records = await loadCustomerRecords();
    setSavedCustomers((current) => {
      if (keepIfMissing && expectId && !records.some((record) => record.id === expectId)) return current;
      return records;
    });
  }

  async function handleAddCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const shouldKeepAdding = submitter?.value === "add-another";

    const newCustomer: Customer = {
      id: `C-${Date.now()}`,
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      propertyAddress: form.propertyAddress.trim(),
      roofDetails: form.roofDetails.trim(),
      insuranceCarrier: form.insuranceCarrier.trim(),
      status: form.status.trim() || "New customer",
      lifetimeValue: Number(form.lifetimeValue) || 0,
    };

    setSavedCustomers((current) => [newCustomer, ...current.filter((item) => item.id !== newCustomer.id)]);
    setForm({
      name: "",
      email: "",
      phone: "",
      propertyAddress: "",
      roofDetails: "",
      insuranceCarrier: "",
      status: "New customer",
      lifetimeValue: "",
    });
    setShowForm(shouldKeepAdding);
    const result = await upsertCustomerRecord(newCustomer);
    setCustomersError(result.ok ? null : result.error ?? "Unable to save customer.");
    await syncFromServer(newCustomer.id, true);
  }

  function handleEditCustomer(customer: Customer) {
    setEditingCustomerId(customer.id);
    setEditForm(customer);
    setActiveTab("Contact Info");
  }

  async function handleSaveCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editForm) return;

    const edited = editForm;
    setSavedCustomers((current) =>
      current.some((customer) => customer.id === edited.id)
        ? current.map((customer) => (customer.id === edited.id ? edited : customer))
        : [edited, ...current],
    );
    setEditingCustomerId(null);
    setEditForm(null);
    const result = await upsertCustomerRecord(edited);
    setCustomersError(result.ok ? null : result.error ?? "Unable to save customer.");
    await syncFromServer(edited.id, true);
  }

  const [showDeleteCustomerModal, setShowDeleteCustomerModal] = useState(false);
  const [deleteCustomerTarget, setDeleteCustomerTarget] = useState<string | null>(null);

  function handleDeleteCustomer(id: string) {
    setDeleteCustomerTarget(id);
    setShowDeleteCustomerModal(true);
  }

  async function confirmDeleteCustomer() {
    if (!deleteCustomerTarget) return;
    setSavedCustomers((current) => current.filter((customer) => customer.id !== deleteCustomerTarget));
    setSelectedCustomerId(null);
    cardHashRef.current = false;
    const url = new URL(window.location.href);
    url.searchParams.delete("customer");
    url.hash = "";
    history.replaceState(history.state, "", url.pathname + url.search);
    setShowDeleteCustomerModal(false);
    setDeleteCustomerTarget(null);
    await deleteCustomerRecord(deleteCustomerTarget);
    await syncFromServer();
  }

  function handleSaveNote(id: string) {
    writeCustomerNote(id, noteDraft);
    setCustomerNotes(readCustomerNotes());
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 sm:gap-6">
      <div className="sticky top-16 z-20 -mx-3 border-b border-gray-200 bg-white/95 px-3 pb-2 pt-1 backdrop-blur-sm sm:-mx-5 sm:px-5 sm:pb-3">
        <div className="flex flex-col justify-between gap-2 sm:gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600 sm:text-sm">Customer Records</p>
            <h1 className="text-xl font-bold text-blue-700 sm:text-3xl">Customers ({customerList.length})</h1>
            <p className="crm-board-subtitle mt-1 hidden text-gray-600 sm:mt-2 sm:block">Clean customer timeline tracking. Click any customer to drill into contact details, jobs, roof info, insurance, and files.</p>
          </div>
          <button onClick={() => setShowForm(true)} className="w-fit rounded-lg bg-orange-500 px-3 py-2 text-sm font-bold text-white shadow-sm sm:px-4 sm:py-3"><Plus className="mr-1.5 inline h-4 w-4" />Add customer</button>
        </div>
      </div>

      {customersError && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-700">
          {customersError}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleAddCustomer} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-blue-700">Add new customer</h2>
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="rounded-lg border border-gray-200 px-4 py-3 outline-none" placeholder="Customer name" />
            <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="rounded-lg border border-gray-200 px-4 py-3 outline-none" placeholder="Email" />
            <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="rounded-lg border border-gray-200 px-4 py-3 outline-none" placeholder="Phone" />
            <input value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} className="rounded-lg border border-gray-200 px-4 py-3 outline-none" placeholder="Status" />
            <AddressAutocomplete
              value={form.propertyAddress}
              onChange={(address) => setForm({ ...form, propertyAddress: address })}
              placeholder="Start typing address..."
            />
            <input value={form.insuranceCarrier} onChange={(event) => setForm({ ...form, insuranceCarrier: event.target.value })} className="rounded-lg border border-gray-200 px-4 py-3 outline-none" placeholder="Insurance carrier" />
            <input type="number" value={form.lifetimeValue} onChange={(event) => setForm({ ...form, lifetimeValue: event.target.value })} className="rounded-lg border border-gray-200 px-4 py-3 outline-none" placeholder="Lifetime value" />
            <input value={form.roofDetails} onChange={(event) => setForm({ ...form, roofDetails: event.target.value })} className="rounded-lg border border-gray-200 px-4 py-3 outline-none md:col-span-2" placeholder="Roof details" />
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button value="save" className="rounded-lg bg-blue-600 px-5 py-3 font-bold text-white">Save customer</button>
            <button value="add-another" className="rounded-lg bg-orange-500 px-5 py-3 font-bold text-white">Save + add another</button>
          </div>
        </form>
      )}

      <div className="relative max-w-xl">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-lg border border-gray-200 bg-white py-3 pl-12 pr-4 outline-none" placeholder="Search by name, phone, email, or property address..." />
      </div>

      <div className="grid gap-3 lg:grid-cols-3 2xl:grid-cols-4">
        {filteredCustomers.map((customer) => {
          const activeJobs = getActiveJobCount(customer, jobList);
          return (
            <button key={customer.id} type="button" onClick={() => openCustomer(customer)} className="flex h-full flex-col rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-xl">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-lg font-bold leading-tight text-blue-700">{customer.name}</h2>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${statusTone(customer.status)}`}>{customer.status || "New customer"}</span>
              </div>
              <div className="mt-3 space-y-2 text-sm">
                <p className="flex items-start gap-2 text-gray-700"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" /><span className="font-semibold"><AddressLink value={customer.propertyAddress} fallback="Address pending" /></span></p>
                <p className="flex items-center gap-2 text-gray-700"><Phone className="h-4 w-4 shrink-0 text-orange-500" /><span className="font-semibold"><PhoneLink value={customer.phone} fallback="No phone on file" /></span>{customer.phone && <button onClick={(e) => { e.stopPropagation(); setSmsTarget({ phone: customer.phone, name: customer.name }); }} className="ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded bg-green-500 text-white hover:bg-green-600"><MessageSquare className="h-3 w-3" /></button>}</p>
              </div>
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
                <BriefcaseBusiness className="h-4 w-4 text-blue-700" />
                <span className="text-sm font-bold text-gray-900">{activeJobs} active job{activeJobs === 1 ? "" : "s"}</span>
              </div>
            </button>
          );
        })}
      </div>

      {selectedCustomer && (
        <div className="fixed inset-0 z-[60] flex justify-end bg-gray-950/30 backdrop-blur-sm" onClick={closeCustomerCard}>
          <aside className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 border-b border-gray-200 bg-white">
              <div className="flex items-start justify-between gap-4 p-5 pb-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-orange-600">Customer profile</p>
                  <h2 className="mt-1 text-2xl font-bold text-blue-700">{selectedCustomer.name}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${statusTone(selectedCustomer.status)}`}>{selectedCustomer.status || "New customer"}</span>
                    <span className="text-sm font-bold text-gray-500">{getActiveJobCount(selectedCustomer, jobList)} active • {selectedCustomerJobs.length} total job{selectedCustomerJobs.length === 1 ? "" : "s"}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => handleEditCustomer(selectedCustomer)} className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-100"><Edit3 className="h-5 w-5" /></button>
                  {savedCustomers.some((customer) => customer.id === selectedCustomer.id) && (
                    <button type="button" onClick={() => handleDeleteCustomer(selectedCustomer.id)} className="rounded-lg border border-red-200 p-2 text-red-500 hover:bg-red-50"><Trash2 className="h-5 w-5" /></button>
                  )}
                  <button type="button" onClick={closeCustomerCard} className="pointer-events-auto relative rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
                </div>
              </div>
              <div className="flex gap-1 overflow-x-auto px-3">
                {profileTabs.map((tab) => {
                  const count =
                    tab === "Jobs" ? selectedCustomerJobs.length :
                    tab === "Estimates" ? selectedCustomerProposals.length :
                    tab === "Invoices" ? selectedCustomerInvoices.length :
                    tab === "Communication History" ? selectedCustomerCommunications.length :
                    null;
                  return (
                    <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-bold transition ${activeTab === tab ? "border-orange-500 text-orange-600" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
                      {tab}{count ? ` (${count})` : ""}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-5 p-5">
              {activeTab === "Contact Info" && (
                <>
                  {editingCustomerId === selectedCustomer.id && editForm ? (
                    <form onSubmit={handleSaveCustomer} className="grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 sm:grid-cols-2">
                      <input required value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none" placeholder="Customer name" />
                      <input type="email" value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none" placeholder="Email" />
                      <input value={editForm.phone} onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })} className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none" placeholder="Phone" />
                      <input value={editForm.status} onChange={(event) => setEditForm({ ...editForm, status: event.target.value })} className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none" placeholder="Status" />
                      <AddressAutocomplete
                        value={editForm.propertyAddress}
                        onChange={(address) => setEditForm({ ...editForm, propertyAddress: address })}
                        placeholder="Start typing address..."
                      />
                      <input value={editForm.roofDetails} onChange={(event) => setEditForm({ ...editForm, roofDetails: event.target.value })} className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none" placeholder="Roof details" />
                      <input value={editForm.insuranceCarrier} onChange={(event) => setEditForm({ ...editForm, insuranceCarrier: event.target.value })} className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none" placeholder="Insurance carrier" />
                      <input type="number" value={editForm.lifetimeValue} onChange={(event) => setEditForm({ ...editForm, lifetimeValue: Number(event.target.value) || 0 })} className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none" placeholder="Lifetime value" />
                      <div className="flex gap-2 sm:col-span-2">
                        <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white">Save changes</button>
                        <button type="button" onClick={() => { setEditingCustomerId(null); setEditForm(null); }} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold text-gray-600">Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <section className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-gray-200 bg-white p-4"><Phone className="h-5 w-5 text-orange-500" /><p className="mt-2 text-xs font-bold uppercase text-gray-500">Phone Number</p><p className="flex items-center gap-2 font-bold text-gray-900"><PhoneLink value={selectedCustomer.phone} fallback="Not provided" />{selectedCustomer.phone && <button onClick={() => setSmsTarget({ phone: selectedCustomer.phone, name: selectedCustomer.name })} className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-green-500 px-2.5 text-xs font-bold text-white hover:bg-green-600"><MessageSquare className="h-3.5 w-3.5" />SMS</button>}</p></div>
                        <div className="rounded-lg border border-gray-200 bg-white p-4"><Mail className="h-5 w-5 text-orange-500" /><p className="mt-2 text-xs font-bold uppercase text-gray-500">Email Address</p><p className="font-bold text-gray-900"><EmailLink value={selectedCustomer.email} fallback="Not provided" /></p></div>
                        <div className="rounded-lg border border-gray-200 bg-white p-4 sm:col-span-2"><MapPin className="h-5 w-5 text-orange-500" /><p className="mt-2 text-xs font-bold uppercase text-gray-500">Full Property Address</p><p className="font-bold text-gray-900"><AddressLink value={selectedCustomer.propertyAddress} fallback="Not provided" /></p></div>
                      </section>
                      <section className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4"><p className="text-xs font-bold uppercase text-gray-500">Roof details</p><p className="mt-2 font-bold text-gray-900">{selectedCustomer.roofDetails || "Not provided"}</p></div>
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4"><ShieldCheck className="h-5 w-5 text-orange-600" /><p className="mt-2 text-xs font-bold uppercase text-gray-500">Insurance status</p><p className="font-bold text-gray-900">{selectedCustomer.insuranceCarrier || "Not provided"}</p></div>
                      </section>
                    </>
                  )}
                </>
              )}

              {activeTab === "Jobs" && (
                <section className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex items-center gap-2"><BriefcaseBusiness className="h-5 w-5 text-blue-700" /><h3 className="text-lg font-bold text-blue-700">Jobs</h3></div>
                  <div className="mt-4 space-y-3">
                    {selectedCustomerJobs.length > 0 ? selectedCustomerJobs.map((job) => (
                      <div key={job.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                          <div>
                            <p className="font-bold text-gray-900">{job.roofType}</p>
                            <p className="text-sm font-bold text-gray-500">{getStageLabel(job)} • {job.city}, AZ</p>
                          </div>
                          <p className="font-bold text-blue-700">${job.value.toLocaleString()}</p>
                        </div>
                        <div className="mt-3 grid gap-2 text-xs font-bold text-gray-600 sm:grid-cols-3">
                          <p className="flex items-center gap-1"><CalendarCheck2 className="h-3.5 w-3.5 text-gray-400" />Added: {getJobAddedDate(job)}</p>
                          <p>Due: {formatDate(job.dueDate)}</p>
                          <p>Completed: {getJobCompletedDate([job])}</p>
                        </div>
                      </div>
                    )) : <p className="rounded-lg bg-gray-50 p-4 text-sm font-bold text-gray-500">No related jobs found yet.</p>}
                  </div>
                </section>
              )}

              {activeTab === "Estimates" && (
                <section className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2"><FileSignature className="h-5 w-5 text-blue-700" /><h3 className="text-lg font-bold text-blue-700">Estimates &amp; Proposals</h3></div>
                    <button type="button" onClick={() => createEstimate(selectedCustomer)} className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white transition hover:bg-blue-700"><Plus className="h-4 w-4" />Create estimate</button>
                  </div>
                  <div className="mt-4 space-y-3">
                    {selectedCustomerProposals.length > 0 ? selectedCustomerProposals.map((proposal) => (
                      <button type="button" key={proposal.id} onClick={() => openEstimate(proposal.id)} className="flex w-full items-start justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-left transition hover:border-blue-200 hover:bg-blue-50">
                        <div className="min-w-0">
                          <p className="font-bold text-gray-900">{proposal.title || proposal.scope || "Estimate"}</p>
                          <p className="truncate text-sm font-bold text-gray-500"><AddressLink value={proposal.address || selectedCustomer.propertyAddress} /></p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-bold text-blue-700">${(proposal.total || 0).toLocaleString()}</p>
                          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-bold ${statusTone(proposal.status)}`}>{proposal.status || "Draft"}</span>
                        </div>
                      </button>
                    )) : <p className="rounded-lg bg-gray-50 p-4 text-sm font-bold text-gray-500">No estimates yet. Click <span className="font-bold text-blue-700">Create estimate</span> to open the estimate editor for this customer.</p>}
                  </div>
                </section>
              )}

              {activeTab === "Invoices" && (
                <section className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2"><Receipt className="h-5 w-5 text-blue-700" /><h3 className="text-lg font-bold text-blue-700">Invoices</h3></div>
                    <button type="button" onClick={() => createInvoice(selectedCustomer)} className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white transition hover:bg-blue-700"><Plus className="h-4 w-4" />Create invoice</button>
                  </div>
                  <div className="mt-4 space-y-3">
                    {selectedCustomerInvoices.length > 0 ? selectedCustomerInvoices.map((invoice) => (
                      <button type="button" key={invoice.id} onClick={() => openInvoice(invoice.id)} className="flex w-full items-start justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-left transition hover:border-blue-200 hover:bg-blue-50">
                        <div className="min-w-0">
                          <p className="font-bold text-gray-900">{invoice.invoiceNumber || `Invoice ${invoice.id}`}</p>
                          <p className="truncate text-sm font-bold text-gray-500"><AddressLink value={invoice.propertyAddress || selectedCustomer.propertyAddress} /></p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-bold text-blue-700">${invoiceTotal(invoice).toLocaleString()}</p>
                          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-bold ${statusTone(invoice.status)}`}>{invoice.status || "Draft"}</span>
                        </div>
                      </button>
                    )) : <p className="rounded-lg bg-gray-50 p-4 text-sm font-bold text-gray-500">No invoices yet. Click <span className="font-bold text-blue-700">Create invoice</span> to open the invoice editor for this customer.</p>}
                  </div>
                </section>
              )}

              {activeTab === "Files" && (
                <section className="grid gap-3 sm:grid-cols-3">
                  <Link href="/crm/files" className="rounded-lg border border-gray-200 bg-white p-4 text-left font-bold text-gray-700 transition hover:border-blue-200 hover:bg-blue-50"><ImageIcon className="mb-2 h-5 w-5 text-blue-700" />Photos</Link>
                  <Link href="/crm/files" className="rounded-lg border border-gray-200 bg-white p-4 text-left font-bold text-gray-700 transition hover:border-blue-200 hover:bg-blue-50"><FileText className="mb-2 h-5 w-5 text-blue-700" />Documents</Link>
                  <Link href="/crm/files" className="rounded-lg border border-gray-200 bg-white p-4 text-left font-bold text-gray-700 transition hover:border-blue-200 hover:bg-blue-50"><UploadCloud className="mb-2 h-5 w-5 text-blue-700" />Upload Files</Link>
                </section>
              )}

              {activeTab === "Notes" && (
                <section className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex items-center gap-2"><StickyNote className="h-5 w-5 text-blue-700" /><h3 className="text-lg font-bold text-blue-700">Notes</h3></div>
                  <textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} rows={6} className="mt-4 w-full rounded-lg border border-gray-200 p-3 text-sm outline-none" placeholder="Add internal notes about this customer..." />
                  <div className="mt-3 flex items-center gap-2">
                    <button type="button" onClick={() => handleSaveNote(selectedCustomer.id)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white">Save note</button>
                    {customerNotes[selectedCustomer.id] && noteDraft === customerNotes[selectedCustomer.id] && <span className="text-xs font-bold text-blue-600">Saved</span>}
                  </div>
                </section>
              )}

              {activeTab === "Communication History" && (
                <section className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex items-center gap-2"><MessageSquare className="h-5 w-5 text-blue-700" /><h3 className="text-lg font-bold text-blue-700">Calls, Messages &amp; Recordings</h3></div>
                  <div className="mt-4 space-y-3">
                    {selectedCustomerCommunications.length > 0 ? selectedCustomerCommunications.map(({ conversation, message }: CommunicationEntry) => {
                      const Icon = getCommunicationIcon(message);
                      return (
                        <div key={`${conversation.id}-${message.id}`} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                          <div className="flex items-start gap-3">
                            <div className="rounded-lg bg-blue-50 p-2 text-blue-700"><Icon className="h-4 w-4" /></div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm font-bold text-gray-900">{getCommunicationLabel(message)} • Job #{conversation.jobId || "Unassigned"}</p>
                                <p className="text-xs font-bold text-gray-500">{message.timestamp}</p>
                              </div>
                              <p className="mt-1 text-sm font-medium leading-5 text-gray-700">{message.body}</p>
                              <p className="mt-2 text-xs font-bold text-gray-500">Customer #{conversation.customerId || selectedCustomer.id} • Conversation #{conversation.id}</p>
                              {message.recordingUrl && <a href={proxyRecordingUrl(message.recordingUrl)} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-bold text-blue-700 hover:text-blue-800">Open recording</a>}
                            </div>
                          </div>
                        </div>
                      );
                    }) : <p className="rounded-lg bg-gray-50 p-4 text-sm font-bold text-gray-500">No linked calls, messages, or recordings yet.</p>}
                  </div>
                </section>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* ── Delete Customer Confirmation Modal ── */}
      {showDeleteCustomerModal && deleteCustomerTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" onClick={() => { setShowDeleteCustomerModal(false); setDeleteCustomerTarget(null); }}>
          <div className="w-full max-w-sm rounded-xl border border-red-200 bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600 text-lg">⚠</div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Delete Customer</h2>
                <p className="text-sm text-gray-600">This action cannot be undone.</p>
              </div>
            </div>
            <div className="mt-4 rounded-lg bg-red-50 p-3">
              <p className="text-sm font-semibold text-red-900">{savedCustomers.find((c) => c.id === deleteCustomerTarget)?.name || "Customer"}</p>
            </div>
            <p className="mt-3 text-xs text-gray-500">This will permanently remove the customer record from all devices. It will not reappear after refresh or synchronization.</p>
            <div className="mt-5 flex gap-3">
              <button onClick={() => { setShowDeleteCustomerModal(false); setDeleteCustomerTarget(null); }} className="flex-1 rounded-lg border border-gray-200 px-4 py-3 text-sm font-bold text-gray-700 transition hover:bg-gray-50">Cancel</button>
              <button onClick={() => { void confirmDeleteCustomer(); }} className="flex-1 rounded-lg bg-red-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-red-700 active:scale-95">Delete Permanently</button>
            </div>
          </div>
        </div>
      )}
      {smsTarget && <QuickSmsModal phone={smsTarget.phone} name={smsTarget.name} onClose={() => setSmsTarget(null)} />}
    </div>
  );
}
