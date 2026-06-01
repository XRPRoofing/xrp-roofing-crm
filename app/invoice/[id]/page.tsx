import { headers } from "next/headers";
import Link from "next/link";

type Invoice = {
  id: string;
  invoiceNumber?: string;
  clientName?: string;
  email?: string;
  phone?: string;
  jobName?: string;
  propertyAddress?: string;
  issueDate?: string;
  dueDate?: string;
  roofType?: string;
  proposalReference?: string;
  paymentTerms?: string;
  warrantyNotes?: string;
  discount?: number;
  lineItems?: { description: string; quantity: number; unitPrice: number; tax: number }[];
  payments?: { amount: number }[];
};

function currency(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function calculateTotals(invoice: Invoice) {
  const lineItems = invoice.lineItems || [];
  const subtotal = lineItems.reduce((total, item) => total + item.quantity * item.unitPrice, 0);
  const tax = lineItems.reduce((total, item) => total + item.quantity * item.unitPrice * (item.tax / 100), 0);
  const paid = (invoice.payments || []).reduce((total, payment) => total + payment.amount, 0);
  const finalTotal = Math.max(subtotal + tax - (invoice.discount || 0), 0);
  const balance = Math.max(finalTotal - paid, 0);
  return { subtotal, tax, finalTotal, paid, balance };
}

async function getInvoice(id: string) {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") || headerStore.get("host");
  const protocol = headerStore.get("x-forwarded-proto") || "https";

  if (!host) return null;

  const response = await fetch(`${protocol}://${host}/api/invoices/share?id=${encodeURIComponent(id)}`, { cache: "no-store" }).catch(() => null);
  if (!response?.ok) return null;

  const data = await response.json().catch(() => null) as { invoice?: Invoice } | null;
  return data?.invoice || null;
}

export default async function PublicInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await getInvoice(id);

  if (!invoice) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-12 text-slate-950">
        <section className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-blue-600">XRP Roofing Invoice</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">Invoice link unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">This invoice has not been published yet or invoice sharing storage is not configured. Please contact XRP Roofing for a fresh invoice link.</p>
        </section>
      </main>
    );
  }

  const totals = calculateTotals(invoice);
  const paymentMethods = [
    { label: "Pay by Card", method: "card" },
    { label: "Pay by ACH Bank Transfer", method: "ach" },
  ];

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950">
      <section className="mx-auto max-w-5xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
        <div className="bg-[#07183f] p-8 text-white">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-300">XRP Roofing Invoice</p>
          <div className="mt-4 flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <h1 className="text-4xl font-black tracking-tight">{invoice.invoiceNumber || invoice.id}</h1>
              <p className="mt-2 text-blue-100">{invoice.clientName}</p>
              <p className="text-blue-100">{invoice.propertyAddress}</p>
            </div>
            <div className="rounded-2xl bg-white/10 p-4 text-left md:text-right">
              <p className="text-xs font-black uppercase tracking-wider text-blue-100">Balance Due</p>
              <p className="mt-1 text-3xl font-black text-orange-300">{currency(totals.balance)}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-6 p-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 p-5">
              <h2 className="text-xl font-black text-[#07183f]">Scope of Work</h2>
              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                {(invoice.lineItems || []).map((item, index) => (
                  <div key={index} className="grid gap-3 border-b border-slate-100 p-4 last:border-b-0 md:grid-cols-[1fr_120px]">
                    <div>
                      <p className="font-black text-slate-900">{item.description}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-500">Qty {item.quantity} · Tax {item.tax}%</p>
                    </div>
                    <p className="font-black text-blue-700 md:text-right">{currency(item.quantity * item.unitPrice * (1 + item.tax / 100))}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 p-5">
              <h2 className="text-xl font-black text-[#07183f]">Project Details</h2>
              <div className="mt-4 grid gap-3 text-sm font-semibold text-slate-600 md:grid-cols-2">
                <p><span className="font-black text-slate-900">Job:</span> {invoice.jobName}</p>
                <p><span className="font-black text-slate-900">Roof Type:</span> {invoice.roofType}</p>
                <p><span className="font-black text-slate-900">Proposal:</span> {invoice.proposalReference || "N/A"}</p>
                <p><span className="font-black text-slate-900">Due Date:</span> {invoice.dueDate}</p>
              </div>
            </section>
          </div>

          <aside className="space-y-4">
            <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <h2 className="text-lg font-black text-[#07183f]">Payment Summary</h2>
              <div className="mt-4 space-y-2 text-sm font-bold text-slate-700">
                <div className="flex justify-between"><span>Subtotal</span><span>{currency(totals.subtotal)}</span></div>
                <div className="flex justify-between"><span>Tax</span><span>{currency(totals.tax)}</span></div>
                <div className="flex justify-between"><span>Discount</span><span>{currency(invoice.discount || 0)}</span></div>
                <div className="flex justify-between"><span>Paid</span><span>{currency(totals.paid)}</span></div>
                <div className="border-t border-slate-200 pt-3 text-lg font-black text-[#07183f]"><div className="flex justify-between"><span>Total Due</span><span>{currency(totals.balance)}</span></div></div>
              </div>
            </section>

            <section className="rounded-3xl border border-blue-100 bg-blue-50 p-5">
              <h2 className="text-lg font-black text-[#07183f]">Choose Payment Method</h2>
              <div className="mt-4 space-y-3">
                {paymentMethods.map((payment) => (
                  <Link key={payment.method} href={`/api/stripe/checkout?invoiceId=${encodeURIComponent(invoice.id)}&method=${payment.method}`} className="block rounded-2xl bg-blue-600 px-4 py-3 text-center text-sm font-black text-white shadow-sm">
                    {payment.label}
                  </Link>
                ))}
              </div>
              <p className="mt-3 text-xs font-semibold leading-5 text-blue-800">Online payment supports card and ACH when Stripe is configured. You may also contact XRP Roofing for offline payment options.</p>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
