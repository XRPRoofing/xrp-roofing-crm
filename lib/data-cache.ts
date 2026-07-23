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
 * The most recent result is ALSO mirrored to localStorage so a cold load
 * (first open of the day, or a hard refresh — both common on mobile) can
 * hydrate the in-memory cache instantly instead of showing a spinner until
 * the network round-trip finishes. The background refresh still runs and
 * reconciles. Persistence is strictly best-effort: reads/writes are wrapped
 * in try/catch and oversized datasets are skipped, so it can never break a
 * page or exceed the storage quota. All four datasets are already "slim"
 * (crew strips image bytes, proposals strip photos/brochures, invoices are
 * structured columns, customers are small), so mirroring them is cheap.
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

// ---------------------------------------------------------------------------
// localStorage persistence (best-effort; never throws)
// ---------------------------------------------------------------------------

const PERSIST_KEYS = {
  crew: "xrp-crm-cache-crew",
  invoices: "xrp-crm-cache-invoices",
  proposals: "xrp-crm-cache-proposals",
  customers: "xrp-crm-cache-customers",
} as const;

// Skip persisting a dataset larger than this (serialized) to protect the
// localStorage quota and avoid a costly main-thread stringify. Such a dataset
// simply behaves as it does today (in-memory cache only).
const PERSIST_MAX_BYTES = 2_000_000;

function readPersisted<T>(key: string): CacheEntry<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (!parsed || typeof parsed.updatedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePersisted<T>(key: string, entry: CacheEntry<T>) {
  if (typeof window === "undefined") return;
  const persist = () => {
    try {
      const raw = JSON.stringify(entry);
      if (raw.length > PERSIST_MAX_BYTES) {
        try { window.localStorage.removeItem(key); } catch { /* ignore */ }
        return;
      }
      window.localStorage.setItem(key, raw);
    } catch {
      // Quota exceeded or serialization failure — the in-memory cache still
      // works, so this is safe to ignore.
    }
  };
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (typeof ric === "function") ric(persist);
  else setTimeout(persist, 0);
}

// Hydrate the in-memory caches from the last persisted snapshot on module load
// so the very first page render on a cold load has data. The stale timestamp
// makes the next refresh fetch fresh data in the background.
let crewCache: CacheEntry<CrewDataset> | null = readPersisted<CrewDataset>(PERSIST_KEYS.crew);
let invoiceCache: CacheEntry<unknown[]> | null = readPersisted<unknown[]>(PERSIST_KEYS.invoices);
let proposalCache: CacheEntry<unknown[]> | null = readPersisted<unknown[]>(PERSIST_KEYS.proposals);
let customerCache: CacheEntry<unknown[]> | null = readPersisted<unknown[]>(PERSIST_KEYS.customers);

// Data is considered fresh for this many ms — callers that request a refresh
// within this window get the cached value immediately instead of hitting the
// network again.  Keeps mobile page transitions snappy.
const FRESH_MS = 8_000;

// In-flight deduplication: if a refresh is already running, return its promise
// instead of firing a second identical request.
let crewFlight: Promise<CrewDataset> | null = null;
let invoiceFlight: Promise<unknown[]> | null = null;
let proposalFlight: Promise<unknown[]> | null = null;
let customerFlight: Promise<unknown[]> | null = null;

function isFresh<T>(entry: CacheEntry<T> | null): entry is CacheEntry<T> {
  return entry !== null && Date.now() - entry.updatedAt < FRESH_MS;
}

// ---------------------------------------------------------------------------
// Crew dataset
// ---------------------------------------------------------------------------

export function getCachedCrewData(): CrewDataset | null {
  return crewCache?.data ?? null;
}

export async function refreshCrewData(force?: boolean): Promise<CrewDataset> {
  if (!force && isFresh(crewCache)) return crewCache.data;
  if (crewFlight) return crewFlight;
  crewFlight = loadCrewDataset()
    .then((data) => { crewCache = { data, updatedAt: Date.now() }; writePersisted(PERSIST_KEYS.crew, crewCache); emitCacheEvent(CACHE_EVENTS.crew); return data; })
    .finally(() => { crewFlight = null; });
  return crewFlight;
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export function getCachedInvoices<T>(): T[] | null {
  return (invoiceCache?.data as T[] | undefined) ?? null;
}

export async function refreshInvoices<T extends { id: string }>(force?: boolean): Promise<T[]> {
  if (!force && isFresh(invoiceCache)) return invoiceCache.data as T[];
  if (invoiceFlight) return invoiceFlight as Promise<T[]>;
  invoiceFlight = loadAllInvoices<T>()
    .then((data) => { invoiceCache = { data, updatedAt: Date.now() }; writePersisted(PERSIST_KEYS.invoices, invoiceCache); emitCacheEvent(CACHE_EVENTS.invoices); return data as unknown[]; })
    .finally(() => { invoiceFlight = null; });
  return invoiceFlight as Promise<T[]>;
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export function getCachedProposals<T>(): T[] | null {
  return (proposalCache?.data as T[] | undefined) ?? null;
}

export async function refreshProposals<T extends { id: string }>(force?: boolean): Promise<T[]> {
  if (!force && isFresh(proposalCache)) return proposalCache.data as T[];
  if (proposalFlight) return proposalFlight as Promise<T[]>;
  proposalFlight = loadProposalRecords<T>()
    .then((data) => { proposalCache = { data, updatedAt: Date.now() }; writePersisted(PERSIST_KEYS.proposals, proposalCache); emitCacheEvent(CACHE_EVENTS.proposals); return data as unknown[]; })
    .finally(() => { proposalFlight = null; });
  return proposalFlight as Promise<T[]>;
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export function getCachedCustomers<T>(): T[] | null {
  return (customerCache?.data as T[] | undefined) ?? null;
}

export async function refreshCustomers<T>(force?: boolean): Promise<T[]> {
  if (!force && isFresh(customerCache)) return customerCache.data as T[];
  if (customerFlight) return customerFlight as Promise<T[]>;
  customerFlight = loadCustomerRecords()
    .then((data) => { customerCache = { data, updatedAt: Date.now() }; writePersisted(PERSIST_KEYS.customers, customerCache); emitCacheEvent(CACHE_EVENTS.customers); return data as unknown[]; })
    .finally(() => { customerFlight = null; });
  return customerFlight as Promise<T[]>;
}
