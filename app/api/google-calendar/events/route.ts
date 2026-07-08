import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSharedGoogleTokens, saveSharedGoogleTokens } from "@/lib/google-calendar-store";

export const runtime = "nodejs";

const tokenCookieName = "xrp_google_calendar_tokens";

const eventSchema = z.object({
  title: z.string().min(1),
  name: z.string().min(1),
  address: z.string().min(1),
  jobKind: z.string().min(1),
  phone: z.string().optional(),
  date: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  notes: z.string().optional(),
  guestEmails: z.string().optional(),
  crmEventId: z.string().optional(),
});

const updateEventSchema = eventSchema.extend({ id: z.string().min(1) });

type GoogleTokens = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

const tokenCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

function parseTokens(req: NextRequest) {
  const cookie = req.cookies.get(tokenCookieName)?.value;
  if (!cookie) return null;

  try {
    return JSON.parse(cookie) as GoogleTokens;
  } catch {
    return null;
  }
}

async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) return null;
  return (await response.json()) as GoogleTokens;
}

type GoogleCall = { connected: boolean; response: Response | null; refreshedTokens: GoogleTokens | null };

function buildGoogleEvent(data: z.infer<typeof eventSchema>) {
  const attendees = (data.guestEmails || "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => ({ email }));

  return {
    summary: data.title,
    location: data.address,
    description: `Name: ${data.name}\nPhone: ${data.phone || ""}\nAddress: ${data.address}\nKind of Job: ${data.jobKind}\nNotes: ${data.notes || ""}`,
    start: { dateTime: `${data.date}T${data.startTime}:00`, timeZone: "America/Phoenix" },
    end: { dateTime: `${data.date}T${data.endTime}:00`, timeZone: "America/Phoenix" },
    attendees,
    extendedProperties: {
      private: {
        crmName: data.name,
        crmPhone: data.phone || "",
        crmAddress: data.address,
        crmJobKind: data.jobKind,
        crmNotes: data.notes || "",
        // Link back to the CRM calendar event so edits/deletes stay in sync
        // (and duplicates are avoided) without needing a DB column.
        crmEventId: data.crmEventId || "",
      },
    },
  };
}

function callGoogle(accessToken: string, path: string, init?: RequestInit) {
  return fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

async function googleCalendarFetch(req: NextRequest, path: string, init?: RequestInit): Promise<GoogleCall> {
  // Prefer the shared server-side connection (works across all devices), then
  // fall back to a cookie set on the connecting device.
  const tokens = (await getSharedGoogleTokens()) || parseTokens(req);

  if (!tokens?.access_token) {
    return { connected: false, response: null, refreshedTokens: null };
  }

  let response = await callGoogle(tokens.access_token, path, init);

  // Access tokens expire after ~1 hour. Transparently refresh and retry once.
  if (response.status === 401 && tokens.refresh_token) {
    const refreshed = await refreshAccessToken(tokens.refresh_token);
    if (refreshed?.access_token) {
      response = await callGoogle(refreshed.access_token, path, init);
      const merged = { ...tokens, ...refreshed, refresh_token: refreshed.refresh_token || tokens.refresh_token };
      // Keep the shared store fresh so other devices reuse the renewed token.
      await saveSharedGoogleTokens(merged);
      return { connected: true, response, refreshedTokens: merged };
    }
  }

  return { connected: true, response, refreshedTokens: null };
}

function withRefreshedCookie(res: NextResponse, refreshedTokens: GoogleTokens | null) {
  if (refreshedTokens) {
    res.cookies.set(tokenCookieName, JSON.stringify(refreshedTokens), tokenCookieOptions);
  }
  return res;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const defaultMin = new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString();
  const timeMin = url.searchParams.get("timeMin") || defaultMin;
  const timeMax = url.searchParams.get("timeMax");

  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    timeMin,
    maxResults: "250",
  });
  if (timeMax) params.set("timeMax", timeMax);

  const { connected, response, refreshedTokens } = await googleCalendarFetch(req, `/calendars/primary/events?${params.toString()}`);

  if (!connected || !response) {
    return NextResponse.json({ connected: false, events: [] });
  }

  if (!response.ok) {
    return NextResponse.json({ connected: false, events: [], error: "Google Calendar connection expired. Please reconnect Google." });
  }

  const data = await response.json();
  return withRefreshedCookie(NextResponse.json({ connected: true, events: data.items || [] }), refreshedTokens);
}

export async function POST(req: NextRequest) {
  const payload = eventSchema.parse(await req.json());
  const { connected, response, refreshedTokens } = await googleCalendarFetch(req, "/calendars/primary/events?sendUpdates=all", {
    method: "POST",
    body: JSON.stringify(buildGoogleEvent(payload)),
  });

  if (!connected || !response) {
    return NextResponse.json({ error: "Google Calendar is not connected." }, { status: 401 });
  }

  if (!response.ok) {
    return NextResponse.json({ error: "Unable to create Google Calendar event. Please reconnect Google Calendar." }, { status: 502 });
  }

  return withRefreshedCookie(NextResponse.json({ event: await response.json() }), refreshedTokens);
}

export async function PUT(req: NextRequest) {
  const payload = updateEventSchema.parse(await req.json());
  const { id, ...eventData } = payload;
  const { connected, response, refreshedTokens } = await googleCalendarFetch(req, `/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=all`, {
    method: "PATCH",
    body: JSON.stringify(buildGoogleEvent(eventData)),
  });

  if (!connected || !response) {
    return NextResponse.json({ error: "Google Calendar is not connected." }, { status: 401 });
  }

  if (!response.ok) {
    return NextResponse.json({ error: "Unable to update Google Calendar event. Please reconnect Google Calendar." }, { status: 502 });
  }

  return withRefreshedCookie(NextResponse.json({ event: await response.json() }), refreshedTokens);
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing event id" }, { status: 400 });
  }

  const { connected, response, refreshedTokens } = await googleCalendarFetch(req, `/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=all`, {
    method: "DELETE",
  });

  if (!connected || !response) {
    return NextResponse.json({ error: "Google Calendar is not connected." }, { status: 401 });
  }

  // 404/410 = already gone; treat as success so the CRM delete isn't blocked.
  if (!response.ok && response.status !== 410 && response.status !== 404) {
    return NextResponse.json({ error: "Unable to delete Google Calendar event." }, { status: 502 });
  }

  return withRefreshedCookie(NextResponse.json({ success: true }), refreshedTokens);
}
