"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { leads } from "@/lib/crm-data";
import type { Lead } from "@/types/crm";
import { loadInvoiceShares, subscribeToInvoiceShares, type InvoiceSharePayload } from "@/lib/invoice-sync";
import { updateJobRecord, crewSyncUpdatedEvent } from "@/lib/crew-sync";
import { addCrmNotification } from "@/lib/crm-notifications";
import { createClient } from "@/lib/supabase/client";
import type { Customer } from "@/types/crm";

type InvoiceStatus = "Draft" | "Sent" | "Viewed" | "Pending" | "Due Soon" | "Overdue" | "Partially Paid" | "Paid" | "Voided";
type PaymentMethod = "Cash" | "Check" | "Bank Transfer" | "Credit Card" | "Zelle" | "Stripe ACH" | "Stripe Card";

type InvoiceLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  tax: number;
};

type Payment = {
  amount: number;
  date: string;
  method: PaymentMethod;
  reference: string;
  notes: string;
  offline: boolean;
};


type ProposalPackageOption = {
  scope?: string;
  price?: number;
};

type StoredProposal = {
  id: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  address: string;
  scope: string;
  title?: string;
  total: number;
  status: string;
  selectedOption?: "good" | "better" | "best";
  signedAt?: string;
  packages?: {
    good?: string | ProposalPackageOption;
    better?: string | ProposalPackageOption;
    best?: string | ProposalPackageOption;
  };
  job?: Lead;
};
type Invoice = {
  id: string;
  invoiceNumber: string;
  clientName: string;
  email: string;
  phone: string;
  jobName: string;
  propertyAddress: string;
  issueDate: string;
  dueDate: string;
  jobReference: string;
  roofType: string;
  proposalReference: string;
  projectCompletionDate: string;
  warrantyDuration: string;
  paymentTerms: string;
  warrantyNotes: string;
  discount: number;
  status: InvoiceStatus;
  lineItems: InvoiceLineItem[];
  payments: Payment[];
  activity: string[];
  viewedAt?: string;
  paidAt?: string;
  failedAt?: string;
  sentAt?: string;
  sentBy?: string;
  emailDeliveredAt?: string;
  emailOpenedAt?: string;
};

const customersStorageKey = "xrp-crm-customers";

const today = new Date().toISOString().slice(0, 10);
const invoicesStorageKey = "xrp-crm-invoices";

const initialInvoices: Invoice[] = [
  {
    id: "inv-1001",
    invoiceNumber: "XRP-INV-1001",
    clientName: "Maria Hernandez",
    email: "maria@example.com",
    phone: "(602) 555-0184",
    jobName: "Tile Roof Replacement",
    propertyAddress: "2148 E Camelback Rd, Phoenix, AZ",
    issueDate: "2026-05-01",
    dueDate: "2026-06-01",
    jobReference: "JOB-2148",
    roofType: "Tile",
    proposalReference: "P-1001",
    projectCompletionDate: "2026-05-20",
    warrantyDuration: "10 years workmanship",
    paymentTerms: "Payment due upon receipt unless otherwise agreed in writing.",
    warrantyNotes: "Warranty begins after final payment is received.",
    discount: 500,
    status: "Sent",
    lineItems: [{ description: "Roofing labor and materials", quantity: 1, unitPrice: 18500, tax: 7.8 }],
    payments: [],
    activity: ["Invoice created"],
  },
  {
    id: "inv-1002",
    invoiceNumber: "XRP-INV-1002",
    clientName: "Priya Shah",
    email: "priya@example.com",
    phone: "(480) 555-0139",
    jobName: "Foam Roof Coating",
    propertyAddress: "7220 E Shea Blvd, Scottsdale, AZ",
    issueDate: "2026-04-20",
    dueDate: "2026-05-10",
    jobReference: "JOB-7220",
    roofType: "Foam",
    proposalReference: "P-1008",
    projectCompletionDate: "2026-04-28",
    warrantyDuration: "5 years coating",
    paymentTerms: "Remaining balance due after final walkthrough.",
    warrantyNotes: "Includes coating warranty subject to maintenance terms.",
    discount: 0,
    status: "Partially Paid",
    lineItems: [{ description: "Foam roof repair and coating", quantity: 1, unitPrice: 24200, tax: 7.8 }],
    payments: [{ amount: 10000, date: "2026-05-01", method: "Bank Transfer", reference: "ACH-2026", notes: "Deposit received", offline: false }],
    activity: ["Invoice created", "Payment recorded: $10,000"],
  },
  {
    id: "inv-1003",
    invoiceNumber: "XRP-INV-1003",
    clientName: "Sunset Retail Center",
    email: "ap@sunsetretail.example",
    phone: "(623) 555-0112",
    jobName: "Commercial TPO Repair",
    propertyAddress: "11810 W Bell Rd, Surprise, AZ",
    issueDate: "2026-04-08",
    dueDate: "2026-04-30",
    jobReference: "JOB-11810",
    roofType: "TPO",
    proposalReference: "P-1010",
    projectCompletionDate: "2026-04-18",
    warrantyDuration: "2 years repair",
    paymentTerms: "Paid in full.",
    warrantyNotes: "Repair warranty applies to serviced sections only.",
    discount: 0,
    status: "Paid",
    lineItems: [{ description: "Commercial roof repair", quantity: 1, unitPrice: 32900, tax: 7.8 }],
    payments: [{ amount: 35466.2, date: "2026-04-25", method: "Check", reference: "CHK-8821", notes: "Payment received offline", offline: true }],
    activity: ["Invoice created", "Payment recorded: $35,466.20", "Status changed to Paid"],
  },
];

const emptyLineItem: InvoiceLineItem = { description: "", quantity: 1, unitPrice: 0, tax: 0 };
const emailTemplates = {
  "Invoice sent": "Your XRP Roofing invoice is ready for review and payment.",
  "Payment reminder": "This is a friendly reminder that your roofing invoice has a remaining balance.",
  "Overdue notice": "Your roofing invoice is past due. Please contact XRP Roofing to arrange payment.",
  "Paid receipt": "Thank you. Your payment has been received and your invoice is marked paid.",
};

const filterOptions = ["All", "Paid clients", "Unpaid clients", "Overdue accounts"] as const;
const integrations = [
  { group: "Payment gateways", items: ["Stripe", "PayPal", "Square"] },
  { group: "Accounting", items: ["QuickBooks", "Xero"] },
  { group: "Communication", items: ["Gmail", "Outlook", "Twilio"] },
  { group: "CRM / Automation", items: ["Zapier", "Webhooks"] },
  { group: "Storage", items: ["Google Drive", "Dropbox"] },
];


function normalizeProposalPackage(value?: string | ProposalPackageOption): Required<ProposalPackageOption> {
  if (!value) return { scope: "Approved roofing scope of work", price: 0 };
  if (typeof value === "string") return { scope: value, price: 0 };
  return { scope: value.scope || "Approved roofing scope of work", price: Number(value.price || 0) };
}

