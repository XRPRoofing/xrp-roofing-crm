import { headers } from "next/headers";
import ProposalClientView from "./ProposalClientView";

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
  notes?: string;
  terms?: string;
  selectedOption?: "good" | "better" | "best";
  signedAt?: string;
  signedBy?: string;
  packages?: {
    good?: string | { scope?: string; price?: number };
    better?: string | { scope?: string; price?: number };
    best?: string | { scope?: string; price?: number };
  };
};

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

  return <ProposalClientView proposal={proposal} />;
}
