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
  packages?: {
    good?: string | { scope?: string; price?: number };
    better?: string | { scope?: string; price?: number };
    best?: string | { scope?: string; price?: number };
  };
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
    const packageOption = packages[option];
    setSelectedOption(option);
    setProposal((currentProposal) => ({ ...currentProposal, selectedOption: option, total: packageOption.price }));
    await updateSharedProposal(proposal.id, { selectedOption: option, total: packageOption.price, status: "Viewed" });
  }

  async function handleSignProposal() {
    if (!agreementAccepted || !signatureDataUrl) return;

    const signedAt = new Date().toISOString();
    const updates = {
      selectedOption,
      total: selectedPackage.price,
      status: "Won",
      signedAt,
      signedBy: proposal.customerName || "Customer",
      signatureDataUrl,
    };

    setProposal((currentProposal) => ({ ...currentProposal, ...updates }));
    setNotice("Thank you! Your proposal has been accepted and signed.");
    await updateSharedProposal(proposal.id, updates);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950">
      <section className="mx-auto max-w-6xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-6 border-b border-slate-200 bg-white p-6 sm:p-8 md:grid-cols-2">
          <div>
            <div className="mb-6 flex h-20 w-40 items-center justify-center rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <Image src="/images/logo.jpeg" alt="XRP Roofing logo" width={140} height={64} className="max-h-14 w-auto object-contain" priority />
            </div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">Client Info</p>
            <p className="mt-3 text-2xl font-bold tracking-tight">{proposal.customerName || "Customer"}</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">{proposal.address || proposal.id}</p>
            {proposal.customerPhone && <p className="mt-2 text-sm font-bold text-slate-700">{proposal.customerPhone}</p>}
            {proposal.customerEmail && <p className="mt-1 text-sm font-bold text-blue-700">{proposal.customerEmail}</p>}
          </div>
          <div className="border-t border-slate-200 pt-6 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">Prepared By</p>
            <p className="mt-3 text-2xl font-bold tracking-tight">XRP Roofing</p>
            <p className="mt-2 text-sm font-semibold text-slate-700">Jonathan Gonzalez</p>
            <p className="mt-2 text-sm text-slate-600">(623) 300-8097</p>
            <p className="mt-1 text-sm text-blue-700">info@xrproofing.com</p>
            <p className="mt-1 text-sm text-slate-600">xrproofing.com</p>
          </div>
        </div>

        <div className="border-b border-slate-200 p-6 text-center sm:p-8">
          <div className="mx-auto mb-5 flex h-24 w-52 items-center justify-center rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <Image src="/images/logo.jpeg" alt="XRP Roofing logo" width={180} height={80} className="max-h-16 w-auto object-contain" priority />
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-blue-600">XRP Roofing Proposal</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight">ROOFING PROPOSAL</h1>
          <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs font-bold uppercase tracking-wide">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">ID {proposal.id}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">Issued {new Date().toLocaleDateString()}</span>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">{proposal.status || "Sent"}</span>
          </div>
        </div>

        <div className="space-y-8 p-6 sm:p-8">
          <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <h2 className="text-lg font-bold">Project Summary</h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600">{proposal.summary || proposal.coverText || "Your customized XRP Roofing proposal is ready for review."}</p>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-bold">Scope of Work</h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600">{proposal.scope || "Scope details are included in the proposal prepared by XRP Roofing."}</p>
          </section>

          <section>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">Package Options</p>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              {(["good", "better", "best"] as const).map((option) => {
                const packageOption = packages[option];
                const selected = selectedOption === option;
                return (
                  <article key={option} className={`rounded-3xl border p-5 ${selected ? "border-blue-500 bg-blue-50 shadow-lg shadow-blue-100" : "border-slate-200 bg-white"}`}>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">{option}</p>
                    <h3 className="mt-2 text-xl font-bold uppercase">{option} Package</h3>
                    <p className="mt-2 text-sm font-semibold text-slate-500">Professional roofing option prepared by XRP Roofing.</p>
                    <p className="mt-5 whitespace-pre-line text-sm leading-6 text-slate-700">{packageOption.scope}</p>
                    <p className="mt-5 text-3xl font-bold text-blue-700">{currency(packageOption.price)}</p>
                    <button type="button" onClick={() => handleSelectOption(option)} className={`mt-4 w-full rounded-2xl px-4 py-3 text-sm font-bold ${selected ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-blue-50 hover:text-blue-700"}`}>{selected ? "Selected Option" : "Select This Option"}</button>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="rounded-3xl border border-blue-100 bg-blue-50 p-6">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-blue-700">Total Summary</p>
            <div className="mt-4 flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div>
                <p className="text-sm font-semibold text-slate-600">Selected Package</p>
                <p className="mt-1 text-2xl font-bold uppercase">{selectedOption}</p>
                {proposal.notes && <p className="mt-3 max-w-xl whitespace-pre-line text-sm leading-6 text-slate-600">{proposal.notes}</p>}
              </div>
              <div className="text-left md:text-right">
                <p className="text-sm font-semibold text-slate-600">Total Price</p>
                <p className="mt-1 text-4xl font-bold text-blue-700">{currency(selectedPackage.price || proposal.total)}</p>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-2xl font-bold">Terms and Conditions</h2>
            <div className="mt-5 max-h-[28rem] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-7 text-slate-700">
              {(proposal.terms || "Please contact XRP Roofing for complete proposal terms.").split("\n\n").map((section, index) => (
                <p key={index} className="mb-4 whitespace-pre-line">{section}</p>
              ))}
            </div>
          </section>

          {isAccepted ? (
            <section className="rounded-[2rem] border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-8 text-center shadow-sm">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-600 text-3xl text-white">✓</div>
              <p className="mt-5 text-xs font-black uppercase tracking-[0.28em] text-emerald-700">Proposal Accepted</p>
              <h2 className="mt-3 text-4xl font-black tracking-tight text-slate-950">Thank you, {proposal.customerName || "valued customer"}!</h2>
              <p className="mx-auto mt-4 max-w-2xl text-lg font-semibold leading-8 text-slate-700">Your proposal has been signed successfully. XRP Roofing has been notified, and our team will contact you shortly to proceed with scheduling the work.</p>
              <div className="mx-auto mt-6 max-w-xl rounded-2xl border border-emerald-200 bg-white p-5 text-left">
                <p className="text-xs font-black uppercase tracking-wider text-slate-500">Signed By</p>
                <p className="mt-2 text-2xl font-bold italic text-slate-900">{proposal.signatureDataUrl ? <Image src={proposal.signatureDataUrl} alt="Customer signature" width={420} height={120} unoptimized className="mt-2 max-h-24 w-full object-contain" /> : proposal.signedBy}</p>
                <p className="mt-4 text-xs font-black uppercase tracking-wider text-slate-500">Date Signed</p>
                <p className="mt-2 font-bold text-slate-700">{proposal.signedAt ? new Date(proposal.signedAt).toLocaleDateString() : new Date().toLocaleDateString()}</p>
              </div>
              {notice && <p className="mt-5 rounded-2xl bg-emerald-100 px-4 py-3 text-sm font-bold text-emerald-800">{notice}</p>}
            </section>
          ) : (
            <section className="rounded-3xl border border-slate-200 p-6">
              <label className="flex items-start gap-3 text-sm font-bold text-slate-700">
                <input type="checkbox" checked={agreementAccepted} onChange={(event) => setAgreementAccepted(event.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-300" />
                <span>I agree to the Terms and Conditions</span>
              </label>
              <div className="mt-6 grid gap-4 md:grid-cols-[1fr_180px]">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Client Signature
                  <canvas ref={signatureCanvasRef} width={720} height={220} onPointerDown={(event) => { const canvas = signatureCanvasRef.current; if (!canvas) return; const rect = canvas.getBoundingClientRect(); const context = canvas.getContext("2d"); if (!context) return; context.lineWidth = 3; context.lineCap = "round"; context.strokeStyle = "#0f172a"; context.beginPath(); context.moveTo(event.clientX - rect.left, event.clientY - rect.top); setIsSigning(true); }} onPointerMove={(event) => { if (!isSigning) return; const canvas = signatureCanvasRef.current; if (!canvas) return; const rect = canvas.getBoundingClientRect(); const context = canvas.getContext("2d"); if (!context) return; context.lineTo(event.clientX - rect.left, event.clientY - rect.top); context.stroke(); }} onPointerUp={() => { const canvas = signatureCanvasRef.current; if (!canvas) return; setIsSigning(false); setSignatureDataUrl(canvas.toDataURL("image/png")); }} onPointerLeave={() => setIsSigning(false)} className="mt-2 h-44 w-full touch-none rounded-2xl border border-slate-200 bg-white" />
                  <button type="button" onClick={() => { const canvas = signatureCanvasRef.current; const context = canvas?.getContext("2d"); if (!canvas || !context) return; context.clearRect(0, 0, canvas.width, canvas.height); setSignatureDataUrl(""); }} className="mt-2 rounded-xl bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600">Clear Signature</button>
                </label>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Date Signed</p>
                  <p className="mt-3 font-bold">{proposal.signedAt ? new Date(proposal.signedAt).toLocaleDateString() : new Date().toLocaleDateString()}</p>
                </div>
              </div>
              <button type="button" disabled={!agreementAccepted || !signatureDataUrl} onClick={handleSignProposal} className="mt-5 w-full rounded-2xl bg-blue-600 px-5 py-4 text-sm font-bold text-white shadow-lg shadow-blue-100 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none">Accept & Sign Proposal</button>
              {notice && <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{notice}</p>}
            </section>
          )}
        </div>
      </section>
    </main>
  );
}

