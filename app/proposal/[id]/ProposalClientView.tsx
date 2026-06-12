"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

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
  signatureData?: string;
  acceptedPackage?: "good" | "better" | "best";
  acceptedPackageName?: string;
  acceptedPrice?: number;
  acceptedAt?: string;
  proposalVersion?: number;
  locked?: boolean;
  packages?: {
    good?: string | { scope?: string; price?: number };
    better?: string | { scope?: string; price?: number };
    best?: string | { scope?: string; price?: number };
  };
  brochures?: { name: string; dataUrl: string; type: string }[];
};

type PackageOption = {
  scope?: string;
  price?: number;
};

function currency(value?: number) {
  return Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function normalizePackage(value?: string | PackageOption): Required<PackageOption> {
  if (!value) return { scope: "Package details pending.", price: 0 };
  if (typeof value === "string") return { scope: value, price: 0 };
  return { scope: value.scope || "Package details pending.", price: Number(value.price || 0) };
}

// Turn a package scope blob into comparable bullet features. Splits on line
// breaks / common separators first, then falls back to sentences so a single
// paragraph still renders as scannable points.
function toFeatures(scope?: string): string[] {
  if (!scope) return [];
  let parts = scope
    .split(/\r?\n|✓|•|·|;/)
    .map((part) => part.replace(/^[-*✓\s]+/, "").trim())
    .filter(Boolean);
  if (parts.length <= 1) {
    parts = scope
      .split(/\.\s+/)
      .map((part) => part.trim().replace(/\.$/, ""))
      .filter(Boolean);
  }
  return parts;
}

const packageMeta: Record<"good" | "better" | "best", { label: string; tagline: string }> = {
  good: { label: "Good", tagline: "Essential coverage" },
  better: { label: "Better", tagline: "Enhanced protection" },
  best: { label: "Best", tagline: "Premium, fully loaded" },
};

async function updateSharedProposal(id: string, updates: Record<string, unknown>) {
  await fetch(`/api/proposals/share?id=${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  }).catch(() => null);
}

export default function ProposalClientView({ proposal: initialProposal }: { proposal: PublicProposal }) {
  const [proposal, setProposal] = useState(initialProposal);
  const [selectedOption, setSelectedOption] = useState<"good" | "better" | "best">(initialProposal.selectedOption || "best");
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState(initialProposal.signatureDataUrl || "");
  const [isSigning, setIsSigning] = useState(false);
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [notice, setNotice] = useState("");
  const [termsOpen, setTermsOpen] = useState(false);
  const [expandedScopes, setExpandedScopes] = useState<Record<string, boolean>>({});
  const isAccepted = proposal.status === "Won";

  const packages = useMemo(() => ({
    good: normalizePackage(proposal.packages?.good),
    better: normalizePackage(proposal.packages?.better),
    best: normalizePackage(proposal.packages?.best),
  }), [proposal.packages]);
  const selectedPackage = packages[selectedOption];

  useEffect(() => {
    if (proposal.status === "Won") return;
    void updateSharedProposal(proposal.id, { status: "Viewed", viewedAt: new Date().toISOString() });
  }, [proposal.id, proposal.status]);

  async function handleSelectOption(option: "good" | "better" | "best") {
    if (isAccepted) return; // a signed proposal is locked; selection can't change
    const packageOption = packages[option];
    setSelectedOption(option);
    setProposal((currentProposal) => ({ ...currentProposal, selectedOption: option, total: packageOption.price }));
    await updateSharedProposal(proposal.id, { selectedOption: option, total: packageOption.price, status: "Viewed" });
  }

  async function handleSignProposal() {
    if (!agreementAccepted || !signatureDataUrl) return;

    const signedAt = new Date().toISOString();
    // Lock the accepted record: package, name, price and signature become the
    // immutable source of truth. These are never recalculated from templates.
    const updates = {
      selectedOption,
      acceptedPackage: selectedOption,
      acceptedPackageName: packageMeta[selectedOption].label,
      acceptedPrice: selectedPackage.price,
      total: selectedPackage.price,
      status: "Won",
      signedAt,
      acceptedAt: signedAt,
      signedBy: proposal.customerName || "Customer",
      signatureDataUrl,
      signatureData: signatureDataUrl,
      proposalVersion: proposal.proposalVersion ?? 1,
      locked: true,
    };

    setProposal((currentProposal) => ({ ...currentProposal, ...updates }));
    setNotice("Thank you! Your proposal has been accepted and signed.");
    await updateSharedProposal(proposal.id, updates);
  }

  return (
    <main className="min-h-screen bg-slate-100 px-3 py-5 text-slate-950 sm:px-4 sm:py-8">
      <section className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* Compact header: small logo + title on one row, meta badges aligned right */}
        <header className="flex flex-col gap-3 border-b border-slate-200 bg-gradient-to-r from-[#07183f] to-[#13316b] p-4 text-white sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1.5 shadow-sm">
              <Image src="/images/logo.jpeg" alt="XRP Roofing logo" width={44} height={44} className="h-full w-auto object-contain" priority />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-200">XRP Roofing</p>
              <h1 className="text-lg font-black tracking-tight sm:text-xl">Roofing Proposal</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
            <span className="rounded-full bg-white/10 px-2.5 py-1">ID {proposal.id}</span>
            <span className="rounded-full bg-white/10 px-2.5 py-1">Issued {new Date().toLocaleDateString()}</span>
            <span className="rounded-full bg-blue-500 px-2.5 py-1 text-white">{proposal.status || "Sent"}</span>
          </div>
        </header>

        {/* Prepared for / Prepared by — tight two-column strip */}
        <div className="grid gap-4 border-b border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 sm:p-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Prepared for</p>
            <p className="mt-1 text-lg font-black tracking-tight">{proposal.customerName || "Customer"}</p>
            <p className="mt-0.5 text-sm text-slate-600">{proposal.address || proposal.id}</p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
              {proposal.customerPhone && <span className="font-semibold text-slate-700">{proposal.customerPhone}</span>}
              {proposal.customerEmail && <span className="font-semibold text-blue-700">{proposal.customerEmail}</span>}
            </div>
          </div>
          <div className="sm:text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Prepared by</p>
            <p className="mt-1 text-lg font-black tracking-tight">XRP Roofing</p>
            <p className="mt-0.5 text-sm font-semibold text-slate-700">Jonathan Gonzalez</p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm sm:justify-end">
              <span className="text-slate-600">(623) 300-8097</span>
              <span className="text-blue-700">info@xrproofing.com</span>
            </div>
          </div>
        </div>

        <div className="space-y-6 p-4 sm:p-6">
          {/* Summary + scope combined into one tidy card */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <h2 className="text-base font-black text-[#07183f]">Project Summary</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">{proposal.summary || proposal.coverText || "Your customized XRP Roofing proposal is ready for review."}</p>
            <h3 className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Scope of Work</h3>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">{proposal.scope || "Scope details are included in the proposal prepared by XRP Roofing."}</p>
          </section>

          <section>
            <div className="flex items-end justify-between gap-2">
              <div>
                <p className="text-base font-black text-[#07183f]">Choose your package</p>
                <p className="text-sm text-slate-500">Pick the option that best fits your home.</p>
              </div>
            </div>
            <div className="mt-4 grid items-stretch gap-4 lg:grid-cols-3">
              {(["good", "better", "best"] as const).map((option) => {
                const packageOption = packages[option];
                const selected = selectedOption === option;
                const popular = option === "best";
                const features = toFeatures(packageOption.scope);
                const isExpanded = expandedScopes[option] ?? false;
                return (
                  <article key={option} className={`relative flex flex-col rounded-2xl border-2 bg-white p-5 transition ${selected ? "border-blue-500 shadow-lg shadow-blue-100" : popular ? "border-blue-200" : "border-slate-200"}`}>
                    {popular && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-white shadow">Most Popular</span>
                    )}
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">{packageMeta[option].label}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-500">{packageMeta[option].tagline}</p>
                    <p className="mt-4 text-3xl font-black text-[#07183f]">{currency(packageOption.price)}</p>
                    <div className={`relative mt-4 flex-1 overflow-hidden ${!isExpanded ? "max-h-32" : ""}`}>
                      <ul className="space-y-2">
                        {features.length > 0 ? features.map((feature, index) => (
                          <li key={index} className="flex items-start gap-2 text-sm leading-6 text-slate-700">
                            <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 fill-blue-600" aria-hidden="true"><path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.3 3.3 6.8-6.3a1 1 0 0 1 1.9 0z" /></svg>
                            <span>{feature}</span>
                          </li>
                        )) : (
                          <li className="text-sm leading-6 text-slate-500">Professional roofing option prepared by XRP Roofing.</li>
                        )}
                      </ul>
                      {!isExpanded && features.length > 2 && (
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-white to-transparent" />
                      )}
                    </div>
                    {features.length > 2 && (
                      <button type="button" onClick={() => setExpandedScopes((prev) => ({ ...prev, [option]: !prev[option] }))} className="mt-3 flex items-center gap-1.5 text-sm font-bold text-blue-600 transition hover:text-blue-800">
                        <svg viewBox="0 0 20 20" className={`h-4 w-4 fill-current transition-transform ${isExpanded ? "rotate-180" : ""}`} aria-hidden="true"><path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z" /></svg>
                        {isExpanded ? "Show less" : "See full scope of work"}
                      </button>
                    )}
                    <button type="button" disabled={isAccepted} onClick={() => handleSelectOption(option)} className={`mt-5 w-full rounded-xl px-4 py-3 text-sm font-bold transition ${selected ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-blue-50 hover:text-blue-700"} ${isAccepted && !selected ? "cursor-not-allowed opacity-50" : ""} ${isAccepted ? "cursor-default" : ""}`}>{selected ? (isAccepted ? "✓ Accepted" : "✓ Selected") : "Select this option"}</button>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="flex flex-col justify-between gap-4 rounded-2xl border border-blue-100 bg-blue-50 p-5 md:flex-row md:items-center">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">Your selection</p>
              <p className="mt-1 text-xl font-black uppercase text-[#07183f]">{packageMeta[selectedOption].label} Package</p>
              {proposal.notes && <p className="mt-2 max-w-xl whitespace-pre-line text-sm leading-6 text-slate-600">{proposal.notes}</p>}
            </div>
            <div className="md:text-right">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">Total price</p>
              <p className="mt-1 text-4xl font-black text-blue-700">{currency(selectedPackage.price || proposal.total)}</p>
            </div>
          </section>

          {/* Collapsible terms to keep the page clean */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <button type="button" onClick={() => setTermsOpen((open) => !open)} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
              <span className="text-base font-black text-[#07183f]">Terms &amp; Conditions</span>
              <span className="flex items-center gap-2 text-sm font-bold text-blue-700">
                {termsOpen ? "Hide" : "View"}
                <svg viewBox="0 0 20 20" className={`h-4 w-4 fill-blue-700 transition-transform ${termsOpen ? "rotate-180" : ""}`} aria-hidden="true"><path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z" /></svg>
              </span>
            </button>
            {termsOpen && (
              <div className="max-h-[24rem] overflow-y-auto border-t border-slate-200 px-5 py-4 text-sm leading-6 text-slate-600">
                {(proposal.terms || "Please contact XRP Roofing for complete proposal terms.").split("\n\n").map((section, index) => (
                  <p key={index} className="mb-3 whitespace-pre-line">{section}</p>
                ))}
              </div>
            )}
          </section>

          {proposal.brochures && proposal.brochures.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <p className="text-base font-black text-[#07183f]">Product Brochure</p>
              <div className="mt-4 space-y-4">
                {proposal.brochures.map((file, index) => (
                  <div key={index}>
                    {file.type.startsWith("image/") ? (
                      <img src={file.dataUrl} alt={file.name} className="w-full rounded-xl" />
                    ) : (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-sm font-bold text-slate-700">{file.name}</p>
                        <a href={file.dataUrl} download={file.name} className="mt-2 inline-block text-sm font-black text-blue-600 hover:underline">Download {file.name}</a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {isAccepted ? (
            <section className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-6 text-center shadow-sm sm:p-8">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-2xl text-white">✓</div>
              <p className="mt-4 text-[11px] font-black uppercase tracking-[0.28em] text-emerald-700">Proposal Accepted</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Thank you, {proposal.customerName || "valued customer"}!</h2>
              <p className="mx-auto mt-3 max-w-xl text-sm font-semibold leading-6 text-slate-600">Your proposal has been signed successfully. XRP Roofing has been notified and will contact you shortly to schedule the work.</p>
              <div className="mx-auto mt-5 max-w-md rounded-xl border border-emerald-200 bg-white p-4 text-left">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Signed by</p>
                <div className="mt-1 text-xl font-bold italic text-slate-900">{proposal.signatureDataUrl ? <Image src={proposal.signatureDataUrl} alt="Customer signature" width={420} height={120} unoptimized className="mt-1 max-h-20 w-full object-contain" /> : proposal.signedBy}</div>
                <p className="mt-3 text-[10px] font-black uppercase tracking-wider text-slate-500">Date signed</p>
                <p className="mt-1 font-bold text-slate-700">{proposal.signedAt ? new Date(proposal.signedAt).toLocaleDateString() : new Date().toLocaleDateString()}</p>
              </div>
              {notice && <p className="mx-auto mt-4 max-w-md rounded-xl bg-emerald-100 px-4 py-3 text-sm font-bold text-emerald-800">{notice}</p>}
            </section>
          ) : (
            <section className="rounded-2xl border-2 border-blue-200 bg-white p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 20 20" className="h-5 w-5 fill-blue-600" aria-hidden="true"><path d="M13.6 2.4a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L8.2 16.8l-4.6 1 1-4.6 9-9z" /></svg>
                <h2 className="text-base font-black text-[#07183f]">Accept &amp; sign your proposal</h2>
              </div>
              <label className="mt-4 flex items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={agreementAccepted} onChange={(event) => setAgreementAccepted(event.target.checked)} className="mt-0.5 h-5 w-5 rounded border-slate-300" />
                <span>I have reviewed the proposal and agree to the Terms &amp; Conditions.</span>
              </label>
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Sign below</p>
                  <button type="button" onClick={() => { const canvas = signatureCanvasRef.current; const context = canvas?.getContext("2d"); if (!canvas || !context) return; context.clearRect(0, 0, canvas.width, canvas.height); setSignatureDataUrl(""); }} className="rounded-lg px-2 py-1 text-xs font-bold text-blue-700 hover:bg-blue-50">Clear</button>
                </div>
                <canvas ref={signatureCanvasRef} width={720} height={220} onPointerDown={(event) => { const canvas = signatureCanvasRef.current; if (!canvas) return; const rect = canvas.getBoundingClientRect(); const context = canvas.getContext("2d"); if (!context) return; context.lineWidth = 3; context.lineCap = "round"; context.strokeStyle = "#0f172a"; context.beginPath(); context.moveTo(event.clientX - rect.left, event.clientY - rect.top); setIsSigning(true); }} onPointerMove={(event) => { if (!isSigning) return; const canvas = signatureCanvasRef.current; if (!canvas) return; const rect = canvas.getBoundingClientRect(); const context = canvas.getContext("2d"); if (!context) return; context.lineTo(event.clientX - rect.left, event.clientY - rect.top); context.stroke(); }} onPointerUp={() => { const canvas = signatureCanvasRef.current; if (!canvas) return; setIsSigning(false); setSignatureDataUrl(canvas.toDataURL("image/png")); }} onPointerLeave={() => setIsSigning(false)} className="mt-2 h-40 w-full touch-none rounded-xl border-2 border-dashed border-slate-300 bg-slate-50" />
                <p className="mt-1 text-xs text-slate-400">Draw your signature with your finger or mouse.</p>
              </div>
              <button type="button" disabled={!agreementAccepted || !signatureDataUrl} onClick={handleSignProposal} className="mt-5 w-full rounded-xl bg-blue-600 px-5 py-4 text-base font-black text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none">Accept &amp; Sign Proposal</button>
              {!agreementAccepted || !signatureDataUrl ? <p className="mt-2 text-center text-xs font-semibold text-slate-400">Check the box and add your signature to enable signing.</p> : null}
              {notice && <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{notice}</p>}
            </section>
          )}
        </div>
      </section>
    </main>
  );
}