function readWonProposals() {
  if (typeof window === "undefined") return [] as StoredProposal[];

  const savedProposals = window.localStorage.getItem("xrp-crm-proposals");
  if (!savedProposals) return [] as StoredProposal[];

  try {
    return (JSON.parse(savedProposals) as StoredProposal[]).filter((proposal) => proposal.status === "Won");
  } catch {
    return [] as StoredProposal[];
  }
}

function getProposalSelectedPackage(proposal: StoredProposal) {
  const selectedOption = proposal.selectedOption || "best";
  const packageOption = normalizeProposalPackage(proposal.packages?.[selectedOption]);
  return {
    selectedOption,
    scope: packageOption.scope || proposal.scope,
    price: packageOption.price || proposal.total,
  };
}
function currency(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function calculateTotals(invoice: Pick<Invoice, "lineItems" | "discount">) {
  const subtotal = invoice.lineItems.reduce((total, item) => total + item.quantity * item.unitPrice, 0);
  const tax = invoice.lineItems.reduce((total, item) => total + item.quantity * item.unitPrice * (item.tax / 100), 0);
  const finalTotal = Math.max(subtotal + tax - invoice.discount, 0);
  return { subtotal, tax, finalTotal };
}

function getPaidAmount(invoice: Invoice) {
  return invoice.payments.reduce((total, payment) => total + payment.amount, 0);
}

function getComputedStatus(invoice: Invoice): InvoiceStatus {
  if (invoice.status === "Draft") return "Draft";
  if (invoice.status === "Voided") return "Voided";
  const total = calculateTotals(invoice).finalTotal;
  const paid = getPaidAmount(invoice);
  if (paid >= total && total > 0) return "Paid";
  if (paid > 0) return "Partially Paid";
  const dueDate = new Date(`${invoice.dueDate}T00:00:00`);
  const currentDate = new Date(`${today}T00:00:00`);
  const daysUntilDue = Math.ceil((dueDate.getTime() - currentDate.getTime()) / 86400000);
  if (daysUntilDue < 0) return "Overdue";
  if (invoice.viewedAt || invoice.activity.includes("Viewed")) return "Viewed";
  if (daysUntilDue <= 3) return "Due Soon";
  if (invoice.status === "Sent") return "Pending";
  return invoice.status === "Pending" || invoice.status === "Due Soon" || invoice.status === "Overdue" ? invoice.status : "Pending";
}

function createInvoiceNumber(count: number) {
  return `XRP-INV-${String(1001 + count).padStart(4, "0")}`;
}

function createBlankInvoice(count: number): Invoice {
  return {
    id: "",
    invoiceNumber: createInvoiceNumber(count),
    clientName: "",
    email: "",
    phone: "",
    jobName: "",
    propertyAddress: "",
    issueDate: today,
    dueDate: today,
    jobReference: "",
    roofType: "",
    proposalReference: "",
    projectCompletionDate: today,
    warrantyDuration: "",
    paymentTerms: "Payment due upon receipt unless otherwise agreed in writing.",
    warrantyNotes: "Warranty begins after final payment is received.",
    discount: 0,
    status: "Draft",
    lineItems: [emptyLineItem],
    payments: [],
    activity: ["Invoice created"],
  };
}

function createInvoiceFromJob(job: Lead, count: number): Invoice {
  return {
    ...createBlankInvoice(count),
    clientName: job.name,
    email: job.email,
    phone: job.phone,
    jobName: `${job.roofType} Roofing Job`,
    propertyAddress: `${job.address}, ${job.city}, AZ`,
    jobReference: job.id,
    roofType: job.roofType,
    dueDate: job.dueDate || today,
    projectCompletionDate: job.dueDate || today,
    lineItems: [{ description: `${job.roofType} roofing services`, quantity: 1, unitPrice: job.value, tax: 7.8 }],
  };
}


function createInvoiceFromProposal(proposal: StoredProposal, count: number): Invoice {
  const selectedPackage = getProposalSelectedPackage(proposal);
  const job = proposal.job;

  return {
    ...createBlankInvoice(count),
    clientName: proposal.customerName,
    email: proposal.customerEmail || job?.email || "",
    phone: proposal.customerPhone || job?.phone || "",
    jobName: `${selectedPackage.selectedOption.toUpperCase()} Package - ${proposal.title || job?.roofType || "Roofing Project"}`,
    propertyAddress: proposal.address,
    jobReference: job?.id || proposal.id,
    roofType: job?.roofType || "Roofing",
    proposalReference: proposal.id,
    dueDate: today,
    projectCompletionDate: today,
    paymentTerms: "Customer may pay online by credit card or ACH bank transfer. Payment is due according to the approved proposal terms.",
    warrantyNotes: "Warranty details follow the approved proposal scope and XRP Roofing workmanship terms.",
    lineItems: [{ description: selectedPackage.scope, quantity: 1, unitPrice: selectedPackage.price, tax: 0 }],
    activity: [`Invoice created from won proposal ${proposal.id}`, `${selectedPackage.selectedOption.toUpperCase()} package selected by customer`],
  };
}
function statusBadgeClass(status: InvoiceStatus) {
  if (status === "Paid") return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  if (status === "Partially Paid") return "bg-amber-50 text-amber-700 ring-amber-100";
  if (status === "Viewed") return "bg-indigo-50 text-indigo-700 ring-indigo-100";
  if (status === "Sent" || status === "Pending") return "bg-blue-50 text-blue-700 ring-blue-100";
  if (status === "Due Soon") return "bg-orange-50 text-orange-700 ring-orange-100";
  if (status === "Overdue") return "bg-red-50 text-red-700 ring-red-100";
  if (status === "Voided") return "bg-slate-100 text-slate-600 ring-slate-200";
  if (status === "Draft") return "bg-slate-50 text-slate-700 ring-slate-200";
  return "bg-red-50 text-red-700 ring-red-100";
}

function formatDateTime(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

type TimelineStep = { label: string; at?: string; done: boolean };

function buildInvoiceTimeline(invoice: Invoice): TimelineStep[] {
  const lastPayment = invoice.payments.length ? invoice.payments[invoice.payments.length - 1] : undefined;
  return [
    { label: "Invoice Created", at: invoice.issueDate, done: true },
    { label: "Invoice Sent", at: invoice.sentAt, done: Boolean(invoice.sentAt) || invoice.status === "Sent" },
    { label: "Invoice Viewed", at: invoice.viewedAt, done: Boolean(invoice.viewedAt) },
    { label: "Payment Received", at: invoice.paidAt || lastPayment?.date, done: getComputedStatus(invoice) === "Paid" || invoice.payments.length > 0 },
  ];
}

function stageHeaderClass(stage: "Unpaid" | "Partially Paid" | "Paid") {
  if (stage === "Paid") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (stage === "Partially Paid") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-red-200 bg-red-50 text-red-700";
}

/**
 * Overlay Stripe-driven payment + tracking state from `invoice_shares` onto a
 * local invoice. Stripe is the source of truth for payment fields; everything
 * else (line items, customer info edited locally) is preserved. Returns the
 * same reference when nothing changed so React can skip re-renders.
 */
function mergeShareIntoInvoice(invoice: Invoice, share: InvoiceSharePayload): Invoice {
  const nextPayments = share.payments ? (share.payments as Payment[]) : invoice.payments;
  const nextStatus = (share.status as InvoiceStatus) || invoice.status;
  const nextActivity = share.activity && share.activity.length ? share.activity : invoice.activity;
  const changed =
    nextStatus !== invoice.status ||
    nextPayments.length !== invoice.payments.length ||
    share.viewedAt !== invoice.viewedAt ||
    share.paidAt !== invoice.paidAt ||
    share.failedAt !== invoice.failedAt ||
    share.emailDeliveredAt !== invoice.emailDeliveredAt ||
    share.emailOpenedAt !== invoice.emailOpenedAt ||
    nextActivity !== invoice.activity;

  if (!changed) return invoice;

  return {
    ...invoice,
    payments: nextPayments,
    status: nextStatus,
    activity: nextActivity,
    viewedAt: share.viewedAt ?? invoice.viewedAt,
    paidAt: share.paidAt ?? invoice.paidAt,
    failedAt: share.failedAt ?? invoice.failedAt,
    sentAt: share.sentAt ?? invoice.sentAt,
    sentBy: share.sentBy ?? invoice.sentBy,
    emailDeliveredAt: share.emailDeliveredAt ?? invoice.emailDeliveredAt,
    emailOpenedAt: share.emailOpenedAt ?? invoice.emailOpenedAt,
  };
}

/**
 * When an invoice is paid in Stripe, cascade the status to the customer record
 * (Customer Status = Paid) and the linked job (Job Payment Status = Paid), and
 * raise a CRM notification. Best-effort and guarded for SSR.
 */
function propagatePaidStatus(invoice: Invoice) {
  if (typeof window === "undefined") return;

  try {
    const raw = window.localStorage.getItem(customersStorageKey);
    if (raw) {
      const list = JSON.parse(raw) as Customer[];
      let changed = false;
      const next = list.map((customer) => {
        const matches =
          (customer.email && invoice.email && customer.email === invoice.email) ||
          customer.name.toLowerCase() === invoice.clientName.toLowerCase();
        if (matches && customer.status !== "Paid") {
          changed = true;
          return { ...customer, status: "Paid" };
        }
        return customer;
      });
      if (changed) {
        window.localStorage.setItem(customersStorageKey, JSON.stringify(next));
        window.dispatchEvent(new Event(crewSyncUpdatedEvent));
      }
    }
  } catch {
    // ignore malformed customer cache
  }

  if (invoice.jobReference) {
    void updateJobRecord(invoice.jobReference, { stage: "paid" }).catch(() => {});
  }

  addCrmNotification({
    title: "Payment received",
    message: `${invoice.clientName} paid ${invoice.invoiceNumber}`,
    actor: "Stripe",
    module: "Invoices",
  });
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>(() => {
    if (typeof window === "undefined") return initialInvoices;
    const savedInvoices = window.localStorage.getItem(invoicesStorageKey);
    if (!savedInvoices) return initialInvoices;

    try {
      return JSON.parse(savedInvoices) as Invoice[];
    } catch {
      return initialInvoices;
    }
  });
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [invoiceFilter, setInvoiceFilter] = useState<(typeof filterOptions)[number]>("All");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [integrationNotice, setIntegrationNotice] = useState("");
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  const [wonProposals, setWonProposals] = useState<StoredProposal[]>(() => readWonProposals());
  const [paymentForm, setPaymentForm] = useState({ amount: "", date: today, method: "Cash" as PaymentMethod, reference: "", notes: "" });
  const [sendForm, setSendForm] = useState({ template: "Invoice sent", subject: "Your XRP Roofing invoice", message: emailTemplates["Invoice sent"] });
  const [createForm, setCreateForm] = useState<Invoice>({
    id: "",
    invoiceNumber: createInvoiceNumber(invoices.length),
    clientName: "",
    email: "",
    phone: "",
    jobName: "",
    propertyAddress: "",
    issueDate: today,
    dueDate: today,
    jobReference: "",
    roofType: "",
    proposalReference: "",
    projectCompletionDate: today,
    warrantyDuration: "",
    paymentTerms: "Payment due upon receipt unless otherwise agreed in writing.",
    warrantyNotes: "Warranty begins after final payment is received.",
    discount: 0,
    status: "Draft",
    lineItems: [emptyLineItem],
    payments: [],
    activity: ["Invoice created"],
  });

  const paidPropagatedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    window.localStorage.setItem(invoicesStorageKey, JSON.stringify(invoices));
  }, [invoices]);

  // Identify the signed-in CRM user so "Sent By" can be recorded on send.
  useEffect(() => {
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        const email = data.session?.user.email;
        if (email) setCurrentUserEmail(email);
      })
      .catch(() => {});
  }, []);

  // Real-time Stripe payment sync: load the shared invoice state from Supabase
  // and subscribe to live changes written by the Stripe webhook. Stripe is the
  // source of truth, so payment/tracking fields are merged onto local invoices
  // without requiring a refresh.
  useEffect(() => {
    let active = true;

    // Seed with already-paid invoices so we only cascade NEW payments.
    paidPropagatedRef.current = new Set(
      invoices.filter((invoice) => getComputedStatus(invoice) === "Paid").map((invoice) => invoice.id),
    );

    function applyShare(share: InvoiceSharePayload) {
      setInvoices((current) => {
        const index = current.findIndex((invoice) => invoice.id === share.id);
        if (index === -1) return current;
        const merged = mergeShareIntoInvoice(current[index], share);
        if (merged === current[index]) return current;
        const next = [...current];
        next[index] = merged;
        return next;
      });
    }

    void loadInvoiceShares()
      .then((shares) => {
        if (active) shares.forEach(applyShare);
      })
      .catch(() => {});

    const unsubscribe = subscribeToInvoiceShares((share) => {
      if (active) applyShare(share);
    });

    return () => {
      active = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cascade Customer/Job status to Paid whenever an invoice newly becomes Paid
  // (Stripe sync or a full manual payment). Guarded so each invoice fires once.
  useEffect(() => {
    invoices.forEach((invoice) => {
      if (getComputedStatus(invoice) === "Paid" && !paidPropagatedRef.current.has(invoice.id)) {
        paidPropagatedRef.current.add(invoice.id);
        propagatePaidStatus(invoice);
      }
    });
  }, [invoices]);

  const selectedInvoice = invoices.find((invoice) => invoice.id === selectedInvoiceId) || null;
  const boardTotals = useMemo(() => {
    const total = invoices.reduce((sum, invoice) => sum + calculateTotals(invoice).finalTotal, 0);
    const paid = invoices.reduce((sum, invoice) => sum + getPaidAmount(invoice), 0);
    const balance = Math.max(total - paid, 0);
    const paidCount = invoices.filter((invoice) => getComputedStatus(invoice) === "Paid").length;
    const unpaid = invoices.filter((invoice) => !["Paid", "Voided"].includes(getComputedStatus(invoice))).length;
    const overdue = invoices.filter((invoice) => getComputedStatus(invoice) === "Overdue").length;
    const pending = invoices.filter((invoice) => ["Pending", "Due Soon", "Overdue"].includes(getComputedStatus(invoice))).length;
    const partial = invoices.filter((invoice) => getComputedStatus(invoice) === "Partially Paid").length;
    const viewed = invoices.filter((invoice) => invoice.viewedAt || invoice.activity.includes("Viewed")).length;
    const collectionRate = total > 0 ? Math.round((paid / total) * 100) : 0;
    return { total, paid, balance, paidCount, unpaid, overdue, pending, partial, viewed, collectionRate };
  }, [invoices]);
  const filteredInvoices = useMemo(() => {
    const query = invoiceSearch.toLowerCase().trim();
    return invoices.filter((invoice) => {
      const status = getComputedStatus(invoice);
      const matchesFilter =
        invoiceFilter === "All" ||
        (invoiceFilter === "Paid clients" && status === "Paid") ||
        (invoiceFilter === "Unpaid clients" && status !== "Paid" && status !== "Voided") ||
        (invoiceFilter === "Overdue accounts" && status === "Overdue");
      const matchesSearch = !query || [invoice.clientName, invoice.invoiceNumber, invoice.propertyAddress]
        .some((value) => value.toLowerCase().includes(query));
      return matchesFilter && matchesSearch;
    });
  }, [invoiceFilter, invoiceSearch, invoices]);
  const clientHistory = useMemo(() => {
    if (!selectedInvoice) return null;
    const clientInvoices = invoices.filter((invoice) => invoice.clientName === selectedInvoice.clientName);
    const totalPaid = clientInvoices.reduce((sum, invoice) => sum + getPaidAmount(invoice), 0);
    const outstandingBalance = clientInvoices.reduce((sum, invoice) => sum + Math.max(calculateTotals(invoice).finalTotal - getPaidAmount(invoice), 0), 0);
    const payments = clientInvoices.flatMap((invoice) => invoice.payments.map((payment) => ({ ...payment, invoiceNumber: invoice.invoiceNumber })));
    const lastPaymentDate = payments.map((payment) => payment.date).sort().at(-1) || "No payments yet";
    const methods = Array.from(new Set(payments.map((payment) => payment.method)));
    return { clientInvoices, totalPaid, outstandingBalance, payments, lastPaymentDate, methods };
  }, [invoices, selectedInvoice]);
  const boardGroups = useMemo(() => {
    const groups: Record<"Unpaid" | "Partially Paid" | "Paid", Invoice[]> = { Unpaid: [], "Partially Paid": [], Paid: [] };
    filteredInvoices.forEach((invoice) => {
      const status = getComputedStatus(invoice);
      if (status === "Paid") groups.Paid.push(invoice);
      else if (status === "Partially Paid") groups["Partially Paid"].push(invoice);
      else groups.Unpaid.push(invoice);
    });
    return groups;
  }, [filteredInvoices]);

  function updateInvoice(nextInvoice: Invoice, activity?: string) {
    const status = getComputedStatus(nextInvoice);
    const statusActivity = status !== nextInvoice.status ? [`Status changed to ${status}`, `Notification: ${status === "Paid" ? "New payment received" : status === "Partially Paid" ? "Partial payment made" : status === "Overdue" ? "Invoice overdue" : `Invoice ${status.toLowerCase()}`}`] : [];
    const updatedInvoice = { ...nextInvoice, status, activity: [...(activity ? [activity] : []), ...statusActivity, ...nextInvoice.activity] };
    setInvoices((currentInvoices) => currentInvoices.map((invoice) => invoice.id === updatedInvoice.id ? updatedInvoice : invoice));
  }

  function openInvoice(invoice: Invoice) {
    setSelectedInvoiceId(invoice.id);
    if (!invoice.activity.includes("Viewed")) {
      updateInvoice(invoice, "Viewed");
    }
  }

  function handleCreateInvoice() {
    const invoice: Invoice = {
      ...createForm,
      id: `inv-${Date.now()}`,
      invoiceNumber: createInvoiceNumber(invoices.length),
      status: getComputedStatus(createForm),
      activity: ["Invoice created"],
    };
    setInvoices((currentInvoices) => [invoice, ...currentInvoices]);
    setSelectedInvoiceId(invoice.id);
    setCreateForm(createBlankInvoice(invoices.length + 1));
    setShowCreateModal(false);
  }

  function handleStartInvoice() {
    setWonProposals(readWonProposals());
    setCreateForm(createBlankInvoice(invoices.length));
    setShowCreateModal(true);
  }

  function handlePrefillFromJob(sourceId: string) {
    if (sourceId.startsWith("proposal:")) {
      const proposalId = sourceId.replace("proposal:", "");
      const proposal = wonProposals.find((item) => item.id === proposalId);
      if (proposal) setCreateForm(createInvoiceFromProposal(proposal, invoices.length));
      return;
    }

    const job = leads.find((item) => item.id === sourceId);
    if (!job) return;
    setCreateForm(createInvoiceFromJob(job, invoices.length));
  }

  function handleRecordPayment(offline = false) {
    if (!selectedInvoice) return;
    const amount = Number(paymentForm.amount) || 0;
    if (amount <= 0) return;
    const payment: Payment = { ...paymentForm, amount, offline };
    updateInvoice({ ...selectedInvoice, payments: [...selectedInvoice.payments, payment] }, `${offline ? "Offline payment" : "Manual payment"} recorded: ${currency(amount)}`);
    setPaymentForm({ amount: "", date: today, method: "Cash", reference: "", notes: "" });
    setShowPaymentModal(false);
  }

  async function handleSendInvoice() {
    if (!selectedInvoice) return;
    const invoiceLink = `${window.location.origin}/invoice/${encodeURIComponent(selectedInvoice.id)}`;
    const totals = calculateTotals(selectedInvoice);
    const balance = Math.max(totals.finalTotal - getPaidAmount(selectedInvoice), 0);

    setSendForm((currentForm) => ({ ...currentForm, message: "Sending invoice email..." }));

    const sentAt = new Date().toISOString();
    const sentBy = currentUserEmail || "CRM user";
    const sentInvoice: Invoice = { ...selectedInvoice, status: "Sent", sentAt, sentBy };

    try {
      const shareResponse = await fetch("/api/invoices/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sentInvoice),
      });

      if (!shareResponse.ok) {
        throw new Error("Invoice sharing is not configured. Please set up the invoice_shares table before sending customer payment links.");
      }

      const response = await fetch("/api/invoices/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toName: selectedInvoice.clientName,
          toEmail: selectedInvoice.email,
          subject: sendForm.subject,
          message: sendForm.message,
          invoiceNumber: selectedInvoice.invoiceNumber,
          invoiceId: selectedInvoice.id,
          invoiceLink,
          balance: currency(balance),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Unable to send invoice email");
      }

      updateInvoice(sentInvoice, `Invoice Sent to ${selectedInvoice.email || selectedInvoice.clientName} by ${sentBy}`);
      setShowSendModal(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invoice email could not be sent.";
      setSendForm((currentForm) => ({ ...currentForm, message: `${sendForm.message}\n\n${message}` }));
    }
  }

  function handleDownloadPdf(invoice: Invoice) {
    const totals = calculateTotals(invoice);
    const paid = getPaidAmount(invoice);
    const paidStamp = getComputedStatus(invoice) === "Paid" ? "PAID\n" : "";
    const offlinePayment = invoice.payments.some((payment) => payment.offline) ? "Payment Received Offline\n" : "";
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>${invoice.invoiceNumber}</title>
          <style>
            body { font-family: Georgia, serif; color: #0f172a; padding: 40px; }
            .header { display: flex; justify-content: space-between; border-bottom: 4px solid #07183f; padding-bottom: 20px; }
            .brand { font-size: 32px; font-weight: 900; color: #07183f; }
            .stamp { position: fixed; top: 170px; right: 70px; color: #dc2626; border: 6px solid #dc2626; padding: 12px 28px; font-size: 44px; font-weight: 900; transform: rotate(-14deg); opacity: .75; }
            table { width: 100%; border-collapse: collapse; margin-top: 28px; }
            th, td { border-bottom: 1px solid #e2e8f0; padding: 12px; text-align: left; }
            th { background: #f8fafc; color: #07183f; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 24px; }
            .box { background: #f8fafc; border-radius: 18px; padding: 18px; }
            .total { text-align: right; font-size: 22px; font-weight: 900; color: #07183f; }
            @media print { button { display: none; } }
          </style>
        </head>
        <body>
          ${paidStamp ? '<div class="stamp">PAID</div>' : ""}
          <button onclick="window.print()">Download / Save PDF</button>
          <div class="header"><div><div class="brand">XRP Roofing</div><p>ROC #350898</p></div><div><h1>Invoice</h1><p>${invoice.invoiceNumber}</p>${offlinePayment ? "<strong>Payment Received Offline</strong>" : ""}</div></div>
          <div class="grid"><div class="box"><h3>Client Details</h3><p>${invoice.clientName}</p><p>${invoice.email}</p><p>${invoice.phone}</p><p>${invoice.propertyAddress}</p></div><div class="box"><h3>Job Details</h3><p>${invoice.jobName}</p><p>Roof Type: ${invoice.roofType}</p><p>Proposal: ${invoice.proposalReference}</p><p>Completion: ${invoice.projectCompletionDate}</p></div></div>
          <table><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Tax</th><th>Total</th></tr></thead><tbody>${invoice.lineItems.map((item) => `<tr><td>${item.description}</td><td>${item.quantity}</td><td>${currency(item.unitPrice)}</td><td>${item.tax}%</td><td>${currency(item.quantity * item.unitPrice * (1 + item.tax / 100))}</td></tr>`).join("")}</tbody></table>
          <p class="total">Total: ${currency(totals.finalTotal)}<br/>Paid: ${currency(paid)}<br/>Balance: ${currency(Math.max(totals.finalTotal - paid, 0))}</p>
          <div class="grid"><div class="box"><h3>Payment Terms</h3><p>${invoice.paymentTerms}</p></div><div class="box"><h3>Warranty Notes</h3><p>${invoice.warrantyNotes}</p><p>${invoice.warrantyDuration}</p></div></div>
        </body>
      </html>
    `);
    printWindow.document.close();
    updateInvoice(invoice, "PDF downloaded");
  }

  function handleMarkPaidOffline() {
    if (!selectedInvoice) return;
    const balance = Math.max(calculateTotals(selectedInvoice).finalTotal - getPaidAmount(selectedInvoice), 0);
    if (balance <= 0) return;
    const payment: Payment = { amount: balance, date: today, method: "Cash", reference: "OFFLINE", notes: "Payment Received Offline", offline: true };
    updateInvoice({ ...selectedInvoice, payments: [...selectedInvoice.payments, payment] }, "Payment Received Offline");
  }

  function renderInvoiceFields(invoice: Invoice, editable: boolean, onChange: (invoice: Invoice) => void) {
    const totals = calculateTotals(invoice);
    const inputClass = "mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-50 disabled:bg-slate-50";
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <label className="text-xs font-black uppercase tracking-wider text-slate-500">Client name<input disabled={!editable} value={invoice.clientName} onChange={(event) => onChange({ ...invoice, clientName: event.target.value })} className={inputClass} placeholder="Client name" /></label>
        <label className="text-xs font-black uppercase tracking-wider text-slate-500">Email<input disabled={!editable} value={invoice.email} onChange={(event) => onChange({ ...invoice, email: event.target.value })} className={inputClass} placeholder="Email" /></label>
        <label className="text-xs font-black uppercase tracking-wider text-slate-500">Phone<input disabled={!editable} value={invoice.phone} onChange={(event) => onChange({ ...invoice, phone: event.target.value })} className={inputClass} placeholder="Phone" /></label>
        <label className="text-xs font-black uppercase tracking-wider text-slate-500">Property address<input disabled={!editable} value={invoice.propertyAddress} onChange={(event) => onChange({ ...invoice, propertyAddress: event.target.value })} className={inputClass} placeholder="Property address" /></label>
        <label className="text-xs font-black uppercase tracking-wider text-slate-500">Job name<input disabled={!editable} value={invoice.jobName} onChange={(event) => onChange({ ...invoice, jobName: event.target.value })} className={inputClass} placeholder="Job reference/name" /></label>
        <label className="text-xs font-black uppercase tracking-wider text-slate-500">Job reference<input disabled={!editable} value={invoice.jobReference} onChange={(event) => onChange({ ...invoice, jobReference: event.target.value })} className={inputClass} placeholder="Job reference" /></label>
        <label className="text-xs font-black uppercase tracking-wider text-slate-500">Issue date<input disabled={!editable} type="date" value={invoice.issueDate} onChange={(event) => onChange({ ...invoice, issueDate: event.target.value })} className={inputClass} /></label>
        <label className="text-xs font-black uppercase tracking-wider text-slate-500">Due date<input disabled={!editable} type="date" value={invoice.dueDate} onChange={(event) => onChange({ ...invoice, dueDate: event.target.value })} className={inputClass} /></label>
        <label className="text-xs font-black uppercase tracking-wider text-slate-500">Roof type<input disabled={!editable} value={invoice.roofType} onChange={(event) => onChange({ ...invoice, roofType: event.target.value })} className={inputClass} placeholder="Roof type" /></label>
        <label className="text-xs font-black uppercase tracking-wider text-slate-500">Proposal reference<input disabled={!editable} value={invoice.proposalReference} onChange={(event) => onChange({ ...invoice, proposalReference: event.target.value })} className={inputClass} placeholder="Proposal reference" /></label>
        <label className="text-xs font-black uppercase tracking-wider text-slate-500">Project completion date<input disabled={!editable} type="date" value={invoice.projectCompletionDate} onChange={(event) => onChange({ ...invoice, projectCompletionDate: event.target.value })} className={inputClass} /></label>
        <label className="text-xs font-black uppercase tracking-wider text-slate-500">Warranty duration<input disabled={!editable} value={invoice.warrantyDuration} onChange={(event) => onChange({ ...invoice, warrantyDuration: event.target.value })} className={inputClass} placeholder="Warranty duration" /></label>
        <label className="text-xs font-black uppercase tracking-wider text-slate-500 lg:col-span-2">Payment terms<textarea disabled={!editable} value={invoice.paymentTerms} onChange={(event) => onChange({ ...invoice, paymentTerms: event.target.value })} className={`${inputClass} min-h-28`} placeholder="Payment terms" /></label>
        <label className="text-xs font-black uppercase tracking-wider text-slate-500 lg:col-span-2">Warranty notes<textarea disabled={!editable} value={invoice.warrantyNotes} onChange={(event) => onChange({ ...invoice, warrantyNotes: event.target.value })} className={`${inputClass} min-h-28`} placeholder="Warranty notes" /></label>
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-black text-[#07183f]">Line Items</h3>
            {editable && <button type="button" onClick={() => onChange({ ...invoice, lineItems: [...invoice.lineItems, emptyLineItem] })} className="rounded-full bg-blue-50 px-4 py-2 text-sm font-black text-blue-700">+ Add line</button>}
          </div>
          <div className="space-y-3">
            {invoice.lineItems.map((item, index) => (
              <div key={index} className="grid gap-2 rounded-2xl bg-slate-50 p-3 md:grid-cols-[1fr_90px_120px_90px]">
                <input disabled={!editable} value={item.description} onChange={(event) => { const lineItems = [...invoice.lineItems]; lineItems[index] = { ...item, description: event.target.value }; onChange({ ...invoice, lineItems }); }} className="rounded-xl border border-slate-200 px-3 py-2 outline-none disabled:bg-white" placeholder="Description" />
                <input disabled={!editable} type="number" value={item.quantity} onChange={(event) => { const lineItems = [...invoice.lineItems]; lineItems[index] = { ...item, quantity: Number(event.target.value) || 0 }; onChange({ ...invoice, lineItems }); }} className="rounded-xl border border-slate-200 px-3 py-2 outline-none disabled:bg-white" placeholder="Qty" />
                <input disabled={!editable} type="number" value={item.unitPrice} onChange={(event) => { const lineItems = [...invoice.lineItems]; lineItems[index] = { ...item, unitPrice: Number(event.target.value) || 0 }; onChange({ ...invoice, lineItems }); }} className="rounded-xl border border-slate-200 px-3 py-2 outline-none disabled:bg-white" placeholder="Unit price" />
                <input disabled={!editable} type="number" value={item.tax} onChange={(event) => { const lineItems = [...invoice.lineItems]; lineItems[index] = { ...item, tax: Number(event.target.value) || 0 }; onChange({ ...invoice, lineItems }); }} className="rounded-xl border border-slate-200 px-3 py-2 outline-none disabled:bg-white" placeholder="Tax %" />
              </div>
            ))}
          </div>
        </div>
        <label className="text-xs font-black uppercase tracking-wider text-slate-500">Discount<input disabled={!editable} type="number" value={invoice.discount} onChange={(event) => onChange({ ...invoice, discount: Number(event.target.value) || 0 })} className={inputClass} placeholder="Discount" /></label>
        <div className="rounded-2xl bg-gradient-to-br from-slate-50 to-white p-4 text-sm font-bold text-slate-700 ring-1 ring-slate-100">
          <div className="flex justify-between"><span>Subtotal</span><span>{currency(totals.subtotal)}</span></div>
          <div className="mt-2 flex justify-between"><span>Tax</span><span>{currency(totals.tax)}</span></div>
          <div className="mt-2 flex justify-between"><span>Discount</span><span>{currency(invoice.discount)}</span></div>
          <div className="mt-3 border-t border-slate-200 pt-3">
            <p className="text-xs font-black uppercase tracking-wider text-slate-500">Final Total</p>
            <p className="mt-1 text-2xl font-black text-[#07183f]">{currency(totals.finalTotal)}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="sticky top-16 z-20 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:top-20">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">CRM Module</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Invoice Board</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">Create, track, send, and collect roofing invoices from one clean workspace.</p>
          </div>
          <button onClick={handleStartInvoice} className="w-fit rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700">+ New Invoice</button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          {[
            ["Paid Invoices", String(boardTotals.paidCount), "text-emerald-700"],
            ["Unpaid Invoices", String(boardTotals.unpaid), "text-slate-950"],
            ["Overdue Invoices", String(boardTotals.overdue), "text-red-700"],
            ["Viewed Invoices", String(boardTotals.viewed), "text-blue-700"],
            ["Outstanding Balance", currency(boardTotals.balance), "text-slate-950"],
            ["Collection Rate", `${boardTotals.collectionRate}%`, "text-slate-950"],
          ].map(([label, value, valueClass]) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
              <p className={`mt-2 text-xl font-bold tracking-tight ${valueClass}`}>{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-col items-stretch justify-between gap-3 xl:flex-row xl:items-center">
          <div className="mx-auto w-full max-w-2xl">
            <input value={invoiceSearch} onChange={(event) => setInvoiceSearch(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-50" placeholder="Search invoices by client, invoice number, or property..." />
          </div>
          <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-100 p-1">
            {filterOptions.map((option) => (
              <button key={option} type="button" onClick={() => setInvoiceFilter(option)} className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${invoiceFilter === option ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{option.replace(" clients", "").replace(" accounts", "")}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {(Object.keys(boardGroups) as Array<keyof typeof boardGroups>).map((stage) => {
          const invoicesInStage = boardGroups[stage];
          const stageTotal = invoicesInStage.reduce((total, invoice) => total + calculateTotals(invoice).finalTotal, 0);
          return (
            <section key={stage} className="flex max-h-[68vh] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm lg:max-h-[calc(100vh-20rem)]">
              <div className={`flex shrink-0 items-center justify-between border-b p-4 ${stageHeaderClass(stage)}`}>
                <div>
                  <h2 className="text-base font-bold text-slate-950">{stage}</h2>
                  <p className="text-sm text-slate-500">{invoicesInStage.length} invoices</p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">{currency(stageTotal)}</span>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {invoicesInStage.map((invoice) => {
                  const totals = calculateTotals(invoice);
                  const balance = Math.max(totals.finalTotal - getPaidAmount(invoice), 0);
                  const status = getComputedStatus(invoice);
                  return (
                    <article key={invoice.id} className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md">
                      <button type="button" onClick={() => openInvoice(invoice)} className="w-full text-left">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-base font-bold text-slate-950">{invoice.clientName}</p>
                            <p className="mt-1 truncate text-sm text-slate-500">{invoice.invoiceNumber} · {invoice.jobName || invoice.roofType}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusBadgeClass(status)}`}>{status}</span>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Total Amount</p>
                            <p className="mt-1 font-bold text-slate-950">{currency(totals.finalTotal)}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Balance Due</p>
                            <p className={`mt-1 font-bold ${balance > 0 ? "text-red-700" : "text-emerald-700"}`}>{currency(balance)}</p>
                          </div>
                        </div>
                        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                          <p className="text-xs font-semibold text-slate-500">Due {invoice.dueDate}</p>
                          <p className="text-xs font-semibold text-slate-400">View details</p>
                        </div>
                      </button>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={() => openInvoice(invoice)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200">View</button>
                        <button type="button" onClick={() => { setSelectedInvoiceId(invoice.id); setEditing(true); }} className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100">Edit</button>
                        <button type="button" onClick={() => { setSelectedInvoiceId(invoice.id); setSendForm({ template: "Payment reminder", subject: "Reminder: Your XRP Roofing invoice", message: emailTemplates["Payment reminder"] }); setShowSendModal(true); }} className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100">Send Reminder</button>
                      </div>
                    </article>
                  );
                })}
                {invoicesInStage.length === 0 && <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">No invoices in this column.</div>}
              </div>
            </section>
          );
        })}
      </div>

      {selectedInvoice && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/40 p-4">
          <div className="mx-auto my-6 max-w-6xl rounded-[2rem] bg-white p-6 shadow-2xl">
            <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-start">
              <div>
                <button onClick={() => setSelectedInvoiceId(null)} className="mb-4 text-sm font-black text-blue-700">← Back to invoice board</button>
                <p className="text-sm font-bold uppercase tracking-[0.2em] text-orange-600">{selectedInvoice.invoiceNumber}</p>
                <h2 className="mt-2 text-3xl font-black text-[#07183f]">{selectedInvoice.clientName}</h2>
                <p className="mt-1 font-semibold text-slate-600">{selectedInvoice.jobName}</p>
                <p className="text-sm text-slate-500">{selectedInvoice.propertyAddress}</p>
              </div>
              <div className="text-left lg:text-right">
                <span className={`rounded-full px-4 py-2 text-sm font-black ring-1 ${statusBadgeClass(getComputedStatus(selectedInvoice))}`}>{getComputedStatus(selectedInvoice)}</span>
                <p className="mt-4 text-sm font-bold text-slate-500">Total amount</p>
                <p className="text-3xl font-black text-[#07183f]">{currency(calculateTotals(selectedInvoice).finalTotal)}</p>
                <p className="mt-2 text-sm font-bold text-slate-600">Remaining balance {currency(Math.max(calculateTotals(selectedInvoice).finalTotal - getPaidAmount(selectedInvoice), 0))}</p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={() => setEditing((current) => !current)} className="rounded-2xl bg-blue-50 px-4 py-3 font-bold text-blue-700">{editing ? "Done Editing" : "Edit"}</button>
              <button onClick={() => setShowSendModal(true)} className="rounded-2xl bg-blue-600 px-4 py-3 font-bold text-white">Send</button>
              <button onClick={() => handleDownloadPdf(selectedInvoice)} className="rounded-2xl border border-slate-200 px-4 py-3 font-bold text-slate-700">Download PDF</button>
              <button onClick={() => setShowPaymentModal(true)} className="rounded-2xl bg-emerald-50 px-4 py-3 font-bold text-emerald-700">Record Payment</button>
              <button onClick={handleMarkPaidOffline} className="rounded-2xl bg-slate-100 px-4 py-3 font-bold text-slate-700">Mark Paid Offline</button>
              <button onClick={() => updateInvoice({ ...selectedInvoice, status: "Voided" }, "Invoice voided")} className="rounded-2xl bg-red-50 px-4 py-3 font-bold text-red-700">Void Invoice</button>
            </div>
            <div className="mt-6">{renderInvoiceFields(selectedInvoice, editing, updateInvoice)}</div>

            <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-black text-[#07183f]">Sent To</h3>
                <div className="flex flex-wrap gap-2">
                  {([
                    { label: "Email Delivered", at: selectedInvoice.emailDeliveredAt, fallbackDone: Boolean(selectedInvoice.sentAt) },
                    { label: "Email Opened", at: selectedInvoice.emailOpenedAt, fallbackDone: false },
                    { label: "Invoice Viewed", at: selectedInvoice.viewedAt, fallbackDone: false },
                  ] as const).map((indicator) => {
                    const done = Boolean(indicator.at) || indicator.fallbackDone;
                    return (
                      <span key={indicator.label} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black ring-1 ${done ? "bg-emerald-50 text-emerald-700 ring-emerald-100" : "bg-slate-50 text-slate-400 ring-slate-200"}`}>
                        <span className={`h-2 w-2 rounded-full ${done ? "bg-emerald-500" : "bg-slate-300"}`} />
                        {indicator.label}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">Customer Name</p><p className="mt-1 text-sm font-bold text-[#07183f]">{selectedInvoice.clientName || "—"}</p></div>
                <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">Customer Email</p><p className="mt-1 text-sm font-bold text-[#07183f] break-all">{selectedInvoice.email || "—"}</p></div>
                <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">Date Sent</p><p className="mt-1 text-sm font-bold text-[#07183f]">{formatDateTime(selectedInvoice.sentAt) || "Not sent yet"}</p></div>
                <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">Sent By User</p><p className="mt-1 text-sm font-bold text-[#07183f] break-all">{selectedInvoice.sentBy || "—"}</p></div>
              </div>
            </section>

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <section className="rounded-3xl bg-slate-50 p-5">
                <h3 className="font-black text-[#07183f]">Payments</h3>
                <div className="mt-3 space-y-2">
                  {selectedInvoice.payments.map((payment, index) => <p key={index} className="rounded-2xl bg-white p-3 text-sm font-semibold text-slate-600">{currency(payment.amount)} · {payment.method} · {payment.date}{payment.offline ? " · Payment Received Offline" : ""}</p>)}
                  {selectedInvoice.payments.length === 0 && <p className="text-sm font-semibold text-slate-500">No payments recorded yet.</p>}
                </div>
              </section>
              <section className="rounded-3xl bg-slate-50 p-5">
                <h3 className="font-black text-[#07183f]">Activity Timeline</h3>
                <ol className="mt-4 space-y-4">
                  {buildInvoiceTimeline(selectedInvoice).map((step, index, steps) => (
                    <li key={step.label} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-black text-white ${step.done ? "bg-emerald-500" : "bg-slate-300"}`}>{step.done ? "✓" : index + 1}</span>
                        {index < steps.length - 1 && <span className={`mt-1 w-0.5 flex-1 ${step.done ? "bg-emerald-200" : "bg-slate-200"}`} />}
                      </div>
                      <div className="pb-1">
                        <p className={`text-sm font-black ${step.done ? "text-[#07183f]" : "text-slate-400"}`}>{step.label}</p>
                        <p className="text-xs font-semibold text-slate-500">{step.done ? (formatDateTime(step.at) || "Completed") : "Pending"}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <details className="mt-4">
                  <summary className="cursor-pointer text-xs font-black uppercase tracking-wide text-slate-500">Full activity log</summary>
                  <div className="mt-2 space-y-2">
                    {selectedInvoice.activity.map((item, index) => <p key={index} className="rounded-2xl bg-white p-3 text-sm font-semibold text-slate-600">{item}</p>)}
                  </div>
                </details>
              </section>
            </div>
            {clientHistory && (
              <section className="mt-6 rounded-3xl bg-slate-50 p-5">
                <h3 className="font-black text-[#07183f]">Client Payment History</h3>
                <div className="mt-4 grid gap-3 md:grid-cols-5">
                  <div className="rounded-2xl bg-white p-4"><p className="text-xs font-black uppercase text-slate-500">Invoices sent</p><p className="mt-2 text-xl font-black text-[#07183f]">{clientHistory.clientInvoices.length}</p></div>
                  <div className="rounded-2xl bg-white p-4"><p className="text-xs font-black uppercase text-slate-500">Total paid</p><p className="mt-2 text-xl font-black text-emerald-700">{currency(clientHistory.totalPaid)}</p></div>
                  <div className="rounded-2xl bg-white p-4"><p className="text-xs font-black uppercase text-slate-500">Outstanding</p><p className="mt-2 text-xl font-black text-orange-700">{currency(clientHistory.outstandingBalance)}</p></div>
                  <div className="rounded-2xl bg-white p-4"><p className="text-xs font-black uppercase text-slate-500">Last payment</p><p className="mt-2 text-sm font-black text-[#07183f]">{clientHistory.lastPaymentDate}</p></div>
                  <div className="rounded-2xl bg-white p-4"><p className="text-xs font-black uppercase text-slate-500">Methods used</p><p className="mt-2 text-sm font-black text-[#07183f]">{clientHistory.methods.join(", ") || "None"}</p></div>
                </div>
                <div className="mt-4 space-y-2">
                  {clientHistory.payments.map((payment, index) => (
                    <p key={`${payment.invoiceNumber}-${index}`} className="rounded-2xl bg-white p-3 text-sm font-semibold text-slate-600">{payment.date} · {payment.invoiceNumber} · {currency(payment.amount)} · {payment.method} · {payment.reference || "No reference"}</p>
                  ))}
                  {clientHistory.payments.length === 0 && <p className="rounded-2xl bg-white p-3 text-sm font-semibold text-slate-500">No client payments recorded yet.</p>}
                </div>
              </section>
            )}
            <section className="mt-6 rounded-3xl bg-slate-50 p-5">
              <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                <div>
                  <h3 className="font-black text-[#07183f]">Integrations</h3>
                  <p className="mt-1 text-sm font-semibold text-slate-500">Connect payment, accounting, communication, automation, and storage platforms.</p>
                </div>
                <button type="button" onClick={() => setIntegrationNotice("Stripe is ready to connect. Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to enable live payment links, successful payment sync, failed payment alerts, and auto-paid invoice updates.")} className="rounded-2xl bg-[#07183f] px-4 py-3 text-sm font-black text-white">Connect Stripe</button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {integrations.map((integration) => (
                  <div key={integration.group} className="rounded-2xl bg-white p-4">
                    <p className="text-xs font-black uppercase tracking-wider text-slate-500">{integration.group}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {integration.items.map((item) => <span key={item} className="rounded-full bg-slate-50 px-3 py-1 text-xs font-black text-slate-600">{item}</span>)}
                    </div>
                  </div>
                ))}
              </div>
              {integrationNotice && <p className="mt-4 rounded-2xl bg-blue-50 p-4 text-sm font-bold leading-6 text-blue-700">{integrationNotice}</p>}
            </section>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/40 p-4">
          <div className="mx-auto my-6 max-w-5xl rounded-[2rem] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.2em] text-orange-600">New invoice</p>
                <h2 className="mt-2 text-3xl font-black text-[#07183f]">{createForm.invoiceNumber}</h2>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="text-2xl text-slate-500">×</button>
            </div>
            <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-4">
              <label className="text-xs font-black uppercase tracking-wider text-blue-700">Quick fill from roofing job</label>
              <select onChange={(event) => handlePrefillFromJob(event.target.value)} className="mt-2 w-full rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none">
                <option value="">Start blank or select a job...</option>
                {leads.map((job) => <option key={job.id} value={job.id}>{job.name} • {job.roofType} • {currency(job.value)}</option>)}
              </select>
            </div>
            <div className="mt-6">{renderInvoiceFields(createForm, true, setCreateForm)}</div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setShowCreateModal(false)} className="rounded-2xl border border-slate-200 px-5 py-3 font-bold text-slate-700">Cancel</button>
              <button onClick={handleCreateInvoice} className="rounded-2xl bg-orange-500 px-5 py-3 font-bold text-white">Create Invoice</button>
            </div>
          </div>
        </div>
      )}

      {showPaymentModal && selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-xl rounded-[2rem] bg-white p-6 shadow-2xl">
            <h2 className="text-2xl font-black text-[#07183f]">Record Payment</h2>
            <div className="mt-5 grid gap-3">
              <input type="number" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Payment amount" />
              <input type="date" value={paymentForm.date} onChange={(event) => setPaymentForm({ ...paymentForm, date: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" />
              <select value={paymentForm.method} onChange={(event) => setPaymentForm({ ...paymentForm, method: event.target.value as PaymentMethod })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none">
                {(["Cash", "Check", "Bank Transfer", "Zelle"] as PaymentMethod[]).map((method) => <option key={method}>{method}</option>)}
              </select>
              <input value={paymentForm.reference} onChange={(event) => setPaymentForm({ ...paymentForm, reference: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Reference number" />
              <textarea value={paymentForm.notes} onChange={(event) => setPaymentForm({ ...paymentForm, notes: event.target.value })} className="min-h-28 rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Notes" />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setShowPaymentModal(false)} className="rounded-2xl border border-slate-200 px-5 py-3 font-bold text-slate-700">Cancel</button>
              <button onClick={() => handleRecordPayment(false)} className="rounded-2xl bg-emerald-600 px-5 py-3 font-bold text-white">Save Payment</button>
            </div>
          </div>
        </div>
      )}

      {showSendModal && selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-2xl rounded-[2rem] bg-white p-6 shadow-2xl">
            <h2 className="text-2xl font-black text-[#07183f]">Send Invoice</h2>
            <div className="mt-5 grid gap-3">
              <select value={sendForm.template} onChange={(event) => setSendForm({ ...sendForm, template: event.target.value, message: emailTemplates[event.target.value as keyof typeof emailTemplates] })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none">
                {Object.keys(emailTemplates).map((template) => <option key={template}>{template}</option>)}
              </select>
              <input value={sendForm.subject} onChange={(event) => setSendForm({ ...sendForm, subject: event.target.value })} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Subject" />
              <textarea value={sendForm.message} onChange={(event) => setSendForm({ ...sendForm, message: event.target.value })} className="min-h-40 rounded-2xl border border-slate-200 px-4 py-3 outline-none" />
            </div>
            <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              <p className="font-black text-[#07183f]">{selectedInvoice.invoiceNumber}</p>
              <p>To: {selectedInvoice.clientName} · {selectedInvoice.email}</p>
              <p className="font-bold text-blue-700">Customer can pay online by ACH bank transfer or credit card.</p>
              <p>{sendForm.message}</p>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setShowSendModal(false)} className="rounded-2xl border border-slate-200 px-5 py-3 font-bold text-slate-700">Cancel</button>
              <button onClick={handleSendInvoice} className="rounded-2xl bg-blue-600 px-5 py-3 font-bold text-white">Send Invoice</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}





