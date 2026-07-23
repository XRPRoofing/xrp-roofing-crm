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

const JOB_CARD_RETURN_KEY = "crm-job-card-return";
const JOB_CARD_SKIP_HASH_KEY = "crm-job-card-skip-hash";
const RETURN_TTL_MS = 5 * 60 * 1000;

export type JobCardReturnState = {
  jobId: string;
  checklistOpen?: boolean;
  scrollTop?: number;
  timestamp?: number;
};

function setSession(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* sessionStorage unavailable */
  }
}

function getSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeSession(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* sessionStorage unavailable */
  }
}

function removeHistoryState(key: string) {
  try {
    const current = window.history.state || {};
    if (current[key]) {
      const next = { ...current };
      delete next[key];
      window.history.replaceState(next, "", window.location.href);
    }
  } catch {
    /* history unavailable */
  }
}

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

// ── Job Card return navigation ─────────────────────────────────────────────
// Used when the user leaves a Job Card to edit an Estimate or Invoice. We
// stash the job id plus UI state on the current history entry and in
// sessionStorage so the Jobs board can restore the exact card when the user
// navigates back. We also set a skip-hash flag so the estimate/invoice editor
// does not push its own #card hash, keeping the browser back button as a
// single step back to the Job Card.

function isReturnStateValid(state: JobCardReturnState | null): state is JobCardReturnState {
  if (!state || !state.jobId) return false;
  const timestamp = state.timestamp || 0;
  return Date.now() - timestamp < RETURN_TTL_MS;
}

export function stashJobCardReturn(state: JobCardReturnState) {
  try {
    const withTimestamp = { ...state, timestamp: state.timestamp || Date.now() };
    window.sessionStorage.setItem(JOB_CARD_RETURN_KEY, JSON.stringify(withTimestamp));
    const current = window.history.state || {};
    window.history.replaceState({ ...current, jobCardReturn: withTimestamp }, "", window.location.href);
  } catch {
    /* storage/history unavailable */
  }
}

export function peekJobCardReturn(): JobCardReturnState | null {
  try {
    const fromState = ((window.history.state as Record<string, unknown> | null)?.jobCardReturn as JobCardReturnState | undefined) ?? null;
    if (isReturnStateValid(fromState)) return fromState;

    const raw = getSession(JOB_CARD_RETURN_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as JobCardReturnState;
      if (isReturnStateValid(parsed)) return parsed;
      removeSession(JOB_CARD_RETURN_KEY);
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function takeJobCardReturn(): JobCardReturnState | null {
  const state = peekJobCardReturn();
  try {
    removeSession(JOB_CARD_RETURN_KEY);
    removeHistoryState("jobCardReturn");
  } catch {
    /* ignore */
  }
  return state;
}

export function clearJobCardReturn() {
  try {
    removeSession(JOB_CARD_RETURN_KEY);
    removeHistoryState("jobCardReturn");
  } catch {
    /* ignore */
  }
}

export function consumeJobCardOpening(): { fromJob: boolean; state: JobCardReturnState | null } {
  const fromJob = takeJobCardSkipHash();
  const state = fromJob ? peekJobCardReturn() : null;
  return { fromJob, state };
}

export function setJobCardSkipHash() {
  setSession(JOB_CARD_SKIP_HASH_KEY, "1");
}

export function takeJobCardSkipHash(): boolean {
  const val = getSession(JOB_CARD_SKIP_HASH_KEY) === "1";
  removeSession(JOB_CARD_SKIP_HASH_KEY);
  return val;
}
