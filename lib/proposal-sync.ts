"use client";

import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";

/**
 * Device-synced proposals (estimates).
 *
 * Proposals used to live in this browser's localStorage, so a proposal created
 * on the computer never appeared on the phone. They now persist in the shared
 * `proposal_shares` table (one row per proposal) via /api/proposals (service
 * role), and the Estimates board subscribes to realtime so a change on one
 * device shows on every other device without a refresh. When Supabase is not
 * configured these helpers no-op so the board keeps working off localStorage.
 */

export type ProposalRecord = { id: string } & Record<string, unknown>;

export const proposalsTable = "proposal_shares";
export const proposalSyncEnabled = hasSupabaseConfig;

/** Load every shared proposal record. Returns [] when Supabase is off. */
export async function loadProposalRecords<T extends ProposalRecord>(): Promise<T[]> {
  if (!hasSupabaseConfig()) return [];
  try {
    const response = await fetch("/api/proposals", { cache: "no-store" });
    if (!response.ok) return [];
    const data = (await response.json()) as { proposals?: T[] };
    return data.proposals || [];
  } catch {
    return [];
  }
}

/** Create or update one proposal (shared across devices). No-op without Supabase. */
export async function upsertProposalRecord(proposal: ProposalRecord): Promise<void> {
  if (!hasSupabaseConfig()) return;
  try {
    await fetch("/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(proposal),
    });
  } catch {
    /* keep the local copy; it retries on the next change/focus */
  }
}

/** Permanently delete one proposal from the shared store. */
export async function deleteProposalRecord(id: string): Promise<void> {
  if (!hasSupabaseConfig()) return;
  try {
    await fetch(`/api/proposals?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    /* ignore; realtime/focus reload reconciles */
  }
}

const TEMPLATES_ROW_ID = "_proposal_templates";

/** Load saved proposal templates from the shared store. */
export async function loadTemplateRecords<T>(): Promise<T[]> {
  if (!hasSupabaseConfig()) return [];
  try {
    const response = await fetch(`/api/proposals/share?id=${encodeURIComponent(TEMPLATES_ROW_ID)}`, { cache: "no-store" });
    if (!response.ok) return [];
    const data = (await response.json()) as { proposal?: { templates?: T[] } };
    return data.proposal?.templates || [];
  } catch {
    return [];
  }
}

/** Save proposal templates to the shared store. */
export async function saveTemplateRecords(templates: Record<string, unknown>[]): Promise<void> {
  if (!hasSupabaseConfig()) return;
  try {
    await fetch("/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: TEMPLATES_ROW_ID, templates }),
    });
  } catch {
    /* retry on next change */
  }
}

const proposalListeners = new Set<() => void>();
let proposalChannel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;

/**
 * Subscribe to realtime INSERT/UPDATE/DELETE on `proposal_shares`. The callback
 * fires whenever any device changes a proposal. Returns an unsubscribe fn.
 * Uses a shared channel so multiple callers don't create duplicate connections.
 */
export function subscribeToProposalRecords(onChange: () => void): () => void {
  if (!hasSupabaseConfig()) return () => {};

  proposalListeners.add(onChange);

  if (!proposalChannel) {
    const supabase = createClient();
    proposalChannel = supabase.channel("proposal-records-sync-shared");
    proposalChannel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: proposalsTable },
      () => { proposalListeners.forEach((cb) => cb()); },
    );
    proposalChannel.subscribe();
  }

  return () => {
    proposalListeners.delete(onChange);
    if (proposalListeners.size === 0 && proposalChannel) {
      createClient().removeChannel(proposalChannel);
      proposalChannel = null;
    }
  };
}
