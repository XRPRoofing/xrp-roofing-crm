import { TEAM_MEMBERS } from "@/lib/calendar-colors";
import type { CalendarEvent } from "@/lib/calendar-sync";
import type { RouteJob } from "@/lib/calendar-route";

export const UNASSIGNED_ID = "__unassigned__";

export type TeamMemberSource = "profile" | "legacy" | "historical";

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  source: TeamMemberSource;
  role: string | null;
  legacyIds: string[];
  isSelectable: boolean;
};

export type ProfileLike = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
};

export type ResolvedAssignee =
  | { kind: "roster"; memberId: string; input: string }
  | { kind: "adHoc"; memberId: string; input: string }
  | { kind: "unassigned"; memberId: typeof UNASSIGNED_ID; input: "" };

export type TeamRoster = {
  members: TeamMember[];
  byId: Map<string, TeamMember>;
  byEmail: Map<string, TeamMember>;
  byLegacyId: Map<string, TeamMember>;
  byName: Map<string, TeamMember>;
};

export function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, "");
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function buildMemberFromProfile(profile: ProfileLike): TeamMember {
  return {
    id: profile.id,
    name: profile.full_name?.trim() || profile.email?.split("@")[0] || profile.id,
    email: profile.email?.trim() || "",
    source: "profile",
    role: profile.role || null,
    legacyIds: [normalizeIdentifier(profile.id)],
    isSelectable: true,
  };
}

function buildMemberFromLegacy(legacy: (typeof TEAM_MEMBERS)[number]): TeamMember {
  return {
    id: legacy.id,
    name: legacy.name.trim(),
    email: legacy.email.trim(),
    source: "legacy",
    role: null,
    legacyIds: [normalizeIdentifier(legacy.id)],
    isSelectable: true,
  };
}

function buildHistoricalMember(input: string): TeamMember {
  const trimmed = input.trim();
  return {
    id: normalizeIdentifier(trimmed),
    name: trimmed,
    email: looksLikeEmail(trimmed) ? trimmed : "",
    source: "historical",
    role: null,
    legacyIds: [normalizeIdentifier(trimmed)],
    isSelectable: false,
  };
}

function rebuildRosterIndexes(roster: TeamRoster): void {
  roster.byId.clear();
  roster.byEmail.clear();
  roster.byLegacyId.clear();
  roster.byName.clear();

  for (const member of roster.members) {
    roster.byId.set(normalizeIdentifier(member.id), member);
    if (member.email) roster.byEmail.set(normalizeIdentifier(member.email), member);
    for (const legacyId of member.legacyIds) {
      if (legacyId) roster.byLegacyId.set(legacyId, member);
    }
    const nameKey = normalizeName(member.name);
    if (nameKey && !roster.byName.has(nameKey)) {
      roster.byName.set(nameKey, member);
    }
  }
}

export function buildTeamRoster(
  profiles: ProfileLike[] = [],
  legacyMembers = TEAM_MEMBERS,
): TeamRoster {
  const members: TeamMember[] = profiles.map(buildMemberFromProfile);

  const roster: TeamRoster = {
    members,
    byId: new Map(),
    byEmail: new Map(),
    byLegacyId: new Map(),
    byName: new Map(),
  };

  rebuildRosterIndexes(roster);

  for (const legacy of legacyMembers) {
    const legacyId = normalizeIdentifier(legacy.id);
    const legacyEmail = normalizeIdentifier(legacy.email);
    const legacyNameKey = normalizeName(legacy.name);

    const matches = new Set<TeamMember>();

    const byId = roster.byId.get(legacyId);
    if (byId) matches.add(byId);

    if (legacyNameKey) {
      const byName = roster.byName.get(legacyNameKey);
      if (byName) matches.add(byName);
    }

    // Add the legacy id/email to every profile whose normalized name or email local
    // part contains the legacy id or legacy name. This prevents a single shared
    // email (e.g. info@xrproofing.com) from incorrectly swallowing a legacy id.
    for (const member of members) {
      if (member.source !== "profile") continue;
      const nameKey = normalizeName(member.name);
      const emailLocal = member.email ? normalizeIdentifier(member.email).split("@")[0] : "";
      if (
        (legacyId && (nameKey.includes(legacyId) || emailLocal.includes(legacyId))) ||
        (legacyNameKey && (nameKey.includes(legacyNameKey) || emailLocal.includes(legacyNameKey)))
      ) {
        matches.add(member);
      }
    }

    if (matches.size > 0) {
      for (const match of matches) {
        if (!match.legacyIds.includes(legacyId)) match.legacyIds.push(legacyId);
        if (legacy.email && !match.legacyIds.includes(legacyEmail)) {
          match.legacyIds.push(legacyEmail);
        }
        if (!match.name && legacy.name) match.name = legacy.name;
      }
      continue;
    }

    members.push(buildMemberFromLegacy(legacy));
  }

  rebuildRosterIndexes(roster);

  return roster;
}

