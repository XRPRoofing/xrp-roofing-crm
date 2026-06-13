import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import ProposalClientView from "./ProposalClientView";

export const dynamic = "force-dynamic";

type PublicProposal = {
  id: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
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
  signatureDataUrl?: string;
  showPackages?: boolean;
  packages?: {
    good?: string | { scope?: string; price?: number };
    better?: string | { scope?: string; price?: number };
    best?: string | { scope?: string; price?: number };
  };
  brochures?: { name: string; dataUrl: string; type: string }[];
};

async function getProposal(id: string) {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from("proposal_shares")
    .select("payload")
    .eq("id", id)
    .single();

  if (error || !data?.payload) return null;
  return data.payload as PublicProposal;
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

