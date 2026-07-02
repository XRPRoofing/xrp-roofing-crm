"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import BackToJobsLink from "@/components/crm/BackToJobsLink";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { subscribeToCrewData, leadToJobRecord, upsertJobRecord, updateJobRecord } from "@/lib/crew-sync";
import { logCrewActivity } from "@/lib/crew-activity";
import { azDateTime, azDate, azTime } from "@/lib/arizona-time";
import { useSaveToast } from "@/components/crm/SaveToast";
import { handlePhoneChange } from "@/lib/format-phone";
import { createManualFolder } from "@/lib/manual-folders";
import { deleteProposalRecord, loadProposalRecords, loadTemplateRecords, proposalSyncEnabled, saveTemplateRecords, subscribeToProposalRecords, upsertProposalRecord } from "@/lib/proposal-sync";
import { isProposalLocked } from "@/lib/proposal-lock";
import { findOrCreateCustomer } from "@/lib/customer-sync";
import { payloadToLead, takeEstimateIntent } from "@/lib/crm-board-nav";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { getCachedCrewData, getCachedProposals, refreshCrewData, refreshProposals, CACHE_EVENTS } from "@/lib/data-cache";
import { createClient } from "@/lib/supabase/client";
import { sendSms } from "@/lib/twilio/client";
import { getTwilioLines, type TwilioLine } from "@/lib/twilio/numbers";
import type { Lead } from "@/types/crm";
import { getNextUnifiedNumber, ensureCounterAtLeast, parseUnifiedNumber } from "@/lib/unified-numbering";
import { AiWriteButton } from "@/components/crm/AiWritingAssistant";

type Proposal = {
  id: string;
  proposalNumber?: string;
  job?: Lead;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  address: string;
  scope: string;
  total: number;
  status: "Draft" | "Sent" | "Viewed" | "Signed" | "Won" | "Approved" | "Signed Offline" | "Declined";
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
  sentAt?: string;
  sentBy?: string;
  signedAt?: string;
  signedBy?: string;
  signatureData?: string;
  signatureDataUrl?: string;
  printedName?: string;
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
  brochures?: BrochureFile[];
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  sentViaSms?: boolean;
  smsSentAt?: string;
  smsSentBy?: string;
  smsSentFrom?: string;
  smsSentToPhone?: string;
  viewedAt?: string;
  viewCount?: number;
  firstViewedAt?: string;
  lastViewedAt?: string;
  followUpSentAt?: string;
  followUpSmsSentAt?: string;
  followUpSentVia?: string;
  followUpStepCompleted?: number;
  followUpStepSentAt?: string[];
  declinedAt?: string;
  depositType?: "percentage" | "fixed";
  depositValue?: number;
  depositDueDate?: string;
  depositAddToFuture?: boolean;
  depositPaidAt?: string;
  depositPaidAmount?: number;
  depositPaymentMethod?: string;
  depositStripeSessionId?: string;
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

type BrochureFile = {
  name: string;
  dataUrl: string;
  type: string;
};

type ProposalEmailTemplate = {
  id: string;
  label: string;
  subject: string;
  message: string;
};

type ProposalTemplate = {
  id: string;
  label: string;
  description: string;
  title: string;
  summary: string;
  terms: string;
  packages?: Proposal["packages"];
  brochureEnabled?: boolean;
  brochures?: BrochureFile[];
};

const proposalSections = ["Cover", "Inspection Photos", "Estimate", "BEST", "BETTER", "GOOD", "Summary", "Terms and Conditions"];
const emailTemplatesLocalKey = "xrp-crm-proposal-email-templates";

const defaultEmailTemplates: ProposalEmailTemplate[] = [
  {
    id: "personalized",
    label: "Personalized Proposal Email",
    subject: "Proposal for {{customer_name}}",
    message: "Dear {{customer_name}},\n\nPlease follow the link to review and accept your customized proposal.\nThank you for your time and consideration.\n\nJonathan Gonzalez",
  },
  {
    id: "formal",
    label: "Formal Proposal",
    subject: "XRP Roofing — Proposal for {{customer_name}}",
    message: "Dear {{customer_name}},\n\nThank you for the opportunity to provide a roofing proposal for your property. Please use the link below to review the detailed scope of work, pricing options, and terms.\n\nIf you have any questions, please do not hesitate to reach out.\n\nBest regards,\nXRP Roofing Team",
  },
  {
    id: "follow-up",
    label: "Follow-Up",
    subject: "Following up — Proposal for {{customer_name}}",
    message: "Hi {{customer_name}},\n\nI wanted to follow up on the proposal we sent earlier. Please review it at your convenience using the link below.\n\nWe are happy to answer any questions or make adjustments.\n\nThank you,\nJonathan Gonzalez",
  },
];
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
    brochureEnabled: false,
    brochures: [],
  },
  {
    id: "insurance",
    label: "Insurance Claim",
    description: "Detailed format for carrier and adjuster review.",
    title: "INSURANCE ROOFING PROPOSAL",
    summary: "Prepared for insurance documentation, carrier review, and roofing claim support.",
    terms: defaultTerms,
    packages: defaultPackages,
    brochureEnabled: false,
    brochures: [],
  },
  {
    id: "premium",
    label: "Premium Package",
    description: "Polished customer-facing proposal with value highlights.",
    title: "PREMIUM ROOFING PROPOSAL",
    summary: "A premium customer-ready roofing package with clear scope, value, and next steps.",
    terms: defaultTerms,
    packages: defaultPackages,
    brochureEnabled: false,
    brochures: [],
  },
  {
    id: "gaf-timberline",
    label: "GAF Timberline",
    description: "GAF Timberline shingle options from Natural Shadow to UHDZ.",
    title: "GAF TIMBERLINE ROOFING PROPOSAL",
    summary: "A professional roofing proposal featuring GAF Timberline shingle systems — America's #1 selling shingle brand.",
    terms: defaultTerms,
    packages: {
      good: {
        scope: "GOOD option: Essential roofing repair package with necessary labor, standard materials, clean GAF TIMBERLINE® NATURAL SHADOW® ROOFING SYSTEM",
        price: 0,
      },
      better: {
        scope: "BETTER OPTION – GAF TIMBERLINE® HDZ® ROOFING SYSTEM\n\nProject Description\n\nA premium architectural roofing system featuring GAF's LayerLock® Technology for superior wind resistance, enhanced curb appeal, and long-lasting performance. This system offers a strong balance of beauty, durability, and value — backed by one of the best warranties in the industry.",
        price: 0,
      },
      best: {
        scope: "GAF TIMBERLINE® UHDZ® ROOFING SYSTEM\n\nProject Description\n\nGAF's premium architectural shingle system designed for homeowners who want the ultimate combination of beauty, strength, and protection. Features the thickest, most dimensional Timberline profile with advanced LayerLock® Technology and industry-leading wind warranty coverage.",
        price: 0,
      },
    },
    brochureEnabled: true,
    brochures: [],
  },
];

