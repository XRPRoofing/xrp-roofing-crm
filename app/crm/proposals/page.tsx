"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import BackToJobsLink from "@/components/crm/BackToJobsLink";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { loadCrewDataset, subscribeToCrewData } from "@/lib/crew-sync";
import { deleteProposalRecord, loadProposalRecords, proposalSyncEnabled, subscribeToProposalRecords, upsertProposalRecord } from "@/lib/proposal-sync";
import { isProposalLocked } from "@/lib/proposal-lock";
import { findOrCreateCustomer } from "@/lib/customer-sync";
import { payloadToLead, takeEstimateIntent } from "@/lib/crm-board-nav";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import type { Lead } from "@/types/crm";

type Proposal = {
  id: string;
  job?: Lead;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  address: string;
  scope: string;
  total: number;
  status: "Draft" | "Sent" | "Viewed" | "Signed" | "Won" | "Approved" | "Signed Offline";
  template: string;
  title: string;
  summary: string;
  coverPhoto: string;
  coverText: string;
  notes: string;
  terms: string;
  sendSubject?: string;
  sendMessage?: string;
  ccRecipients?: string;
  sentToEmail?: string;
  signedAt?: string;
  signedBy?: string;
  signatureData?: string;
  signatureDataUrl?: string;
  acceptedPackage?: "good" | "better" | "best";
  acceptedPackageName?: string;
  acceptedPrice?: number;
  acceptedAt?: string;
  proposalVersion?: number;
  locked?: boolean;
  deletedAt?: string;
  selectedOption?: "good" | "better" | "best";
  showPackages?: boolean;
  inspectionPhotos?: InspectionPhoto[];
  packages?: {
    good: string | PackageOption;
    better: string | PackageOption;
    best: string | PackageOption;
  };
  offlineSignedAt?: string;
  offlineSignedBy?: string;
  offlineSignatureFile?: string;
  offlineSignatureFileName?: string;
};

type InspectionPhoto = {
  label: string;
  image: string;
  note: string;
};

type PackageOption = {
  scope: string;
  price: number;
};

type ProposalTemplate = {
  id: string;
  label: string;
  description: string;
  title: string;
  summary: string;
  terms: string;
  packages?: Proposal["packages"];
};

const proposalSections = ["Cover", "Inspection Photos", "Estimate", "BEST", "BETTER", "GOOD", "Summary", "Terms and Conditions"];
const trashRetentionDays = 30;
const trashRetentionMs = trashRetentionDays * 24 * 60 * 60 * 1000;
const proposalsLocalKey = "xrp-crm-proposals";
const defaultInspectionPhotos: InspectionPhoto[] = [
  { label: "Front elevation", image: "", note: "" },
  { label: "Roof condition", image: "", note: "" },
  { label: "Detail area", image: "", note: "" },
  { label: "Project notes", image: "", note: "" },
];
const defaultTerms = `AZPRO Contractor LLC DBA XRP Roofing
2843 W McDowell Rd, Phoenix, AZ 85009
Phone: (623) 300-8097 | Email: info@xrproofing.com
ROC # 350898

Arizona Registrar of Contractors Licensed & Insured Contractor

These Terms and Conditions form part of the Agreement between XRP Roofing, (“XRP Roofing,” “we,” “us,” or “our”) and the property owner or authorized representative (“Customer,” “you,” or “your”) for roofing services. By signing the proposal or contract, you acknowledge that you have read, understood, and agree to be bound by these terms.

1. Communication
It is important to maintain open communication with XRP Roofing regarding any issues or disputes about payments to address them promptly and avoid escalation to a lien filing.

Notice of Cancellation Policy
Cancellation Right: The Customer has the right to cancel this transaction at any time prior to midnight of the third business day after the date of the signed contract. This right to cancel is in accordance with federal and state regulations that provide a "cooling-off" period for consumers to reconsider their agreement without penalty.

How to Cancel: To cancel this contract within the specified period, the Customer must provide written notice of cancellation to XRP Roofing. This can be done via email or written letter. The notice must be received by XRP Roofing before the deadline to be effective. The email or letter must contain the customer’s first and last name, property address, and contract dollar amount.

Post-Cancellation Penalty: If the Customer cancels the contract after the third business day, a penalty equal to 25% of the contract price may apply. This penalty covers administrative and operational costs incurred by XRP Roofing during the initial stages of the project preparation.

Acknowledgment
By signing this contract, you, the Customer, acknowledge that you have read and understood all the terms and conditions outlined in this agreement. This includes the cancellation policy, payment terms, liability limitations, and all other provisions specified herein. You are aware of your rights and obligations under this contract and agree to abide by them.

Delivery and Payment
Initial Deposit: A 50% initial deposit is due upon acceptance of the Agreement for cash buyers (or as specified in your proposal).

Final Payment: All remaining balances are due upon XRP Roofing’s final inspection of the work (“substantial completion” – 90% or greater completion).

Material Taxes: Material taxes are included in the price.

Outstanding Balances: The final payment is due within ten (7) days after XRP Roofing issues the final invoice. Any unpaid balance not received within this period shall accrue a late charge of one and one-half percent (1.5%) per month (18% annual rate), or the maximum rate permitted by law, until paid in full.

Collection Costs: Customer agrees to pay collection costs, including attorney’s fees, lien recording fees, and non-taxable court costs if complete payment is not received by the due date.

Authorized Payment Methods: Debit, Credit, Cash, Check, ACH, Financing, Bank Wire.

Damage
Post-Installation Damage: XRP Roofing is not liable for any damage to the Product once installed if such damage is not caused by XRP Roofing.

Prior Damage: XRP Roofing is not liable for any prior damage to the property.

Structural Damage: XRP Roofing is not liable for any structural damage or structural repairs. Standard roofing activities are not expected to cause damage to the structure.

Acceptance of Order
Cashing a down payment check does not constitute acceptance of an order.

Job Site Conditions
Clear Worksite: Customers shall provide a clear worksite.

Driveway Access: Customers shall provide clear access to the driveway for equipment to operate and be stowed during the duration of the project as needed.

Expenses for Delays: All expenses related to delays caused by un-cleared obstructions will be paid/charged to the Customer.

Utilities: Customers shall furnish electricity and water to the worksite at no expense to XRP Roofing.

Hidden Site Conditions: XRP Roofing is not responsible for hidden site conditions not identified by the Customer.

Precautions: The owner should take precautions to keep children, pets, valuables, and cars away from the "hazard zone" of 10 to 20 foot perimeter around the house, and to remove or protect hanging or loose items inside the building.

Unsafe Working Environment / Customer Non-Performance
XRP Roofing reserves the right to cancel or delay work if the jobsite presents unsafe working conditions (including structural hazards, illegal activity, or hazardous materials). Cancellation may also occur if the customer:

Fails to provide access to the property as needed,
Does not respond to critical communications,
Fails to obtain required permits or approvals,
Makes unauthorized changes to the project scope,
Breaches any part of the contract.

Non-Payment: If payment terms are not met, including deposits or progress payments, XRP Roofing reserves the right to stop work and/or cancel the agreement.

Discretionary Termination: XRP Roofing reserves the right to cancel this contract at any time, with or without cause, at its sole discretion.

Refunds and Final Accounting: In the event of cancellation, the customer will be notified promptly and, if applicable, will receive a refund of any unused portion of their deposit, less the cost of any materials ordered or work already performed.

Weather Conditions
Postponements: XRP Roofing reserves the right to postpone or delay the project due to adverse weather conditions, including but not limited to rain, high winds, extreme heat, monsoons, or any other weather-related factors that could impact the safety and quality of the work.

Acknowledgment of Delays: The Customer acknowledges and agrees that such delays are beyond the control of XRP Roofing and that XRP Roofing shall not be held liable for any damages, costs, or inconveniences arising from weather-related postponements.

Scheduling Issues
Unforeseen Circumstances: While XRP Roofing strives to adhere to the agreed-upon schedule, unforeseen circumstances such as material shortages, labor issues, or other project-related complications may result in delays. The Customer acknowledges that such delays are sometimes inevitable and are not the fault of XRP Roofing. XRP Roofing shall not be held liable for any damages, costs, or inconveniences arising from these scheduling issues.

Change Orders
Hidden Conditions: During the roof tear-off process, previously hidden conditions may be discovered that require additional work or materials (e.g., rotted decking, insufficient structural support, damaged insulation, or unforeseen complications with underlying roofing components).

Authorization of Additional Work: If additional issues are discovered, XRP Roofing will provide the Customer with a detailed description of the necessary additional work and an estimate of the associated costs. No additional work will be performed without the Customer’s written approval. If financed, change order documents must be approved before work continues.

Project Halt: If the pending status of a change order prohibits XRP Roofing’s team from continuing work and installing according to code, work may be halted. Delayed work may incur a penalty of $250.

Payment for Change Orders: 100% of the payment for approved change orders is due upon acceptance of the change order.

Right to Cancel by Contractor
XRP Roofing may cancel work if site conditions are discovered that were not reasonably visible or known at the time of the original inspection or contract signing, and which materially affect the cost, safety, or feasibility of the project. XRP Roofing can also cancel if a change order is required to bring the roof up to code and the customer cannot cover the remaining balance (customer will be required to pay for all materials and services rendered up to 100% of the contract price).

Limitations of Liability
Incidental Damages: XRP Roofing shall not be held liable for any incidental, special, or consequential damages, including but not limited to loss of revenue, loss of use of facilities, or other economic loss.

Acts of God: XRP Roofing shall not be liable for any damages resulting from Acts of God, including but not limited to lightning, wind, hurricanes, tornadoes, hail, ice, wind-driven rain, water leaks, or mold growth.

HVAC / Plumbing / Framing / Code Disclaimer: XRP Roofing will not be responsible for assessing the existing condition of air conditioning units, swamp coolers, ductwork, structural framing, poor drainage, chimney caps, or other surfaces that may be affected during normal construction operations. We will not be responsible for any water, electrical, sewer, or other existing items that are currently out of code.

Crane / Thermostat Wires / Other Disclaimers: Specific disclaimers apply for crane use, thermostat wire impacts, bird deterrent devices, gutter removal, painting, satellite/solar panel removal, misting systems, and roof conduit (see Additional Terms below for details).

Limited Warranty / Exclusive Remedy
Workmanship Warranty: XRP Roofing warrants its workmanship for various lengths depending on packages and type of installs. Refer to your specific proposal for warranty information. Written workmanship warranties back every project.

Repair Warranty: Repairs have a 90-day warranty on the specific repair only.

Void Warranties: Warranties are void if amounts owed under this agreement are not paid.

Material Warranty: Material warranty claims must be made by the Customer directly to the manufacturer. XRP Roofing will assist the property owner with this process upon request.

Maintenance Requirement: The workmanship warranty is valid as long as the roof is properly maintained and XRP Roofing is notified within seven days of discovering a leak or roofing problem.

Professional Workmanship & ROC
Good Faith: All work will be performed professionally, with a sincere effort to repair problems to the best of our ability. All labor required to complete the scope of work is included in the agreed-upon price. Surplus materials remain the property of XRP Roofing and will be removed by us.

ROC Complaint: The property owner has the right to file a written complaint with the Arizona Registrar of Contractors for any alleged violation. For more information, call the AZ Registrar of Contractors or visit www.azroc.gov.

Final Payment
Payment Upon Substantial Completion: XRP Roofing can collect the final remaining payment once 90% of the project has been installed.

Payment Timeline: Final payment is due within seven (7) days after the final invoice.

Withholding Payments: Payment may only be withheld for a specific part of the Work that is defective or incomplete, and then only in an amount reasonably necessary to cover the cost of correcting that issue, not to exceed 150% of the estimated cost of correction. Any funds withheld must be released once the issue is corrected. The Owner may not withhold funds for matters of appearance or aesthetics that do not affect functionality or integrity. All undisputed amounts must be paid in full and on time.

Lien Rights
XRP Roofing retains the right to file a mechanic’s lien against the property if payments are not made in accordance with the terms of the contract. The filing of a lien will include the unpaid balance plus any applicable interest and collection costs.

Preliminary Twenty-Day Lien Notice: This notice informs you of potential lien rights under Arizona law. It is crucial to ensure all payments are made in full and on time to prevent a lien, which could affect your ability to sell, refinance, or transfer the property.

Dispute Resolution
Jurisdiction: Any claims arising out of this contract will be decided by a court of general jurisdiction in Maricopa County, Arizona.

Governing Law: The laws of the state of Arizona govern this contract.

Jury Waiver: The Customer waives their right to a jury trial for any claims arising out of or in connection with this contract.

Entire Agreement
This Agreement constitutes the entire understanding between the parties. No other provisions, alterations, or additions are binding unless in writing and signed by both parties.

Independent Contractor
XRP Roofing may engage independent contractors to perform certain work. These independent contractors are not authorized to make commitments or decisions on behalf of XRP Roofing. They are required to carry appropriate insurance.

Additional Terms and Conditions
Bird Deterrent/Pest Control Devices, Gutter Removal, Painting, Permanent Christmas Lights, Satellite Removal, Solar Panels, Misting Systems, Roof Conduit, Thermostat Wires, Crane Disclaimer, Tile Color/Manufacturer Disclaimer: Please refer to the detailed disclaimers in the original documents for specific responsibilities and limitations. In general, the homeowner is responsible for reinstallation/reconnection of many ancillary items (gutters, satellites, solar, misting, etc.) unless otherwise stated in the proposal. XRP Roofing will do its best to maintain integrity but disclaims liability for damage beyond our direct control.

Insurance Claims: We assist with documentation and on-site meetings with adjusters, but final approval and payouts are between you and your insurance provider. You remain responsible for any deductible and non-covered amounts.

Arizona Climate: All materials and methods are selected for superior performance in Arizona’s extreme heat, UV exposure, and monsoon conditions.

Standard Methods / Additional Work / Service Calls
All work shall be constructed using XRP Roofing’s standard methods unless otherwise noted. Customer agrees to pay fees for labor and materials for work not covered by the warranty. Service calls not covered by the warranty will incur applicable service call and diagnosis fees.`;

