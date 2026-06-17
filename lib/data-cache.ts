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
// Cache stores
// ---------------------------------------------------------------------------

let crewCache: CrewDataset | null = null;
let invoiceCache: unknown[] | null = null;
let proposalCache: unknown[] | null = null;
let customerCache: unknown[] | null = null;

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
  return crewCache;
}

export async function refreshCrewData(): Promise<CrewDataset> {
  if (crewFlight) return crewFlight;
  crewFlight = loadCrewDataset()
    .then((data) => { crewCache = data; return data; })
    .finally(() => { crewFlight = null; });
  return crewFlight;
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export function getCachedInvoices<T>(): T[] | null {
  return invoiceCache as T[] | null;
}

export async function refreshInvoices<T extends { id: string }>(): Promise<T[]> {
  if (invoiceFlight) return invoiceFlight as Promise<T[]>;
  invoiceFlight = loadAllInvoices<T>()
    .then((data) => { invoiceCache = data; return data as unknown[]; })
    .finally(() => { invoiceFlight = null; });
  return invoiceFlight as Promise<T[]>;
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export function getCachedProposals<T>(): T[] | null {
  return proposalCache as T[] | null;
}

export async function refreshProposals<T extends { id: string }>(): Promise<T[]> {
  if (proposalFlight) return proposalFlight as Promise<T[]>;
  proposalFlight = loadProposalRecords<T>()
    .then((data) => { proposalCache = data; return data as unknown[]; })
    .finally(() => { proposalFlight = null; });
  return proposalFlight as Promise<T[]>;
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export function getCachedCustomers<T>(): T[] | null {
  return customerCache as T[] | null;
}

export async function refreshCustomers<T>(): Promise<T[]> {
  if (customerFlight) return customerFlight as Promise<T[]>;
  customerFlight = loadCustomerRecords()
    .then((data) => { customerCache = data; return data as unknown[]; })
    .finally(() => { customerFlight = null; });
  return customerFlight as Promise<T[]>;
}
