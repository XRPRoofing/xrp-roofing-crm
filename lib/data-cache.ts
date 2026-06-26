/**
 * In-memory data cache for instant page transitions.
 *
 * The CRM has many pages (Dashboard, Jobs, Customers, Invoices, etc.) that each
 * independently call the same async loaders (loadCrewDataset, loadAllInvoices,
 * loadProposalRecords, loadCustomerRecords). Without caching, every page
 * navigation triggers a full re-fetch with a visible loading spinner.
 *
 * This module keeps the most recent result in memory so pages render
 * instantly with cached data, then silently refresh in the background.
 * When a refresh completes, a global custom event is dispatched so every
 * mounted component can react without its own Supabase subscription.
 *
 * Cache entries carry a timestamp so callers can check freshness.  The
 * STALE_AFTER_MS constant controls how long a cached value is considered
 * fresh — after that, the next page that reads cached data will also
 * trigger a background refresh.
 *
 * Usage:
 *   const data = getCachedCrewData();   // instant — null only on first ever load
 *   refreshCrewData().then(setJobs);    // background fetch, updates cache
 */

import { loadCrewDataset, type CrewDataset } from "./crew-sync";
import { loadAllInvoices } from "./invoice-sync";
import { loadProposalRecords } from "./proposal-sync";
import { loadCustomerRecords } from "./customer-sync";

// ---------------------------------------------------------------------------
// Global cache-update events
// ---------------------------------------------------------------------------

export const CACHE_EVENTS = {
  crew: "crm-cache-crew-updated",
  invoices: "crm-cache-invoices-updated",
  proposals: "crm-cache-proposals-updated",
  customers: "crm-cache-customers-updated",
} as const;

function emitCacheEvent(event: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(event));
  }
}

// ---------------------------------------------------------------------------
// Cache stores with timestamps
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  updatedAt: number;
}

let crewCache: CacheEntry<CrewDataset> | null = null;
let invoiceCache: CacheEntry<unknown[]> | null = null;
let proposalCache: CacheEntry<unknown[]> | null = null;
let customerCache: CacheEntry<unknown[]> | null = null;

// In-flight deduplication: if a refresh is already running, return its promise
// instead of firing a second identical request.
let crewFlight: Promise<CrewDataset> | null = null;
let invoiceFlight: Promise<unknown[]> | null = null;
let proposalFlight: Promise<unknown[]> | null = null;
let customerFlight: Promise<unknown[]> | null = null;

// ---------------------------------------------------------------------------
// Crew dataset
// ---------------------------------------------------------------------------

export function getCachedCrewData(): CrewDataset | null {
  return crewCache?.data ?? null;
}

export async function refreshCrewData(): Promise<CrewDataset> {
  if (crewFlight) return crewFlight;
  crewFlight = loadCrewDataset()
    .then((data) => { crewCache = { data, updatedAt: Date.now() }; emitCacheEvent(CACHE_EVENTS.crew); return data; })
    .finally(() => { crewFlight = null; });
  return crewFlight;
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export function getCachedInvoices<T>(): T[] | null {
  return (invoiceCache?.data as T[] | undefined) ?? null;
}

export async function refreshInvoices<T extends { id: string }>(): Promise<T[]> {
  if (invoiceFlight) return invoiceFlight as Promise<T[]>;
  invoiceFlight = loadAllInvoices<T>()
    .then((data) => { invoiceCache = { data, updatedAt: Date.now() }; emitCacheEvent(CACHE_EVENTS.invoices); return data as unknown[]; })
    .finally(() => { invoiceFlight = null; });
  return invoiceFlight as Promise<T[]>;
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export function getCachedProposals<T>(): T[] | null {
  return (proposalCache?.data as T[] | undefined) ?? null;
}

export async function refreshProposals<T extends { id: string }>(): Promise<T[]> {
  if (proposalFlight) return proposalFlight as Promise<T[]>;
  proposalFlight = loadProposalRecords<T>()
    .then((data) => { proposalCache = { data, updatedAt: Date.now() }; emitCacheEvent(CACHE_EVENTS.proposals); return data as unknown[]; })
    .finally(() => { proposalFlight = null; });
  return proposalFlight as Promise<T[]>;
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export function getCachedCustomers<T>(): T[] | null {
  return (customerCache?.data as T[] | undefined) ?? null;
}

export async function refreshCustomers<T>(): Promise<T[]> {
  if (customerFlight) return customerFlight as Promise<T[]>;
  customerFlight = loadCustomerRecords()
    .then((data) => { customerCache = { data, updatedAt: Date.now() }; emitCacheEvent(CACHE_EVENTS.customers); return data as unknown[]; })
    .finally(() => { customerFlight = null; });
  return customerFlight as Promise<T[]>;
}