const defaultPackages: Record<"good" | "better" | "best", PackageOption> = {
  good: {
    scope: "GOOD option: Essential roofing repair package with necessary labor, standard materials, cleanup, and workmanship basics.",
    price: 0,
  },
  better: {
    scope: "BETTER option: Enhanced roofing package with upgraded materials, improved ventilation details, cleanup, and stronger warranty support.",
    price: 0,
  },
  best: {
    scope: "BEST option: Premium roofing package with top-tier materials, full project documentation, priority scheduling, cleanup, and best available workmanship coverage.",
    price: 0,
  },
};

function normalizePackages(packages?: Proposal["packages"]): Record<"good" | "better" | "best", PackageOption> {
  return {
    good: typeof packages?.good === "string" ? { scope: packages.good, price: 0 } : packages?.good || defaultPackages.good,
    better: typeof packages?.better === "string" ? { scope: packages.better, price: 0 } : packages?.better || defaultPackages.better,
    best: typeof packages?.best === "string" ? { scope: packages.best, price: 0 } : packages?.best || defaultPackages.best,
  };
}

function normalizeInspectionPhotos(photos?: InspectionPhoto[]) {
  return defaultInspectionPhotos.map((defaultPhoto, index) => ({
    ...defaultPhoto,
    ...(photos?.[index] || {}),
  }));
}



