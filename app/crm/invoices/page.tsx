"use client";

import { useMemo, useState } from "react";

type InvoiceStatus = "Draft" | "Sent" | "Pending" | "Due Soon" | "Overdue" | "Partially Paid" | "Paid" | "Voided";
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
};

const today = new Date().toISOString().slice(0, 10);

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
  if (daysUntilDue <= 3) return "Due Soon";
  if (invoice.status === "Sent") return "Pending";
  return invoice.status === "Pending" || invoice.status === "Due Soon" || invoice.status === "Overdue" ? invoice.status : "Pending";
}

function createInvoiceNumber(count: number) {
  return `XRP-INV-${String(1001 + count).padStart(4, "0")}`;
}

function statusBadgeClass(status: InvoiceStatus) {
  if (status === "Paid") return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  if (status === "Partially Paid") return "bg-blue-50 text-blue-700 ring-blue-100";
  if (status === "Due Soon") return "bg-amber-50 text-amber-700 ring-amber-100";
  if (status === "Overdue") return "bg-red-50 text-red-700 ring-red-100";
  if (status === "Voided") return "bg-slate-100 text-slate-600 ring-slate-200";
  if (status === "Draft") return "bg-slate-50 text-slate-700 ring-slate-200";
  return "bg-orange-50 text-orange-700 ring-orange-100";
}

