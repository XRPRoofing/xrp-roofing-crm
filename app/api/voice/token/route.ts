import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

/**
 * POST /api/voice/token
 *
 * Issues a Twilio Access Token with VoiceGrant for the mobile app.
 * Authenticates the user via Supabase JWT (Bearer token).
 * Excludes crew users from receiving tokens.
 */
export async function POST(req: NextRequest) {
  try {
    // --- Auth: verify Supabase JWT from Authorization header ---
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const jwt = authHeader.slice(7);

    const supabaseUrl = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    // --- Check user role: exclude crew users ---
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role === "crew") {
      return NextResponse.json({ error: "Access denied for crew users" }, { status: 403 });
    }

    // --- Twilio config ---
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const apiKeySid = process.env.TWILIO_API_KEY_SID;
    const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
    const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;

    if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
      console.error("[voice/token] Missing Twilio env vars:", {
        accountSid: !!accountSid,
        apiKeySid: !!apiKeySid,
        apiKeySecret: !!apiKeySecret,
        twimlAppSid: !!twimlAppSid,
      });
      return NextResponse.json({ error: "Voice not configured" }, { status: 500 });
    }

    // --- Parse request body ---
    const body = await req.json().catch(() => ({}));
    const platform = body.platform === "ios" ? "ios" : "android";

    // Use a consistent identity that matches the existing CRM browser dialer
    // so both browser + mobile ring simultaneously
    const identity = "crm-agent";

    // --- Build Access Token ---
    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
      identity,
      ttl: 3600, // 1 hour
    });

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: true,
      // Push credential for waking device when app is backgrounded
      ...(platform === "android" && process.env.TWILIO_PUSH_CREDENTIAL_SID_ANDROID
        ? { pushCredentialSid: process.env.TWILIO_PUSH_CREDENTIAL_SID_ANDROID }
        : {}),
      ...(platform === "ios" && process.env.TWILIO_PUSH_CREDENTIAL_SID_IOS
        ? { pushCredentialSid: process.env.TWILIO_PUSH_CREDENTIAL_SID_IOS }
        : {}),
    });

    token.addGrant(voiceGrant);

    console.log(`[voice/token] Issued token for ${user.email} (identity: ${identity}, platform: ${platform})`);

    return NextResponse.json({
      token: token.toJwt(),
      identity,
    });
  } catch (err) {
    console.error("[voice/token] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
