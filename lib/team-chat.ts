export const teamChatRoomId = "general";
export const teamChatTableName = "team_chat_messages";

export type TeamChatMessage = {
  id: string;
  room_id: string;
  user_id: string;
  user_name: string;
  user_avatar_url: string | null;
  message: string;
  created_at: string;
};

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