function stageHeaderClass(stage: "Unpaid" | "Partially Paid" | "Paid") {
  if (stage === "Paid") return "from-emerald-50 to-white text-emerald-700";
  if (stage === "Partially Paid") return "from-blue-50 to-white text-blue-700";
  return "from-orange-50 to-white text-orange-700";
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>(initialInvoices);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [invoiceFilter, setInvoiceFilter] = useState<(typeof filterOptions)[number]>("All");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [integrationNotice, setIntegrationNotice] = useState("");
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

  const selectedInvoice = invoices.find((invoice) => invoice.id === selectedInvoiceId) || null;
  const boardTotals = useMemo(() => {
    const total = invoices.reduce((sum, invoice) => sum + calculateTotals(invoice).finalTotal, 0);
    const paid = invoices.reduce((sum, invoice) => sum + getPaidAmount(invoice), 0);
    const balance = Math.max(total - paid, 0);
    const overdue = invoices.filter((invoice) => getComputedStatus(invoice) === "Overdue").length;
    const pending = invoices.filter((invoice) => ["Pending", "Due Soon", "Overdue"].includes(getComputedStatus(invoice))).length;
    const partial = invoices.filter((invoice) => getComputedStatus(invoice) === "Partially Paid").length;
    const collectionRate = total > 0 ? Math.round((paid / total) * 100) : 0;
    return { total, paid, balance, overdue, pending, partial, collectionRate };
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
    setShowCreateModal(false);
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

    try {
      const shareResponse = await fetch("/api/invoices/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedInvoice),
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
          invoiceLink,
          balance: currency(balance),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Unable to send invoice email");
      }

      updateInvoice({ ...selectedInvoice, status: "Sent" }, `Invoice sent with online payment link using ${sendForm.template} template`);
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
      <div className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-sm shadow-slate-200">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-orange-600">CRM Module</p>
          <h1 className="mt-2 text-3xl font-black text-[#07183f]">Invoice Board</h1>
          <p className="mt-2 text-slate-600">Track invoice status, balances, payments, PDF invoices, and roofing job billing.</p>
        </div>
        <button onClick={() => setShowCreateModal(true)} className="w-fit rounded-2xl bg-orange-500 px-4 py-3 font-bold text-white shadow-lg shadow-orange-200">+ New invoice</button>
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-xs font-black uppercase tracking-wider text-slate-500">Outstanding balance</p>
            <p className="mt-2 text-2xl font-black text-[#07183f]">{currency(boardTotals.balance)}</p>
          </div>
          <div className="rounded-2xl bg-emerald-50 p-4">
            <p className="text-xs font-black uppercase tracking-wider text-emerald-700">Paid this month</p>
            <p className="mt-2 text-2xl font-black text-emerald-800">{currency(boardTotals.paid)}</p>
          </div>
          <div className="rounded-2xl bg-orange-50 p-4">
            <p className="text-xs font-black uppercase tracking-wider text-orange-700">Pending payments</p>
            <p className="mt-2 text-2xl font-black text-orange-800">{boardTotals.pending}</p>
          </div>
          <div className="rounded-2xl bg-red-50 p-4">
            <p className="text-xs font-black uppercase tracking-wider text-red-700">Overdue invoices</p>
            <p className="mt-2 text-2xl font-black text-red-800">{boardTotals.overdue}</p>
          </div>
          <div className="rounded-2xl bg-blue-50 p-4">
            <p className="text-xs font-black uppercase tracking-wider text-blue-700">Partial payments</p>
            <p className="mt-2 text-2xl font-black text-blue-800">{boardTotals.partial}</p>
          </div>
          <div className="rounded-2xl bg-violet-50 p-4">
            <p className="text-xs font-black uppercase tracking-wider text-violet-700">Collection rate</p>
            <p className="mt-2 text-2xl font-black text-violet-800">{boardTotals.collectionRate}%</p>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-3 lg:flex-row">
          <input value={invoiceSearch} onChange={(event) => setInvoiceSearch(event.target.value)} className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-blue-300" placeholder="Search by client name, invoice number, property address..." />
          <div className="flex flex-wrap gap-2">
            {filterOptions.map((option) => (
              <button key={option} type="button" onClick={() => setInvoiceFilter(option)} className={`rounded-2xl px-4 py-3 text-sm font-black ${invoiceFilter === option ? "bg-[#07183f] text-white" : "bg-slate-50 text-slate-600"}`}>{option}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {(Object.keys(boardGroups) as Array<keyof typeof boardGroups>).map((stage) => {
          const invoicesInStage = boardGroups[stage];
          const stageTotal = invoicesInStage.reduce((total, invoice) => total + calculateTotals(invoice).finalTotal, 0);
          return (
            <section key={stage} className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/90 shadow-sm shadow-slate-200">
              <div className={`bg-gradient-to-br ${stageHeaderClass(stage)} flex items-center justify-between border-b border-slate-100 p-5`}>
                <div>
                  <h2 className="text-lg font-black text-[#07183f]">{stage}</h2>
                  <p className="text-sm font-semibold text-slate-500">{invoicesInStage.length} invoices</p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-black shadow-sm">{currency(stageTotal)}</span>
              </div>
              <div className="space-y-3 p-5">
                {invoicesInStage.map((invoice) => {
                  const totals = calculateTotals(invoice);
                  const paid = getPaidAmount(invoice);
                  const balance = Math.max(totals.finalTotal - getPaidAmount(invoice), 0);
                  const status = getComputedStatus(invoice);
                  return (
                    <button key={invoice.id} onClick={() => openInvoice(invoice)} className="group w-full rounded-2xl border border-slate-100 bg-slate-50 p-4 text-left transition hover:-translate-y-0.5 hover:border-orange-100 hover:bg-white hover:shadow-lg">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-black text-slate-900">{invoice.clientName}</p>
                          <p className="mt-1 text-sm text-slate-500">{invoice.invoiceNumber} · {invoice.jobName}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-black ring-1 ${statusBadgeClass(status)}`}>{status}</span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                        <div className="rounded-xl bg-white p-3">
                          <p className="text-xs font-bold uppercase text-slate-400">Total</p>
                          <p className="font-black text-[#07183f]">{currency(totals.finalTotal)}</p>
                        </div>
                        <div className="rounded-xl bg-white p-3">
                          <p className="text-xs font-bold uppercase text-slate-400">Balance</p>
                          <p className="font-black text-orange-700">{currency(balance)}</p>
                        </div>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                        <div className="h-full rounded-full bg-gradient-to-r from-orange-400 to-emerald-500" style={{ width: `${Math.min((paid / Math.max(totals.finalTotal, 1)) * 100, 100)}%` }} />
                      </div>
                      <p className="mt-3 text-xs font-bold text-slate-500">Due {invoice.dueDate} · Click to open details</p>
                    </button>
                  );
                })}
                {invoicesInStage.length === 0 && <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm font-bold text-slate-500">No invoices in this column.</div>}
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
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <section className="rounded-3xl bg-slate-50 p-5">
                <h3 className="font-black text-[#07183f]">Payments</h3>
                <div className="mt-3 space-y-2">
                  {selectedInvoice.payments.map((payment, index) => <p key={index} className="rounded-2xl bg-white p-3 text-sm font-semibold text-slate-600">{currency(payment.amount)} · {payment.method} · {payment.date}{payment.offline ? " · Payment Received Offline" : ""}</p>)}
                  {selectedInvoice.payments.length === 0 && <p className="text-sm font-semibold text-slate-500">No payments recorded yet.</p>}
                </div>
              </section>
              <section className="rounded-3xl bg-slate-50 p-5">
                <h3 className="font-black text-[#07183f]">Activity Log</h3>
                <div className="mt-3 space-y-2">
                  {selectedInvoice.activity.map((item, index) => <p key={index} className="rounded-2xl bg-white p-3 text-sm font-semibold text-slate-600">{item}</p>)}
                </div>
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
