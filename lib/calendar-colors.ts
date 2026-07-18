export type ColorConfig = { id: string; label: string; color: string; dot: string };

export const EVENT_COLORS: ColorConfig[] = [
  { id: "blue", label: "Blue", color: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
  { id: "red", label: "Red", color: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-500" },
  { id: "green", label: "Green", color: "bg-green-50 text-green-700 border-green-200", dot: "bg-green-500" },
  { id: "purple", label: "Purple", color: "bg-purple-50 text-purple-700 border-purple-200", dot: "bg-purple-500" },
  { id: "orange", label: "Orange", color: "bg-orange-50 text-orange-700 border-orange-200", dot: "bg-orange-500" },
  { id: "pink", label: "Pink", color: "bg-pink-50 text-pink-700 border-pink-200", dot: "bg-pink-400" },
  { id: "cyan", label: "Teal", color: "bg-cyan-50 text-cyan-700 border-cyan-200", dot: "bg-cyan-500" },
  { id: "yellow", label: "Yellow", color: "bg-yellow-50 text-yellow-800 border-yellow-200", dot: "bg-yellow-400" },
  { id: "gray", label: "Gray", color: "bg-gray-100 text-gray-700 border-gray-300", dot: "bg-gray-500" },
  { id: "indigo", label: "Indigo", color: "bg-indigo-50 text-indigo-700 border-indigo-200", dot: "bg-indigo-500" },
  { id: "emerald", label: "Emerald", color: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-600" },
];

export const DEFAULT_COLOR = EVENT_COLORS[0];

export function getColorConfig(colorId: string): ColorConfig {
  return EVENT_COLORS.find((c) => c.id === colorId) || DEFAULT_COLOR;
}

export type ColorClasses = { bg: string; text: string; border: string; dot: string };

function parseColorConfig(cfg: ColorConfig): ColorClasses {
  const parts = cfg.color.split(/\s+/);
  return {
    bg: parts.find((p) => p.startsWith("bg-")) || "bg-white",
    text: parts.find((p) => p.startsWith("text-")) || "text-gray-700",
    border: parts.find((p) => p.startsWith("border-")) || "border-gray-200",
    dot: cfg.dot,
  };
}

export const TEAM_MEMBERS = [
  { id: "jonathan", name: "Jonathan Gonzalez", email: "info@xrproofing.com", teamColor: "blue" as const },
  { id: "darwin", name: "Darwin Rodas Garcia", email: "", teamColor: "green" as const },
  { id: "office", name: "Office", email: "info@xrproofing.com", teamColor: "purple" as const },
];

export const TEAM_COLOR_STYLES: Record<string, ColorClasses> = {
  green: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200", dot: "bg-green-500" },
  blue: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", dot: "bg-blue-500" },
  orange: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", dot: "bg-orange-500" },
  purple: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", dot: "bg-purple-500" },
};

export function getTeamColor(memberId: string): ColorClasses | null {
  const member = TEAM_MEMBERS.find((m) => m.id === memberId);
  return member ? TEAM_COLOR_STYLES[member.teamColor] || TEAM_COLOR_STYLES.blue : null;
}

export type EventColorInput = { color?: string | null; assigned_to?: string | null };

const HEX_TO_COLOR: Record<string, string> = {
  "#f97316": "orange",
};

export function resolveEventColor(event: EventColorInput): ColorClasses {
  const colorId = event.color?.trim() || "";

  // 1. Explicit saved color id (e.g. "purple", "yellow")
  const cfg = EVENT_COLORS.find((c) => c.id === colorId);
  if (cfg) return parseColorConfig(cfg);

  // 2. Legacy hex values used by job-scheduling callers
  const mappedId = HEX_TO_COLOR[colorId.toLowerCase()];
  if (mappedId) {
    const mappedCfg = EVENT_COLORS.find((c) => c.id === mappedId);
    if (mappedCfg) return parseColorConfig(mappedCfg);
  }

  // 3. Fall back to assigned team member's color
  const tc = getTeamColor(event.assigned_to || "");
  if (tc) return tc;

  // 4. Final fallback to default blue
  return parseColorConfig(DEFAULT_COLOR);
}
