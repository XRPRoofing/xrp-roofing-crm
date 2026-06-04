import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

const integrationsTable = "app_integrations";
const googleCalendarKey = "google_calendar";

export type GoogleTokens = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Shared, cross-device token storage. Returns null when Supabase isn't
// configured or the row/table doesn't exist yet (callers fall back to cookie).
export async function getSharedGoogleTokens(): Promise<GoogleTokens | null> {
  const admin = getAdminClient();
  if (!admin) return null;

  try {
    const { data, error } = await admin
      .from(integrationsTable)
      .select("payload")
      .eq("id", googleCalendarKey)
      .maybeSingle();
    if (error || !data?.payload) return null;
    return data.payload as GoogleTokens;
  } catch {
    return null;
  }
}

export async function saveSharedGoogleTokens(tokens: GoogleTokens): Promise<void> {
  const admin = getAdminClient();
  if (!admin) return;

  try {
    await admin
      .from(integrationsTable)
      .upsert({ id: googleCalendarKey, payload: tokens, updated_at: new Date().toISOString() });
  } catch {
    // Best effort — cookie fallback still keeps the connecting device working.
  }
}
