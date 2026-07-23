"use client";

/**
 * CompanyCam integration client.
 *
 * All requests go through /api/companycam (server-side proxy) so the API token
 * is never exposed to the browser. The proxy forwards requests to the
 * CompanyCam v2 REST API.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type CompanyCamAddress = {
  street_address_1: string | null;
  street_address_2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
};

export type CompanyCamImageUri = {
  type: "original" | "web" | "thumbnail" | "original_annotation" | "web_annotation" | "thumbnail_annotation";
  uri: string;
  url: string;
};

export type CompanyCamProject = {
  id: string;
  company_id: string;
  creator_name: string;
  status: string;
  archived: boolean;
  name: string | null;
  address: CompanyCamAddress;
  feature_image: CompanyCamImageUri[];
  slug: string;
  project_url: string;
  public_url: string;
  photo_count: number;
  notepad: string | null;
  created_at: number;
  updated_at: number;
};

export type CompanyCamPhoto = {
  id: string;
  creator_name: string;
  project_id: string;
  status: string;
  uris: CompanyCamImageUri[];
  photo_url: string;
  captured_at: number;
  created_at: number;
  description: string | null;
  internal: boolean;
};

// ── API helpers ──────────────────────────────────────────────────────────────

async function ccGet<T>(params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/companycam?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`CompanyCam API error: ${res.status}`);
  return res.json();
}

export async function checkConnection(): Promise<boolean> {
  try {
    const data = await ccGet<{ connected: boolean }>({ action: "status" });
    return data.connected;
  } catch {
    return false;
  }
}

export async function listProjects(page = 1): Promise<CompanyCamProject[]> {
  try {
    return await ccGet<CompanyCamProject[]>({ action: "projects", page: String(page), per_page: "100" });
  } catch {
    return [];
  }
}

export async function listProjectPhotos(projectId: string, page = 1): Promise<CompanyCamPhoto[]> {
  try {
    return await ccGet<CompanyCamPhoto[]>({ action: "photos", projectId, page: String(page), per_page: "50" });
  } catch {
    return [];
  }
}

export async function searchProjects(query: string): Promise<CompanyCamProject[]> {
  try {
    return await ccGet<CompanyCamProject[]>({ action: "search", q: query });
  } catch {
    return [];
  }
}

/**
 * Create a new CompanyCam project from CRM job data.
 */
