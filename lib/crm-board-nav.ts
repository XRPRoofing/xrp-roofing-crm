"use client";

import type { Lead } from "@/types/crm";

// Cross-page handoff so a Job (or customer profile) can open the Estimate /
// Invoice editor directly instead of routing to the board first. The intent is
// stashed in sessionStorage, the user is routed to the board, and the board
// consumes the intent on mount (open an existing record, or create + link a new
// one from the job/customer payload).

export type BoardJobPayload = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  roofType: string;
  value: number;
  dueDate?: string;
};

export type BoardIntent =
  | { kind: "open"; id: string }
  | { kind: "create"; job: BoardJobPayload }
  | { kind: "create-from-proposal"; proposalId: string };

const ESTIMATE_KEY = "crm-board-estimate-intent";
const INVOICE_KEY = "crm-board-invoice-intent";

export function jobToBoardPayload(job: Lead): BoardJobPayload {
  return {
    id: job.id,
    name: job.name,
    email: job.email,
    phone: job.phone,
    address: job.address,
    city: job.city,
    roofType: job.roofType,
    value: job.value,
    dueDate: job.dueDate,
  };
}

// Rebuild a minimal Lead from a payload so the board's existing
// createInvoiceFromJob / proposal-from-job builders work and the record links
// back to the originating job by id.
export function payloadToLead(job: BoardJobPayload): Lead {
  return {
    id: job.id,
    name: job.name,
    email: job.email,
    phone: job.phone,
    address: job.address,
    city: job.city,
    stage: "estimate_sent",
    value: job.value,
    assignedTo: "",
    roofType: job.roofType || "Roofing",
    source: "Job",
    lastActivity: "",
    dueDate: job.dueDate,
  };
}

function setIntent(key: string, intent: BoardIntent) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(intent));
  } catch {
    /* sessionStorage unavailable */
  }
}

// Read and clear an intent (consume-once) so a normal later visit to the board
// doesn't re-trigger it.
function takeIntent(key: string): BoardIntent | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    window.sessionStorage.removeItem(key);
    return JSON.parse(raw) as BoardIntent;
  } catch {
    return null;
  }
}

export const requestOpenEstimate = (id: string) => setIntent(ESTIMATE_KEY, { kind: "open", id });
export const requestCreateEstimate = (job: BoardJobPayload) => setIntent(ESTIMATE_KEY, { kind: "create", job });
export const takeEstimateIntent = () => takeIntent(ESTIMATE_KEY);

export const requestOpenInvoice = (id: string) => setIntent(INVOICE_KEY, { kind: "open", id });
export const requestCreateInvoice = (job: BoardJobPayload) => setIntent(INVOICE_KEY, { kind: "create", job });
export const requestCreateInvoiceFromProposal = (proposalId: string) => setIntent(INVOICE_KEY, { kind: "create-from-proposal", proposalId });
export const takeInvoiceIntent = () => takeIntent(INVOICE_KEY);
