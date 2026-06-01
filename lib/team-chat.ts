export const teamChatRoomId = "general";
export const teamChatTableName = "team_chat_messages";
export const teamChatUnreadStorageKey = "xrp-crm-team-chat-unread";

export type TeamChatAttachment = {
  id: string;
  name: string;
  type: string;
  dataUrl: string;
};

export type TeamChatMessage = {
  id: string;
  room_id: string;
  user_id: string;
  user_name: string;
  user_avatar_url: string | null;
  message: string;
  mentions: string[];
  attachments: TeamChatAttachment[];
  created_at: string;
};

export const quickChatEmojis = ["👍", "👏", "🔥", "✅", "😊", "🙏", "🏠", "🔨", "📸", "🚀"];

export function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "XR";
}

export function formatChatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function extractMentions(message: string) {
  return Array.from(new Set((message.match(/@[\w.-]+/g) || []).map((mention) => mention.slice(1))));
}

export function readTeamChatUnreadCount() {
  if (typeof window === "undefined") return 0;

  const savedCount = window.localStorage.getItem(teamChatUnreadStorageKey);
  const count = Number(savedCount);
  return Number.isFinite(count) ? count : 0;
}

export function saveTeamChatUnreadCount(count: number) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(teamChatUnreadStorageKey, String(Math.max(0, count)));
  window.dispatchEvent(new Event("team-chat-unread-updated"));
}

export function incrementTeamChatUnreadCount() {
  saveTeamChatUnreadCount(readTeamChatUnreadCount() + 1);
}

export function markTeamChatRead() {
  saveTeamChatUnreadCount(0);
}
