import Link from "next/link";

export default function InvoiceThankYouPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12 text-slate-950">
      <section className="mx-auto w-full max-w-xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
        <div className="bg-[#07183f] p-8 text-center text-white">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-300">XRP Roofing</p>
          <div className="mx-auto mt-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 ring-1 ring-emerald-300/40">
            <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-emerald-300" aria-hidden="true">
              <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="mt-5 text-3xl font-black tracking-tight">Thank you for your payment.</h1>
          <p className="mt-2 text-lg font-semibold text-blue-100">Thank you for choosing XRP Roofing.</p>
        </div>
        <div className="space-y-4 p-8 text-center">
          <p className="text-sm leading-6 text-slate-600">
            Your payment was received and your invoice has been marked as paid. A receipt will follow by email. If you
            have any questions about your roofing project, our office is happy to help.
          </p>
          <p className="text-sm font-semibold text-slate-500">XRP Roofing · ROC #350898</p>
          <Link
            href="https://xrproofing.com"
            className="inline-flex w-fit items-center justify-center rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-blue-700"
          >
            Return to XRP Roofing
          </Link>
        </div>
      </section>
    </main>
  );
}
