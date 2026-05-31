const fallbackSupabaseUrl = "https://lcchocuoeettbryfwlwq.supabase.co";

function extractProjectRef(value: string) {
  const directMatch = value.match(/^[a-z0-9]{20}$/i);
  if (directMatch) return value;

  const supabaseHostMatch = value.match(/https?:\/\/([a-z0-9]{20})\.supabase\.co/i);
  if (supabaseHostMatch?.[1]) return supabaseHostMatch[1];

  const dashboardMatch = value.match(/supabase\.com\/dashboard\/project\/([a-z0-9]{20})/i);
  if (dashboardMatch?.[1]) return dashboardMatch[1];

  return null;
}

export function normalizeSupabaseUrl(value?: string | null) {
  const trimmedValue = value?.trim() || fallbackSupabaseUrl;
  const projectRef = extractProjectRef(trimmedValue);

  if (projectRef) return `https://${projectRef}.supabase.co`;

  try {
    const url = new URL(trimmedValue);
    return `${url.protocol}//${url.host}`;
  } catch {
    return fallbackSupabaseUrl;
  }
}
