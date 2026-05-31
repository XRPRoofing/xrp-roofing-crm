import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const tokenCookieName = "xrp_google_calendar_tokens";

const eventSchema = z.object({
  title: z.string().min(1),
  name: z.string().min(1),
  address: z.string().min(1),
  jobKind: z.string().min(1),
  date: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  notes: z.string().optional(),
  guestEmails: z.string().optional(),
});

const updateEventSchema = eventSchema.extend({ id: z.string().min(1) });

type GoogleTokens = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
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

function buildGoogleEvent(data: z.infer<typeof eventSchema>) {
  const attendees = (data.guestEmails || "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => ({ email }));

  return {
    summary: data.title,
    location: data.address,
    description: `Name: ${data.name}\nAddress: ${data.address}\nKind of Job: ${data.jobKind}\nNotes: ${data.notes || ""}`,
    start: { dateTime: `${data.date}T${data.startTime}:00`, timeZone: "America/Phoenix" },
    end: { dateTime: `${data.date}T${data.endTime}:00`, timeZone: "America/Phoenix" },
    attendees,
    extendedProperties: {
      private: {
        crmName: data.name,
        crmAddress: data.address,
        crmJobKind: data.jobKind,
        crmNotes: data.notes || "",
      },
    },
  };
}

async function googleCalendarFetch(req: NextRequest, path: string, init?: RequestInit) {
  const tokens = parseTokens(req);

  if (!tokens?.access_token) {
    return { connected: false, response: null };
  }

  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  return { connected: true, response };
}

export async function GET(req: NextRequest) {
  const now = new Date().toISOString();
  const { connected, response } = await googleCalendarFetch(req, `/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(now)}&maxResults=50`);

  if (!connected || !response) {
    return NextResponse.json({ connected: false, events: [] });
  }

  if (!response.ok) {
    return NextResponse.json({ connected: false, events: [], error: "Google Calendar connection expired. Please reconnect Google." }, { status: 401 });
  }

  const data = await response.json();
  return NextResponse.json({ connected: true, events: data.items || [] });
}

export async function POST(req: NextRequest) {
  const payload = eventSchema.parse(await req.json());
  const { connected, response } = await googleCalendarFetch(req, "/calendars/primary/events?sendUpdates=all", {
    method: "POST",
    body: JSON.stringify(buildGoogleEvent(payload)),
  });

  if (!connected || !response) {
    return NextResponse.json({ error: "Google Calendar is not connected." }, { status: 401 });
  }

  if (!response.ok) {
    return NextResponse.json({ error: "Unable to create Google Calendar event. Please reconnect Google Calendar." }, { status: 502 });
  }

  return NextResponse.json({ event: await response.json() });
}

export async function PUT(req: NextRequest) {
  const payload = updateEventSchema.parse(await req.json());
  const { id, ...eventData } = payload;
  const { connected, response } = await googleCalendarFetch(req, `/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=all`, {
    method: "PATCH",
    body: JSON.stringify(buildGoogleEvent(eventData)),
  });

  if (!connected || !response) {
    return NextResponse.json({ error: "Google Calendar is not connected." }, { status: 401 });
  }

  if (!response.ok) {
    return NextResponse.json({ error: "Unable to update Google Calendar event. Please reconnect Google Calendar." }, { status: 502 });
  }

  return NextResponse.json({ event: await response.json() });
}