function formatPastedProposalText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\*\*(.*?)\*\*/g, "\n\n$1\n")
    .replace(/\s+---\s+/g, "\n\n")
    .replace(/\s+--\s+/g, "\n\n")
    .replace(/\s+##\s+/g, "\n\n")
    .replace(/\s+\*(?=\s*\S)/g, "\n- ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

const initialProposalTemplates: ProposalTemplate[] = [
  {
    id: "executive",
    label: "Executive Roofing",
    description: "Clean premium proposal for homeowner approvals.",
    title: "BEST ROOFING PROPOSAL",
    summary: "A professional roofing proposal prepared for review and approval.",
    terms: defaultTerms,
    packages: defaultPackages,
  },
  {
    id: "insurance",
    label: "Insurance Claim",
    description: "Detailed format for carrier and adjuster review.",
    title: "INSURANCE ROOFING PROPOSAL",
    summary: "Prepared for insurance documentation, carrier review, and roofing claim support.",
    terms: defaultTerms,
    packages: defaultPackages,
  },
  {
    id: "premium",
    label: "Premium Package",
    description: "Polished customer-facing proposal with value highlights.",
    title: "PREMIUM ROOFING PROPOSAL",
    summary: "A premium customer-ready roofing package with clear scope, value, and next steps.",
    terms: defaultTerms,
    packages: defaultPackages,
  },
];

export default function ProposalsPage() {
  const [proposalMode, setProposalMode] = useState<"job" | "new">("job");
  const [jobs, setJobs] = useState<Lead[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const prevProposalsRef = useRef<Proposal[]>([]);
  const boardIntentHandledRef = useRef(false);
  const [templates, setTemplates] = useState<ProposalTemplate[]>(initialProposalTemplates);
  const [activeTab, setActiveTab] = useState<"proposals" | "drafts" | "templates" | "settings">("proposals");
  const [dataLoaded, setDataLoaded] = useState(false);
  const [jobSearch, setJobSearch] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [address, setAddress] = useState("");
  const [scope, setScope] = useState("");
  const [total, setTotal] = useState("");
  const [proposalSearch, setProposalSearch] = useState("");
  const [proposalFilter, setProposalFilter] = useState<"all" | "drafts">("all");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [activeProposal, setActiveProposal] = useState<Proposal | null>(null);
  const [deletedProposal, setDeletedProposal] = useState<Proposal | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [activeSection, setActiveSection] = useState("Estimate");
  const [showSendModal, setShowSendModal] = useState(false);
  const [showOfflineSignModal, setShowOfflineSignModal] = useState(false);
  const [offlineSignerName, setOfflineSignerName] = useState("");
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [typedSignature, setTypedSignature] = useState("");
  const [sendForm, setSendForm] = useState({
    toName: "",
    toEmail: "info@xrproofing.com",
    ccRecipients: "",
    templateName: "Personalized Proposal Email",
    subject: "",
    message: "",
  });
  const [sendNotice, setSendNotice] = useState("");
  const [templateForm, setTemplateForm] = useState({
    label: "",
    description: "",
    title: "",
    summary: "",
    terms: "",
    packages: defaultPackages,
  });
  const [editorForm, setEditorForm] = useState({
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    address: "",
    title: "",
    summary: "",
    coverPhoto: "/images/logo.jpeg",
    coverText: "",
    scope: "",
    total: "",
    template: "executive",
    notes: "",
    terms: "",
    showPackages: true,
    inspectionPhotos: defaultInspectionPhotos,
    packages: defaultPackages,
  });

  const [previewExpandedScopes, setPreviewExpandedScopes] = useState<Record<string, boolean>>({});

  const selectedJob = useMemo(() => jobs.find((job) => job.id === selectedJobId), [selectedJobId, jobs]);
  const selectedTemplate = useMemo(() => templates.find((template) => template.id === editorForm.template), [editorForm.template, templates]);
  const filteredJobs = useMemo(() => {
    const query = jobSearch.toLowerCase().trim();

    if (!query) return jobs;

    return jobs.filter((job) =>
      [job.name, job.address, job.city, job.roofType, job.email, job.phone]
        .some((value) => value?.toLowerCase().includes(query))
    );
  }, [jobSearch, jobs]);
  const filteredProposals = useMemo(() => {
    const query = proposalSearch.toLowerCase().trim();
    const activeProposals = proposals.filter((proposal) => !proposal.deletedAt);

    const visibleProposals = proposalFilter === "drafts"
      ? activeProposals.filter((proposal) => proposal.status === "Draft")
      : activeProposals.filter((proposal) => proposal.status !== "Draft");

    if (!query) return visibleProposals;

    return visibleProposals.filter((proposal) =>
      [proposal.customerName, proposal.address, proposal.scope, proposal.status]
        .some((value) => value.toLowerCase().includes(query))
    );
  }, [proposalFilter, proposalSearch, proposals]);
  const trashedProposals = useMemo(() => proposals.filter((proposal) => Boolean(proposal.deletedAt)), [proposals]);

  // Load proposals (estimates) and keep them in sync across every device.
  // Source of truth is the shared `proposal_shares` table; localStorage is a
  // fast first paint + offline fallback. On first load, any local-only
  // proposals are migrated up so nothing is lost, then realtime + focus keep
  // all devices consistent.
  useEffect(() => {
    let mounted = true;

    function retain(list: Proposal[]) {
      return list.filter((proposal) => !proposal.deletedAt || Date.now() - new Date(proposal.deletedAt).getTime() < trashRetentionMs);
    }
    function readLocalProposals(): Proposal[] {
      try {
        return JSON.parse(window.localStorage.getItem(proposalsLocalKey) || "[]") as Proposal[];
      } catch {
        return [];
      }
    }

    async function reloadFromServer() {
      if (!proposalSyncEnabled()) return;
      const server = await loadProposalRecords<Proposal>();
      if (!mounted) return;
      setProposals((current) => {
        const serverIds = new Set(server.map((proposal) => proposal.id));
        const localOnly = current.filter((proposal) => !serverIds.has(proposal.id));
        const merged = retain([...server, ...localOnly]);
        // Treat server data as already-synced so the diff effect doesn't echo it
        // back (jsonb reorders keys, which would otherwise look like a change).
        prevProposalsRef.current = merged;
        return merged;
      });
      setActiveProposal((currentProposal) => {
        if (!currentProposal) return currentProposal;
        const updated = server.find((proposal) => proposal.id === currentProposal.id);
        return updated ? { ...currentProposal, ...updated } : currentProposal;
      });
    }

    async function init() {
      const savedTemplates = window.localStorage.getItem("xrp-crm-proposal-templates");
      if (savedTemplates && mounted) {
        try {
          setTemplates(JSON.parse(savedTemplates) as ProposalTemplate[]);
        } catch {
          /* keep defaults */
        }
      }

      const local = retain(readLocalProposals());
      if (local.length && mounted) setProposals(local);

      if (proposalSyncEnabled()) {
        const server = await loadProposalRecords<Proposal>();
        if (!mounted) return;
        const serverIds = new Set(server.map((proposal) => proposal.id));
        const localOnly = local.filter((proposal) => !serverIds.has(proposal.id));
        if (localOnly.length) await Promise.all(localOnly.map((proposal) => upsertProposalRecord(proposal)));
        if (!mounted) return;
        const merged = retain([...server, ...localOnly]);
        prevProposalsRef.current = merged;
        setProposals(merged);
      } else if (local.length) {
        prevProposalsRef.current = local;
      }

      if (mounted) setDataLoaded(true);
    }

    void init();

    void loadCrewDataset().then((data) => { if (mounted) setJobs(data.jobs); }).catch(() => {});

    const unsubscribe = subscribeToProposalRecords(() => void reloadFromServer());
    const unsubscribeJobs = subscribeToCrewData(() => {
      void loadCrewDataset().then((data) => { if (mounted) setJobs(data.jobs); }).catch(() => {});
    });
    return () => {
      mounted = false;
      unsubscribe();
      unsubscribeJobs();
    };
  }, []);

  useAutoRefresh(() => {
    void loadCrewDataset().then((data) => setJobs(data.jobs)).catch(() => {});
    if (!proposalSyncEnabled()) return;
    void loadProposalRecords<Proposal>().then((server) => {
      setProposals((current) => {
        const serverIds = new Set(server.map((p) => p.id));
        const localOnly = current.filter((p) => !serverIds.has(p.id));
        return [...server, ...localOnly].filter((p) => !p.deletedAt || Date.now() - new Date(p.deletedAt).getTime() < trashRetentionMs);
      });
    }).catch(() => {});
  });

  useEffect(() => {
    if (!dataLoaded) return;
    window.localStorage.setItem(proposalsLocalKey, JSON.stringify(proposals));
  }, [dataLoaded, proposals]);

  // One-click handoff from a Job / customer profile: open the requested estimate
  // editor directly, or create one from the job and open it (linked by job id).
  // Consume-once so a normal later visit isn't hijacked.
  useEffect(() => {
    if (!dataLoaded || boardIntentHandledRef.current) return;
    const intent = takeEstimateIntent();
    boardIntentHandledRef.current = true;
    if (!intent) return;
    if (intent.kind === "open") {
      const existing = proposals.find((proposal) => proposal.id === intent.id);
      if (existing) openProposal(existing);
      return;
    }
    createEstimateFromLead(payloadToLead(intent.job));
  }, [dataLoaded, proposals]);

  // Push every local change to the shared store so other devices see it. Diffing
  // against the previous list keeps the many existing handlers untouched: any
  // create/edit becomes an upsert, and a permanent delete (row removed from the
  // list) becomes a server delete. Trashing keeps the row (with deletedAt) so it
  // syncs as an upsert.
  useEffect(() => {
    if (!dataLoaded || !proposalSyncEnabled()) {
      prevProposalsRef.current = proposals;
      return;
    }
    const previous = prevProposalsRef.current;
    const previousById = new Map(previous.map((proposal) => [proposal.id, proposal]));
    const currentIds = new Set(proposals.map((proposal) => proposal.id));

    for (const proposal of proposals) {
      const before = previousById.get(proposal.id);
      if (!before || JSON.stringify(before) !== JSON.stringify(proposal)) {
        void upsertProposalRecord(proposal);
      }
    }
    for (const proposal of previous) {
      if (!currentIds.has(proposal.id)) void deleteProposalRecord(proposal.id);
    }
    prevProposalsRef.current = proposals;
  }, [proposals, dataLoaded]);

  useEffect(() => {
    if (!dataLoaded) return;
    window.localStorage.setItem("xrp-crm-proposal-templates", JSON.stringify(templates));
  }, [dataLoaded, templates]);

  useEffect(() => {
    if (!dataLoaded || !activeProposal) return;
    // A signed proposal is locked: never auto-overwrite its package/price/
    // signature from the editor form (those are the immutable accepted values).
    if (isProposalLocked(activeProposal)) return;

    const timeout = window.setTimeout(() => {
      const updatedProposal: Proposal = {
        ...activeProposal,
        customerName: editorForm.customerName,
        address: editorForm.address,
        title: editorForm.title,
        summary: editorForm.summary,
        coverPhoto: editorForm.coverPhoto,
        coverText: editorForm.coverText,
        scope: editorForm.scope,
        total: Number(editorForm.total) || 0,
        template: editorForm.template,
        notes: editorForm.notes,
        terms: editorForm.terms,
        inspectionPhotos: normalizeInspectionPhotos(editorForm.inspectionPhotos),
        packages: normalizePackages(editorForm.packages),
      };

      setProposals((currentProposals) =>
        currentProposals.map((proposal) => proposal.id === updatedProposal.id ? updatedProposal : proposal)
      );
    }, 800);

    return () => window.clearTimeout(timeout);
  }, [activeProposal, dataLoaded, editorForm]);



  function handleCreateProposal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (proposalMode === "job" && !selectedJob) return;
    if (proposalMode === "new" && (!customerName || !address)) return;

    const newProposal: Proposal = {
      id: `P-${1001 + proposals.length}`,
      job: proposalMode === "job" ? selectedJob : undefined,
      customerName: proposalMode === "job" && selectedJob ? selectedJob.name : customerName,
      customerEmail: proposalMode === "job" && selectedJob ? selectedJob.email : "",
      customerPhone: proposalMode === "job" && selectedJob ? selectedJob.phone : "",
      address: proposalMode === "job" && selectedJob ? `${selectedJob.address}, ${selectedJob.city}` : address,
      scope: scope || (proposalMode === "job" && selectedJob ? `${selectedJob.roofType} roofing proposal` : "Roofing proposal"),
      total: proposalMode === "job" && selectedJob ? selectedJob.value : Number(total) || 0,
      status: "Draft",
      template: "executive",
      title: "BEST ROOFING PROPOSAL",
      summary: "A professional roofing proposal prepared for review and approval.",
      coverPhoto: "/images/logo.jpeg",
      coverText: "Prepared by XRP Roofing with a professional project overview, proposal options, and customer approval details.",
      notes: "Includes professional roof assessment, materials, labor, cleanup, and customer-ready project documentation.",
      terms: defaultTerms,
      inspectionPhotos: defaultInspectionPhotos,
      packages: defaultPackages,
    };

    setProposals((currentProposals) => [newProposal, ...currentProposals]);
    // Estimates are a lead source: find-or-create the customer (match by
    // phone -> email -> address, no duplicates) so it appears on the Customer board.
    void findOrCreateCustomer({
      name: newProposal.customerName,
      email: newProposal.customerEmail,
      phone: newProposal.customerPhone,
      propertyAddress: newProposal.address,
      status: "Estimate",
      lifetimeValue: newProposal.total,
      source: "Estimate",
    }).catch(() => {});
    openProposal(newProposal);
    setShowCreateForm(false);
    setCustomerName("");
    setAddress("");
    setScope("");
    setTotal("");
  }

  // Create an estimate directly from a job (one-click from the Jobs board /
  // customer profile) and open its editor. The job is stored on the proposal so
  // future clicks open this same estimate instead of creating another.
  function createEstimateFromLead(job: Lead) {
    const newProposal: Proposal = {
      id: `P-${1001 + proposals.length}`,
      job,
      customerName: job.name,
      customerEmail: job.email,
      customerPhone: job.phone,
      address: job.city ? `${job.address}, ${job.city}` : job.address,
      scope: `${job.roofType || "Roofing"} roofing proposal`,
      total: job.value || 0,
      status: "Draft",
      template: "executive",
      title: "BEST ROOFING PROPOSAL",
      summary: "A professional roofing proposal prepared for review and approval.",
      coverPhoto: "/images/logo.jpeg",
      coverText: "Prepared by XRP Roofing with a professional project overview, proposal options, and customer approval details.",
      notes: "Includes professional roof assessment, materials, labor, cleanup, and customer-ready project documentation.",
      terms: defaultTerms,
      showPackages: true,
      inspectionPhotos: defaultInspectionPhotos,
      packages: defaultPackages,
    };

    setProposals((currentProposals) => [newProposal, ...currentProposals]);
    void findOrCreateCustomer({
      name: newProposal.customerName,
      email: newProposal.customerEmail,
      phone: newProposal.customerPhone,
      propertyAddress: newProposal.address,
      status: "Estimate",
      lifetimeValue: newProposal.total,
      source: "Estimate",
    }).catch(() => {});
    openProposal(newProposal);
  }

  function applyTemplateToEditor(template: ProposalTemplate) {
    setEditorForm({
      ...editorForm,
      template: template.id,
      title: template.title,
      summary: template.summary,
      terms: template.terms,
      packages: normalizePackages(template.packages),
    });
  }

  function handleCreateTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!templateForm.label || !templateForm.title) return;

    const newTemplate: ProposalTemplate = {
      id: `template-${templates.length + 1}`,
      label: templateForm.label,
      description: templateForm.description || "Custom professional proposal template.",
      title: templateForm.title,
      summary: templateForm.summary || "A professional roofing proposal prepared for customer review.",
      terms: templateForm.terms || defaultTerms,
      packages: normalizePackages(templateForm.packages),
    };

    setTemplates((currentTemplates) => [newTemplate, ...currentTemplates]);
    setTemplateForm({ label: "", description: "", title: "", summary: "", terms: "", packages: defaultPackages });
  }

  function openProposal(proposal: Proposal) {
    setEditorForm({
      customerName: proposal.customerName,
      customerEmail: proposal.customerEmail || proposal.job?.email || "",
      customerPhone: proposal.customerPhone || proposal.job?.phone || "",
      address: proposal.address,
      title: proposal.title,
      summary: proposal.summary,
      coverPhoto: proposal.coverPhoto || "/images/logo.jpeg",
      coverText: proposal.coverText || "Prepared by XRP Roofing with a professional project overview, proposal options, and customer approval details.",
      scope: proposal.scope,
      total: String(proposal.total),
      template: proposal.template,
      notes: proposal.notes,
      terms: proposal.terms || defaultTerms,
      showPackages: proposal.showPackages !== false,
      inspectionPhotos: normalizeInspectionPhotos(proposal.inspectionPhotos),
      packages: normalizePackages(proposal.packages),
    });
    setIsPreviewing(false);
    setActiveSection("Estimate");
    setActiveProposal(proposal);
  }

  function handleSaveProposal() {
    if (!activeProposal) return;

    const updatedProposal = saveActiveProposal();
    setActiveProposal(updatedProposal);
  }

  function saveActiveProposal(extraFields?: Partial<Proposal>) {
    if (!activeProposal) return null;

    const updatedProposal: Proposal = {
      ...activeProposal,
      customerName: editorForm.customerName,
      customerEmail: editorForm.customerEmail,
      customerPhone: editorForm.customerPhone,
      address: editorForm.address,
      title: editorForm.title,
      summary: editorForm.summary,
      coverPhoto: editorForm.coverPhoto,
      coverText: editorForm.coverText,
      scope: editorForm.scope,
      total: Number(editorForm.total) || 0,
      template: editorForm.template,
      notes: editorForm.notes,
      terms: editorForm.terms,
      showPackages: editorForm.showPackages,
      inspectionPhotos: normalizeInspectionPhotos(editorForm.inspectionPhotos),
      packages: normalizePackages(editorForm.packages),
      ...extraFields,
    };

    setProposals((currentProposals) =>
      currentProposals.map((proposal) => proposal.id === updatedProposal.id ? updatedProposal : proposal)
    );

    return updatedProposal;
  }

  function handleUpdateTemplate(updatedTemplate: ProposalTemplate) {
    setTemplates((currentTemplates) =>
      currentTemplates.map((template) => template.id === updatedTemplate.id ? updatedTemplate : template)
    );
  }

  function handleOpenSendModal() {
    if (!activeProposal) return;

    const savedProposal = saveActiveProposal() || activeProposal;
    setActiveProposal(savedProposal);
    setSendNotice("");
    setSendForm({
      toName: savedProposal.customerName,
      toEmail: savedProposal.customerEmail || savedProposal.job?.email || "info@xrproofing.com",
      ccRecipients: savedProposal.ccRecipients || "",
      templateName: "Personalized Proposal Email",
      subject: savedProposal.sendSubject || `Proposal for ${savedProposal.customerName}`,
      message: savedProposal.sendMessage || `Dear ${savedProposal.customerName},\n\nPlease follow the link to review and accept your customized proposal.\nThank you for your time and consideration.\n\nJonathan Gonzalez`,
    });
    setShowSendModal(true);
  }

  async function handleSendProposal() {
    if (!activeProposal) return;

    const sentProposal = saveActiveProposal({
      status: "Sent",
      ccRecipients: sendForm.ccRecipients,
      sendSubject: sendForm.subject,
      sendMessage: sendForm.message,
      sentToEmail: sendForm.toEmail,
      proposalVersion: (activeProposal.proposalVersion ?? 0) + 1,
    });
    const proposalForLink = sentProposal || activeProposal;
    const proposalLink = `${window.location.origin}/proposal/${encodeURIComponent(proposalForLink.id)}`;

    if (sentProposal) {
      setActiveProposal(sentProposal);
    }

    setSendNotice("Sending proposal email...");

    try {
      const sharePromise = fetch("/api/proposals/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proposalForLink),
      }).catch(() => null);

      const emailPromise = fetch("/api/proposals/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toName: sendForm.toName,
          toEmail: sendForm.toEmail,
          ccRecipients: sendForm.ccRecipients,
          subject: sendForm.subject,
          message: sendForm.message,
          proposalLink,
          coverPhoto: sentProposal?.coverPhoto || editorForm.coverPhoto,
          coverTitle: sentProposal?.title || editorForm.title,
          coverText: sentProposal?.coverText || editorForm.coverText,
        }),
      }).catch(() => null);

      const [shareResponse, response] = await Promise.all([sharePromise, emailPromise]);
      let shareWarning = "";

      if (!shareResponse || !shareResponse.ok) {
        const data = shareResponse ? await shareResponse.json().catch(() => null) as { error?: string } | null : null;
        shareWarning = data?.error || "Proposal could not be saved for the customer link. Please configure proposal sharing before sending.";
      }

      if (!response) {
        setSendNotice(`Could not connect to the email server. Please check your internet connection and try again.\n\nProposal link: ${proposalLink}`);
        return;
      }

      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        const serverError = data?.error || "Unable to send proposal email";
        if (serverError === "Email service is not configured") {
          setSendNotice(`Email service is not configured. Add RESEND_API_KEY in Vercel to send proposal emails, or copy and send this proposal link manually:\n\n${proposalLink}`);
        } else {
          setSendNotice(`${serverError}\n\nProposal link: ${proposalLink}`);
        }
        return;
      }

      setSendNotice(`${shareWarning ? `${shareWarning} Email was sent, but the customer link may not open until sharing is configured.` : `Proposal sent to ${sendForm.toEmail}.`}\n\nProposal link: ${proposalLink}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email could not be sent.";
      setSendNotice(`${message}\n\nProposal link: ${proposalLink}`);
    }
  }

  function handleDeleteProposal(proposal: Proposal) {
    const trashedProposal = { ...proposal, deletedAt: new Date().toISOString() };
    setDeletedProposal(trashedProposal);
    setProposals((currentProposals) => currentProposals.map((currentProposal) => currentProposal.id === proposal.id ? trashedProposal : currentProposal));
    if (activeProposal?.id === proposal.id) {
      setActiveProposal(null);
    }
  }

  function handleUndoDelete() {
    if (!deletedProposal) return;

    setProposals((currentProposals) => currentProposals.map((proposal) => proposal.id === deletedProposal.id ? { ...proposal, deletedAt: undefined } : proposal));
    setDeletedProposal(null);
  }

  function handleRestoreProposal(proposal: Proposal) {
    setProposals((currentProposals) => currentProposals.map((currentProposal) => currentProposal.id === proposal.id ? { ...currentProposal, deletedAt: undefined } : currentProposal));
  }

  function handlePermanentDeleteProposal(proposal: Proposal) {
    setProposals((currentProposals) => currentProposals.filter((currentProposal) => currentProposal.id !== proposal.id));
    if (deletedProposal?.id === proposal.id) {
      setDeletedProposal(null);
    }
  }

  function handleEmptyExpiredTrash() {
    setProposals((currentProposals) => currentProposals.filter((proposal) => !proposal.deletedAt || Date.now() - new Date(proposal.deletedAt).getTime() < trashRetentionMs));
  }

  function handleAcceptProposal() {
    if (!activeProposal || !agreementAccepted || !typedSignature.trim()) return;

    const acceptedOption = activeProposal.selectedOption || "best";
    const acceptedPrice = Number(editorForm.total) || activeProposal.total || 0;
    const signedAt = new Date().toISOString();
    const signedProposal = saveActiveProposal({
      status: "Won",
      signedAt,
      acceptedAt: signedAt,
      signedBy: typedSignature.trim(),
      selectedOption: acceptedOption,
      acceptedPackage: acceptedOption,
      acceptedPackageName: acceptedOption.charAt(0).toUpperCase() + acceptedOption.slice(1),
      acceptedPrice,
      total: acceptedPrice,
      proposalVersion: activeProposal.proposalVersion ?? 1,
      locked: true,
    });

    if (signedProposal) {
      setActiveProposal(signedProposal);
    }
  }

  function handleOpenOfflineSignModal() {
    if (!activeProposal) return;
    setOfflineSignerName(activeProposal.customerName || "");
    setShowOfflineSignModal(true);
  }

  function handleMarkSignedOffline() {
    if (!activeProposal) return;

    const acceptedOption = activeProposal.selectedOption || "best";
    const acceptedPrice = Number(editorForm.total) || activeProposal.total || 0;
    const signedAt = new Date().toISOString();
    const signedProposal = saveActiveProposal({
      status: "Signed Offline" as Proposal["status"],
      offlineSignedAt: signedAt,
      offlineSignedBy: offlineSignerName.trim() || activeProposal.customerName,
      signedAt,
      signedBy: offlineSignerName.trim() || activeProposal.customerName,
      selectedOption: acceptedOption,
      acceptedPackage: acceptedOption,
      acceptedPackageName: acceptedOption.charAt(0).toUpperCase() + acceptedOption.slice(1),
      acceptedPrice,
      total: acceptedPrice,
      proposalVersion: activeProposal.proposalVersion ?? 1,
      locked: true,
    });

    if (signedProposal) {
      setActiveProposal(signedProposal);
    }
    setShowOfflineSignModal(false);
  }

  function handleUploadSignedDocument(file: File | undefined) {
    if (!file || !activeProposal) return;

    const reader = new FileReader();
    reader.onload = () => {
      const fileData = typeof reader.result === "string" ? reader.result : "";
      const updatedProposal = saveActiveProposal({
        offlineSignatureFile: fileData,
        offlineSignatureFileName: file.name,
      });
      if (updatedProposal) {
        setActiveProposal(updatedProposal);
      }
    };
    reader.readAsDataURL(file);
  }

  function handleInspectionPhotoUpload(index: number, file: File | undefined) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const image = typeof reader.result === "string" ? reader.result : "";
      const inspectionPhotos = normalizeInspectionPhotos(editorForm.inspectionPhotos);
      inspectionPhotos[index] = { ...inspectionPhotos[index], image };
      setEditorForm({ ...editorForm, inspectionPhotos });
    };
    reader.readAsDataURL(file);
  }

  if (activeProposal) {
    return (
      <div className="-mx-4 -my-6 min-h-[calc(100vh-5rem)] bg-slate-100 font-serif sm:-mx-6 lg:-mx-8 print:m-0 print:min-h-0 print:bg-white">
        <div className="sticky top-16 z-30 border-b border-slate-200 bg-white shadow-sm lg:top-20 print:hidden">
          {/* Row 1 — back + address */}
          <div className="flex h-10 items-center justify-between px-4">
            <button type="button" onClick={() => setActiveProposal(null)} className="text-sm font-bold text-blue-700">← Back to proposals</button>
            <div className="hidden text-sm font-semibold text-slate-700 md:block">{editorForm.address}</div>
          </div>
          {/* Row 2 — action buttons, scrollable on mobile */}
          <div className="flex items-center gap-2 overflow-x-auto px-4 pb-2 scrollbar-hide">
            <span className="shrink-0 rounded-full bg-orange-50 px-3 py-1.5 text-xs font-black text-orange-700">{activeProposal.status}</span>
            <button type="button" onClick={handleSaveProposal} className="shrink-0 rounded-full bg-emerald-50 px-4 py-1.5 text-xs font-black text-emerald-700 active:scale-95">Save</button>
            <button type="button" onClick={() => { if (window.confirm(`Permanently delete this proposal for ${activeProposal.customerName}? This cannot be undone.`)) { handlePermanentDeleteProposal(activeProposal); } }} className="shrink-0 rounded-full bg-red-600 px-4 py-1.5 text-xs font-black text-white active:scale-95">Delete</button>
            <button type="button" onClick={() => setIsPreviewing((current) => !current)} className="shrink-0 rounded-full bg-blue-50 px-4 py-1.5 text-xs font-black text-blue-700 active:scale-95">{isPreviewing ? "Edit" : "Preview"}</button>
            <button type="button" onClick={() => { setIsPreviewing(true); setTimeout(() => { window.print(); }, 300); }} className="shrink-0 rounded-full bg-slate-100 px-4 py-1.5 text-xs font-black text-slate-700 active:scale-95 print:hidden">Print</button>
            <button type="button" onClick={handleOpenSendModal} className="shrink-0 rounded-full bg-blue-600 px-4 py-1.5 text-xs font-black text-white active:scale-95">Send</button>
            {activeProposal.status !== "Won" && activeProposal.status !== "Signed" && activeProposal.status !== "Signed Offline" && (
              <button type="button" onClick={handleOpenOfflineSignModal} className="shrink-0 rounded-full bg-amber-50 px-4 py-1.5 text-xs font-black text-amber-700 active:scale-95">Mark as Signed Offline</button>
            )}
            {(activeProposal.status === "Won" || activeProposal.status === "Signed" || activeProposal.status === "Signed Offline") && (
              <label className="shrink-0 cursor-pointer rounded-full bg-violet-50 px-4 py-1.5 text-xs font-black text-violet-700 active:scale-95">
                Upload Signed Proposal
                <input type="file" accept="image/*,.pdf" onChange={(event) => handleUploadSignedDocument(event.target.files?.[0])} className="hidden" />
              </label>
            )}
          </div>
        </div>

        {(activeProposal.status === "Won" || activeProposal.status === "Signed" || activeProposal.status === "Signed Offline") && (
          <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-4 print:hidden">
            <div className="mx-auto max-w-5xl rounded-2xl bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-black uppercase tracking-wider text-emerald-700">Signed proposal copy</p>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-700">🔒 Locked</span>
              </div>
              <p className="mt-2 text-sm font-bold text-slate-700">Signed by {activeProposal.signedBy || activeProposal.customerName} on {activeProposal.signedAt ? new Date(activeProposal.signedAt).toLocaleString() : "today"}.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Accepted package</p>
                  <p className="mt-0.5 text-sm font-black text-[#07183f]">{activeProposal.acceptedPackageName || (activeProposal.acceptedPackage || activeProposal.selectedOption || "best").replace(/^\w/, (character) => character.toUpperCase())}</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Accepted price</p>
                  <p className="mt-0.5 text-sm font-black text-[#07183f]">${(activeProposal.acceptedPrice ?? activeProposal.total).toLocaleString()}</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Version</p>
                  <p className="mt-0.5 text-sm font-black text-[#07183f]">v{activeProposal.proposalVersion ?? 1}</p>
                </div>
              </div>
              {(activeProposal.signatureData || activeProposal.signatureDataUrl) && <Image src={(activeProposal.signatureData || activeProposal.signatureDataUrl) as string} alt="Customer signature" width={360} height={110} className="mt-3 max-h-28 w-auto rounded-lg border border-slate-200 bg-white object-contain p-2" />}
              {activeProposal.status === "Signed Offline" && (
                <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-wider text-amber-700">Signed In Person</p>
                  <p className="mt-0.5 text-sm text-slate-700">This proposal was signed offline (in person) by {activeProposal.offlineSignedBy || activeProposal.customerName}.</p>
                </div>
              )}
              {activeProposal.offlineSignatureFile && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Uploaded Signed Document</p>
                  <div className="mt-2 flex items-center gap-3">
                    {activeProposal.offlineSignatureFile.startsWith("data:image") ? (
                      <Image src={activeProposal.offlineSignatureFile} alt="Signed proposal" width={200} height={140} className="max-h-36 w-auto rounded-lg border border-slate-200 object-contain" />
                    ) : (
                      <a href={activeProposal.offlineSignatureFile} download={activeProposal.offlineSignatureFileName || "signed-proposal.pdf"} className="inline-flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100">
                        📄 {activeProposal.offlineSignatureFileName || "signed-proposal.pdf"}
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className={`grid min-h-[calc(100vh-8.5rem)] grid-cols-1 print:min-h-0 print:block ${isPreviewing ? "" : "lg:grid-cols-[280px_1fr]"}`} id="proposal-print-area">
          {!isPreviewing && (
          <aside className="border-r border-slate-200 bg-white p-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Customer</p>
                  <input value={editorForm.customerName} onChange={(event) => setEditorForm({ ...editorForm, customerName: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-[#07183f] outline-none" />
                  <AddressAutocomplete
                    value={editorForm.address}
                    onChange={(addr) => setEditorForm({ ...editorForm, address: addr })}
                    placeholder="Start typing address..."
                    className="mt-2 !rounded-lg !py-2 !text-xs text-slate-600"
                  />
                  <input value={editorForm.customerPhone} onChange={(event) => setEditorForm({ ...editorForm, customerPhone: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 outline-none" placeholder="Customer phone" />
                  <input value={editorForm.customerEmail} onChange={(event) => setEditorForm({ ...editorForm, customerEmail: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-blue-700 outline-none" placeholder="Customer email" />
                </div>
                <button className="text-slate-400">•••</button>
              </div>
            </div>
            <button className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-bold text-blue-700">View job details</button>
            <div className="mt-5">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Proposal template</p>
              <div className="space-y-2">
                {templates.map((template) => (
                  <button key={template.id} type="button" onClick={() => applyTemplateToEditor(template)} className={`w-full rounded-xl p-3 text-left ${editorForm.template === template.id ? "bg-blue-50 ring-1 ring-blue-300" : "bg-slate-50"}`}>
                    <span className="block text-sm font-black text-[#07183f]">{template.label}</span>
                    <span className="mt-1 block text-xs font-semibold text-slate-500">{template.description}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-5 space-y-3">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                Proposal title
                <input value={editorForm.title} onChange={(event) => setEditorForm({ ...editorForm, title: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm normal-case tracking-normal text-slate-700 outline-none" />
              </label>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                Proposal summary
                <textarea value={editorForm.summary} onChange={(event) => setEditorForm({ ...editorForm, summary: event.target.value })} className="mt-2 min-h-20 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm normal-case tracking-normal text-slate-700 outline-none" />
              </label>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                Cover photo URL
                <input value={editorForm.coverPhoto} onChange={(event) => setEditorForm({ ...editorForm, coverPhoto: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm normal-case tracking-normal text-slate-700 outline-none" placeholder="/images/logo.jpeg" />
              </label>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                Cover text
                <textarea value={editorForm.coverText} onChange={(event) => setEditorForm({ ...editorForm, coverText: event.target.value })} className="mt-2 min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm normal-case tracking-normal text-slate-700 outline-none" />
              </label>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                Scope
                <textarea value={editorForm.scope} onChange={(event) => setEditorForm({ ...editorForm, scope: event.target.value })} onPaste={(event) => { event.preventDefault(); setEditorForm({ ...editorForm, scope: formatPastedProposalText(event.clipboardData.getData("text")) }); }} className="mt-2 min-h-40 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm normal-case tracking-normal text-slate-700 outline-none" />
              </label>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                Total
                <input type="number" value={editorForm.total} disabled={isProposalLocked(activeProposal)} onChange={(event) => setEditorForm({ ...editorForm, total: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm normal-case tracking-normal text-slate-700 outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500" />
                {isProposalLocked(activeProposal) && <span className="mt-1 block text-[10px] font-bold normal-case tracking-normal text-emerald-700">🔒 Locked at the signed amount</span>}
              </label>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                Customer notes
                <textarea value={editorForm.notes} onChange={(event) => setEditorForm({ ...editorForm, notes: event.target.value })} className="mt-2 min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm normal-case tracking-normal text-slate-700 outline-none" />
              </label>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                Terms and conditions
                <textarea value={editorForm.terms} onChange={(event) => setEditorForm({ ...editorForm, terms: event.target.value })} className="mt-2 min-h-32 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm normal-case tracking-normal text-slate-700 outline-none" />
              </label>
            </div>
            <div className="mt-5">
              {/* Good / Better / Best toggle */}
              <label className="mb-4 flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <p className="text-sm font-black text-[#07183f]">Good / Better / Best</p>
                  <p className="text-xs font-semibold text-slate-500">{editorForm.showPackages ? "Showing package options" : "Hidden — single proposal"}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditorForm({ ...editorForm, showPackages: !editorForm.showPackages })}
                  className={`relative h-6 w-11 rounded-full transition-colors ${editorForm.showPackages ? "bg-blue-600" : "bg-slate-300"}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${editorForm.showPackages ? "translate-x-5" : "translate-x-0.5"}`} />
                </button>
              </label>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Proposal sections</p>
              <div className="space-y-2">
                {proposalSections.filter((section) => editorForm.showPackages || !["BEST", "BETTER", "GOOD"].includes(section)).map((section) => (
                  <button key={section} type="button" onClick={() => setActiveSection(section)} className={`w-full rounded-xl px-4 py-3 text-left text-sm font-bold ${section === activeSection ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200" : "bg-slate-50 text-slate-600"}`}>
                    {section}
                  </button>
                ))}
              </div>
              <button className="mt-3 w-full rounded-xl border border-blue-300 bg-blue-50 px-4 py-3 text-center text-xl font-light text-blue-700">+</button>
            </div>
          </aside>
          )}

          <main className="p-6 print:p-0">
            <div className="mx-auto max-w-[760px] print:max-w-none">
              <p className="mb-5 text-center text-sm font-black text-slate-700 print:hidden">{selectedTemplate?.label || "Custom Proposal"}</p>
              <div className={`min-h-[900px] rounded-[2rem] border bg-white p-8 shadow-xl shadow-slate-200 print:min-h-0 print:rounded-none print:border-none print:p-0 print:shadow-none ${editorForm.template === "premium" ? "border-orange-300" : editorForm.template === "insurance" ? "border-blue-300" : "border-slate-200"}`}>
                <div className="grid gap-6 rounded-3xl border border-slate-200 bg-slate-50 p-6 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Client Info</p>
                    <p className="mt-3 text-xl font-black text-[#07183f]">{editorForm.customerName}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{editorForm.address}</p>
                    {editorForm.customerPhone && <p className="mt-2 text-sm font-bold text-slate-700">{editorForm.customerPhone}</p>}
                    {editorForm.customerEmail && <p className="mt-1 text-sm font-bold text-blue-700">{editorForm.customerEmail}</p>}
                  </div>
                  <div className="border-t border-slate-200 pt-6 md:border-l md:border-t-0 md:pl-6 md:pt-0">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Prepared By</p>
                    <p className="mt-3 text-xl font-black text-[#07183f]">XRP Roofing</p>
                    <p className="mt-2 text-sm font-bold text-slate-700">Jonathan Gonzalez</p>
                    <p className="mt-2 text-sm text-slate-600">(623) 300-8097</p>
                    <p className="mt-1 text-sm text-blue-700">info@xrproofing.com</p>
                    <p className="mt-1 text-sm text-slate-600">xrproofing.com</p>
                  </div>
                </div>

                <div className="my-8 text-center">
                  {isPreviewing ? (
                    <h1 className={`text-3xl font-black tracking-tight ${editorForm.template === "premium" ? "text-orange-600" : "text-[#07183f]"}`}>ROOFING PROPOSAL</h1>
                  ) : (
                    <input value={editorForm.title} onChange={(event) => setEditorForm({ ...editorForm, title: event.target.value })} className={`w-full border-none bg-transparent p-0 text-center text-3xl font-black tracking-tight outline-none ${editorForm.template === "premium" ? "text-orange-600" : "text-[#07183f]"}`} />
                  )}
                  <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs font-black uppercase tracking-wider">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">ID {activeProposal.id}</span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">Issued {new Date().toLocaleDateString()}</span>
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">{activeProposal.status}</span>
                  </div>
                </div>

                {(isPreviewing || activeSection === "Cover") && (
                  <div className="mt-8 rounded-3xl bg-slate-50 p-8 text-center">
                    <p className="text-xs font-black uppercase tracking-wider text-slate-500">Cover page</p>
                    <Image src={editorForm.coverPhoto || "/images/logo.jpeg"} alt="Proposal cover" width={220} height={130} className="mx-auto mt-5 max-h-36 w-auto rounded-2xl bg-white object-contain shadow-sm" />
                    <p className="mt-5 text-3xl font-black text-[#07183f]">{editorForm.title}</p>
                    <p className="mt-4 text-lg font-bold text-slate-700">{editorForm.customerName}</p>
                    <p className="mt-2 text-sm text-slate-500">{editorForm.address}</p>
                    {isPreviewing ? (
                      <p className="mx-auto mt-6 max-w-xl whitespace-pre-line text-sm leading-7 text-slate-600">{editorForm.coverText}</p>
                    ) : (
                      <textarea value={editorForm.coverText} onChange={(event) => setEditorForm({ ...editorForm, coverText: event.target.value })} className="mx-auto mt-6 min-h-28 w-full max-w-xl resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center text-sm leading-7 text-slate-600 outline-none" />
                    )}
                  </div>
                )}

                {(isPreviewing || activeSection === "Inspection Photos") && (
                  <div className={`mt-8 ${normalizeInspectionPhotos(editorForm.inspectionPhotos).every((p) => !p.image) ? "print:hidden" : ""}`}>
                    <p className="text-xs font-black uppercase tracking-wider text-slate-500">Inspection Photos</p>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      {normalizeInspectionPhotos(editorForm.inspectionPhotos).map((photo, index) => (
                        <div key={photo.label} className={`rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 ${!photo.image ? "print:hidden" : ""}`}>
                          <div className="flex min-h-40 items-center justify-center overflow-hidden rounded-xl bg-white text-sm font-bold text-slate-500">
                            {photo.image ? (
                              <Image src={photo.image} alt={photo.label} width={320} height={220} className="h-full max-h-52 w-full object-cover" />
                            ) : (
                              <span>{photo.label}</span>
                            )}
                          </div>
                          {isPreviewing ? (
                            photo.note && <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600">{photo.note}</p>
                          ) : (
                            <>
                              <label className="mt-3 block rounded-xl bg-blue-50 px-4 py-3 text-center text-sm font-black text-blue-700">
                                Upload photo
                                <input type="file" accept="image/*" onChange={(event) => handleInspectionPhotoUpload(index, event.target.files?.[0])} className="hidden" />
                              </label>
                              <textarea value={photo.note} onChange={(event) => { const inspectionPhotos = normalizeInspectionPhotos(editorForm.inspectionPhotos); inspectionPhotos[index] = { ...inspectionPhotos[index], note: event.target.value }; setEditorForm({ ...editorForm, inspectionPhotos }); }} className="mt-3 min-h-24 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-600 outline-none" placeholder={`${photo.label} notes`} />
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(isPreviewing || activeSection === "Estimate" || activeSection === "Summary") && (
                  <div className="mt-8 grid gap-6 md:grid-cols-2">
                    <div className="rounded-2xl bg-slate-50 p-5">
                      <p className="text-xs font-black uppercase tracking-wider text-slate-500">Prepared for</p>
                      <p className="mt-2 text-lg font-black text-[#07183f]">{editorForm.customerName}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-600">{editorForm.address}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-5">
                      <p className="text-xs font-black uppercase tracking-wider text-slate-500">Proposal summary</p>
                      {isPreviewing ? (
                        <p className="mt-2 text-sm leading-6 text-slate-600">{editorForm.summary}</p>
                      ) : (
                        <textarea value={editorForm.summary} onChange={(event) => setEditorForm({ ...editorForm, summary: event.target.value })} className="mt-2 min-h-24 w-full resize-none border-none bg-transparent p-0 text-sm leading-6 text-slate-600 outline-none" />
                      )}
                    </div>
                  </div>
                )}

                {(isPreviewing || activeSection === "Estimate") && (
                  <div className="mt-8">
                    <p className="text-xs font-black uppercase tracking-wider text-slate-500">Description of Work</p>
                    <div className="mt-4 border-y border-slate-300 py-5">
                      {isPreviewing ? (
                        <>
                          <p className="whitespace-pre-line text-sm leading-7 text-slate-700">{editorForm.scope}</p>
                          <p className="mt-4 whitespace-pre-line text-sm leading-7 text-slate-700">{editorForm.notes}</p>
                        </>
                      ) : (
                        <>
                          <textarea value={editorForm.scope} onChange={(event) => setEditorForm({ ...editorForm, scope: event.target.value })} onPaste={(event) => { event.preventDefault(); setEditorForm({ ...editorForm, scope: formatPastedProposalText(event.clipboardData.getData("text")) }); }} className="min-h-96 w-full resize-y border-none bg-transparent p-0 text-sm leading-7 text-slate-700 outline-none" />
                          <textarea value={editorForm.notes} onChange={(event) => setEditorForm({ ...editorForm, notes: event.target.value })} className="mt-4 min-h-24 w-full resize-none border-none bg-transparent p-0 text-sm leading-7 text-slate-700 outline-none" />
                        </>
                      )}
                    </div>
                    <div className="mt-4 flex justify-between text-sm">
                      <span className="font-bold text-slate-700">Proposal total</span>
                      <span className="font-black text-[#07183f]">${(Number(editorForm.total) || 0).toLocaleString()}</span>
                    </div>
                  </div>
                )}

                {isPreviewing && editorForm.showPackages && (
                  <div className="mt-8">
                    <p className="text-xs font-black uppercase tracking-wider text-slate-500">Package Options</p>
                    <div className="mt-4 grid gap-4 lg:grid-cols-3 print:block print:space-y-6">
                      {(["good", "better", "best"] as const).map((option, optionIndex) => {
                        const packageOption = normalizePackages(editorForm.packages)[option];
                        const selected = (activeProposal.selectedOption || "best") === option;
                        const scopeLines = packageOption.scope.split(/\r?\n|✓|•|·|;/).map((l: string) => l.replace(/^[-*✓\s]+/, "").trim()).filter(Boolean);
                        const isScopeExpanded = previewExpandedScopes[option] ?? false;
                        return (
                          <div key={option} className={`rounded-3xl border p-5 print:break-inside-avoid ${optionIndex > 0 ? "print:break-before-page" : ""} ${selected ? "border-blue-500 bg-blue-50 shadow-lg shadow-blue-100" : "border-slate-200 bg-white"}`}>
                            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">{option}</p>
                            <p className="mt-2 text-xl font-black uppercase text-[#07183f]">{option} Package</p>
                            <p className="mt-2 text-sm font-semibold text-slate-500">Professional roofing option for this project.</p>
                            <div className={`relative mt-5 overflow-hidden print:!max-h-none ${!isScopeExpanded ? "max-h-32" : ""}`}>
                              <ul className="space-y-2">
                                {scopeLines.map((line: string, i: number) => (
                                  <li key={i} className="flex items-start gap-2 text-sm leading-6 text-slate-700">
                                    <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 fill-blue-600" aria-hidden="true"><path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.3 3.3 6.8-6.3a1 1 0 0 1 1.9 0z" /></svg>
                                    <span>{line}</span>
                                  </li>
                                ))}
                              </ul>
                              {!isScopeExpanded && scopeLines.length > 2 && (
                                <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t print:hidden ${selected ? "from-blue-50" : "from-white"} to-transparent`} />
                              )}
                            </div>
                            {scopeLines.length > 2 && (
                              <button type="button" onClick={() => setPreviewExpandedScopes((prev) => ({ ...prev, [option]: !prev[option] }))} className="mt-3 flex items-center gap-1.5 text-sm font-bold text-blue-600 transition hover:text-blue-800 print:hidden">
                                <svg viewBox="0 0 20 20" className={`h-4 w-4 fill-current transition-transform ${isScopeExpanded ? "rotate-180" : ""}`} aria-hidden="true"><path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z" /></svg>
                                {isScopeExpanded ? "Show less" : "See full scope of work"}
                              </button>
                            )}
                            <p className="mt-5 text-2xl font-black text-blue-700">${packageOption.price.toLocaleString()}</p>
                            <button type="button" onClick={() => saveActiveProposal({ selectedOption: option, total: packageOption.price })} className={`mt-4 w-full rounded-2xl px-4 py-3 text-sm font-black print:hidden ${selected ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-blue-50 hover:text-blue-700"}`}>{selected ? "Selected Option" : "Select This Option"}</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {!isPreviewing && editorForm.showPackages && (["GOOD", "BETTER", "BEST"].includes(activeSection)) && (
                  <div className="mt-8">
                    <p className="text-xs font-black uppercase tracking-wider text-slate-500">{activeSection} proposal option</p>
                    <div className="mt-4 rounded-2xl border border-slate-200 p-5">
                      <div className="flex items-center justify-between">
                        <p className="text-2xl font-black text-[#07183f]">{activeSection} Roofing Package</p>
                        {isPreviewing ? (
                          <span className="rounded-full bg-blue-50 px-4 py-2 text-sm font-black text-blue-700">${normalizePackages(editorForm.packages)[activeSection.toLowerCase() as "good" | "better" | "best"].price.toLocaleString()}</span>
                        ) : (
                          <input type="number" value={normalizePackages(editorForm.packages)[activeSection.toLowerCase() as "good" | "better" | "best"].price} onChange={(event) => { const option = activeSection.toLowerCase() as "good" | "better" | "best"; setEditorForm({ ...editorForm, packages: { ...normalizePackages(editorForm.packages), [option]: { ...normalizePackages(editorForm.packages)[option], price: Number(event.target.value) || 0 } } }); }} className="w-32 rounded-full bg-blue-50 px-4 py-2 text-right text-sm font-black text-blue-700 outline-none" />
                        )}
                      </div>
                      {isPreviewing ? (
                        <p className="mt-5 whitespace-pre-line text-sm leading-7 text-slate-700">{normalizePackages(editorForm.packages)[activeSection.toLowerCase() as "good" | "better" | "best"].scope}</p>
                      ) : (
                        <textarea value={normalizePackages(editorForm.packages)[activeSection.toLowerCase() as "good" | "better" | "best"].scope} onChange={(event) => { const option = activeSection.toLowerCase() as "good" | "better" | "best"; setEditorForm({ ...editorForm, packages: { ...normalizePackages(editorForm.packages), [option]: { ...normalizePackages(editorForm.packages)[option], scope: event.target.value } } }); }} className="mt-5 min-h-64 w-full resize-none border-none bg-transparent p-0 text-sm leading-7 text-slate-700 outline-none" />
                      )}
                    </div>
                  </div>
                )}

                {(isPreviewing || activeSection === "Estimate" || activeSection === "Summary") && (
                  <div className="mt-8 rounded-3xl border border-blue-100 bg-blue-50 p-6">
                    <p className="text-xs font-black uppercase tracking-wider text-blue-700">Total Summary</p>
                    <div className="mt-3 flex flex-col justify-between gap-4 md:flex-row md:items-end">
                      <div>
                        {editorForm.showPackages && <p className="text-sm font-bold text-slate-600">Selected Package</p>}
                        {editorForm.showPackages && <p className="mt-1 text-xl font-black uppercase text-[#07183f]">{activeProposal.selectedOption || "best"}</p>}
                        {editorForm.notes && <p className="mt-3 max-w-xl whitespace-pre-line text-sm leading-6 text-slate-600">{editorForm.notes}</p>}
                      </div>
                      <div className="text-left md:text-right">
                        <p className="text-sm font-bold text-slate-600">Total Price</p>
                        <p className="mt-1 text-4xl font-black text-blue-700">${(Number(editorForm.total) || 0).toLocaleString()}</p>
                      </div>
                    </div>
                  </div>
                )}

                {(isPreviewing || activeSection === "Terms and Conditions") && (
                  <div className="mt-8 rounded-3xl border border-slate-200 bg-slate-50 p-6">
                    <p className="text-2xl font-black text-[#07183f]">Terms and Conditions</p>
                    {isPreviewing ? (
                      <div className="mt-5 max-h-[28rem] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-7 text-slate-700">
                        {editorForm.terms.split("\n\n").map((section, index) => (
                          <p key={index} className="mb-4 whitespace-pre-line">{section}</p>
                        ))}
                      </div>
                    ) : (
                      <textarea value={editorForm.terms} onChange={(event) => setEditorForm({ ...editorForm, terms: event.target.value })} className="mt-3 min-h-32 w-full resize-none border-none bg-transparent p-0 text-sm leading-7 text-slate-600 outline-none" />
                    )}
                  </div>
                )}

                {(isPreviewing || activeSection === "Estimate" || activeSection === "Summary") && (
                  <div className="mt-8 rounded-3xl border border-slate-200 p-6">
                    <label className="hidden print:hidden">
                      <input type="checkbox" checked={agreementAccepted} onChange={(event) => setAgreementAccepted(event.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-300" />
                      <span>I agree to the Terms and Conditions</span>
                    </label>
                    <p className="hidden text-sm font-bold text-slate-700 print:block">By signing below, I agree to the Terms and Conditions outlined above.</p>
                    <div className="mt-6 grid gap-4 md:grid-cols-[1fr_180px]">
                      <label className="block text-xs font-black uppercase tracking-wider text-slate-500">
                        Client Signature
                        <input value={typedSignature} onChange={(event) => setTypedSignature(event.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-5 text-2xl font-semibold italic outline-none print:rounded-none print:border-0 print:border-b-2 print:border-slate-400 print:py-8" placeholder="Type full legal name" />
                      </label>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs font-black uppercase tracking-wider text-slate-500">Date</p>
                        <p className="mt-3 font-black text-[#07183f]">{activeProposal.signedAt ? new Date(activeProposal.signedAt).toLocaleDateString() : new Date().toLocaleDateString()}</p>
                      </div>
                    </div>
                    <button type="button" disabled={!agreementAccepted || !typedSignature.trim()} onClick={handleAcceptProposal} className="hidden print:hidden">Accept & Sign Proposal</button>
                  </div>
                )}

                <div className="mt-12 flex items-end justify-between border-t border-slate-300 pt-4">
                  <div className="text-xs text-slate-500">
                    <p className="font-black text-slate-700">XRP Roofing</p>
                    <p>ROC #350898</p>
                    <p>info@xrproofing.com</p>
                  </div>
                  <div className="text-right text-xl font-black text-[#07183f]">XRP<br /><span className="text-xs tracking-[0.25em]">ROOFING</span></div>
                </div>
              </div>
            </div>
          </main>
        </div>
        {showOfflineSignModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50">
            <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-black text-slate-900">Mark as Signed Offline</h2>
                <button type="button" onClick={() => setShowOfflineSignModal(false)} className="text-2xl text-slate-400 hover:text-slate-600">&times;</button>
              </div>
              <p className="mt-3 text-sm text-slate-600">Record that this proposal was signed in person. The proposal will be locked and marked as accepted.</p>
              <label className="mt-5 block text-xs font-black uppercase tracking-wider text-slate-500">
                Signed by (customer name)
                <input value={offlineSignerName} onChange={(event) => setOfflineSignerName(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-[#07183f] outline-none focus:border-blue-500" placeholder="Customer full name" />
              </label>
              <div className="mt-6 flex items-center gap-3">
                <button type="button" onClick={() => setShowOfflineSignModal(false)} className="flex-1 rounded-xl border border-slate-200 px-5 py-3 text-sm font-black text-slate-600">Cancel</button>
                <button type="button" onClick={handleMarkSignedOffline} className="flex-1 rounded-xl bg-amber-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-amber-100 hover:bg-amber-600">Confirm Signed Offline</button>
              </div>
              <p className="mt-4 text-xs text-slate-500">After confirming, you can upload a photo or PDF of the signed document using the &ldquo;Upload Signed Proposal&rdquo; button.</p>
            </div>
          </div>
        )}
        {showSendModal && (
          <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50">
            <div className="flex h-full w-full max-w-[530px] flex-col bg-white shadow-2xl">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-7 py-5 shadow-sm">
                <div className="flex items-center gap-3 text-xl font-black text-slate-900">
                  <span className="text-blue-600">✉</span>
                  <span>Send proposal</span>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setIsPreviewing(true)} className="hidden rounded-full border border-blue-600 px-4 py-2 text-xs font-black text-blue-600 sm:inline-flex">↗ Preview</button>
                  <button type="button" onClick={handleSendProposal} className="rounded-full bg-blue-600 px-4 py-2 text-xs font-black text-white shadow-lg shadow-blue-100">✈ Send</button>
                  <button type="button" onClick={() => setShowSendModal(false)} className="text-2xl text-slate-500">×</button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                <div className="bg-slate-50 px-7 py-6">
                  <div className="grid grid-cols-[44px_1fr] gap-4">
                    <p className="pt-3 text-sm font-black text-slate-900">To:</p>
                    <div className="rounded-lg border border-slate-200 bg-white p-4">
                      <input value={sendForm.toName} onChange={(event) => setSendForm({ ...sendForm, toName: event.target.value })} className="w-full border-none text-sm font-black text-slate-900 outline-none" />
                      <div className="mt-3 flex items-center justify-between gap-3 text-sm text-slate-600">
                        <span>Customer</span>
                        <input value={sendForm.toEmail} onChange={(event) => setSendForm({ ...sendForm, toEmail: event.target.value })} className="max-w-[230px] border-none text-right text-sm text-slate-600 outline-none" />
                      </div>
                    </div>
                  </div>
                  <label className="ml-[60px] mt-3 block text-sm font-bold text-blue-600">
                    Add Cc recipients...
                    <input value={sendForm.ccRecipients} onChange={(event) => setSendForm({ ...sendForm, ccRecipients: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-700 outline-none" placeholder="email@example.com, another@example.com" />
                  </label>
                </div>
                <div className="space-y-5 px-7 py-6">
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-black text-slate-900">Template</p>
                      <button type="button" onClick={() => setActiveTab("templates")} className="text-xs font-black text-blue-600">⊞ Select template</button>
                    </div>
                    <input value={sendForm.templateName} onChange={(event) => setSendForm({ ...sendForm, templateName: event.target.value })} className="w-full rounded border border-slate-200 px-4 py-3 text-sm font-bold outline-none" />
                  </div>
                  <label className="block text-sm font-black text-slate-900">
                    Subject*
                    <input required value={sendForm.subject} onChange={(event) => setSendForm({ ...sendForm, subject: event.target.value })} className="mt-3 w-full rounded border border-slate-200 px-4 py-3 text-sm font-normal outline-none" />
                  </label>
                  <label className="block text-sm font-black text-slate-900">
                    Message*
                    <div className="mt-3 flex items-center gap-6 border border-slate-200 px-4 py-3 text-sm font-bold text-slate-800">
                      <span>B</span>
                      <span className="italic">I</span>
                      <span className="underline">U</span>
                      <span>🔗</span>
                      <span>Dynamic fields⌄</span>
                      <span>Attach</span>
                    </div>
                    <textarea required value={sendForm.message} onChange={(event) => setSendForm({ ...sendForm, message: event.target.value })} className="min-h-56 w-full border-x border-b border-slate-200 px-5 py-4 text-sm font-normal leading-7 outline-none" />
                  </label>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="rounded-t-xl bg-slate-200 py-5 text-center">
                      <Image src="/images/logo.jpeg" alt="XRP Roofing" width={112} height={60} className="mx-auto h-auto bg-white" />
                    </div>
                    <div className="rounded-b-xl bg-white p-5 text-sm leading-7 text-slate-700">
                      <p className="whitespace-pre-line">{sendForm.message}</p>
                      <div className="mt-5 rounded-xl border border-slate-200 p-4 text-center">
                        <Image src={editorForm.coverPhoto || "/images/logo.jpeg"} alt="Proposal cover" width={180} height={100} className="mx-auto max-h-28 w-auto object-contain" />
                        <p className="mt-3 font-black text-[#07183f]">{editorForm.title}</p>
                        <p className="mt-2 whitespace-pre-line text-xs leading-5 text-slate-600">{editorForm.coverText}</p>
                      </div>
                      <div className="mt-5 text-center">
                        <span className="inline-block rounded-full bg-blue-600 px-5 py-2 text-sm font-black text-white">View Proposal</span>
                      </div>
                    </div>
                  </div>
                  {sendNotice && <p className="whitespace-pre-line rounded-xl bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{sendNotice}</p>}
                </div>
              </div>
              <div className="sticky bottom-0 z-10 flex items-center justify-between border-t border-slate-200 bg-white px-7 py-4 shadow-[0_-12px_30px_rgba(15,23,42,0.08)]">
                <button type="button" onClick={() => setShowSendModal(false)} className="text-sm font-black text-blue-600">Cancel</button>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setIsPreviewing(true)} className="rounded-full border border-blue-600 px-6 py-3 text-sm font-black text-blue-600">↗ Preview</button>
                  <button type="button" onClick={handleSendProposal} className="rounded-full bg-blue-600 px-6 py-3 text-sm font-black text-white">✈ Send proposal</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5 font-sans">
      <BackToJobsLink />
      <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#07183f] via-[#0f2156] to-[#1d4ed8] p-6 text-white shadow-2xl shadow-blue-950/20">
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-orange-400/20 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-300">Proposal Center</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">Proposals</h1>
            <p className="crm-board-subtitle mt-2 max-w-2xl text-sm font-medium leading-6 text-blue-100">Create, send, track, and manage branded XRP Roofing proposals from one workspace.</p>
          </div>
          <button type="button" onClick={() => setShowCreateForm((current) => !current)} className="w-fit rounded-2xl bg-orange-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-orange-950/30 hover:bg-orange-600">⊕ Proposal</button>
        </div>
      </div>

      <div className="rounded-3xl border border-white/70 bg-white/95 px-5 pt-4 shadow-lg shadow-blue-950/5">
        <div className="flex gap-8 text-sm font-black">
          <button type="button" onClick={() => { setActiveTab("proposals"); setProposalFilter("all"); }} className={`px-1 pb-4 ${activeTab === "proposals" ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-600"}`}>Proposals</button>
          <button type="button" onClick={() => { setActiveTab("drafts"); setProposalFilter("drafts"); }} className={`px-1 pb-4 ${activeTab === "drafts" ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-600"}`}>Drafts</button>
          <button type="button" onClick={() => setActiveTab("templates")} className={`px-1 pb-4 ${activeTab === "templates" ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-600"}`}>Templates</button>
          <button type="button" onClick={() => setActiveTab("settings")} className={`px-1 pb-4 ${activeTab === "settings" ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-600"}`}>Settings</button>
        </div>
      </div>

      <div className="rounded-3xl border border-white/70 bg-white/95 p-4 shadow-lg shadow-blue-950/5">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row">
            <div className="relative max-w-md flex-1">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">⌕</span>
              <input value={proposalSearch} onChange={(event) => setProposalSearch(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none focus:border-blue-500 focus:bg-white" placeholder="Search for a customer or address..." />
            </div>
            <button className="w-fit rounded-full bg-slate-50 px-5 py-3 text-sm font-black text-blue-600">▽ Filter</button>
          </div>
          <div className="flex overflow-hidden rounded-lg border border-slate-200">
            <button className="bg-blue-50 px-4 py-3 text-xl text-blue-700 ring-1 ring-blue-500">▦</button>
            <button className="px-4 py-3 text-xl text-slate-500">☰</button>
          </div>
        </div>
      </div>

      {deletedProposal && (
        <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
          <span>Deleted proposal for {deletedProposal.customerName}.</span>
          <button type="button" onClick={handleUndoDelete} className="rounded-full bg-white px-4 py-2 text-blue-700 shadow-sm">Undo</button>
        </div>
      )}

      {activeTab === "templates" && (
        <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
          <form onSubmit={handleCreateTemplate} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-black text-[#07183f]">Create proposal template</h2>
            <div className="mt-4 space-y-3">
              <input required value={templateForm.label} onChange={(event) => setTemplateForm({ ...templateForm, label: event.target.value })} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none" placeholder="Template name" />
              <input value={templateForm.description} onChange={(event) => setTemplateForm({ ...templateForm, description: event.target.value })} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none" placeholder="Short description" />
              <input required value={templateForm.title} onChange={(event) => setTemplateForm({ ...templateForm, title: event.target.value })} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none" placeholder="Proposal title" />
              <textarea value={templateForm.summary} onChange={(event) => setTemplateForm({ ...templateForm, summary: event.target.value })} className="min-h-28 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none" placeholder="Proposal summary" />
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-black uppercase tracking-wider text-slate-500">Template package options</p>
                {(["good", "better", "best"] as const).map((option) => (
                  <div key={option} className="rounded-xl bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-black uppercase text-[#07183f]">{option}</p>
                      <input type="number" value={normalizePackages(templateForm.packages)[option].price} onChange={(event) => setTemplateForm({ ...templateForm, packages: { ...normalizePackages(templateForm.packages), [option]: { ...normalizePackages(templateForm.packages)[option], price: Number(event.target.value) || 0 } } })} className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-right text-xs font-black text-blue-700 outline-none" placeholder="Price" />
                    </div>
                    <textarea value={normalizePackages(templateForm.packages)[option].scope} onChange={(event) => setTemplateForm({ ...templateForm, packages: { ...normalizePackages(templateForm.packages), [option]: { ...normalizePackages(templateForm.packages)[option], scope: event.target.value } } })} className="mt-2 min-h-20 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs leading-5 text-slate-600 outline-none" placeholder={`${option.toUpperCase()} included services`} />
                  </div>
                ))}
              </div>
              <textarea value={templateForm.terms} onChange={(event) => setTemplateForm({ ...templateForm, terms: event.target.value })} className="min-h-36 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none" placeholder="Default terms and conditions" />
              <button className="w-full rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white">Save template</button>
            </div>
          </form>
          <div className="grid gap-3">
            {templates.map((template) => (
              <div key={template.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <input value={template.label} onChange={(event) => handleUpdateTemplate({ ...template, label: event.target.value })} className="w-full border-none bg-transparent text-lg font-black text-[#07183f] outline-none" />
                    <input value={template.description} onChange={(event) => handleUpdateTemplate({ ...template, description: event.target.value })} className="mt-1 w-full border-none bg-transparent text-sm text-slate-500 outline-none" />
                  </div>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">Saved</span>
                </div>
                <label className="mt-4 block text-xs font-black uppercase tracking-wider text-slate-500">
                  Proposal title
                  <input value={template.title} onChange={(event) => handleUpdateTemplate({ ...template, title: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm normal-case tracking-normal text-slate-800 outline-none" />
                </label>
                <label className="mt-3 block text-xs font-black uppercase tracking-wider text-slate-500">
                  Proposal summary
                  <textarea value={template.summary} onChange={(event) => handleUpdateTemplate({ ...template, summary: event.target.value })} className="mt-2 min-h-24 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm normal-case leading-6 tracking-normal text-slate-600 outline-none" />
                </label>
                <label className="mt-3 block text-xs font-black uppercase tracking-wider text-slate-500">
                  Terms and Conditions
                  <textarea value={template.terms} onChange={(event) => handleUpdateTemplate({ ...template, terms: event.target.value })} className="mt-2 min-h-32 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm normal-case leading-6 tracking-normal text-slate-600 outline-none" />
                </label>
                <div className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-black uppercase tracking-wider text-slate-500">GOOD / BETTER / BEST packages</p>
                  {(["good", "better", "best"] as const).map((option) => {
                    const templatePackages = normalizePackages(template.packages);
                    return (
                      <div key={option} className="rounded-xl bg-white p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-black uppercase text-[#07183f]">{option}</p>
                          <input type="number" value={templatePackages[option].price} onChange={(event) => handleUpdateTemplate({ ...template, packages: { ...templatePackages, [option]: { ...templatePackages[option], price: Number(event.target.value) || 0 } } })} className="w-32 rounded-xl border border-slate-200 px-3 py-2 text-right text-sm font-black text-blue-700 outline-none" />
                        </div>
                        <textarea value={templatePackages[option].scope} onChange={(event) => handleUpdateTemplate({ ...template, packages: { ...templatePackages, [option]: { ...templatePackages[option], scope: event.target.value } } })} className="mt-2 min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm leading-6 text-slate-600 outline-none" />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "settings" && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-600">Settings</p>
                <h2 className="mt-2 text-2xl font-black text-[#07183f]">Proposal trash bin</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Deleted proposals are hidden from the proposal board and drafts. They stay here for {trashRetentionDays} days before they are removed completely.</p>
              </div>
              <button type="button" onClick={handleEmptyExpiredTrash} className="w-fit rounded-full border border-slate-200 bg-slate-50 px-5 py-3 text-sm font-black text-slate-700 hover:bg-white">Clear expired trash</button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            {trashedProposals.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 p-8 text-center">
                <p className="text-lg font-black text-[#07183f]">Trash bin is empty</p>
                <p className="mt-2 text-sm text-slate-500">Deleted proposals will appear here for {trashRetentionDays} days.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {trashedProposals.map((proposal) => {
                  const deletedAt = proposal.deletedAt ? new Date(proposal.deletedAt) : new Date();
                  const daysUsed = Math.max(0, Math.floor((Date.now() - deletedAt.getTime()) / (24 * 60 * 60 * 1000)));
                  const daysLeft = Math.max(0, trashRetentionDays - daysUsed);

                  return (
                    <div key={proposal.id} className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:flex-row md:items-center">
                      <div>
                        <p className="text-base font-black text-[#07183f]">{proposal.customerName}</p>
                        <p className="mt-1 text-sm text-slate-600">{proposal.address}</p>
                        <p className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-500">Deleted {deletedAt.toLocaleDateString()} · Permanently deletes in {daysLeft} days</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => handleRestoreProposal(proposal)} className="rounded-full bg-blue-600 px-4 py-2 text-sm font-black text-white">Restore</button>
                        <button type="button" onClick={() => handlePermanentDeleteProposal(proposal)} className="rounded-full bg-red-50 px-4 py-2 text-sm font-black text-red-700">Delete forever</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab !== "templates" && activeTab !== "settings" && showCreateForm && (
      <form onSubmit={handleCreateProposal} className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setProposalMode("job")} className={`rounded-2xl px-4 py-2 text-sm font-black ${proposalMode === "job" ? "bg-[#07183f] text-white" : "bg-slate-100 text-slate-700"}`}>From selected job</button>
          <button type="button" onClick={() => setProposalMode("new")} className={`rounded-2xl px-4 py-2 text-sm font-black ${proposalMode === "new" ? "bg-[#07183f] text-white" : "bg-slate-100 text-slate-700"}`}>New proposal</button>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr_auto] lg:items-end">
          {proposalMode === "job" ? (
            <label className="grid gap-2 text-sm font-bold text-slate-700">
              Search job by name or address
              <input value={jobSearch} onChange={(event) => setJobSearch(event.target.value)} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Enter address, customer name, roof type..." />
            </label>
          ) : (
            <>
              <label className="grid gap-2 text-sm font-bold text-slate-700">
                Customer name
                <input required value={customerName} onChange={(event) => setCustomerName(event.target.value)} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Customer name" />
              </label>
              <label className="grid gap-2 text-sm font-bold text-slate-700">
                Searchable address
                <AddressAutocomplete
                  value={address}
                  onChange={(addr) => setAddress(addr)}
                  placeholder="Start typing address..."
                  required
                />
              </label>
            </>
          )}
          <label className="grid gap-2 text-sm font-bold text-slate-700">
            Proposal scope
            <input value={scope} onChange={(event) => setScope(event.target.value)} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Roof repair, replacement, coating..." />
          </label>
          {proposalMode === "new" && (
            <label className="grid gap-2 text-sm font-bold text-slate-700">
              Proposal total
              <input type="number" value={total} onChange={(event) => setTotal(event.target.value)} className="rounded-2xl border border-slate-200 px-4 py-3 outline-none" placeholder="Amount" />
            </label>
          )}
          <button className="rounded-2xl bg-orange-500 px-5 py-3 font-bold text-white shadow-lg shadow-orange-200">Create proposal</button>
        </div>
        {proposalMode === "job" && (
          <div className="mt-4 grid gap-2 pb-20 md:grid-cols-2 lg:pb-0 xl:grid-cols-3">
            {filteredJobs.map((job) => (
              <button key={job.id} type="button" onClick={() => setSelectedJobId(job.id)} className={`rounded-2xl p-4 text-left text-sm ${selectedJobId === job.id ? "bg-orange-50 ring-2 ring-orange-400" : "bg-slate-50"}`}>
                <span className="block font-black text-[#07183f]">{job.name}</span>
                <span className="mt-1 block text-slate-500">{job.address}, {job.city}</span>
                <span className="mt-2 block font-bold text-orange-700">${job.value.toLocaleString()}</span>
              </button>
            ))}
            {filteredJobs.length === 0 && (
              <p className="col-span-full py-6 text-center text-sm font-semibold text-slate-400">No jobs found. Add jobs in the Leads board first.</p>
            )}
          </div>
        )}
        {proposalMode === "job" && selectedJob && (
          <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
            <span className="font-black text-[#07183f]">{selectedJob.name}</span> · {selectedJob.address}, {selectedJob.city} · {selectedJob.assignedTo}
          </div>
        )}
      </form>
      )}

      {activeTab !== "templates" && activeTab !== "settings" && (
      <div className="space-y-3 overflow-y-auto pb-20 pr-2 lg:max-h-[calc(100vh-18rem)] lg:pb-0">
        {filteredProposals.map((proposal) => (
          <div key={proposal.id} className="grid w-full grid-cols-1 items-center gap-4 rounded-3xl border border-white/70 bg-white/95 p-4 text-left shadow-lg shadow-blue-950/5 transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-xl md:grid-cols-[1fr_auto]">
            <button type="button" onClick={() => openProposal(proposal)} className="flex items-center gap-4 text-left">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-white text-sm font-black leading-4 text-[#07183f] shadow-sm">XRP<br />ROOF</div>
              <div>
                <p className="font-black text-[#07183f]">{proposal.address}</p>
                <p className="mt-1 text-sm text-slate-500">{proposal.customerName} <span className="mx-2">•</span> Assigned to Jonathan Gonzalez</p>
                <p className="mt-1 text-xs text-slate-500">{proposal.status === "Draft" ? "Created" : proposal.status === "Sent" ? "Sent" : proposal.status === "Won" || proposal.status === "Signed" || proposal.status === "Signed Offline" ? `Signed by ${proposal.signedBy || proposal.customerName}` : "Viewed"} {proposal.status === "Won" || proposal.status === "Signed" || proposal.status === "Signed Offline" ? "" : "by Jonathan Gonzalez"} <span className="mx-1">•</span> {proposal.signedAt ? new Date(proposal.signedAt).toLocaleString() : "Today"}⌄</p>
              </div>
            </div>
            </button>
            <div className="flex items-center justify-end gap-3">
              <div className="text-right">
                <p className="font-black text-slate-600">${(isProposalLocked(proposal) ? (proposal.acceptedPrice ?? proposal.total) : proposal.total).toLocaleString()}</p>
                <p className="mt-1 text-xs font-bold uppercase text-slate-500">{proposal.acceptedPackageName || proposal.acceptedPackage || proposal.selectedOption || "BEST"}</p>
              </div>
              <span className={`rounded-full px-4 py-1 text-sm font-black ${proposal.status === "Draft" ? "bg-slate-500 text-white" : proposal.status === "Sent" ? "bg-sky-500 text-white" : proposal.status === "Won" || proposal.status === "Signed" || proposal.status === "Signed Offline" ? "bg-emerald-500 text-white" : "bg-yellow-400 text-slate-900"}`}>{proposal.status === "Approved" ? "Viewed" : proposal.status}</span>
              <button type="button" onClick={(e) => { e.stopPropagation(); if (window.confirm(`Permanently delete proposal for ${proposal.customerName}? This cannot be undone.`)) { handlePermanentDeleteProposal(proposal); } }} className="rounded-full bg-red-600 px-3 py-1 text-xs font-black text-white">Delete</button>
              <span className="text-xl font-black text-slate-500">⋯</span>
            </div>
          </div>
        ))}
        {filteredProposals.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center font-semibold text-slate-500">No proposals match your search.</div>
        )}
      </div>
      )}
    </div>
  );
}