export async function createProject(opts: {
  name: string;
  address?: { street: string; city: string; state: string; zip: string };
}): Promise<CompanyCamProject | null> {
  try {
    const res = await fetch("/api/companycam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create_project", name: opts.name, address: opts.address }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Find an existing CompanyCam project for a job, or create one.
 * Returns the project and its photos, or null if CompanyCam isn't configured.
 */
export async function ensureProjectForJob(job: {
  address: string;
  city?: string;
  name: string;
}, existingProjects: CompanyCamProject[]): Promise<CompanyCamProject | null> {
  // Try matching by address first
  if (job.address && existingProjects.length > 0) {
    const matched = matchProjectByAddress(job.address, existingProjects);
    if (matched) return matched;
  }

  // No match — create a new project
  const projectName = `${job.name} — ${job.address}`;
  const created = await createProject({
    name: projectName,
    address: {
      street: job.address || "",
      city: job.city || "",
      state: "AZ",
      zip: "",
    },
  });
  return created;
}

// ── Persistent job → project links ───────────────────────────────────────────

export type CompanyCamJobLink = {
  projectId: string;
  projectUrl: string;
  address: string;
  linkedAt: string;
};

/** Load the full { jobId -> link } map (shared across all devices/users). */
export async function loadJobLinks(): Promise<Record<string, CompanyCamJobLink>> {
  try {
    const res = await fetch("/api/companycam/links", { cache: "no-store" });
    if (!res.ok) return {};
    const data = (await res.json()) as { links?: Record<string, CompanyCamJobLink> };
    return data.links || {};
  } catch {
    return {};
  }
}

/** Permanently link a CompanyCam project to a job. */
export async function saveJobLink(
  jobId: string,
  project: CompanyCamProject,
): Promise<boolean> {
  try {
    const res = await fetch("/api/companycam/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        projectId: project.id,
        projectUrl: project.project_url,
        address: project.address?.street_address_1 || "",
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Remove the saved link for a job. */
export async function removeJobLink(jobId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/companycam/links?jobId=${encodeURIComponent(jobId)}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Exact address matching (search-first workflow) ───────────────────────────

export type ParsedJobAddress = {
  street: string;
  city: string;
  state: string;
  zip: string;
};

/**
 * Parse a CRM job's free-form address + city into components. The CRM stores
 * `address` (often "123 Main St, Phoenix, AZ 85003" or just the street) and a
 * separate `city`; state is Arizona-locked for this business.
 */
export function parseJobAddress(job: { address: string; city?: string }): ParsedJobAddress {
  const raw = (job.address || "").trim();
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  const zip = raw.match(/\b\d{5}(?:-\d{4})?\b/)?.[0] || "";
  const state = raw.match(/\b([A-Z]{2})\b/)?.[1] || "AZ";
  let city = (job.city || "").trim();
  if (!city && parts.length >= 2) city = parts[1].replace(/\b[A-Z]{2}\b.*$/, "").trim();
  return { street: parts[0] || raw, city, state, zip };
}

function normStreet(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Return CompanyCam projects whose address is an EXACT match for the job:
 * the street must match exactly, and city/ZIP must match whenever both sides
 * provide them. Used to decide auto-link (1 match) vs. picker (>1) vs. create.
 */
export function findExactAddressMatches(
  job: { address: string; city?: string },
  projects: CompanyCamProject[],
): CompanyCamProject[] {
  const parsed = parseJobAddress(job);
  const jobStreet = normStreet(parsed.street);
  if (!jobStreet) return [];

  return projects.filter((project) => {
    if (project.archived) return false;
    const addr = project.address;
    if (!addr) return false;
    if (normStreet(addr.street_address_1) !== jobStreet) return false;
    if (parsed.city && addr.city && normStreet(parsed.city) !== normStreet(addr.city)) return false;
    if (parsed.zip && addr.postal_code && parsed.zip !== addr.postal_code) return false;
    return true;
  });
}

/** Create a CompanyCam project for a job using customer name + parsed address. */
export async function createProjectForJob(job: {
  name: string;
  address: string;
  city?: string;
}): Promise<CompanyCamProject | null> {
  const parsed = parseJobAddress(job);
  const projectName = [job.name, parsed.street].filter(Boolean).join(" — ") || "Untitled Project";
  return createProject({
    name: projectName,
    address: { street: parsed.street, city: parsed.city, state: parsed.state, zip: parsed.zip },
  });
}

// ── Address matching ─────────────────────────────────────────────────────────

function normalizeAddress(addr: string): string {
  return addr
    .toLowerCase()
    .replace(/[.,#\-\/\\]/g, " ")
    .replace(/\b(street|st|avenue|ave|boulevard|blvd|drive|dr|road|rd|lane|ln|court|ct|place|pl|way|circle|cir|terrace|ter|trail|trl)\b/g, "")
    .replace(/\b(north|south|east|west|n|s|e|w)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match a CRM job address to a CompanyCam project by fuzzy address comparison.
 * Returns the best-matching project or null.
 */
export function matchProjectByAddress(
  jobAddress: string,
  projects: CompanyCamProject[]
): CompanyCamProject | null {
  if (!jobAddress) return null;
  const normJob = normalizeAddress(jobAddress);
  if (!normJob) return null;

  // Extract street number + first word of street name for matching
  const jobTokens = normJob.split(" ").filter(Boolean);
  if (jobTokens.length < 2) return null;
  const jobNumber = jobTokens[0];

  let bestMatch: CompanyCamProject | null = null;
  let bestScore = 0;

  for (const project of projects) {
    const projAddr = project.address?.street_address_1;
    if (!projAddr) continue;
    const normProj = normalizeAddress(projAddr);
    if (!normProj) continue;

    // Exact normalized match
    if (normProj === normJob) return project;

    // Check if street numbers match
    const projTokens = normProj.split(" ").filter(Boolean);
    if (projTokens.length < 2) continue;
    if (projTokens[0] !== jobNumber) continue;

    // Score by overlapping tokens
    const projSet = new Set(projTokens);
    let score = 0;
    for (const token of jobTokens) {
      if (projSet.has(token)) score++;
    }
    const normalized = score / Math.max(jobTokens.length, projTokens.length);
    if (normalized > bestScore && normalized >= 0.5) {
      bestScore = normalized;
      bestMatch = project;
    }
  }

  return bestMatch;
}
