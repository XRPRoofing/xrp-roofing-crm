import { headers } from "next/headers";

type PublicProposal = {
  id: string;
  customerName?: string;
  address?: string;
  title?: string;
  summary?: string;
  scope?: string;
  total?: number;
  status?: string;
  coverPhoto?: string;
  coverText?: string;
  terms?: string;
  packages?: {
    good?: string | { scope?: string; price?: number };
    better?: string | { scope?: string; price?: number };
    best?: string | { scope?: string; price?: number };
  };
};

function currency(value?: number) {
  return Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function packageText(value?: string | { scope?: string; price?: number }) {
  if (!value) return "Not included";
  if (typeof value === "string") return value;
  return `${value.scope || "Roofing package"}${value.price ? ` • ${currency(value.price)}` : ""}`;
}

async function getProposal(id: string) {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") || headerStore.get("host");
  const protocol = headerStore.get("x-forwarded-proto") || "https";

  if (!host) return null;

  const response = await fetch(`${protocol}://${host}/api/proposals/share?id=${encodeURIComponent(id)}`, { cache: "no-store" }).catch(() => null);

  if (!response?.ok) return null;

  const data = await response.json().catch(() => null) as { proposal?: PublicProposal } | null;
  return data?.proposal || null;
}

export default async function PublicProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const proposal = await getProposal(id);

  if (!proposal) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-12 text-slate-950">
        <section className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-blue-600">XRP Roofing Proposal</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">Proposal link unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">This proposal has not been published yet or proposal sharing storage is not configured. Please contact XRP Roofing for a fresh proposal link.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950">
      <section className="mx-auto max-w-5xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-white p-6 sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-blue-600">XRP Roofing Proposal</p>
          <div className="mt-4 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{proposal.title || "Roofing Proposal"}</h1>
              <p className="mt-2 text-sm font-semibold text-slate-500">{proposal.customerName || "Customer"} • {proposal.address || proposal.id}</p>
            </div>
            <div className="rounded-2xl bg-blue-50 px-5 py-4 text-right">
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Proposal Total</p>
              <p className="mt-1 text-3xl font-bold text-blue-700">{currency(proposal.total)}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <h2 className="text-lg font-bold">Project Summary</h2>
              <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600">{proposal.summary || proposal.coverText || "Your customized XRP Roofing proposal is ready for review."}</p>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-bold">Scope of Work</h2>
              <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600">{proposal.scope || "Scope details are included in the proposal prepared by XRP Roofing."}</p>
            </section>
          </div>

          <aside className="space-y-4">
            {["best", "better", "good"].map((key) => (
              <div key={key} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">{key}</p>
                <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-700">{packageText(proposal.packages?.[key as keyof NonNullable<PublicProposal["packages"]>])}</p>
              </div>
            ))}
          </aside>
        </div>

        <div className="border-t border-slate-200 bg-slate-50 p-6 sm:p-8">
          <h2 className="text-lg font-bold">Terms and Conditions</h2>
          <p className="mt-3 whitespace-pre-line text-xs leading-6 text-slate-600">{proposal.terms || "Please contact XRP Roofing for complete proposal terms."}</p>
        </div>
      </section>
    </main>
  );
}