export default function ProposalsPage() {
  const { showSaveToast, SaveToastUI } = useSaveToast();
  const [currentUserName, setCurrentUserName] = useState("CRM User");
  const [currentUserEmail, setCurrentUserEmail] = useState("");

  // Resolve the logged-in user's display name and email for proposal tracking
  useEffect(() => {
    createClient().auth.getSession().then(({ data }) => {
      if (!data.session) return;
      const meta = data.session.user.user_metadata;
      const name = (meta?.full_name || meta?.name || data.session.user.email?.split("@")[0] || "CRM User") as string;
      setCurrentUserName(name);
      setCurrentUserEmail(data.session.user.email || "");
    }).catch(() => {});
  }, []);

  const [proposalMode, setProposalMode] = useState<"job" | "new">("job");
  const [jobs, setJobs] = useState<Lead[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const prevProposalsRef = useRef<Proposal[]>([]);
  const permanentlyDeletedIdsRef = useRef<Set<string>>(new Set());
  const locallyDeletedIdsRef = useRef<Set<string>>(new Set());
  const boardIntentHandledRef = useRef(false);
  const [templates, setTemplates] = useState<ProposalTemplate[]>(initialProposalTemplates);
  const [emailTemplates, setEmailTemplates] = useState<ProposalEmailTemplate[]>(defaultEmailTemplates);
  const [editorBrochures, setEditorBrochures] = useState<BrochureFile[]>([]);
  const [activeTab, setActiveTab] = useState<"proposals" | "drafts" | "templates" | "trash" | "settings">("proposals");
  const [confirmPermanentDelete, setConfirmPermanentDelete] = useState<Proposal | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [jobSearch, setJobSearch] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [address, setAddress] = useState("");
  const [scope, setScope] = useState("");
  const [total, setTotal] = useState("");
  const [proposalSearch, setProposalSearch] = useState("");
  const [proposalFilter, setProposalFilter] = useState<"all" | "drafts">("all");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [activeProposal, setActiveProposal] = useState<Proposal | null>(null);
  const proposalCardHashRef = useRef(false);
  const proposalSearchParams = useSearchParams();

  const closeProposalCard = useCallback(() => {
    setActiveProposal(null);
    proposalCardHashRef.current = false;
    const url = new URL(window.location.href);
    url.searchParams.delete("proposal");
    url.hash = "";
    history.replaceState(history.state, "", url.pathname + url.search);
  }, []);

  useEffect(() => {
    function handleHashChange() {
      if (proposalCardHashRef.current && !window.location.hash.includes("card")) {
        closeProposalCard();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeProposalCard();
    }
    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeProposalCard]);
  const [deletedProposal, setDeletedProposal] = useState<Proposal | null>(null);
  const [showPermDeleteConfirm, setShowPermDeleteConfirm] = useState(false);
  const [permDeleteTarget, setPermDeleteTarget] = useState<Proposal | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [activeSection, setActiveSection] = useState("Estimate");
  const [showSendModal, setShowSendModal] = useState(false);
  const [showOfflineSignModal, setShowOfflineSignModal] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [offlineSignerName, setOfflineSignerName] = useState("");
  const [offlineSignMode, setOfflineSignMode] = useState<"draw" | "type">("draw");
  const [offlineTypedSig, setOfflineTypedSig] = useState("");
  const offlineSigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const offlineSigDrawingRef = useRef(false);
  const offlineSigHasDrawnRef = useRef(false);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [typedSignature, setTypedSignature] = useState("");
  const [showResetSignatureConfirm, setShowResetSignatureConfirm] = useState(false);
  const [sendForm, setSendForm] = useState({
    toName: "",
    toEmail: "info@xrproofing.com",
    ccRecipients: "",
    emailTemplateId: "personalized",
    subject: "",
    message: "",
  });
  const [sendNotice, setSendNotice] = useState("");
  const [sendConfirmation, setSendConfirmation] = useState<{ type: "success" | "error"; customerName: string; proposalNumber: string; message: string } | null>(null);
  const [sendingProposal, setSendingProposal] = useState(false);

  // SMS send state
  const [showSmsSendModal, setShowSmsSendModal] = useState(false);
  const [smsForm, setSmsForm] = useState({ toPhone: "", message: "", fromNumber: "" });
  const [twilioLines] = useState<TwilioLine[]>(() => getTwilioLines());
  const [sendingSms, setSendingSms] = useState(false);

  // Follow-up automation settings
  const [followUpEnabled, setFollowUpEnabled] = useState(true);
  const [followUpSmsEnabled, setFollowUpSmsEnabled] = useState(false);
  type FollowUpStepState = { delayHours: number; emailSubject: string; emailTemplate: string; smsTemplate: string };
  const defaultSteps: FollowUpStepState[] = [
    { delayHours: 24, emailSubject: "Following up — Your Roofing Proposal", emailTemplate: "Hi {customerName},\n\nWe just wanted to follow up regarding the roofing proposal we sent you. Please let us know if you have any questions. We are happy to help.\n\nThank you,\nXRP Roofing Team", smsTemplate: "Hi {customerName}, just following up on your roofing proposal. Let us know if you have any questions — we're happy to help! View your proposal here: {proposalLink} — XRP Roofing" },
    { delayHours: 72, emailSubject: "Quick reminder — Your Roofing Proposal", emailTemplate: "Hi {customerName},\n\nJust a friendly reminder about the roofing proposal we sent. We'd love to help get your project started. If you have any questions or need changes, feel free to reach out anytime.\n\nBest regards,\nXRP Roofing Team", smsTemplate: "Hi {customerName}, just a reminder about your roofing proposal. We'd love to help — let us know if you have any questions! {proposalLink} — XRP Roofing" },
    { delayHours: 168, emailSubject: "Final follow-up — Your Roofing Proposal", emailTemplate: "Hi {customerName},\n\nThis is our final follow-up regarding the roofing proposal we sent you. We understand timing is important, so we'll leave the ball in your court. Your proposal link remains active whenever you're ready to move forward.\n\nThank you for considering XRP Roofing.\n\nBest regards,\nXRP Roofing Team", smsTemplate: "Hi {customerName}, this is our final follow-up on your roofing proposal. Your proposal remains available whenever you're ready: {proposalLink} — XRP Roofing" },
  ];
  const [followUpSteps, setFollowUpSteps] = useState<FollowUpStepState[]>(defaultSteps);
  const [followUpSaving, setFollowUpSaving] = useState(false);
  const [followUpNotice, setFollowUpNotice] = useState("");
  const followUpLoaded = useRef(false);

  useEffect(() => {
    if (followUpLoaded.current) return;
    followUpLoaded.current = true;
    fetch("/api/proposals/follow-up-config")
      .then((res) => res.json())
      .then((data: { config?: { enabled?: boolean; smsEnabled?: boolean; steps?: FollowUpStepState[] } }) => {
        if (!data.config) return;
        if (data.config.enabled !== undefined) setFollowUpEnabled(data.config.enabled);
        if (data.config.smsEnabled !== undefined) setFollowUpSmsEnabled(data.config.smsEnabled);
        if (data.config.steps && data.config.steps.length > 0) setFollowUpSteps(data.config.steps);
      })
      .catch(() => {});
  }, []);

  function updateStep(index: number, field: keyof FollowUpStepState, value: string | number) {
    setFollowUpSteps((prev) => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  }

  function addStep() {
    setFollowUpSteps((prev) => [...prev, { delayHours: (prev[prev.length - 1]?.delayHours || 168) + 72, emailSubject: "Follow-up — Your Roofing Proposal", emailTemplate: "Hi {customerName},\n\nWe wanted to check in about your roofing proposal. We're here to help whenever you're ready.\n\nThank you,\nXRP Roofing Team", smsTemplate: "Hi {customerName}, checking in on your roofing proposal. We're here to help! {proposalLink} — XRP Roofing" }]);
  }

  function removeStep(index: number) {
    if (followUpSteps.length <= 1) return;
    setFollowUpSteps((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSaveFollowUpConfig() {
    setFollowUpSaving(true);
    setFollowUpNotice("");
    try {
      const res = await fetch("/api/proposals/follow-up-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: followUpEnabled,
          delayHours: followUpSteps[0]?.delayHours || 24,
          emailSubject: followUpSteps[0]?.emailSubject || "",
          emailTemplate: followUpSteps[0]?.emailTemplate || "",
          smsEnabled: followUpSmsEnabled,
          smsTemplate: followUpSteps[0]?.smsTemplate || "",
          steps: followUpSteps,
        }),
      });
      if (res.ok) {
        setFollowUpNotice("Follow-up settings saved successfully.");
      } else {
        setFollowUpNotice("Failed to save follow-up settings.");
      }
    } catch {
      setFollowUpNotice("Failed to save follow-up settings.");
    } finally {
      setFollowUpSaving(false);
      setTimeout(() => setFollowUpNotice(""), 4000);
    }
  }

  const [templateForm, setTemplateForm] = useState({
    label: "",
    description: "",
    title: "",
    summary: "",
    terms: "",
    packages: defaultPackages,
    brochureEnabled: false,
    brochures: [] as BrochureFile[],
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
    depositType: "" as "" | "percentage" | "fixed",
    depositValue: "",
    depositDueDate: "",
    depositAddToFuture: false,
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
      : activeProposals;

    if (!query) return visibleProposals;

    const queryDigits = query.replace(/\D/g, "");
    const queryPhone = queryDigits.length === 11 && queryDigits.startsWith("1") ? queryDigits.slice(1) : queryDigits;

    return visibleProposals.filter((proposal) => {
      const textMatch = [proposal.customerName, proposal.customerPhone, proposal.address, proposal.scope, proposal.status]
        .some((value) => (value || "").toLowerCase().includes(query));
      if (textMatch) return true;
      if (queryPhone.length >= 2 && proposal.customerPhone) {
        const pDigits = proposal.customerPhone.replace(/\D/g, "");
        const pPhone = pDigits.length === 11 && pDigits.startsWith("1") ? pDigits.slice(1) : pDigits;
        if (pPhone.includes(queryPhone)) return true;
      }
      return false;
    });
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
      const deletedIds = permanentlyDeletedIdsRef.current;
      const softDeletedIds = locallyDeletedIdsRef.current;
      const filtered = server.filter((proposal) => !deletedIds.has(proposal.id));

      // Detect status changes and log activity
      const prev = prevProposalsRef.current;
      for (const updated of filtered) {
        const old = prev.find((p) => p.id === updated.id);
        if (!old) continue;
        const label = updated.proposalNumber ? `Proposal #${updated.proposalNumber}` : updated.address || "Proposal";
        // Status changed
        if (old.status !== updated.status) {
          if (updated.status === "Sent") {
            const sentVia = updated.sentViaSms ? "SMS" : "Email";
            const sentTo = updated.sentViaSms ? updated.smsSentToPhone : updated.sentToEmail;
            void logCrewActivity({ jobId: updated.job?.id || updated.id, jobName: label, actor: updated.sentBy || "CRM User", action: `Proposal sent by ${sentVia}`, details: `${label} sent${sentTo ? ` to ${sentTo}` : ""} — status changed from ${old.status} to Sent`, module: "Proposal" });
          } else if (updated.status === "Won" || updated.status === "Signed") {
            void logCrewActivity({ jobId: updated.id, jobName: label, actor: updated.signedBy || updated.customerName || "Customer", action: "Proposal signed", details: `${label} signed by ${updated.signedBy || updated.customerName || "customer"}`, module: "Proposal" });
          } else if (updated.status === "Declined") {
            void logCrewActivity({ jobId: updated.id, jobName: label, actor: updated.customerName || "Customer", action: "Proposal declined", details: `${label} declined by customer`, module: "Proposal" });
          } else if (updated.status === "Viewed" || updated.status === "Approved") {
            void logCrewActivity({ jobId: updated.id, jobName: label, actor: updated.customerName || "Customer", action: "Proposal viewed", details: `${label} viewed${(updated.viewCount || 0) > 1 ? ` (view #${updated.viewCount})` : ""}`, module: "Proposal" });
          }
        } else if ((updated.viewCount || 0) > (old.viewCount || 0)) {
          // View count increased without status change (already Viewed → viewed again)
          void logCrewActivity({ jobId: updated.id, jobName: label, actor: updated.customerName || "Customer", action: "Proposal viewed again", details: `${label} viewed again (view #${updated.viewCount})`, module: "Proposal" });
        }
        if (!old.depositPaidAt && updated.depositPaidAt) {
          void logCrewActivity({ jobId: updated.id, jobName: label, actor: updated.customerName || "Customer", action: "Deposit paid", details: `$${(updated.depositPaidAmount || 0).toLocaleString()} deposit paid on ${label}`, module: "Proposal" });
        }
      }

      setProposals((current) => {
        const serverIds = new Set(filtered.map((proposal) => proposal.id));
        const localOnly = current.filter((proposal) => !serverIds.has(proposal.id) && !deletedIds.has(proposal.id));
        const merged = retain([...filtered, ...localOnly]).map((proposal) => {
          // Preserve local soft-delete if the server hasn't caught up yet
          if (softDeletedIds.has(proposal.id) && !proposal.deletedAt) {
            return { ...proposal, deletedAt: new Date().toISOString() };
          }
          // Server now reflects the deletion — stop tracking locally
          if (softDeletedIds.has(proposal.id) && proposal.deletedAt) {
            softDeletedIds.delete(proposal.id);
          }
          return proposal;
        });
        prevProposalsRef.current = merged;
        return merged;
      });
      setActiveProposal((currentProposal) => {
        if (!currentProposal) return currentProposal;
        if (deletedIds.has(currentProposal.id)) return null;
        const updated = filtered.find((proposal) => proposal.id === currentProposal.id);
        return updated ? { ...currentProposal, ...updated } : currentProposal;
      });
    }

    function mergeTemplates(saved: ProposalTemplate[]) {
      const migrated = saved.map((t) => ({
        ...t,
        brochureEnabled: t.brochureEnabled ?? false,
        brochures: Array.isArray(t.brochures) ? t.brochures : [],
      }));
      const savedIds = new Set(migrated.map((t) => t.id));
      const missing = initialProposalTemplates.filter((t) => !savedIds.has(t.id));
      return [...migrated, ...missing];
    }

    async function init() {
      // Load templates: prefer server, fall back to localStorage
      let templatesLoaded = false;
      if (proposalSyncEnabled()) {
        const serverTemplates = await loadTemplateRecords<ProposalTemplate>();
        if (serverTemplates.length && mounted) {
          setTemplates(mergeTemplates(serverTemplates));
          templatesLoaded = true;
        }
      }
      if (!templatesLoaded) {
        const savedTemplates = window.localStorage.getItem("xrp-crm-proposal-templates");
        if (savedTemplates && mounted) {
          try {
            const parsed = JSON.parse(savedTemplates) as ProposalTemplate[];
            setTemplates(mergeTemplates(parsed));
          } catch {
            /* keep defaults */
          }
        }
      }

      const savedEmailTemplates = window.localStorage.getItem(emailTemplatesLocalKey);
      if (savedEmailTemplates && mounted) {
        try {
          const parsed = JSON.parse(savedEmailTemplates) as ProposalEmailTemplate[];
          if (parsed.length) setEmailTemplates(parsed);
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

      // Initialize unified counter from existing proposal numbers
      const allProposals = prevProposalsRef.current;
      const existingNumbers = allProposals
        .map((p) => p.proposalNumber ? parseUnifiedNumber(p.proposalNumber) : NaN)
        .filter((n) => !Number.isNaN(n));
      if (existingNumbers.length) ensureCounterAtLeast(Math.max(...existingNumbers) + 1);

      if (mounted) setDataLoaded(true);
    }

    void init();

    void refreshCrewData().then((data) => { if (mounted) setJobs(data.jobs); }).catch(() => {});

    const unsubscribe = subscribeToProposalRecords(() => void reloadFromServer());
    const unsubscribeJobs = subscribeToCrewData(() => {
      void refreshCrewData().then((data) => { if (mounted) setJobs(data.jobs); }).catch(() => {});
    });

    // Cache-event listeners read already-updated cache — no re-fetch cascade.
    function onCacheRefresh() { void reloadFromServer(); }
    function onCrewCacheRefresh() { const c = getCachedCrewData(); if (c && mounted) setJobs(c.jobs); }
    window.addEventListener(CACHE_EVENTS.proposals, onCacheRefresh);
    window.addEventListener(CACHE_EVENTS.crew, onCrewCacheRefresh);

    return () => {
      mounted = false;
      unsubscribe();
      unsubscribeJobs();
      window.removeEventListener(CACHE_EVENTS.proposals, onCacheRefresh);
      window.removeEventListener(CACHE_EVENTS.crew, onCrewCacheRefresh);
    };
  }, []);

  useAutoRefresh(() => {
    void refreshCrewData().then((data) => setJobs(data.jobs)).catch(() => {});
    if (!proposalSyncEnabled()) return;
    void refreshProposals<Proposal>().then((server) => {
      const deletedIds = permanentlyDeletedIdsRef.current;
      const softDeletedIds = locallyDeletedIdsRef.current;
      const filtered = server.filter((p) => !deletedIds.has(p.id));
      setProposals((current) => {
        const serverIds = new Set(filtered.map((p) => p.id));
        const localOnly = current.filter((p) => !serverIds.has(p.id) && !deletedIds.has(p.id));
        const merged = [...filtered, ...localOnly]
          .filter((p) => !p.deletedAt || Date.now() - new Date(p.deletedAt).getTime() < trashRetentionMs)
          .map((p) => {
            if (softDeletedIds.has(p.id) && !p.deletedAt) {
              return { ...p, deletedAt: new Date().toISOString() };
            }
            if (softDeletedIds.has(p.id) && p.deletedAt) {
              softDeletedIds.delete(p.id);
            }
            return p;
          });
        prevProposalsRef.current = merged;
        return merged;
      });
    }).catch(() => {});
  });

  // Auto-select a proposal when navigated from global search with ?proposal=<id>
  useEffect(() => {
    const proposalId = proposalSearchParams.get("proposal");
    if (proposalId && proposals.length > 0 && !activeProposal) {
      const match = proposals.find((p) => p.id === proposalId && !p.deletedAt);
      if (match) {
        setActiveProposal(match);
        window.location.hash = "#card";
        proposalCardHashRef.current = true;
      }
    }
  }, [proposalSearchParams, proposals, activeProposal]);

  useEffect(() => {
    if (!dataLoaded) return;
    try {
      const slim = proposals.map((p) => ({ ...p, brochures: undefined }));
      window.localStorage.setItem(proposalsLocalKey, JSON.stringify(slim));
    } catch {
      /* localStorage quota exceeded — brochure data URLs on proposals can be very large */
    }
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
    try {
      const stripped = templates.map((t) => ({ ...t, brochures: (t.brochures || []).map((b) => ({ name: b.name, type: b.type })) }));
      window.localStorage.setItem("xrp-crm-proposal-templates", JSON.stringify(stripped));
    } catch {
      /* localStorage quota exceeded */
    }
    void saveTemplateRecords(templates as unknown as Record<string, unknown>[]);
  }, [dataLoaded, templates]);

  useEffect(() => {
    if (!dataLoaded) return;
    try {
      window.localStorage.setItem(emailTemplatesLocalKey, JSON.stringify(emailTemplates));
    } catch {
      /* localStorage quota exceeded */
    }
  }, [dataLoaded, emailTemplates]);

  useEffect(() => {
    if (!dataLoaded || !activeProposal) return;
    // A signed proposal is locked: never auto-overwrite its package/price/
    // signature from the editor form (those are the immutable accepted values).
    if (isProposalLocked(activeProposal)) return;

    const timeout = window.setTimeout(() => {
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
      };

      setProposals((currentProposals) =>
        currentProposals.map((proposal) => proposal.id === updatedProposal.id ? updatedProposal : proposal)
      );
    }, 800);

    return () => window.clearTimeout(timeout);
  }, [activeProposal, dataLoaded, editorForm]);



  function findMatchingJob(name: string, addr: string, phone: string): Lead | undefined {
    const normPhone = phone.replace(/\D/g, "");
    const normName = name.toLowerCase().trim();
    const normAddr = addr.toLowerCase().trim();
    return jobs.find((job) => {
      if (normPhone && normPhone.length >= 7 && job.phone.replace(/\D/g, "").includes(normPhone.slice(-7))) return true;
      if (normName && job.name.toLowerCase().trim() === normName && normAddr && job.address.toLowerCase().trim().includes(normAddr.split(",")[0].trim())) return true;
      return false;
    });
  }

  function autoCreateJobFromProposal(name: string, addr: string, phone: string, email: string, value: number): Lead {
    const city = addr.includes(",") ? addr.split(",").slice(1).join(",").trim().replace(/,?\s*AZ$/i, "").trim() || "Phoenix" : "Phoenix";
    const newJob: Lead = {
      id: `J-${Date.now()}`,
      name,
      email: email || "",
      phone: phone || "",
      address: addr.split(",")[0].trim() || "Address pending",
      city,
      stage: "estimate_sent",
      value: value || 0,
      assignedTo: currentUserName || "Office",
      roofType: "Roofing",
      source: "Estimate",
      lastActivity: "Auto-created from proposal",
      nextAction: "Review proposal",
    };
    void upsertJobRecord(leadToJobRecord(newJob)).catch(() => {});
    void createManualFolder({
      name: `${name} - ${newJob.address}`,
      address: newJob.address,
      customerName: name,
      workType: "Roofing",
    }).catch(() => {});
    setJobs((current) => [newJob, ...current]);
    return newJob;
  }

  function handleCreateProposal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (proposalMode === "job" && !selectedJob) return;
    if (proposalMode === "new" && (!customerName || !address)) return;

    let linkedJob: Lead | undefined = proposalMode === "job" ? selectedJob : undefined;

    if (proposalMode === "new") {
      linkedJob = findMatchingJob(customerName, address, customerPhone || "");
      if (!linkedJob) {
        linkedJob = autoCreateJobFromProposal(customerName, address, customerPhone || "", customerEmail || "", Number(total) || 0);
      }
    }

    const unifiedNum = getNextUnifiedNumber();
    const newProposal: Proposal = {
      id: `P-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      proposalNumber: String(unifiedNum),
      job: linkedJob,
      customerName: proposalMode === "job" && selectedJob ? selectedJob.name : customerName,
      customerEmail: proposalMode === "job" && selectedJob ? selectedJob.email : customerEmail || "",
      customerPhone: proposalMode === "job" && selectedJob ? selectedJob.phone : customerPhone || "",
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
      createdBy: currentUserName,
      updatedBy: currentUserName,
      createdAt: new Date().toISOString(),
    };

    setProposals((currentProposals) => [newProposal, ...currentProposals]);
    if (newProposal.job?.id) {
      void logCrewActivity({
        jobId: newProposal.job.id,
        jobName: newProposal.customerName,
        actor: currentUserName || currentUserEmail || "Office",
        action: "Proposal created",
        details: `${newProposal.scope} — $${newProposal.total.toLocaleString()}`,
        module: "Proposal",
      }).catch(() => {});
    }
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
    setCustomerEmail("");
    setCustomerPhone("");
    setAddress("");
    setScope("");
    setTotal("");
  }

  // Create an estimate directly from a job (one-click from the Jobs board /
  // customer profile) and open its editor. The job is stored on the proposal so
  // future clicks open this same estimate instead of creating another.
  function createEstimateFromLead(job: Lead) {
    const unifiedNum = getNextUnifiedNumber();
    const newProposal: Proposal = {
      id: `P-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      proposalNumber: String(unifiedNum),
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
      createdBy: currentUserName,
      updatedBy: currentUserName,
      createdAt: new Date().toISOString(),
    };

    setProposals((currentProposals) => [newProposal, ...currentProposals]);
    if (job.id) {
      void logCrewActivity({
        jobId: job.id,
        jobName: newProposal.customerName,
        actor: currentUserName || currentUserEmail || "Office",
        action: "Estimate created",
        details: `${newProposal.scope} — $${newProposal.total.toLocaleString()}`,
        module: "Estimates",
      });
    }
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
    setEditorBrochures(template.brochureEnabled && template.brochures?.length ? [...template.brochures] : []);
  }

  function handleCreateTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!templateForm.label || !templateForm.title) return;

    const newTemplate: ProposalTemplate = {
      id: `template-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label: templateForm.label,
      description: templateForm.description || "Custom professional proposal template.",
      title: templateForm.title,
      summary: templateForm.summary || "A professional roofing proposal prepared for customer review.",
      terms: templateForm.terms || defaultTerms,
      packages: normalizePackages(templateForm.packages),
      brochureEnabled: templateForm.brochureEnabled,
      brochures: templateForm.brochures,
    };

    setTemplates((currentTemplates) => [newTemplate, ...currentTemplates]);
    setTemplateForm({ label: "", description: "", title: "", summary: "", terms: "", packages: defaultPackages, brochureEnabled: false, brochures: [] });
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
      depositType: proposal.depositType || "",
      depositValue: proposal.depositValue ? String(proposal.depositValue) : "",
      depositDueDate: proposal.depositDueDate || "",
      depositAddToFuture: proposal.depositAddToFuture || false,
    });
    setEditorBrochures(proposal.brochures || []);
    setIsPreviewing(false);
    setActiveSection("Estimate");
    setActiveProposal(proposal);
    window.location.hash = "#card";
    proposalCardHashRef.current = true;

    if (!proposal.brochures?.length && proposalSyncEnabled()) {
      fetch(`/api/proposals/share?id=${encodeURIComponent(proposal.id)}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data: { proposal?: Proposal } | null) => {
          const brochures = data?.proposal?.brochures;
          if (brochures?.length) {
            setEditorBrochures(brochures);
            setProposals((cur) => cur.map((p) => p.id === proposal.id ? { ...p, brochures } : p));
          }
        })
        .catch(() => {});
    }
  }

  function handleSaveProposal() {
    if (!activeProposal) return;

    const updatedProposal = saveActiveProposal();
    setActiveProposal(updatedProposal);
    showSaveToast("Proposal saved");
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
      brochures: editorBrochures.length > 0 ? editorBrochures : undefined,
      depositType: editorForm.depositType || undefined,
      depositValue: Number(editorForm.depositValue) || undefined,
      depositDueDate: editorForm.depositDueDate || undefined,
      depositAddToFuture: editorForm.depositAddToFuture || undefined,
      updatedBy: currentUserName,
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

  function applyEmailTemplateVars(text: string, customerName: string) {
    return text.replaceAll("{{customer_name}}", customerName);
  }

  function handleSelectEmailTemplate(templateId: string, customerName: string) {
    const selected = emailTemplates.find((t) => t.id === templateId);
    if (!selected) return;
    setSendForm((prev) => ({
      ...prev,
      emailTemplateId: templateId,
      subject: applyEmailTemplateVars(selected.subject, customerName),
      message: applyEmailTemplateVars(selected.message, customerName),
    }));
  }

  function handleOpenSendModal() {
    if (!activeProposal) return;

    const savedProposal = saveActiveProposal() || activeProposal;
    setActiveProposal(savedProposal);
    setSendNotice("");

    const name = savedProposal.customerName;
    const savedTemplateId = savedProposal.sendSubject ? (emailTemplates.find((t) => applyEmailTemplateVars(t.subject, name) === savedProposal.sendSubject)?.id || "personalized") : "personalized";
    const selected = emailTemplates.find((t) => t.id === savedTemplateId) || emailTemplates[0];

    setSendForm({
      toName: name,
      toEmail: savedProposal.customerEmail || savedProposal.job?.email || "info@xrproofing.com",
      ccRecipients: savedProposal.ccRecipients || "",
      emailTemplateId: savedTemplateId,
      subject: savedProposal.sendSubject || applyEmailTemplateVars(selected.subject, name),
      message: savedProposal.sendMessage || applyEmailTemplateVars(selected.message, name),
    });
    setShowSendModal(true);
  }

  async function handleSendProposal() {
    if (!activeProposal) return;

    setSendingProposal(true);
    setSendNotice("");

    const sentProposal = saveActiveProposal({
      status: "Sent",
      ccRecipients: sendForm.ccRecipients,
      sendSubject: sendForm.subject,
      sendMessage: sendForm.message,
      sentToEmail: sendForm.toEmail,
      sentAt: new Date().toISOString(),
      sentBy: currentUserName || currentUserEmail || "CRM User",
      proposalVersion: (activeProposal.proposalVersion ?? 0) + 1,
    });
    const proposalForLink = sentProposal || activeProposal;
    const proposalLink = `${window.location.origin}/proposal/${encodeURIComponent(proposalForLink.id)}`;

    if (sentProposal) {
      setActiveProposal(sentProposal);
    }

    // Save the proposal to Supabase so the status is persisted before the email
    // is sent. Await the write and verify the response so a failure doesn't leave
    // the status stuck on "Draft".
    try {
      const shareRes = await fetch("/api/proposals/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proposalForLink),
      });
      if (!shareRes.ok) {
        await upsertProposalRecord(proposalForLink);
      }
    } catch {
      try {
        await upsertProposalRecord(proposalForLink);
      } catch { /* sync effect will retry on next change */ }
    }

    try {
      const response = await fetch("/api/proposals/send", {
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
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        const serverError = typeof data?.error === "string" ? data.error : "Unable to send proposal email";
        if (serverError === "Email service is not configured") {
          setSendConfirmation({ type: "error", customerName: sendForm.toName, proposalNumber: proposalForLink.proposalNumber || proposalForLink.id, message: `Email service is not configured. Add RESEND_API_KEY in Vercel to send proposal emails, or copy and send this proposal link manually:\n\n${proposalLink}` });
        } else {
          setSendConfirmation({ type: "error", customerName: sendForm.toName, proposalNumber: proposalForLink.proposalNumber || proposalForLink.id, message: `${serverError}\n\nProposal link: ${proposalLink}` });
        }
      } else {
        // Log send activity
        const sendLog = JSON.parse(window.localStorage.getItem("xrp-crm-send-activity-log") || "[]") as Record<string, string>[];
        sendLog.unshift({
          type: "Proposal",
          sentBy: currentUserName || currentUserEmail || "CRM User",
          sentAt: new Date().toISOString(),
          customerName: sendForm.toName,
          documentNumber: proposalForLink.proposalNumber || proposalForLink.id,
          deliveryMethod: "Email",
          recipient: sendForm.toEmail,
        });
        window.localStorage.setItem("xrp-crm-send-activity-log", JSON.stringify(sendLog));

        if (proposalForLink.job?.id) {
          void logCrewActivity({
            jobId: proposalForLink.job.id,
            jobName: proposalForLink.customerName,
            actor: currentUserName || currentUserEmail || "Office",
            action: "Proposal sent by Email",
            details: `${proposalForLink.proposalNumber ? `Proposal #${proposalForLink.proposalNumber}` : "Proposal"} sent to ${sendForm.toEmail} — status changed to Sent`,
            module: "Proposal",
          }).catch(() => {});
        }

        setSendConfirmation({ type: "success", customerName: sendForm.toName, proposalNumber: proposalForLink.proposalNumber || proposalForLink.id, message: `Proposal sent to ${sendForm.toEmail}.\n\nProposal link: ${proposalLink}` });
        setShowSendModal(false);
      }
    } catch {
      setSendConfirmation({ type: "error", customerName: sendForm.toName, proposalNumber: proposalForLink.proposalNumber || proposalForLink.id, message: `Could not connect to the email server. Please check your internet connection and try again.\n\nProposal link: ${proposalLink}` });
    } finally {
      setSendingProposal(false);
    }
  }

  function handleOpenSmsSendModal() {
    if (!activeProposal) return;

    const savedProposal = saveActiveProposal() || activeProposal;
    setActiveProposal(savedProposal);

    const phone = savedProposal.customerPhone || savedProposal.job?.phone || "";
    const name = savedProposal.customerName;

    // Use the same message as the email template for consistent communication
    const savedTemplateId = savedProposal.sendSubject ? (emailTemplates.find((t) => applyEmailTemplateVars(t.subject, name) === savedProposal.sendSubject)?.id || "personalized") : "personalized";
    const selected = emailTemplates.find((t) => t.id === savedTemplateId) || emailTemplates[0];
    const emailMessage = savedProposal.sendMessage || applyEmailTemplateVars(selected.message, name);

    setSmsForm({
      toPhone: phone,
      message: emailMessage,
      fromNumber: twilioLines[0]?.number || "",
    });
    setShowSmsSendModal(true);
  }

  async function handleSendProposalSms() {
    if (!activeProposal || !smsForm.toPhone.trim()) return;

    setSendingSms(true);

    const sentProposal = saveActiveProposal({
      status: "Sent",
      sentViaSms: true,
      sentAt: new Date().toISOString(),
      sentBy: currentUserName || currentUserEmail || "CRM User",
      smsSentAt: new Date().toISOString(),
      smsSentBy: currentUserName || currentUserEmail || "CRM User",
      smsSentFrom: smsForm.fromNumber,
      smsSentToPhone: smsForm.toPhone,
      proposalVersion: (activeProposal.proposalVersion ?? 0) + 1,
    });
    const proposalForLink = sentProposal || activeProposal;
    const proposalLink = `${window.location.origin}/proposal/${encodeURIComponent(proposalForLink.id)}`;

    if (sentProposal) {
      setActiveProposal(sentProposal);
    }

    // Save the proposal to Supabase so the status is persisted before the SMS
    // is sent. Await the write and verify the response so a failure doesn't leave
    // the status stuck on "Draft".
    try {
      const shareRes = await fetch("/api/proposals/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proposalForLink),
      });
      if (!shareRes.ok) {
        await upsertProposalRecord(proposalForLink);
      }
    } catch {
      try {
        await upsertProposalRecord(proposalForLink);
      } catch { /* sync effect will retry on next change */ }
    }

    // Build the SMS body: user's message + proposal link appended
    const smsBody = `${smsForm.message.trim()}\n\n${proposalLink}`;

    try {
      await sendSms({
        to: smsForm.toPhone,
        body: smsBody,
        from: smsForm.fromNumber || undefined,
      });

      // Log send activity
      const sendLog = JSON.parse(window.localStorage.getItem("xrp-crm-send-activity-log") || "[]") as Record<string, string>[];
      sendLog.unshift({
        type: "Proposal",
        sentBy: currentUserName || currentUserEmail || "CRM User",
        sentAt: new Date().toISOString(),
        customerName: activeProposal.customerName,
        documentNumber: proposalForLink.proposalNumber || proposalForLink.id,
        deliveryMethod: "SMS",
        recipient: smsForm.toPhone,
      });
      window.localStorage.setItem("xrp-crm-send-activity-log", JSON.stringify(sendLog));

      if (proposalForLink.job?.id) {
        void logCrewActivity({
          jobId: proposalForLink.job.id,
          jobName: proposalForLink.customerName,
          actor: currentUserName || currentUserEmail || "Office",
          action: "Proposal sent by SMS",
          details: `${proposalForLink.proposalNumber ? `Proposal #${proposalForLink.proposalNumber}` : "Proposal"} sent to ${smsForm.toPhone} — status changed to Sent`,
          module: "Proposal",
        }).catch(() => {});
      }

      setSendConfirmation({ type: "success", customerName: activeProposal.customerName, proposalNumber: proposalForLink.proposalNumber || proposalForLink.id, message: `Proposal sent via SMS to ${smsForm.toPhone}.\n\nProposal link: ${proposalLink}` });
      setShowSmsSendModal(false);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unable to send SMS";
      setSendConfirmation({ type: "error", customerName: activeProposal.customerName, proposalNumber: proposalForLink.proposalNumber || proposalForLink.id, message: `${errorMsg}\n\nProposal link: ${proposalLink}` });
    } finally {
      setSendingSms(false);
    }
  }

  function handleDeleteProposal(proposal: Proposal) {
    const trashedProposal = { ...proposal, deletedAt: new Date().toISOString() };
    locallyDeletedIdsRef.current.add(proposal.id);
    setDeletedProposal(trashedProposal);
    setProposals((currentProposals) => currentProposals.map((currentProposal) => currentProposal.id === proposal.id ? trashedProposal : currentProposal));
    if (proposal.job?.id) {
      void logCrewActivity({
        jobId: proposal.job.id,
        jobName: proposal.customerName,
        actor: currentUserName || currentUserEmail || "Office",
        action: "Proposal deleted",
        details: `${proposal.scope} — $${proposal.total.toLocaleString()}`,
        module: "Proposal",
      });
    }
    if (activeProposal?.id === proposal.id) {
      setActiveProposal(null);
      proposalCardHashRef.current = false;
      const url = new URL(window.location.href);
      url.searchParams.delete("proposal");
      url.hash = "";
      history.replaceState(history.state, "", url.pathname + url.search);
    }
  }

  function handleUndoDelete() {
    if (!deletedProposal) return;
    locallyDeletedIdsRef.current.delete(deletedProposal.id);
    setProposals((currentProposals) => currentProposals.map((proposal) => proposal.id === deletedProposal.id ? { ...proposal, deletedAt: undefined } : proposal));
    setDeletedProposal(null);
  }

  function handleRestoreProposal(proposal: Proposal) {
    locallyDeletedIdsRef.current.delete(proposal.id);
    setProposals((currentProposals) => currentProposals.map((currentProposal) => currentProposal.id === proposal.id ? { ...currentProposal, deletedAt: undefined } : currentProposal));
  }

  function handlePermanentDeleteProposal(proposal: Proposal) {
    locallyDeletedIdsRef.current.delete(proposal.id);
    permanentlyDeletedIdsRef.current.add(proposal.id);
    setProposals((currentProposals) => currentProposals.filter((currentProposal) => currentProposal.id !== proposal.id));
    if (deletedProposal?.id === proposal.id) {
      setDeletedProposal(null);
    }
    void deleteProposalRecord(proposal.id);
  }

  function handleEmptyExpiredTrash() {
    setProposals((currentProposals) => {
      const toDelete = currentProposals.filter((proposal) => proposal.deletedAt && Date.now() - new Date(proposal.deletedAt).getTime() >= trashRetentionMs);
      for (const proposal of toDelete) {
        permanentlyDeletedIdsRef.current.add(proposal.id);
        void deleteProposalRecord(proposal.id);
      }
      return currentProposals.filter((proposal) => !proposal.deletedAt || Date.now() - new Date(proposal.deletedAt).getTime() < trashRetentionMs);
    });
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
      printedName: typedSignature.trim(),
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
      // Auto-move linked job to "approved" stage
      const linkedJobId = signedProposal.job?.id;
      if (linkedJobId) {
        void updateJobRecord(linkedJobId, { stage: "approved" });
        void logCrewActivity({
          jobId: linkedJobId,
          jobName: signedProposal.customerName,
          actor: "System",
          action: "Proposal signed by customer – Job moved to Approved",
          details: `Job automatically moved to Approved after proposal ${signedProposal.proposalNumber || signedProposal.id} was signed`,
          module: "Proposal",
        });
      }
    }
  }

  function handleOpenOfflineSignModal() {
    if (!activeProposal) return;
    setOfflineSignerName(activeProposal.customerName || "");
    setOfflineSignMode("draw");
    setOfflineTypedSig("");
    offlineSigHasDrawnRef.current = false;
    setShowOfflineSignModal(true);
  }

  function handleMarkSignedOffline() {
    if (!activeProposal) return;

    // Capture signature data
    let signatureDataUrl = "";
    if (offlineSignMode === "draw" && offlineSigCanvasRef.current && offlineSigHasDrawnRef.current) {
      signatureDataUrl = offlineSigCanvasRef.current.toDataURL("image/png");
    } else if (offlineSignMode === "type" && offlineTypedSig.trim()) {
      // Generate image from typed signature using a temporary canvas
      const tmpCanvas = document.createElement("canvas");
      tmpCanvas.width = 400;
      tmpCanvas.height = 120;
      const tmpCtx = tmpCanvas.getContext("2d");
      if (tmpCtx) {
        tmpCtx.fillStyle = "#ffffff";
        tmpCtx.fillRect(0, 0, 400, 120);
        tmpCtx.font = "italic 36px 'Georgia', serif";
        tmpCtx.fillStyle = "#1a1a1a";
        tmpCtx.textBaseline = "middle";
        tmpCtx.fillText(offlineTypedSig.trim(), 20, 60);
      }
      signatureDataUrl = tmpCanvas.toDataURL("image/png");
    }

    const acceptedOption = activeProposal.selectedOption || "best";
    const acceptedPrice = Number(editorForm.total) || activeProposal.total || 0;
    const signedAt = new Date().toISOString();
    const signedProposal = saveActiveProposal({
      status: "Signed Offline" as Proposal["status"],
      offlineSignedAt: signedAt,
      offlineSignedBy: offlineSignerName.trim() || activeProposal.customerName,
      signedAt,
      signedBy: offlineSignerName.trim() || activeProposal.customerName,
      printedName: offlineSignerName.trim() || activeProposal.customerName,
      signatureDataUrl: signatureDataUrl || undefined,
      signatureData: signatureDataUrl || undefined,
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
      // Auto-move linked job to "approved" stage
      const linkedJobId = signedProposal.job?.id;
      if (linkedJobId) {
        void updateJobRecord(linkedJobId, { stage: "approved" });
        void logCrewActivity({
          jobId: linkedJobId,
          jobName: signedProposal.customerName,
          actor: "System",
          action: "Proposal signed by customer – Job moved to Approved",
          details: `Job automatically moved to Approved after proposal ${signedProposal.proposalNumber || signedProposal.id} was signed offline`,
          module: "Proposal",
        });
      }
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

  function handleResetSignature() {
    if (!activeProposal) return;
    const resetFields: Partial<Proposal> = {
      status: "Sent" as Proposal["status"],
      signedAt: undefined,
      signedBy: undefined,
      signatureData: undefined,
      signatureDataUrl: undefined,
      printedName: undefined,
      acceptedAt: undefined,
      locked: false,
    };
    const updated = { ...activeProposal, ...resetFields };
    setActiveProposal(updated);
    setProposals((current) => current.map((p) => p.id === updated.id ? updated : p));
    void logCrewActivity({
      jobId: activeProposal.job?.id || "",
      jobName: activeProposal.customerName,
      actor: currentUserName || "Office",
      action: "Proposal signature reset",
      details: `Signature reset on proposal ${activeProposal.proposalNumber || activeProposal.id} by ${currentUserName}`,
      module: "Proposal",
    });
    setShowResetSignatureConfirm(false);
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
      <div className="-mx-4 -my-6 min-h-[calc(100vh-5rem)] bg-gray-100 font-serif sm:-mx-6 lg:-mx-8 print:m-0 print:min-h-0 print:bg-white">
        <div className="sticky top-16 z-30 border-b border-gray-200 bg-white shadow-sm lg:top-20 print:hidden">
          {/* Row 1 — back + address */}
          <div className="flex h-10 items-center justify-between px-4">
            <button type="button" onClick={closeProposalCard} className="text-sm font-bold text-blue-700">← Back to proposals</button>
            <div className="hidden text-sm font-semibold text-gray-700 md:block">{editorForm.address}</div>
          </div>
          {/* Row 2 — action buttons, scrollable on mobile */}
          <div className="flex items-center gap-2 overflow-x-auto px-4 pb-2 scrollbar-hide">
            <span className="shrink-0 rounded-full bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-700">{activeProposal.status === "Viewed" || activeProposal.status === "Approved" ? `Viewed${(activeProposal.viewCount || 0) > 1 ? ` (${activeProposal.viewCount})` : ""}` : activeProposal.status}</span>
            <button type="button" onClick={handleSaveProposal} className="shrink-0 rounded-full bg-blue-50 px-4 py-1.5 text-xs font-bold text-blue-700 active:scale-95">Save</button>
            <button type="button" onClick={() => { setPermDeleteTarget(activeProposal); setShowPermDeleteConfirm(true); }} className="shrink-0 rounded-full bg-red-600 px-4 py-1.5 text-xs font-bold text-white active:scale-95">Delete</button>
            <button type="button" onClick={() => setIsPreviewing((current) => !current)} className="shrink-0 rounded-full bg-blue-50 px-4 py-1.5 text-xs font-bold text-blue-700 active:scale-95">{isPreviewing ? "Edit" : "Preview"}</button>
            <button type="button" onClick={() => { setIsPreviewing(true); setTimeout(() => { window.print(); }, 300); }} className="shrink-0 rounded-full bg-gray-100 px-4 py-1.5 text-xs font-bold text-gray-700 active:scale-95 print:hidden">Print</button>
            <button type="button" onClick={handleOpenSendModal} className="shrink-0 rounded-full bg-blue-600 px-4 py-1.5 text-xs font-bold text-white active:scale-95">{activeProposal.status !== "Draft" ? "Resend Email" : "Send Email"}</button>
            <button type="button" onClick={handleOpenSmsSendModal} className="shrink-0 rounded-full bg-green-600 px-4 py-1.5 text-xs font-bold text-white active:scale-95">{activeProposal.status !== "Draft" ? "Resend SMS" : "Send SMS"}</button>
            {activeProposal.status !== "Won" && activeProposal.status !== "Signed" && activeProposal.status !== "Signed Offline" && (
              <button type="button" onClick={handleOpenOfflineSignModal} className="shrink-0 rounded-full bg-orange-50 px-4 py-1.5 text-xs font-bold text-orange-700 active:scale-95">Mark as Signed Offline</button>
            )}
            {(activeProposal.status === "Won" || activeProposal.status === "Signed" || activeProposal.status === "Signed Offline") && (
              <label className="shrink-0 cursor-pointer rounded-full bg-blue-50 px-4 py-1.5 text-xs font-bold text-blue-700 active:scale-95">
                Upload Signed Proposal
                <input type="file" accept="image/*,.pdf" onChange={(event) => handleUploadSignedDocument(event.target.files?.[0])} className="hidden" />
              </label>
            )}
          </div>
        </div>

        {/* Sent Tracking Info */}
        {activeProposal.sentAt && activeProposal.status !== "Draft" && (
          <div className="border-b border-sky-100 bg-sky-50 px-4 py-3 print:hidden">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 text-xs text-gray-600">
              <span className="font-bold text-sky-700">Sent{activeProposal.sentViaSms ? " via SMS" : " via Email"}</span>
              <span>Sent: {azDateTime(activeProposal.sentAt)}</span>
              {activeProposal.sentBy && <span>By: {activeProposal.sentBy}</span>}
              {activeProposal.sentToEmail && !activeProposal.sentViaSms && <span>To: {activeProposal.sentToEmail}</span>}
              {activeProposal.smsSentToPhone && activeProposal.sentViaSms && <span>To: {activeProposal.smsSentToPhone}</span>}
            </div>
          </div>
        )}

        {/* View Tracking Info */}
        {activeProposal.viewCount && activeProposal.viewCount > 0 && (
          <div className="border-b border-orange-100 bg-orange-50 px-4 py-3 print:hidden">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 text-xs text-gray-600">
              <span className="font-bold text-orange-700">Views: {activeProposal.viewCount}</span>
              {activeProposal.firstViewedAt && <span>First viewed: {azDateTime(activeProposal.firstViewedAt)}</span>}
              {activeProposal.lastViewedAt && <span>Last viewed: {azDateTime(activeProposal.lastViewedAt)}</span>}
            </div>
          </div>
        )}

        {(activeProposal.status === "Won" || activeProposal.status === "Signed" || activeProposal.status === "Signed Offline") && (
          <div className="border-b border-blue-200 bg-blue-50 px-4 py-4 print:hidden">
            <div className="mx-auto max-w-5xl rounded-lg bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Signed proposal copy</p>
                <span className="rounded-full bg-blue-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-blue-700">🔒 Locked</span>
              </div>
              <p className="mt-2 text-sm font-bold text-gray-700">Signed by {activeProposal.printedName || activeProposal.signedBy || activeProposal.customerName} on {activeProposal.signedAt ? azDateTime(activeProposal.signedAt) : "today"} (Arizona Time).</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-4">
                <div className="rounded-lg bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Printed name</p>
                  <p className="mt-0.5 text-sm font-bold text-gray-900">{activeProposal.printedName || activeProposal.signedBy || activeProposal.customerName}</p>
                </div>
                <div className="rounded-lg bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Accepted package</p>
                  <p className="mt-0.5 text-sm font-bold text-blue-700">{activeProposal.acceptedPackageName || (activeProposal.acceptedPackage || activeProposal.selectedOption || "best").replace(/^\w/, (character) => character.toUpperCase())}</p>
                </div>
                <div className="rounded-lg bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Accepted price</p>
                  <p className="mt-0.5 text-sm font-bold text-blue-700">${(activeProposal.acceptedPrice ?? activeProposal.total).toLocaleString()}</p>
                </div>
                <div className="rounded-lg bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Version</p>
                  <p className="mt-0.5 text-sm font-bold text-blue-700">v{activeProposal.proposalVersion ?? 1}</p>
                </div>
              </div>
              {(activeProposal.signatureData || activeProposal.signatureDataUrl) && <Image src={(activeProposal.signatureData || activeProposal.signatureDataUrl) as string} alt="Customer signature" width={360} height={110} className="mt-3 max-h-28 w-auto rounded-lg border border-gray-200 bg-white object-contain p-2" />}
              {activeProposal.status === "Signed Offline" && (
                <div className="mt-3 rounded-lg bg-orange-50 px-3 py-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-orange-700">Signed In Person</p>
                  <p className="mt-0.5 text-sm text-gray-700">Signed by: {activeProposal.offlineSignedBy || activeProposal.customerName}</p>
                  {activeProposal.offlineSignedAt && <p className="text-xs text-gray-500">Date: {new Date(activeProposal.offlineSignedAt).toLocaleDateString()} at {new Date(activeProposal.offlineSignedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>}
                </div>
              )}
              {activeProposal.offlineSignatureFile && (
                <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Uploaded Signed Document</p>
                  <div className="mt-2 flex items-center gap-3">
                    {activeProposal.offlineSignatureFile.startsWith("data:image") ? (
                      <Image src={activeProposal.offlineSignatureFile} alt="Signed proposal" width={200} height={140} className="max-h-36 w-auto rounded-lg border border-gray-200 object-contain" />
                    ) : (
                      <a href={activeProposal.offlineSignatureFile} download={activeProposal.offlineSignatureFileName || "signed-proposal.pdf"} className="inline-flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100">
                        📄 {activeProposal.offlineSignatureFileName || "signed-proposal.pdf"}
                      </a>
                    )}
                  </div>
                </div>
              )}
              <div className="mt-4 border-t border-gray-200 pt-3">
                {!showResetSignatureConfirm ? (
                  <button type="button" onClick={() => setShowResetSignatureConfirm(true)} className="text-xs font-semibold text-red-400 transition hover:text-red-600">Reset Signature</button>
                ) : (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                    <p className="text-xs font-bold text-red-700">Are you sure you want to reset the signature? This will unlock the proposal and allow the customer to re-sign.</p>
                    <div className="mt-2 flex items-center gap-2">
                      <button type="button" onClick={handleResetSignature} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700">Yes, Reset Signature</button>
                      <button type="button" onClick={() => setShowResetSignatureConfirm(false)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-100">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className={`grid min-h-[calc(100vh-8.5rem)] grid-cols-1 print:min-h-0 print:block ${isPreviewing ? "" : "lg:grid-cols-[300px_1fr]"}`} id="proposal-print-area">
          {!isPreviewing && (
          <aside className="overflow-y-auto border-r border-gray-100 bg-gray-50/50 p-5">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Customer</p>
                  <input value={editorForm.customerName} onChange={(event) => setEditorForm({ ...editorForm, customerName: event.target.value })} className="mt-2 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50" />
                  <AddressAutocomplete
                    value={editorForm.address}
                    onChange={(addr) => setEditorForm({ ...editorForm, address: addr })}
                    placeholder="Start typing address..."
                    className="mt-2 !rounded-md !py-2 !text-sm text-gray-600"
                  />
                  <input value={editorForm.customerPhone} onChange={(event) => { const el = event.target; const { formatted, cursorPos } = handlePhoneChange(el.value, editorForm.customerPhone, el.selectionStart); setEditorForm({ ...editorForm, customerPhone: formatted }); requestAnimationFrame(() => { el.setSelectionRange(cursorPos, cursorPos); }); }} className="mt-2 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50" placeholder="Phone" />
                  <input value={editorForm.customerEmail} onChange={(event) => setEditorForm({ ...editorForm, customerEmail: event.target.value })} className="mt-2 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50" placeholder="Email" />
                </div>
                <button className="text-gray-300 hover:text-gray-500 transition">•••</button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {activeProposal?.job?.id && (
                <a href={`/crm/leads?job=${encodeURIComponent(activeProposal.job.id)}`} className="rounded-md border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-blue-600 transition hover:bg-blue-50">View Job →</a>
              )}
              <a href={`/crm/invoices?proposal=${encodeURIComponent(activeProposal?.id || "")}`} className="rounded-md border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-green-600 transition hover:bg-green-50">View Invoice →</a>
            </div>
            <div className="mt-6">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-gray-400">Template</p>
              <div className="space-y-1.5">
                {templates.map((template) => (
                  <button key={template.id} type="button" onClick={() => applyTemplateToEditor(template)} className={`w-full rounded-md px-3 py-2.5 text-left transition ${editorForm.template === template.id ? "bg-blue-50 ring-1 ring-blue-200" : "bg-white border border-gray-200 hover:border-gray-300"}`}>
                    <span className={`block text-sm font-medium ${editorForm.template === template.id ? "text-blue-700" : "text-gray-700"}`}>{template.label}</span>
                    <span className="mt-0.5 block text-xs text-gray-400">{template.description}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-6 space-y-4">
              <label className="block text-[11px] font-medium uppercase tracking-wider text-gray-400">
                Title
                <input value={editorForm.title} onChange={(event) => setEditorForm({ ...editorForm, title: event.target.value })} className="mt-1.5 w-full rounded-md border border-gray-200 px-3 py-2 text-sm normal-case tracking-normal text-gray-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50" />
              </label>
              <div className="block text-[11px] font-medium uppercase tracking-wider text-gray-400">
                <div className="flex items-center justify-between"><span>Summary</span><AiWriteButton getText={() => editorForm.summary} onReplace={(t) => setEditorForm({ ...editorForm, summary: t })} onInsert={(t) => setEditorForm({ ...editorForm, summary: editorForm.summary + "\n" + t })} context="proposal summary" /></div>
                <textarea value={editorForm.summary} onChange={(event) => { const el = event.target; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; setEditorForm({ ...editorForm, summary: event.target.value }); }} className="mt-1.5 min-h-[4rem] w-full resize-none rounded-md border border-gray-200 px-3 py-2 text-sm normal-case tracking-normal text-gray-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50" />
              </div>
              <label className="block text-[11px] font-medium uppercase tracking-wider text-gray-400">
                Cover photo URL
                <input value={editorForm.coverPhoto} onChange={(event) => setEditorForm({ ...editorForm, coverPhoto: event.target.value })} className="mt-1.5 w-full rounded-md border border-gray-200 px-3 py-2 text-sm normal-case tracking-normal text-gray-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50" placeholder="/images/logo.jpeg" />
              </label>
              <div className="block text-[11px] font-medium uppercase tracking-wider text-gray-400">
                <div className="flex items-center justify-between"><span>Cover text</span><AiWriteButton getText={() => editorForm.coverText} onReplace={(t) => setEditorForm({ ...editorForm, coverText: t })} context="proposal cover text" /></div>
                <textarea value={editorForm.coverText} onChange={(event) => { const el = event.target; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; setEditorForm({ ...editorForm, coverText: event.target.value }); }} className="mt-1.5 min-h-[4.5rem] w-full resize-none rounded-md border border-gray-200 px-3 py-2 text-sm normal-case tracking-normal text-gray-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50" />
              </div>
              <div className="block text-[11px] font-medium uppercase tracking-wider text-gray-400">
                <div className="flex items-center justify-between"><span>Scope of work</span><AiWriteButton getText={() => editorForm.scope} onReplace={(t) => setEditorForm({ ...editorForm, scope: t })} onInsert={(t) => setEditorForm({ ...editorForm, scope: editorForm.scope + "\n" + t })} context="roofing proposal scope of work" /></div>
                <textarea value={editorForm.scope} onChange={(event) => { const el = event.target; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; setEditorForm({ ...editorForm, scope: event.target.value }); }} onPaste={(event) => { event.preventDefault(); setEditorForm({ ...editorForm, scope: formatPastedProposalText(event.clipboardData.getData("text")) }); }} className="mt-1.5 min-h-[8rem] w-full resize-none rounded-md border border-gray-200 px-3 py-2 text-sm normal-case tracking-normal text-gray-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50" />
              </div>
              <label className="block text-[11px] font-medium uppercase tracking-wider text-gray-400">
                Total
                <input type="number" value={editorForm.total} disabled={isProposalLocked(activeProposal)} onChange={(event) => setEditorForm({ ...editorForm, total: event.target.value })} className="mt-1.5 w-full rounded-md border border-gray-200 px-3 py-2 text-sm normal-case tracking-normal text-gray-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500" />
                {isProposalLocked(activeProposal) && <span className="mt-1 block text-[11px] font-medium normal-case tracking-normal text-amber-600">🔒 Locked at the signed amount</span>}
              </label>
              {/* Deposit Request trigger */}
              <div className="rounded-md border border-gray-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Deposit Request</p>
                  <button type="button" onClick={() => { if (!editorForm.depositType) setEditorForm({ ...editorForm, depositType: "percentage" }); setShowDepositModal(true); }} disabled={isProposalLocked(activeProposal)} className="rounded-md bg-teal-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50">{editorForm.depositType ? "Edit" : "Configure"}</button>
                </div>
                {editorForm.depositType && Number(editorForm.depositValue) > 0 && Number(editorForm.total) > 0 && (
                  <p className="mt-2 text-sm font-semibold text-gray-700">
                    {editorForm.depositType === "percentage" ? `${editorForm.depositValue}%` : `$${Number(editorForm.depositValue).toLocaleString()}`} deposit
                    {" "}= ${(editorForm.depositType === "percentage" ? Math.round(Number(editorForm.total) * Number(editorForm.depositValue) / 100) : Number(editorForm.depositValue)).toLocaleString()}
                    {editorForm.depositDueDate && ` · Due ${editorForm.depositDueDate}`}
                  </p>
                )}
                {!editorForm.depositType && <p className="mt-2 text-xs text-gray-400">No deposit configured</p>}
                {activeProposal?.depositPaidAt && (
                  <p className="mt-2 text-xs font-bold text-emerald-700">✓ Deposit paid: ${(activeProposal.depositPaidAmount || 0).toLocaleString()} on {azDate(activeProposal.depositPaidAt)}</p>
                )}
              </div>
              <div className="block text-[11px] font-medium uppercase tracking-wider text-gray-400">
                <div className="flex items-center justify-between"><span>Customer notes</span><AiWriteButton getText={() => editorForm.notes} onReplace={(t) => setEditorForm({ ...editorForm, notes: t })} onInsert={(t) => setEditorForm({ ...editorForm, notes: editorForm.notes + "\n" + t })} context="customer notes for a roofing proposal" /></div>
                <textarea value={editorForm.notes} onChange={(event) => { const el = event.target; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; setEditorForm({ ...editorForm, notes: event.target.value }); }} className="mt-1.5 min-h-[4.5rem] w-full resize-none rounded-md border border-gray-200 px-3 py-2 text-sm normal-case tracking-normal text-gray-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50" />
              </div>
              <div className="block text-[11px] font-medium uppercase tracking-wider text-gray-400">
                <div className="flex items-center justify-between"><span>Terms and conditions</span><AiWriteButton getText={() => editorForm.terms} onReplace={(t) => setEditorForm({ ...editorForm, terms: t })} context="roofing proposal terms and conditions" /></div>
                <textarea value={editorForm.terms} onChange={(event) => { const el = event.target; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; setEditorForm({ ...editorForm, terms: event.target.value }); }} className="mt-1.5 min-h-[5rem] w-full resize-none rounded-md border border-gray-200 px-3 py-2 text-sm normal-case tracking-normal text-gray-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50" />
              </div>
            </div>
            <div className="mt-6">
              {/* Good / Better / Best toggle */}
              <label className="mb-4 flex cursor-pointer items-center justify-between rounded-md border border-gray-200 bg-white px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-700">Good / Better / Best</p>
                  <p className="text-xs text-gray-400">{editorForm.showPackages ? "Showing package options" : "Hidden — single proposal"}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditorForm({ ...editorForm, showPackages: !editorForm.showPackages })}
                  className={`relative h-6 w-11 rounded-full transition-colors ${editorForm.showPackages ? "bg-blue-600" : "bg-gray-300"}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${editorForm.showPackages ? "translate-x-5" : "translate-x-0.5"}`} />
                </button>
              </label>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-gray-400">Sections</p>
              <div className="space-y-1.5">
                {proposalSections.filter((section) => editorForm.showPackages || !["BEST", "BETTER", "GOOD"].includes(section)).map((section) => (
                  <button key={section} type="button" onClick={() => setActiveSection(section)} className={`w-full rounded-md px-3 py-2.5 text-left text-sm transition ${section === activeSection ? "bg-blue-50 font-medium text-blue-700 ring-1 ring-blue-200" : "bg-white font-normal text-gray-600 border border-gray-200 hover:border-gray-300"}`}>
                    {section}
                  </button>
                ))}
              </div>
              <button className="mt-3 w-full rounded-md border border-dashed border-gray-300 bg-white px-4 py-2.5 text-center text-lg text-gray-400 transition hover:border-blue-300 hover:text-blue-600">+</button>
            </div>
          </aside>
          )}

          <main className="bg-gray-50/30 p-6 print:bg-white print:p-0">
            <div className="mx-auto max-w-[760px] print:max-w-none">
              <p className="mb-4 text-center text-sm font-medium text-gray-500 print:hidden">{selectedTemplate?.label || "Custom Proposal"}</p>
              <div className={`min-h-[900px] rounded-2xl border bg-white p-8 shadow-sm print:min-h-0 print:rounded-none print:border-none print:p-0 print:shadow-none ${editorForm.template === "premium" ? "border-orange-200" : editorForm.template === "insurance" ? "border-blue-200" : "border-gray-200"}`}>
                <div className="grid gap-6 rounded-lg border border-gray-100 bg-gray-50/80 p-6 md:grid-cols-2">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-gray-400">Client</p>
                    <p className="mt-3 text-lg font-semibold text-gray-800">{editorForm.customerName}</p>
                    <p className="mt-1.5 text-sm leading-6 text-gray-500">{editorForm.address}</p>
                    {editorForm.customerPhone && <p className="mt-1.5 text-sm text-gray-600">{editorForm.customerPhone}</p>}
                    {editorForm.customerEmail && <p className="mt-1 text-sm text-blue-600">{editorForm.customerEmail}</p>}
                  </div>
                  <div className="border-t border-gray-200 pt-6 md:border-l md:border-t-0 md:pl-6 md:pt-0">
                    <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-gray-400">Prepared by</p>
                    <p className="mt-3 text-lg font-semibold text-gray-800">XRP Roofing</p>
                    <p className="mt-1.5 text-sm text-gray-600">Jonathan Gonzalez</p>
                    <p className="mt-1.5 text-sm text-gray-500">(623) 300-8097</p>
                    <p className="mt-1 text-sm text-blue-600">info@xrproofing.com</p>
                    <p className="mt-1 text-sm text-gray-500">xrproofing.com</p>
                  </div>
                </div>

                <div className="my-10 text-center">
                  {isPreviewing ? (
                    <h1 className={`text-2xl font-semibold tracking-tight ${editorForm.template === "premium" ? "text-orange-600" : "text-gray-800"}`}>ROOFING PROPOSAL</h1>
                  ) : (
                    <input value={editorForm.title} onChange={(event) => setEditorForm({ ...editorForm, title: event.target.value })} className={`w-full border-none bg-transparent p-0 text-center text-2xl font-semibold tracking-tight outline-none ${editorForm.template === "premium" ? "text-orange-600" : "text-gray-800"}`} />
                  )}
                  <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs font-medium uppercase tracking-wider">
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-500">{activeProposal.proposalNumber ? `#${activeProposal.proposalNumber}` : `ID ${activeProposal.id}`}</span>
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-500">Issued {azDate(new Date())}</span>
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-600">{activeProposal.status}</span>
                  </div>
                </div>

                {(isPreviewing || activeSection === "Cover") && (
                  <div className="mt-10 rounded-lg bg-gray-50/80 p-8 text-center">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Cover</p>
                    <Image src={editorForm.coverPhoto || "/images/logo.jpeg"} alt="Proposal cover" width={220} height={130} className="mx-auto mt-5 max-h-36 w-auto rounded-lg bg-white object-contain" />
                    <p className="mt-6 text-2xl font-semibold text-gray-800">{editorForm.title}</p>
                    <p className="mt-3 text-base font-medium text-gray-600">{editorForm.customerName}</p>
                    <p className="mt-1.5 text-sm text-gray-400">{editorForm.address}</p>
                    {isPreviewing ? (
                      <p className="mx-auto mt-6 max-w-xl whitespace-pre-line text-sm leading-7 text-gray-500">{editorForm.coverText}</p>
                    ) : (
                      <textarea value={editorForm.coverText} onChange={(event) => { const el = event.target; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; setEditorForm({ ...editorForm, coverText: event.target.value }); }} className="mx-auto mt-6 min-h-[5rem] w-full max-w-xl resize-none rounded-md border border-gray-200 bg-white px-4 py-3 text-center text-sm leading-7 text-gray-600 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50" />
                    )}
                  </div>
                )}

                {(isPreviewing || activeSection === "Inspection Photos") && (
                  <div className={`mt-10 ${normalizeInspectionPhotos(editorForm.inspectionPhotos).every((p) => !p.image) ? "print:hidden" : ""}`}>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Inspection Photos</p>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      {normalizeInspectionPhotos(editorForm.inspectionPhotos).map((photo, index) => (
                        <div key={photo.label} className={`rounded-lg border border-dashed border-gray-200 bg-gray-50/50 p-4 ${!photo.image ? "print:hidden" : ""}`}>
                          <div className="flex min-h-40 items-center justify-center overflow-hidden rounded-lg bg-white text-sm text-gray-400">
                            {photo.image ? (
                              <Image src={photo.image} alt={photo.label} width={320} height={220} className="h-full max-h-52 w-full object-cover" />
                            ) : (
                              <span>{photo.label}</span>
                            )}
                          </div>
                          {isPreviewing ? (
                            photo.note && <p className="mt-3 whitespace-pre-line text-sm leading-6 text-gray-600">{photo.note}</p>
                          ) : (
                            <>
                              <label className="mt-3 block cursor-pointer rounded-md bg-gray-100 px-4 py-2.5 text-center text-sm font-medium text-gray-600 transition hover:bg-blue-50 hover:text-blue-600">
                                Upload photo
                                <input type="file" accept="image/*" onChange={(event) => handleInspectionPhotoUpload(index, event.target.files?.[0])} className="hidden" />
                              </label>
                              <textarea value={photo.note} onChange={(event) => { const inspectionPhotos = normalizeInspectionPhotos(editorForm.inspectionPhotos); inspectionPhotos[index] = { ...inspectionPhotos[index], note: event.target.value }; setEditorForm({ ...editorForm, inspectionPhotos }); }} className="mt-3 min-h-[4rem] w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-sm leading-6 text-gray-600 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50" placeholder={`${photo.label} notes`} />
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(isPreviewing || activeSection === "Estimate" || activeSection === "Summary") && (
                  <div className="mt-10 grid gap-6 md:grid-cols-2">
                    <div className="rounded-lg bg-gray-50/80 p-5">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Prepared for</p>
                      <p className="mt-2 text-base font-semibold text-gray-800">{editorForm.customerName}</p>
                      <p className="mt-1 text-sm leading-6 text-gray-500">{editorForm.address}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50/80 p-5">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Summary</p>
                      {isPreviewing ? (
                        <p className="mt-2 text-sm leading-6 text-gray-500">{editorForm.summary}</p>
                      ) : (
                        <textarea value={editorForm.summary} onChange={(event) => { const el = event.target; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; setEditorForm({ ...editorForm, summary: event.target.value }); }} className="mt-2 min-h-[4rem] w-full resize-none border-none bg-transparent p-0 text-sm leading-6 text-gray-600 outline-none" />
                      )}
                    </div>
                  </div>
                )}

                {(isPreviewing || activeSection === "Estimate") && (
                  <div className="mt-10">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Scope of Work</p>
                    <div className="mt-4 border-y border-gray-200 py-6">
                      {isPreviewing ? (
                        <>
                          <p className="whitespace-pre-line text-sm leading-7 text-gray-600">{editorForm.scope}</p>
                          {editorForm.notes && <p className="mt-4 whitespace-pre-line text-sm leading-7 text-gray-600">{editorForm.notes}</p>}
                        </>
                      ) : (
                        <>
                          <textarea value={editorForm.scope} onChange={(event) => { const el = event.target; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; setEditorForm({ ...editorForm, scope: event.target.value }); }} onPaste={(event) => { event.preventDefault(); setEditorForm({ ...editorForm, scope: formatPastedProposalText(event.clipboardData.getData("text")) }); }} className="min-h-[18rem] w-full resize-none border-none bg-transparent p-0 text-sm leading-7 text-gray-600 outline-none" />
                          <textarea value={editorForm.notes} onChange={(event) => { const el = event.target; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; setEditorForm({ ...editorForm, notes: event.target.value }); }} className="mt-4 min-h-[4rem] w-full resize-none border-none bg-transparent p-0 text-sm leading-7 text-gray-600 outline-none" placeholder="Additional notes..." />
                        </>
                      )}
                    </div>
                    <div className="mt-5 flex justify-between text-sm">
                      <span className="font-medium text-gray-600">Proposal Total</span>
                      <span className="font-semibold text-gray-800">${(Number(editorForm.total) || 0).toLocaleString()}</span>
                    </div>
                  </div>
                )}

                {isPreviewing && editorForm.showPackages && (
                  <div className="mt-10">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Package Options</p>
                    <div className="mt-4 grid gap-4 lg:grid-cols-3 print:block print:space-y-4">
                      {(["good", "better", "best"] as const).map((option) => {
                        const packageOption = normalizePackages(editorForm.packages)[option];
                        const selected = (activeProposal.selectedOption || "best") === option;
                        const scopeLines = packageOption.scope.split(/\r?\n|✓|•|·|;/).map((l: string) => l.replace(/^[-*✓\s]+/, "").trim()).filter(Boolean);
                        const isScopeExpanded = previewExpandedScopes[option] ?? false;
                        return (
                          <div key={option} className={`rounded-lg border p-5 print:break-inside-avoid ${selected ? "border-blue-400 bg-blue-50/50 shadow-sm" : "border-gray-200 bg-white"}`}>
                            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-gray-400">{option}</p>
                            <p className="mt-2 text-lg font-semibold capitalize text-gray-800">{option} Package</p>
                            <p className="mt-1.5 text-sm text-gray-400">Professional roofing option for this project.</p>
                            <div className={`relative mt-5 overflow-hidden print:!max-h-none ${!isScopeExpanded ? "max-h-32" : ""}`}>
                              <ul className="space-y-2">
                                {scopeLines.map((line: string, i: number) => (
                                  <li key={i} className="flex items-start gap-2 text-sm leading-6 text-gray-700">
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
                              <button type="button" onClick={() => setPreviewExpandedScopes((prev) => ({ ...prev, [option]: !prev[option] }))} className="mt-3 flex items-center gap-1.5 text-sm font-medium text-blue-600 transition hover:text-blue-700 print:hidden">
                                <svg viewBox="0 0 20 20" className={`h-4 w-4 fill-current transition-transform ${isScopeExpanded ? "rotate-180" : ""}`} aria-hidden="true"><path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z" /></svg>
                                {isScopeExpanded ? "Show less" : "See full scope of work"}
                              </button>
                            )}
                            <p className="mt-5 text-xl font-semibold text-gray-800">${packageOption.price.toLocaleString()}</p>
                            <button type="button" onClick={() => saveActiveProposal({ selectedOption: option, total: packageOption.price })} className={`mt-4 w-full rounded-md px-4 py-2.5 text-sm font-medium print:hidden transition ${selected ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600"}`}>{selected ? "Selected" : "Select"}</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {!isPreviewing && editorForm.showPackages && (["GOOD", "BETTER", "BEST"].includes(activeSection)) && (
                  <div className="mt-10">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{activeSection} package</p>
                    <div className="mt-4 rounded-lg border border-gray-200 p-5">
                      <div className="flex items-center justify-between">
                        <p className="text-xl font-semibold capitalize text-gray-800">{activeSection.toLowerCase()} Roofing Package</p>
                        {isPreviewing ? (
                          <span className="rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700">${normalizePackages(editorForm.packages)[activeSection.toLowerCase() as "good" | "better" | "best"].price.toLocaleString()}</span>
                        ) : (
                          <input type="number" value={normalizePackages(editorForm.packages)[activeSection.toLowerCase() as "good" | "better" | "best"].price} onChange={(event) => { const option = activeSection.toLowerCase() as "good" | "better" | "best"; const newPrice = Number(event.target.value) || 0; const newPackages = { ...normalizePackages(editorForm.packages), [option]: { ...normalizePackages(editorForm.packages)[option], price: newPrice } }; setEditorForm({ ...editorForm, packages: newPackages, total: option === "best" ? String(newPrice) : editorForm.total }); }} className="w-32 rounded-md border border-gray-200 px-3 py-2 text-right text-sm text-gray-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50" />
                        )}
                      </div>
                      {isPreviewing ? (
                        <p className="mt-5 whitespace-pre-line text-sm leading-7 text-gray-600">{normalizePackages(editorForm.packages)[activeSection.toLowerCase() as "good" | "better" | "best"].scope}</p>
                      ) : (
                        <textarea value={normalizePackages(editorForm.packages)[activeSection.toLowerCase() as "good" | "better" | "best"].scope} onChange={(event) => { const el = event.target; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; const option = activeSection.toLowerCase() as "good" | "better" | "best"; setEditorForm({ ...editorForm, packages: { ...normalizePackages(editorForm.packages), [option]: { ...normalizePackages(editorForm.packages)[option], scope: event.target.value } } }); }} className="mt-5 min-h-[12rem] w-full resize-none border-none bg-transparent p-0 text-sm leading-7 text-gray-600 outline-none" />
                      )}
                    </div>
                  </div>
                )}

                {(isPreviewing || activeSection === "Estimate" || activeSection === "Summary") && (
                  <div className="mt-10 rounded-lg border border-gray-200 bg-gray-50/60 p-6">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Total</p>
                    <div className="mt-3 flex flex-col justify-between gap-4 md:flex-row md:items-end">
                      <div>
                        {editorForm.showPackages && <p className="text-sm font-medium text-gray-500">Selected Package</p>}
                        {editorForm.showPackages && <p className="mt-1 text-lg font-semibold capitalize text-gray-800">{activeProposal.selectedOption || "best"}</p>}
                        {editorForm.notes && <p className="mt-3 max-w-xl whitespace-pre-line text-sm leading-6 text-gray-500">{editorForm.notes}</p>}
                      </div>
                      <div className="text-left md:text-right">
                        <p className="text-sm font-medium text-gray-500">Total Price</p>
                        <p className="mt-1 text-3xl font-semibold text-gray-800">${(Number(editorForm.total) || 0).toLocaleString()}</p>
                        {editorForm.depositType && Number(editorForm.depositValue) > 0 && Number(editorForm.total) > 0 && (
                          <p className="mt-2 text-sm text-gray-500">
                            Deposit Due: ${(editorForm.depositType === "percentage" ? Math.round(Number(editorForm.total) * Number(editorForm.depositValue) / 100) : Number(editorForm.depositValue)).toLocaleString()}
                            {editorForm.depositType === "percentage" && ` (${editorForm.depositValue}%)`}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {(isPreviewing || activeSection === "Terms and Conditions") && (
                  <div className="mt-10 rounded-lg border border-gray-100 bg-gray-50/60 p-6">
                    <p className="text-base font-semibold text-gray-700">Terms and Conditions</p>
                    {isPreviewing ? (
                      <div className="mt-4 max-h-[28rem] overflow-y-auto rounded-md border border-gray-200 bg-white p-5 text-sm leading-7 text-gray-600">
                        {editorForm.terms.split("\n\n").map((section, index) => (
                          <p key={index} className="mb-4 whitespace-pre-line">{section}</p>
                        ))}
                      </div>
                    ) : (
                      <textarea value={editorForm.terms} onChange={(event) => { const el = event.target; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; setEditorForm({ ...editorForm, terms: event.target.value }); }} className="mt-3 min-h-[6rem] w-full resize-none border-none bg-transparent p-0 text-sm leading-7 text-gray-600 outline-none" />
                    )}
                  </div>
                )}

                {editorBrochures.length > 0 && (isPreviewing || activeSection === "Terms and Conditions") && (
                  <div className="mt-8 rounded-lg border border-gray-100 bg-gray-50/60 p-6">
                    <p className="text-base font-semibold text-gray-700">Product Brochure</p>
                    <div className="mt-4 space-y-4">
                      {editorBrochures.map((file, index) => (
                        <div key={index}>
                          {file.type.startsWith("image/") ? (
                            <img src={file.dataUrl} alt={file.name} className="w-full rounded-lg" />
                          ) : (
                            <div className="rounded-md border border-gray-200 bg-white p-4">
                              <p className="text-sm font-medium text-gray-700">{file.name}</p>
                              <a href={file.dataUrl} download={file.name} className="mt-2 inline-block text-sm text-blue-600 hover:underline">Download {file.name}</a>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(isPreviewing || activeSection === "Estimate" || activeSection === "Summary") && (
                  <div className="mt-8 border-t border-gray-300 pt-8">
                    {/* Customer notes */}
                    <div className="mb-8 print:hidden">
                      <p className="text-xs text-gray-500">Customer notes</p>
                      <div className="mt-1 min-h-[48px] rounded border border-gray-200 p-2" />
                    </div>

                    {/* Customer signature row */}
                    <div className="grid gap-8 md:grid-cols-[1fr_160px]">
                      <div>
                        <div className="min-h-[60px] border-b border-gray-800 pb-1">
                          {(activeProposal.signatureData || activeProposal.signatureDataUrl) ? (
                            <Image src={(activeProposal.signatureData || activeProposal.signatureDataUrl) as string} alt="Customer signature" width={360} height={80} unoptimized className="max-h-[56px] w-auto object-contain" />
                          ) : (
                            <input value={typedSignature} onChange={(event) => setTypedSignature(event.target.value)} className="w-full border-0 bg-transparent px-0 font-serif text-2xl italic text-gray-900 outline-none placeholder:text-gray-300 print:py-3" placeholder="Type full legal name" />
                          )}
                        </div>
                        <p className="mt-1 text-sm text-gray-700">{activeProposal.printedName || activeProposal.signedBy || activeProposal.customerName || ""}</p>
                      </div>
                      <div className="flex flex-col justify-end">
                        <div className="border-b border-gray-800 pb-1">
                          <p className="text-sm text-gray-900">{activeProposal.signedAt ? azDate(activeProposal.signedAt) : ""}</p>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">Date</p>
                      </div>
                    </div>

                    {/* XRP Roofing representative signature */}
                    <div className="mt-10 grid gap-8 md:grid-cols-[1fr_160px]">
                      <div>
                        <div className="border-b border-gray-800 pb-1">
                          <p className="font-serif text-2xl italic text-gray-900">Jonathan Gonzalez</p>
                        </div>
                        <p className="mt-1 text-sm text-gray-700">Jonathan Gonzalez, XRP Roofing</p>
                      </div>
                      <div className="flex flex-col justify-end">
                        <div className="border-b border-gray-800 pb-1">
                          <p className="text-sm text-gray-900">{activeProposal.signedAt ? azDate(activeProposal.signedAt) : azDate(new Date())}</p>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">Date</p>
                      </div>
                    </div>

                    <p className="mt-8 text-xs leading-5 text-gray-500">By signing this document you agree to the statement of works provided by XRP Roofing and in accordance with any terms described within.</p>

                    {/* Deposit summary for PDF */}
                    {activeProposal?.depositType && Number(activeProposal.depositValue) > 0 && (
                      <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-600">Total Amount</span>
                          <span className="font-bold text-gray-900">${(activeProposal.total || 0).toLocaleString()}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-sm">
                          <span className="text-gray-600">Deposit Requested{activeProposal.depositType === "percentage" ? ` (${activeProposal.depositValue}%)` : ""}</span>
                          <span className="font-bold text-gray-900">${(activeProposal.depositType === "percentage" ? Math.round((activeProposal.total || 0) * (activeProposal.depositValue || 0) / 100) : (activeProposal.depositValue || 0)).toLocaleString()}</span>
                        </div>
                        {activeProposal.depositPaidAt && (
                          <div className="mt-2 flex items-center justify-between text-sm">
                            <span className="text-emerald-700">Deposit Paid ({azDate(activeProposal.depositPaidAt)})</span>
                            <span className="font-bold text-emerald-700">${(activeProposal.depositPaidAmount || 0).toLocaleString()}</span>
                          </div>
                        )}
                        <div className="mt-2 flex items-center justify-between border-t border-gray-200 pt-2 text-sm">
                          <span className="font-bold text-gray-700">Remaining Balance</span>
                          <span className="font-bold text-gray-900">${((activeProposal.total || 0) - (activeProposal.depositPaidAmount || 0)).toLocaleString()}</span>
                        </div>
                      </div>
                    )}

                    <button type="button" disabled={!agreementAccepted || !typedSignature.trim()} onClick={handleAcceptProposal} className="hidden print:hidden">Accept & Sign Proposal</button>
                  </div>
                )}

                <div className="mt-12 flex items-end justify-between border-t border-gray-300 pt-4">
                  <div className="text-xs text-gray-500">
                    <p className="font-bold text-gray-700">XRP Roofing</p>
                    <p>ROC #350898</p>
                    <p>info@xrproofing.com</p>
                  </div>
                  <div className="text-right text-xl font-bold text-blue-700">XRP<br /><span className="text-xs tracking-[0.25em]">ROOFING</span></div>
                </div>
              </div>
            </div>
          </main>
        </div>
        {showOfflineSignModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/50 p-4">
            <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-6 pt-5 pb-3">
                <h2 className="text-lg font-bold text-gray-900">Mark as Signed Offline</h2>
                <button type="button" onClick={() => setShowOfflineSignModal(false)} className="text-2xl text-gray-400 hover:text-gray-600">&times;</button>
              </div>
              <div className="px-6 pb-5">
                <p className="text-sm text-gray-600">Capture the customer&apos;s handwritten signature. The proposal will be locked and marked as accepted.</p>

                {/* Customer Name */}
                <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-gray-500">
                  Customer Full Name (Printed)
                  <input value={offlineSignerName} onChange={(e) => setOfflineSignerName(e.target.value)} className="mt-1.5 w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-800 outline-none focus:border-blue-500" placeholder="Customer full name" />
                </label>

                {/* Signature Mode Tabs */}
                <div className="mt-4 flex rounded-lg border border-gray-200 overflow-hidden">
                  <button type="button" onClick={() => setOfflineSignMode("draw")} className={`flex-1 px-4 py-2 text-xs font-bold transition ${offlineSignMode === "draw" ? "bg-blue-600 text-white" : "bg-gray-50 text-gray-600 hover:bg-gray-100"}`}>✏️ Draw Signature</button>
                  <button type="button" onClick={() => setOfflineSignMode("type")} className={`flex-1 px-4 py-2 text-xs font-bold transition ${offlineSignMode === "type" ? "bg-blue-600 text-white" : "bg-gray-50 text-gray-600 hover:bg-gray-100"}`}>⌨️ Type Signature</button>
                </div>

                {/* Draw Mode — Signature Canvas */}
                {offlineSignMode === "draw" && (
                  <div className="mt-3">
                    <div className="relative rounded-lg border-2 border-dashed border-gray-300 bg-gray-50">
                      <canvas
                        ref={(el) => {
                          offlineSigCanvasRef.current = el;
                          if (el && !el.dataset.inited) {
                            el.dataset.inited = "1";
                            const ctx = el.getContext("2d");
                            if (ctx) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, el.width, el.height); }
                          }
                        }}
                        width={440}
                        height={140}
                        className="w-full cursor-crosshair touch-none rounded-lg"
                        onPointerDown={(e) => {
                          offlineSigDrawingRef.current = true;
                          offlineSigHasDrawnRef.current = true;
                          const canvas = e.currentTarget;
                          const rect = canvas.getBoundingClientRect();
                          const ctx = canvas.getContext("2d");
                          if (!ctx) return;
                          ctx.beginPath();
                          ctx.moveTo((e.clientX - rect.left) * (canvas.width / rect.width), (e.clientY - rect.top) * (canvas.height / rect.height));
                          canvas.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                          if (!offlineSigDrawingRef.current) return;
                          const canvas = e.currentTarget;
                          const rect = canvas.getBoundingClientRect();
                          const ctx = canvas.getContext("2d");
                          if (!ctx) return;
                          ctx.lineWidth = 2.5;
                          ctx.lineCap = "round";
                          ctx.strokeStyle = "#1a1a1a";
                          ctx.lineTo((e.clientX - rect.left) * (canvas.width / rect.width), (e.clientY - rect.top) * (canvas.height / rect.height));
                          ctx.stroke();
                        }}
                        onPointerUp={() => { offlineSigDrawingRef.current = false; }}
                        onPointerLeave={() => { offlineSigDrawingRef.current = false; }}
                      />
                      <p className="absolute bottom-2 left-3 text-[10px] text-gray-400 pointer-events-none">Sign here using finger or mouse</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const canvas = offlineSigCanvasRef.current;
                        if (!canvas) return;
                        const ctx = canvas.getContext("2d");
                        if (ctx) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
                        offlineSigHasDrawnRef.current = false;
                      }}
                      className="mt-2 text-xs font-bold text-red-500 hover:text-red-700"
                    >
                      Clear Signature
                    </button>
                  </div>
                )}

                {/* Type Mode */}
                {offlineSignMode === "type" && (
                  <div className="mt-3">
                    <input
                      value={offlineTypedSig}
                      onChange={(e) => setOfflineTypedSig(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-4 py-4 text-2xl italic text-gray-800 outline-none focus:border-blue-500"
                      style={{ fontFamily: "Georgia, serif" }}
                      placeholder="Type signature here"
                    />
                    {offlineTypedSig && (
                      <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Preview</p>
                        <p className="text-2xl italic text-gray-800" style={{ fontFamily: "Georgia, serif" }}>{offlineTypedSig}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Date/Time display */}
                <div className="mt-4 flex items-center gap-4 text-xs text-gray-500">
                  <span>Date: {new Date().toLocaleDateString()}</span>
                  <span>Time: {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>

                {/* Actions */}
                <div className="mt-5 flex items-center gap-3">
                  <button type="button" onClick={() => setShowOfflineSignModal(false)} className="flex-1 rounded-lg border border-gray-200 px-5 py-3 text-sm font-bold text-gray-600">Cancel</button>
                  <button
                    type="button"
                    onClick={handleMarkSignedOffline}
                    disabled={!offlineSignerName.trim() || (offlineSignMode === "draw" && !offlineSigHasDrawnRef.current) || (offlineSignMode === "type" && !offlineTypedSig.trim())}
                    className="flex-1 rounded-lg bg-orange-500 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Confirm Signed Offline
                  </button>
                </div>
                <p className="mt-3 text-xs text-gray-400">Signature, printed name, date and time will be saved with the proposal.</p>
              </div>
            </div>
          </div>
        )}
        {/* Deposit Request Modal */}
        {showDepositModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/50">
            <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-900">Deposit request</h2>
                <button type="button" onClick={() => setShowDepositModal(false)} className="text-2xl text-gray-400 hover:text-gray-600">&times;</button>
              </div>

              {/* Estimate total */}
              <div className="mt-5 flex items-center justify-between">
                <span className="text-sm text-gray-600">Estimate total</span>
                <span className="text-sm font-bold text-gray-900">${(Number(editorForm.total) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>

              {/* Percent / Fixed tabs */}
              <div className="mt-5 flex border-b border-gray-200">
                <button type="button" onClick={() => setEditorForm({ ...editorForm, depositType: "percentage" })} className={`flex-1 pb-2 text-center text-sm font-bold transition ${editorForm.depositType === "percentage" ? "border-b-2 border-red-500 text-gray-900" : "text-gray-400 hover:text-gray-600"}`}>Percent (%)</button>
                <button type="button" onClick={() => setEditorForm({ ...editorForm, depositType: "fixed" })} className={`flex-1 pb-2 text-center text-sm font-bold transition ${editorForm.depositType === "fixed" ? "border-b-2 border-red-500 text-gray-900" : "text-gray-400 hover:text-gray-600"}`}>Fixed ($)</button>
              </div>

              {/* Value input */}
              <div className="mt-5 flex items-center justify-between">
                <span className="text-sm text-gray-600">{editorForm.depositType === "fixed" ? "Set amount" : "Set percentage"}</span>
                <input type="number" value={editorForm.depositValue} onChange={(event) => setEditorForm({ ...editorForm, depositValue: event.target.value })} placeholder={editorForm.depositType === "fixed" ? "0" : "0"} className="w-24 border-b border-gray-300 bg-transparent text-right text-sm font-bold text-gray-900 outline-none focus:border-gray-700" />
              </div>

              {/* Deposit amount (calculated) */}
              <div className="mt-4 flex items-center justify-between">
                <span className="text-sm text-gray-600">Deposit amount</span>
                <span className="text-sm font-bold text-gray-900">{(editorForm.depositType === "percentage" ? Math.round(Number(editorForm.total || 0) * Number(editorForm.depositValue || 0) / 100) : Number(editorForm.depositValue || 0)).toLocaleString()}</span>
              </div>

              {/* Due date */}
              <div className="mt-4 flex items-center justify-between">
                <span className="text-sm text-gray-600">Due date</span>
                <input type="date" value={editorForm.depositDueDate} onChange={(event) => setEditorForm({ ...editorForm, depositDueDate: event.target.value })} className="border-b border-gray-300 bg-transparent text-right text-sm font-bold text-gray-900 outline-none focus:border-gray-700" />
              </div>

              {/* Add to future estimates toggle */}
              <button type="button" onClick={() => setEditorForm({ ...editorForm, depositAddToFuture: !editorForm.depositAddToFuture })} className="mt-5 flex cursor-pointer items-center gap-3">
                <div className={`relative h-5 w-9 rounded-full transition ${editorForm.depositAddToFuture ? "bg-teal-500" : "bg-gray-300"}`}>
                  <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${editorForm.depositAddToFuture ? "translate-x-4" : "translate-x-0.5"}`} />
                </div>
                <span className="text-sm text-gray-600">Setting: Add to future estimates</span>
              </button>

              {/* Deposit amount paid */}
              <div className="mt-5 flex items-center justify-between border-t border-gray-100 pt-4">
                <span className="text-sm text-gray-600">Deposit amount paid</span>
                <span className="text-sm font-bold text-gray-900">${(activeProposal?.depositPaidAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>

              {/* Actions */}
              <div className="mt-6 flex items-center gap-4">
                <button type="button" onClick={() => { saveActiveProposal(); setShowDepositModal(false); }} className="flex-1 rounded-lg bg-teal-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-teal-700">Save</button>
                <button type="button" onClick={() => { setEditorForm({ ...editorForm, depositType: "", depositValue: "", depositDueDate: "", depositAddToFuture: false }); saveActiveProposal({ depositType: undefined, depositValue: undefined, depositDueDate: undefined, depositAddToFuture: undefined }); setShowDepositModal(false); }} className="text-sm font-bold text-red-500 hover:text-red-700">Cancel this request</button>
              </div>
            </div>
          </div>
        )}

        {showSendModal && (
          <div className="fixed inset-0 z-50 flex justify-end bg-gray-950/50">
            <div className="flex h-full w-full max-w-[530px] flex-col bg-white shadow-2xl">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-7 py-5 shadow-sm">
                <div className="flex items-center gap-3 text-xl font-bold text-gray-900">
                  <span className="text-blue-600">✉</span>
                  <span>{activeProposal?.status !== "Draft" ? "Resend proposal" : "Send proposal"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setIsPreviewing(true)} className="hidden rounded-full border border-blue-600 px-4 py-2 text-xs font-bold text-blue-600 sm:inline-flex">↗ Preview</button>
                  <button type="button" onClick={() => { if (activeProposal?.status !== "Draft" && !window.confirm("This proposal has already been sent. Are you sure you want to resend it?")) return; handleSendProposal(); }} disabled={sendingProposal} className="rounded-full bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm disabled:opacity-50">{sendingProposal ? "Sending…" : activeProposal?.status !== "Draft" ? "✈ Resend" : "✈ Send"}</button>
                  <button type="button" onClick={() => setShowSendModal(false)} className="text-2xl text-gray-500">×</button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                <div className="bg-gray-50 px-7 py-6">
                  <div className="grid grid-cols-[44px_1fr] gap-4">
                    <p className="pt-3 text-sm font-bold text-gray-900">To:</p>
                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                      <input value={sendForm.toName} onChange={(event) => setSendForm({ ...sendForm, toName: event.target.value })} className="w-full border-none text-sm font-bold text-gray-900 outline-none" />
                      <div className="mt-3 flex items-center justify-between gap-3 text-sm text-gray-600">
                        <span>Customer</span>
                        <input value={sendForm.toEmail} onChange={(event) => setSendForm({ ...sendForm, toEmail: event.target.value })} className="max-w-[230px] border-none text-right text-sm text-gray-600 outline-none" />
                      </div>
                    </div>
                  </div>
                  <label className="ml-[60px] mt-3 block text-sm font-bold text-blue-600">
                    Add Cc recipients...
                    <input value={sendForm.ccRecipients} onChange={(event) => setSendForm({ ...sendForm, ccRecipients: event.target.value })} className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal text-gray-700 outline-none" placeholder="email@example.com, another@example.com" />
                  </label>
                </div>
                <div className="space-y-5 px-7 py-6">
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-bold text-gray-900">Email Template</p>
                      <button type="button" onClick={() => { setShowSendModal(false); setActiveTab("templates"); }} className="text-xs font-bold text-blue-600">⊞ Manage templates</button>
                    </div>
                    <select value={sendForm.emailTemplateId} onChange={(event) => handleSelectEmailTemplate(event.target.value, sendForm.toName)} className="w-full rounded border border-gray-200 px-4 py-3 text-sm font-bold outline-none">
                      {emailTemplates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </div>
                  <label className="block text-sm font-bold text-gray-900">
                    Subject*
                    <input required value={sendForm.subject} onChange={(event) => setSendForm({ ...sendForm, subject: event.target.value })} className="mt-3 w-full rounded border border-gray-200 px-4 py-3 text-sm font-normal outline-none" />
                  </label>
                  <label className="block text-sm font-bold text-gray-900">
                    Message*
                    <div className="mt-3 flex items-center gap-6 border border-gray-200 px-4 py-3 text-sm font-bold text-gray-800">
                      <span>B</span>
                      <span className="italic">I</span>
                      <span className="underline">U</span>
                      <span>🔗</span>
                      <span>Dynamic fields⌄</span>
                      <span>Attach</span>
                    </div>
                    <textarea required value={sendForm.message} onChange={(event) => setSendForm({ ...sendForm, message: event.target.value })} className="min-h-56 w-full border-x border-b border-gray-200 px-5 py-4 text-sm font-normal leading-7 outline-none" />
                  </label>
                  <div className="flex justify-end -mt-2 mb-2"><AiWriteButton getText={() => sendForm.message} onReplace={(t) => setSendForm({ ...sendForm, message: t })} context="proposal email message to a roofing customer" /></div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="rounded-t-xl bg-gray-200 py-5 text-center">
                      <Image src="/images/logo.jpeg" alt="XRP Roofing" width={112} height={60} className="mx-auto h-auto bg-white" />
                    </div>
                    <div className="rounded-b-xl bg-white p-5 text-sm leading-7 text-gray-700">
                      <p className="whitespace-pre-line">{sendForm.message}</p>
                      <div className="mt-5 rounded-lg border border-gray-200 p-4 text-center">
                        <Image src={editorForm.coverPhoto || "/images/logo.jpeg"} alt="Proposal cover" width={180} height={100} className="mx-auto max-h-28 w-auto object-contain" />
                        <p className="mt-3 font-bold text-blue-700">{editorForm.title}</p>
                        <p className="mt-2 whitespace-pre-line text-xs leading-5 text-gray-600">{editorForm.coverText}</p>
                      </div>
                      <div className="mt-5 text-center">
                        <span className="inline-block rounded-full bg-blue-600 px-5 py-2 text-sm font-bold text-white">View Proposal</span>
                      </div>
                    </div>
                  </div>
                  {activeProposal?.sentAt && activeProposal.status !== "Draft" && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                      <p className="font-bold">Previously sent via Email</p>
                      <p>Sent: {azDateTime(activeProposal.sentAt)}{activeProposal.sentBy ? ` by ${activeProposal.sentBy}` : ""}{activeProposal.sentToEmail ? ` to ${activeProposal.sentToEmail}` : ""}</p>
                    </div>
                  )}
                  {sendNotice && <p className="whitespace-pre-line rounded-lg bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{sendNotice}</p>}
                </div>
              </div>
              <div className="sticky bottom-0 z-10 flex items-center justify-between border-t border-gray-200 bg-white px-7 py-4 shadow-[0_-12px_30px_rgba(15,23,42,0.08)]">
                <button type="button" onClick={() => setShowSendModal(false)} className="text-sm font-bold text-blue-600">Cancel</button>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setIsPreviewing(true)} className="rounded-full border border-blue-600 px-6 py-3 text-sm font-bold text-blue-600">↗ Preview</button>
                  <button type="button" onClick={() => { if (activeProposal?.status !== "Draft" && !window.confirm("This proposal has already been sent. Are you sure you want to resend it?")) return; handleSendProposal(); }} disabled={sendingProposal} className="rounded-full bg-blue-600 px-6 py-3 text-sm font-bold text-white disabled:opacity-50">{sendingProposal ? "Sending…" : activeProposal?.status !== "Draft" ? "✈ Resend proposal" : "✈ Send proposal"}</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SMS Send Modal ── */}
        {showSmsSendModal && (
          <div className="fixed inset-0 z-50 flex justify-end bg-gray-950/50">
            <div className="flex h-full w-full max-w-[530px] flex-col bg-white shadow-2xl">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-7 py-5 shadow-sm">
                <div className="flex items-center gap-3 text-xl font-bold text-gray-900">
                  <span className="text-green-600">💬</span>
                  <span>{activeProposal?.status !== "Draft" ? "Resend proposal via SMS" : "Send proposal via SMS"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => { if (activeProposal?.status !== "Draft" && !window.confirm("This proposal has already been sent. Are you sure you want to resend it?")) return; handleSendProposalSms(); }} disabled={sendingSms || !smsForm.toPhone.trim()} className="rounded-full bg-green-600 px-4 py-2 text-xs font-bold text-white shadow-sm disabled:opacity-50">{sendingSms ? "Sending…" : activeProposal?.status !== "Draft" ? "📤 Resend SMS" : "📤 Send SMS"}</button>
                  <button type="button" onClick={() => setShowSmsSendModal(false)} className="text-2xl text-gray-500">×</button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                <div className="bg-gray-50 px-7 py-6">
                  <div className="grid grid-cols-[44px_1fr] gap-4">
                    <p className="pt-3 text-sm font-bold text-gray-900">To:</p>
                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                      <p className="text-sm font-bold text-gray-900">{activeProposal?.customerName || "Customer"}</p>
                      <input value={smsForm.toPhone} onChange={(event) => setSmsForm({ ...smsForm, toPhone: event.target.value })} className="mt-2 w-full border-none text-sm text-gray-600 outline-none" placeholder="Customer phone number" />
                    </div>
                  </div>
                </div>
                <div className="space-y-5 px-7 py-6">
                  {twilioLines.length > 0 && (
                    <div>
                      <p className="mb-2 text-sm font-bold text-gray-900">Send from</p>
                      <select value={smsForm.fromNumber} onChange={(event) => setSmsForm({ ...smsForm, fromNumber: event.target.value })} className="w-full rounded border border-gray-200 px-4 py-3 text-sm font-bold outline-none">
                        {twilioLines.map((line) => (
                          <option key={line.key} value={line.number}>{line.label} ({line.number})</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="block text-sm font-bold text-gray-900">
                    <div className="flex items-center justify-between"><span>Message*</span><AiWriteButton getText={() => smsForm.message} onReplace={(t) => setSmsForm({ ...smsForm, message: t })} context="SMS proposal message to a roofing customer" /></div>
                    <textarea required value={smsForm.message} onChange={(event) => setSmsForm({ ...smsForm, message: event.target.value })} className="mt-3 min-h-56 w-full rounded border border-gray-200 px-5 py-4 text-sm font-normal leading-7 outline-none" placeholder="Type your message to the customer..." />
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Preview — what customer will receive:</p>
                    <div className="rounded-lg bg-white p-4 text-sm leading-7 text-gray-800">
                      <p className="whitespace-pre-line">{smsForm.message}</p>
                      <p className="mt-3 text-blue-600 underline">{activeProposal ? `${window.location.origin}/proposal/${encodeURIComponent(activeProposal.id)}` : "Proposal link"}</p>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">The proposal link is automatically appended to your message.</p>
                  </div>
                  {activeProposal?.sentViaSms && activeProposal.smsSentAt && (
                    <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                      <p className="font-bold">Previously sent via SMS</p>
                      <p>Sent: {azDateTime(activeProposal.smsSentAt)}</p>
                      {activeProposal.smsSentBy && <p>By: {activeProposal.smsSentBy}</p>}
                      {activeProposal.smsSentToPhone && <p>To: {activeProposal.smsSentToPhone}</p>}
                    </div>
                  )}
                </div>
              </div>
              <div className="sticky bottom-0 z-10 flex items-center justify-between border-t border-gray-200 bg-white px-7 py-4 shadow-[0_-12px_30px_rgba(15,23,42,0.08)]">
                <button type="button" onClick={() => setShowSmsSendModal(false)} className="text-sm font-bold text-green-600">Cancel</button>
                <button type="button" onClick={() => { if (activeProposal?.status !== "Draft" && !window.confirm("This proposal has already been sent. Are you sure you want to resend it?")) return; handleSendProposalSms(); }} disabled={sendingSms || !smsForm.toPhone.trim()} className="rounded-full bg-green-600 px-6 py-3 text-sm font-bold text-white disabled:opacity-50">{sendingSms ? "Sending…" : activeProposal?.status !== "Draft" ? "📤 Resend proposal via SMS" : "📤 Send proposal via SMS"}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Proposal Send Confirmation Modal ── */}
        {sendConfirmation && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-gray-950/50 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl">
              {sendConfirmation.type === "success" ? (
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                  <svg className="h-10 w-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                </div>
              ) : (
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
                  <svg className="h-10 w-10 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </div>
              )}
              <h3 className="mt-5 text-xl font-bold text-gray-900">{sendConfirmation.type === "success" ? "Proposal Sent Successfully" : "Failed to Send Proposal"}</h3>
              <p className="mt-2 text-sm text-gray-600">{sendConfirmation.type === "success" ? `Your proposal was successfully sent to ${sendConfirmation.customerName}.` : sendConfirmation.message}</p>
              <div className="mt-6 flex justify-center gap-3">
                {sendConfirmation.type === "success" && (
                  <button type="button" onClick={() => setSendConfirmation(null)} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700">View Proposal</button>
                )}
                <button type="button" onClick={() => setSendConfirmation(null)} className="rounded-lg border border-gray-200 px-5 py-2.5 text-sm font-bold text-gray-700 transition hover:bg-gray-50">Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 font-sans">
      <BackToJobsLink />
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-[#072C6B] via-[#0A3D91] to-[#2B6BC4] p-3 text-white shadow-2xl shadow-blue-950/20 sm:rounded-[2rem] sm:p-6">
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-orange-400/20 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-2 sm:gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-orange-300 sm:text-sm">Proposal Center</p>
            <h1 className="text-xl font-bold tracking-tight sm:text-3xl">Proposals</h1>
            <p className="crm-board-subtitle mt-1 hidden max-w-2xl text-sm font-medium leading-6 text-blue-100 sm:mt-2 sm:block">Create, send, track, and manage branded XRP Roofing proposals from one workspace.</p>
          </div>
          <button type="button" onClick={() => setShowCreateForm((current) => !current)} className="w-fit rounded-lg bg-orange-500 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-orange-600 sm:px-5 sm:py-3 sm:text-sm">⊕ Proposal</button>
        </div>
      </div>

      <div className="sticky top-16 z-20 -mx-3 border-b border-gray-200 bg-white/95 px-3 backdrop-blur-sm sm:-mx-5 sm:px-5">
        <div className="rounded-lg border border-white/70 bg-white/95 px-3 pt-2 shadow-sm sm:px-5 sm:pt-4">
          <div className="flex gap-4 text-xs font-bold sm:gap-8 sm:text-sm">
            <button type="button" onClick={() => { setActiveTab("proposals"); setProposalFilter("all"); }} className={`px-1 pb-4 ${activeTab === "proposals" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-600"}`}>Proposals</button>
            <button type="button" onClick={() => { setActiveTab("drafts"); setProposalFilter("drafts"); }} className={`px-1 pb-4 ${activeTab === "drafts" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-600"}`}>Drafts</button>
            <button type="button" onClick={() => setActiveTab("templates")} className={`px-1 pb-4 ${activeTab === "templates" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-600"}`}>Templates</button>
            <button type="button" onClick={() => setActiveTab("trash")} className={`px-1 pb-4 ${activeTab === "trash" ? "border-b-2 border-red-600 text-red-600" : "text-gray-600"}`}>Trash{trashedProposals.length > 0 ? ` (${trashedProposals.length})` : ""}</button>
            <button type="button" onClick={() => setActiveTab("settings")} className={`px-1 pb-4 ${activeTab === "settings" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-600"}`}>Settings</button>
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-white/70 bg-white/95 p-4 shadow-sm">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row">
            <div className="relative max-w-md flex-1">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">⌕</span>
              <input value={proposalSearch} onChange={(event) => setProposalSearch(event.target.value)} className="w-full rounded-lg border border-gray-200 bg-gray-50 py-3 pl-10 pr-4 text-sm outline-none focus:border-blue-500 focus:bg-white" placeholder="Search for a customer or address..." />
            </div>
            <button className="w-fit rounded-full bg-gray-50 px-5 py-3 text-sm font-bold text-blue-600">▽ Filter</button>
          </div>
          <div className="flex overflow-hidden rounded-lg border border-gray-200">
            <button className="bg-blue-50 px-4 py-3 text-xl text-blue-700 ring-1 ring-blue-500">▦</button>
            <button className="px-4 py-3 text-xl text-gray-500">☰</button>
          </div>
        </div>
      </div>
      </div>

      {deletedProposal && (
        <div className="flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-bold text-orange-900">
          <span>Deleted proposal for {deletedProposal.customerName}.</span>
          <button type="button" onClick={handleUndoDelete} className="rounded-full bg-white px-4 py-2 text-blue-700 shadow-sm">Undo</button>
        </div>
      )}

      {activeTab === "templates" && (
        <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
          <form onSubmit={handleCreateTemplate} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold text-blue-700">Create proposal template</h2>
            <div className="mt-4 space-y-3">
              <input required value={templateForm.label} onChange={(event) => setTemplateForm({ ...templateForm, label: event.target.value })} className="w-full rounded-lg border border-gray-200 px-4 py-3 text-sm outline-none" placeholder="Template name" />
              <input value={templateForm.description} onChange={(event) => setTemplateForm({ ...templateForm, description: event.target.value })} className="w-full rounded-lg border border-gray-200 px-4 py-3 text-sm outline-none" placeholder="Short description" />
              <input required value={templateForm.title} onChange={(event) => setTemplateForm({ ...templateForm, title: event.target.value })} className="w-full rounded-lg border border-gray-200 px-4 py-3 text-sm outline-none" placeholder="Proposal title" />
              <textarea value={templateForm.summary} onChange={(event) => setTemplateForm({ ...templateForm, summary: event.target.value })} className="min-h-28 w-full rounded-lg border border-gray-200 px-4 py-3 text-sm outline-none" placeholder="Proposal summary" />
              <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Template package options</p>
                {(["good", "better", "best"] as const).map((option) => (
                  <div key={option} className="rounded-lg bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold uppercase text-blue-700">{option}</p>
                      <input type="number" value={normalizePackages(templateForm.packages)[option].price} onChange={(event) => setTemplateForm({ ...templateForm, packages: { ...normalizePackages(templateForm.packages), [option]: { ...normalizePackages(templateForm.packages)[option], price: Number(event.target.value) || 0 } } })} className="w-28 rounded-lg border border-gray-200 px-3 py-2 text-right text-xs font-bold text-blue-700 outline-none" placeholder="Price" />
                    </div>
                    <textarea value={normalizePackages(templateForm.packages)[option].scope} onChange={(event) => setTemplateForm({ ...templateForm, packages: { ...normalizePackages(templateForm.packages), [option]: { ...normalizePackages(templateForm.packages)[option], scope: event.target.value } } })} className="mt-2 min-h-20 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs leading-5 text-gray-600 outline-none" placeholder={`${option.toUpperCase()} included services`} />
                  </div>
                ))}
              </div>
              <textarea value={templateForm.terms} onChange={(event) => setTemplateForm({ ...templateForm, terms: event.target.value })} className="min-h-36 w-full rounded-lg border border-gray-200 px-4 py-3 text-sm outline-none" placeholder="Default terms and conditions" />
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Include Brochure</p>
                    <p className="mt-1 text-xs text-gray-400">Attach brochure files to this template</p>
                  </div>
                  <button type="button" onClick={() => setTemplateForm({ ...templateForm, brochureEnabled: !templateForm.brochureEnabled })} className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition ${templateForm.brochureEnabled ? "bg-blue-600" : "bg-gray-300"}`}>
                    <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition ${templateForm.brochureEnabled ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>
                {templateForm.brochureEnabled && (
                  <div className="mt-3 space-y-2">
                    {(templateForm.brochures || []).map((file, index) => (
                      <div key={index} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs font-bold text-gray-700">
                        <span className="truncate">{file.name}</span>
                        <button type="button" onClick={() => setTemplateForm({ ...templateForm, brochures: (templateForm.brochures || []).filter((_, i) => i !== index) })} className="ml-2 shrink-0 text-red-500 hover:text-red-700">Remove</button>
                      </div>
                    ))}
                    <label className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-white px-4 py-3 text-xs font-bold text-gray-500 transition hover:border-blue-400 hover:text-blue-600">
                      + Add brochure file (PDF, image)
                      <input type="file" accept="image/*,.pdf" multiple className="hidden" onChange={(event) => {
                        const files = event.target.files;
                        if (!files) return;
                        Array.from(files).forEach((file) => {
                          if (file.size > 2 * 1024 * 1024) { alert(`File "${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max size is 2 MB.`); return; }
                          const reader = new FileReader();
                          reader.onload = () => {
                            setTemplateForm((prev) => ({ ...prev, brochures: [...(prev.brochures || []), { name: file.name, dataUrl: reader.result as string, type: file.type }] }));
                          };
                          reader.readAsDataURL(file);
                        });
                        event.target.value = "";
                      }} />
                    </label>
                  </div>
                )}
              </div>
              <button className="w-full rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white">Save template</button>
            </div>
          </form>
          <div className="grid gap-3">
            {templates.map((template) => (
              <div key={template.id} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <input value={template.label} onChange={(event) => handleUpdateTemplate({ ...template, label: event.target.value })} className="w-full border-none bg-transparent text-lg font-bold text-blue-700 outline-none" />
                    <input value={template.description} onChange={(event) => handleUpdateTemplate({ ...template, description: event.target.value })} className="mt-1 w-full border-none bg-transparent text-sm text-gray-500 outline-none" />
                  </div>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">Saved</span>
                </div>
                <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-gray-500">
                  Proposal title
                  <input value={template.title} onChange={(event) => handleUpdateTemplate({ ...template, title: event.target.value })} className="mt-2 w-full rounded-lg border border-gray-200 px-4 py-3 text-sm normal-case tracking-normal text-gray-800 outline-none" />
                </label>
                <label className="mt-3 block text-xs font-bold uppercase tracking-wider text-gray-500">
                  Proposal summary
                  <textarea value={template.summary} onChange={(event) => handleUpdateTemplate({ ...template, summary: event.target.value })} className="mt-2 min-h-24 w-full rounded-lg border border-gray-200 px-4 py-3 text-sm normal-case leading-6 tracking-normal text-gray-600 outline-none" />
                </label>
                <label className="mt-3 block text-xs font-bold uppercase tracking-wider text-gray-500">
                  Terms and Conditions
                  <textarea value={template.terms} onChange={(event) => handleUpdateTemplate({ ...template, terms: event.target.value })} className="mt-2 min-h-32 w-full rounded-lg border border-gray-200 px-4 py-3 text-sm normal-case leading-6 tracking-normal text-gray-600 outline-none" />
                </label>
                <div className="mt-4 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-500">GOOD / BETTER / BEST packages</p>
                  {(["good", "better", "best"] as const).map((option) => {
                    const templatePackages = normalizePackages(template.packages);
                    return (
                      <div key={option} className="rounded-lg bg-white p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-bold uppercase text-blue-700">{option}</p>
                          <input type="number" value={templatePackages[option].price} onChange={(event) => handleUpdateTemplate({ ...template, packages: { ...templatePackages, [option]: { ...templatePackages[option], price: Number(event.target.value) || 0 } } })} className="w-32 rounded-lg border border-gray-200 px-3 py-2 text-right text-sm font-bold text-blue-700 outline-none" />
                        </div>
                        <textarea value={templatePackages[option].scope} onChange={(event) => handleUpdateTemplate({ ...template, packages: { ...templatePackages, [option]: { ...templatePackages[option], scope: event.target.value } } })} className="mt-2 min-h-24 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm leading-6 text-gray-600 outline-none" />
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Include Brochure</p>
                      <p className="mt-1 text-xs text-gray-400">Attach brochure files to proposals using this template</p>
                    </div>
                    <button type="button" onClick={() => handleUpdateTemplate({ ...template, brochureEnabled: !template.brochureEnabled })} className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition ${template.brochureEnabled ? "bg-blue-600" : "bg-gray-300"}`}>
                      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition ${template.brochureEnabled ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                  </div>
                  {template.brochureEnabled && (
                    <div className="mt-3 space-y-2">
                      {(template.brochures || []).map((file, index) => (
                        <div key={index} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs font-bold text-gray-700">
                          <span className="truncate">{file.name}</span>
                          <button type="button" onClick={() => handleUpdateTemplate({ ...template, brochures: (template.brochures || []).filter((_, i) => i !== index) })} className="ml-2 shrink-0 text-red-500 hover:text-red-700">Remove</button>
                        </div>
                      ))}
                      <label className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-white px-4 py-3 text-xs font-bold text-gray-500 transition hover:border-blue-400 hover:text-blue-600">
                        + Add brochure file (PDF, image)
                        <input type="file" accept="image/*,.pdf" multiple className="hidden" onChange={(event) => {
                          const files = event.target.files;
                          if (!files) return;
                          const validFiles = Array.from(files).filter((file) => {
                            if (file.size > 2 * 1024 * 1024) { alert(`File "${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max size is 2 MB.`); return false; }
                            return true;
                          });
                          if (!validFiles.length) { event.target.value = ""; return; }
                          const newBrochures = [...(template.brochures || [])];
                          let remaining = validFiles.length;
                          validFiles.forEach((file) => {
                            const reader = new FileReader();
                            reader.onload = () => {
                              newBrochures.push({ name: file.name, dataUrl: reader.result as string, type: file.type });
                              remaining--;
                              if (remaining === 0) handleUpdateTemplate({ ...template, brochures: newBrochures });
                            };
                            reader.readAsDataURL(file);
                          });
                          event.target.value = "";
                        }} />
                      </label>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600">Email Templates</p>
                <h2 className="mt-1 text-xl font-bold text-blue-700">Proposal email templates</h2>
                <p className="mt-1 text-sm text-gray-500">Saved email templates used when sending proposals. Use <code className="rounded bg-gray-100 px-1 text-xs">{"{{customer_name}}"}</code> for dynamic customer name.</p>
              </div>
              <button type="button" onClick={() => {
                const newId = `email-${Date.now()}`;
                setEmailTemplates((prev) => [...prev, { id: newId, label: "New Email Template", subject: "Proposal for {{customer_name}}", message: "Dear {{customer_name}},\n\n\n\nThank you,\nXRP Roofing" }]);
              }} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700">+ New email template</button>
            </div>
            <div className="grid gap-3">
              {emailTemplates.map((et) => (
                <div key={et.id} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <label className="flex-1 text-xs font-bold uppercase tracking-wider text-gray-500">
                      Template name
                      <input value={et.label} onChange={(event) => setEmailTemplates((prev) => prev.map((t) => t.id === et.id ? { ...t, label: event.target.value } : t))} className="mt-2 w-full border-none bg-transparent text-lg font-bold normal-case tracking-normal text-blue-700 outline-none" />
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">Saved</span>
                      <button type="button" onClick={() => { if (window.confirm(`Delete email template "${et.label}"?`)) setEmailTemplates((prev) => prev.filter((t) => t.id !== et.id)); }} className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-600 hover:bg-red-100">Delete</button>
                    </div>
                  </div>
                  <label className="mt-3 block text-xs font-bold uppercase tracking-wider text-gray-500">
                    Subject line
                    <input value={et.subject} onChange={(event) => setEmailTemplates((prev) => prev.map((t) => t.id === et.id ? { ...t, subject: event.target.value } : t))} className="mt-2 w-full rounded-lg border border-gray-200 px-4 py-3 text-sm normal-case tracking-normal text-gray-800 outline-none" />
                  </label>
                  <label className="mt-3 block text-xs font-bold uppercase tracking-wider text-gray-500">
                    Email body
                    <textarea value={et.message} onChange={(event) => setEmailTemplates((prev) => prev.map((t) => t.id === et.id ? { ...t, message: event.target.value } : t))} className="mt-2 min-h-32 w-full rounded-lg border border-gray-200 px-4 py-3 text-sm normal-case leading-6 tracking-normal text-gray-600 outline-none" />
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === "trash" && (
        <div className="space-y-5">
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-600">Trash Bin</p>
                <h2 className="mt-2 text-2xl font-bold text-blue-700">Deleted Proposals</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">Deleted proposals are kept here for {trashRetentionDays} days. You can restore them or permanently delete them.</p>
              </div>
              {trashedProposals.length > 0 && (
                <button type="button" onClick={handleEmptyExpiredTrash} className="w-fit rounded-full border border-gray-200 bg-gray-50 px-5 py-3 text-sm font-bold text-gray-700 hover:bg-white">Clear expired trash</button>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            {trashedProposals.length === 0 ? (
              <div className="rounded-lg bg-gray-50 p-8 text-center">
                <p className="text-lg font-bold text-blue-700">Trash bin is empty</p>
                <p className="mt-2 text-sm text-gray-500">Deleted proposals will appear here for {trashRetentionDays} days.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {trashedProposals.map((proposal) => {
                  const deletedAt = proposal.deletedAt ? new Date(proposal.deletedAt) : new Date();
                  const daysUsed = Math.max(0, Math.floor((Date.now() - deletedAt.getTime()) / (24 * 60 * 60 * 1000)));
                  const daysLeft = Math.max(0, trashRetentionDays - daysUsed);

                  return (
                    <div key={proposal.id} className="flex flex-col justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 md:flex-row md:items-center">
                      <div>
                        <p className="text-base font-bold text-blue-700">{proposal.customerName}</p>
                        <p className="mt-1 text-sm text-gray-600">{proposal.address}</p>
                        <p className="mt-1 text-xs text-gray-500">${proposal.total.toLocaleString()} &middot; {proposal.scope}</p>
                        <p className="mt-2 text-xs font-bold uppercase tracking-wide text-gray-500">Deleted {azDate(deletedAt)} &middot; Permanently deletes in {daysLeft} days</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => handleRestoreProposal(proposal)} className="rounded-full bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">Restore</button>
                        <button type="button" onClick={() => setConfirmPermanentDelete(proposal)} className="rounded-full bg-red-50 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-100">Delete forever</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {confirmPermanentDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">Permanently delete proposal?</h3>
            <p className="mt-2 text-sm text-gray-600">This will permanently delete the proposal for <strong>{confirmPermanentDelete.customerName}</strong>. This action cannot be undone.</p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmPermanentDelete(null)} className="rounded-full border border-gray-200 px-5 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={() => { handlePermanentDeleteProposal(confirmPermanentDelete); setConfirmPermanentDelete(null); }} className="rounded-full bg-red-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-red-700">Delete forever</button>
            </div>
          </div>
        </div>
      )}

      {activeTab === "settings" && (
        <div className="space-y-5">
          {/* Automated Proposal Follow-Up Settings */}
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">Automation</p>
                <h2 className="mt-2 text-2xl font-bold text-blue-700">Automated Proposal Follow-Up</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">Automatically send a multi-step follow-up sequence to customers who viewed a proposal but have not signed it. The sequence stops when the customer signs or clicks &quot;Decline Proposal&quot; in the email.</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setFollowUpSmsEnabled((v) => !v)}
                  className={`rounded-full px-4 py-2 text-xs font-bold transition ${followUpSmsEnabled ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
                >
                  {followUpSmsEnabled ? "SMS On" : "SMS Off"}
                </button>
                <button
                  type="button"
                  onClick={() => setFollowUpEnabled((v) => !v)}
                  className={`rounded-full px-5 py-3 text-sm font-bold transition ${followUpEnabled ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
                >
                  {followUpEnabled ? "Enabled" : "Disabled"}
                </button>
              </div>
            </div>

            <div className="mt-6 space-y-6">
              {followUpSteps.map((step, idx) => (
                <div key={idx} className="rounded-lg border border-gray-200 bg-gray-50 p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-blue-700">Step {idx + 1}{idx === followUpSteps.length - 1 ? " (Final)" : ""}</h3>
                    {followUpSteps.length > 1 && (
                      <button type="button" onClick={() => removeStep(idx)} className="text-xs font-medium text-red-500 hover:text-red-700">Remove</button>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-600">Delay (hours after proposal viewed)</label>
                      <input type="number" min={1} max={720} value={step.delayHours} onChange={(e) => updateStep(idx, "delayHours", Math.max(1, Number(e.target.value)))} className="mt-1 w-32 rounded-lg border border-gray-200 px-4 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" />
                      <span className="ml-2 text-xs text-gray-400">({step.delayHours < 24 ? `${step.delayHours}h` : step.delayHours % 24 === 0 ? `${step.delayHours / 24} day${step.delayHours / 24 !== 1 ? "s" : ""}` : `${Math.floor(step.delayHours / 24)}d ${step.delayHours % 24}h`} after viewed)</span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-600">Email subject</label>
                      <input type="text" value={step.emailSubject} onChange={(e) => updateStep(idx, "emailSubject", e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-4 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" />
                    </div>

                    <div>
                      <div className="flex items-center justify-between"><label className="block text-xs font-bold text-gray-600">Email message</label><AiWriteButton getText={() => step.emailTemplate} onReplace={(t) => updateStep(idx, "emailTemplate", t)} context="follow-up email for a roofing proposal" /></div>
                      <textarea value={step.emailTemplate} onChange={(e) => updateStep(idx, "emailTemplate", e.target.value)} rows={4} className="mt-1 w-full rounded-lg border border-gray-200 px-4 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" />
                      <p className="mt-1 text-xs text-gray-400">Use {'{customerName}'} for name. &quot;View Proposal&quot; and &quot;Decline Proposal&quot; buttons are added automatically.</p>
                    </div>

                    {followUpSmsEnabled && (
                      <div>
                        <div className="flex items-center justify-between"><label className="block text-xs font-bold text-gray-600">SMS message</label><AiWriteButton getText={() => step.smsTemplate} onReplace={(t) => updateStep(idx, "smsTemplate", t)} context="follow-up SMS for a roofing proposal" /></div>
                        <textarea value={step.smsTemplate} onChange={(e) => updateStep(idx, "smsTemplate", e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-gray-200 px-4 py-2 text-sm outline-none focus:border-green-300 focus:ring-2 focus:ring-green-100" />
                        <p className="mt-1 text-xs text-gray-400">Use {'{customerName}'} and {'{proposalLink}'}. Sent to the customer&apos;s phone.</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <button type="button" onClick={addStep} className="rounded-lg border border-dashed border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-500 transition hover:border-blue-400 hover:text-blue-600">+ Add Follow-Up Step</button>

              <div className="flex items-center gap-3 border-t border-gray-200 pt-4">
                <button type="button" onClick={handleSaveFollowUpConfig} disabled={followUpSaving} className="rounded-full bg-blue-600 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-50">
                  {followUpSaving ? "Saving..." : "Save Follow-Up Settings"}
                </button>
                {followUpNotice && (
                  <span className={`text-sm font-medium ${followUpNotice.includes("success") ? "text-green-600" : "text-red-600"}`}>{followUpNotice}</span>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600">Settings</p>
                <h2 className="mt-2 text-2xl font-bold text-blue-700">Proposal trash bin</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">Deleted proposals are hidden from the proposal board and drafts. They stay in the <button type="button" onClick={() => setActiveTab("trash")} className="font-bold text-blue-600 hover:underline">Trash tab</button> for {trashRetentionDays} days before they are removed completely.</p>
              </div>
              <button type="button" onClick={() => setActiveTab("trash")} className="w-fit rounded-full border border-gray-200 bg-gray-50 px-5 py-3 text-sm font-bold text-gray-700 hover:bg-white">View Trash ({trashedProposals.length})</button>
            </div>
          </div>
        </div>
      )}

      {activeTab !== "templates" && activeTab !== "trash" && activeTab !== "settings" && showCreateForm && (
      <form onSubmit={handleCreateProposal} className="rounded-[2rem] border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setProposalMode("job")} className={`rounded-lg px-4 py-2 text-sm font-bold ${proposalMode === "job" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}>From selected job</button>
          <button type="button" onClick={() => setProposalMode("new")} className={`rounded-lg px-4 py-2 text-sm font-bold ${proposalMode === "new" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}>New proposal</button>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr_auto] lg:items-end">
          {proposalMode === "job" ? (
            <label className="grid gap-2 text-sm font-bold text-gray-700">
              Search job by name or address
              <input value={jobSearch} onChange={(event) => setJobSearch(event.target.value)} className="rounded-lg border border-gray-200 px-4 py-3 outline-none" placeholder="Enter address, customer name, roof type..." />
            </label>
          ) : (
            <>
              <label className="grid gap-2 text-sm font-bold text-gray-700">
                Customer name
                <input required value={customerName} onChange={(event) => setCustomerName(event.target.value)} className="rounded-lg border border-gray-200 px-4 py-3 outline-none" placeholder="Customer name" />
              </label>
              <label className="grid gap-2 text-sm font-bold text-gray-700">
                Customer email
                <input value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} className="rounded-lg border border-gray-200 px-4 py-3 outline-none" placeholder="Email address" />
              </label>
              <label className="grid gap-2 text-sm font-bold text-gray-700">
                Customer phone
                <input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} className="rounded-lg border border-gray-200 px-4 py-3 outline-none" placeholder="Phone number" />
              </label>
              <label className="grid gap-2 text-sm font-bold text-gray-700">
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
          <label className="grid gap-2 text-sm font-bold text-gray-700">
            Proposal scope
            <input value={scope} onChange={(event) => setScope(event.target.value)} className="rounded-lg border border-gray-200 px-4 py-3 outline-none" placeholder="Roof repair, replacement, coating..." />
          </label>
          {proposalMode === "new" && (
            <label className="grid gap-2 text-sm font-bold text-gray-700">
              Proposal total
              <input type="number" value={total} onChange={(event) => setTotal(event.target.value)} className="rounded-lg border border-gray-200 px-4 py-3 outline-none" placeholder="Amount" />
            </label>
          )}
          <button className="rounded-lg bg-orange-500 px-5 py-3 font-bold text-white shadow-sm">Create proposal</button>
        </div>
        {proposalMode === "job" && (
          <div className="mt-4 grid gap-2 pb-20 md:grid-cols-2 lg:pb-0 xl:grid-cols-3">
            {filteredJobs.map((job) => (
              <button key={job.id} type="button" onClick={() => setSelectedJobId(job.id)} className={`rounded-lg p-4 text-left text-sm ${selectedJobId === job.id ? "bg-orange-50 ring-2 ring-orange-400" : "bg-gray-50"}`}>
                <span className="block font-bold text-blue-700">{job.name}</span>
                <span className="mt-1 block text-gray-500">{job.address}, {job.city}</span>
                <span className="mt-2 block font-bold text-orange-700">${job.value.toLocaleString()}</span>
              </button>
            ))}
            {filteredJobs.length === 0 && (
              <p className="col-span-full py-6 text-center text-sm font-semibold text-gray-400">No jobs found. Add jobs in the Leads board first.</p>
            )}
          </div>
        )}
        {proposalMode === "job" && selectedJob && (
          <div className="mt-4 rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
            <span className="font-bold text-blue-700">{selectedJob.name}</span> · {selectedJob.address}, {selectedJob.city} · {selectedJob.assignedTo}
          </div>
        )}
      </form>
      )}

      {activeTab !== "templates" && activeTab !== "trash" && activeTab !== "settings" && (
      <div className="space-y-3 pb-20 pr-2 lg:pb-0">
        {filteredProposals.map((proposal) => (
          <div key={proposal.id} className="grid w-full grid-cols-1 items-center gap-4 rounded-lg border border-white/70 bg-white/95 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-xl md:grid-cols-[1fr_auto]">
            <button type="button" onClick={() => openProposal(proposal)} className="flex items-center gap-4 text-left">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-white text-sm font-bold leading-4 text-blue-700 shadow-sm">XRP<br />ROOF</div>
              <div>
                <p className="font-bold text-blue-700">{proposal.proposalNumber ? `#${proposal.proposalNumber} — ` : ""}{proposal.address}</p>
                <p className="mt-1 text-sm text-gray-500">{proposal.customerName}{proposal.createdBy ? <> <span className="mx-2">•</span> Created by {proposal.createdBy}</> : null}</p>
                <p className="mt-1 text-xs text-gray-500">{proposal.status === "Draft" ? "Created" : proposal.status === "Sent" ? `Sent${proposal.sentViaSms ? " via SMS" : " via Email"}${proposal.sentBy ? ` by ${proposal.sentBy}` : ""}${proposal.sentToEmail ? ` to ${proposal.sentToEmail}` : ""}${proposal.smsSentToPhone ? ` to ${proposal.smsSentToPhone}` : ""}` : proposal.status === "Won" || proposal.status === "Signed" || proposal.status === "Signed Offline" ? `Signed by ${proposal.signedBy || proposal.customerName}` : proposal.status === "Declined" ? "Declined by client" : `Viewed${(proposal.viewCount || 0) > 1 ? ` ${proposal.viewCount} times` : ""}`} <span className="mx-1">•</span> {proposal.sentAt ? azDateTime(proposal.sentAt) : proposal.signedAt ? azDateTime(proposal.signedAt) : proposal.declinedAt ? azDateTime(proposal.declinedAt) : proposal.lastViewedAt ? `Last viewed ${azDateTime(proposal.lastViewedAt)}` : proposal.createdAt ? azDateTime(proposal.createdAt) : "Today"}{proposal.smsSentBy ? <> <span className="mx-1">•</span> SMS by {proposal.smsSentBy}</> : null}{proposal.followUpStepCompleted !== undefined && proposal.followUpStepCompleted >= 0 ? <> <span className="mx-1">•</span> Follow-up {proposal.followUpStepCompleted + 1} sent</> : proposal.followUpSentAt ? <> <span className="mx-1">•</span> Follow-up sent {azDate(proposal.followUpSentAt)}</> : null}</p>
              </div>
            </div>
            </button>
            <div className="flex items-center justify-end gap-3">
              <div className="text-right">
                <p className="font-bold text-gray-600">${(isProposalLocked(proposal) ? (proposal.acceptedPrice ?? proposal.total) : proposal.total).toLocaleString()}</p>
                <p className="mt-1 text-xs font-bold uppercase text-gray-500">{proposal.acceptedPackageName || proposal.acceptedPackage || proposal.selectedOption || "BEST"}</p>
                {proposal.depositType && proposal.depositValue && proposal.depositValue > 0 && (
                  <p className={`mt-1 text-xs font-bold ${proposal.depositPaidAt ? "text-emerald-600" : "text-orange-600"}`}>{proposal.depositPaidAt ? "✓ Deposit Paid" : "Deposit Due"}</p>
                )}
              </div>
              <span className={`rounded-full px-4 py-1 text-sm font-bold ${proposal.status === "Draft" ? "bg-gray-500 text-white" : proposal.status === "Sent" ? "bg-sky-500 text-white" : proposal.status === "Won" || proposal.status === "Signed" || proposal.status === "Signed Offline" ? "bg-blue-500 text-white" : proposal.status === "Declined" ? "bg-red-500 text-white" : "bg-orange-400 text-gray-900"}`}>{proposal.status === "Approved" || proposal.status === "Viewed" ? `Viewed${(proposal.viewCount || 0) > 1 ? ` (${proposal.viewCount})` : ""}` : proposal.status}</span>
              <button type="button" onClick={(e) => { e.stopPropagation(); setPermDeleteTarget(proposal); setShowPermDeleteConfirm(true); }} className="rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white">Delete</button>
              <span className="text-xl font-bold text-gray-500">⋯</span>
            </div>
          </div>
        ))}
        {filteredProposals.length === 0 && !dataLoaded && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[1,2,3,4,5,6].map((i) => (
              <div key={i} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
                <div className="mt-2 h-3 w-48 animate-pulse rounded bg-gray-100" />
                <div className="mt-3 h-6 w-20 animate-pulse rounded bg-blue-100" />
              </div>
            ))}
          </div>
        )}
        {filteredProposals.length === 0 && dataLoaded && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center font-semibold text-gray-500">No proposals match your search.</div>
        )}
      </div>
      )}

      {/* ── Permanent Delete Confirmation Modal ── */}
      {showPermDeleteConfirm && permDeleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" onClick={() => { setShowPermDeleteConfirm(false); setPermDeleteTarget(null); }}>
          <div className="w-full max-w-sm rounded-xl border border-red-200 bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600 text-lg">⚠</div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Delete Proposal</h2>
                <p className="text-sm text-gray-600">This action cannot be undone.</p>
              </div>
            </div>
            <div className="mt-4 rounded-lg bg-red-50 p-3">
              <p className="text-sm font-semibold text-red-900">{permDeleteTarget.customerName}</p>
              <p className="text-xs text-red-700 mt-1">{permDeleteTarget.address}</p>
              <p className="text-xs text-red-700">${permDeleteTarget.total.toLocaleString()}</p>
            </div>
            <p className="mt-3 text-xs text-gray-500">This will permanently remove the proposal from all devices. It will not reappear after refresh or synchronization.</p>
            <div className="mt-5 flex gap-3">
              <button onClick={() => { setShowPermDeleteConfirm(false); setPermDeleteTarget(null); }} className="flex-1 rounded-lg border border-gray-200 px-4 py-3 text-sm font-bold text-gray-700 transition hover:bg-gray-50">Cancel</button>
              <button onClick={() => { handlePermanentDeleteProposal(permDeleteTarget); setShowPermDeleteConfirm(false); setPermDeleteTarget(null); }} className="flex-1 rounded-lg bg-red-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-red-700 active:scale-95">Delete Permanently</button>
            </div>
          </div>
        </div>
      )}
      <SaveToastUI />
    </div>
  );
}