function findMemberByString(value: string, roster: TeamRoster): TeamMember | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const normalized = normalizeIdentifier(trimmed);

  return (
    roster.byId.get(normalized) ??
    roster.byEmail.get(normalized) ??
    roster.byLegacyId.get(normalized) ??
    roster.byName.get(normalizeName(trimmed))
  );
}

function resolveString(value: string, roster: TeamRoster): ResolvedAssignee {
  const trimmed = value.trim();
  if (!trimmed) return { kind: "unassigned", memberId: UNASSIGNED_ID, input: "" };

  const parts = trimmed.split(",").map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const existing = findMemberByString(part, roster);
    if (existing) {
      return { kind: "roster", memberId: existing.id, input: part };
    }
  }

  return { kind: "adHoc", memberId: normalizeIdentifier(trimmed), input: trimmed };
}

function resolveInputs(
  event: CalendarEvent,
  jobsById: Record<string, RouteJob> = {},
): string[] {
  const inputs: string[] = [];
  if (event.assigned_to?.trim()) inputs.push(event.assigned_to.trim());

  const isGcal = event.id.startsWith("gcal:");
  if (isGcal && event.created_by?.trim()) inputs.push(event.created_by.trim());

  if (event.job_id && jobsById[event.job_id]) {
    const job = jobsById[event.job_id];
    const jobAssignee =
      job.assignedTo?.trim() ||
      job.assignedCrew?.find((c) => c.trim())?.trim() ||
      "";
    if (jobAssignee) inputs.push(jobAssignee);
  }

  return inputs;
}

export function eventMatchesMember(
  event: CalendarEvent,
  roster: TeamRoster,
  memberId: string,
  jobsById: Record<string, RouteJob> = {},
): boolean {
  if (memberId === UNASSIGNED_ID) {
    return resolveInputs(event, jobsById).length === 0;
  }

  const inputs = resolveInputs(event, jobsById);
  for (const input of inputs) {
    const whole = findMemberByString(input, roster);
    if (whole && whole.id === memberId) return true;

    const parts = input.split(",").map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      if (part === input) continue;
      const existing = findMemberByString(part, roster);
      if (existing && existing.id === memberId) return true;
    }

    if (!whole && normalizeIdentifier(input) === memberId) return true;
  }

  return false;
}

export function resolveRouteAssignee(
  event: CalendarEvent,
  roster: TeamRoster,
  jobsById: Record<string, RouteJob> = {},
): ResolvedAssignee {
  if (event.assigned_to?.trim()) {
    return resolveString(event.assigned_to, roster);
  }

  const isGcal = event.id.startsWith("gcal:");
  if (isGcal && event.created_by?.trim()) {
    return resolveString(event.created_by, roster);
  }

  if (event.job_id && jobsById[event.job_id]) {
    const job = jobsById[event.job_id];
    const jobAssignee =
      job.assignedTo?.trim() ||
      job.assignedCrew?.find((c) => c.trim())?.trim() ||
      "";
    if (jobAssignee) {
      return resolveString(jobAssignee, roster);
    }
  }

  return { kind: "unassigned", memberId: UNASSIGNED_ID, input: "" };
}

export function collectAdHocMembers(
  events: CalendarEvent[],
  roster: TeamRoster,
  jobsById: Record<string, RouteJob> = {},
): TeamMember[] {
  const seen = new Set<string>();
  const adHoc: TeamMember[] = [];

  for (const event of events) {
    const resolved = resolveRouteAssignee(event, roster, jobsById);
    if (resolved.kind !== "adHoc") continue;
    if (roster.byId.has(resolved.memberId)) continue;
    if (seen.has(resolved.memberId)) continue;
    seen.add(resolved.memberId);
    adHoc.push(buildHistoricalMember(resolved.input));
  }

  return adHoc;
}

export function getSelectableRoster(
  baseRoster: TeamRoster,
  eventsForDate: CalendarEvent[] = [],
  jobsById: Record<string, RouteJob> = {},
): TeamRoster {
  const adHoc = collectAdHocMembers(eventsForDate, baseRoster, jobsById);

  const members = [
    ...baseRoster.members.map((m) =>
      m.source === "historical" ? { ...m, isSelectable: false } : m,
    ),
    ...adHoc.map((m) => ({ ...m, isSelectable: true })),
  ];

  const roster: TeamRoster = {
    members,
    byId: new Map(),
    byEmail: new Map(),
    byLegacyId: new Map(),
    byName: new Map(),
  };

  rebuildRosterIndexes(roster);

  return roster;
}

export function buildRosterFromMembers(members: TeamMember[]): TeamRoster {
  const roster: TeamRoster = {
    members: members.map((m) => ({ ...m })),
    byId: new Map(),
    byEmail: new Map(),
    byLegacyId: new Map(),
    byName: new Map(),
  };
  rebuildRosterIndexes(roster);
  return roster;
}

export function getSortedSelectableMembers(roster: TeamRoster): TeamMember[] {
  return roster.members
    .filter((m) => m.isSelectable)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getUnassignedMember(): TeamMember {
  return {
    id: UNASSIGNED_ID,
    name: "Unassigned",
    email: "",
    source: "legacy",
    role: null,
    legacyIds: [],
    isSelectable: true,
  };
}
