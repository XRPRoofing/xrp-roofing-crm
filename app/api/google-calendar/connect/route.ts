import { NextRequest, NextResponse } from "next/server";

const scope = "https://www.googleapis.com/auth/calendar.events";
const tokenCookieName = "xrp_google_calendar_tokens";

function getGoogleConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  };
}

function getAppOrigin(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const protocol = req.headers.get("x-forwarded-proto") || "https";
  return host ? `${protocol}://${host}` : req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  const { clientId, clientSecret, redirectUri: configuredRedirectUri } = getGoogleConfig();
  const origin = getAppOrigin(req);
  const redirectUri = configuredRedirectUri || `${origin}/api/google-calendar/connect`;
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${origin}/crm/calendar?google_calendar=missing_env`);
  }

  if (error) {
    return NextResponse.redirect(`${origin}/crm/calendar?google_calendar=error`);
  }

  if (!code) {
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scope);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    return NextResponse.redirect(authUrl.toString());
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    return NextResponse.redirect(`${origin}/crm/calendar?google_calendar=token_error`);
  }

  const tokens = await tokenResponse.json();
  const response = NextResponse.redirect(`${origin}/crm/calendar?google_calendar=connected`);
  response.cookies.set(tokenCookieName, JSON.stringify(tokens), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
